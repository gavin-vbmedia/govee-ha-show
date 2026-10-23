import assert from "node:assert/strict";
import test from "node:test";

import { buildContext, checkClips, placeClips } from "../../haliday_show/app/halidayshow/static/js/aiclips.js";
import { HOUSE } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const lights = [
  { name: "House", trackIndex: 0, segments: 0, house: true },
  { name: "Roof", trackIndex: 1, segments: 20 },
  { name: "Tree", trackIndex: 2, segments: 15 },
];
const show = () => ({
  beats: [0.5, 1, 1.5], bars: [0.5], sections: [{ start: 0, end: 30, label: "Song", energy: 0.5 }], tempo: 120,
  tracks: [
    { device: HOUSE, clips: [] },
    { device: "roof", clips: [{ effect: "solid", start: 0, end: 10, color: "#ff0000" }] },
    { device: "tree", clips: [] },
  ],
});

test("the context lists lights, effects with their settings, the song and the selection", () => {
  const ctx = buildContext({ show: show(), lights, duration: 30, selection: { start: 2, end: 4, lights: ["Roof"] },
    palettes: [{ name: "Christmas", colors: ["#ff0000"] }] });
  assert.deepEqual(ctx.lights.map((l) => l.name), ["House", "Roof", "Tree"]);
  assert.equal(ctx.lights[0].house, true);
  const chase = ctx.effects.find((e) => e.key === "chase");
  assert.ok(chase.settings.some((s) => s.key === "speed" && s.min === 0.05 && s.max === 10));
  assert.ok(ctx.effects.find((e) => e.key === "sweep").house);
  assert.ok(!ctx.effects.some((e) => e.key === "scene"));
  assert.equal(ctx.song.tempo, 120);
  assert.deepEqual(ctx.song.sections, [{ start: 0, end: 30, label: "Song", energy: 0.5 }]);
  assert.deepEqual(ctx.selection, { start: 2, end: 4, lights: ["Roof"] });
  assert.deepEqual(ctx.clips.Roof, [{ start: 0, end: 10, effect: "solid" }]);
});

test("checks names, effects, times and settings", () => {
  const reply = { clips: [
    { light: "roof", start: 2, end: 6, effect: "chase", settings: [
      { key: "color", value: "00FF00" }, { key: "speed", value: "99" }, { key: "direction", value: "Reverse" },
      { key: "bogus", value: "1" }, { key: "width", value: "wide" }] },
    { light: "Garage", start: 0, end: 1, effect: "solid", settings: [] },
    { light: "Tree", start: 0, end: 1, effect: "laser", settings: [] },
    { light: "Tree", start: 0, end: 1, effect: "sweep", settings: [] },
    { light: "House", start: 25, end: 40, effect: "sweep", settings: [] },
    { light: "Tree", start: 5, end: 5, effect: "solid", settings: [] },
  ] };
  const { placed, skipped } = checkClips(reply, lights, 30);
  assert.equal(placed.length, 2);
  const chase = placed[0].clip;
  assert.equal(placed[0].trackIndex, 1);
  assert.equal(chase.color, "#00ff00");
  assert.equal(chase.speed, 10); // clamped
  assert.equal(chase.direction, "reverse");
  assert.equal(chase.width, 2); // invalid value keeps the default
  assert.ok(!("bogus" in chase));
  assert.deepEqual([placed[1].clip.start, placed[1].clip.end], [25, 30]);
  assert.equal(skipped.length, 4);
});

test("new clips replace what was there, but not each other", () => {
  const s = show();
  const { placed } = checkClips({ clips: [
    { light: "Roof", start: 2, end: 6, effect: "pulse", settings: [] },
    { light: "Roof", start: 4, end: 8, effect: "twinkle", settings: [] },
  ] }, lights, 30);
  placeClips(s, placed);
  const roof = s.tracks[1].clips.map((c) => [c.effect, c.start, c.end]);
  assert.deepEqual(roof, [["solid", 0, 2], ["solid", 8, 10], ["pulse", 2, 6], ["twinkle", 4, 8]]);
  assert.deepEqual(s.tracks[2].clips, []);
});

test("copes with a reply that has no clips", () => {
  assert.deepEqual(checkClips({ summary: "Can't" }, lights, 30), { placed: [], skipped: [] });
  assert.deepEqual(checkClips(null, lights, 30), { placed: [], skipped: [] });
});

test("presets from the AI keep valid settings only, clamped, and skip unknown effects", async () => {
  const { checkPresets } = await import("../../haliday_show/app/halidayshow/static/js/aiclips.js");
  const { presets, skipped } = checkPresets({ presets: [
    { name: "Icy shimmer", effect: "twinkle", settings: [
      { key: "density", value: "500" }, { key: "color", value: "88ccff" }, { key: "nope", value: "1" }] },
    { name: "", effect: "chase", settings: [] },
    { name: "Bad", effect: "bogus", settings: [] },
  ] });
  assert.equal(presets.length, 2);
  assert.equal(presets[0].name, "Icy shimmer");
  assert.equal(presets[0].params.color, "#88ccff");
  assert.ok(presets[0].params.density <= 100);
  assert.ok(!("nope" in presets[0].params));
  assert.equal(presets[1].name, "AI chase");
  assert.deepEqual(presets[1].params, {});
  assert.equal(skipped.length, 1);
});

test("section notes go to the AI; section colours don't", () => {
  const sh = show();
  sh.sections = [{ start: 0, end: 30, label: "Chorus", energy: 0.9, color: "#ff00aa", notes: "big drop, everything flashes" }];
  const ctx = buildContext({ show: sh, lights, duration: 30 });
  assert.deepEqual(ctx.song.sections, [{ start: 0, end: 30, label: "Chorus", energy: 0.9, notes: "big drop, everything flashes" }]);
});

test("slow lights are marked for the AI", () => {
  const ctx = buildContext({ show: show(), lights: [...lights, { name: "Pillars", trackIndex: 2, segments: 300, slow: true }],
    duration: 30 });
  assert.equal(ctx.lights.find((l) => l.name === "Pillars").slow, true);
  assert.equal(ctx.lights.find((l) => l.name === "Roof").slow, undefined);
});

test("palettes from the AI keep valid colours only, up to 12, and skip ones with too few", async () => {
  const { checkPalettes } = await import("../../haliday_show/app/halidayshow/static/js/aiclips.js");
  const { palettes, skipped } = checkPalettes({ palettes: [
    { name: " Frosty night ", colors: ["#FFFFFF", "88ccff", "blue", "#0000ff"] },
    { name: "", colors: Array.from({ length: 20 }, () => "#ff0000") },
    { name: "Lonely", colors: ["#ff0000"] },
    { colors: "nope" },
  ] });
  assert.equal(palettes.length, 2);
  assert.deepEqual(palettes[0], { name: "Frosty night", colors: ["#ffffff", "#88ccff", "#0000ff"] });
  assert.equal(palettes[1].name, "AI palette");
  assert.equal(palettes[1].colors.length, 12);
  assert.equal(skipped.length, 2);
  assert.deepEqual(checkPalettes(null), { palettes: [], skipped: [] });
});
