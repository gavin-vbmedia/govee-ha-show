import assert from "node:assert/strict";
import test from "node:test";

import { clipFit, reachNote, worst } from "../../haliday_show/app/halidayshow/static/js/compat.js";
import { newClip } from "../../haliday_show/app/halidayshow/static/js/effects.js";

const clip = (effect, params = {}, end = 10) => ({ ...newClip(effect, 0, end), ...params });
const realtime = { protocol: "standard", segments: 15, ip: "10.0.0.2" };
const whole = { protocol: "whole", segments: 15, ip: "10.0.0.3" };
const level = (c, dev, opts) => clipFit(c, dev, opts).level;

test("anything that only moves along the light won't work on Whole light only", () => {
  for (const effect of ["chase", "comet", "scanner"]) {
    for (const speed of [0.3, 1]) assert.equal(level(clip(effect, { speed }), whole), "no", `${effect} ${speed}`);
  }
  for (const effect of ["duo", "trio", "gradient"]) assert.equal(level(clip(effect, { speed: 0 }), whole), "no", effect);
  assert.equal(level(clip("rainbow", { spread: 1, speed: 0 }), whole), "no");
  assert.match(clipFit(clip("chase"), whole).reasons[0], /Whole light only/);
});

test("whole-light changes still work on Whole light only", () => {
  assert.equal(level(clip("solid"), whole), "ok");
  assert.equal(level(clip("fade"), whole), "ok");
  assert.equal(level(clip("pulse", { rate: 0.5 }), whole), "ok");
  assert.equal(level(clip("cycle", { rate: 0.3 }), whole), "ok");
  assert.equal(level(clip("rainbow", { spread: 0, speed: 0.2 }), whole), "ok");
  assert.equal(level(clip("wipe"), whole), "ok"); // it fades the whole light from one colour to the other
});

test("every effect works on a realtime light of ordinary length", () => {
  for (const effect of ["solid", "duo", "trio", "pulse", "gradient", "cycle", "fade", "chase", "rainbow", "comet",
    "scanner", "flicker", "lightning", "strobe", "twinkle", "wipe"]) {
    assert.equal(level(clip(effect), realtime), "ok", effect);
  }
});

test("settings too big for a short light make it one steady colour", () => {
  const short = { ...realtime, segments: 2 };
  assert.equal(level(clip("chase", { width: 4, speed: 1 }), short), "no");
  assert.equal(level(clip("chase", { width: 1, speed: 0.3 }), short), "ok");
  const one = { ...realtime, segments: 1 };
  assert.equal(level(clip("gradient", { speed: 0 }), one), "no");
  assert.match(clipFit(clip("gradient", { speed: 0 }), one).reasons[0], /1 segment /);
  assert.equal(level(clip("pulse"), one), "ok");
});

test("too fast for a slow light is limited, not blocked", () => {
  const pixels = { protocol: "pixels", segments: 300, ip: "10.0.0.4" };
  const r = clipFit(clip("chase", { speed: 2 }), pixels);
  assert.equal(r.level, "limited");
  assert.match(r.reasons[0], /Too fast/);
  assert.equal(level(clip("cycle", { rate: 0.2, blend: "fade" }), pixels), "ok");
});

test("a Govee scene needs a linked light with its model set", () => {
  assert.equal(level(clip("scene"), { ...realtime, ip: "", sku: "H70C5" }), "no");
  assert.equal(level(clip("scene"), { ...realtime, sku: "" }), "no");
  assert.equal(level(clip("scene"), { ...realtime, sku: "H70C5" }), "ok");
});

test("House lane clips are marked when lights aren't on the house photo", () => {
  const sweep = clip("sweep");
  assert.equal(level(sweep, null, { house: { lights: [] } }), "ok");
  assert.equal(level(sweep, null, { house: { lights: [{ name: "Porch", placed: true }] } }), "ok");
  const some = clipFit(sweep, null, { house: { lights: [{ name: "Porch", placed: true }, { name: "Tree", placed: false }] } });
  assert.equal(some.level, "limited");
  assert.match(some.reasons[0], /Tree/);
  assert.equal(level(sweep, null, { house: { lights: [{ name: "Tree", placed: false }] } }), "no");
});

