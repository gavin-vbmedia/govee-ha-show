import assert from "node:assert/strict";
import { test } from "node:test";

import { controllerId, nextFirstLed, overlapping } from "../../haliday_show/app/halidayshow/static/js/controllers.js";

const light = (id, ip, first, segments, kind = "ddp") => ({ id, ip, first, segments, kind });

test("a new light on a controller starts after the last one on it", () => {
  const devices = [light("a", "10.0.0.5", 1, 100), light("b", "10.0.0.5", 101, 50), light("c", "10.0.0.6", 1, 300),
    light("w", "10.0.0.5", 1, 900, "wled")];
  assert.equal(nextFirstLed(devices, "10.0.0.5"), 151);
  assert.equal(nextFirstLed(devices, "10.0.0.9"), 1);
});

test("lights sharing a controller's LEDs are spotted", () => {
  const a = light("a", "10.0.0.5", 1, 100), b = light("b", "10.0.0.5", 90, 50), c = light("c", "10.0.0.5", 130, 20);
  const other = light("d", "10.0.0.6", 1, 100);
  assert.equal(overlapping([a, b, c, other], a), b);
  assert.equal(overlapping([a, b, c, other], c), b);
  assert.equal(overlapping([a, c, other], a), null); // 1-100 and 130-149 don't meet
  assert.equal(overlapping([a, other], other), null);
  assert.equal(overlapping([a, { ...b, ip: "" }], a), null); // planned lights aren't on a controller yet
});

test("each controller light gets its own id", () => {
  assert.equal(controllerId([], "10.0.0.5"), "ddp-10.0.0.5");
  assert.equal(controllerId([{ id: "ddp-10.0.0.5" }, { id: "ddp-10.0.0.5-2" }], "10.0.0.5"), "ddp-10.0.0.5-3");
});

test("E1.31 lights run on from universe to universe", async () => {
  const { nextUniverse, channels } = await import("../../haliday_show/app/halidayshow/static/js/controllers.js");
  const a = { id: "a", kind: "e131", ip: "10.0.0.7", universe: 1, channel: 1, segments: 170 };
  assert.deepEqual(channels(a), [0, 510]);
  assert.deepEqual(nextUniverse([a], "10.0.0.7"), { universe: 2, channel: 1 });
  const b = { id: "b", kind: "e131", ip: "10.0.0.7", universe: 2, channel: 1, segments: 50 };
  assert.deepEqual(nextUniverse([a, b], "10.0.0.7"), { universe: 2, channel: 151 });
  assert.deepEqual(nextUniverse([a, b], "10.0.0.8"), { universe: 1, channel: 1 });
  // A DDP light on the same IP is a different set of LEDs.
  const ddp = { id: "d", kind: "ddp", ip: "10.0.0.7", first: 1, segments: 100 };
  assert.equal(overlapping([a, ddp], a), null);
  assert.equal(overlapping([a, { ...b, universe: 1, channel: 400 }], a)?.id, "b");
});
