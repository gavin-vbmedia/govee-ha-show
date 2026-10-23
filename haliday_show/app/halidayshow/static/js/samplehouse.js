// The sample house (static/sample-house.svg), shown when no photo has been uploaded, and the places
// on it where lights can go. Points are 0 to 1 across and down the picture, starting at the plug,
// like a traced light (house.js). A gap [x, y, 0] jumps to the next window without bulbs between.
export const SAMPLE_HOUSE = "static/sample-house.svg";

const W = 1600, H = 1000;
const P = (...pts) => pts.map(([x, y, n]) => (n === undefined
  ? [+(x / W).toFixed(4), +(y / H).toFixed(4)] : [+(x / W).toFixed(4), +(y / H).toFixed(4), n]));
const box = (x, y, w, h, first) => [first ? [x, y] : [x, y, 0], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];

// In the order lights fill them; `words` match a light's name to the place it most likely is.
export const SAMPLE_SPOTS = [
  { id: "roofline", words: ["roof", "gable", "ridge"], points: P([382, 388], [800, 198], [1218, 388]) },
  { id: "eaves", words: ["icicle", "eave", "gutter"], points: P([1180, 392], [420, 392]),
    style: { style: "icicle", drops: 40, length: 0.07 } },
  { id: "porch", words: ["porch", "pillar", "door", "column", "arch"],
    points: P([707, 818], [707, 604], [893, 604], [893, 818]) },
  { id: "windows", words: ["window", "upstairs", "bedroom"],
    points: P(...box(490, 440, 150, 120, true), ...box(725, 440, 150, 120), ...box(960, 440, 150, 120)) },
  { id: "tree", words: ["tree", "fir", "pine"],
    points: P([150, 780], [330, 720], [170, 650], [300, 590], [200, 530], [260, 470], [247, 432]) },
  { id: "garage", words: ["garage", "shed", "carport"], points: P([1162, 588], [1315, 522], [1468, 588]) },
  { id: "path", words: ["path", "drive", "walk", "garden", "stake"],
    points: P([755, 830], [615, 995], [985, 995], [845, 830]) },
  { id: "downstairs", words: ["downstairs", "lounge", "kitchen", "front room"],
    points: P(...box(490, 640, 170, 130, true), ...box(940, 640, 170, 130)) },
];

// Places each light in `lights` ({id, name}) that has no path yet on a free place, by name first
// and then in order. Returns {paths, styles} for just the lights it placed; lights left over when
// every place is taken are left untraced.
export function placeOnSample(lights, paths = {}) {
  const taken = new Set(Object.values(paths).map((pts) => JSON.stringify(pts)));
  const free = SAMPLE_SPOTS.filter((s) => !taken.has(JSON.stringify(s.points)));
  const todo = lights.filter((d) => !paths[d.id]?.length);
  const out = { paths: {}, styles: {} };
  const give = (d, spot) => {
    out.paths[d.id] = spot.points.map((p) => [...p]);
    if (spot.style) out.styles[d.id] = { ...spot.style };
    free.splice(free.indexOf(spot), 1);
  };
  const left = [];
  for (const d of todo) {
    const name = (d.name || "").toLowerCase();
    const spot = free.find((s) => s.words.some((w) => name.includes(w)));
    if (spot) give(d, spot); else left.push(d);
  }
  for (const d of left) if (free.length) give(d, free[0]);
  return out;
}
