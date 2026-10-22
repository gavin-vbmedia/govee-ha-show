import assert from "node:assert/strict";
import test from "node:test";

import { LAB_TEMPLATES } from "../../govee_show/app/goveeshow/static/js/labtemplates.js";

const bytes = (text) => text.split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));

test("realtime frames carry the count and three bytes per segment", () => {
  const b = bytes(LAB_TEMPLATES.solid.text(3, [255, 0, 16]));
  assert.deepEqual(b, [0xb0, 1, 3, 255, 0, 16, 255, 0, 16, 255, 0, 16]);
  assert.equal(bytes(LAB_TEMPLATES.rainbow.text(44, [0, 0, 0])).length, 3 + 44 * 3);
  assert.equal(LAB_TEMPLATES.razerHeader.length, 14);
});

test("v2 adds a zone byte per segment, 2 after the 36th", () => {
  const b = bytes(LAB_TEMPLATES.v2.text(37, [1, 2, 3]));
  assert.equal(b.length, 3 + 37 * 4);
  assert.deepEqual([b[6], b[b.length - 1]], [1, 2]);
});

test("app segments mask covers every segment", () => {
  assert.equal(LAB_TEMPLATES.appSegments.text(10, [255, 0, 0]), "33 05 15 01 ff 00 00 00 00 00 00 00 ff 03");
});

test("json templates are valid JSON", () => {
  for (const t of Object.values(LAB_TEMPLATES).filter((t) => t.kind === "json")) JSON.parse(t.text(5, [1, 2, 3]));
});

import { windowSweep } from "../../govee_show/app/goveeshow/static/js/labtemplates.js";

test("window sweep: one colour per guess, each asking for the next w bulbs", () => {
  const steps = windowSweep(44);
  assert.equal(new Set(steps.map((s) => s.colour)).size, steps.length);
  assert.ok(steps.every((s) => s.kind === "razer" && s.realtime_on && s.repeat === 30));
  const twoByte = bytes(steps[0].text);
  assert.deepEqual(twoByte.slice(0, 4), [0xb0, 1, 0, 88]);
  assert.equal(twoByte.length, 4 + 88 * 3);
  assert.deepEqual(twoByte.slice(4 + 44 * 3, 4 + 44 * 3 + 3), [255, 0, 0]);
  assert.deepEqual(bytes(steps[1].text).slice(0, 4), [0xb0, 1, 44, 44]);
  assert.equal(bytes(steps[7].text).length, 3 + 44 * 4);
});
