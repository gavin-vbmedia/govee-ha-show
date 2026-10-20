import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS, bake, newClip, renderTrack } from "../../govee_show/app/goveeshow/static/js/effects.js";

const px = (buf, i) => [...buf.subarray(i * 3, i * 3 + 3)];

test("every effect renders valid bytes across a clip", () => {
  for (const key of Object.keys(EFFECTS)) {
    const clip = newClip(key, 1, 3);
    for (let t = 1; t < 3; t += 0.1) {
      const out = renderTrack([clip], t, 12);
      assert.equal(out.length, 36);
      for (const v of out) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${key} produced ${v}`);
    }
  }
});

test("segments outside clips are black and later clips win", () => {
  const red = { ...newClip("solid", 0, 2), color: "#ff0000" };
  const blue = { ...newClip("solid", 1, 2), color: "#0000ff" };
  assert.deepEqual(px(renderTrack([red, blue], 0.5, 1), 0), [255, 0, 0]);
  assert.deepEqual(px(renderTrack([red, blue], 1.5, 1), 0), [0, 0, 255]);
  assert.deepEqual(px(renderTrack([red, blue], 2.5, 1), 0), [0, 0, 0]);
});

test("fade interpolates and wipe fills in order", () => {
  const fade = { ...newClip("fade", 0, 2), from: "#000000", to: "#ff0000" };
  assert.deepEqual(px(renderTrack([fade], 1, 1), 0), [128, 0, 0]);
  const wipe = { ...newClip("wipe", 0, 4), color: "#ffffff", background: "#000000" };
  const half = renderTrack([wipe], 2, 4);
  assert.deepEqual([px(half, 0), px(half, 1), px(half, 2), px(half, 3)],
    [[255, 255, 255], [255, 255, 255], [0, 0, 0], [0, 0, 0]]);
});

test("twinkle is deterministic so bakes are repeatable", () => {
  const clip = newClip("twinkle", 0, 10);
  assert.deepEqual(renderTrack([clip], 3.3, 20), renderTrack([clip], 3.3, 20));
});

test("bake writes the GVSF layout the player reads", () => {
  const show = { duration: 1, tracks: [
    { device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#010203" }] },
    { device: "gone", clips: [] },
  ] };
  const blob = bake(show, { a: { segments: 2 } }, 10);
  assert.equal(new TextDecoder().decode(blob.subarray(0, 4)), "GVSF");
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header, { fps: 10, frames: 10, tracks: [{ device: "a", segments: 2 }] });
  assert.equal(blob.length, 9 + hlen + 10 * 6);
  assert.deepEqual([...blob.subarray(9 + hlen, 9 + hlen + 6)], [1, 2, 3, 1, 2, 3]);
});
