import assert from "node:assert/strict";
import test from "node:test";

import { newClip } from "../../govee_show/app/goveeshow/static/js/effects.js";
import { PRESET_PALETTES, applyPalette, paletteKeys } from "../../govee_show/app/goveeshow/static/js/palettes.js";

test("presets have unique names and valid colours", () => {
  assert.equal(new Set(PRESET_PALETTES.map((p) => p.name)).size, PRESET_PALETTES.length);
  for (const p of PRESET_PALETTES) {
    assert.ok(p.colors.length >= 1 && p.colors.length <= 12, p.name);
    for (const c of p.colors) assert.match(c, /^#[0-9a-f]{6}$/, p.name);
  }
});

test("applying a palette fills colours in order and leaves backgrounds alone", () => {
  const colors = ["#111111", "#222222", "#333333"];
  const trio = newClip("trio", 0, 1);
  applyPalette(trio, colors);
  assert.deepEqual([trio.color, trio.color2, trio.color3], colors);
  const chase = newClip("chase", 0, 1);
  applyPalette(chase, colors, 4);
  assert.equal(chase.color, "#222222");
  assert.equal(chase.background, "#000000");
  assert.deepEqual(paletteKeys("rainbow"), []);
  assert.equal(applyPalette(newClip("rainbow", 0, 1), colors), 0);
});
