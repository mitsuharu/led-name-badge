import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROWS, Mode, encodeBitmap, brightnessByte, buildHeader, buildPayload, splitReports,
} from '../src/protocol.js';

const blank = (width) => ({ width, px: new Array(width * ROWS).fill(0) });
const DATE = new Date(2026, 10, 27, 9, 8, 7); // 2026-11-27 09:08:07（ローカル時刻）

test('ビットマップは 8 ドット幅の列ごとに上から 11 バイト、MSB が左端になる', () => {
  const bm = blank(16);
  bm.px[0 * 16 + 0] = 1; // 1 列目・1 行目の左端
  bm.px[0 * 16 + 7] = 1; // 1 列目・1 行目の右端
  bm.px[10 * 16 + 8] = 1; // 2 列目・最下行の左端
  const out = encodeBitmap(bm);
  assert.equal(out.length, 22);
  assert.equal(out[0], 0x81);
  assert.deepEqual([...out.slice(1, 11)], new Array(10).fill(0));
  assert.equal(out[11 + 10], 0x80);
});

test('幅が 8 の倍数でない、または大きさが合わないビットマップは拒否する', () => {
  assert.throws(() => encodeBitmap(blank(12)), RangeError);
  assert.throws(() => encodeBitmap({ width: 8, px: [0] }), RangeError);
  assert.throws(() => encodeBitmap({ width: 0, px: [] }), RangeError);
});

test('明るさは 4 段階に丸める', () => {
  assert.equal(brightnessByte(25), 0x40);
  assert.equal(brightnessByte(10), 0x40);
  assert.equal(brightnessByte(50), 0x20);
  assert.equal(brightnessByte(75), 0x10);
  assert.equal(brightnessByte(100), 0x00);
});

test('ヘッダは参照実装（led-name-badge-ls32）と同じバイト列になる', () => {
  const h = buildHeader([
    { width: 88, mode: Mode.FIXED, speed: 4, blink: true, ants: false },
    { width: 16, mode: Mode.SCROLL_RIGHT, speed: 7, blink: false, ants: true },
  ], { brightness: 50, date: DATE });
  // 参照実装の LedNameBadge.header([11, 2], [4, 7], [4, 1], [1, 0], [0, 1], 50, date) の結果
  const expected = [
    0x77, 0x61, 0x6e, 0x67, 0x00, 0x20, 0x01, 0xfe, 0x34, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61,
    0x00, 0x0b, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 26, 11, 27, 9, 8, 7, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
  assert.deepEqual([...h], expected);
});

test('速度は 1〜8、モードは 0〜8 に収める', () => {
  const h = buildHeader([{ width: 8, mode: 99, speed: 0 }], { date: DATE });
  assert.equal(h[8], 0x08);
  const h2 = buildHeader([{ width: 8, mode: -1, speed: 99 }], { date: DATE });
  assert.equal(h2[8], 0x70);
});

test('列数が 256 以上のときは上位バイトに入る', () => {
  const h = buildHeader([{ width: 8 * 300 }], { date: DATE });
  assert.equal(h[16], 1);
  assert.equal(h[17], 300 - 256);
});

test('メッセージが 0 件または 9 件以上なら拒否する', () => {
  assert.throws(() => buildHeader([], { date: DATE }), RangeError);
  assert.throws(() => buildHeader(new Array(9).fill({ width: 8 }), { date: DATE }), RangeError);
});

test('送信データはヘッダの後にメッセージ順でビットマップが続き、64 バイト境界までゼロで埋める', () => {
  const a = blank(8); a.px.fill(1);
  const b = blank(8); b.px[0] = 1;
  const buf = buildPayload([{ bitmap: a }, { bitmap: b }], { date: DATE });
  assert.equal(buf.length, 128);
  assert.deepEqual([...buf.slice(64, 75)], new Array(11).fill(0xff));
  assert.equal(buf[75], 0x80);
  assert.deepEqual([...buf.slice(86)], new Array(128 - 86).fill(0));
});

test('ちょうど 64 バイト境界に収まるときは余分に埋めない', () => {
  // 11 バイト × 64 列 = 704 バイト = 11 レポート分。ヘッダと合わせて 768 バイト。
  const buf = buildPayload([{ bitmap: blank(8 * 64) }], { date: DATE });
  assert.equal(buf.length, 768);
});

test('8192 バイトを超えるデータは拒否する', () => {
  // (8192 - 64) / 11 = 738.9 列までは入り、739 列は入らない
  assert.doesNotThrow(() => buildPayload([{ bitmap: blank(8 * 738) }], { date: DATE }));
  assert.throws(() => buildPayload([{ bitmap: blank(8 * 739) }], { date: DATE }), RangeError);
});

test('64 バイトずつのレポートに分け、揃っていないデータは拒否する', () => {
  const reports = splitReports(new Uint8Array(192));
  assert.equal(reports.length, 3);
  assert.ok(reports.every((r) => r.length === 64));
  assert.throws(() => splitReports(new Uint8Array(65)), RangeError);
});
