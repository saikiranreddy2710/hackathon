"""
ClinBridge Backend — Session Manager
Wraps the Gemini Multimodal Live API session lifecycle.
Handles audio forwarding, image relay, and event mapping back to the browser client.
"""

import os
import re
import base64
import asyncio
import traceback
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# ClinBridge system instruction — injected at Live session creation.
# ---------------------------------------------------------------------------
SYSTEM_INSTRUCTION = """You are ClinBridge, a real-time multilingual clinical communication relay.

CRITICAL OUTPUT RULES:
- When translating, respond ONLY with the translated text. Do not explain, analyze, or narrate your translation process.
- Never output markdown formatting, bold text, headers, or bullet points.
- Keep responses short and conversational — this is a live bedside translation.

TRANSLATION RULES:
- The clinician speaks {clinician_lang} and the patient speaks {patient_lang}.
- When you hear {clinician_lang}, translate to {patient_lang} and speak the translation.
- When you hear {patient_lang}, translate to {clinician_lang} and speak the translation.
- Preserve meaning, medically relevant terminology, urgency, tone, and emotional context.
- If you are unsure of the source language, ask for clarification briefly.

SAFETY RULES:
- You must NOT provide diagnosis, treatment advice, triage, medication recommendations, or clinical interpretation.
- If asked for medical advice, say: "I can only translate. Medical decisions must come from the clinician."
- You are a communication layer ONLY, not a medical assistant.

DOCUMENT/IMAGE RULES:
- If shown a document or image, translate ONLY the visible text.
- Say "Translating visible text. This is not medical advice." before relaying.
- Never interpret medical values or clinical findings — only translate what is visible.
- If text is blurry or unreadable, say so.
"""

LANGUAGE_NAMES = {
    "en-US": "English",
    "es-US": "Spanish",
    "hi-IN": "Hindi",
    "zh-CN": "Mandarin Chinese",
    "fr-FR": "French",
    "ar-SA": "Arabic",
}


