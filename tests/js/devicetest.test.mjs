import assert from "node:assert/strict";
import test from "node:test";

import { partsFrame } from "../../govee_show/app/goveeshow/static/js/devicetest.js";
import { partRgb } from "../../govee_show/app/goveeshow/static/js/house.js";

const light = { segments: 8, parts: [{ id: "a", from: 2, to: 4 }, { id: "b", from: 6, to: 7 }] };
const seg = (frame, s) => Array.from(frame.slice((s - 1) * 3, s * 3));

test("every part lit in its colour, starting white, unused segments off", () => {
  const f = partsFrame(light);
  assert.equal(f.length, 24);
  assert.deepEqual([1, 5, 8].map((s) => seg(f, s)), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(seg(f, 2), [255, 255, 255]);
  assert.deepEqual([seg(f, 3), seg(f, 4)], [partRgb(0), partRgb(0)]);
  assert.deepEqual([seg(f, 6), seg(f, 7)], [[255, 255, 255], partRgb(1)]);
});

test("one part on its own", () => {
  const f = partsFrame(light, "b");
  assert.deepEqual([2, 3, 4].map((s) => seg(f, s)), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(seg(f, 7), partRgb(1));
});

test("parts past the end of a shortened light are cut off", () => {
  assert.equal(partsFrame({ segments: 3, parts: [{ id: "a", from: 2, to: 9 }] }).length, 9);
  assert.equal(partsFrame({ segments: 2 }).every((v) => v === 0), true);
});
