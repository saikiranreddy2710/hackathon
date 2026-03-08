'use client';

import React from 'react';

/** Supported languages for ClinBridge */
const LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'es-US', label: 'Spanish' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'zh-CN', label: 'Mandarin' },
  { code: 'fr-FR', label: 'French' },
  { code: 'ar-SA', label: 'Arabic' },
];

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

interface SessionControlsProps {
  clinicianLang: string;
  patientLang: string;
  onClinicianLangChange: (lang: string) => void;
  onPatientLangChange: (lang: string) => void;
  status: SessionStatus;
  onStart: () => void;
  onStop: () => void;
  sessionTime: number; // seconds
}

/**
 * SessionControls — start/stop session, language selectors, status indicator.
 */
export default function SessionControls({
  clinicianLang,
  patientLang,
  onClinicianLangChange,
  onPatientLangChange,
  status,
  onStart,
  onStop,
  sessionTime,
}: SessionControlsProps) {
  const isActive = status === 'connected' || status === 'connecting';

  // Format session timer as MM:SS
  const minutes = Math.floor(sessionTime / 60).toString().padStart(2, '0');
  const seconds = (sessionTime % 60).toString().padStart(2, '0');

  return (
    <div className="session-controls">
      <div className="controls-header">
        <h2>Session Controls</h2>
        {isActive && (
          <div className="session-timer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {minutes}:{seconds}
          </div>
        )}
      </div>

      <div className="language-selectors">
        <div className="lang-group">
          <label htmlFor="clinician-lang">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Clinician
          </label>
          <select
            id="clinician-lang"
            value={clinicianLang}
            onChange={(e) => onClinicianLangChange(e.target.value)}
            disabled={isActive}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="lang-swap-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </div>

        <div className="lang-group">
          <label htmlFor="patient-lang">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Patient
          </label>
          <select
            id="patient-lang"
            value={patientLang}
            onChange={(e) => onPatientLangChange(e.target.value)}
            disabled={isActive}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        className={`session-btn ${isActive ? 'stop' : 'start'}`}
        onClick={isActive ? onStop : onStart}
      >
        {status === 'connecting' ? (
          <>
            <span className="spinner" />
            Connecting...
          </>
        ) : isActive ? (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            End Session
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Start Session
          </>
        )}
      </button>

      <div className={`status-badge status-${status}`}>
        <span className="status-dot" />
        {status === 'idle' && 'Ready'}
        {status === 'connecting' && 'Connecting...'}
        {status === 'connected' && 'Listening'}
        {status === 'error' && 'Error'}
        {status === 'disconnected' && 'Disconnected'}
      </div>
    </div>
  );
}
