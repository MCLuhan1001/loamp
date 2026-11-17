/*
 * LoAmp – Pegelmessung im Audio-Thread (AudioWorklet)
 *
 *  VU   : Mittelwert der gleichgerichteten Signals (Faktor 1,1107 → Sinus zeigt Effektivwert),
 *         Zeigerballistik nach ANSI C16.5 / IEC 60268-17: 99 % nach 300 ms, ~1,5 % Überschwingen.
 *         Modelliert als System 2. Ordnung (ζ = 0,8, ωn = 13,1 rad/s).
 *  TP   : True-Peak nach ITU-R BS.1770 – 4-fach überabgetastet (Polyphasen-FIR, 49 Taps).
 *
 * Meldet ca. alle 512 Samples: { vu:[L,R], tp:[L,R] (linear, Maximum seit letzter Meldung), n }
 * Mono-Eingänge werden auf beide Kanäle gespiegelt.
 */
const VU_OMEGA = 13.1;
const VU_ZETA = 0.8;
const VU_AVG_TO_RMS = 1.1107;
const REPORT_FRAMES = 512;

const OS = 4;                 // Überabtastung
const TAPS = 49;              // Filterlänge (ungerade, Mitte bei 24)
const HIST = 12;              // Historie in Samples (max. 13 Taps je Phase)

/** Polyphasen-Koeffizienten eines Hann-gefensterten Sinc-Interpolators. */
function makePhases() {
  const c = (TAPS - 1) / 2;
  const h = [];
  for (let m = 0; m < TAPS; m++) {
    const x = (m - c) / OS;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * m) / (TAPS - 1));
    h.push(sinc * win);
  }
  const phases = [];
  for (let p = 0; p < OS; p++) {
    const g = [];
    for (let j = 0; OS * j + p < TAPS; j++) g.push(h[OS * j + p]);
    const sum = g.reduce((a, b) => a + b, 0);
    phases.push(Float32Array.from(g.map((v) => v / sum)));   // DC-Verstärkung 1
  }
  return phases;
}
const PHASES = makePhases();

class LoAmpMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = [0, 0];                       // VU-Anzeige
    this.v = [0, 0];                       // Zeigergeschwindigkeit
    this.tp = [0, 0];                      // True-Peak seit letzter Meldung
    this.seen = [false, false];            // Ob L / R je echtes Signal geführt haben
    this.ext = [new Float32Array(HIST + 128), new Float32Array(HIST + 128)];
    this.frames = 0;
    this.quiet = true;
    this.port.onmessage = () => { this.seen = [false, false]; };
  }

  process(inputs) {
    const inp = inputs[0] || [];
    const n = (inp[0] && inp[0].length) || 128;
    const dt = n / sampleRate;
    if (this.ext[0].length !== HIST + n) this.ext = [new Float32Array(HIST + n), new Float32Array(HIST + n)];

    for (let c = 0; c < 2; c++) {
      const ch = inp[c];
      if (!ch || this.seen[c]) continue;
      for (let i = 0; i < n; i++) {
        if (ch[i] > 1e-4 || ch[i] < -1e-4) { this.seen[c] = true; break; }
      }
    }

    for (let c = 0; c < 2; c++) {
      // Mono oder stummer rechter Kanal (z. B. Spur-1-Aufnahme) → auf R spiegeln bis R Signal führt
      const src = (c === 1 && !this.seen[1] && this.seen[0]) ? inp[0] : (inp[c] || inp[0]);
      const ext = this.ext[c];
      ext.copyWithin(0, n, n + HIST);       // Historie nach vorne
      let sum = 0, peak = 0;
      for (let i = 0; i < n; i++) {
        const s = src ? src[i] : 0;
        ext[HIST + i] = s;
        sum += s < 0 ? -s : s;
      }
      for (let i = 0; i < n; i++) {
        const idx = HIST + i;
        for (let p = 0; p < OS; p++) {
          const g = PHASES[p];
          let y = 0;
          for (let j = 0; j < g.length; j++) y += g[j] * ext[idx - j];
          if (y < 0) y = -y;
          if (y > peak) peak = y;
        }
      }
      if (peak > this.tp[c]) this.tp[c] = peak;

      // VU-Ballistik (System 2. Ordnung)
      const u = (VU_AVG_TO_RMS * sum) / n;
      let x = this.x[c], v = this.v[c];
      const a = VU_OMEGA * VU_OMEGA * (u - x) - 2 * VU_ZETA * VU_OMEGA * v;
      v += a * dt;
      x += v * dt;
      if (x < 0) { x = 0; v = 0; }
      if (u === 0 && x < 1e-7) { x = 0; v = 0; }
      this.x[c] = x; this.v[c] = v;
    }

    this.frames += n;
    if (this.frames >= REPORT_FRAMES) {
      const silent = this.x[0] === 0 && this.x[1] === 0 && this.tp[0] === 0 && this.tp[1] === 0;
      if (!(silent && this.quiet)) {
        this.port.postMessage({ vu: [this.x[0], this.x[1]], tp: [this.tp[0], this.tp[1]], n: this.frames });
      }
      this.quiet = silent;
      this.tp[0] = this.tp[1] = 0;
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor('loamp-meter', LoAmpMeter);
