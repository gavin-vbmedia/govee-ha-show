// Lighting effects, written once and used for both the live preview and the bake.
//
// Every effect is a pure function of (clip, seconds into the clip, segment count),
// so a preview frame and a baked frame at the same time are identical.

export const FPS = 40;

// The House lane's track id. Its clips run across every light by where its segments sit on the
// house photo, on top of each light's own effects.
export const HOUSE = "@house";

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function mix(a, b, u) {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [r * 255, g * 255, b * 255];
}

// Small integer hash -> [0, 1), stable across runs so twinkle bakes the same way twice.
function hash01(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const color = (key, label, def) => ({ key, label, type: "color", default: def });
const num = (key, label, def, min, max, step) => ({ key, label, type: "number", default: def, min, max, step });
const choice = (key, label, def, options) => ({ key, label, type: "select", default: def, options });
const direction = choice("direction", "Direction", "forward", ["forward", "reverse"]);
const mod = (a, n) => ((a % n) + n) % n;
// 0 -> 1 -> 0 over each 2 units, so movement can bounce instead of jumping back.
const bounce = (x) => { const m = mod(x, 2); return m <= 1 ? m : 2 - m; };
const smooth = (u) => u * u * (3 - 2 * u);

// Two or three solid colours side by side: split the light into equal bands, or alternate
// them every few segments along it.
function multiColour(label, colours) {
  return {
    label,
    params: [...colours, choice("layout", "Layout", "split", ["split", "alternate"]),
      num("size", "Segments per colour (alternate)", 1, 1, 50, 1),
      num("speed", "Move (segments per second)", 0, -50, 50, 0.5)],
    render: (p, t, dur, n, i) => {
      const k = colours.length;
      const pos = i - Math.floor(t * (p.speed || 0)); // moving bands make a marquee
      const idx = p.layout === "alternate" ? mod(Math.floor(pos / Math.max(1, p.size)), k)
        : Math.min(k - 1, Math.floor((mod(pos, n) * k) / n));
      return hexToRgb(p[colours[idx].key]);
    },
  };
}

// render(p, t, dur, n, i) returns the colour of segment i (0..n-1) at t seconds into the clip.
export const EFFECTS = {
  solid: {
    label: "Solid",
    params: [color("color", "Colour", "#ff0000")],
    render: (p) => hexToRgb(p.color),
  },
  duo: multiColour("Two colours", [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#00ff00")]),
  trio: multiColour("Three colours", [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#ffffff"),
    color("color3", "Colour 3", "#00ff00")]),
  pulse: {
    label: "Pulse",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"),
      num("rate", "Pulses per second", 1, 0.05, 10, 0.05)],
    render: (p, t) => mix(hexToRgb(p.background), hexToRgb(p.color), (1 - Math.cos(2 * Math.PI * t * p.rate)) / 2),
  },
  gradient: {
    label: "Gradient",
    params: [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#0000ff"),
      color("color3", "Colour 3", "#00ff00"), choice("count", "Colours", "3", ["2", "3"]),
      num("speed", "Move (per second)", 0, -5, 5, 0.05)],
    render: (p, t, dur, n, i) => {
      const stops = [p.color, p.color2, p.color3].slice(0, Number(p.count)).map(hexToRgb);
      const u = bounce((n > 1 ? i / (n - 1) : 0) + t * p.speed) * (stops.length - 1);
      const k = Math.min(Math.floor(u), stops.length - 2);
      return mix(stops[k], stops[k + 1], u - k);
    },
  },
  cycle: {
    label: "Colour cycle",
    params: [color("color", "Colour 1", "#ff0000"), color("color2", "Colour 2", "#00ff00"),
      color("color3", "Colour 3", "#0000ff"), color("color4", "Colour 4", "#ffffff"),
      choice("count", "Colours", "4", ["2", "3", "4"]), num("rate", "Changes per second", 1, 0.05, 20, 0.05),
      choice("blend", "Change", "fade", ["fade", "step"])],
    render: (p, t) => {
      const cs = [p.color, p.color2, p.color3, p.color4].slice(0, Number(p.count)).map(hexToRgb);
      const s = t * p.rate, k = Math.floor(s) % cs.length;
      return p.blend === "step" ? cs[k] : mix(cs[k], cs[(k + 1) % cs.length], smooth(s - Math.floor(s)));
    },
  },
  fade: {
    label: "Fade",
    params: [color("from", "From", "#000000"), color("to", "To", "#ff0000")],
    render: (p, t, dur) => mix(hexToRgb(p.from), hexToRgb(p.to), dur > 0 ? Math.min(t / dur, 1) : 1),
  },
  chase: {
    label: "Chase",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("width", "Width (segments)", 2, 1, 50, 1), num("speed", "Laps per second", 1, 0.05, 10, 0.05), direction],
    render: (p, t, dur, n, i) => {
      const head = (t * p.speed * n) % n;
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const behind = (head - pos + n) % n;
      return behind < p.width ? hexToRgb(p.color) : hexToRgb(p.background);
    },
  },
  rainbow: {
    label: "Rainbow",
    params: [num("speed", "Cycles per second", 0.5, 0, 10, 0.05), num("spread", "Rainbows across", 1, 0, 10, 0.1),
      direction],
    render: (p, t, dur, n, i) => {
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const h = (((pos / n) * p.spread - t * p.speed) % 1 + 1) % 1;
      return hsv(h, 1, 1);
    },
  },
  comet: {
    label: "Comet",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("length", "Tail (segments)", 5, 1, 100, 1), num("speed", "Laps per second", 1, 0.05, 10, 0.05), direction],
    render: (p, t, dur, n, i) => {
      const head = mod(t * p.speed * n, n);
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const behind = mod(head - pos, n);
      return behind < p.length ? mix(hexToRgb(p.background), hexToRgb(p.color), 1 - behind / p.length)
        : hexToRgb(p.background);
    },
  },
  scanner: {
    label: "Scanner",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"),
      num("width", "Width (segments)", 2, 1, 50, 0.5), num("speed", "Sweeps per second", 0.5, 0.05, 10, 0.05)],
    render: (p, t, dur, n, i) => {
      const head = bounce(t * p.speed) * (n - 1);
      return mix(hexToRgb(p.background), hexToRgb(p.color), Math.max(0, 1 - Math.abs(i - head) / p.width));
    },
  },
  flicker: {
    label: "Flicker",
    params: [color("color", "Colour", "#ff5000"), color("color2", "Hot colour", "#ffb000"),
      num("rate", "Flickers per second", 8, 0.5, 30, 0.5)],
    render: (p, t, dur, n, i) => {
      const s = t * p.rate, k = Math.floor(s);
      const v = hash01(i + 1, k) + (hash01(i + 1, k + 1) - hash01(i + 1, k)) * smooth(s - k);
      const c = mix(hexToRgb(p.color), hexToRgb(p.color2), v);
      const level = 0.35 + 0.65 * v;
      return [c[0] * level, c[1] * level, c[2] * level];
    },
  },
  lightning: {
    label: "Lightning",
    params: [color("color", "Flash", "#ffffff"), color("background", "Background", "#000010"),
      num("rate", "Strikes per second", 0.7, 0.05, 5, 0.05)],
    render: (p, t) => {
      // Ten chances a second to strike; each strike fades over its tenth of a second.
      const slot = Math.floor(t * 10);
      const strike = hash01(slot + 1, 7919) < p.rate / 10;
      const env = strike ? (1 - (t * 10 - slot)) ** 2 : 0;
      return mix(hexToRgb(p.background), hexToRgb(p.color), env);
    },
  },
  strobe: {
    label: "Strobe",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"),
      num("rate", "Flashes per second", 8, 0.5, 20, 0.5), num("duty", "On time %", 30, 5, 95, 5)],
    render: (p, t) => ((t * p.rate) % 1 < p.duty / 100 ? hexToRgb(p.color) : hexToRgb(p.background)),
  },
  twinkle: {
    label: "Twinkle",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000020"),
      num("density", "Density %", 30, 1, 100, 1), num("rate", "Twinkles per second", 4, 0.5, 20, 0.5)],
    render: (p, t, dur, n, i) => {
      const step = t * p.rate, k = Math.floor(step);
      if (hash01(i + 1, k) >= p.density / 100) return hexToRgb(p.background);
      const env = Math.sin((step - k) * Math.PI); // fade each twinkle in and out
      return mix(hexToRgb(p.background), hexToRgb(p.color), env);
    },
  },
  wipe: {
    label: "Wipe",
    params: [color("color", "Colour", "#00ff00"), color("background", "Background", "#000000"), direction],
    render: (p, t, dur, n, i) => {
      const filled = dur > 0 ? Math.min(t / dur, 1) * n : n;
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      if (pos + 1 <= filled) return hexToRgb(p.color);
      if (pos >= filled) return hexToRgb(p.background);
      return mix(hexToRgb(p.background), hexToRgb(p.color), filled - pos);
    },
  },
  // Experimental: hands the light to one of Govee's own built-in scenes (picked per clip, stored
  // as code and param). The add-on can't know what the scene looks like, so the preview shows a
  // slow purple shimmer to mark where it runs.
  scene: {
    label: "Govee scene",
    experimental: true,
    params: [{ key: "scene", label: "Scene", type: "scene", default: "" }],
    render: (p, t, dur, n, i) => {
      const v = 0.45 + 0.3 * Math.sin(((i / n) * 2 - t * 0.5) * Math.PI * 2);
      return [140 * v, 70 * v, 255 * v];
    },
  },
};

