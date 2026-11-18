'use strict';
/* LoAmp – Audioplayer mit normgerechter Pegelanzeige (VU + True-Peak, siehe meter-worklet.js) */

const $ = (s) => document.querySelector(s);
const amp = $('#amp');
const audio = new Audio();
audio.preload = 'auto';

const EXT = /\.(mp3|m4a|m4b|aac|wav|wave|flac|ogg|oga|opus|aif|aiff|aifc|caf|weba)$/i;
const isAudio = (f) => (f.type && f.type.startsWith('audio/')) || EXT.test(f.name);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => {
  if (!isFinite(s)) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/* ---------- Zustand ---------- */
const tracks = [];          // {id,file,name,url,duration,bad}
let order = [];             // Abspielreihenfolge (Track-IDs)
let curId = null;
let uid = 0;
let failStreak = 0;

let saved = {};
try { saved = JSON.parse(localStorage.getItem('loamp.v1') || '{}') || {}; } catch { saved = {}; }
const REFS = [-18, -20, -14];            // Bezugspegel 0 VU in dBFS: EBU R68, SMPTE RP155, „Musik“
let vol = typeof saved.vol === 'number' ? clamp(saved.vol, 0, 1) : 0.7;
let shuffle = !!saved.shuffle;
let repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
let refDb = REFS.includes(saved.refDb) ? saved.refDb : -18;
const persist = () => {
  try { localStorage.setItem('loamp.v1', JSON.stringify({ vol, shuffle, repeat, refDb })); } catch { /* voll/blockiert */ }
};

/* ---------- Elemente ---------- */
const el = {
  title: $('#title'), time: $('#time'), pos: $('#pos'), seek: $('#seek'), peak: $('#peak'),
  play: $('#play'), stop: $('#stop'), prev: $('#prev'), next: $('#next'), rew: $('#rew'), ffw: $('#ffw'),
  shuffle: $('#shuffle'), repeat: $('#repeat'), repeatLbl: $('#repeatLbl'), ref: $('#ref'), refLbl: $('#refLbl'),
  volume: $('#volume'), volOut: $('#volOut'),
  list: $('#list'), empty: $('#empty'), count: $('#count'), toast: $('#toast'),
  filePicker: $('#filePicker'), folderPicker: $('#folderPicker'),
};

/* ---------- Web Audio ----------
 * Signalweg:  Datei → Quelle ─┬→ Lautstärke (Gain) → Ausgang
 *                             └→ Pegelmesser (AudioWorklet, VOR dem Lautstärkeregler = Programmpegel)
 */
let actx = null, gain = null, meterNode = null;

function ensureAudioGraph() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  actx = new AC();
  const src = actx.createMediaElementSource(audio);
  gain = actx.createGain();
  src.connect(gain);
  gain.connect(actx.destination);
  applyVolume();
  initMeter(actx, src).catch(() => toast('Pegelanzeige nicht verfügbar'));
}

/** Erzeugt den Worklet-Pegelmesser und hängt ihn an `source`. */
async function initMeter(ctx, source) {
  await ctx.audioWorklet.addModule('meter-worklet.js');
  const node = new AudioWorkletNode(ctx, 'loamp-meter', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', // Mono → L=R
  });
  node.port.onmessage = (e) => onMeter(e.data, ctx.sampleRate);
  source.connect(node);
  node.connect(ctx.destination);        // Ausgang ist stumm, hält den Knoten aber aktiv
  meterNode = node;
  return node;
}

const applyVolume = () => { if (gain) gain.gain.setTargetAtTime(vol * vol, actx.currentTime, 0.02); };

// Browser starten den AudioContext nur nach Nutzeraktion – bei jeder Geste nachholen
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => {
  if (actx && actx.state === 'suspended') actx.resume();
}, { capture: true }));

/* ---------- Wiedergabe ---------- */
const byId = (id) => tracks.find((t) => t.id === id);
const cur = () => byId(curId);

