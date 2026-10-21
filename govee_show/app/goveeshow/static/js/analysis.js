// Song analysis: tempo, beats, bars and sections, found from the audio itself.
//
// Pure functions of a mono signal, so the editor runs them in a worker and the tests run them
// in Node. The approach is the classic one: an onset-strength envelope from spectral flux, tempo
// from its autocorrelation, beats by dynamic programming (Ellis, 2007), and section boundaries
// from the novelty of a bar-by-bar self-similarity matrix (Foote, 2000).

const TARGET_RATE = 11025; // analysis rate: plenty for rhythm and timbre, and quick
const WIN = 512;
const HOP = 128;
const BANDS = 12;

// Mixes channels to mono and downsamples by averaging blocks, a rough but adequate low-pass.
export function toMono(channels, rate) {
  const k = Math.max(1, Math.round(rate / TARGET_RATE));
  const n = Math.floor(channels[0].length / k);
  const out = new Float32Array(n);
  const scale = 1 / (k * channels.length);
  for (const ch of channels) {
    for (let i = 0, j = 0; i < n; i++) {
      let s = 0;
      for (let e = j + k; j < e; j++) s += ch[j];
      out[i] += s * scale;
    }
  }
  return { samples: out, rate: rate / k };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Per frame (centred on i * HOP): onset strength, loudness, a coarse timbre (log band energies)
// and chroma (energy per pitch class).
export function features(samples, rate) {
  const frames = Math.max(1, Math.floor(samples.length / HOP));
  const bins = WIN / 2;
  const win = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
  // Log-spaced bands from 60 Hz up, and each bin's pitch class from 100 Hz to 4 kHz.
  const lo = Math.log(60), hi = Math.log(rate / 2);
  const band = new Int8Array(bins + 1).fill(-1);
  const pitch = new Int8Array(bins + 1).fill(-1);
  for (let b = 1; b <= bins; b++) {
    const f = (b * rate) / WIN;
    if (f >= 60) band[b] = Math.min(BANDS - 1, Math.floor(((Math.log(f) - lo) / (hi - lo)) * BANDS));
    if (f >= 100 && f <= 4000) pitch[b] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const onset = new Float32Array(frames);
  const loud = new Float32Array(frames);
  const timbre = Array.from({ length: frames }, () => new Float32Array(BANDS));
  const chroma = Array.from({ length: frames }, () => new Float32Array(12));
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  let prev = new Float32Array(bins + 1), cur = new Float32Array(bins + 1);
  for (let i = 0; i < frames; i++) {
    const start = i * HOP - WIN / 2;
    let energy = 0;
    for (let j = 0; j < WIN; j++) {
      const s = samples[start + j] || 0;
      re[j] = s * win[j];
      im[j] = 0;
      energy += s * s;
    }
    fft(re, im);
    let flux = 0;
    for (let b = 1; b <= bins; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      cur[b] = Math.log1p(100 * Math.sqrt(p));
      if (i > 0 && cur[b] > prev[b]) flux += (cur[b] - prev[b]) / Math.sqrt(b);
      if (band[b] >= 0) timbre[i][band[b]] += p;
      if (pitch[b] >= 0) chroma[i][pitch[b]] += p;
    }
    onset[i] = flux;
    loud[i] = 10 * Math.log10(energy / WIN + 1e-10);
    for (let k = 0; k < BANDS; k++) timbre[i][k] = Math.log10(timbre[i][k] + 1e-6);
    [prev, cur] = [cur, prev];
  }
  return { fps: rate / HOP, onset: normaliseOnset(onset, rate / HOP), loud, timbre, chroma };
}

// Removes the local average so only sudden rises count, and scales to unit deviation.
function normaliseOnset(env, fps) {
  const half = Math.round(fps * 0.25);
  const out = new Float32Array(env.length);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < env.length; i++) {
    while (hi < Math.min(env.length - 1, i + half)) sum += env[++hi];
    while (lo < i - half) sum -= env[lo++];
    out[i] = Math.max(0, env[i] - sum / (hi - lo + 1));
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const sd = Math.sqrt(sq / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

// Beats per minute, from the onset envelope's autocorrelation weighted towards 120 BPM. The
// weighting is fairly narrow, so a slow song reads at double time, which suits lights better.
export function estimateTempo(onset, fps, { min = 60, max = 200 } = {}) {
  const minLag = Math.floor((60 * fps) / max), maxLag = Math.ceil((60 * fps) / min);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (onset.length - lag);
  }
  let best = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.5) ** 2);
    const score = ac[lag] * w;
    if (score > bestScore && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { best = lag; bestScore = score; }
  }
  if (best < 0) return 0;
  // Music with a beat repeats at a third or more of its own strength; noise and held notes don't.
  let power = 0;
  for (const v of onset) power += v * v;
  if (ac[best] < 0.15 * (power / onset.length)) return 0;
  // Parabolic interpolation for a fractional period.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const d = a - 2 * b + c;
  const lag = best + (d ? (0.5 * (a - c)) / d : 0);
  return (60 * fps) / lag;
}

// Beat frames by dynamic programming: each beat rewards onset strength, and the gap to the one
// before it is penalised for straying from the tempo's period.
export function trackBeats(onset, fps, bpm, tightness = 100) {
  const period = (60 * fps) / bpm;
  const n = onset.length;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (s > best || from < 0) { best = s; from = p; }
    }
    score[t] = onset[t] + Math.max(0, best);
    back[t] = best > 0 ? from : -1;
  }
  // End on the best-scoring beat in the last period, then walk back.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // Drop beats in silence at either end, where the tracker just keeps time.
  const strength = beats.map((t) => localMax(onset, t, 2));
  const mean = strength.reduce((a, b) => a + b, 0) / (strength.length || 1);
  let first = 0, last = beats.length - 1;
  while (first < last && strength[first] < mean * 0.25) first++;
  while (last > first && strength[last] < mean * 0.25) last--;
  return beats.slice(first, last + 1);
}

