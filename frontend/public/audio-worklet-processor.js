/**
 * AudioWorklet Processor for ClinBridge
 * 
 * Runs in the audio rendering thread. Captures Float32 audio samples
 * from the microphone, converts them to Int16 PCM, and sends them
 * to the main thread in chunks (~100ms worth of samples).
 * 
 * Audio format: 16-bit PCM, mono, 16kHz
 * This is the format expected by the Gemini Live API.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer to accumulate samples before sending a chunk
    // At 16kHz, 1600 samples = 100ms of audio
    this._buffer = new Int16Array(1600);
    this._bufferIndex = 0;
  }

  /**
   * Called by the AudioWorklet framework for each 128-sample block.
   * Converts Float32 [-1.0, 1.0] → Int16 [-32768, 32767]
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array, mono channel

    for (let i = 0; i < samples.length; i++) {
      // Clamp and convert Float32 to Int16
      const s = Math.max(-1, Math.min(1, samples[i]));
      this._buffer[this._bufferIndex++] = Math.floor(s * 32767);

      // When buffer is full (~100ms), send the chunk to the main thread
      if (this._bufferIndex >= this._buffer.length) {
        // Post a copy of the buffer so we can reuse the original
        this.port.postMessage({
          type: 'pcm-chunk',
          data: this._buffer.slice().buffer,
        }, [this._buffer.slice().buffer]);
        this._bufferIndex = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
