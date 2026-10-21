import assert from "node:assert/strict";
import test from "node:test";

import { EFFECTS, HOUSE, applyHouse, bake, composeLight, newClip, renderTrack } from "../../govee_show/app/goveeshow/static/js/effects.js";

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
    if (EFFECTS[key].experimental) continue; // Govee scenes set their own brightness
    assert.equal(EFFECTS[key].params.filter((p) => p.key === "brightness").length, 1, key);
  }
  const clip = { ...newClip("solid", 0, 1), color: "#ff8000", brightness: 50 };
  assert.deepEqual(px(renderTrack([clip], 0.5, 1), 0), [128, 64, 0]);
  // An older rainbow clip saved with its own brightness keeps that level.
  const rainbow = { ...newClip("rainbow", 0, 1), speed: 0, brightness: 40 };
  assert.deepEqual(px(renderTrack([rainbow], 0, 4), 0), [102, 0, 0]);
});

test("Govee scene clips are listed in the baked header", () => {
  const show = { duration: 2, tracks: [{ device: "a", clips: [
    { ...newClip("scene", 0.5, 1.5), scene: "Forest", code: 212, param: "AQID" },
    newClip("scene", 1.5, 2), // no scene picked yet: left out
  ] }] };
  const blob = bake(show, { a: { segments: 3 } });
  const len = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + len)));
  assert.deepEqual(header.scenes, [{ track: 0, start: 20, end: 60, code: 212, param: "AQID" }]);
});

test("House effects colour each segment by where it is on the house", () => {
  // Three segments at the left, middle and right of the house; one off the photo.
  const pos = [[0, 0.5], [0.5, 0.5], [1, 0.5], null];
  const at = (clip, time) => {
    const out = new Uint8Array(12).fill(9); // the light's own colour, 9 9 9
    return [0, 1, 2, 3].map((i) => px(applyHouse([clip], time, pos, out), i));
  };
  // A wipe from the left just past halfway: left and middle lit, right still background.
  const wipe = { ...newClip("housewipe", 0, 2), color: "#ff0000", soft: 0.01 };
  assert.deepEqual(at(wipe, 1.1), [[255, 0, 0], [255, 0, 0], [0, 0, 0], [9, 9, 9]]);
  // Wiping over the lights' own effects leaves them where the wipe hasn't reached.
  assert.deepEqual(at({ ...wipe, outside: "lights' own effects" }, 0.6)[2], [9, 9, 9]);
  // A sweep's band crosses from left to right, so the middle is lit mid-clip and the ends aren't.
  const sweep = { ...newClip("sweep", 0, 2), width: 0.2 };
  const mid = at(sweep, 1);
  assert.deepEqual(mid[1], [255, 255, 255]);
  assert.deepEqual(mid[0], [0, 0, 0]);
  assert.deepEqual(mid[2], [0, 0, 0]);
  // Right to left reaches the right end first.
  assert.ok(at({ ...sweep, direction: "right to left" }, 0.4)[2][0] > at(sweep, 0.4)[2][0]);
});

test("House effects only go on the House lane and show as a strip elsewhere", () => {
  for (const key of ["sweep", "housewipe", "wave"]) {
    assert.ok(EFFECTS[key].house, key);
    const buf = renderTrack([newClip(key, 0, 2)], 1, 10);
    assert.ok(buf.every((v) => v >= 0 && v <= 255), key);
  }
});

test("the bake lays the House lane over every light with a position", () => {
  const show = { duration: 1, tracks: [
    { device: HOUSE, clips: [{ ...newClip("housewipe", 0, 1), color: "#00ff00", soft: 0.01 }] },
    { device: "a", clips: [{ ...newClip("solid", 0, 1), color: "#0000ff" }] },
    { device: "b", clips: [{ ...newClip("solid", 0, 1), color: "#0000ff" }] },
  ] };
  const devices = { a: { segments: 2 }, b: { segments: 1 } };
  // a's first segment is at the far left, its second off the photo; b isn't traced.
  const blob = bake(show, devices, 10, { a: [[0, 0], null] });
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header.tracks.map((t) => t.device), ["a", "b"]);
  const frame5 = blob.subarray(9 + hlen + 5 * 9, 9 + hlen + 6 * 9);
  assert.deepEqual([...frame5], [0, 255, 0, 0, 0, 255, 0, 0, 255]);
});

