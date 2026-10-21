import assert from "node:assert/strict";
import test from "node:test";

import {
  arrange, cut, editName, encodeWav, insert, joins, keep, merge, render,
} from "../../govee_show/app/goveeshow/static/js/music.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} != ${b}`);
const song = [{ src: "a", start: 0, end: 60 }];

test("cutting without a crossfade removes exactly the selection", () => {
  const p = cut(song, 0, 10, 20);
  assert.deepEqual(p, [{ src: "a", start: 0, end: 10 }, { src: "a", start: 20, end: 60 }]);
  near(arrange(p, 0).total, 50);
  assert.deepEqual(joins(p, 0), [10]);
});

test("a crossfade overlaps the join and shortens the result by its length", () => {
  const p = cut(song, 1, 10, 20);
  near(arrange(p, 1).total, 49);
  near(joins(p, 1)[0], 9.5);
});

test("later edits leave untouched joins exactly as they were", () => {
  const xf = 0.5;
  let p = cut(song, xf, 10, 20);
  const before = structuredClone(p);
  const total = arrange(p, xf).total;
  p = cut(p, xf, total - 5, total);
  assert.deepEqual(p[0], before[0]);
  near(p[1].start, before[1].start);
  near(arrange(p, xf).total, total - 5);
});

test("keeping a selection shortens the song to it", () => {
  assert.deepEqual(keep(song, 0, 5, 35), [{ src: "a", start: 5, end: 35 }]);
});

test("inserting splits at the playhead and putting the cut back merges it", () => {
  const p = insert(song, 0, 30, [{ src: "b", start: 0, end: 10 }]);
  assert.deepEqual(p.map((x) => x.src), ["a", "b", "a"]);
  near(arrange(p, 0).total, 70);
  assert.deepEqual(cut(p, 0, 30, 40), song);
  assert.deepEqual(merge([{ src: "a", start: 0, end: 5 }, { src: "a", start: 5, end: 9 }]), [{ src: "a", start: 0, end: 9 }]);
});

test("render places pieces, crossfades at constant power and fades the ends", () => {
  const rate = 100;
  const a = [new Float32Array(1000).fill(0.5)], b = [new Float32Array(1000).fill(0.5)];
  const pieces = [{ src: "a", start: 0, end: 5 }, { src: "b", start: 0, end: 5 }];
  const [out] = render(pieces, { a, b }, rate, { crossfade: 1, fadeIn: 1, fadeOut: 0 });
  assert.equal(out.length, 900);
  near(out[0], 0, "fade in starts silent");
  near(out[200], 0.5, "full level");
  // Equal-power gains sum to more than 1 mid-crossfade for identical signals, never to silence.
  assert.ok(out[450] > 0.5 && out[450] < 0.75);
});

test("mono pieces fill both channels of a stereo result", () => {
  const out = render([{ src: "m", start: 0, end: 1 }, { src: "s", start: 0, end: 1 }],
    { m: [new Float32Array(10).fill(0.25)], s: [new Float32Array(10), new Float32Array(10)] }, 10);
  assert.equal(out.length, 2);
  near(out[1][3], 0.25);
});

test("WAV header describes the data", () => {
  const buf = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 48000);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 12);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getInt16(46, true), 0x3fff);
  assert.equal(v.getInt16(48, true), 0x7fff);
  assert.equal(v.getInt16(52, true), -0x8000);
});

test("edited copies get a fresh name", () => {
  assert.equal(editName("songs/Jingle.mp3"), "Jingle (edit).wav");
  assert.equal(editName("govee_show/Jingle (edit).wav", ["govee_show/Jingle (edit).wav"]), "Jingle (edit 2).wav");
});
