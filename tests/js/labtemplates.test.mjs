import assert from "node:assert/strict";
import test from "node:test";

import { LAB_TEMPLATES } from "../../haliday_show/app/halidayshow/static/js/labtemplates.js";

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

import { windowSweep } from "../../haliday_show/app/halidayshow/static/js/labtemplates.js";

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

import { startSweep } from "../../haliday_show/app/halidayshow/static/js/labtemplates.js";

test("switch-on sweep: each guess sends its set-up, then the usual rainbow", () => {
  const steps = startSweep(44);
  assert.equal(steps.length, 7);
  for (const s of steps) {
    assert.ok(s.before.length >= 1 && s.before.every((b) => ["razer", "ptreal"].includes(b.kind)));
    assert.equal(bytes(s.text).length, 3 + 44 * 3);
  }
  // Guesses that replace "realtime on" send their own enable; the others switch realtime on as usual.
  assert.deepEqual(bytes(steps[2].before[0].text), [0xb1, 1, 44]);
  assert.equal(steps[2].realtime_on, false);
  assert.ok(steps[4].realtime_on && steps[4].before[0].kind === "ptreal");
});

import { SETTLE, flagSweep, modeSweep } from "../../haliday_show/app/halidayshow/static/js/labtemplates.js";

test("flag sweep: a whole frame of its own colour for each untried flag", () => {
  const steps = flagSweep(44);
  assert.deepEqual(steps.map((s) => bytes(s.text)[1]), [0x03, 0x04, 0x05, 0x08, 0x10, 0x20, 0x40, 0x80, 0xff]);
  assert.equal(new Set(steps.map((s) => s.colour)).size, steps.length);
  for (const s of steps) {
    assert.ok(s.kind === "razer" && s.realtime_on && s.repeat === 30 && s.interval_ms === 100);
    const b = bytes(s.text);
    assert.deepEqual([b[0], b[2], b.length], [0xb0, 44, 3 + 44 * 3]);
    assert.deepEqual(b.slice(3, 6), b.slice(-3)); // one colour along the whole frame
    assert.ok(s.label.startsWith(`${s.colour}: flag `));
  }
});

test("mode sweep: each app mode but 00 and 0a first, then a frame, then back to plain", () => {
  const steps = modeSweep(44);
  const modes = steps.map((s) => bytes(s.before[0].text));
  assert.equal(steps.length, 20);
  assert.ok(modes.every((m) => m.length === 3 && m[0] === 0x33 && m[1] === 0x05));
  assert.deepEqual(modes.map((m) => m[2]), [...Array(0x15).keys()].map((i) => i + 1).filter((m) => m !== 0x0a));
  assert.equal(new Set(steps.map((s) => s.colour)).size, 20);
  assert.ok(!steps.some((s) => s.colour === "white")); // white is what's shown between steps
  for (const s of steps) {
    assert.ok(s.before[0].kind === "ptreal" && s.realtime_on && s.repeat === 30);
    assert.deepEqual(bytes(s.text).slice(0, 3), [0xb0, 1, 44]);
    assert.equal(bytes(s.text).length, 3 + 44 * 3);
    assert.deepEqual(s.after, [{ kind: "razer", text: "b1 00" }, { kind: "json", text: SETTLE }]);
  }
  assert.equal(JSON.parse(SETTLE).msg.cmd, "colorwc");
});

import { sweepWindow } from "../../haliday_show/app/halidayshow/static/js/labtemplates.js";

test("sweeps use the model's known realtime window over Segments", () => {
  assert.equal(sweepWindow({ sku: "H70C5", reach: 44 }, 300), 44); // Pillars on Per bulb shows 300
  assert.equal(sweepWindow({ sku: "H6199" }, 20), 20);
  assert.equal(sweepWindow(undefined, 0), 44);
});
