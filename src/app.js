// 画面の操作・文字の描画・WebHID での送信。バイト列の組み立ては protocol.js に任せる。
import {
  VENDOR_ID, PRODUCT_ID, ROWS, BADGE_WIDTH as BADGE_W, MAX_MESSAGES as MAX_MSG,
  buildPayload as encodePayload, splitReports,
} from './protocol.js';

const STORE_KEY = 'ledbadge.v1';

const $ = (id) => document.getElementById(id);

// ---------- state ----------
const defaultMsg = (text = '') => ({
  text, mode: 0, speed: 4, blink: false, ants: false,
  font: $('font').options[0].value, size: 11, yoff: 0, threshold: 110, bold: false, spacing: 0,
  bitmap: null, // { width, px: number[] } row-major, 1 = on
});

let state = load() || { brightness: 100, messages: [defaultMsg('HELLO')] , cur: 0 };
state.messages.forEach((m) => { if (!m.bitmap) m.bitmap = renderText(m); });

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
const cur = () => state.messages[state.cur];

// ---------- text -> bitmap ----------
function renderText(m) {
  const font = `${m.bold ? 'bold ' : ''}${m.size}px ${m.font}`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const chars = Array.from(m.text || '');
  const advs = chars.map((c) => meas.measureText(c).width);
  const total = Math.ceil(advs.reduce((a, b) => a + b + m.spacing, 0));
  const width = Math.max(8, Math.ceil(Math.max(total, 1) / 8) * 8);

  const cv = document.createElement('canvas');
  cv.width = width; cv.height = ROWS;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  let x = 0;
  chars.forEach((c, i) => { ctx.fillText(c, Math.round(x), ROWS / 2 + 0.5 + Number(m.yoff)); x += advs[i] + Number(m.spacing); });

  const data = ctx.getImageData(0, 0, width, ROWS).data;
  const px = new Array(width * ROWS);
  for (let i = 0; i < px.length; i++) px[i] = data[i * 4 + 3] >= m.threshold ? 1 : 0;
  return { width, px };
}

// ---------- protocol ----------
function buildPayload() {
  const msgs = state.messages.filter((m) => m.bitmap && m.bitmap.width > 0);
  return encodePayload(msgs, { brightness: state.brightness, date: new Date() });
}