function rebuildOrder() {
  const ids = tracks.map((t) => t.id);
  if (!shuffle) { order = ids; return; }
  const rest = ids.filter((i) => i !== curId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  order = ids.includes(curId) ? [curId, ...rest] : rest;
}

function load(t, autoplay) {
  curId = t.id;
  audio.src = t.url;
  audio.load();
  resetPeak();
  renderList();
  updateInfo();
  setMediaSession(t);
  if (autoplay) startPlayback();
}

function startPlayback() {
  ensureAudioGraph();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  audio.play().catch((e) => {
    // AbortError: neuer Titel hat den alten unterbrochen. Decodierfehler meldet das error-Ereignis.
    if (e.name === 'NotAllowedError') toast('Zum Starten bitte ins Fenster klicken');
  });
}

function togglePlay() {
  if (!tracks.length) { el.filePicker.click(); return; }
  if (!cur()) { rebuildOrder(); load(byId(order[0]), true); return; }
  if (audio.paused) {
    if (audio.ended) audio.currentTime = 0;
    startPlayback();
  } else audio.pause();
}

function stop() {
  audio.pause();
  if (cur()) audio.currentTime = 0;
  syncSeek(true);
}

function step(dir, auto = false) {
  if (!tracks.length) return;
  const pos = order.indexOf(curId);
  let np = pos + dir;
  if (np >= order.length) {
    if (auto && repeat !== 'all') {           // Ende der Liste erreicht
      audio.pause();
      load(byId(order[0]), false);
      return;
    }
    if (shuffle) { rebuildOrder(); np = order.length > 1 ? 1 : 0; } else np = 0;
  } else if (np < 0) np = order.length - 1;
  load(byId(order[np]), auto || !audio.paused);
}

function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  step(-1);
}

function seekBy(sec) {
  if (!cur() || !isFinite(audio.duration)) return;
  audio.currentTime = clamp(audio.currentTime + sec, 0, audio.duration);
}

function onTrackError() {
  const t = cur();
  // Ohne src-Attribut (Liste geleert) meldet Chrome ebenfalls einen Fehler – ignorieren
  if (!t || !audio.getAttribute('src')) return;
  t.bad = true;
  failStreak++;
  renderList();
  toast(`Nicht abspielbar: ${t.name}`);
  if (failStreak < tracks.length) step(1, true);
  else { audio.pause(); failStreak = 0; }
}

audio.addEventListener('error', onTrackError);
audio.addEventListener('playing', () => { failStreak = 0; });
audio.addEventListener('play', () => setPlaying(true));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('ended', () => {
  if (repeat === 'one') { audio.currentTime = 0; startPlayback(); }
  else step(1, true);
});
audio.addEventListener('loadedmetadata', () => {
  const t = cur();
  if (t && isFinite(audio.duration)) { t.duration = audio.duration; updateDuration(t); }
  el.seek.disabled = false;
});

function setPlaying(p) {
  amp.classList.toggle('is-playing', p);
  el.play.setAttribute('aria-label', p ? 'Pause' : 'Wiedergabe');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
  updateInfo();
  kick();
}

/* ---------- Anzeige ---------- */
function updateInfo() {
  const t = cur();
  const name = t ? t.name : 'Kein Titel geladen';
  el.title.textContent = name;
  el.title.title = name;
  const i = t ? order.indexOf(t.id) + 1 : 0;
  el.pos.textContent = t ? `${String(i).padStart(2, '0')} / ${String(tracks.length).padStart(2, '0')}` : '-- / --';
  document.title = t ? `${audio.paused ? '' : '▶ '}${name} – LoAmp` : 'LoAmp';
  el.count.textContent = `${tracks.length} Titel`;
}

let scrubbing = false, lastTxt = '';
function syncSeek(force) {
  const d = audio.duration, c = audio.currentTime || 0;
  const txt = `${fmt(c)} / ${isFinite(d) ? fmt(d) : '00:00'}`;
  if (txt !== lastTxt || force) { el.time.textContent = cur() ? txt : '00:00 / 00:00'; lastTxt = txt; }
  if (!scrubbing) {
    el.seek.value = isFinite(d) && d > 0 ? Math.round((c / d) * 1000) : 0;
    paintRange(el.seek);
  }
}
const paintRange = (r) => {
  r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
};

el.seek.addEventListener('pointerdown', () => { scrubbing = true; });
addEventListener('pointerup', () => { scrubbing = false; });
el.seek.addEventListener('input', () => {
  paintRange(el.seek);
  if (isFinite(audio.duration)) audio.currentTime = (el.seek.value / 1000) * audio.duration;
});

