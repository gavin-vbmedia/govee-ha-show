import assert from "node:assert/strict";
import test from "node:test";

import { bulbPositions, bulbSegment } from "../../govee_show/app/goveeshow/static/js/house.js";

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
