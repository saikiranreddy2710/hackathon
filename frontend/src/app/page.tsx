'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import SafetyBanner from './components/SafetyBanner';
import SessionControls, { SessionStatus } from './components/SessionControls';
import TranscriptPane, { TranscriptEntry } from './components/TranscriptPane';
import ImageCapture from './components/ImageCapture';
import { AudioEngine } from './components/AudioEngine';

/**
 * ClinBridge — Main Page
 *
 * Orchestrates the full flow:
 *   1. User picks languages and clicks Start Session
 *   2. WebSocket opens to FastAPI backend → Gemini Live session created
 *   3. AudioEngine captures mic → sends PCM16 chunks → backend → Gemini
 *   4. Gemini responds with translated audio + transcript → played/displayed
 *   5. Image upload / camera → Gemini reads and translates visible text
 */
export default function ClinBridgePage() {
  // --- State ---
  const [clinicianLang, setClinicianLang] = useState('en-US');
  const [patientLang, setPatientLang] = useState('es-ES');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isDocumentMode, setIsDocumentMode] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // --- Refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const entryIdCounter = useRef(0);

  // --- Session Timer ---
  useEffect(() => {
    if (status === 'connected') {
      timerRef.current = setInterval(() => {
        setSessionTime((t) => t + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // --- Add a transcript entry ---
  const addTranscript = useCallback(
    (speaker: TranscriptEntry['speaker'], original: string, translated: string, confidence?: TranscriptEntry['confidence']) => {
      const entry: TranscriptEntry = {
        id: `entry-${entryIdCounter.current++}`,
        speaker,
        original,
        translated,
        confidence,
        timestamp: new Date(),
      };
      setTranscripts((prev) => [...prev, entry]);
    },
    []
  );

  // --- Handle incoming WebSocket messages ---
  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'session.status':
            if (msg.status === 'connected') {
              setStatus('connected');
              setStatusMessage(msg.message || 'Connected');
            } else if (msg.status === 'error') {
              setStatus('error');
              setStatusMessage(msg.message || 'An error occurred');
              console.error('[ClinBridge] Error:', msg.message);
            } else if (msg.status === 'disconnected') {
              setStatus('disconnected');
              setStatusMessage(msg.message || 'Disconnected');
            }
            break;

          case 'audio.response':
            // Play translated audio from Gemini
            if (audioEngineRef.current && msg.data) {
              audioEngineRef.current.playAudio(msg.data);
            }
            break;

          case 'transcript.add':
            // Add transcript entry to the pane
            addTranscript(
              msg.speaker || 'system',
              msg.original || '',
              msg.translated || '',
              msg.confidence
            );
            break;

          case 'audio.interrupted':
            // Barge-in: flush the playback queue
            if (audioEngineRef.current) {
              audioEngineRef.current.flushPlayback();
            }
            break;

          default:
            console.log('[ClinBridge] Unknown message:', msg);
        }
      } catch (err) {
        console.error('[ClinBridge] Failed to parse message:', err);
      }
    },
    [addTranscript]
  );

  // --- Start Session ---
  const handleStart = useCallback(async () => {
    setStatus('connecting');
    setSessionTime(0);
    setTranscripts([]);
    setStatusMessage('');

    try {
      // 1. Open the WebSocket to backend
      const ws = new WebSocket('ws://localhost:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        // 2. Send session.start with language preferences
        ws.send(JSON.stringify({
          type: 'session.start',
          clinicianLang,
          patientLang,
        }));
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (err) => {
        console.error('[ClinBridge] WebSocket error:', err);
        setStatus('error');
        setStatusMessage('WebSocket connection failed. Is the backend running?');
      };

      ws.onclose = () => {
        setStatus('disconnected');
      };

      // 3. Start mic capture via AudioEngine
      const engine = new AudioEngine();
      audioEngineRef.current = engine;

      // 4. Start mic capture
      await engine.startCapture((base64, sampleRate) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio.chunk',
            data: base64,
            sampleRate: sampleRate
          }));
        }
      });
    } catch (err) {
      console.error('[ClinBridge] Start error:', err);
      setStatus('error');
      setStatusMessage(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied. Please allow mic access and try again.'
          : `Failed to start: ${err}`
      );
    }
  }, [clinicianLang, patientLang, handleWsMessage]);

  // --- Stop Session ---
  const handleStop = useCallback(() => {
    // Send session.end to backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'session.end' }));
      wsRef.current.close();
    }
    wsRef.current = null;

    // Stop audio engine
    if (audioEngineRef.current) {
      audioEngineRef.current.destroy();
      audioEngineRef.current = null;
    }

    setStatus('idle');
    setStatusMessage('');
  }, []);

  // --- Image capture handler ---
  const handleImageCapture = useCallback(
    (base64: string, mimeType: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'image.send',
          data: base64,
          mimeType,
        }));
        addTranscript('document', 'Document image sent for relay...', 'Relaying visible text...');
      }
    },
    [addTranscript]
  );

  // --- Copy transcript ---
  const handleCopyTranscript = useCallback(() => {
    const text = transcripts
      .map((e) => `[${e.speaker.toUpperCase()}] ${e.original} → ${e.translated}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  }, [transcripts]);

  // --- Download transcript ---
  const handleDownloadTranscript = useCallback(() => {
    const text = transcripts
      .map(
        (e) =>
          `[${e.timestamp.toLocaleTimeString()}] [${e.speaker.toUpperCase()}]\nOriginal: ${e.original}\nTranslated: ${e.translated}\n`
      )
      .join('\n---\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clinbridge-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcripts]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (audioEngineRef.current) audioEngineRef.current.destroy();
    };
  }, []);

  const isActive = status === 'connected' || status === 'connecting';

  return (
    <div className="clinbridge-app">
      <SafetyBanner />

      <header className="app-header">
        <div className="logo-area">
          <div className="logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1>ClinBridge</h1>
          <span className="tagline">Real-Time Clinical Communication Relay</span>
        </div>
        {statusMessage && (
          <div className={`header-status ${status === 'error' ? 'error' : ''}`}>
            {statusMessage}
          </div>
        )}
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <SessionControls
            clinicianLang={clinicianLang}
            patientLang={patientLang}
            onClinicianLangChange={setClinicianLang}
            onPatientLangChange={setPatientLang}
            status={status}
            onStart={handleStart}
            onStop={handleStop}
            sessionTime={sessionTime}
          />

          <ImageCapture
            onImageCapture={handleImageCapture}
            disabled={!isActive}
            isDocumentMode={isDocumentMode}
            onToggleDocumentMode={() => setIsDocumentMode((v) => !v)}
          />
        </aside>

        <section className="content-area">
          <TranscriptPane
            entries={transcripts}
            onCopy={handleCopyTranscript}
            onDownload={handleDownloadTranscript}
          />
        </section>
      </main>

      <footer className="app-footer">
        <p>ClinBridge is a communication relay. The clinician remains the decision maker.</p>
        <p className="powered-by">Powered by Gemini Live API</p>
      </footer>
    </div>
  );
}
