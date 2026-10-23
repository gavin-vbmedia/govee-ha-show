import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { modelDefaults, modelSummary, newLight, statusOf } from "../../haliday_show/app/halidayshow/static/js/models.js";

const { models } = JSON.parse(readFileSync(new URL("../../haliday_show/app/halidayshow/static/models.json", import.meta.url)));
const by = Object.fromEntries(models.map((m) => [m.sku, m]));

test("a new light starts with its model's settings", () => {
  const light = newLight(by.H70C5, { id: "1.2.3.4", name: "Tree", ip: "1.2.3.4", sku: "H70C5" });
  assert.deepEqual(light, { segments: 300, reverse: false, gradient: false, protocol: "pixels", brightness: 100,
    bulbs: 300, id: "1.2.3.4", name: "Tree", ip: "1.2.3.4", sku: "H70C5" });
  assert.equal(newLight(by.H618A, {}).segments, 15);
});

test("an untested or unknown model gets the usual settings", () => {
  assert.deepEqual(modelDefaults(by.H7093), {});
  assert.deepEqual(newLight(undefined, { name: "x" }),
    { segments: 15, reverse: false, gradient: false, protocol: "standard", brightness: 100, name: "x" });
  assert.equal(newLight(by.H7093, { segments: 4 }).segments, 4); // what's typed wins
});

test("status comes from our own testing, not Govee's list", () => {
  assert.equal(statusOf(by.H706A), "works");
  assert.equal(statusOf(by.H70C5), "limited");
  assert.equal(statusOf(by.H7093), "untested");
  assert.equal(statusOf(undefined), "untested");
  assert.match(modelSummary(by.H7093), /not tested/);
  assert.match(modelSummary(by.H3A51), /Govee lists it as having LAN Control/); // from Govee's own list
  assert.match(modelSummary(by.H6199), /isn't on Govee's list/);
  assert.match(modelSummary(by.H70C5), /first 44 bulbs/);
});