test("House lane clips too fast for a slow light are marked, naming it", () => {
  // A light traced left to right across the house.
  const along = (n) => Array.from({ length: n }, (_, i) => [i / (n - 1), 0.5]);
  const light = (name, protocol) => ({ name, placed: true, positions: along(60), device: { protocol, segments: 60 } });
  const fast = clip("sweep", { sweeps: 20 });
  const onSlow = clipFit(fast, null, { house: { lights: [light("Pillars", "pixels"), light("Roof", "standard")] } });
  assert.equal(onSlow.level, "limited");
  assert.match(onSlow.reasons[0], /Too fast for Pillars \(Per bulb\)/);
  assert.doesNotMatch(onSlow.reasons[0], /Roof/);
  assert.equal(level(fast, null, { house: { lights: [light("Roof", "standard")] } }), "ok");
  const slow = clip("sweep", { sweeps: 1, width: 1 }, 60);
  assert.equal(level(slow, null, { house: { lights: [light("Pillars", "pixels")] } }), "ok");
});

test("a House clip can be both too fast somewhere and missing a light", () => {
  const along = Array.from({ length: 60 }, (_, i) => [i / 59, 0.5]);
  const r = clipFit(clip("sweep", { sweeps: 20 }), null, { house: { lights: [
    { name: "Pillars", placed: true, positions: along, device: { protocol: "pixels", segments: 60 } },
    { name: "Tree", placed: false }] } });
  assert.equal(r.level, "limited");
  assert.match(r.reasons.join(" "), /Tree.*Too fast for Pillars/);
});

test("unknown effects and missing lights aren't judged", () => {
  assert.equal(level({ effect: "gone", start: 0, end: 1 }, realtime), "ok");
  assert.equal(level(clip("chase"), undefined), "ok");
});

test("worst picks the result that matters most", () => {
  const ok = { level: "ok", reasons: [] }, lim = { level: "limited", reasons: ["a"] }, no = { level: "no", reasons: ["b"] };
  assert.equal(worst([ok, no, lim]), no);
  assert.equal(worst([ok, lim]), lim);
  assert.equal(worst([]).level, "ok");
});

test("realtime reach is noted only where the model's realtime mode stops short", () => {
  const h70c5 = { sku: "H70C5", reach: 44 };
  assert.match(reachNote({ protocol: "standard", bulbs: 300 }, h70c5).text, /first 44 bulbs of 300/);
  assert.match(reachNote({ protocol: "razer" }, h70c5).text, /first 44 bulbs\./);
  assert.equal(reachNote({ protocol: "razer" }, h70c5).short, "first 44 bulbs only");
  assert.equal(reachNote({ protocol: "pixels", bulbs: 300 }, h70c5), null);
  assert.equal(reachNote({ protocol: "standard", bulbs: 40 }, h70c5), null);
  assert.equal(reachNote({ protocol: "standard" }, { sku: "H6199" }), null);
  assert.equal(reachNote({ protocol: "standard" }, undefined), null);
});

test("a Home Assistant switch only shows on and off", () => {
  const sw = { protocol: "ha_switch", segments: 1, entity: "switch.snowman" };
  assert.equal(level(clip("solid"), sw), "ok"); // the prop on for the clip
  assert.equal(level(clip("pulse", { rate: 0.3 }), sw), "ok"); // goes on and off
  assert.equal(level(clip("solid", { color: "#202020" }), sw), "no"); // too dim to ever turn on
  assert.match(clipFit(clip("solid", { color: "#202020" }), sw).reasons[0], /stays off/);
  const colours = clip("cycle", { color: "#ff0000", color2: "#00ff00", color3: "#0000ff", color4: "#ffffff" });
  assert.equal(level(colours, sw), "limited"); // always bright, so the colours are lost
  assert.match(clipFit(colours, sw).reasons[0], /stays on/);
});

test("a Home Assistant light's warning talks about colours, not length", () => {
  const light = { protocol: "ha_light", segments: 1, entity: "light.porch" };
  assert.match(clipFit(clip("chase"), light).reasons[0], /one colour at a time/);
});
