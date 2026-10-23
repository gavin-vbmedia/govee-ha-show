// How quickly a light can change, by its protocol. Realtime lights take a new frame every 25 ms or
// so; the others are much slower (issue #74), so fast chases and sparkles look steppy on them while
// fades, colour changes and pulses of the whole light look fine. Used to pick looks for them and to
// warn about effects that are too fast.

import { renderTrack } from "./effects.js";

// Changes a second: `whole` is what a light all one colour manages, `busy` every bulb different.
export const SLOW_PROTOCOLS = {
  pixels: { label: "Per bulb", whole: 6, busy: 1.5 },
  segments: { label: "App segments", whole: 10, busy: 3 },
  whole: { label: "Whole light only", whole: 10, busy: 10 },
};

export const isSlow = (device) => !!device && device.protocol in SLOW_PROTOCOLS;

// How often a clip asks a slow light to change, against how often the light can, from a few seconds
// of the clip rendered as it would be baked. Returns null for realtime lights, else
// {needed, can, tooFast, label}: changes a second the clip needs and the light manages. It's too fast
// if it flashes or steps much more often than the light can change, or if it moves smoothly but,
// sampled at the light's own pace, a good part of it jumps a long way between updates. On Whole light only just the average
// colour counts, as that's all it shows.
export function clipPace(clip, device, { seconds = 4, fps = 20 } = {}) {
  const speed = SLOW_PROTOCOLS[device?.protocol];
  if (!speed) return null;
  const n = device.segments, whole = device.protocol === "whole";
  const span = Math.min(seconds, clip.end - clip.start);
  const frameAt = (t) => {
    const f = renderTrack([clip], clip.start + t, n);
    return whole ? average(f) : f;
  };
  // Flashes and steps: how many times a second any bulb changes noticeably.
  const steps = Math.max(1, Math.floor(span * fps));
  let prev = null, changes = 0, busy = 0, cuts = 0;
  for (let k = 0; k <= steps; k++) {
    const frame = frameAt(k / fps);
    busy += busyShare(frame);
    if (prev && changed(prev, frame, 24) > 0) changes++;
    if (prev && changed(prev, frame, 64) > (frame.length / 3) * 0.05) cuts++;  // meant to jump
    prev = frame;
  }
  const needed = changes / (steps / fps);
  const can = speed.whole - (speed.whole - speed.busy) * (busy / (steps + 1));
  // Smooth movement (no jumps of its own): at the light's own pace, does much of it jump a long way
  // between updates?
  let jumps = 0, samples = 0;
  prev = null;
  for (let t = 0; t <= span; t += 1 / can) {
    const frame = frameAt(t);
    if (prev) { jumps += changed(prev, frame, 64) / (frame.length / 3); samples++; }
    prev = frame;
  }
  const jumpy = cuts === 0 && samples > 0 && jumps / samples > 0.05;
  return { needed, can, tooFast: needed > can * 1.25 || jumpy, label: speed.label };
}

// What a light shows at `time`, from renderAt(t), the show's frame at t (a fresh array, or one it may
// overwrite). A slow light shows the frame from its last update, so previews step as the real light
// does: it updates `whole` times a second, down to `busy` when every bulb is different. On Whole light
// only every segment shows the frame's average colour. Realtime lights show the frame as it is.
export function asShown(device, time, renderAt) {
  const speed = SLOW_PROTOCOLS[device?.protocol];
  if (!speed) return renderAt(time);
  const at = (rate) => Math.floor(time * rate + 1e-9) / rate;
  let frame = renderAt(at(speed.whole));
  if (speed.busy < speed.whole) frame = renderAt(at(speed.whole - (speed.whole - speed.busy) * busyShare(frame)));
  if (device.protocol === "whole") {
    const [r, g, b] = average(frame);
    for (let i = 0; i < frame.length; i += 3) { frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; }
  }
  return frame;
}

// Bulbs whose colour moved by more than `by` in any channel.
function changed(a, b, by) {
  let count = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > by) count++;
  }
  return count;
}

// The share of bulbs not the frame's most common colour: what a Per bulb picture has to list.
function busyShare(frame) {
  const counts = new Map();
  for (let i = 0; i < frame.length; i += 3) {
    const key = (frame[i] >> 4) << 8 | (frame[i + 1] >> 4) << 4 | frame[i + 2] >> 4;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return 1 - Math.max(...counts.values()) / (frame.length / 3);
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
