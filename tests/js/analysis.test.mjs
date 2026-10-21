import assert from "node:assert/strict";
import test from "node:test";

import { analyse, toMono } from "../../govee_show/app/goveeshow/static/js/analysis.js";

const RATE = 11025;

// A repeatable noise source, so the tests don't flake.
function noise(seed = 1) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 31) - 1;
}

// A drum-machine song: kick on beats 1 and 3, snare on 2 and 4, a held chord that changes each bar.
// `parts` is a list of {bars, chords, gain}; returns the samples and the true beat times.
function song({ bpm = 120, lead = 0.5, parts }) {
  const beat = 60 / bpm;
  const bars = parts.reduce((n, p) => n + p.bars, 0);
  const out = new Float32Array(Math.ceil((lead + bars * 4 * beat + 1) * RATE));
  const rnd = noise();
  const beats = [];
  let bar = 0;
  for (const part of parts) {
    for (let b = 0; b < part.bars; b++, bar++) {
      const t0 = lead + bar * 4 * beat;
      const freqs = part.chords[b % part.chords.length];
      const i0 = Math.round(t0 * RATE), len = Math.round(4 * beat * RATE);
      for (let j = 0; j < len; j++) {
        let v = 0;
        for (const f of freqs) v += Math.sin((2 * Math.PI * f * j) / RATE);
        out[i0 + j] += 0.08 * part.gain * v;
      }
      for (let k = 0; k < 4; k++) {
        const t = t0 + k * beat;
        beats.push(t);
        const s0 = Math.round(t * RATE);
        for (let j = 0; j < 2000; j++) {
          const kick = k % 2 === 0 ? Math.sin((2 * Math.PI * 55 * j) / RATE) * Math.exp(-j / 600) * (k === 0 ? 1 : 0.7) : 0;
          const snare = k % 2 === 1 ? rnd() * Math.exp(-j / 300) * 0.5 : 0;
          out[s0 + j] += part.gain * (kick + snare);
        }
      }
    }
  }
  return { samples: out, beats };
}

const C = [262, 330, 392], F = [349, 440, 523], G = [392, 494, 587], Am = [220, 262, 330];
const E = [330, 415, 494], D = [294, 370, 440];

test("finds the tempo and lines beats up with the drums", () => {
  const { samples, beats } = song({ bpm: 120, parts: [{ bars: 16, chords: [C, F, G, C], gain: 1 }] });
  const r = analyse(samples, RATE);
  assert.ok(Math.abs(r.tempo - 120) < 2, `tempo ${r.tempo}`);
  const matched = beats.filter((b) => r.beats.some((x) => Math.abs(x - b) < 0.03));
  assert.ok(matched.length >= beats.length * 0.9, `${matched.length} of ${beats.length} beats matched`);
  assert.ok(r.beats.length <= beats.length + 2, `${r.beats.length} beats found`);
});

test("finds a faster tempo too", () => {
  const { samples } = song({ bpm: 150, parts: [{ bars: 20, chords: [Am, F, C, G], gain: 1 }] });
  const r = analyse(samples, RATE);
  assert.ok(Math.abs(r.tempo - 150) < 3, `tempo ${r.tempo}`);
});

test("bars start where the chords change", () => {
  const { samples, beats } = song({ bpm: 120, lead: 1.0, parts: [{ bars: 16, chords: [C, F, G, Am], gain: 1 }] });
  const r = analyse(samples, RATE);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const hits = r.bars.filter((b) => downbeats.some((d) => Math.abs(d - b) < 0.03));
  assert.ok(hits.length >= r.bars.length * 0.9, `${hits.length} of ${r.bars.length} bars on a downbeat`);
});

test("splits verse and chorus, and names the repeat the same", () => {
  const verse = { bars: 12, chords: [C, Am, F, G], gain: 0.4 };
  const chorus = { bars: 12, chords: [E, D], gain: 1 };
  const { samples } = song({ bpm: 120, parts: [verse, chorus, verse, chorus] });
  const r = analyse(samples, RATE);
  const starts = r.sections.map((s) => s.start);
  for (const t of [24.5, 48.5, 72.5]) {
    assert.ok(starts.some((s) => Math.abs(s - t) < 2.1), `a section starts near ${t}: ${starts}`);
  }
  const at = (t) => r.sections.find((s) => s.start <= t && t < s.end);
  assert.equal(at(36).label, at(84).label);
  assert.notEqual(at(36).label, at(60).label);
  assert.ok(at(36).energy > at(60).energy);
  assert.equal(at(36).label, "Chorus");
  // Sections tile the song.
  assert.equal(r.sections[0].start, 0);
  r.sections.slice(1).forEach((s, i) => assert.equal(s.start, r.sections[i].end));
});

test("a song with no beat is still one section, with no beats", () => {
  const out = new Float32Array(RATE * 20);
  for (let i = 0; i < out.length; i++) out[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  const r = analyse(out, RATE);
  assert.ok(r.beats.length < 5, `${r.beats.length} beats in a held note`);
  assert.equal(r.sections.length, 1);
});

test("mixes to mono and downsamples", () => {
  const left = new Float32Array(44100).fill(1), right = new Float32Array(44100).fill(0);
  const { samples, rate } = toMono([left, right], 44100);
  assert.equal(rate, 11025);
  assert.equal(samples.length, 11025);
  assert.ok(Math.abs(samples[100] - 0.5) < 1e-6);
});
