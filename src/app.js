// 画面の操作・文字の描画・WebHID での送信。バイト列の組み立ては protocol.js に任せる。
import {
  VENDOR_ID, PRODUCT_ID, ROWS, BADGE_WIDTH as BADGE_W, MAX_MESSAGES as MAX_MSG,
  buildPayload as encodePayload, splitReports,
} from './protocol.js';
import { ANIMATION_FRAME_WIDTH, APPROXIMATE_MODES, frameInterval, renderFrame, applyBlinkAndAnts } from './preview.js';

const STORE_KEY = 'ledbadge.v1';

const $ = (id) => document.getElementById(id);

// ---------- state ----------
const defaultMsg = (text = '') => ({
  text, mode: 0, speed: 4, blink: false, ants: false,
  font: $('font').options[0].value, size: 11, yoff: 0, threshold: 110, bold: false, spacing: 0,
  bitmap: null, // { width, px: number[] } row-major, 1 = on
});

const initialState = () => {
  const m = defaultMsg('HELLO');
  m.bitmap = renderText(m);
  return { brightness: 100, messages: [m], cur: 0 };
};
let state = load() || initialState();

// 保存された内容が壊れていても画面が動かなくならないよう、形が合わないものは初期状態に戻す。
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!s || !Array.isArray(s.messages) || !s.messages.length || s.messages.length > MAX_MSG) return null;
    s.messages = s.messages.map((m) => {
      const msg = { ...defaultMsg(''), ...m };
      const bm = msg.bitmap;
      const valid = bm && Number.isInteger(bm.width) && bm.width > 0 && bm.width % 8 === 0
        && Array.isArray(bm.px) && bm.px.length === bm.width * ROWS;
      if (!valid) msg.bitmap = renderText(msg);
      return msg;
    });
    s.cur = Number.isInteger(s.cur) && s.cur >= 0 && s.cur < s.messages.length ? s.cur : 0;
    s.brightness = [25, 50, 75, 100].includes(s.brightness) ? s.brightness : 100;
    return s;
  } catch {
    return null;
  }
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

let sending = false;
async function send() {
  // 書き込み中にもう一度押されると、2 回分のレポートが交互に混ざってバッジに届くため、送信を 1 つに限る。
  if (sending) return;
  sending = true;
  $('send').disabled = true;
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
  } finally {
    sending = false;
    $('send').disabled = false;
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
  // アニメーションは 48 列ごとのコマで切り替わるため、区切りの位置もそれに合わせる。
  const pageW = Number(cur().mode) === 5 ? ANIMATION_FRAME_WIDTH : BADGE_W;
  for (let x = pageW; x < width; x += pageW) { ctx.beginPath(); ctx.moveTo(x * DOT, 0); ctx.lineTo(x * DOT, dots.height); ctx.stroke(); }
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
  const m = cur();
  $('previewNote').hidden = !APPROXIMATE_MODES.has(Number(m.mode));
  const step = () => {
    const grid = applyBlinkAndAnts(renderFrame(m.bitmap, m.mode, frame), m, frame);
    drawFrame((x, y) => grid[y * BADGE_W + x]);
    frame++;
  };
  step();
  timer = setInterval(step, frameInterval(m.mode, m.speed));
}

// テーマは文字やメッセージの状態とは別に保存する（state の検証に含めず、壊れても初期値に戻すだけで済むように）。
const THEME_KEY = 'ledbadge.theme';
const themeSelect = $('theme');
themeSelect.value = document.documentElement.dataset.theme; // index.html の先頭で dark / light / auto のどれかに決めてある
themeSelect.addEventListener('input', () => {
  document.documentElement.dataset.theme = themeSelect.value;
  try { localStorage.setItem(THEME_KEY, themeSelect.value); } catch {}
});

function refresh() { renderTabs(); loadForm(); drawDots(); restartPreview(); save(); }

if (!('hid' in navigator)) { $('support').hidden = false; $('send').disabled = true; }
refresh();
