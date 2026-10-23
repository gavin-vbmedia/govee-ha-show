import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { loadLayout, PHONE_FOLDED } = await import("../../haliday_show/app/halidayshow/static/js/layout.js");

test("on a phone, Preview and House start folded", () => {
  store.clear();
  assert.deepEqual(loadLayout(true).collapsed, PHONE_FOLDED);
  assert.deepEqual(loadLayout(false).collapsed, []);
});

test("once panels have been folded or unfolded, a phone keeps that", () => {
  store.set("halidayshow.layout", JSON.stringify({ place: { inspector: "left" }, collapsed: [] }));
  assert.deepEqual(loadLayout(true).collapsed, []);
  store.set("halidayshow.layout", JSON.stringify({ place: { inspector: "left" }, collapsed: ["song"] }));
  assert.deepEqual(loadLayout(true).collapsed, ["song"]);
});
