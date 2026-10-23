// Pixel controllers (kinds "ddp" and "e131"): one IP can drive several lights, each from its own
// first LED (DDP) or universe and channel (E1.31).

export const UNIVERSE_SIZE = 510; // channels a universe, as xLights sets them up (170 RGB pixels)

const CONTROLLER_KINDS = ["ddp", "e131"];
const onController = (devices, light) =>
  devices.filter((d) => d.kind === light.kind && d.ip && d.ip === light.ip);

// The channels a light covers on its controller, counted from 0.
export function channels(d) {
  const start = d.kind === "e131"
    ? ((d.universe || 1) - 1) * UNIVERSE_SIZE + (d.channel || 1) - 1
    : ((d.first || 1) - 1) * 3;
  return [start, start + d.segments * 3];
}

// Where a new DDP light on controller `ip` should start: just after the last one already on it.
export function nextFirstLed(devices, ip) {
  const ends = onController(devices, { kind: "ddp", ip }).map((d) => (d.first || 1) + d.segments);
  return ends.length ? Math.max(...ends) : 1;
}

// The universe and channel a new E1.31 light on controller `ip` should start at: just after the last
// one on it.
export function nextUniverse(devices, ip) {
  const end = Math.max(0, ...onController(devices, { kind: "e131", ip }).map((d) => channels(d)[1]));
  return { universe: Math.floor(end / UNIVERSE_SIZE) + 1, channel: (end % UNIVERSE_SIZE) + 1 };
}

// The other light on the same controller whose channels overlap `light`'s, if any.
export function overlapping(devices, light) {
  if (!CONTROLLER_KINDS.includes(light.kind) || !light.ip) return null;
  const [a, b] = channels(light);
  return onController(devices, light).find((o) => {
    if (o === light || o.id === light.id) return false;
    const [c, e] = channels(o);
    return c < b && a < e;
  }) || null;
}

// A free id for a new controller light, since one IP can hold several.
export function controllerId(devices, ip, kind = "ddp") {
  const base = `${kind}-${ip}`;
  let id = base;
  for (let n = 2; devices.some((d) => d.id === id); n++) id = `${base}-${n}`;
  return id;
}
