/**
 * AudioEngine — handles mic capture and audio playback for ClinBridge.
 *
 * Mic capture pipeline:
 *   getUserMedia → AudioContext (16kHz) → AudioWorklet (Float32→Int16) → base64 chunks → WebSocket
 *
 * Playback pipeline:
 *   WebSocket → base64 PCM16 24kHz → Int16→Float32 → AudioBuffer → sequential queue playback
 *
 * Barge-in:
 *   On audio.interrupted → flush the playback queue and stop current source
 */

// Convert an Int16 PCM ArrayBuffer to a base64 string
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert a base64 string to an ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert Int16 PCM data to Float32 for Web Audio API playback.
 * Gemini outputs 24kHz 16-bit PCM.
 */
function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32 = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32[i] = int16Array[i] / 32768.0;
  }
  return float32;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private playbackContext: AudioContext | null = null;
  private playbackQueue: AudioBuffer[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private onAudioChunk: ((base64: string) => void) | null = null;

  /**
   * Start capturing audio from the microphone.
   * Sends PCM16 chunks via the onChunk callback as base64 strings.
   */
  async startCapture(onChunk: (base64: string) => void): Promise<void> {
    this.onAudioChunk = onChunk;

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Create AudioContext at 16kHz for Gemini input format
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Load the AudioWorklet processor
    await this.audioContext.audioWorklet.addModule('/audio-worklet-processor.js');

    // Create the worklet node and connect the mic to it
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

    // Listen for PCM chunks from the worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'pcm-chunk' && this.onAudioChunk) {
        const base64 = arrayBufferToBase64(event.data.data);
        this.onAudioChunk(base64);
      }
    };

    source.connect(this.workletNode);
    // Don't connect to destination — we don't want to hear our own mic
    this.workletNode.connect(this.audioContext.destination);
  }

  /**
   * Stop capturing audio from the microphone.
   */
  stopCapture(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.onAudioChunk = null;
  }

  /**
   * Queue a PCM16 audio chunk (base64, 24kHz) for playback.
   * Chunks are played sequentially to maintain temporal order.
   */
  async playAudio(base64Pcm: string): Promise<void> {
    // Create playback context on first use (24kHz for Gemini output)
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext({ sampleRate: 24000 });
    }

    // Decode base64 → Int16 → Float32 → AudioBuffer
    const arrayBuffer = base64ToArrayBuffer(base64Pcm);
    const int16 = new Int16Array(arrayBuffer);
    const float32 = int16ToFloat32(int16);

    const audioBuffer = this.playbackContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    // Add to the queue and start playing if not already
    this.playbackQueue.push(audioBuffer);
    if (!this.isPlaying) {
      this._playNext();
    }
  }

  /**
   * Play the next buffer in the queue sequentially.
   */
  private _playNext(): void {
    if (!this.playbackContext || this.playbackQueue.length === 0) {
      this.isPlaying = false;
      this.currentSource = null;
      return;
    }

    this.isPlaying = true;
    const buffer = this.playbackQueue.shift()!;
    const source = this.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackContext.destination);

    this.currentSource = source;

    source.onended = () => {
      this._playNext();
    };

    source.start();
  }

  /**
   * Flush the playback queue immediately (barge-in / interruption).
   * Stops any currently playing audio and clears the queue.
   */
  flushPlayback(): void {
    this.playbackQueue = [];
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Source may have already stopped
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
  }

  /**
   * Full cleanup — stop capture and playback.
   */
  destroy(): void {
    this.stopCapture();
    this.flushPlayback();
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
  }
}
