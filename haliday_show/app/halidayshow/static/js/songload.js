// Fetching a song to decode, and saying in plain words why it didn't load (the browser's own
// "Unable to decode audio data" tells the user nothing they can act on).

export class SongMissing extends Error {}
export class SongServerError extends Error {}

export async function fetchSong(url, get = fetch) {
  const res = await get(url);
  if (res.status === 404) throw new SongMissing("not found");
  if (!res.ok) throw new SongServerError(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

export function songLoadMessage(err) {
  if (err instanceof SongMissing) return "Couldn't load the song: the file has gone from your songs folder. Pick it again under Song.";
  if (err?.name === "EncodingError") return "Couldn't load the song: this browser can't play that file. Try it as an MP3 or WAV.";
  return "Couldn't load the song: HA-liday Show didn't answer. Check it's running, then pick the song again.";
}
