'use client';

import React, { useRef, useEffect } from 'react';

export interface TranscriptEntry {
  id: string;
  speaker: 'clinician' | 'patient' | 'system' | 'document' | 'relay';
  text: string;
  confidence?: 'clear' | 'uncertain' | 'partial';
  timestamp: Date;
}

interface TranscriptPaneProps {
  entries: TranscriptEntry[];
  onCopy: () => void;
  onDownload: () => void;
}

/**
 * TranscriptPane — displays the bilingual transcript with speaker labels.
 * Auto-scrolls to the latest entry.
 */
export default function TranscriptPane({ entries, onCopy, onDownload }: TranscriptPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const speakerIcon = (speaker: string) => {
    if (speaker === 'clinician') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    }
    if (speaker === 'patient') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    }
    if (speaker === 'document') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    }
    // system / relay
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  };

  return (
    <div className="transcript-pane">
      <div className="transcript-header">
        <h2>Live Transcript</h2>
        <div className="transcript-actions">
          <button onClick={onCopy} className="action-btn" title="Copy transcript">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button onClick={onDownload} className="action-btn" title="Download transcript">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="transcript-list">
        {entries.length === 0 ? (
          <div className="transcript-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>Start a session to see the live transcript</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`transcript-entry speaker-${entry.speaker}`}>
              <div className="entry-header">
                <span className={`speaker-badge badge-${entry.speaker}`}>
                  {speakerIcon(entry.speaker)}
                  {entry.speaker.charAt(0).toUpperCase() + entry.speaker.slice(1)}
                </span>
                <span className="entry-time">
                  {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {entry.confidence && entry.confidence !== 'clear' && (
                  <span className={`confidence-badge confidence-${entry.confidence}`}>
                    {entry.confidence === 'uncertain' ? '⚠ Some words may be unclear' : '⚠ Partially unreadable'}
                  </span>
                )}
              </div>
              <div className="entry-content">
                <p className="entry-text">{entry.text}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