async function getDevice() {
  let devs = (await navigator.hid.getDevices()).filter((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
  if (!devs.length) devs = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
  // 出力レポートを持つインターフェースを優先する（複数のインターフェースが見える環境があるため）。
  return devs.find((d) => d.collections.some((c) => c.outputReports && c.outputReports.length)) || devs[0];
}

async function send() {
  const st = $('status');
  st.className = 'status';
  try {
    const buf = buildPayload();
    st.textContent = '接続中…';
    const dev = await getDevice();
    if (!dev) { st.textContent = 'デバイスが選択されませんでした。'; return; }
    if (!dev.opened) await dev.open();
    const rid = dev.collections.flatMap((c) => c.outputReports || []).map((r) => r.reportId)[0] || 0;
    const reports = splitReports(buf);
    for (const [i, report] of reports.entries()) {
      st.textContent = `書き込み中… ${Math.round((i / reports.length) * 100)}%`;
      await dev.sendReport(rid, report);
      // 連続で送ると取りこぼす個体があるという報告に合わせ、少し間を空ける。
      await new Promise((r) => setTimeout(r, 5));
    }
    st.textContent = `書き込み完了（${buf.length} バイト / ${state.messages.length} メッセージ）`;
    st.className = 'status ok';
  } catch (e) {
    console.error(e);
    st.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    st.className = 'status err';
  }
}

// ---------- UI: tabs & form ----------
const fields = ['text', 'mode', 'speed', 'blink', 'ants', 'font', 'size', 'yoff', 'threshold', 'bold', 'spacing'];
const renderFields = new Set(['text', 'font', 'size', 'yoff', 'threshold', 'bold', 'spacing']);

function renderTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  state.messages.forEach((m, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}: ${m.text || '(画像)'}`;
    if (i === state.cur) b.className = 'active';
    b.onclick = () => { state.cur = i; refresh(); };
    tabs.appendChild(b);
  });
  if (state.messages.length < MAX_MSG) {
    const add = document.createElement('button');
    add.textContent = '+ 追加';
    add.onclick = () => {
      const m = defaultMsg('');
      const c = cur();
      ['font', 'size', 'yoff', 'threshold', 'bold', 'spacing', 'mode', 'speed'].forEach((k) => { m[k] = c[k]; });
      m.bitmap = renderText(m);
      state.messages.push(m); state.cur = state.messages.length - 1; refresh();
    };
    tabs.appendChild(add);
  }
}

function loadForm() {
  const m = cur();
  fields.forEach((f) => {
    const el = $(f);
    if (el.type === 'checkbox') el.checked = !!m[f]; else el.value = m[f];
  });
  $('speedv').textContent = m.speed;
  $('brightness').value = state.brightness;
  $('remove').disabled = state.messages.length <= 1;
}

fields.forEach((f) => {
  const el = $(f);
  el.addEventListener('input', () => {
    const m = cur();
    m[f] = el.type === 'checkbox' ? el.checked : (el.type === 'text' || f === 'font') ? el.value : Number(el.value);
    if (f === 'speed') $('speedv').textContent = m.speed;
    if (renderFields.has(f)) m.bitmap = renderText(m);
    if (f === 'text') renderTabs();
    drawDots(); restartPreview(); save();
  });
});
$('brightness').addEventListener('input', (e) => { state.brightness = Number(e.target.value); save(); restartPreview(); });
$('send').addEventListener('click', send);

function editBitmap(fn) { const bm = cur().bitmap; fn(bm); drawDots(); restartPreview(); save(); }
$('addcols').onclick = () => editBitmap((bm) => {
  const w = bm.width + 8, px = new Array(w * ROWS).fill(0);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < bm.width; x++) px[y * w + x] = bm.px[y * bm.width + x];
  bm.width = w; bm.px = px;
});
$('delcols').onclick = () => editBitmap((bm) => {
  if (bm.width <= 8) return;
  const w = bm.width - 8, px = new Array(w * ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < w; x++) px[y * w + x] = bm.px[y * bm.width + x];
  bm.width = w; bm.px = px;
});
$('clear').onclick = () => editBitmap((bm) => bm.px.fill(0));
$('invert').onclick = () => editBitmap((bm) => { bm.px = bm.px.map((v) => (v ? 0 : 1)); });
$('regen').onclick = () => { cur().bitmap = renderText(cur()); drawDots(); restartPreview(); save(); };
$('remove').onclick = () => {
  if (state.messages.length <= 1) return;
  state.messages.splice(state.cur, 1);
  state.cur = Math.max(0, state.cur - 1);
  refresh();
};

// ---------- dot editor ----------
const DOT = 14;
const dots = $('dots');
function drawDots() {
  const { width, px } = cur().bitmap;
  dots.width = width * DOT; dots.height = ROWS * DOT;
  const ctx = dots.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, dots.width, dots.height);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < width; x++) {
    ctx.fillStyle = px[y * width + x] ? '#ff5a3c' : '#24282e';
    ctx.fillRect(x * DOT + 1, y * DOT + 1, DOT - 2, DOT - 2);
  }
  ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = 2;
  for (let x = BADGE_W; x < width; x += BADGE_W) { ctx.beginPath(); ctx.moveTo(x * DOT, 0); ctx.lineTo(x * DOT, dots.height); ctx.stroke(); }
}
let paint = null;
function dotAt(e) {
  const r = dots.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / DOT), Math.floor((e.clientY - r.top) / DOT)];
}
function setDot(e) {
  const bm = cur().bitmap;
  const [x, y] = dotAt(e);
  if (x < 0 || y < 0 || x >= bm.width || y >= ROWS) return;
  const i = y * bm.width + x;
  if (paint === null) paint = bm.px[i] ? 0 : 1;
  if (bm.px[i] !== paint) { bm.px[i] = paint; drawDots(); }
}
dots.addEventListener('pointerdown', (e) => { paint = null; dots.setPointerCapture(e.pointerId); setDot(e); });
dots.addEventListener('pointermove', (e) => { if (e.buttons) setDot(e); });
dots.addEventListener('pointerup', () => { paint = null; restartPreview(); save(); });

// ---------- preview ----------
const pv = $('preview');
let timer = null, frame = 0;
function drawFrame(getPx) {
  const ctx = pv.getContext('2d');
  const s = pv.width / BADGE_W;
  const alpha = 0.35 + 0.65 * (state.brightness / 100);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pv.width, pv.height);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < BADGE_W; x++) {
    const on = getPx(x, y);
    ctx.fillStyle = on ? `rgba(255,70,40,${alpha})` : '#1a0d0b';
    ctx.beginPath(); ctx.arc(x * s + s / 2, y * s + s / 2, s * 0.38, 0, Math.PI * 2); ctx.fill();
  }
}
function restartPreview() {
  clearInterval(timer); frame = 0;
  const m = cur(), { width, px } = m.bitmap;
  const at = (x, y) => (x >= 0 && x < width && y >= 0 && y < ROWS ? px[y * width + x] : 0);
  const interval = 130 - (m.speed - 1) * 15;
  const center = Math.floor((BADGE_W - width) / 2);
  const step = () => {
    const blinkOff = m.blink && Math.floor(frame / 6) % 2 === 1;
    let fn;
    switch (Number(m.mode)) {
      case 0: { const o = (frame % (width + BADGE_W)) - BADGE_W; fn = (x, y) => at(x + o, y); break; }
      case 1: { const o = (frame % (width + BADGE_W)) - width; fn = (x, y) => at(x - o, y); break; }
      case 2: case 3: {
        // 44 列ずつのページを縦にスライドさせる
        const pages = Math.max(1, Math.ceil(width / BADGE_W)), per = ROWS * 2 + 10;
        const p = Math.floor(frame / per) % pages, t = frame % per;
        const dy = t < ROWS ? ROWS - t : t < ROWS + 10 ? 0 : -(t - ROWS - 10);
        const sgn = m.mode === 2 ? 1 : -1;
        const off = width <= BADGE_W ? center : p * BADGE_W;
        fn = (x, y) => at(x + (width <= BADGE_W ? -center : off), y - sgn * dy);
        break;
      }
      default: {
        const pages = Math.max(1, Math.ceil(width / BADGE_W));
        const p = Math.floor(frame / 20) % pages;
        fn = width <= BADGE_W ? (x, y) => at(x - center, y) : (x, y) => at(x + p * BADGE_W, y);
      }
    }
    const antsOn = m.ants;
    drawFrame((x, y) => {
      if (antsOn && (y === 0 || y === ROWS - 1 || x === 0 || x === BADGE_W - 1)) {
        const k = (y === 0 ? x : y === ROWS - 1 ? BADGE_W * 2 + ROWS - x : x === 0 ? BADGE_W * 2 + ROWS * 2 - y : BADGE_W + y);
        return (k + frame) % 4 < 2;
      }
      return blinkOff ? 0 : fn(x, y);
    });
    frame++;
  };
  step();
  timer = setInterval(step, interval);
}

function refresh() { renderTabs(); loadForm(); drawDots(); restartPreview(); save(); }

if (!('hid' in navigator)) { $('support').hidden = false; $('send').disabled = true; }
refresh();
