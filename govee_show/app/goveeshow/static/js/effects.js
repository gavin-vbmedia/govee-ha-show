// Lighting effects, written once and used for both the live preview and the bake.
//
// Every effect is a pure function of (clip, seconds into the clip, segment count),
// so a preview frame and a baked frame at the same time are identical.

export const FPS = 40;

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
      num("brightness", "Brightness %", 100, 0, 100, 1), direction],
    render: (p, t, dur, n, i) => {
      const pos = p.direction === "reverse" ? n - 1 - i : i;
      const h = (((pos / n) * p.spread - t * p.speed) % 1 + 1) % 1;
      return hsv(h, 1, p.brightness / 100);
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
};

export function defaultParams(effect) {
  return Object.fromEntries(EFFECTS[effect].params.map((p) => [p.key, p.default]));
}

export function newClip(effect, start, end) {
  return { effect, start, end, ...defaultParams(effect) };
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
    for (let i = 0; i < n; i++) {
      const c = fx.render(p, t, dur, n, i);
      out[i * 3] = clamp(c[0]);
      out[i * 3 + 1] = clamp(c[1]);
      out[i * 3 + 2] = clamp(c[2]);
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
// devices maps device id -> {segments}. Tracks without a known device are skipped.
export function bake(show, devices, fps = FPS) {
  const tracks = (show.tracks || []).filter((tr) => devices[tr.device]);
  const header = {
    fps,
    frames: Math.ceil(showDuration(show) * fps),
    tracks: tracks.map((tr) => ({ device: tr.device, segments: devices[tr.device].segments })),
  };
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
      renderTrack(tr.clips, time, n, out.subarray(off, off + n * 3));
      off += n * 3;
    });
  }
  return out;
}