function localMax(a, i, r) {
  let m = 0;
  for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) m = Math.max(m, a[j]);
  return m;
}

const average = (rows, a, b) => {
  const out = new Float32Array(rows[0].length);
  const n = Math.max(1, b - a);
  for (let i = a; i < b; i++) for (let k = 0; k < out.length; k++) out[k] += rows[i][k] / n;
  return out;
};

function unit(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return v.map((x) => x / s);
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Which of the first four beats starts a bar, reading the song as 4/4: the one where the
// harmony changes most, the bass rises and the hits are strongest. Each cue is scaled by its own
// average so none of them swamps the others.
export function downbeatPhase(beatFrames, f, meter = 4) {
  if (beatFrames.length < meter * 2) return 0;
  const chroma = beatFrames.map((t, i) => unit(average(f.chroma, t, beatFrames[i + 1] ?? t + 1)));
  const bassAt = (t) => f.timbre[Math.max(0, t)][0] + f.timbre[Math.max(0, t)][1];
  const cues = [
    beatFrames.map((t, i) => (i ? 1 - dot(chroma[i], chroma[i - 1]) : 0)),
    beatFrames.map((t) => Math.max(0, bassAt(t) - bassAt(t - 4))),
    beatFrames.map((t) => localMax(f.onset, t, 2)),
  ];
  const scores = new Float64Array(meter);
  for (const cue of cues) {
    const mean = cue.reduce((a, b) => a + b, 0) / cue.length || 1;
    cue.forEach((v, i) => { scores[i % meter] += v / mean; });
  }
  let best = 0;
  for (let p = 1; p < meter; p++) if (scores[p] > scores[best]) best = p;
  return best;
}

// Splits the song into sections, then names them by how they repeat and how loud they are.
// `units` are frame boundaries to work in (bar starts, or fixed blocks when there are no beats).
export function findSections(units, f, duration, { kernel = 8, minUnits = 4 } = {}) {
  const n = units.length - 1;
  if (n < minUnits * 2) return [{ start: 0, end: duration, label: "Song", energy: 0.5 }];
  // One vector per unit: chroma for harmony, band energies for timbre, z-scored across the song.
  const raw = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [units[i], units[i + 1]];
    raw.push([...unit(average(f.chroma, a, b)), ...average(f.timbre, a, b), meanOf(f.loud, a, b) / 10]);
  }
  const vecs = zscore(raw).map(unit);
  const sim = vecs.map((a) => vecs.map((b) => dot(a, b)));
  // Novelty: a checkerboard kernel slid along the diagonal is high where the past and future
  // look alike within themselves but different from each other.
  const novelty = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let s = 0, w = 0;
    for (let a = -kernel; a < kernel; a++) {
      for (let b = -kernel; b < kernel; b++) {
        const x = i + a, y = i + b;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const g = Math.exp(-(((a + 0.5) / kernel) ** 2 + ((b + 0.5) / kernel) ** 2) * 2);
        s += ((a < 0) === (b < 0) ? 1 : -1) * g * sim[x][y];
        w += g;
      }
    }
    novelty[i] = s / (w || 1);
  }
  const mean = novelty.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(novelty.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  // Peaks well above average, at least minUnits apart, strongest first.
  const peaks = [];
  for (let i = 1; i < n; i++) {
    if (novelty[i] >= novelty[i - 1] && novelty[i] >= (novelty[i + 1] ?? -Infinity) && novelty[i] > mean + 0.5 * sd) peaks.push(i);
  }
  peaks.sort((a, b) => novelty[b] - novelty[a]);
  const cuts = [];
  for (const p of peaks) {
    if (p < minUnits || n - p < minUnits) continue;
    if (cuts.every((c) => Math.abs(c - p) >= minUnits)) cuts.push(p);
  }
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts, n];
  const fps = f.fps;
  const sections = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const [a, b] = [bounds[s], bounds[s + 1]];
    sections.push({
      units: [a, b],
      start: s === 0 ? 0 : units[a] / fps,
      end: s === bounds.length - 2 ? duration : units[b] / fps,
      loud: meanOf(f.loud, units[a], units[b]),
      vec: unit(average(vecs, a, b)),
    });
  }
  return nameSections(sections);
}

