// Whether a clip can look right on the light it's on, worked out from the light's settings and the
// clip's own, so nothing about it is saved: old shows load as they were and are only marked.
//   ok       fine
//   limited  plays, but not quite as meant (too fast for the light, some lights left out)
//   no       the light can't show it: it comes out as one steady colour, or not at all
// The editor won't pick a "no" effect unless you allow it, and marks clips that are "limited" or "no".

import { EFFECTS, renderTrack } from "./effects.js";
import { clipPace, switchOn } from "./lightspeed.js";

export const REALTIME_PROTOCOLS = ["standard", "razer", "v2"];
const SAMPLES = 48;
const STEADY = 24; // out of 255, per channel: closer than this counts as the same colour (as lightspeed.js)
const LONG_LIGHT = 50;

// What a light shows of a clip, sampled across it. On Whole light only that's one average colour.
function shown(clip, n, whole) {
  const dur = clip.end - clip.start, frames = [];
  for (let k = 0; k < SAMPLES; k++) {
    const f = renderTrack([clip], clip.start + (dur * (k + 0.5)) / SAMPLES, n);
    frames.push(whole ? average(f) : f);
  }
  return frames;
}

// Every segment the same colour, and that colour the same all through the clip.
function steady(frames) {
  const [r, g, b] = frames[0];
  return frames.every((f) => {
    for (let i = 0; i < f.length; i += 3) {
      if (Math.abs(f[i] - r) > STEADY || Math.abs(f[i + 1] - g) > STEADY || Math.abs(f[i + 2] - b) > STEADY) return false;
    }
    return true;
  });
}

function average(frame) {
  const n = frame.length / 3, out = new Uint8Array(3);
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let i = c; i < frame.length; i += 3) sum += frame[i];
    out[c] = Math.round(sum / n);
  }
  return out;
}

const result = (level, ...reasons) => ({ level, reasons });

// clip on the light `dev` (as app.devices holds it: segments, protocol, ip, sku). For the House lane
// pass house: {lights: [{name, placed}]}, every light and whether it's traced on the house photo.
export function clipFit(clip, dev, { house = null } = {}) {
  const fx = EFFECTS[clip.effect];
  if (!fx) return result("ok");
  if (house) {
    const left = house.lights.filter((l) => !l.placed).map((l) => l.name);
    if (!house.lights.length || !left.length) return result("ok");
    if (left.length === house.lights.length) {
      return result("no", "None of your lights are on the house photo yet, so this shows nowhere. Trace them under Setup → House.");
    }
    return result("limited", `Not on the house photo, so this leaves out ${left.join(", ")}.`);
  }
  if (!dev) return result("ok");
  if (clip.effect === "scene") {
    if (!dev.ip && !dev.entity) return result("no", "This light isn't linked yet, so it can't play a Govee scene.");
    if (!dev.sku) return result("no", "Set this light's model under Setup → Devices to play a Govee scene.");
    return result("ok");
  }
  if (dev.protocol === "ha_switch") {
    // A switch only goes on and off with how bright the show is there, so colours don't show at all.
    const frames = shown(clip, 1, false), states = frames.map(switchOn);
    if (states.every((on) => !on)) {
      return result("no", "This switch stays off: it only turns on when the show is at least half bright there.");
    }
    // Staying on is what a steady clip is for (the prop on for a chorus); a moving one loses its movement.
    if (states.every((on) => on) && !steady(frames)) {
      return result("limited", "This switch just stays on for the whole clip: it follows how bright the show is, not its colours.");
    }
    return result("ok");
  }
  const whole = dev.protocol === "whole";
  // On a long light only the average can flatten it, and the average of 50 segments is near enough.
  const n = Math.max(1, whole ? Math.min(dev.segments || 1, LONG_LIGHT) : dev.segments || 1);
  // It comes out as one steady colour here, but moves or has more than one colour on a long realtime light.
  if ((whole || n < LONG_LIGHT) && steady(shown(clip, n, whole)) && !steady(shown(clip, LONG_LIGHT, false))) {
    return result("no", whole
      ? "On Whole light only the light shows one colour at a time, the average of this effect, and that hardly changes."
      : dev.protocol === "ha_light"
        ? "A Home Assistant light shows one colour at a time, and this effect hardly changes it."
        : `With ${n} segment${n === 1 ? "" : "s"} this light is too short for these settings, so it shows one steady colour.`);
  }
  const pace = clipPace(clip, dev);
  if (pace?.tooFast) {
    return result("limited", `Too fast for this light. On ${pace.label} it changes about ${Math.max(1, Math.round(pace.can))} `
      + "times a second, so this will look steppy. Slow it down, or use a fade, pulse or colour change.");
  }
  return result("ok");
}

// Of several results, the one that matters most.
export function worst(results) {
  const rank = { ok: 0, limited: 1, no: 2 };
  return results.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a), result("ok"));
}

// A note for a light whose realtime mode doesn't reach all of it (a model with a known `reach`):
// {short, text}, or null.
export function reachNote(light, model) {
  if (!light || !model?.reach || !REALTIME_PROTOCOLS.includes(light.protocol || "standard")) return null;
  if (light.bulbs && light.bulbs <= model.reach) return null;
  return {
    short: `first ${model.reach} bulbs only`,
    text: `In realtime mode this light only lights its first ${model.reach} bulbs${light.bulbs ? ` of ${light.bulbs}` : ""}. `
      + "Per bulb or App segments (Setup → Devices) reach the whole light.",
  };
}