/* ---------- Playlist ---------- */
function renderList() {
  el.list.textContent = '';
  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'row' + (t.bad ? ' bad' : '');
    li.dataset.id = t.id;
    if (t.id === curId) li.setAttribute('aria-current', 'true');
    li.innerHTML =
      '<button class="main" type="button"><span class="no"></span><span class="nm"></span><span class="du"></span></button>' +
      '<button class="rm" type="button" title="Entfernen" aria-label="Entfernen">×</button>';
    li.querySelector('.no').textContent = i + 1;
    li.querySelector('.nm').textContent = t.name;
    li.querySelector('.du').textContent = isFinite(t.duration) ? fmt(t.duration) : '';
    frag.append(li);
  });
  el.list.append(frag);
  el.empty.hidden = tracks.length > 0;
  updateInfo();
  const c = el.list.querySelector('[aria-current]');
  if (c) c.scrollIntoView({ block: 'nearest' });
}
function updateDuration(t) {
  const row = el.list.querySelector(`[data-id="${t.id}"] .du`);
  if (row) row.textContent = fmt(t.duration);
}

el.list.addEventListener('click', (e) => {
  const li = e.target.closest('.row');
  if (!li) return;
  const t = byId(+li.dataset.id);
  if (!t) return;
  if (e.target.closest('.rm')) removeTrack(t);
  else { t.bad = false; load(t, true); }
});

function unloadAudio() {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  resetPeak();
}

function removeTrack(t) {
  const wasCurrent = t.id === curId;
  const idx = tracks.indexOf(t);
  const wasPlaying = !audio.paused;
  tracks.splice(idx, 1);
  URL.revokeObjectURL(t.url);
  if (wasCurrent) {
    curId = null; el.seek.disabled = true;
    unloadAudio();
    rebuildOrder();
    const nxt = tracks[Math.min(idx, tracks.length - 1)];
    if (nxt) { load(nxt, wasPlaying); return; }
    syncSeek(true);
  } else rebuildOrder();
  renderList();
}

$('#clear').addEventListener('click', () => {
  curId = null; el.seek.disabled = true;
  unloadAudio();
  tracks.forEach((t) => URL.revokeObjectURL(t.url));
  tracks.length = 0; order = [];
  syncSeek(true); renderList();
});

/* ---------- Dateien hinzufügen ---------- */
const probeQueue = []; let probing = false;
function probe(t) { probeQueue.push(t); if (!probing) nextProbe(); }
function nextProbe() {
  const t = probeQueue.shift();
  if (!t) { probing = false; return; }
  probing = true;
  const a = new Audio();
  a.preload = 'metadata';
  let done = false;
  const fin = () => {
    if (done) return; done = true;
    a.removeAttribute('src'); a.load(); nextProbe();
  };
  a.onloadedmetadata = () => {
    if (isFinite(a.duration) && byId(t.id)) { t.duration = a.duration; updateDuration(t); }
    fin();
  };
  a.onerror = fin;
  setTimeout(fin, 5000);
  a.src = t.url;
}

function addFiles(files, { playFirst = false } = {}) {
  const all = [...files];
  const list = all.filter(isAudio).sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
  const skipped = all.length - list.length;
  if (!list.length) { if (all.length) toast('Keine unterstützten Audiodateien gefunden'); return; }
  const added = list.map((f) => ({
    id: ++uid, file: f, name: f.name.replace(EXT, '').replace(/_/g, ' '),
    url: URL.createObjectURL(f), duration: NaN, bad: false,
  }));
  tracks.push(...added);
  rebuildOrder();
  renderList();
  added.forEach(probe);
  toast(`${added.length} Titel hinzugefügt${skipped ? ` · ${skipped} übersprungen` : ''}`);
  if (playFirst) load(added[0], true);
}

// Drop (inkl. Ordner)
const walk = (entry, out) => new Promise((resolve) => {
  if (entry.isFile) entry.file((f) => { out.push(f); resolve(); }, () => resolve());
  else if (entry.isDirectory) {
    const reader = entry.createReader(); const all = [];
    const read = () => reader.readEntries(async (ents) => {
      if (!ents.length) {
        all.sort((a, b) => natural(a.name, b.name));
        for (const e of all) await walk(e, out);
        resolve();
      } else { all.push(...ents); read(); }
    }, () => resolve());
    read();
  } else resolve();
});

