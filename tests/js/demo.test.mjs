import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_LIGHTS, canStartDemo, hasDemo, isDemoId, withoutDemo } from "../../haliday_show/app/halidayshow/static/js/demo.js";
import { SAMPLE_SPOTS, placeOnSample } from "../../haliday_show/app/halidayshow/static/js/samplehouse.js";

test("every demo light is marked as the demo's and gets its own place on the sample house", () => {
  assert.ok(DEMO_LIGHTS.every((d) => isDemoId(d.id) && !d.ip));
  assert.ok(DEMO_LIGHTS.length <= SAMPLE_SPOTS.length);
  const { paths } = placeOnSample(DEMO_LIGHTS);
  assert.equal(Object.keys(paths).length, DEMO_LIGHTS.length);
  // Each goes where its name says.
  const at = (id) => SAMPLE_SPOTS.find((s) => JSON.stringify(s.points) === JSON.stringify(paths[id])).id;
  assert.equal(at("demo-icicles"), "eaves");
  assert.equal(at("demo-tree"), "tree");
  assert.equal(at("demo-path"), "path");
});

test("the demo is only offered with no lights, and removing it keeps your own", () => {
  assert.ok(canStartDemo([]));
  assert.ok(!canStartDemo([{ id: "mine" }]));
  assert.ok(hasDemo(DEMO_LIGHTS) && !hasDemo([{ id: "mine" }]));
  const house = { paths: { "demo-roof": [[0, 0]], mine: [[1, 1]] }, styles: { "demo-icicles": { style: "icicle" } },
    pins: { mine: { 1: 0.5 } } };
  assert.deepEqual(withoutDemo(house), { paths: { mine: [[1, 1]] }, styles: {}, pins: { mine: { 1: 0.5 } } });
});