// House effects colour a segment by where it sits on the house photo: u runs 0 to 1 from the
// leftmost traced light to the rightmost, v from the highest to the lowest. renderAt returns a
// colour, with an optional 4th value for how much of it to lay over the light's own effects
// (0 to 1), or null to leave them be. On a plain strip (the clip's thumbnail, the effect picker)
// render() shows the effect as if the strip ran left to right across the house.
const DIRECTIONS = ["left to right", "right to left", "top to bottom", "bottom to top", "out from centre",
  "in to centre"];
const houseDirection = choice("direction", "Direction", "left to right", DIRECTIONS);
const outside = choice("outside", "Elsewhere", "background colour", ["background colour", "lights' own effects"]);

function along(dir, u, v) {
  switch (dir) {
    case "right to left": return 1 - u;
    case "top to bottom": return v;
    case "bottom to top": return 1 - v;
    case "out from centre": return Math.min(Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2, 1);
    case "in to centre": return 1 - Math.min(Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2, 1);
    default: return u;
  }
}

// Colour `c` at strength a (0..1), over the background colour or over the light's own effects.
function layer(p, c, a) {
  if (p.outside === "lights' own effects") return a > 0 ? [...c, a] : null;
  return mix(hexToRgb(p.background), c, a);
}

function houseEffect(fx) {
  return {
    ...fx,
    house: true,
    render: (p, t, dur, n, i) => {
      const u = n > 1 ? i / (n - 1) : 0.5;
      const c = fx.renderAt(p, t, dur, u, u);
      return !c ? [0, 0, 0] : c.length > 3 ? c.slice(0, 3).map((v) => v * c[3]) : c;
    },
  };
}

