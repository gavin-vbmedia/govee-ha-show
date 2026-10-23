// Generates a first draft of a show from the song's analysis (beats, bars, sections), a colour
// palette and a style. Rule-based: quiet sections get slow, soft looks, loud ones fast looks that
// move on the beat, sections that repeat get the same looks, and looks change every few bars.

import { HOUSE, newClip } from "./effects.js";
import { applyPalette } from "./palettes.js";

// How a style shifts a section's energy before picking looks, and how often looks change.
export const STYLES = {
  calm: { label: "Calm", bias: -0.25, phraseBars: 8 },
  balanced: { label: "Balanced", bias: 0, phraseBars: 4 },
  lively: { label: "Lively", bias: 0.2, phraseBars: 4 },
};

// Looks by energy. Each takes the beats per second and the light's segment count and returns an
// effect and its settings; colours come from the palette afterwards. Speeds are set from the tempo
// so movement lands on the beat: one step a beat, one lap or sweep a bar.
const LOOKS = {
  low: [
    { effect: "gradient", label: "Slow drift", params: () => ({ count: "3", speed: 0.1 }) },
    { effect: "pulse", label: "Breathe each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "twinkle", label: "Gentle twinkle", params: () => ({ density: 20, rate: 2, background: "#000000" }) },
    { effect: "duo", label: "Still blocks", params: () => ({ layout: "split", speed: 0 }) },
    { effect: "cycle", label: "Slow colour fade", params: (bps) => ({ rate: bps / 8, blend: "fade" }) },
  ],
  mid: [
    { effect: "trio", label: "Marquee on the beat", params: (bps) => ({ layout: "alternate", size: 1, speed: bps }) },
    { effect: "chase", label: "Chase, a lap a bar", params: (bps, n) => ({ width: Math.max(1, Math.round(n / 5)), speed: bps / 4 }) },
    { effect: "comet", label: "Comet, a lap a bar", params: (bps, n) => ({ length: Math.max(2, Math.round(n / 3)), speed: bps / 4 }) },
    { effect: "scanner", label: "Scanner, a sweep a bar", params: (bps, n) => ({ width: Math.max(1, n / 8), speed: bps / 4 }) },
    { effect: "cycle", label: "Colour change each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "gradient", label: "Flowing gradient", params: () => ({ count: "3", speed: 0.5 }) },
  ],
  high: [
    { effect: "cycle", label: "Colour flash each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "duo", label: "Fast marquee", params: (bps) => ({ layout: "alternate", size: 1, speed: bps * 2 }) },
    { effect: "chase", label: "Fast chase", params: (bps) => ({ width: 2, speed: bps / 2 }) },
    { effect: "twinkle", label: "Sparkle storm", params: () => ({ density: 60, rate: 10, background: "#000000" }) },
    { effect: "pulse", label: "Pulse each beat", params: (bps) => ({ rate: bps, background: "#000000" }) },
    { effect: "trio", label: "Wide fast marquee", params: (bps) => ({ layout: "alternate", size: 2, speed: bps * 2 }) },
  ],
};

// Looks for slow lights (see lightspeed.js): the whole light changing at once, or blocks and gradients
// that hardly move, so they look right at a few changes a second. Nothing faster than once a beat.
const SLOW_LOOKS = {
  low: [
    { effect: "gradient", label: "Slow drift", params: () => ({ count: "3", speed: 0.05 }) },
    { effect: "pulse", label: "Breathe each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "duo", label: "Still blocks", params: () => ({ layout: "split", speed: 0 }) },
    { effect: "cycle", label: "Slow colour fade", params: (bps) => ({ rate: bps / 8, blend: "fade" }) },
  ],
  mid: [
    { effect: "cycle", label: "Colour change each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "pulse", label: "Pulse each bar", params: (bps) => ({ rate: bps / 4, background: "#000000" }) },
    { effect: "cycle", label: "Colour fade each bar", params: (bps) => ({ rate: bps / 4, blend: "fade" }) },
    { effect: "duo", label: "Blocks, still", params: () => ({ layout: "split", speed: 0 }) },
  ],
  high: [
    { effect: "cycle", label: "Colour flash each beat", params: (bps) => ({ rate: bps, blend: "step" }) },
    { effect: "pulse", label: "Pulse each beat", params: (bps) => ({ rate: bps, background: "#000000" }) },
    { effect: "cycle", label: "Colour flash every two beats", params: (bps) => ({ rate: bps / 2, blend: "step" }) },
    { effect: "pulse", label: "Pulse every two beats", params: (bps) => ({ rate: bps / 2, background: "#000000" }) },
  ],
};

// A repeatable pseudo-random number in [0, 1) from any number of integers.
function hash(...xs) {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x | 0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const textHash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

export function tier(energy, style = "balanced") {
  const e = energy + (STYLES[style]?.bias ?? 0);
  return e < 0.35 ? "low" : e < 0.7 ? "mid" : "high";
}

// The bar grid to place clips on: detected bars, else every fourth beat, else two-second blocks.
export function barGrid({ bars = [], beats = [], duration }) {
  let grid = bars.length >= 2 ? bars : beats.length >= 8 ? beats.filter((_, i) => i % 4 === 0) : [];
  if (!grid.length) for (let t = 0; t < duration; t += 2) grid.push(t);
  grid = grid.filter((t) => t > 0.05 && t < duration - 0.05);
  return [0, ...grid, duration];
}

function beatsPerSecond({ tempo, beats = [] }) {
  if (tempo > 0) return tempo / 60;
  if (beats.length >= 2) return (beats.length - 1) / (beats[beats.length - 1] - beats[0]);
  return 2;
}

const round = (t) => Math.round(t * 1000) / 1000;
const tidy = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v]));

function clipFor(look, start, end, bps, n, colors, offset) {
  const clip = { ...newClip(look.effect, round(start), round(end)), ...tidy(look.params(bps, n)) };
  applyPalette(clip, colors, offset);
  return clip;
}

// analysis: {beats, bars, sections, tempo, duration}; lights: [{id, segments, slow, fits}], slow for lights
// that can only change a few times a second (they get SLOW_LOOKS), fits(clip) false for a clip the light
// can't show (another of the section's looks is used instead);
// colors: the palette's colours. Returns {clips: {deviceId: [clip]}, house: [clip]}.
export function generateShow(analysis, lights, colors, { style = "balanced", seed = 1, house = false } = {}) {
  const duration = analysis.duration;
  const bps = beatsPerSecond(analysis);
  const grid = barGrid(analysis);
  const sections = analysis.sections?.length ? analysis.sections : [{ start: 0, end: duration, label: "Song", energy: 0.6 }];
  const phraseBars = STYLES[style]?.phraseBars ?? 4;
  const clips = Object.fromEntries(lights.map((l) => [l.id, []]));
  const houseClips = [];
  let prevTier = null;

  sections.forEach((sec, si) => {
    const t = tier(sec.energy ?? 0.5, style);
    // Two looks per section, picked by its name so a repeated chorus looks the same each time.
    const key = textHash(sec.label || `s${si}`);
    const pick = (set) => {
      const a = Math.floor(hash(key, seed) * set.length);
      const b = (a + 1 + Math.floor(hash(key, seed, 7) * (set.length - 1))) % set.length;
      return [set[a], set[b]];
    };
    const fast = pick(LOOKS[t]), slow = pick(SLOW_LOOKS[t]);
    // Loud sections and the chorus move together on every light; the rest alternate across lights.
    const unison = t === "high" || sec.label === "Chorus";
    const bars = grid.filter((g) => g >= sec.start - 0.05 && g <= sec.end + 0.05);
    if (bars[0] > sec.start + 0.05) bars.unshift(sec.start);
    if (bars[bars.length - 1] < sec.end - 0.05) bars.push(sec.end);
    const step = t === "low" ? phraseBars * 2 : phraseBars;
    for (let k = 0, phrase = 0; k < bars.length - 1; k += step, phrase++) {
      const start = bars[k], end = bars[Math.min(k + step, bars.length - 1)];
      lights.forEach((light, li) => {
        const look = (light.slow ? slow : fast)[(phrase + (unison ? 0 : li)) % 2];
        const make = (l) => clipFor(l, start, end, bps, light.segments, colors, unison ? li : phrase);
        let clip = make(look);
        if (light.fits && !light.fits(clip)) {
          for (const other of (light.slow ? SLOW_LOOKS : LOOKS)[t]) {
            const c = make(other);
            if (light.fits(c)) { clip = c; break; }
          }
        }
        clips[light.id].push(clip);
      });
    }
    // A sweep across the house as the music lifts into a louder section.
    const order = { low: 0, mid: 1, high: 2 };
    if (house && si > 0 && order[t] > order[prevTier] && bars.length >= 2) {
      const sweep = newClip("sweep", round(sec.start), round(bars[1]));
      Object.assign(sweep, {
        color: colors[si % colors.length], outside: "lights' own effects", width: 0.3,
        direction: si % 2 ? "left to right" : "out from centre",
      });
      houseClips.push(sweep);
    }
    prevTier = t;
  });

  // Fade in over the first bar and out over the last two when the song starts or ends quietly.
  const first = sections[0], last = sections[sections.length - 1];
  const keep = (list) => list.filter((c) => c.end - c.start >= 0.05);
  for (const light of lights) {
    let list = clips[light.id];
    if (list.length && tier(first.energy ?? 0.5, style) === "low") {
      // Up to the first bar line at least a second and a half in, past any pickup.
      const to = round(grid.find((g) => g >= 1.5) ?? duration);
      for (const c of list) c.start = round(Math.min(Math.max(c.start, to), c.end));
      list = [Object.assign(newClip("fade", 0, to), { from: "#000000", to: colors[0] }), ...keep(list)];
    }
    if (list.length && tier(last.energy ?? 0.5, style) === "low") {
      const from = round(grid[Math.max(0, grid.length - 3)]);
      for (const c of list) if (c.end > from) c.end = round(Math.max(c.start, from));
      list = [...keep(list), Object.assign(newClip("fade", from, round(duration)), { from: colors[0], to: "#000000" })];
    }
    clips[light.id] = list;
  }
  return { clips, house: houseClips };
}

// Looks that suit a stretch of the song, for the effect chooser: the ones Generate would pick from
// for the section it falls in, with speeds set from the tempo (slow-light looks for a slow light).
// Returns the section (or null) and
// [{effect, label, params}].
export function suggestLooks(analysis, start, end, segments = 15, style = "balanced", slow = false) {
  const overlap = (s) => Math.min(s.end, end) - Math.max(s.start, start);
  const section = (analysis.sections || []).reduce((best, s) => (overlap(s) > 0 && (!best || overlap(s) > overlap(best)) ? s : best), null);
  const t = tier(section?.energy ?? 0.5, style);
  const bps = beatsPerSecond(analysis);
  return { section, tier: t, looks: (slow ? SLOW_LOOKS : LOOKS)[t].map((look) => ({ effect: look.effect, label: look.label, params: tidy(look.params(bps, segments)) })) };
}

// Puts generated clips on the show's tracks, replacing what the lights (and, with house clips,
// the House lane) had.
export function applyGenerated(show, result) {
  for (const tr of show.tracks) {
    if (tr.device === HOUSE) { if (result.house.length) tr.clips = result.house; }
    else if (result.clips[tr.device]) tr.clips = result.clips[tr.device];
  }
}
