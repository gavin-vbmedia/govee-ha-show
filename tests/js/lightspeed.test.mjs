import assert from "node:assert/strict";
import test from "node:test";

import { SLOW_PROTOCOLS, isSlow } from "../../govee_show/app/goveeshow/static/js/lightspeed.js";

test("only the non-realtime protocols are slow", () => {
  assert.deepEqual(Object.keys(SLOW_PROTOCOLS).sort(), ["pixels", "segments", "whole"]);
  assert.equal(isSlow({ protocol: "pixels" }), true);
  for (const p of ["standard", "razer", "v2", undefined]) assert.equal(isSlow({ protocol: p }), false);
  assert.equal(isSlow(undefined), false);
});
