"""
ClinBridge Backend — FastAPI Application
Main entry point with WebSocket endpoint for browser clients.

Architecture:
  Browser ←→ WebSocket ←→ FastAPI ←→ Gemini Live API

The WebSocket endpoint handles:
  - session.start  → creates a SessionManager and opens Gemini Live
  - audio.chunk    → forwards PCM16 audio to Gemini
  - image.send     → forwards document images to Gemini
  - session.end    → tears down the session
"""

import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from session_manager import SessionManager

# Load environment variables from .env file (looks in parent dir too)
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
# Also try local .env
load_dotenv()

app = FastAPI(title="ClinBridge API", version="0.1.0")

# Allow CORS for local development (Next.js on port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "service": "ClinBridge",
        "gemini_key_set": bool(os.environ.get("GOOGLE_API_KEY")),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint for ClinBridge browser clients.

    Message flow:
      1. Browser sends session.start with language preferences
      2. Server creates a Gemini Live session via SessionManager
      3. Browser streams audio.chunk messages (mic PCM16 at 16kHz)
      4. Server forwards audio to Gemini, receives translated audio/text
      5. Server pushes audio.response and transcript.add back to browser
      6. Browser sends session.end or disconnects to tear down
    """
    await websocket.accept()
    session_manager = None

    try:
        while True:
            # Receive JSON messages from the browser
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "session.status",
                    "status": "error",
                    "message": "Invalid JSON message"
                })
                continue

            msg_type = message.get("type", "")

            # --- SESSION START ---
            # Browser requests a new live translation session
            if msg_type == "session.start":
                clinician_lang = message.get("clinicianLang", "en-US")
                patient_lang = message.get("patientLang", "es-US")

                # Close any existing session first
                if session_manager:
                    await session_manager.close()

                try:
                    session_manager = SessionManager(
                        websocket=websocket,
                        clinician_lang=clinician_lang,
                        patient_lang=patient_lang,
                    )
                    await session_manager.start()
                    print(f"[ClinBridge] Session started: {clinician_lang} ↔ {patient_lang}")
                except Exception as e:
                    print(f"[ClinBridge] Failed to start session: {e}")
                    await websocket.send_json({
                        "type": "session.status",
                        "status": "error",
                        "message": f"Failed to start Gemini session: {str(e)}"
                    })

            # --- AUDIO CHUNK ---
            # Browser sends a chunk of PCM16 audio from the microphone
            elif msg_type == "audio.chunk":
                if session_manager:
                    audio_data = message.get("data", "")
                    if audio_data:
                        await session_manager.send_audio(audio_data)
                else:
                    await websocket.send_json({
                        "type": "session.status",
                        "status": "error",
                        "message": "No active session. Send session.start first."
                    })

            # --- IMAGE SEND ---
            # Browser sends a document image for visual relay
            elif msg_type == "image.send":
                if session_manager:
                    image_data = message.get("data", "")
                    mime_type = message.get("mimeType", "image/jpeg")
                    if image_data:
                        await session_manager.send_image(image_data, mime_type)
                else:
                    await websocket.send_json({
                        "type": "session.status",
                        "status": "error",
                        "message": "No active session. Send session.start first."
                    })

            # --- SESSION END ---
            # Browser requests session teardown
            elif msg_type == "session.end":
                if session_manager:
                    await session_manager.close()
                    session_manager = None
                    print("[ClinBridge] Session ended by client")
                await websocket.send_json({
                    "type": "session.status",
                    "status": "disconnected",
                    "message": "Session ended"
                })

            else:
                await websocket.send_json({
                    "type": "session.status",
                    "status": "error",
                    "message": f"Unknown message type: {msg_type}"
                })

    except WebSocketDisconnect:
        print("[ClinBridge] Client disconnected")
    except Exception as e:
        print(f"[ClinBridge] WebSocket error: {e}")
    finally:
        # Clean up the Gemini session on any disconnect
        if session_manager:
            await session_manager.close()
        print("[ClinBridge] Connection cleaned up")