Object.assign(EFFECTS, {
  sweep: houseEffect({
    label: "Sweep",
    params: [color("color", "Colour", "#ffffff"), color("background", "Background", "#000000"), houseDirection,
      num("width", "Band width (share of the house)", 0.25, 0.02, 1, 0.01),
      num("sweeps", "Sweeps in the clip", 1, 1, 50, 1), outside],
    renderAt: (p, t, dur, u, v) => {
      const w = Math.max(Number(p.width) || 0.25, 0.01);
      const f = mod((t / dur) * Math.max(1, Math.round(p.sweeps || 1)), 1);
      const centre = -w + f * (1 + 2 * w);
      const a = smooth(Math.max(0, 1 - Math.abs(along(p.direction, u, v) - centre) / w));
      return layer(p, hexToRgb(p.color), a);
    },
  }),
  housewipe: houseEffect({
    label: "House wipe",
    params: [color("color", "Colour", "#ff0000"), color("background", "Background", "#000000"), houseDirection,
      num("soft", "Soft edge (share of the house)", 0.05, 0, 0.5, 0.01), outside],
    renderAt: (p, t, dur, u, v) => {
      const soft = Math.max(Number(p.soft) || 0, 0.001);
      const front = (t / dur) * (1 + soft);
      const a = Math.min(Math.max((front - along(p.direction, u, v)) / soft, 0), 1);
      return layer(p, hexToRgb(p.color), a);
    },
  }),
  wave: houseEffect({
    label: "Rainbow wave",
    params: [houseDirection, num("size", "Rainbows across the house", 1, 0.1, 10, 0.1),
      num("speed", "Speed (rainbows per second)", 0.5, -10, 10, 0.1)],
    renderAt: (p, t, dur, u, v) => hsv(mod(along(p.direction, u, v) * p.size - t * p.speed, 1), 1, 1),
  }),
});

