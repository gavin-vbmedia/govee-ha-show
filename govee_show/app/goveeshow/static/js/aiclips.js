// "Describe it": what the editor tells the AI about the show, and how the clips it sends back are
// checked and placed. The model can get names, times or settings wrong, so nothing goes on the
// timeline until it has been matched to a real light and effect and clamped to valid values.

import { EFFECTS, defaultParams } from "./effects.js";

const r2 = (t) => Math.round(t * 100) / 100;

// The show as the AI sees it. lights: [{name, trackIndex, segments, house}], with the House lane
// as a light named "House" (only when lights are traced on the house photo); selection: {start, end, lights: [names]} or null.
export function buildContext({ show, lights, duration, selection = null, palettes = [] }) {
  const effects = Object.entries(EFFECTS).filter(([, fx]) => !fx.experimental).map(([key, fx]) => ({
    key, label: fx.label, ...(fx.house ? { house: true } : {}),
    settings: fx.params.map((p) => ({
      key: p.key, type: p.type === "range" ? "number" : p.type,
      ...(p.min !== undefined ? { min: p.min, max: p.max } : {}),
      ...(p.options ? { options: p.options } : {}),
      default: p.default,
    })),
  }));
  const beats = show.beats || [];
  return {
    song: {
      duration: r2(duration),
      tempo: show.tempo || null,
      // Long songs send bars only, to keep the request small.
      ...(beats.length <= 600 ? { beats: beats.map(r2) } : {}),
      bars: (show.bars || []).map(r2),
      sections: (show.sections || []).map((s) => ({ ...s, start: r2(s.start), end: r2(s.end) })),
    },
    lights: lights.map((l) => ({ name: l.name, segments: l.segments, ...(l.house ? { house: true } : {}) })),
    effects,
    palettes: palettes.map((p) => ({ name: p.name, colors: p.colors })),
    selection: selection && { start: r2(selection.start), end: r2(selection.end), lights: selection.lights },
    clips: Object.fromEntries(lights.map((l) => [l.name, (show.tracks[l.trackIndex]?.clips || []).slice(0, 60)
      .map((c) => ({ start: r2(c.start), end: r2(c.end), effect: c.effect }))])),
  };
}

// One setting's value from the AI's text, checked against the effect's definition; undefined if
// it isn't valid.
function settingValue(def, raw) {
  const text = String(raw ?? "").trim();
  if (def.type === "color") {
    const m = /^#?([0-9a-f]{6})$/i.exec(text);
    return m ? `#${m[1].toLowerCase()}` : undefined;
  }
  if (def.type === "number" || def.type === "range") {
    const v = Number(text);
    if (!Number.isFinite(v)) return undefined;
    return Math.min(Math.max(v, def.min ?? -Infinity), def.max ?? Infinity);
  }
  if (def.type === "select") return def.options.map(String).find((o) => o.toLowerCase() === text.toLowerCase());
  return undefined;
}

const norm = (s) => String(s || "").trim().toLowerCase();

// Checks the AI's clips and turns them into real ones: [{trackIndex, clip}], plus how many were
// left out and why. lights is the same list buildContext had, with each light's trackIndex.
export function checkClips(reply, lights, duration) {
  const byName = new Map(lights.map((l) => [norm(l.name), l]));
  const placed = [], skipped = [];
  for (const c of Array.isArray(reply?.clips) ? reply.clips : []) {
    const light = byName.get(norm(c?.light));
    const fx = EFFECTS[c?.effect];
    if (!light) { skipped.push(`no light called "${c?.light}"`); continue; }
    if (!fx || fx.experimental) { skipped.push(`no effect called "${c?.effect}"`); continue; }
    if (!!fx.house !== !!light.house) { skipped.push(`${fx.label} can't go on ${light.name}`); continue; }
    const start = Math.max(0, Number(c.start)), end = Math.min(duration, Number(c.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.05) { skipped.push("a clip with bad times"); continue; }
    const clip = { effect: c.effect, start: r2(start), end: r2(end), ...defaultParams(c.effect) };
    for (const s of Array.isArray(c.settings) ? c.settings : []) {
      const def = fx.params.find((p) => p.key === s?.key);
      const v = def && settingValue(def, s.value);
      if (v !== undefined) clip[def.key] = v;
    }
    placed.push({ trackIndex: light.trackIndex, clip });
  }
  return { placed, skipped };
}

// Puts checked clips on the show: each replaces what its light had in that stretch (clips that
// were there are trimmed or removed), while new clips on the same light can overlap each other.
export function placeClips(show, placed) {
  const before = new Map();
  for (const { trackIndex } of placed) before.set(trackIndex, [...show.tracks[trackIndex].clips]);
  for (const [t, old] of before) {
    let kept = old;
    for (const { trackIndex, clip: n } of placed) {
      if (trackIndex !== t) continue;
      const next = [];
      for (const c of kept) {
        if (c.end <= n.start || c.start >= n.end) { next.push(c); continue; }
        if (c.start < n.start) next.push({ ...c, end: n.start });
        if (c.end > n.end) next.push({ ...c, start: n.end });
      }
      kept = next;
    }
    const added = placed.filter((p) => p.trackIndex === t).map((p) => p.clip).sort((a, b) => a.start - b.start);
    show.tracks[t].clips = [...kept, ...added];
  }
}
