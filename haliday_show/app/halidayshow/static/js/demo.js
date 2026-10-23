// The demo: planned lights already placed on the sample house, the sample song and a generated show,
// so someone without lights (or a tester) can try everything in one press. Everything it adds can be
// told apart, so Remove the demo takes away exactly what it added.
export const DEMO_PREFIX = "demo-";
export const DEMO_SHOW = "Demo show";
export const DEMO_SONG = "static/sample-song.mp3";
export const DEMO_SONG_NAME = "Jingle Bells (music box sample).mp3";

// Planned lights (no IP), named for the sample house places they go to (samplehouse.js).
const govee = (id, name, segments) => ({ id: DEMO_PREFIX + id, kind: "govee", name, ip: "", sku: "",
  segments, protocol: "standard", reverse: false, gradient: false, brightness: 100 });
export const DEMO_LIGHTS = [
  govee("roof", "Roof", 40),
  govee("icicles", "Icicles", 40),
  govee("porch", "Porch", 30),
  govee("windows", "Windows", 36),
  { id: `${DEMO_PREFIX}tree`, kind: "wled", name: "Tree", ip: "", sku: "", segments: 100, bulbs: 100,
    protocol: "ddp", reverse: false, gradient: false, brightness: 100 },
  govee("garage", "Garage", 24),
  govee("path", "Path", 12),
];

export const isDemoId = (id) => typeof id === "string" && id.startsWith(DEMO_PREFIX);
export const hasDemo = (lights) => lights.some((d) => isDemoId(d.id));
// The demo is only offered on a fresh install, so it never mixes into someone's own lights.
export const canStartDemo = (lights) => !lights.length;

// Takes the demo's lights out of the house view's saved lines, styles and pins.
export function withoutDemo(house) {
  const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => !isDemoId(id)));
  return { paths: keep(house.paths), styles: keep(house.styles), pins: keep(house.pins) };
}
