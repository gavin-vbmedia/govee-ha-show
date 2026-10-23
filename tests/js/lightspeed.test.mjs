import assert from "node:assert/strict";
import test from "node:test";

import { SLOW_PROTOCOLS, isSlow } from "../../haliday_show/app/halidayshow/static/js/lightspeed.js";

test("only the non-realtime protocols are slow", () => {
  assert.deepEqual(Object.keys(SLOW_PROTOCOLS).sort(), ["pixels", "segments", "whole"]);
  assert.equal(isSlow({ protocol: "pixels" }), true);
  for (const p of ["standard", "razer", "v2", undefined]) assert.equal(isSlow({ protocol: p }), false);
  assert.equal(isSlow(undefined), false);
});

import { clipPace } from "../../haliday_show/app/halidayshow/static/js/lightspeed.js";
import { newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const pixels = { protocol: "pixels", segments: 300 };
const clip = (effect, params) => ({ ...newClip(effect, 0, 10), ...params });

test("fast chases and sparkles are too fast for a Per bulb light, slow fades are not", () => {
  assert.equal(clipPace(clip("chase", { speed: 2 }), pixels).tooFast, true);
  assert.equal(clipPace(clip("twinkle", { density: 60, rate: 10 }), pixels).tooFast, true);
  assert.equal(clipPace(clip("cycle", { rate: 0.25, blend: "fade" }), pixels).tooFast, false);
  assert.equal(clipPace(clip("pulse", { rate: 0.5 }), pixels).tooFast, false);
  assert.equal(clipPace(clip("solid", {}), pixels).needed, 0);
});

test("only slow protocols are checked, and Whole light only judges the average colour", () => {
  assert.equal(clipPace(clip("chase", { speed: 2 }), { protocol: "standard", segments: 30 }), null);
  // A chase barely moves the average colour, so it's fine on Whole light only.
  assert.equal(clipPace(clip("chase", { speed: 2 }), { protocol: "whole", segments: 30 }).tooFast, false);
  assert.equal(clipPace(clip("strobe", { rate: 10 }), { protocol: "whole", segments: 30 }).tooFast, true);
});

test("colour changes are fine up to what the light manages, and smooth drifts only if slow enough", () => {
  assert.equal(clipPace(clip("cycle", { rate: 2, blend: "step" }), pixels).tooFast, false);
  assert.equal(clipPace(clip("cycle", { rate: 8, blend: "step" }), pixels).tooFast, true);
  assert.equal(clipPace(clip("gradient", { speed: 0.05 }), pixels).tooFast, false);
  assert.equal(clipPace(clip("gradient", { speed: 0.5 }), pixels).tooFast, true);
});

test("previews show what a slow light shows: stepped, and one colour on Whole light only", async () => {
  const { asShown } = await import("../../haliday_show/app/halidayshow/static/js/lightspeed.js");
  const { renderTrack } = await import("../../haliday_show/app/halidayshow/static/js/effects.js");
  const fade = clip("fade", { from: "#000000", to: "#ff0000" });
  const at = (dev, t) => asShown(dev, t, (tt) => renderTrack([fade], tt, dev.segments));
  const realtime = { protocol: "standard", segments: 4 };
  assert.deepEqual(at(realtime, 1.05), renderTrack([fade], 1.05, 4)); // realtime: as it is
  const whole = { protocol: "whole", segments: 4 };
  assert.deepEqual(at(whole, 1.05), renderTrack([fade], 1.0, 4)); // 10 a second: the update at 1.0 s
  assert.deepEqual(at(whole, 1.05), at(whole, 1.09));
  // A chase on Whole light only is its average colour on every segment.
  const chase = clip("chase", { width: 1, color: "#ffffff", background: "#000000" });
  const f = asShown(whole, 0.3, (tt) => renderTrack([chase], tt, 4));
  assert.deepEqual([...f], Array(4).fill([64, 64, 64]).flat());
  // Per bulb: a busy frame updates less often than a plain one.
  const pixels = { protocol: "pixels", segments: 300 };
  const rainbow = clip("rainbow", { spread: 1, speed: 0.2 });
  const busy = (t) => asShown(pixels, t, (tt) => renderTrack([rainbow], tt, 300));
  assert.deepEqual(busy(0.4), busy(0.6)); // about 1.5 a second
  const plain = (t) => asShown(pixels, t, (tt) => renderTrack([fade], tt, 300));
  assert.notDeepEqual(plain(0.4), plain(0.6)); // about 6 a second
});
