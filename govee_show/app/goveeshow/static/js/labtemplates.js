// Starting points for the packet lab (Setup → Settings). Each fills in the message for `n` segments
// of colour `rgb` ([r, g, b]); edit the result by hand to try variations.
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
const repeatRgb = (n, rgb) => Array.from({ length: n }, () => hex(rgb)).join("  ");
const rainbow = (n) => Array.from({ length: n }, (_, i) => {
  const h = (i / n) * 6, x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
  const k = Math.floor(h) % 6;
  return hex([[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]][k]);
}).join("  ");
// Keeps a realtime frame on the light for about 5 seconds, as the lights drop back to their own scene.
const STREAM = { repeat: 50, interval: 100, realtimeOn: true };

export const LAB_TEMPLATES = {
  status: { label: "Ask for its status", kind: "json",
    text: () => '{"msg":{"cmd":"devStatus","data":{}}}' },
  on: { label: "Turn on", kind: "json", text: () => '{"msg":{"cmd":"turn","data":{"value":1}}}' },
  colour: { label: "Whole light one colour", kind: "json",
    text: (n, [r, g, b]) => JSON.stringify({ msg: { cmd: "colorwc", data: { color: { r, g, b }, colorTemInKelvin: 0 } } }) },
  realtimeOn: { label: "Realtime on", kind: "razer", text: () => "b1 01" },
  realtimeOff: { label: "Realtime off", kind: "razer", text: () => "b1 00" },
  solid: { label: "Realtime: every segment one colour", kind: "razer", ...STREAM,
    text: (n, rgb) => `b0 01 ${hex([n])}  ${repeatRgb(n, rgb)}` },
  rainbow: { label: "Realtime: rainbow", kind: "razer", ...STREAM,
    text: (n) => `b0 01 ${hex([n])}  ${rainbow(n)}` },
  razerHeader: { label: "Realtime (Razer): fixed length 14", kind: "razer", length: 14, ...STREAM,
    text: (n, rgb) => `b0 01 ${hex([n])}  ${repeatRgb(n, rgb)}` },
  v2: { label: "Realtime v2: with zone bytes", kind: "razer", ...STREAM,
    text: (n, rgb) => `b4 01 ${hex([n])}  ` + Array.from({ length: n }, (_, i) => `${hex(rgb)} ${hex([i < 36 ? 1 : 2])}`).join("  ") },
  appSegments: { label: "App segments: colour all", kind: "ptreal",
    text: (n, rgb) => {
      const mask = (2n ** BigInt(Math.min(n, 56))) - 1n;
      const bytes = [];
      for (let m = mask; m > 0n; m >>= 8n) bytes.push(Number(m & 0xffn));
      return `33 05 15 01 ${hex(rgb)} 00 00 00 00 00 ${hex(bytes)}`;
    } },
};

// The "past the window" sweep: lights like the H70C5 and the icicles only take colours for their first
// `w` bulbs (44 on the H70C5) in realtime mode. Each step is one guess at how the bulbs after that might
// be addressed, asking for bulbs w+1 to 2w in its own colour, so a video of the light shows which guess
// (if any) reaches further. A guess the light reads the normal way lights the first bulbs instead.
const SWEEP_COLOURS = [
  ["red", [255, 0, 0]], ["green", [0, 255, 0]], ["blue", [0, 0, 255]], ["yellow", [255, 200, 0]],
  ["cyan", [0, 255, 255]], ["magenta", [255, 0, 255]], ["white", [255, 255, 255]], ["orange", [255, 80, 0]],
  ["pink", [255, 100, 150]],
];

export function windowSweep(w = 44) {
  w = Math.max(1, Math.min(127, w));
  const n = hex([w]), two = (v) => hex([(v >> 8) & 255, v & 255]);
  const guesses = [
    ["count as two bytes, the first window off", (c) => `b0 01 ${two(2 * w)}  ${repeatRgb(w, [0, 0, 0])}  ${repeatRgb(w, c)}`],
    ["start position after the count", (c) => `b0 01 ${n} ${n}  ${repeatRgb(w, c)}`],
    ["start position (two bytes) before the count", (c) => `b0 01 ${two(w)} ${n}  ${repeatRgb(w, c)}`],
    ["start position (two bytes) after the count", (c) => `b0 01 ${n} ${two(w)}  ${repeatRgb(w, c)}`],
    ["command b2", (c) => `b2 01 ${n}  ${repeatRgb(w, c)}`],
    ["command b3", (c) => `b3 01 ${n}  ${repeatRgb(w, c)}`],
    ["command b5", (c) => `b5 01 ${n}  ${repeatRgb(w, c)}`],
    ["v2 form, every colour in zone 2", (c) => `b4 01 ${n}  ` + Array.from({ length: w }, () => `${hex(c)} 02`).join("  ")],
    ["zone 2 byte after the count", (c) => `b0 01 ${n} 02  ${repeatRgb(w, c)}`],
  ];
  return guesses.map(([what, text], i) => {
    const [name, rgb] = SWEEP_COLOURS[i];
    return { label: `${name}: ${what}`, colour: name, kind: "razer", text: text(rgb),
      repeat: 30, interval_ms: 100, realtime_on: true };
  });
}

// The "switch-on" sweep: a DreamView sync box gets live colour onto the whole H70C5 string, which our
// realtime frames can't (first 44 bulbs only), so it probably sends something first. Each step tries one
// guess at that set-up message, then streams the usual w-colour rainbow; a rainbow stretching past the
// window, or along the whole string, means that guess works. Realtime is switched off between steps.
export function startSweep(w = 44) {
  w = Math.max(1, Math.min(255, w));
  const frame = `b0 01 ${hex([w])}  ${rainbow(w)}`;
  const guesses = [
    ["realtime on with a 01 byte", [], [["razer", "b1 01 01"]], false],
    ["realtime on with a 02 byte", [], [["razer", "b1 01 02"]], false],
    ["realtime on with the window size", [], [["razer", `b1 01 ${hex([w])}`]], false],
    ["realtime on with the size as two bytes", [], [["razer", `b1 01 00 ${hex([w])}`]], false],
    ["the app's gradient switch on first", [["ptreal", "33 14 01"]], [], true],
    ["the app's video (DreamView) mode first, all", [["ptreal", "33 05 00 01 00 64"]], [], true],
    ["the app's video (DreamView) mode first, part", [["ptreal", "33 05 00 00 00 64"]], [], true],
  ];
  return guesses.map(([what, setup, enable, on]) => ({
    label: what, kind: "razer", text: frame, repeat: 50, interval_ms: 100, realtime_on: on,
    before: [...setup, ...enable].map(([kind, text]) => ({ kind, text })),
  }));
}
