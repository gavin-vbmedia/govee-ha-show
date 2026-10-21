// House view: the show played over a photo of the house. Each light is traced on the photo as a
// path, from the end with the plug to the far end, and drawn as a row of bulbs in its segments'
// colours. The House tab sets it up; the House panel in the editor plays the show on it.

const BULBS_PER_SEGMENT = 4; // the guess when a light's bulb count isn't set on the Devices tab
const MAX_BULBS = 2000;
const HIT_PX = 10;
// Icicle drops aren't all the same length; this repeating pattern staggers them like the real thing.
const STAGGER = [1, 0.55, 0.8, 0.4, 0.95, 0.65, 0.5, 0.85];
const STAGGER_MEAN = STAGGER.reduce((a, b) => a + b, 0) / STAGGER.length;

// `count` points spread evenly along the path (points are [x, y] in any units), the first at its
// start and the last at its end.
export function bulbPositions(points, count) {
  if (!points.length || count < 1) return [];
  if (points.length === 1 || count === 1) return Array.from({ length: count }, () => [...points[0]]);
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(d);
    total += d;
  }
  const out = [];
  let seg = 0, before = 0;
  for (let j = 0; j < count; j++) {
    const at = (total * j) / (count - 1);
    while (seg < lengths.length - 1 && before + lengths[seg] < at) before += lengths[seg++];
    const u = lengths[seg] ? Math.min((at - before) / lengths[seg], 1) : 0;
    const [a, b] = [points[seg], points[seg + 1]];
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

// Where each of a light's `count` bulbs is, in order from the plug: [x, y], or null for a bulb
// out of view. A point [x, y, n] marks the stretch leading to it as out of view (round the back
// of the house, or an extension lead with n = 0) holding n bulbs. The other bulbs are shared out
// over the stretches in view by length, so each run in view ends with a bulb at both ends.
export function bulbLayout(points, count) {
  const runs = []; // {points} in view, or {hidden: n}
  let run = null;
  points.forEach((p, i) => {
    if (i && p[2] != null) {
      run = null;
      runs.push({ hidden: p[2] });
    } else if (i) {
      if (!run) runs.push(run = { points: [points[i - 1]] });
      run.points.push(p);
    }
  });
  if (points.length === 1) runs.push({ points });
  let left = count;
  for (const r of runs) if (r.hidden != null) left -= (r.hidden = Math.min(r.hidden, Math.max(left, 0)));
  const shown = runs.filter((r) => r.points);
  const length = (pts) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const lengths = shown.map((r) => length(r.points));
  const total = lengths.reduce((a, b) => a + b, 0);
  // Largest remainder, so the bulbs in view add up exactly.
  const share = shown.map((r, k) => (total ? (left * lengths[k]) / total : left / shown.length));
  shown.forEach((r, k) => { r.n = Math.floor(share[k]); });
  let spare = left - shown.reduce((t, r) => t + r.n, 0);
  for (const k of shown.map((_, k) => k).sort((a, b) => (share[b] % 1) - (share[a] % 1))) {
    if (spare-- <= 0) break;
    shown[k].n++;
  }
  const out = [];
  for (const r of runs) {
    if (r.points) out.push(...bulbPositions(r.points, r.n));
    else for (let j = 0; j < r.hidden; j++) out.push(null);
  }
  while (out.length < count) out.push(null); // nothing in view to put them on
  return out;
}

// An icicle light's drops: `drops` spread along its path like bulbs (null when out of view), each
// with how long it hangs as a share of `length` and how many of the light's `bulbs` are on it.
export function icicleDrops(points, drops, bulbs) {
  const per = Math.max(bulbs / drops, 1);
  return bulbLayout(points, drops).map((at, i) => {
    if (!at) return null;
    const f = STAGGER[i % STAGGER.length];
    return { top: at, f, n: Math.max(1, Math.round((per * f) / STAGGER_MEAN)) };
  });
}

// The segments spot i of `spots` shows, counted from the plug: lo up to (not including) hi.
function spotRange(i, spots, segments) {
  const lo = Math.min(Math.floor((i * segments) / spots), segments - 1);
  return [lo, Math.max(lo + 1, Math.min(Math.floor(((i + 1) * segments) / spots), segments))];
}

// Where each light's segments sit on the house, for the House lane's effects: the middle of each
// segment's bulbs (or spots), scaled so the traced lights together run 0 to 1 across (u) and down
// (v). `lights` is [{dev, bulbs}] for lines and icicles or [{dev, spots}] for spotlights; a
// segment with nothing in view is null.
export function segmentPositions(lights) {
  const raw = {};
  for (const { dev, bulbs, spots } of lights) {
    const n = dev.segments, sum = Array.from({ length: n }, () => [0, 0, 0]);
    const add = (s, [x, y]) => { sum[s][0] += x; sum[s][1] += y; sum[s][2]++; };
    if (spots) {
      spots.forEach((p, i) => {
        const [lo, hi] = spotRange(i, spots.length, n);
        for (let j = lo; j < hi; j++) add(dev.reverse ? n - 1 - j : j, p);
      });
    } else {
      bulbs.forEach((b, j) => { if (b) add(bulbSegment(j, bulbs.length, n, dev.reverse), b.top || b); });
    }
    raw[dev.id] = sum.map(([x, y, k]) => (k ? [x / k, y / k] : null));
  }
  const all = Object.values(raw).flat().filter(Boolean);
  if (!all.length) return {};
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [sx, sy] = [Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1];
  const out = {};
  for (const [id, list] of Object.entries(raw)) {
    out[id] = list.map((p) => (p ? [(p[0] - x0) / sx, (p[1] - y0) / sy] : null));
  }
  return out;
}

// Spotlights: where spot i points, as an offset across and down the photo from where it sits.
export const DEFAULT_AIM = [0, -0.15];
export const aimOf = (style, i) => style.aims?.[i] || DEFAULT_AIM;

// The colour of spot `i` of `spots`: its share of the light's segments, counted from the plug
// (flipped by Reverse), averaged. `rgb` is the frame, 3 bytes per segment.
export function spotColour(i, spots, rgb, segments, reverse) {
  const [lo, hi] = spotRange(i, spots, segments);
  const sum = [0, 0, 0];
  for (let j = lo; j < hi; j++) {
    const s = reverse ? segments - 1 - j : j;
    for (let c = 0; c < 3; c++) sum[c] += rgb[s * 3 + c];
  }
  return sum.map((v) => Math.round(v / (hi - lo)));
}

// Which segment of the frame bulb `j` shows. Paths start at the plug; Reverse flips which end
// the show's first segment is at, as it does on the real light.
export function bulbSegment(j, bulbs, segments, reverse) {
  const s = Math.min(Math.floor((j * segments) / bulbs), segments - 1);
  return reverse ? segments - 1 - s : s;
}

function hueRgb(h) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

// Part k of a split light's colour, the same on the Devices tab and the House tab.
export const partRgb = (k) => hueRgb(((k * 137 + 200) % 360) / 360);

export class House {
  // api(path, opts), status(msg, error), frameFor(device) -> Uint8Array of the show's colours now.
  constructor({ api, status, frameFor }) {
    Object.assign(this, { api, status, frameFor });
    this.paths = {};
    // id -> {style: "icicle", drops, length} or {style: "spots", beam, aims}; others are a line
    this.styles = {};
    this.dim = 0.5;
    this.photo = null;
    this.devices = [];
    this.active = null; // id of the light being drawn on the House tab
    this.selected = null; // id of the light picked in the House tab's list
    this.drag = null; // {id, i} while a point is dragged
    this.stretch = null; // {id, i}: the stretch from point i - 1 to point i, picked on the House tab
    this.hover = null; // pointer position on the House tab, for the line to the next point
    this.hoverBulb = null; // {x, y, text}: the bulb under the pointer on the House tab
    this.hiddenLights = new Set(); // ids hidden on the House tab, to get at a light traced under another
    this.saveTimer = null;
    this.cache = new Map(); // id -> {key, bulbs}
  }

  async load() {
    try {
      const h = await this.api("api/house");
      this.paths = h.paths || {};
      this.styles = h.styles || {};
      this.dim = h.dim ?? 0.5;
      if (h.photo) await this.loadPhoto();
    } catch (e) {
      this.status(`Couldn't load the house view: ${e.message}`, true);
    }
  }

  async loadPhoto() {
    const img = new Image();
    img.src = `api/house/photo?v=${Date.now()}`;
    try { await img.decode(); this.photo = img; } catch { this.photo = null; }
  }

  // Phone photos are large, so they are scaled down to 2000 pixels across before upload.
  async upload(file) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
      await this.api("api/house/photo", { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
      await this.loadPhoto();
      this.status("House photo saved");
    } catch (e) {
      this.status(`Couldn't use that photo: ${e.message}`, true);
    }
  }

  async removePhoto() {
    await this.api("api/house/photo", { method: "DELETE" });
    this.photo = null;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await this.api("api/house", { method: "PUT", json: { paths: this.paths, styles: this.styles, dim: this.dim } });
      } catch (e) {
        this.status(`Couldn't save the house view: ${e.message}`, true);
      }
    }, 400);
  }

  // Sizes the canvas to the photo's shape, as wide as its box allows and no taller than maxH.
  fit(canvas, maxH) {
    const aspect = this.photo.naturalWidth / this.photo.naturalHeight;
    let w = canvas.parentElement.clientWidth, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    w = Math.round(w); h = Math.round(h);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // Where a light's bulbs are: [x, y] or null each for a line, or its drops for icicles.
  bulbs(dev) {
    const points = this.paths[dev.id];
    if (!points?.length) return null;
    const count = Math.min(dev.bulbs || dev.segments * BULBS_PER_SEGMENT, MAX_BULBS);
    const style = this.styles[dev.id];
    const key = `${count}:${JSON.stringify(style)}:${JSON.stringify(points)}`;
    let c = this.cache.get(dev.id);
    if (c?.key !== key) {
      const bulbs = style?.style === "icicle" ? icicleDrops(points, style.drops, count) : bulbLayout(points, count);
      this.cache.set(dev.id, c = { key, bulbs });
    }
    return c.bulbs;
  }

  // Each light's segment positions for the House lane (see segmentPositions).
  positions() {
    const lights = [];
    for (const dev of this.devices) {
      const pts = this.paths[dev.id];
      if (!pts?.length) continue;
      if (this.styles[dev.id]?.style === "spots") lights.push({ dev, spots: pts });
      else lights.push({ dev, bulbs: this.bulbs(dev) });
    }
    return segmentPositions(lights);
  }

  setStyle(id, style) {
    if (style) this.styles[id] = style;
    else delete this.styles[id];
    this.save();
  }

  // Whether a light is drawn and clickable on the House tab. The one being traced always is.
  shown(id) {
    return !this.hiddenLights.has(id) || id === this.active;
  }

  // The photo, darkened like dusk, with every placed light on it. `colours(dev)` gives each
  // light's segment colours; `skip(dev)` leaves a light out.
  paint(canvas, maxH, colours, skip) {
    const { ctx, w, h } = this.fit(canvas, maxH);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.photo, 0, 0, w, h);
    ctx.fillStyle = `rgba(0,0,0,${this.dim})`;
    ctx.fillRect(0, 0, w, h);
    const r = Math.max(1.5, w / 450);
    ctx.globalCompositeOperation = "lighter";
    const dot = (x, y, [cr, cg, cb], size = 1) => {
      if (cr + cg + cb < 8) {
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath(); ctx.arc(x, y, r * 0.7 * size, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.22)`; // glow
      ctx.beginPath(); ctx.arc(x, y, r * 3.2 * size, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.beginPath(); ctx.arc(x, y, r * size, 0, Math.PI * 2); ctx.fill();
    };
    for (const dev of this.devices) {
      if (skip?.(dev)) continue;
      const style = this.styles[dev.id];
      if (style?.style === "spots") {
        const pts = this.paths[dev.id];
        if (!pts?.length) continue;
        const rgb = colours(dev), cap = (dev.brightness ?? 100) / 100;
        pts.forEach(([x, y], i) => {
          const c = spotColour(i, pts.length, rgb, dev.segments, dev.reverse).map((v) => Math.round(v * cap));
          if (c[0] + c[1] + c[2] >= 8) this.wash(ctx, x * w, y * h, aimOf(style, i), style.beam, c, w, h);
          dot(x * w, y * h, c, 1.4);
        });
        continue;
      }
      const bulbs = this.bulbs(dev);
      if (!bulbs) continue;
      const rgb = colours(dev);
      const n = dev.segments, cap = (dev.brightness ?? 100) / 100;
      const colour = (j) => {
        const s = bulbSegment(j, bulbs.length, n, dev.reverse);
        return [rgb[s * 3], rgb[s * 3 + 1], rgb[s * 3 + 2]].map((v) => Math.round(v * cap));
      };
      const icicle = this.styles[dev.id];
      bulbs.forEach((b, j) => {
        if (!b) return;
        if (b.top) {
          // A drop: its bulbs hang evenly from the line to the drop's tip, a little smaller.
          const c = colour(j), drop = icicle.length * h * b.f;
          for (let k = 0; k < b.n; k++) dot(b.top[0] * w, b.top[1] * h + (b.n > 1 ? (drop * k) / (b.n - 1) : 0), c, 0.7);
        } else {
          dot(b[0] * w, b[1] * h, colour(j));
        }
      });
    }
    ctx.globalCompositeOperation = "source-over";
    return { ctx, w, h };
  }

  // A spotlight's beam on the wall: a soft oval of colour from where it sits towards where it
  // points, `beam` wide for its length.
  wash(ctx, x, y, [ax, ay], beam, [r, g, b], w, h) {
    const len = Math.max(Math.hypot(ax * w, ay * h), 4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(ay * h, ax * w));
    ctx.scale(1, beam);
    const grad = ctx.createRadialGradient(len * 0.55, 0, 0, len * 0.55, 0, len * 0.65);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.75)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(len * 0.55, 0, len * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The editor's House panel: the show at the playhead.
  drawPanel(canvas, hint) {
    const placed = this.devices.some((d) => this.paths[d.id]?.length);
    hint.hidden = !!this.photo && placed;
    canvas.hidden = !this.photo;
    if (!this.photo) {
      hint.textContent = "Add a photo of your house on the House tab to see the show on it.";
      return;
    }
    if (!placed) hint.textContent = "Trace your lights on the photo on the House tab.";
    this.paint(canvas, Math.max(window.innerHeight * 0.45, 200), (dev) => this.frameFor(dev));
  }

  // The House tab: each light in a rainbow from its plug to its far end, so the direction and
  // the spread of its segments are easy to check, with the traced paths on top.
  drawSetup(canvas) {
    if (!this.photo) return;
    // A rainbow from the plug, or for a split light each part in its colour with unused segments
    // left off, so you can see where the parts fall.
    const { ctx, w, h } = this.paint(canvas, Math.max(window.innerHeight - 260, 300), (dev) => {
      const out = new Uint8Array(dev.segments * 3);
      if (dev.parts?.length) {
        dev.parts.forEach((p, k) => { for (let s = p.from - 1; s < p.to; s++) out.set(partRgb(k), s * 3); });
        return out;
      }
      for (let i = 0; i < dev.segments; i++) {
        const s = dev.reverse ? dev.segments - 1 - i : i;
        out.set(hueRgb((i / dev.segments) * 0.8), s * 3);
      }
      return out;
    }, (dev) => !this.shown(dev.id));
    this.size = { w, h };
    for (const dev of this.devices) {
      const pts = this.paths[dev.id];
      if (!pts?.length || !this.shown(dev.id)) continue;
      const active = dev.id === (this.active || this.selected);
      const style = this.styles[dev.id];
      if (style?.style === "spots") {
        // Spots aren't joined up: each has a numbered square where it sits and, when the light
        // is picked, a round handle at the end of a line showing where it points.
        ctx.font = "11px system-ui, sans-serif";
        pts.forEach(([x, y], i) => {
          if (active) {
            const [ax, ay] = aimOf(style, i);
            ctx.strokeStyle = "rgba(80,170,255,0.9)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x * w, y * h);
            ctx.lineTo((x + ax) * w, (y + ay) * h);
            ctx.stroke();
            ctx.fillStyle = "rgb(80,170,255)";
            ctx.beginPath();
            ctx.arc((x + ax) * w, (y + ay) * h, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = i === 0 ? "#fff" : active ? "rgb(80,170,255)" : "rgba(255,255,255,0.6)";
          ctx.fillRect(x * w - 4, y * h - 4, 8, 8);
          ctx.fillStyle = "#fff";
          ctx.fillText(String(i + 1), x * w + 7, y * h + 12);
        });
        const [x0, y0] = pts[0];
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(`${dev.name} (plug)`, x0 * w + 8, y0 * h - 8);
        continue;
      }
      // Stretches in view are solid; ones out of view are dashed and labelled with their bulbs.
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const hidden = b[2] != null;
        const picked = this.stretch?.id === dev.id && this.stretch.i === i;
        ctx.strokeStyle = picked ? "#ffb020" : active ? "rgba(80,170,255,0.9)" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = picked ? 3 : active ? 2 : 1;
        ctx.setLineDash(hidden ? [6, 5] : []);
        ctx.beginPath();
        ctx.moveTo(a[0] * w, a[1] * h);
        ctx.lineTo(b[0] * w, b[1] * h);
        ctx.stroke();
        if (hidden) {
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillStyle = picked ? "#ffb020" : "rgba(255,255,255,0.8)";
          const label = b[2] ? `${b[2]} out of view` : "lead";
          ctx.fillText(label, ((a[0] + b[0]) / 2) * w + 6, ((a[1] + b[1]) / 2) * h - 6);
        }
      }
      ctx.setLineDash([]);
      if (dev.id === this.active && this.hover) {
        const [x, y] = pts[pts.length - 1];
        ctx.strokeStyle = "rgba(80,170,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x * w, y * h);
        ctx.lineTo(this.hover[0] * w, this.hover[1] * h);
        ctx.stroke();
      }
      pts.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? "#fff" : active ? "rgb(80,170,255)" : "rgba(255,255,255,0.6)";
        const s = i === 0 ? 5 : 3.5;
        ctx.fillRect(x * w - s, y * h - s, s * 2, s * 2);
      });
      const [x0, y0] = pts[0];
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText(`${dev.name} (plug)`, x0 * w + 8, y0 * h - 8);
      if (active) this.drawSegmentMarks(ctx, dev, w, h);
    }
    if (this.hoverBulb) {
      const { x, y, text } = this.hoverBulb;
      ctx.font = "12px system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 12;
      const bx = Math.min(x * w + 10, w - tw - 2), by = Math.max(y * h - 30, 2);
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.fillRect(bx, by, tw, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, bx + 6, by + 14);
    }
  }

  // Bulb j of a light: where it is on the photo, or null when out of view.
  bulbPoint(b) {
    return !b ? null : b.top || b;
  }

  // The picked light's segment numbers along it (as many as fit), and a split light's part names.
  drawSegmentMarks(ctx, dev, w, h) {
    const bulbs = this.bulbs(dev);
    if (!bulbs) return;
    const n = dev.segments;
    const first = new Map(); // segment -> its first bulb in view
    const spots = {}; // segment -> [x, y] sums, for the middle of each part
    bulbs.forEach((b, j) => {
      const p = this.bulbPoint(b);
      if (!p) return;
      const s = bulbSegment(j, bulbs.length, n, dev.reverse);
      if (!first.has(s)) first.set(s, p);
      (spots[s] ||= []).push(p);
    });
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    const placed = [];
    const room = (x, y, d) => placed.every(([px, py]) => Math.hypot(px - x, py - y) >= d);
    // Part edges first, then 1 and every 5th segment where there's room.
    const edges = new Set((dev.parts || []).flatMap((p) => [p.from - 1, p.to - 1]));
    const order = [...first.keys()].sort((a, b) => (edges.has(b) - edges.has(a)) || a - b)
      .filter((s) => edges.has(s) || s === 0 || (s + 1) % 5 === 0);
    for (const s of order) {
      const [x, y] = first.get(s);
      if (!room(x * w, y * h, 22)) continue;
      placed.push([x * w, y * h]);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(x * w - 9, y * h + 6, 18, 13);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(s + 1), x * w, y * h + 16);
    }
    ctx.textAlign = "start";
    // Part names beside the middle of each part, on a dark tag so they read over the line.
    ctx.font = "600 12px system-ui, sans-serif";
    for (const [k, p] of (dev.parts || []).entries()) {
      const pts = [];
      for (let s = p.from - 1; s < p.to; s++) pts.push(...(spots[s] || []));
      if (!pts.length) continue;
      const [x, y] = pts[Math.floor(pts.length / 2)];
      const tw = ctx.measureText(p.name).width + 10;
      const bx = Math.min(x * w + 10, w - tw - 2), by = Math.max(y * h - 26, 2);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(bx, by, tw, 18);
      ctx.fillStyle = `rgb(${partRgb(k).join()})`;
      ctx.fillText(p.name, bx + 5, by + 13);
    }
  }

  // The bulb nearest `p` on a light that's shown, as text for a tooltip, or null.
  bulbAt(p) {
    const { w, h } = this.size || { w: 1, h: 1 };
    let best = null, bestD = HIT_PX;
    for (const dev of this.devices) {
      if (!this.shown(dev.id) || this.styles[dev.id]?.style === "spots") continue;
      const bulbs = this.bulbs(dev);
      bulbs?.forEach((b, j) => {
        const q = this.bulbPoint(b);
        if (!q) return;
        const d = Math.hypot((q[0] - p[0]) * w, (q[1] - p[1]) * h);
        if (d >= bestD) return;
        bestD = d;
        const s = bulbSegment(j, bulbs.length, dev.segments, dev.reverse) + 1;
        const part = dev.parts?.find((x) => x.from <= s && s <= x.to);
        const where = !dev.parts?.length ? "" : part ? ` · ${part.name}` : " · unused, off";
        best = { x: q[0], y: q[1], text: `${dev.name}: segment ${s}${where}` };
      });
    }
    return best;
  }

  // Out of view: the picked stretch holds `bulbs` bulbs that can't be seen (0 for an extension
  // lead). In view: null.
  setHidden(bulbs) {
    const p = this.stretch && this.paths[this.stretch.id]?.[this.stretch.i];
    if (!p) return;
    if (bulbs == null) p.length = 2;
    else p[2] = Math.min(Math.max(Math.round(bulbs) || 0, 0), MAX_BULBS);
    this.save();
  }

  pickedStretch() {
    const s = this.stretch;
    const p = s && this.paths[s.id]?.[s.i];
    return p && s.i > 0 ? { ...s, hidden: p[2] ?? null } : null;
  }

  // Pointer handling on the House tab's canvas: click adds a point to the light being drawn,
  // drag moves any point, right-click removes one. When no light is being drawn, clicking a
  // line between two points picks that stretch, to mark it out of view.
  wireSetup(canvas, onChange) {
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
        Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)];
    };
    const hit = (p) => {
      const { w, h } = this.size || { w: 1, h: 1 };
      let best = null, bestD = HIT_PX;
      const ids = [this.active, ...Object.keys(this.paths)].filter((id) => id && this.shown(id));
      const picked = this.active || this.selected;
      for (const id of ids) {
        const style = this.styles[id];
        (this.paths[id] || []).forEach(([x, y], i) => {
          const d = Math.hypot((x - p[0]) * w, (y - p[1]) * h);
          if (d < bestD) { bestD = d; best = { id, i }; }
          if (style?.style === "spots" && id === picked) {
            const [ax, ay] = aimOf(style, i);
            const da = Math.hypot((x + ax - p[0]) * w, (y + ay - p[1]) * h);
            if (da < bestD) { bestD = da; best = { id, i, aim: true }; }
          }
        });
      }
      return best;
    };
    const hitStretch = (p) => {
      const { w, h } = this.size || { w: 1, h: 1 };
      let best = null, bestD = HIT_PX;
      for (const [id, pts] of Object.entries(this.paths)) {
        if (this.styles[id]?.style === "spots" || !this.shown(id)) continue; // spots have no stretches
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay, bx, by] = [pts[i - 1][0] * w, pts[i - 1][1] * h, pts[i][0] * w, pts[i][1] * h];
          const [px, py] = [p[0] * w, p[1] * h];
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const u = len2 ? Math.min(Math.max(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2, 0), 1) : 0;
          const d = Math.hypot(px - (ax + (bx - ax) * u), py - (ay + (by - ay) * u));
          if (d < bestD) { bestD = d; best = { id, i }; }
        }
      }
      return best;
    };
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const found = hit(at(e));
      if (!found) return;
      this.paths[found.id].splice(found.i, 1);
      this.styles[found.id]?.aims?.splice(found.i, 1);
      if (!this.paths[found.id].length) delete this.paths[found.id];
      else this.paths[found.id][0].length = 2; // the first point has no stretch before it
      this.stretch = null;
      this.save();
      onChange();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const p = at(e), found = hit(p);
      if (found) {
        this.drag = found;
        canvas.setPointerCapture(e.pointerId);
        if (!this.active && this.selected !== found.id) {
          this.selected = found.id;
          this.stretch = null;
          onChange();
        }
      } else if (this.active) {
        (this.paths[this.active] ||= []).push(p);
        this.save();
        onChange();
      } else {
        // Clicking a light's line picks that stretch and that light; clicking elsewhere drops both.
        this.stretch = hitStretch(p);
        this.selected = this.stretch?.id ?? null;
        onChange();
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = at(e);
      this.hover = this.active && !this.drag && this.styles[this.active]?.style !== "spots" ? p : null;
      this.hoverBulb = this.drag || this.active ? null : this.bulbAt(p);
      const d = this.drag;
      if (d?.aim) {
        const style = this.styles[d.id], [x, y] = this.paths[d.id][d.i];
        style.aims ||= [];
        for (let k = style.aims.length; k < d.i; k++) style.aims.push([...DEFAULT_AIM]);
        style.aims[d.i] = [+(p[0] - x).toFixed(4), +(p[1] - y).toFixed(4)];
      } else if (d) {
        this.paths[d.id][d.i].splice(0, 2, ...p);
      }
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.hoverBulb = null; });
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      this.save();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }
}
