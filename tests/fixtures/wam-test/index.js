// Test-plug-in met de WAM 2.0-interface, om de host in PulseStudio te testen zonder externe code.
// index.js?instrument maakt er een simpel instrument van (sinus per MIDI-noot), anders is het een gain-effect.
const instrument = import.meta.url.includes('instrument');

export default class TestWam {
  static async createInstance(groupId, audioContext, initialState) {
    const wam = new TestWam(groupId, audioContext);
    await wam.initialize(initialState);
    return wam;
  }

  constructor(groupId, audioContext) {
    this.groupId = groupId;
    this.audioContext = audioContext;
    this.descriptor = { name: instrument ? 'Testsynth' : 'Testgain', vendor: 'PulseStudio', isInstrument: instrument };
  }

  async initialize(state) {
    const ctx = this.audioContext;
    const node = ctx.createGain();
    const values = { gain: 0.5 };
    const voices = new Map();
    node.gain.value = values.gain;
    node.getParameterInfo = async () => ({ gain: { id: 'gain', label: 'Gain', type: 'float', minValue: 0, maxValue: 2, defaultValue: 0.5, valueString: (v) => `${Math.round(v * 100)}%` } });
    node.getParameterValues = async () => ({ gain: { id: 'gain', value: values.gain, normalized: false } });
    node.setParameterValues = async (p) => { if (p.gain) { values.gain = p.gain.value; node.gain.setTargetAtTime(values.gain, ctx.currentTime, 0.01); } };
    node.getState = async () => ({ ...values });
    node.setState = async (s) => { if (s?.gain != null) node.setParameterValues({ gain: { value: s.gain } }); };
    node.scheduleEvents = (...events) => {
      if (!instrument) return;
      for (const e of events) {
        if (e.type !== 'wam-midi') continue;
        const [st, p, v] = e.data.bytes;
        const t = Math.max(ctx.currentTime, e.time ?? ctx.currentTime);
        const cmd = st & 0xf0;
        if (cmd === 0x90 && v > 0) {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.value = 440 * 2 ** ((p - 69) / 12);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v / 127, t + 0.005);
          o.connect(g).connect(node); o.start(t);
          if (!voices.has(p)) voices.set(p, []);
          voices.get(p).push({ o, g });
        } else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) {
          const v0 = voices.get(p)?.shift();
          if (v0) { v0.g.gain.setTargetAtTime(0, t, 0.02); v0.o.stop(t + 0.2); }
        } else if (cmd === 0xb0 && (p === 123 || p === 120)) {
          for (const list of voices.values()) for (const x of list) { x.g.gain.setTargetAtTime(0, t, 0.01); x.o.stop(t + 0.1); }
          voices.clear();
        }
      }
    };
    node.destroy = () => node.disconnect();
    this.audioNode = node;
    if (state) await node.setState(state);
  }

  async createGui() {
    const el = document.createElement('div');
    el.style.cssText = 'padding:10px;font:13px sans-serif;color:#eee;display:grid;gap:6px;width:200px';
    const s = document.createElement('input');
    s.type = 'range'; s.min = 0; s.max = 2; s.step = 0.01;
    s.value = (await this.audioNode.getState()).gain;
    s.oninput = () => this.audioNode.setParameterValues({ gain: { id: 'gain', value: +s.value } });
    el.append(`${this.descriptor.name}: eigen interface`, s);
    el.dataset.testGui = '1';
    return el;
  }

  destroyGui(el) { el.remove(); }
}