async function filesFromDrop(dt) {
  const entries = [], files = [];
  for (const it of dt.items || []) {
    if (it.kind !== 'file') continue;
    const en = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (en) entries.push(en); else { const f = it.getAsFile(); if (f) files.push(f); }
  }
  if (!dt.items) files.push(...dt.files);
  for (const en of entries) await walk(en, files);
  return files;
}

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; amp.classList.add('dragging'); });
addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; amp.classList.remove('dragging'); } });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; amp.classList.remove('dragging');
  const files = await filesFromDrop(e.dataTransfer);
  addFiles(files, { playFirst: audio.paused });
});

$('#addFiles').addEventListener('click', () => el.filePicker.click());
$('#openCompact')?.addEventListener('click', () => el.filePicker.click());
$('#addFolder').addEventListener('click', () => el.folderPicker.click());
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  $('#addFolder').hidden = true;
}
el.filePicker.addEventListener('change', () => { addFiles(el.filePicker.files, { playFirst: !cur() }); el.filePicker.value = ''; });
el.folderPicker.addEventListener('change', () => { addFiles(el.folderPicker.files, { playFirst: !cur() }); el.folderPicker.value = ''; });

// „Öffnen mit LoAmp“ (File Handling API, installierte PWA)
if ('launchQueue' in window) {
  launchQueue.setConsumer(async (p) => {
    if (!p.files || !p.files.length) return;
    const files = await Promise.all(p.files.map((h) => h.getFile()));
    addFiles(files, { playFirst: true });
  });
}

/* ---------- Bedienung ---------- */
el.play.addEventListener('click', togglePlay);
el.stop.addEventListener('click', stop);
el.prev.addEventListener('click', prev);
el.next.addEventListener('click', () => step(1));

function bindSeekKey(btn, dir) {
  let timer, iv, held = false;
  const end = () => { clearTimeout(timer); clearInterval(iv); setTimeout(() => { held = false; }, 60); };
  btn.addEventListener('pointerdown', () => {
    held = false;
    timer = setTimeout(() => { held = true; iv = setInterval(() => seekBy(dir * 3), 120); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, end));
  btn.addEventListener('click', () => { if (!held) seekBy(dir * 10); });
}
bindSeekKey(el.rew, -1);
bindSeekKey(el.ffw, 1);

function paintToggles() {
  el.shuffle.setAttribute('aria-pressed', shuffle);
  el.repeat.setAttribute('aria-pressed', repeat !== 'off');
  el.repeatLbl.textContent = { off: 'Wdh. aus', all: 'Wdh. alle', one: 'Wdh. Titel' }[repeat];
  el.refLbl.textContent = `0 VU ${refDb < 0 ? '−' : ''}${Math.abs(refDb)}`;
}
el.shuffle.addEventListener('click', () => { shuffle = !shuffle; rebuildOrder(); paintToggles(); updateInfo(); persist(); });
el.repeat.addEventListener('click', () => { repeat = { off: 'all', all: 'one', one: 'off' }[repeat]; paintToggles(); persist(); });
el.ref.addEventListener('click', () => {
  refDb = REFS[(REFS.indexOf(refDb) + 1) % REFS.length];
  paintToggles(); persist(); kick(true);
  toast(`0 VU = ${refDb} dBFS ${{ '-18': '(EBU R68)', '-20': '(SMPTE RP155)', '-14': '(Musik)' }[refDb]}`);
});

function setVolume(v, fromSlider) {
  vol = clamp(v, 0, 1);
  if (!fromSlider) el.volume.value = vol;
  paintRange(el.volume);
  el.volOut.textContent = (vol * 10).toFixed(1);
  applyVolume(); persist();
}
el.volume.addEventListener('input', () => setVolume(+el.volume.value, true));

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onRange = e.target.matches && e.target.matches('input[type=range]');
  const onBtn = e.target.matches && e.target.matches('button');
  switch (e.key) {
    case ' ': if (onBtn) return; e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': if (onRange) return; e.preventDefault(); seekBy(5); break;
    case 'ArrowLeft': if (onRange) return; e.preventDefault(); seekBy(-5); break;
    case 'ArrowUp': if (onRange) return; e.preventDefault(); setVolume(vol + 0.05); break;
    case 'ArrowDown': if (onRange) return; e.preventDefault(); setVolume(vol - 0.05); break;
    case 'n': case 'N': step(1); break;
    case 'p': case 'P': prev(); break;
    case 's': case 'S': stop(); break;
  }
});

