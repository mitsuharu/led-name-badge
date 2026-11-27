import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROWS, BADGE_WIDTH } from '../src/protocol.js';
import {
  ANIMATION_FRAME_WIDTH, APPROXIMATE_MODES, effectLength, frameInterval, pageCount, renderFrame, applyBlinkAndAnts,
} from '../src/preview.js';

const blank = (width) => ({ width, px: new Array(width * ROWS).fill(0) });
const lit = (frame) => { const s = new Set(); frame.forEach((v, i) => v && s.add(`${i % BADGE_WIDTH},${Math.floor(i / BADGE_WIDTH)}`)); return s; };
const count = (frame) => frame.reduce((n, v) => n + v, 0);
// 指定した列のすべての行を点灯させたビットマップ
const columns = (width, cols) => { const bm = blank(width); for (const c of cols) for (let y = 0; y < ROWS; y++) bm.px[y * width + c] = 1; return bm; };

test('アニメーションは 48 列ごとのコマを左から順に表示し、最後のコマの次は最初に戻る', () => {
  const bm = columns(ANIMATION_FRAME_WIDTH * 3, [0, 48 + 5, 96 + 43, 96 + 44]);
  assert.deepEqual([...lit(renderFrame(bm, 5, 0))].filter((k) => k.endsWith(',0')), ['0,0']);
  assert.deepEqual([...lit(renderFrame(bm, 5, 1))].filter((k) => k.endsWith(',0')), ['5,0']);
  // 各コマの左 44 列だけが見え、45 列目以降（44〜47）は見えない
  assert.deepEqual([...lit(renderFrame(bm, 5, 2))].filter((k) => k.endsWith(',0')), ['43,0']);
  assert.deepEqual(renderFrame(bm, 5, 3), renderFrame(bm, 5, 0));
});

test('アニメーションの 1 コマの長さは速度に応じて約 1.2〜15 コマ/秒になる', () => {
  assert.equal(frameInterval(5, 1), Math.round(1000 / 1.2));
  assert.equal(frameInterval(5, 8), Math.round(1000 / 15));
  assert.ok(frameInterval(5, 4) > frameInterval(5, 5));
  assert.equal(frameInterval(5, 99), frameInterval(5, 8));
});

test('44 列以下は 1 ページで、44 列を超えると 44 列ずつのページに分かれる', () => {
  assert.equal(pageCount(8), 1);
  assert.equal(pageCount(44), 1);
  assert.equal(pageCount(45), 2);
  assert.equal(pageCount(88), 2);
});

test('固定表示は 44 列以下のビットマップを中央に寄せる', () => {
  const bm = columns(8, [0]);
  assert.deepEqual([...lit(renderFrame(bm, 4, 0))].filter((k) => k.endsWith(',0')), [`${(BADGE_WIDTH - 8) / 2},0`]);
});

test('おおよその動きのモードは 6〜8 で、スクロール・固定・アニメーションは含まない', () => {
  assert.deepEqual([...APPROXIMATE_MODES].sort(), [6, 7, 8]);
});

for (const mode of [6, 7, 8]) {
  test(`モード ${mode} はほぼ空の画面から始まり、途中で固定表示と同じ画面になり、最後はほぼ空の画面で終わる`, () => {
    // レーザーは点灯した列から光線が伸びるため、端の列を点灯させない
    const bm = columns(44, [30]);
    const len = effectLength(mode), still = renderFrame(bm, 4, 0);
    assert.ok(len > 0);
    // カーテンの線など、効果そのものの点灯は残ってよいため「ほぼ空」は線 2 本分までとする
    assert.ok(count(renderFrame(bm, mode, 0)) <= ROWS * 2, '最初はほとんど表示されていない');
    assert.ok(count(renderFrame(bm, mode, len - 1)) <= ROWS * 2, '最後はほとんど表示されていない');
    const frames = Array.from({ length: len }, (_, t) => renderFrame(bm, mode, t));
    assert.ok(frames.some((f) => f.every((v, i) => v === still[i])), '途中で固定表示と同じ画面になる');
    assert.deepEqual(renderFrame(bm, mode, len), renderFrame(bm, mode, 0), '1 ページなら同じ効果を繰り返す');
  });
}

test('降ってくる（6）は、最初に一番下の行から落ちてくる', () => {
  const bm = blank(44); bm.px.fill(1);
  assert.deepEqual([...lit(renderFrame(bm, 6, 0))].map((k) => k.split(',')[1]).filter((v, i, a) => a.indexOf(v) === i), ['0']);
  // 一番下の行は最下段に着いたら止まり、ほかの行はまだ上にある
  const f = renderFrame(bm, 6, ROWS - 1);
  assert.equal(f[(ROWS - 1) * BADGE_WIDTH], 1);
});

test('カーテン（7）は中央の 2 本の線から始まる', () => {
  const bm = blank(44);
  const f = renderFrame(bm, 7, 0);
  assert.deepEqual([...lit(f)].map((k) => k.split(',')[0]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['21', '22']);
});

test('レーザー（8）は描いている列で点灯している行から右端まで光線を伸ばす', () => {
  const bm = blank(44); bm.px[3 * 44 + 10] = 1; // 4 行目・11 列目だけ点灯
  const f = renderFrame(bm, 8, 10);
  for (let x = 0; x < BADGE_WIDTH; x++) assert.equal(f[3 * BADGE_WIDTH + x], x >= 10 ? 1 : 0, `x=${x}`);
  assert.equal(count(f), BADGE_WIDTH - 10);
});

test('44 列を超える効果は、44 列ずつのページごとに効果を繰り返す', () => {
  const bm = columns(88, [0, 44 + 1]);
  const len = effectLength(7), mid = len / 2; // 全体を表示している途中のコマ
  const row0 = (t) => [...lit(renderFrame(bm, 7, t))].filter((k) => k.endsWith(',0'));
  assert.deepEqual(row0(mid), ['0,0']);
  assert.deepEqual(row0(len + mid), ['1,0']);
  assert.deepEqual(row0(2 * len + mid), ['0,0']);
});

test('点滅は 6 コマごとに消え、枠アニメは外周だけを上書きする', () => {
  const full = new Uint8Array(BADGE_WIDTH * ROWS).fill(1);
  assert.equal(count(applyBlinkAndAnts(full, { blink: true }, 0)), full.length);
  assert.equal(count(applyBlinkAndAnts(full, { blink: true }, 6)), 0);
  const ants = applyBlinkAndAnts(new Uint8Array(full.length), { ants: true }, 0);
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < BADGE_WIDTH - 1; x++) assert.equal(ants[y * BADGE_WIDTH + x], 0);
  assert.ok(count(ants) > 0);
});
