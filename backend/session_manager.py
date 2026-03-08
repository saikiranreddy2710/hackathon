"""
ClinBridge Backend — Session Manager
Wraps the Gemini Multimodal Live API session lifecycle.
Handles audio forwarding, image relay, and event mapping back to the browser client.

TODO(live-sdk-version): Event shapes and method signatures may change across
google-genai SDK versions. All SDK-specific parsing is isolated in this file.
"""

import os
import json
import base64
import asyncio
import traceback
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# ClinBridge system instruction — injected at Live session creation.
# This is the single source of truth for model behavior constraints.
# ---------------------------------------------------------------------------
SYSTEM_INSTRUCTION = """You are ClinBridge, a real-time multilingual clinical communication relay.

Your job is to translate and relay spoken communication between a patient and a clinician,
and to translate visible printed text from documents shown to you.

TRANSLATION RULES:
- You must preserve meaning and medically relevant terminology, but remain concise for live conversation.
- When you hear speech in one language, translate it to the other language and speak the translation.
- Always output both the original text and the translated text when possible.
- Preserve urgency, tone, and emotional context in translation.

STRICT SAFETY RULES — YOU MUST FOLLOW THESE AT ALL TIMES:
- You must NOT provide diagnosis, treatment advice, triage, medication recommendations, or clinical interpretation.
- You must NOT assess symptoms, suggest medications, evaluate risk, or make any medical decisions.
- If asked for medical advice or clinical judgment, say: "I can translate and relay communication, but medical decisions must come from the clinician."
- You are a communication layer ONLY, not a medical assistant.

DOCUMENT/IMAGE RULES:
- If shown a document or image, ONLY describe or translate what is visibly present.
- Before relaying document content, say: "I will translate the visible text on this document. This is not medical advice."
- Do NOT infer, guess, or fill in missing text.
- If text is blurry, partially obscured, or unreadable, explicitly say so.
- Never interpret medical values, lab results, or clinical findings — only translate the visible text.

LANGUAGE BEHAVIOR:
- The clinician speaks {clinician_lang} and the patient speaks {patient_lang}.
- When you hear {clinician_lang}, translate to {patient_lang} and speak the translation.
- When you hear {patient_lang}, translate to {clinician_lang} and speak the translation.
- If you are unsure of the source language, ask for clarification.
"""

# Map of language codes to readable names for the system instruction
LANGUAGE_NAMES = {
    "en-US": "English",
    "es-ES": "Spanish",
    "hi-IN": "Hindi",
    "zh-CN": "Mandarin Chinese",
    "fr-FR": "French",
    "ar-SA": "Arabic",
}


