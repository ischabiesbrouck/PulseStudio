// WAV-encoder (PCM, 16 of 24 bit). Neemt een lijst Float32Array-kanalen en geeft een ArrayBuffer terug.
// Bij 16 bit wordt er gedithered (TPDF), zodat zachte passages niet korrelig klinken.
export function encodeWav(channels, sampleRate, bits = 16) {
  const numCh = channels.length;
  const len = channels[0]?.length || 0;
  const bytes = bits === 24 ? 3 : 2;
  const blockAlign = numCh * bytes;
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
  v.setUint16(34, bits === 24 ? 24 : 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const x = channels[c][i];
      if (bytes === 3) {
        const s = Math.round(Math.max(-1, Math.min(1, x)) * 8388607);
        v.setUint8(o, s & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, (s >> 16) & 0xff);
        o += 3;
      } else {
        // Digitale stilte en volle uitsturing blijven exact; daartussen TPDF-dither van ±1 LSB.
        const c1 = Math.max(-1, Math.min(1, x));
        const d = x !== 0 && Math.abs(c1) < 0.9999 ? rnd() - rnd() : 0;
        const s = Math.round(c1 * (c1 < 0 ? 32768 : 32767) + d);
        v.setInt16(o, Math.max(-32768, Math.min(32767, s)), true);
        o += 2;
      }
    }
  }
  return buf;
}

// ---------- ZIP (zonder compressie), voor het exporteren van stems ----------

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: ArrayBuffer | Uint8Array }] → Blob (application/zip)
export function zipFiles(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head.buffer, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
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