// Every effect gets a Brightness slider, applied after it renders. Rainbow had its own with the
// same key, so its older clips keep their level.
const BRIGHTNESS = { key: "brightness", label: "Brightness %", type: "range", default: 100, min: 0, max: 100, step: 1 };
for (const fx of Object.values(EFFECTS)) if (!fx.experimental) fx.params.push(BRIGHTNESS);

// Presets: named starting points for an effect's settings, since one effect covers many looks
// (three colours can sit still, alternate, or run as a marquee). A preset sets only the settings it
// names and keeps the clip's colours unless it names them. A value can be a function of the clip's
// current settings.
const nonBlack = (p, keys) => keys.map((k) => p[k]).find((c) => c && c.toLowerCase() !== "#000000") || "#ffffff";
const MULTI_PRESETS = [
  { label: "Still blocks", params: { layout: "split", speed: 0 } },
  { label: "Turning blocks", params: { layout: "split", speed: 3 } },
  { label: "Alternating", params: { layout: "alternate", size: 1, speed: 0 } },
  { label: "Wide stripes", params: { layout: "alternate", size: 3, speed: 0 } },
  { label: "Slow marquee", params: { layout: "alternate", size: 1, speed: 2 } },
  { label: "Fast marquee", params: { layout: "alternate", size: 1, speed: 8 } },
  { label: "Wide marquee", params: { layout: "alternate", size: 3, speed: 4 } },
];
export const PRESETS = {
  duo: MULTI_PRESETS,
  trio: MULTI_PRESETS,
  pulse: [
    { label: "Slow breathe", params: { rate: 0.3 } },
    { label: "Heartbeat", params: { rate: 1.2 } },
    { label: "Fast pulse", params: { rate: 3 } },
  ],
  gradient: [
    { label: "Still", params: { speed: 0 } },
    { label: "Drift", params: { speed: 0.1 } },
    { label: "Flowing", params: { speed: 0.5 } },
    { label: "Two colours", params: { count: "2", speed: 0 } },
  ],
  cycle: [
    { label: "Slow fade", params: { rate: 0.3, blend: "fade" } },
    { label: "On the beat", params: { rate: 2, blend: "step" } },
    { label: "Rapid flash", params: { rate: 8, blend: "step" } },
  ],
  fade: [
    { label: "Fade in", params: { from: "#000000", to: (p) => nonBlack(p, ["to", "from"]) } },
    { label: "Fade out", params: { from: (p) => nonBlack(p, ["from", "to"]), to: "#000000" } },
  ],
  chase: [
    { label: "Single dot", params: { width: 1, speed: 0.3 } },
    { label: "Running block", params: { width: 4, speed: 1 } },
    { label: "Fast chase", params: { width: 2, speed: 3 } },
  ],
  rainbow: [
    { label: "Slow drift", params: { speed: 0.15, spread: 1 } },
    { label: "Spin", params: { speed: 2, spread: 1 } },
    { label: "Tight bands", params: { speed: 0.5, spread: 3 } },
    { label: "Whole light", params: { speed: 0.3, spread: 0 } },
  ],
  comet: [
    { label: "Shooting star", params: { length: 6, speed: 1.5 } },
    { label: "Long and slow", params: { length: 12, speed: 0.4 } },
    { label: "Short and fast", params: { length: 3, speed: 2.5 } },
  ],
  scanner: [
    { label: "Slow", params: { width: 2, speed: 0.3 } },
    { label: "Knight Rider", params: { width: 3, speed: 0.8 } },
    { label: "Fast and narrow", params: { width: 1, speed: 2 } },
  ],
  flicker: [
    { label: "Embers", params: { rate: 2 } },
    { label: "Candle", params: { rate: 5 } },
    { label: "Fire", params: { rate: 12 } },
  ],
  lightning: [
    { label: "Distant storm", params: { rate: 0.2 } },
    { label: "Storm", params: { rate: 0.7 } },
    { label: "Overhead", params: { rate: 2 } },
  ],
  strobe: [
    { label: "Slow flash", params: { rate: 2, duty: 30 } },
    { label: "Party", params: { rate: 8, duty: 30 } },
    { label: "Rapid", params: { rate: 16, duty: 20 } },
  ],
  twinkle: [
    { label: "Gentle", params: { density: 15, rate: 2 } },
    { label: "Starry", params: { density: 30, rate: 4 } },
    { label: "Sparkle storm", params: { density: 60, rate: 10 } },
  ],
  wipe: [
    { label: "Forward", params: { direction: "forward" } },
    { label: "Reverse", params: { direction: "reverse" } },
  ],
  sweep: [
    { label: "Single sweep", params: { sweeps: 1, width: 0.25 } },
    { label: "Searchlight", params: { sweeps: 2, width: 0.1 } },
    { label: "Rolling bands", params: { sweeps: 6, width: 0.3 } },
    { label: "Rising", params: { direction: "bottom to top", sweeps: 1, width: 0.3 } },
    { label: "Burst", params: { direction: "out from centre", sweeps: 2, width: 0.2 } },
  ],
  housewipe: [
    { label: "Left to right", params: { direction: "left to right" } },
    { label: "Fill up", params: { direction: "bottom to top" } },
    { label: "From the middle", params: { direction: "out from centre" } },
  ],
  wave: [
    { label: "Slow wave", params: { size: 1, speed: 0.2 } },
    { label: "Fast wave", params: { size: 1, speed: 1.5 } },
    { label: "Many rainbows", params: { size: 3, speed: 0.5 } },
    { label: "Rising", params: { direction: "bottom to top", size: 1, speed: 0.5 } },
  ],
};

