import assert from "node:assert/strict";
import test from "node:test";

import { arcNearest, bulbLayout, bulbPositions, bulbSegment, icicleDrops, pinBulbs, segmentBulb, segmentPositions, spotColour }
  from "../../haliday_show/app/halidayshow/static/js/house.js";

const close = (a, b) => a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

test("bulbs spread evenly along a path, round corners included", () => {
  // An L: 1 across then 1 down, so 5 bulbs land every half unit.
  const bulbs = bulbPositions([[0, 0], [1, 0], [1, 1]], 5);
  assert.ok(close(bulbs, [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1]]));
  assert.deepEqual(bulbPositions([[0.3, 0.4]], 2), [[0.3, 0.4], [0.3, 0.4]]);
  assert.deepEqual(bulbPositions([], 3), []);
});

test("bulbs map to segments from the plug, flipped by Reverse", () => {
  const segs = Array.from({ length: 8 }, (_, j) => bulbSegment(j, 8, 2, false));
  assert.deepEqual(segs, [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(bulbSegment(0, 8, 2, true), 1);
  assert.equal(bulbSegment(7, 8, 2, true), 0);
});

test("bulbs out of view take their place in the order but aren't drawn", () => {
  // Plug, an extension lead (no bulbs), 1 unit in view, 3 bulbs round the back, 2 units in view.
  const path = [[0, 0], [0, 1, 0], [1, 1], [2, 1, 3], [4, 1]];
  const bulbs = bulbLayout(path, 12);
  assert.equal(bulbs.length, 12);
  // 9 bulbs in view, shared 1:2 by length: 3 on the first run, then the 3 hidden, then 6.
  assert.ok(close(bulbs.slice(0, 3), [[0, 1], [0.5, 1], [1, 1]]));
  assert.deepEqual(bulbs.slice(3, 6), [null, null, null]);
  assert.ok(close(bulbs.slice(6), [[2, 1], [2.4, 1], [2.8, 1], [3.2, 1], [3.6, 1], [4, 1]]));
  // With nothing hidden it matches the plain spread.
  assert.ok(close(bulbLayout([[0, 0], [1, 0], [1, 1]], 5), bulbPositions([[0, 0], [1, 0], [1, 1]], 5)));
  // More bulbs marked hidden than the light has: the rest are simply hidden.
  assert.deepEqual(bulbLayout([[0, 0], [1, 0, 50]], 4), [null, null, null, null]);
});

test("icicle drops spread along the line with staggered lengths", () => {
  const drops = icicleDrops([[0, 0], [1, 0], [2, 0, 4]], 6, 60);
  assert.equal(drops.length, 6);
  assert.deepEqual(drops.slice(2).every((d) => d === null), true); // 4 out of view
  assert.ok(close(drops.slice(0, 2).map((d) => d.top), [[0, 0], [1, 0]]));
  assert.equal(drops[0].f, 1);
  assert.ok(drops[1].f < 1 && drops[1].n < drops[0].n);
});

test("each spot shows its share of the segments, blended", () => {
  // 4 segments: red, red, blue, blue. Two spots get one colour each; flipped by Reverse.
  const rgb = Uint8Array.from([200, 0, 0, 200, 0, 0, 0, 0, 100, 0, 0, 100]);
  assert.deepEqual(spotColour(0, 2, rgb, 4, false), [200, 0, 0]);
  assert.deepEqual(spotColour(1, 2, rgb, 4, false), [0, 0, 100]);
  assert.deepEqual(spotColour(0, 2, rgb, 4, true), [0, 0, 100]);
  // One spot blends them all; more spots than segments share a segment.
  assert.deepEqual(spotColour(0, 1, rgb, 4, false), [100, 0, 50]);
  assert.deepEqual(spotColour(7, 8, rgb, 4, false), [0, 0, 100]);
});

test("segment positions span the traced lights from 0 to 1", () => {
  const roof = { id: "roof", segments: 2, reverse: false };
  const spots = { id: "spots", segments: 2, reverse: true };
  // Roof bulbs from x 0.2 to 0.6 at y 0.3; two spots at y 0.9, reversed.
  const pos = segmentPositions([
    { dev: roof, bulbs: [[0.2, 0.3], [0.3, 0.3], [0.5, 0.3], [0.6, 0.3]] },
    { dev: spots, spots: [[0.4, 0.9], [0.8, 0.9]] },
  ]);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // Roof segments sit at the middle of their bulbs: x 0.25 and 0.55, scaled over 0.25..0.8.
  assert.ok(near(pos.roof[0], [0, 0]));
  assert.ok(near(pos.roof[1], [0.3 / 0.55, 0]));
  // Reversed spots: segment 1 is the first spot (by the plug).
  assert.ok(near(pos.spots[1], [0.15 / 0.55, 1]));
  assert.ok(near(pos.spots[0], [1, 1]));
  assert.deepEqual(segmentPositions([]), {});
});

test("a pinned segment moves its first bulb along the path, the bulbs between spread evenly", () => {
  const line = [[0, 0], [1, 0]];
  const bulbs = bulbLayout(line, 11); // 0, 0.1, ... 1
  // 10 segments over 11 bulbs: segment 5's first bulb is bulb 6, at 0.6 until pinned at 0.9.
  assert.equal(segmentBulb(5, 11, 10, false), 6);
  assert.equal(bulbSegment(6, 11, 10, false), 5);
  const pinned = pinBulbs(line, bulbs, { 5: 0.9 }, 10, false);
  assert.deepEqual(pinned.map((p) => +p[0].toFixed(3)), [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.925, 0.95, 0.975, 1]);
  assert.ok(pinned.every((p) => p[1] === 0));
  // Reverse counts segments from the far end.
  assert.equal(segmentBulb(0, 11, 10, true), 10);
  // No pins leaves them as they were.
  assert.equal(pinBulbs(line, bulbs, {}, 10, false), bulbs);
});

test("pins follow corners and leave stretches out of view alone", () => {
  const path = [[0, 0], [1, 0], [1, 1]];
  assert.equal(arcNearest(path, [1.2, 0.5]), 0.75);
  const pinned = pinBulbs(path, bulbLayout(path, 5), { 1: 0.25 }, 4, false);
  assert.deepEqual(pinned.slice(0, 4), [[0, 0], [0.25, 0], [0.5, 0], [1, 0.25]]);
  // The ends of a run in view stay put, so a pin only moves bulbs in its own run.
  const hidden = [[0, 0], [1, 0], [1, 1, 4], [2, 1]];
  const before = bulbLayout(hidden, 12);
  const after = pinBulbs(hidden, before, { 1: 0.1 }, 6, false);
  assert.equal(after.filter((b) => !b).length, 4);
  const round = (list) => list.map((p) => p.map((v) => +v.toFixed(6)));
  assert.deepEqual(round(after.slice(-4)), round(before.slice(-4)));
  assert.deepEqual(after[3], [1, 0]);
});
