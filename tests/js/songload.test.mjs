import { test } from "node:test";
import assert from "node:assert/strict";
import { SongMissing, SongServerError, fetchSong, songLoadMessage } from "../../haliday_show/app/halidayshow/static/js/songload.js";

const reply = (status) => async () => ({ status, ok: status < 400, arrayBuffer: async () => new ArrayBuffer(4) });

test("a song that's there comes back as bytes", async () => {
  assert.equal((await fetchSong("x", reply(200))).byteLength, 4);
});

test("a missing song says to pick it again", async () => {
  await assert.rejects(fetchSong("x", reply(404)), SongMissing);
  assert.match(songLoadMessage(new SongMissing()), /gone.*Pick it again under Song/);
});

test("a file the browser can't decode suggests MP3 or WAV", () => {
  const e = new Error("Unable to decode audio data");
  e.name = "EncodingError";
  assert.match(songLoadMessage(e), /can't play that file.*MP3 or WAV/);
});

test("anything else says HA-liday Show didn't answer", async () => {
  await assert.rejects(fetchSong("x", reply(502)), SongServerError);
  assert.match(songLoadMessage(new TypeError("Failed to fetch")), /didn't answer/);
  assert.doesNotMatch(songLoadMessage(new TypeError("Failed to fetch")), /Failed to fetch/);
});
