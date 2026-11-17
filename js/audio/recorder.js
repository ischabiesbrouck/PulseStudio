// Microfoonopname met MediaRecorder. De opname wordt na afloop gedecodeerd tot een AudioBuffer.
export class MicRecorder {
  constructor() {
    this.stream = null;
    this.rec = null;
    this.chunks = [];
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Deze browser ondersteunt geen microfoonopname.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start();
  }

  // Geeft de opname als Blob terug (of null als er niet werd opgenomen).
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => {
        for (const t of this.stream.getTracks()) t.stop();
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        this.rec = null;
        this.stream = null;
        resolve(blob.size ? blob : null);
      };
      this.rec.stop();
    });
  }

  get active() { return !!this.rec; }
}
