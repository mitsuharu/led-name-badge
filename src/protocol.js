// 11×44 ドット LED ネームバッジ（USB ID 0416:5020）へ送るバイト列を組み立てる。
// 解析結果は https://github.com/jnweiger/led-name-badge-ls32 に基づく。
// DOM や WebHID に依存させず、Node.js でテストできるようにしている。

export const VENDOR_ID = 0x0416;
export const PRODUCT_ID = 0x5020;
export const ROWS = 11;
export const BADGE_WIDTH = 44;
export const REPORT_SIZE = 64;
export const HEADER_SIZE = 64;
export const MAX_PAYLOAD = 8192;
export const MAX_MESSAGES = 8;

/** 表示モード（ヘッダの下位 4 ビット）。 */
export const Mode = Object.freeze({
  SCROLL_LEFT: 0,
  SCROLL_RIGHT: 1,
  SCROLL_UP: 2,
  SCROLL_DOWN: 3,
  FIXED: 4,
  ANIMATION: 5,
  SNOWFLAKE: 6,
  CURTAIN: 7,
  LASER: 8,
});

const clamp = (v, min, max) => Math.min(Math.max(Math.trunc(Number(v) || 0), min), max);

/**
 * ビットマップを列ごとのバイト列にする。
 * 8 ドット幅の列ごとに、上の行から 11 バイト。各バイトは MSB が左端のドット。
 * @param {{ width: number, px: ArrayLike<number> }} bitmap 行優先（px[y * width + x]）、0 以外が点灯
 * @returns {Uint8Array}
 */
export function encodeBitmap({ width, px }) {
  if (!Number.isInteger(width) || width <= 0 || width % 8 !== 0) {
    throw new RangeError(`ビットマップの幅は 8 の倍数にしてください（${width}）`);
  }
  if (px.length !== width * ROWS) {
    throw new RangeError(`ビットマップの大きさが幅と合いません（${px.length} ≠ ${width}×${ROWS}）`);
  }
  const cols = width / 8;
  const out = new Uint8Array(cols * ROWS);
  for (let c = 0; c < cols; c++) {
    for (let y = 0; y < ROWS; y++) {
      let byte = 0;
      for (let k = 0; k < 8; k++) if (px[y * width + c * 8 + k]) byte |= 0x80 >> k;
      out[c * ROWS + y] = byte;
    }
  }
  return out;
}

/** 明るさ（%）をヘッダの値にする。25 / 50 / 75 / 100 の 4 段階に丸める。 */
export function brightnessByte(percent) {
  if (percent <= 25) return 0x40;
  if (percent <= 50) return 0x20;
  if (percent <= 75) return 0x10;
  return 0x00;
}

/**
 * 64 バイトのヘッダを作る。
 * 使わないメッセージ枠には、最後のメッセージの速度・モード・点滅・枠を入れる
 * （元の実装と同じにして、ファームウェアが未使用枠をどう扱っても差が出ないようにする）。
 * @param {Array<{ width: number, mode?: number, speed?: number, blink?: boolean, ants?: boolean }>} messages
 * @param {{ brightness?: number, date?: Date }} [options]
 * @returns {Uint8Array}
 */
export function buildHeader(messages, { brightness = 100, date = new Date() } = {}) {
  if (!messages.length) throw new RangeError('メッセージがありません');
  if (messages.length > MAX_MESSAGES) throw new RangeError(`メッセージは ${MAX_MESSAGES} 件までです`);

  const h = new Uint8Array(HEADER_SIZE);
  h.set([0x77, 0x61, 0x6e, 0x67]); // "wang"
  h[5] = brightnessByte(brightness);
  for (let i = 0; i < MAX_MESSAGES; i++) {
    const m = messages[Math.min(i, messages.length - 1)];
    const speed = clamp(m.speed ?? 4, 1, 8);
    const mode = clamp(m.mode ?? Mode.SCROLL_LEFT, 0, 8);
    if (m.blink) h[6] |= 1 << i;
    if (m.ants) h[7] |= 1 << i;
    h[8 + i] = ((speed - 1) << 4) | mode;
  }
  messages.forEach((m, i) => {
    const cols = m.width / 8;
    h[16 + 2 * i] = cols >> 8;
    h[17 + 2 * i] = cols & 0xff;
  });
  // 日時はバッジには表示されないが、元のアプリが書き込むため合わせている。
  h.set([date.getFullYear() % 100, date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds()], 38);
  return h;
}

/**
 * バッジへ送るデータ全体（ヘッダ + 全メッセージのビットマップ）を作る。64 バイト境界までゼロで埋める。
 * @param {Array<{ bitmap: { width: number, px: ArrayLike<number> }, mode?: number, speed?: number, blink?: boolean, ants?: boolean }>} messages
 * @param {{ brightness?: number, date?: Date }} [options]
 * @returns {Uint8Array}
 */
export function buildPayload(messages, options) {
  const bodies = messages.map((m) => encodeBitmap(m.bitmap));
  const header = buildHeader(messages.map((m) => ({ ...m, width: m.bitmap.width })), options);
  const used = HEADER_SIZE + bodies.reduce((n, b) => n + b.length, 0);
  const total = Math.ceil(used / REPORT_SIZE) * REPORT_SIZE;
  if (total > MAX_PAYLOAD) {
    throw new RangeError(`データが大きすぎます（${total} / ${MAX_PAYLOAD} バイト）。文字数を減らしてください`);
  }
  const buf = new Uint8Array(total);
  buf.set(header);
  let off = HEADER_SIZE;
  for (const b of bodies) { buf.set(b, off); off += b.length; }
  return buf;
}

/** 送信データを 64 バイトずつの HID レポートに分ける。 */
export function splitReports(buf) {
  if (buf.length % REPORT_SIZE !== 0) throw new RangeError('データが 64 バイト境界に揃っていません');
  const out = [];
  for (let i = 0; i < buf.length; i += REPORT_SIZE) out.push(buf.slice(i, i + REPORT_SIZE));
  return out;
}