function meanOf(a, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / Math.max(1, to - from);
}

function zscore(rows) {
  const d = rows[0].length, n = rows.length;
  const mu = new Float64Array(d), sd = new Float64Array(d);
  for (const r of rows) r.forEach((x, k) => { mu[k] += x / n; });
  for (const r of rows) r.forEach((x, k) => { sd[k] += (x - mu[k]) ** 2 / n; });
  return rows.map((r) => r.map((x, k) => (x - mu[k]) / (Math.sqrt(sd[k]) || 1)));
}

// Sections that sound alike share a group; the loudest group that comes back is the chorus,
// the most common other one the verse, and quiet ends are the intro and outro.
function nameSections(sections) {
  const lo = Math.min(...sections.map((s) => s.loud)), hi = Math.max(...sections.map((s) => s.loud));
  for (const s of sections) s.energy = hi - lo > 1 ? (s.loud - lo) / (hi - lo) : 0.5;
  const groups = [];
  for (const s of sections) {
    let g = groups.find((g) => dot(g.vec, s.vec) > 0.6 && Math.abs(g.energy - s.energy) < 0.35);
    if (!g) groups.push((g = { vec: s.vec, energy: s.energy, members: [] }));
    g.members.push(s);
    s.group = g;
  }
  for (const g of groups) g.energy = g.members.reduce((a, s) => a + s.energy, 0) / g.members.length;
  const repeated = groups.filter((g) => g.members.length > 1);
  const chorus = repeated.reduce((best, g) => (!best || g.energy > best.energy ? g : best), null);
  const verse = repeated.filter((g) => g !== chorus).reduce((best, g) => (!best || g.members.length > best.members.length ? g : best), null);
  const others = groups.filter((g) => g !== chorus && g !== verse);
  others.forEach((g, i) => { g.name = others.length > 1 ? `Part ${String.fromCharCode(65 + i)}` : "Bridge"; });
  if (chorus) chorus.name = "Chorus";
  if (verse) verse.name = "Verse";
  const median = [...sections].sort((a, b) => a.energy - b.energy)[Math.floor(sections.length / 2)].energy;
  return sections.map((s, i) => {
    let label = s.group.name;
    if (i === 0 && s.group.members.length === 1 && s.energy <= median) label = "Intro";
    else if (i === sections.length - 1 && s.group.members.length === 1 && s.energy <= median) label = "Outro";
    return { start: round(s.start), end: round(s.end), label, energy: Math.round(s.energy * 100) / 100 };
  });
}

const round = (t) => Math.round(t * 1000) / 1000;

// Everything at once, from mono samples: {tempo, beats, bars, sections}, times in seconds.
export function analyse(samples, rate) {
  const duration = samples.length / rate;
  const f = features(samples, rate);
  const tempo = estimateTempo(f.onset, f.fps);
  const frames = tempo ? trackBeats(f.onset, f.fps, tempo) : [];
  let units, bars = [];
  if (frames.length >= 8) {
    const phase = downbeatPhase(frames, f);
    const barFrames = frames.filter((_, i) => i % 4 === phase);
    bars = barFrames.map((t) => round(t / f.fps));
    units = [0, ...barFrames.filter((t) => t > 0), f.onset.length];
  } else {
    // No steady beat: work in two-second blocks.
    const step = Math.round(f.fps * 2);
    units = [];
    for (let t = 0; t < f.onset.length; t += step) units.push(t);
    units.push(f.onset.length);
  }
  return {
    tempo: Math.round(tempo * 10) / 10,
    beats: frames.map((t) => round(t / f.fps)),
    bars,
    sections: findSections(units, f, duration),
  };
}
