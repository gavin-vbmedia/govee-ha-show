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

test("two and three colours split the light or alternate along it", () => {
  const colours = (buf, n) => Array.from({ length: n }, (_, i) => px(buf, i)[0]);
  const duo = { ...newClip("duo", 0, 1), color: "#010000", color2: "#020000" };
  assert.deepEqual(colours(renderTrack([duo], 0, 4), 4), [1, 1, 2, 2]);
  const trio = { ...newClip("trio", 0, 1), color: "#010000", color2: "#020000", color3: "#030000" };
  assert.deepEqual(colours(renderTrack([trio], 0, 7), 7), [1, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(colours(renderTrack([{ ...trio, layout: "alternate", size: 2 }], 0, 7), 7), [1, 1, 2, 2, 3, 3, 1]);
});

test("two and three colours move along the light as a marquee", () => {
  const colours = (buf, n) => Array.from({ length: n }, (_, i) => px(buf, i)[0]);
  const duo = { ...newClip("duo", 0, 2), color: "#010000", color2: "#020000", layout: "alternate", speed: 1 };
  assert.deepEqual(colours(renderTrack([duo], 0, 4), 4), [1, 2, 1, 2]);
  assert.deepEqual(colours(renderTrack([duo], 1, 4), 4), [2, 1, 2, 1]);
});

test("pulse, gradient and colour cycle blend between their colours", () => {
  const pulse = { ...newClip("pulse", 0, 2), color: "#ff0000", background: "#000000", rate: 1 };
  assert.deepEqual(px(renderTrack([pulse], 0, 1), 0), [0, 0, 0]);
  assert.deepEqual(px(renderTrack([pulse], 0.5, 1), 0), [255, 0, 0]);
  const grad = { ...newClip("gradient", 0, 2), color: "#000000", color2: "#ff0000", count: "2" };
  const g = renderTrack([grad], 0, 3);
  assert.deepEqual([px(g, 0)[0], px(g, 1)[0], px(g, 2)[0]], [0, 128, 255]);
  const cycle = { ...newClip("cycle", 0, 4), color: "#010000", color2: "#020000", count: "2", blend: "step" };
  assert.deepEqual([0.5, 1.5, 2.5].map((t) => px(renderTrack([cycle], t, 1), 0)[0]), [1, 2, 1]);
});

test("comet has a fading tail and scanner bounces between the ends", () => {
  const comet = { ...newClip("comet", 0, 2), color: "#ff0000", background: "#000000", length: 2, speed: 0.25 };
  const c = renderTrack([comet], 1, 8); // head at segment 2
  assert.deepEqual([px(c, 2)[0], px(c, 1)[0], px(c, 0)[0], px(c, 3)[0]], [255, 128, 0, 0]);
  const scan = { ...newClip("scanner", 0, 5), color: "#ff0000", width: 1, speed: 0.5 };
  assert.equal(px(renderTrack([scan], 0, 5), 0)[0], 255);
  assert.equal(px(renderTrack([scan], 2, 5), 4)[0], 255);
  assert.equal(px(renderTrack([scan], 4, 5), 0)[0], 255);
});

test("lightning strikes at roughly its rate and is otherwise the background", () => {
  const clip = { ...newClip("lightning", 0, 1000), rate: 1 };
  let strikes = 0;
  for (let t = 0; t < 1000; t += 0.1) if (px(renderTrack([clip], t + 0.001, 1), 0)[0] > 200) strikes++;
  assert.ok(strikes > 800 && strikes < 1200, `${strikes} strikes in 1000 s`);
  assert.deepEqual(px(renderTrack([clip], 0.099, 1), 0).slice(0, 2), [0, 0]);
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

test("every effect has a brightness slider that scales its output", () => {
  for (const key of Object.keys(EFFECTS)) {
    assert.equal(EFFECTS[key].params.filter((p) => p.key === "brightness").length, 1, key);
  }
  const clip = { ...newClip("solid", 0, 1), color: "#ff8000", brightness: 50 };
  assert.deepEqual(px(renderTrack([clip], 0.5, 1), 0), [128, 64, 0]);
  // An older rainbow clip saved with its own brightness keeps that level.
  const rainbow = { ...newClip("rainbow", 0, 1), speed: 0, brightness: 40 };
  assert.deepEqual(px(renderTrack([rainbow], 0, 4), 0), [102, 0, 0]);
});
