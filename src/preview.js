// プレビューの 1 コマ（44×11 ドット）を計算する。DOM に依存させず、Node.js でテストできるようにしている。
//
// 実機の動きの根拠:
// - スクロール（0〜3）と固定（4）は実機で確認済み。
// - アニメーション（5）は jnweiger/led-name-badge-ls32 の説明による。48 ドット幅のコマを左から順に表示し、繰り返す。
//   44 ドット幅のバッジでも 48 ドット単位で、各コマの左 44 ドットが見える（と想定している）。
// - 降ってくる（6）・カーテン（7）・レーザー（8）は実機の細部が分からないため、
//   fossasia/badgemagic-app のプレビューを参考にしたおおよその動き。コードは写さず、動きだけを参考にした。
import { ROWS, BADGE_WIDTH } from './protocol.js';

export const ANIMATION_FRAME_WIDTH = 48;

/** プレビューが実機の動きを再現できていない（おおよその動きの）モード。 */
export const APPROXIMATE_MODES = Object.freeze(new Set([6, 7, 8]));

// 参照実装の説明にある、アニメーションの速度 1〜8 ごとのコマ数/秒。
const ANIMATION_FPS = [1.2, 1.3, 2.0, 2.4, 2.8, 4.5, 7.5, 15];

const HOLD = 20; // 効果の途中で、全体を表示したまま止めるコマ数

/** 1 コマの長さ（ミリ秒）。 */
export function frameInterval(mode, speed) {
  const s = Math.min(Math.max(Math.trunc(speed) || 1, 1), 8);
  if (Number(mode) === 5) return Math.round(1000 / ANIMATION_FPS[s - 1]);
  return 130 - (s - 1) * 15;
}

/** 44 列ずつのページの数。44 列以下なら 1 ページで、中央に寄せる。 */
export function pageCount(width) {
  return Math.max(1, Math.ceil(width / BADGE_WIDTH));
}

// 表示の列 x に対応する、ビットマップの列を返す。範囲外は -1。
function pageCol(width, page, x) {
  const src = width <= BADGE_WIDTH ? x - Math.floor((BADGE_WIDTH - width) / 2) : page * BADGE_WIDTH + x;
  return src >= 0 && src < width ? src : -1;
}

// 1 ページ分の効果のコマ数と、その中の位置 t から画面を作る関数。
const effects = {
  // 下の行から順に上から落ちてきて積もり、しばらく表示した後、下の行から順に落ちて消える。
  6: {
    length: 21 + HOLD + 31,
    draw(get, t, set) {
      for (let r = 0; r < ROWS; r++) {
        const delay = (ROWS - 1 - r) * 2;
        let y;
        if (t < 21) {
          if (t < delay) continue;
          y = Math.min(t - delay, r);
        } else if (t < 21 + HOLD) {
          y = r;
        } else {
          const u = t - 21 - HOLD;
          y = u < delay ? r : r + (u - delay);
          if (y >= ROWS) continue;
        }
        for (let x = 0; x < BADGE_WIDTH; x++) if (get(x, r)) set(x, y);
      }
    },
  },
  // 中央から左右に開く 2 本の線の内側に表示し、しばらく表示した後、中央から外へ向かって消える。
  7: {
    length: 22 + HOLD + 22,
    draw(get, t, set) {
      const half = BADGE_WIDTH / 2;
      const opening = t < 22, closing = t >= 22 + HOLD;
      const d = opening ? t : closing ? t - 22 - HOLD : half;
      const left = half - 1 - d, right = half + d;
      for (let x = 0; x < BADGE_WIDTH; x++) {
        const line = (opening || closing) && (x === left || x === right);
        const inside = x > left && x < right;
        const visible = opening ? inside : closing ? !inside && !line : true;
        for (let y = 0; y < ROWS; y++) if (line || (visible && get(x, y))) set(x, y);
      }
    },
  },
  // 左から 1 列ずつ描く。描いている列で点灯する行からは、右端まで光線が伸びる。
  // しばらく表示した後、左から 1 列ずつ光線で消していく。
  8: {
    length: BADGE_WIDTH + HOLD + BADGE_WIDTH,
    draw(get, t, set) {
      const drawing = t < BADGE_WIDTH, erasing = t >= BADGE_WIDTH + HOLD;
      const c = drawing ? t : erasing ? t - BADGE_WIDTH - HOLD : BADGE_WIDTH;
      for (let y = 0; y < ROWS; y++) {
        const beam = (drawing || erasing) && get(c, y);
        for (let x = 0; x < BADGE_WIDTH; x++) {
          let on;
          if (drawing) on = x < c ? get(x, y) : beam;
          else if (erasing) on = x <= c ? beam : get(x, y);
          else on = get(x, y);
          if (on) set(x, y);
        }
      }
    },
  },
};