// The settings `preset` gives a clip whose settings are `p`.
export function presetParams(preset, p) {
  return Object.fromEntries(Object.entries(preset.params).map(([k, v]) => [k, typeof v === "function" ? v(p) : v]));
}

// Whether a clip's settings already match a preset.
export function matchesPreset(preset, p) {
  return Object.entries(presetParams(preset, p)).every(([k, v]) => String(p[k]) === String(v));
}

export function defaultParams(effect) {
  return Object.fromEntries(EFFECTS[effect].params.map((p) => [p.key, p.default]));
}

export function newClip(effect, start, end) {
  return { effect, start, end, ...defaultParams(effect) };
}

// Lays the House lane's clips over a light's frame. pos holds each segment's [u, v] on the house,
// or null for one that isn't on the photo (those keep their own colours).
export function applyHouse(clips, time, pos, out) {
  for (const clip of clips) {
    if (time < clip.start || time >= clip.end) continue;
    const fx = EFFECTS[clip.effect];
    if (!fx?.house) continue;
    const p = { ...defaultParams(clip.effect), ...clip };
    const t = time - clip.start, dur = clip.end - clip.start;
    const level = Math.min(Math.max(Number(p.brightness ?? 100), 0), 100) / 100;
    for (let i = 0; i < pos.length; i++) {
      if (!pos[i]) continue;
      const c = fx.renderAt(p, t, dur, pos[i][0], pos[i][1]);
      if (!c) continue;
      const a = c.length > 3 ? c[3] : 1;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = clamp(out[i * 3 + k] * (1 - a) + c[k] * level * a);
    }
  }
  return out;
}