test("presets only name settings their effect has, and keep the clip's colours", async () => {
  const { PRESETS, presetParams, matchesPreset } = await import("../../govee_show/app/goveeshow/static/js/effects.js");
  for (const [key, presets] of Object.entries(PRESETS)) {
    const keys = new Set(EFFECTS[key].params.map((p) => p.key));
    for (const preset of presets) for (const k of Object.keys(preset.params)) assert.ok(keys.has(k), `${key}: ${k}`);
  }
  const clip = { ...newClip("trio", 0, 2), color: "#123456" };
  const marquee = PRESETS.trio.find((p) => p.label === "Slow marquee");
  Object.assign(clip, presetParams(marquee, clip));
  assert.equal(clip.color, "#123456");
  assert.equal(clip.layout, "alternate");
  assert.ok(matchesPreset(marquee, clip));
  const fade = { ...newClip("fade", 0, 2), from: "#000000", to: "#ff0000" };
  Object.assign(fade, presetParams(PRESETS.fade.find((p) => p.label === "Fade out"), fade));
  assert.deepEqual([fade.from, fade.to], ["#ff0000", "#000000"]);
});

test("a light split into parts bakes as one light, with unused segments off", () => {
  const roof = { id: "roof", segments: 10, parts: [{ id: "a", from: 2, to: 4 }, { id: "b", from: 7, to: 8 }] };
  const devices = {
    roof,
    "roof#a": { id: "roof#a", parent: "roof", from: 2, to: 4, segments: 3 },
    "roof#b": { id: "roof#b", parent: "roof", from: 7, to: 8, segments: 2 },
  };
  const solid = (color, start = 0, end = 1) => ({ ...newClip("solid", start, end), color });
  const show = { duration: 1, tracks: [
    { device: "roof", clips: [solid("#ffffff")] }, // all parts at once
    { device: "roof#a", clips: [solid("#ff0000", 0.5, 1)] }, // wins on its part from 0.5 s
    { device: "roof#b", clips: [solid("#0000ff")] },
  ] };
  const blob = bake(show, devices, 10);
  const hlen = new DataView(blob.buffer).getUint32(5);
  const header = JSON.parse(new TextDecoder().decode(blob.subarray(9, 9 + hlen)));
  assert.deepEqual(header.tracks, [{ device: "roof", segments: 10 }]);
  const frameAt = (f) => {
    const frame = [...blob.subarray(9 + hlen + f * 30, 9 + hlen + (f + 1) * 30)];
    return (i) => frame.slice(i * 3, i * 3 + 3);
  };
  const white = [255, 255, 255], red = [255, 0, 0], blue = [0, 0, 255], off = [0, 0, 0];
  let seg = frameAt(0);
  assert.deepEqual([seg(0), seg(1), seg(3), seg(4), seg(5), seg(6), seg(7), seg(9)], [off, white, white, off, off, blue, blue, off]);
  seg = frameAt(6);
  assert.deepEqual([seg(0), seg(1), seg(2), seg(3), seg(4), seg(6), seg(9)], [off, red, red, red, off, blue, off]);
});

test("the whole of a split light runs across its parts joined together", () => {
  const roof = { id: "roof", segments: 6, parts: [{ id: "a", from: 1, to: 2 }, { id: "b", from: 5, to: 6 }] };
  const ramp = { ...newClip("gradient", 0, 1), color: "#ff0000", color2: "#0000ff", count: "2" };
  const out = composeLight(roof, (id) => (id === "roof" ? { clips: [ramp] } : undefined), 0);
  const rgb = (i) => [...out.slice(i * 3, i * 3 + 3)];
  assert.deepEqual([rgb(2), rgb(3)], [[0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(rgb(0).slice(0, 1), [255]); // starts red
  assert.equal(rgb(5)[2] > rgb(5)[0], true); // ends blue, with no gap where 3 and 4 are skipped
});