/**
 * プレビューの 1 コマを作る（点滅・枠は含まない）。
 * @param {{ width: number, px: ArrayLike<number> }} bitmap
 * @param {number} mode 0〜8
 * @param {number} tick 0 から始まるコマ番号
 * @returns {Uint8Array} 44×11、行優先、1 = 点灯
 */
export function renderFrame({ width, px }, mode, tick) {
  const out = new Uint8Array(BADGE_WIDTH * ROWS);
  const at = (x, y) => (x >= 0 && x < width && y >= 0 && y < ROWS ? px[y * width + x] : 0);
  const set = (x, y) => { if (x >= 0 && x < BADGE_WIDTH && y >= 0 && y < ROWS) out[y * BADGE_WIDTH + x] = 1; };
  const fill = (fn) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < BADGE_WIDTH; x++) if (fn(x, y)) set(x, y); };
  const m = Number(mode);

  if (m === 0) { const o = (tick % (width + BADGE_WIDTH)) - BADGE_WIDTH; fill((x, y) => at(x + o, y)); return out; }
  if (m === 1) { const o = (tick % (width + BADGE_WIDTH)) - width; fill((x, y) => at(x - o, y)); return out; }
  if (m === 5) {
    const frames = Math.max(1, Math.ceil(width / ANIMATION_FRAME_WIDTH));
    const off = (tick % frames) * ANIMATION_FRAME_WIDTH;
    fill((x, y) => at(off + x, y));
    return out;
  }

  const pages = pageCount(width);
  const get = (page) => (x, y) => { const c = pageCol(width, page, x); return c >= 0 && y >= 0 && y < ROWS ? at(c, y) : 0; };

  if (m === 2 || m === 3) {
    // 44 列ずつのページを縦にスライドさせる
    const per = ROWS * 2 + 10, page = Math.floor(tick / per) % pages, t = tick % per;
    const dy = t < ROWS ? ROWS - t : t < ROWS + 10 ? 0 : -(t - ROWS - 10);
    const sgn = m === 2 ? 1 : -1, g = get(page);
    fill((x, y) => g(x, y - sgn * dy));
    return out;
  }
  if (effects[m]) {
    const { length, draw } = effects[m];
    draw(get(Math.floor(tick / length) % pages), tick % length, set);
    return out;
  }
  // 固定（4）など: ページを順に表示する
  const g = get(Math.floor(tick / 20) % pages);
  fill(g);
  return out;
}

/** モード 6〜8 の効果の、1 ページあたりのコマ数。 */
export function effectLength(mode) {
  return effects[Number(mode)] ? effects[Number(mode)].length : 0;
}

/** 点滅と枠アニメを重ねる。 */
export function applyBlinkAndAnts(frame, { blink, ants }, tick) {
  const out = blink && Math.floor(tick / 6) % 2 === 1 ? new Uint8Array(frame.length) : Uint8Array.from(frame);
  if (!ants) return out;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < BADGE_WIDTH; x++) {
    if (y !== 0 && y !== ROWS - 1 && x !== 0 && x !== BADGE_WIDTH - 1) continue;
    // 枠を一周する位置。時計回りに進むよう、上 → 右 → 下 → 左の順に番号を振る。
    const k = y === 0 ? x : x === BADGE_WIDTH - 1 ? BADGE_WIDTH + y : y === ROWS - 1 ? BADGE_WIDTH * 2 + ROWS - x : BADGE_WIDTH * 2 + ROWS * 2 - y;
    out[y * BADGE_WIDTH + x] = (k + tick) % 4 < 2 ? 1 : 0;
  }
  return out;
}