def _extract_translation(thinking_text: str) -> str:
    """Extract the clean translated sentence from the model's thinking output.

    Native audio models mark text as thought=True. The actual translation is
    typically quoted inside the thinking narrative, e.g.:
      'translated X as "Hola, ¿cómo estás?"'
    """
    # Try to find quoted translations (single or double quotes, or guillemets)
    patterns = [
        r'(?:as|is|to|:)\s*["\u201c]([^"\u201d]+)["\u201d]',
        r'(?:as|is|to|:)\s*[\'"](.+?)[\'"]',
        r'["\u201c]([^"\u201d]{5,})["\u201d]',
    ]
    for pat in patterns:
        matches = re.findall(pat, thinking_text)
        if matches:
            # Return the longest match (most likely the full translation)
            return max(matches, key=len).strip()

    # Fallback: strip markdown bold headers and return remaining content
    cleaned = re.sub(r'\*\*[^*]+\*\*\s*\n*', '', thinking_text).strip()
    # If what remains looks like a sentence, use it
    lines = [l.strip() for l in cleaned.split('\n') if l.strip()]
    if lines:
        # Find the first line that looks like actual translated content
        for line in lines:
            if not line.startswith(('I ', "I'", 'My ', 'The ', 'This ')):
                return line
        # If all lines are English narration, return the last sentence
        return lines[-1] if len(lines[-1]) < 200 else ""
    return ""



    """
    Manages one Gemini Live session per browser WebSocket connection.

    Key design: session.receive() yields events until turn_complete, then the
    iterator ends. We must call receive() again for each new model turn.
    The _receive_loop continuously re-enters receive() so the session stays
    responsive across multiple conversation turns.
    """

    def __init__(self, websocket, clinician_lang: str, patient_lang: str):
        self.ws = websocket
        self.clinician_lang = clinician_lang
        self.patient_lang = patient_lang
        self._session = None
        self._session_ctx = None
        self._receive_task = None
        self._closed = False

        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is not set")
        self.client = genai.Client(api_key=api_key)

    async def start(self):
        """Open a Gemini Live session with the safety system instruction."""
        clinician_name = LANGUAGE_NAMES.get(self.clinician_lang, self.clinician_lang)
        patient_name = LANGUAGE_NAMES.get(self.patient_lang, self.patient_lang)

        system_prompt = SYSTEM_INSTRUCTION.format(
            clinician_lang=clinician_name,
            patient_lang=patient_name,
        )

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(
                parts=[types.Part(text=system_prompt)]
            ),
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Kore"
                    )
                ),
            ),
        )

        self._session_ctx = self.client.aio.live.connect(
            model="gemini-2.5-flash-native-audio-latest",
            config=config,
        )
        self._session = await self._session_ctx.__aenter__()

        self._receive_task = asyncio.create_task(self._receive_loop())

        await self._send_to_browser({
            "type": "session.status",
            "status": "connected",
            "message": f"Live session active: {clinician_name} ↔ {patient_name}"
        })

    async def send_audio(self, pcm_base64: str):
        """Forward a base64-encoded PCM16 audio chunk to Gemini via send()."""
        if not self._session or self._closed:
            return
        try:
            raw_audio = base64.b64decode(pcm_base64)
            await self._session.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=raw_audio, mime_type="audio/pcm;rate=16000")
                    ]
                )
            )
        except Exception as e:
            print(f"[ClinBridge] Error sending audio: {e}")

    async def send_text(self, text: str):
        """Send typed text to Gemini for translation."""
        if not self._session or self._closed:
            return
        try:
            await self._session.send(
                input=types.LiveClientContent(
                    turns=[types.Content(parts=[types.Part(text=text)])],
                    turn_complete=True,
                )
            )
        except Exception as e:
            print(f"[ClinBridge] Error sending text: {e}")

    async def send_image(self, image_base64: str, mime_type: str = "image/jpeg"):
        """Forward a base64-encoded image to Gemini for document relay."""
        if not self._session or self._closed:
            return
        try:
            raw_image = base64.b64decode(image_base64)
            await self._session.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=raw_image, mime_type=mime_type)
                    ]
                )
            )
        except Exception as e:
            print(f"[ClinBridge] Error sending image: {e}")

    async def _receive_loop(self):
        """
        Continuously read Gemini events and relay them to the browser.

        receive() yields events until turn_complete, then the iterator ends.
        We re-enter receive() after each turn so the session remains responsive
        for multi-turn conversations.
        """
        try:
            while not self._closed:
                async for msg in self._session.receive():
                    if self._closed:
                        return

                    server_content = getattr(msg, "server_content", None)
                    if not server_content:
                        continue

                    # Barge-in: user interrupted model output
                    interrupted = getattr(server_content, "interrupted", False)
                    if interrupted:
                        await self._send_to_browser({"type": "audio.interrupted"})
                        continue

                    # Model turn: audio and/or text parts
                    model_turn = getattr(server_content, "model_turn", None)
                    if model_turn:
                        for part in (model_turn.parts or []):
                            inline_data = getattr(part, "inline_data", None)
                            if inline_data and inline_data.data:
                                audio_b64 = base64.b64encode(
                                    inline_data.data
                                ).decode("utf-8")
                                await self._send_to_browser({
                                    "type": "audio.response",
                                    "data": audio_b64,
                                })

                            text = getattr(part, "text", None)
                            is_thought = getattr(part, "thought", False)
                            if text:
                                if is_thought:
                                    # Extract clean translation from thinking
                                    clean = _extract_translation(text)
                                    if clean:
                                        await self._send_to_browser({
                                            "type": "transcript.add",
                                            "speaker": "relay",
                                            "text": clean,
                                        })
                                else:
                                    await self._send_to_browser({
                                        "type": "transcript.add",
                                        "speaker": "relay",
                                        "text": text,
                                    })

                    # Turn complete — iterator will end; outer while re-enters
                    turn_complete = getattr(server_content, "turn_complete", False)
                    if turn_complete:
                        await self._send_to_browser({"type": "turn.complete"})

        except asyncio.CancelledError:
            pass
        except Exception as e:
            if not self._closed:
                print(f"[ClinBridge] Receive loop error: {e}")
                traceback.print_exc()
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
