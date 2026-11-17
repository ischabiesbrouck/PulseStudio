// WAV-encoder (16-bit PCM). Neemt een lijst Float32Array-kanalen en geeft een ArrayBuffer terug.
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0]?.length || 0;
  const blockAlign = numCh * 2;
  const dataSize = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

// Piekwaarden per blok, om een golfvorm te tekenen.
export function computePeaks(channels, buckets = 1200) {
  const len = channels[0]?.length || 0;
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(len / buckets));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const end = Math.min(len, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      for (const ch of channels) { const a = Math.abs(ch[i]); if (a > max) max = a; }
    }
    peaks[b] = max;
  }
  return peaks;
}
