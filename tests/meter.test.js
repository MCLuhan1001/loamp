// Tests für meter-worklet.js (läuft ohne Browser):  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SR = 48000;
const BLOCK = 128;

function loadProcessor() {
  let Ctor;
  const sandbox = {
    sampleRate: SR, Math, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { messages: [], postMessage(m) { this.messages.push(m); } }; } },
    registerProcessor: (_name, c) => { Ctor = c; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'meter-worklet.js'), 'utf8'), sandbox);
  return new Ctor();
}

/** Speist `fn(i)` (Samplewert je Kanal) für `seconds` ein und liefert Verlauf der VU-Werte. */
function run(proc, seconds, fnL, fnR = fnL, channels = 2) {
  const total = Math.round(seconds * SR);
  const trace = [];
  for (let s = 0; s < total; s += BLOCK) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) { l[i] = fnL(s + i); r[i] = fnR(s + i); }
    proc.process([channels === 1 ? [l] : [l, r]], [[new Float32Array(BLOCK)]]);
    trace.push({ t: (s + BLOCK) / SR, l: proc.x[0], r: proc.x[1] });
  }
  return trace;
}

test('Sinus zeigt Effektivwert (VU-Kalibrierung)', () => {
  const p = loadProcessor();
  const A = 0.5;
  const tr = run(p, 2, (i) => A * Math.sin((2 * Math.PI * 1000 * i) / SR));
  const last = tr[tr.length - 1];
  assert.ok(Math.abs(last.l - A / Math.SQRT2) / (A / Math.SQRT2) < 0.01, `L=${last.l}`);
  assert.ok(Math.abs(last.r - last.l) < 1e-6);
});

test('Ballistik: 99 % nach ~300 ms, Überschwingen ~1–2 %', () => {
  const p = loadProcessor();
  const dc = 0.5;
  const target = 1.1107 * dc;
  const tr = run(p, 1.2, () => dc);
  const t99 = tr.find((e) => e.l >= 0.99 * target).t;
  assert.ok(t99 > 0.27 && t99 < 0.33, `t99=${t99}`);
  const overshoot = Math.max(...tr.map((e) => e.l)) / target - 1;
  assert.ok(overshoot > 0.005 && overshoot < 0.025, `overshoot=${overshoot}`);
});

test('Mono-Eingang erscheint auf beiden Kanälen (Regression: rechter Zeiger)', () => {
  const p = loadProcessor();
  const tr = run(p, 1, () => 0.4, () => 0.4, 1);
  const last = tr[tr.length - 1];
  assert.ok(last.l > 0.3);
  assert.equal(last.l, last.r);
});

test('Kanäle sind unabhängig (Stereo)', () => {
  const p = loadProcessor();
  const tr = run(p, 1, () => 0.5, () => 0.05);
  const last = tr[tr.length - 1];
  assert.ok(last.l > 8 * last.r);
});

test('True-Peak erkennt Zwischenabtastwerte-Spitzen (fs/4, 45°)', () => {
  const p = loadProcessor();
  // Samples: ±0,7071, True-Peak des Signals = 1,0
  run(p, 0.5, (i) => Math.sin((2 * Math.PI * (SR / 4) * i) / SR + Math.PI / 4));
  const peaks = p.port.messages.slice(5).flatMap((m) => m.tp);
  const tp = Math.max(...peaks);
  assert.ok(tp > 0.97 && tp < 1.03, `TP=${tp}`);
  assert.ok(tp > 0.7071 * 1.35, 'True-Peak muss deutlich über Sample-Peak liegen');
});

test('Stille meldet nichts und setzt VU auf 0', () => {
  const p = loadProcessor();
  run(p, 0.5, () => 0.5);
  run(p, 3, () => 0);
  assert.equal(p.x[0], 0);
  const before = p.port.messages.length;
  run(p, 1, () => 0);
  assert.equal(p.port.messages.length, before);
});

test('Zweikanal-Signal mit stummem rechtem Kanal spiegelt L auf R bis R Signal führt', () => {
  const p = loadProcessor();
  // Zwei Kanäle, aber R ist komplett stumm → L wird auf R gespiegelt
  const tr1 = run(p, 0.8, () => 0.4, () => 0, 2);
  const last1 = tr1[tr1.length - 1];
  assert.ok(last1.l > 0.3);
  assert.equal(last1.l, last1.r);

  // Sobald R eigenes Signal führt, messen beide Kanäle unabhängig
  const tr2 = run(p, 1.2, () => 0.5, () => 0.05, 2);
  const last2 = tr2[tr2.length - 1];
  assert.ok(last2.l > 8 * last2.r, `L=${last2.l} R=${last2.r}`);

  // Nach Track-Reset ('reset') wird ein stummer R-Kanal wieder von L gespiegelt
  p.port.onmessage({ data: 'reset' });
  const tr3 = run(p, 0.8, () => 0.4, () => 0, 2);
  const last3 = tr3[tr3.length - 1];
  assert.ok(last3.r > 0.3 && Math.abs(last3.l - last3.r) < 1e-3, `L=${last3.l} R=${last3.r}`);
});