function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: 'LoAmp', artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* nicht unterstützt */ } };
  set('play', togglePlay); set('pause', () => audio.pause()); set('stop', stop);
  set('previoustrack', prev); set('nexttrack', () => step(1));
  set('seekbackward', () => seekBy(-10)); set('seekforward', () => seekBy(10));
  set('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

/* ---------- Pegelanzeige (VU-Meter + True-Peak-Lampe) ---------- */
const FULL = Math.pow(10, 3 / 20);               // Skalenende = +3 VU
const A0 = (-42 * Math.PI) / 180, A1 = (42 * Math.PI) / 180;
const dbFrac = (db) => Math.pow(10, db / 20) / FULL;
const TP_LIMIT = Math.pow(10, -1 / 20);          // EBU R128: max. −1 dBTP
const LAMP_HOLD = 1.5;                           // Sekunden

const meters = ['#vuL', '#vuR'].map((sel, i) => {
  const cv = $(sel);
  return { cv, g: cv.getContext('2d'), label: i ? 'R' : 'L', x: 0, lampT: 0, glow: 0.35, w: 0, h: 0 };
});
let peakMax = 0, peakShown = '';

function resetPeak() {
  peakMax = 0;
  meters.forEach((m) => { m.lampT = 0; });
  if (meterNode) meterNode.port.postMessage('reset');
  paintPeak();
}
function paintPeak() {
  const db = peakMax > 0 ? 20 * Math.log10(peakMax) : -Infinity;
  const txt = isFinite(db) ? `TP ${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB` : 'TP --';
  if (txt === peakShown) return;
  peakShown = txt;
  el.peak.textContent = txt;
  el.peak.classList.toggle('over', peakMax >= TP_LIMIT);
}
el.peak.addEventListener('click', resetPeak);

/** Messwerte aus dem AudioWorklet. */
function onMeter(d, sampleRate) {
  if (!cur() || audio.paused) return;
  const dt = d.n / sampleRate;
  meters.forEach((m, i) => {
    m.x = d.vu[i];
    const tp = d.tp[i];
    if (tp >= TP_LIMIT) m.lampT = LAMP_HOLD; else m.lampT = Math.max(0, m.lampT - dt);
    if (tp > peakMax) peakMax = tp;
  });
  kick();
}

function sizeMeters() {
  const dpr = window.devicePixelRatio || 1;
  meters.forEach((m) => {
    const r = m.cv.getBoundingClientRect();
    m.w = m.cv.width = Math.max(1, Math.round(r.width * dpr));
    m.h = m.cv.height = Math.max(1, Math.round(r.height * dpr));
  });
  kick(true);
}
new ResizeObserver(sizeMeters).observe($('.meters'));

function drawMeter(m) {
  const { g, w, h } = m;
  const cx = w / 2, py = h * 1.22, R = h * 0.98;
  const pt = (f, r) => { const a = A0 + (A1 - A0) * f; return [cx + Math.sin(a) * r, py - Math.cos(a) * r]; };
  const th = (f) => A0 + (A1 - A0) * f - Math.PI / 2;

  // Zifferblatt
  const bg = g.createRadialGradient(cx, h * 0.95, h * 0.1, cx, h * 0.95, w * 0.8);
  bg.addColorStop(0, '#fff3c8'); bg.addColorStop(0.55, '#f0c96c'); bg.addColorStop(1, '#a87a22');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = `rgba(30,16,2,${0.4 * (1 - m.glow)})`; g.fillRect(0, 0, w, h);

  // Skala
  g.lineCap = 'butt';
  const f0 = dbFrac(0), fm = dbFrac(-20), fp = dbFrac(3);
  g.strokeStyle = '#2a1c08'; g.lineWidth = Math.max(1, h * 0.012);
  g.beginPath(); g.arc(cx, py, R * 0.9, th(fm), th(f0)); g.stroke();
  g.strokeStyle = '#c4281c'; g.lineWidth = Math.max(2, h * 0.03);
  g.beginPath(); g.arc(cx, py, R * 0.885, th(f0), th(fp)); g.stroke();

  const major = [-20, -10, -7, -5, -3, 0, 1, 2, 3];
  g.font = `600 ${h * 0.105}px "Didot","Bodoni 72","Playfair Display",Georgia,serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let db = -20; db <= 3; db += db < -10 ? 2 : 1) {
    const isMaj = major.includes(db), f = dbFrac(db);
    const [x1, y1] = pt(f, R * 0.9), [x2, y2] = pt(f, R * (isMaj ? 0.97 : 0.935));
    g.strokeStyle = db > 0 ? '#c4281c' : '#2a1c08';
    g.lineWidth = Math.max(1, h * (isMaj ? 0.014 : 0.008));
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    if (isMaj) {
      const [tx, ty] = pt(f, R * 1.045);
      g.fillStyle = db > 0 ? '#b01f15' : '#2a1c08';
      g.fillText(String(Math.abs(db)), tx, ty);
    }
  }

  // Beschriftung
  g.fillStyle = 'rgba(42,28,8,.8)';
  g.font = `italic 700 ${h * 0.2}px "Didot","Bodoni 72","Playfair Display",Georgia,serif`;
  g.fillText('VU', cx, h * 0.5);
  g.font = `700 ${h * 0.09}px "Didot","Playfair Display",Georgia,serif`;
  g.textAlign = 'left'; g.fillText(m.label, w * 0.06, h * 0.86);

  // True-Peak-Lampe (> −1 dBTP)
  const lamp = Math.min(1, m.lampT / 0.4);
  const lx = w * 0.9, ly = h * 0.17, lr = h * 0.06;
  g.fillStyle = `rgba(230,40,30,${0.18 + 0.82 * lamp})`;
  if (lamp > 0.05) { g.shadowColor = '#ff3a2a'; g.shadowBlur = h * 0.18 * lamp; }
  g.beginPath(); g.arc(lx, ly, lr, 0, 7); g.fill(); g.shadowBlur = 0;
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke();

  // Nadel (Anzeige in Spannung relativ zu 0 VU)
  const frac = clamp(m.x / Math.pow(10, refDb / 20) / FULL, 0, 1.03);
  const [nx, ny] = pt(frac, R * 1.03);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = Math.max(1.5, h * 0.016);
  g.beginPath(); g.moveTo(cx + h * 0.02, py + h * 0.015); g.lineTo(nx + h * 0.02, ny + h * 0.015); g.stroke();
  g.strokeStyle = '#17110a'; g.lineWidth = Math.max(1.2, h * 0.012);
  g.beginPath(); g.moveTo(cx, py); g.lineTo(nx, ny); g.stroke();

  // Blende
  g.fillStyle = '#16110b';
  g.beginPath(); g.arc(cx, h, h * 0.2, Math.PI, 0); g.fill();

  // Glas
  const gl = g.createLinearGradient(0, 0, 0, h * 0.6);
  gl.addColorStop(0, 'rgba(255,255,255,.3)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.fillRect(0, 0, w, h * 0.6);
}

let rafId = 0, lastT = 0, dirty = true;
function kick(redraw) { if (redraw) dirty = true; if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); } }

function frame(now) {
  rafId = 0;
  const dt = clamp((now - lastT) / 1000, 0, 0.1); lastT = now;
  const playing = !audio.paused;
  let active = playing || dirty;

  meters.forEach((m) => {
    const gt = playing ? 1 : 0.35;
    const prevX = m.x, prevLamp = m.lampT;
    m.glow += (gt - m.glow) * Math.min(1, dt * 4);
    if (!playing && m.x > 0) {
      m.x *= Math.exp(-dt * 10);
      if (m.x < 1e-4) m.x = 0;
    }
    if (!playing && m.lampT > 0) m.lampT = Math.max(0, m.lampT - dt);   // Lampe läuft auch in der Pause aus
    if (m.x > 0 || m.lampT > 0 || Math.abs(m.glow - gt) > 0.01) active = true;
    if ((active || prevX !== m.x || prevLamp !== m.lampT) && m.w) drawMeter(m);
  });
  dirty = false;
  paintPeak();
  syncSeek();
  if (active) rafId = requestAnimationFrame(frame);
}

/* ---------- Start ---------- */
el.volume.value = vol;
setVolume(vol, true);
paintToggles();
paintRange(el.seek);
renderList();
paintPeak();
sizeMeters();
document.fonts?.ready.then(() => kick(true));
audio.addEventListener('timeupdate', () => kick());
audio.addEventListener('seeked', () => kick(true));

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