class SessionManager:
    """
    Manages one Gemini Live session per browser WebSocket connection.

    Lifecycle:
      1. start()         — opens the Gemini Live session
      2. send_audio()    — forwards PCM16 mic chunks from browser
      3. send_image()    — forwards document images from browser
      4. _receive_loop() — async loop reading Gemini events → browser
      5. close()         — tears down the session
    """

    def __init__(self, websocket, clinician_lang: str, patient_lang: str):
        self.ws = websocket
        self.clinician_lang = clinician_lang
        self.patient_lang = patient_lang
        self._session = None
        self._session_ctx = None  # The async context manager object
        self._receive_task = None
        self._closed = False

        # Initialize the Gemini client with the API key
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is not set")
        self.client = genai.Client(api_key=api_key)

    async def start(self):
        """Open a Gemini Live session with the safety system instruction."""
        clinician_name = LANGUAGE_NAMES.get(self.clinician_lang, self.clinician_lang)
        patient_name = LANGUAGE_NAMES.get(self.patient_lang, self.patient_lang)

        # Format the system instruction with the chosen languages
        system_prompt = SYSTEM_INSTRUCTION.format(
            clinician_lang=clinician_name,
            patient_lang=patient_name,
        )

        # TODO(live-sdk-version): LiveConnectConfig fields may change across SDK versions.
        # Ensure ONLY AUDIO is requested since the native audio preview model
        # throws an Invalid Argument error if TEXT is requested.
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(
                parts=[types.Part(text=system_prompt)]
            ),
        )

        # Open the async live session
        # NOTE: client.aio.live.connect() returns an async context manager.
        # We manually enter/exit it since we manage the lifecycle across methods.
        # TODO(live-sdk-version): Model name may change. Use latest Live-capable model.
        self._session_ctx = self.client.aio.live.connect(
            model="gemini-2.5-flash-native-audio-preview-12-2025",
            config=config,
        )
        self._session = await self._session_ctx.__aenter__()

        # Start the background receive loop
        self._receive_task = asyncio.create_task(self._receive_loop())

        # Notify the browser that the session is ready
        await self._send_to_browser({
            "type": "session.status",
            "status": "connected",
            "message": f"Live session active: {clinician_name} ↔ {patient_name}"
        })

    async def send_audio(self, pcm_base64: str, sample_rate: int = 16000):
        """
        Forward a base64-encoded PCM16 audio chunk from to Gemini Live.
        Uses the exact sample rate given by the browser's AudioContext.
        """
        if not self._session or self._closed:
            return
        try:
            raw_audio = base64.b64decode(pcm_base64)
            # TODO(live-sdk-version): send_realtime_input signature may change.
            await self._session.send_realtime_input(
                audio=types.Blob(data=raw_audio, mime_type=f"audio/pcm;rate={sample_rate}")
            )
        except Exception as e:
            # Log but don't send error to browser for each chunk — it's too noisy
            # and would flood the UI. Only mark closed if session is truly dead.
            if "close" in str(e).lower() or "1011" in str(e) or "1008" in str(e):
                print(f"[ClinBridge] Session closed during audio send: {e}")
                self._closed = True
                await self._send_to_browser({
                    "type": "session.status",
                    "status": "error",
                    "message": f"Session disconnected: {str(e)}"
                })
            else:
                print(f"[ClinBridge] Audio send error (non-fatal): {e}")

    async def send_image(self, image_base64: str, mime_type: str = "image/jpeg"):
        """
        Forward a base64-encoded image (document snapshot) to Gemini Live.
        The system instruction tells the model to relay visible text only.
        """
        if not self._session or self._closed:
            return
        try:
            raw_image = base64.b64decode(image_base64)
            # TODO(live-sdk-version): media param for send_realtime_input may change.
            await self._session.send_realtime_input(
                media=types.Blob(data=raw_image, mime_type=mime_type)
            )
        except Exception as e:
            print(f"[ClinBridge] Error sending image: {e}")
            await self._send_to_browser({
                "type": "session.status",
                "status": "error",
                "message": f"Image send error: {str(e)}"
            })

    async def _receive_loop(self):
        """
        Async loop that reads events from the Gemini Live session and
        maps them to our client protocol, pushing results to the browser.

        Event flow:
          Gemini Live → server_content → { interrupted?, model_turn.parts[] }
            → parts may contain inline_data (audio) or text (transcript)
            → mapped to audio.response / transcript.add / audio.interrupted
        """
        try:
            # TODO(live-sdk-version): The receive() iterator and event shapes
            # (server_content, model_turn, etc.) may change across SDK versions.
            async for msg in self._session.receive():
                if self._closed:
                    break

                server_content = msg.server_content
                if not server_content:
                    # Log other event types for debugging
                    print(f"[ClinBridge] Non-server_content event: {type(msg).__name__}")
                    continue

                # --- Barge-in / Interruption handling ---
                if getattr(server_content, 'interrupted', False):
                    print("[ClinBridge] Barge-in detected")
                    await self._send_to_browser({"type": "audio.interrupted"})
                    continue

                # --- Model turn: process audio and text parts ---
                model_turn = getattr(server_content, 'model_turn', None)
                if model_turn and hasattr(model_turn, 'parts'):
                    for part in model_turn.parts:
                        # Audio response from model (translated speech)
                        inline_data = getattr(part, 'inline_data', None)
                        if inline_data and inline_data.data:
                            audio_b64 = base64.b64encode(
                                inline_data.data
                            ).decode("utf-8")
                            await self._send_to_browser({
                                "type": "audio.response",
                                "data": audio_b64,
                            })

                        # Text response from model (transcript)
                        text = getattr(part, 'text', None)
                        if text:
                            print(f"[ClinBridge] Transcript: {text[:80]}")
                            await self._send_to_browser({
                                "type": "transcript.add",
                                "speaker": "system",
                                "original": text,
                                "translated": text,
                                "confidence": "clear",
                            })

                # --- Turn complete signal ---
                if getattr(server_content, 'turn_complete', False):
                    print("[ClinBridge] Turn complete")

        except Exception as e:
            if not self._closed:
                print(f"[ClinBridge] Receive loop error: {e}")
                traceback.print_exc()
                self._closed = True
                await self._send_to_browser({
                    "type": "session.status",
                    "status": "error",
                    "message": f"Session error: {str(e)}"
                })

    async def _send_to_browser(self, data: dict):
        """Send a JSON message to the browser WebSocket, handling errors."""
        try:
            await self.ws.send_json(data)
        except Exception:
            # Browser may have disconnected
            self._closed = True

    async def close(self):
        """Tear down the Gemini Live session and cancel background tasks."""
        self._closed = True
        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        if self._session_ctx:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception:
                pass
        self._session = None
        self._session_ctx = None