// Clips later in the list sit on top. Uncovered segments are black.
export function renderTrack(clips, time, n, out = new Uint8Array(n * 3)) {
  out.fill(0);
  for (const clip of clips) {
    if (time < clip.start || time >= clip.end) continue;
    const fx = EFFECTS[clip.effect];
    if (!fx) continue;
    const p = { ...defaultParams(clip.effect), ...clip };
    const t = time - clip.start, dur = clip.end - clip.start;
    const level = Math.min(Math.max(Number(p.brightness ?? 100), 0), 100) / 100;
    for (let i = 0; i < n; i++) {
      const c = fx.render(p, t, dur, n, i);
      out[i * 3] = clamp(c[0] * level);
      out[i * 3 + 1] = clamp(c[1] * level);
      out[i * 3 + 2] = clamp(c[2] * level);
    }
  }
  return out;
}

const clamp = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

export function showDuration(show) {
  let end = show.duration || 0;
  for (const tr of show.tracks || []) for (const c of tr.clips) end = Math.max(end, c.end);
  return end;
}

// Bake every frame into the layout the Python player reads (see baked.py).
// devices maps device id -> {segments}. Tracks without a known device are skipped. positions maps
// device id -> each segment's [u, v] on the house (or null), for the House lane's clips.
export function bake(show, devices, fps = FPS, positions = {}) {
  const houseClips = (show.tracks || []).find((tr) => tr.device === HOUSE)?.clips || [];
  const tracks = (show.tracks || []).filter((tr) => devices[tr.device]);
  const header = {
    fps,
    frames: Math.ceil(showDuration(show) * fps),
    tracks: tracks.map((tr) => ({ device: tr.device, segments: devices[tr.device].segments })),
  };
  // Govee scene clips: the player hands those lights to the scene between these frames.
  const scenes = [];
  tracks.forEach((tr, k) => {
    for (const c of tr.clips) {
      if (c.effect === "scene" && c.code) {
        scenes.push({ track: k, start: Math.max(0, Math.round(c.start * fps)), end: Math.round(c.end * fps),
          code: c.code, param: c.param || "" });
      }
    }
  });
  if (scenes.length) header.scenes = scenes;
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const stride = header.tracks.reduce((s, t) => s + t.segments * 3, 0);
  const out = new Uint8Array(9 + headerBytes.length + header.frames * stride);
  out.set([0x47, 0x56, 0x53, 0x46, 1], 0); // "GVSF", version 1
  new DataView(out.buffer).setUint32(5, headerBytes.length);
  out.set(headerBytes, 9);
  let off = 9 + headerBytes.length;
  for (let f = 0; f < header.frames; f++) {
    const time = f / fps;
    tracks.forEach((tr, k) => {
      const n = header.tracks[k].segments;
      const frame = renderTrack(tr.clips, time, n, out.subarray(off, off + n * 3));
      if (houseClips.length && positions[tr.device]) applyHouse(houseClips, time, positions[tr.device], frame);
      off += n * 3;
    });
  }
  return out;
}
