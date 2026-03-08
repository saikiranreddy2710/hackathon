'use client';

import React, { useRef, useState, useCallback } from 'react';

interface ImageCaptureProps {
  onImageCapture: (base64: string, mimeType: string) => void;
  disabled: boolean;
  isDocumentMode: boolean;
  onToggleDocumentMode: () => void;
}

/**
 * ImageCapture — upload a file or capture a camera snapshot for document relay.
 * In document relay mode, images are sent to Gemini Live for visible text translation.
 */
export default function ImageCapture({
  onImageCapture,
  disabled,
  isDocumentMode,
  onToggleDocumentMode,
}: ImageCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'camera'>('upload');

  // Handle file upload
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Show preview
        setPreview(dataUrl);
        // Extract base64 (remove data:image/...;base64, prefix)
        const base64 = dataUrl.split(',')[1];
        const mimeType = file.type || 'image/jpeg';
        onImageCapture(base64, mimeType);
      };
      reader.readAsDataURL(file);

      // Reset the file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onImageCapture]
  );

  // Start camera preview
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 },
      });
      setCameraStream(stream);
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access denied:', err);
    }
  }, []);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
  }, [cameraStream]);

  // Capture a snapshot from the camera
  const captureSnapshot = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setPreview(dataUrl);

    const base64 = dataUrl.split(',')[1];
    onImageCapture(base64, 'image/jpeg');

    // Stop camera after capture
    stopCamera();
  }, [onImageCapture, stopCamera]);

  return (
    <div className="image-capture">
      <div className="image-capture-header">
        <h2>Document Relay</h2>
        <button
          className={`doc-mode-toggle ${isDocumentMode ? 'active' : ''}`}
          onClick={onToggleDocumentMode}
          disabled={disabled}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          {isDocumentMode ? 'Document Mode ON' : 'Document Mode OFF'}
        </button>
      </div>

      {isDocumentMode && (
        <div className="image-capture-body">
          <div className="tab-bar">
            <button
              className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => { setActiveTab('upload'); stopCamera(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload File
            </button>
            <button
              className={`tab ${activeTab === 'camera' ? 'active' : ''}`}
              onClick={() => { setActiveTab('camera'); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Camera
            </button>
          </div>

          {activeTab === 'upload' && (
            <div className="upload-area">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="file-input"
                id="doc-upload"
                disabled={disabled}
              />
              <label htmlFor="doc-upload" className="upload-label">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Click or drag to upload</span>
                <span className="upload-hint">Medication labels, forms, discharge papers</span>
              </label>
            </div>
          )}

          {activeTab === 'camera' && (
            <div className="camera-area">
              {!cameraActive ? (
                <button onClick={startCamera} className="camera-start-btn" disabled={disabled}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Open Camera
                </button>
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
                  <button onClick={captureSnapshot} className="capture-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    Capture
                  </button>
                </>
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
          )}

          {preview && (
            <div className="image-preview">
              <img src={preview} alt="Captured document" />
              <p className="preview-status">✓ Image sent for translation relay</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
