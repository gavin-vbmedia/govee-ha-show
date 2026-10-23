import assert from "node:assert/strict";
import test from "node:test";

import { SAMPLE_SPOTS, placeOnSample } from "../../haliday_show/app/halidayshow/static/js/samplehouse.js";

test("every place on the sample house is on the picture", () => {
  for (const s of SAMPLE_SPOTS) {
    assert.ok(s.points.length >= 2, s.id);
    for (const [x, y] of s.points) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, s.id);
    assert.equal(s.points[0].length, 2, `${s.id} starts at a plug, not a gap`);
  }
});

test("lights go to the place their name suggests, then in order", () => {
  const { paths, styles } = placeOnSample([
    { id: "a", name: "Front porch" }, { id: "b", name: "Lights 1" }, { id: "c", name: "Roof icicles" },
  ]);
  const at = (id) => SAMPLE_SPOTS.find((s) => JSON.stringify(s.points) === JSON.stringify(paths[id])).id;
  assert.equal(at("a"), "porch");
  // "Roof icicles" says roof first, which is free, so it takes the roofline.
  assert.equal(at("c"), "roofline");
  assert.equal(at("b"), "eaves");
  assert.deepEqual(Object.keys(styles), ["b"]);
});

test("lights already traced, and places already used, are left alone", () => {
  const roof = SAMPLE_SPOTS[0].points;
  const { paths } = placeOnSample([{ id: "a", name: "Roof" }, { id: "b", name: "Mine" }],
    { a: roof, b: [[0.1, 0.1], [0.2, 0.2]] });
  assert.deepEqual(paths, {});
  const more = placeOnSample([{ id: "c", name: "Roof" }], { a: roof });
  assert.notDeepEqual(more.paths.c, roof);
});

test("lights beyond the places available stay untraced", () => {
  const lights = Array.from({ length: SAMPLE_SPOTS.length + 2 }, (_, i) => ({ id: `l${i}`, name: `Light ${i}` }));
  const { paths } = placeOnSample(lights);
  assert.equal(Object.keys(paths).length, SAMPLE_SPOTS.length);
});
