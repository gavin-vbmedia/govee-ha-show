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

export class House {
  // api(path, opts), status(msg, error), frameFor(device) -> Uint8Array of the show's colours now.
  constructor({ api, status, frameFor }) {
    Object.assign(this, { api, status, frameFor });
    this.paths = {};
    this.styles = {}; // id -> {style: "icicle", drops, length}; lights without one are a line
    this.dim = 0.5;
    this.photo = null;
    this.devices = [];
    this.active = null; // id of the light being drawn on the House tab
    this.selected = null; // id of the light picked in the House tab's list
    this.drag = null; // {id, i} while a point is dragged
    this.stretch = null; // {id, i}: the stretch from point i - 1 to point i, picked on the House tab
    this.hover = null; // pointer position on the House tab, for the line to the next point
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

  setStyle(id, style) {
    if (style) this.styles[id] = style;
    else delete this.styles[id];
    this.save();
  }

  // The photo, darkened like dusk, with every placed light on it. `colours(dev)` gives each
  // light's segment colours.
  paint(canvas, maxH, colours) {
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
    const { ctx, w, h } = this.paint(canvas, Math.max(window.innerHeight - 260, 300), (dev) => {
      const out = new Uint8Array(dev.segments * 3);
      for (let i = 0; i < dev.segments; i++) {
        const s = dev.reverse ? dev.segments - 1 - i : i;
        out.set(hueRgb((i / dev.segments) * 0.8), s * 3);
      }
      return out;
    });
    this.size = { w, h };
    for (const dev of this.devices) {
      const pts = this.paths[dev.id];
      if (!pts?.length) continue;
      const active = dev.id === (this.active || this.selected);
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
    }
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
      const ids = [this.active, ...Object.keys(this.paths)].filter(Boolean);
      for (const id of ids) {
        (this.paths[id] || []).forEach(([x, y], i) => {
          const d = Math.hypot((x - p[0]) * w, (y - p[1]) * h);
          if (d < bestD) { bestD = d; best = { id, i }; }
        });
      }
      return best;
    };
    const hitStretch = (p) => {
      const { w, h } = this.size || { w: 1, h: 1 };
      let best = null, bestD = HIT_PX;
      for (const [id, pts] of Object.entries(this.paths)) {
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
      this.hover = this.active && !this.drag ? p : null;
      if (this.drag) this.paths[this.drag.id][this.drag.i].splice(0, 2, ...p);
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; });
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      this.save();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }
}
