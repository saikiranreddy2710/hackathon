# AGENTS.md

## Cursor Cloud specific instructions

ClinBridge is a two-service app: a **FastAPI backend** (Python, port 8000) and a **Next.js frontend** (TypeScript, port 3000). No database — all state is in-memory.

### Running services

- **Backend**: `cd backend && source venv/bin/activate && GOOGLE_API_KEY="$GOOGLE_API_KEY" uvicorn main:app --reload --port 8000`
- **Frontend**: `cd frontend && npm run dev` (port 3000)
- Both must run simultaneously for the WebSocket relay to work.

### Lint / Type-check / Build

| Check | Command |
|-------|---------|
| Frontend lint | `cd frontend && npm run lint` |
| Frontend build | `cd frontend && npm run build` |
| Backend import check | `cd backend && source venv/bin/activate && python -c "import main"` |

### Key caveats

- `GOOGLE_API_KEY` must be set as an env var or in a `.env` file at the repo root for Gemini Live translation to work. Without it the backend starts fine but returns an error when a session is initiated.
- The Python venv lives at `backend/venv/`. Always activate it before running backend commands.
- `python3.12-venv` system package is required to create the venv (not included by default in the VM image).
- The Gemini Live API model is `gemini-2.5-flash-native-audio-latest`. It only supports `response_modalities=["AUDIO"]` (not mixed `["AUDIO", "TEXT"]`). Language steering is done via the system instruction, not via `language_code` in `speech_config`.
- The frontend dev server does **not** hot-reload newly installed npm packages; restart `npm run dev` after adding dependencies.
- Smoke-testing session start requires a microphone device. In headless/cloud VMs without audio hardware, `startCapture()` will throw `NotFoundError: Requested device not found` — this is expected and the app recovers cleanly.
