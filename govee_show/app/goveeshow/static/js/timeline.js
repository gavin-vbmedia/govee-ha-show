// Canvas timeline: ruler, waveform, beat lane and one track per device.
//
// The canvas stays the size of the viewport (sticky inside a wide scroll area),
// so long songs at high zoom never hit browser canvas size limits.

import { EFFECTS, newClip, renderTrack } from "./effects.js";

const HEADER_W = 150;
const RULER_H = 22;
const WAVE_H = 56;
const BEAT_H = 16;
const TRACK_H = 46;
const TOP = RULER_H + WAVE_H + BEAT_H;
const EDGE_PX = 6;
const SNAP_PX = 8;
const MIN_LEN = 0.05;

export class Timeline {
  // app provides: show, devices (by id), pps, time, selected, paletteEffect, snap,
  // peaks, duration(), and callbacks seek(t), select(sel), changed({live}).
  constructor(app) {
    this.app = app;
    this.scroll = document.getElementById("timeline-scroll");
    this.inner = document.getElementById("timeline-inner");
    this.canvas = document.getElementById("timeline");
    this.overlay = document.getElementById("timeline-overlay");
    this.ctx = this.canvas.getContext("2d");
    this.octx = this.overlay.getContext("2d");
    this.drag = null;
    this.scroll.addEventListener("scroll", () => this.draw());
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.layout()).observe(this.scroll);
  }

  get duration() { return Math.max(this.app.duration(), 1); }
  get scrollX() { return this.scroll.scrollLeft; }
  x(t) { return HEADER_W + t * this.app.pps - this.scrollX; }
  t(x) { return (x - HEADER_W + this.scrollX) / this.app.pps; }
  trackAt(y) {
    const i = Math.floor((y - TOP) / TRACK_H);
    return y >= TOP && i < this.app.show.tracks.length ? i : -1;
  }

  layout() {
    const w = this.scroll.clientWidth;
    const h = TOP + Math.max(this.app.show?.tracks.length || 0, 1) * TRACK_H;
    this.inner.style.width = `${HEADER_W + this.duration * this.app.pps + 40}px`;
    this.inner.style.height = `${h}px`;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.w = w;
    this.h = h;
    this.draw();
  }

  zoom(factor, anchorX = HEADER_W + (this.w - HEADER_W) / 2) {
    const t = this.t(anchorX);
    this.app.pps = Math.min(Math.max(this.app.pps * factor, 4), 800);
    this.layout();
    this.scroll.scrollLeft = HEADER_W + t * this.app.pps - anchorX;
  }

  // Keep the playhead visible while playing.
  follow(t) {
    const x = this.x(t);
    if (x > this.w - 40 || x < HEADER_W) this.scroll.scrollLeft = t * this.app.pps - 60;
  }

  // drawing ------------------------------------------------------------------
  draw() {
    if (!this.app.show || !this.w) return;
    const { ctx, w, h } = this;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    ctx.clearRect(0, 0, w, h);

    // tracks
    this.app.show.tracks.forEach((tr, i) => {
      const y = TOP + i * TRACK_H;
      ctx.fillStyle = col(i % 2 ? "--track-alt" : "--track");
      ctx.fillRect(HEADER_W, y, w - HEADER_W, TRACK_H);
      const dev = this.app.devices[tr.device];
      tr.clips.forEach((clip) => this.drawClip(clip, y, dev ? dev.segments : 10, col));
    });

    // beats
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, RULER_H + WAVE_H, w - HEADER_W, BEAT_H);
    for (const b of this.app.show.beats) {
      const x = this.x(b);
      if (x < HEADER_W || x > w) continue;
      ctx.strokeStyle = col("--beat");
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER_H + WAVE_H); ctx.lineTo(x + 0.5, h); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col("--beat");
      ctx.beginPath();
      ctx.moveTo(x - 4, RULER_H + WAVE_H + 3); ctx.lineTo(x + 4, RULER_H + WAVE_H + 3);
      ctx.lineTo(x, RULER_H + WAVE_H + BEAT_H - 3); ctx.fill();
    }

    this.drawWave(col);
    this.drawRuler(col);

    // header column
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, 0, HEADER_W, h);
    ctx.fillStyle = col("--muted");
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("Song", 10, RULER_H + WAVE_H / 2 + 4);
    ctx.fillText("Beats", 10, RULER_H + WAVE_H + 12);
    this.app.show.tracks.forEach((tr, i) => {
      const y = TOP + i * TRACK_H;
      const dev = this.app.devices[tr.device];
      ctx.fillStyle = col("--text");
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(clipText(ctx, dev ? dev.name : "Missing device", HEADER_W - 16), 10, y + 20);
      ctx.fillStyle = col("--muted");
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(dev ? `${dev.segments} segments` : tr.device, 10, y + 36);
    });
    ctx.strokeStyle = col("--line");
    ctx.beginPath(); ctx.moveTo(HEADER_W + 0.5, 0); ctx.lineTo(HEADER_W + 0.5, h); ctx.stroke();
    for (let i = 0; i <= this.app.show.tracks.length; i++) {
      const y = TOP + i * TRACK_H + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    this.drawPlayhead();
  }

  // A clip shows its own animation: time runs left to right, segments top to bottom.
  drawClip(clip, y, n, col) {
    const { ctx, w } = this;
    const x0 = this.x(clip.start), x1 = this.x(clip.end);
    if (x1 < HEADER_W || x0 > w) return;
    const top = y + 4, height = TRACK_H - 8;
    const left = Math.max(x0, HEADER_W), right = Math.min(x1, w);
    const step = 3, segH = height / n;
    const buf = new Uint8Array(n * 3);
    for (let x = left; x < right; x += step) {
      const t = this.t(x + step / 2);
      renderTrack([clip], Math.min(Math.max(t, clip.start), clip.end - 1e-6), n, buf);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgb(${buf[i * 3]},${buf[i * 3 + 1]},${buf[i * 3 + 2]})`;
        ctx.fillRect(x, top + i * segH, Math.min(step, right - x), segH + 0.5);
      }
    }
    const selected = this.app.selected?.clip === clip;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? col("--accent") : "rgba(255,255,255,0.6)";
    ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, height - 1);
    ctx.lineWidth = 1;
    if (x1 - x0 > 40) {
      ctx.font = "600 11px system-ui, sans-serif";
      const label = EFFECTS[clip.effect]?.label || clip.effect;
      const tx = Math.max(x0, HEADER_W) + 4;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(tx - 2, top + 2, ctx.measureText(label).width + 6, 15);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx + 1, top + 13);
    }
  }

  drawWave(col) {
    const { ctx, w } = this;
    const mid = RULER_H + WAVE_H / 2;
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, RULER_H, w - HEADER_W, WAVE_H);
    const peaks = this.app.peaks;
    if (!peaks) return;
    ctx.fillStyle = col("--wave");
    for (let x = HEADER_W; x < w; x++) {
      const a = Math.floor(this.t(x) * peaks.rate), b = Math.floor(this.t(x + 1) * peaks.rate);
      if (a < 0 || a >= peaks.data.length) continue;
      let m = 0;
      for (let i = a; i <= Math.min(b, peaks.data.length - 1); i++) m = Math.max(m, peaks.data[i]);
      const hh = Math.max(1, m * (WAVE_H / 2 - 3));
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }

  drawRuler(col) {
    const { ctx, w } = this;
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, 0, w - HEADER_W, RULER_H);
    const pps = this.app.pps;
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) || 300;
    ctx.fillStyle = col("--muted");
    ctx.strokeStyle = col("--line");
    ctx.font = "11px system-ui, sans-serif";
    for (let t = Math.floor(this.t(HEADER_W) / step) * step; this.x(t) < w; t += step) {
      const x = this.x(t);
      if (x < HEADER_W) continue;
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER_H - 8); ctx.lineTo(x + 0.5, RULER_H); ctx.stroke();
      ctx.fillText(fmtTime(t, step < 1), x + 3, 12);
    }
  }

  drawPlayhead() {
    const { octx, w, h } = this;
    if (!w) return;
    octx.clearRect(0, 0, w, h);
    const x = this.x(this.app.time);
    if (x < HEADER_W || x > w) return;
    octx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--playhead");
    octx.lineWidth = 2;
    octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, h); octx.stroke();
  }

  // interaction ---------------------------------------------------------------
  snapTime(t, e, ignore) {
    if (!this.app.snap || e.shiftKey) return t;
    const limit = SNAP_PX / this.app.pps;
    let best = t, dist = limit;
    const consider = (c) => {
      const d = Math.abs(c - t);
      if (d < dist) { dist = d; best = c; }
    };
    consider(0);
    this.app.show.beats.forEach(consider);
    for (const tr of this.app.show.tracks) {
      for (const c of tr.clips) if (c !== ignore) { consider(c.start); consider(c.end); }
    }
    return best;
  }

  hitClip(x, y) {
    const ti = this.trackAt(y);
    if (ti < 0 || x < HEADER_W) return null;
    const clips = this.app.show.tracks[ti].clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i], x0 = this.x(c.start), x1 = this.x(c.end);
      if (x >= x0 - 2 && x <= x1 + 2) {
        const mode = x - x0 < EDGE_PX ? "start" : x1 - x < EDGE_PX ? "end" : "move";
        return { track: ti, clip: c, mode };
      }
    }
    return null;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    const [x, y] = this.pos(e);
    if (x < HEADER_W) return;
    this.canvas.setPointerCapture(e.pointerId);
    const app = this.app;
    if (y < RULER_H + WAVE_H) {
      this.drag = { mode: "seek" };
      app.seek(Math.max(0, this.t(x)));
      return;
    }
    if (y < TOP) {
      const beats = app.show.beats;
      const near = beats.findIndex((b) => Math.abs(this.x(b) - x) < 5);
      if (near >= 0) beats.splice(near, 1);
      else { beats.push(Math.max(0, this.t(x))); beats.sort((a, b) => a - b); }
      app.changed();
      return;
    }
    const hit = this.hitClip(x, y);
    if (hit) {
      app.select({ track: hit.track, clip: hit.clip });
      this.drag = { ...hit, t0: this.t(x), start: hit.clip.start, end: hit.clip.end, moved: false };
      return;
    }
    const ti = this.trackAt(y);
    if (ti < 0) return;
    const t = Math.max(0, this.snapTime(this.t(x), e));
    const clip = newClip(app.paletteEffect, t, t + MIN_LEN);
    app.show.tracks[ti].clips.push(clip);
    app.select({ track: ti, clip });
    this.drag = { mode: "create", track: ti, clip, anchor: t, moved: false };
  }

  move(e) {
    const [x, y] = this.pos(e);
    const d = this.drag;
    if (!d) {
      const hit = this.hitClip(x, y);
      this.canvas.style.cursor = !hit ? (y < RULER_H + WAVE_H && x > HEADER_W ? "text" : "crosshair")
        : hit.mode === "move" ? "grab" : "ew-resize";
      return;
    }
    const t = this.t(x);
    if (d.mode === "seek") { this.app.seek(Math.max(0, t)); return; }
    d.moved = true;
    const c = d.clip;
    if (d.mode === "create") {
      const s = Math.max(0, this.snapTime(t, e, c));
      [c.start, c.end] = s >= d.anchor ? [d.anchor, Math.max(s, d.anchor + MIN_LEN)] : [s, d.anchor];
    } else if (d.mode === "start") {
      c.start = Math.min(Math.max(0, this.snapTime(t, e, c)), c.end - MIN_LEN);
    } else if (d.mode === "end") {
      c.end = Math.max(this.snapTime(t, e, c), c.start + MIN_LEN);
    } else {
      const len = d.end - d.start;
      let s = Math.max(0, d.start + t - d.t0);
      const sStart = this.snapTime(s, e, c), sEnd = this.snapTime(s + len, e, c);
      if (sStart !== s) s = sStart; else if (sEnd !== s + len) s = sEnd - len;
      c.start = Math.max(0, s);
      c.end = c.start + len;
      const ti = this.trackAt(y);
      if (ti >= 0 && ti !== d.track) {
        const from = this.app.show.tracks[d.track].clips;
        from.splice(from.indexOf(c), 1);
        this.app.show.tracks[ti].clips.push(c);
        d.track = ti;
        this.app.selected.track = ti;
      }
    }
    this.app.changed({ live: true });
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode === "seek") return;
    if (d.mode === "create" && !d.moved) {
      // A plain click places a clip up to the next beat, or two seconds long.
      const next = this.app.show.beats.find((b) => b > d.anchor + MIN_LEN);
      d.clip.end = next ?? d.anchor + 2;
    }
    if (d.moved || d.mode === "create") this.app.changed();
  }

  wheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, this.pos(e)[0]);
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      this.scroll.scrollLeft += e.deltaY;
    }
  }
}

function clipText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

export function fmtTime(t, frac = true) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${frac ? s.toFixed(2).padStart(5, "0") : String(Math.floor(s)).padStart(2, "0")}`;
}
