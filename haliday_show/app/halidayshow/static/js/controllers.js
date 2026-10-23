// Pixel controllers (kind "ddp"): one IP can drive several lights, each from its own first LED.

const onController = (devices, ip) => devices.filter((d) => d.kind === "ddp" && d.ip && d.ip === ip);

// Where a new light on controller `ip` should start: just after the last one already on it.
export function nextFirstLed(devices, ip) {
  const ends = onController(devices, ip).map((d) => (d.first || 1) + d.segments);
  return ends.length ? Math.max(...ends) : 1;
}

// The other light on the same controller whose LEDs overlap `light`'s, if any.
export function overlapping(devices, light) {
  if (light.kind !== "ddp" || !light.ip) return null;
  const a = light.first || 1, b = a + light.segments - 1;
  return onController(devices, light.ip).find((o) => {
    if (o === light || o.id === light.id) return false;
    const c = o.first || 1, e = c + o.segments - 1;
    return c <= b && a <= e;
  }) || null;
}

// A free id for a new controller light, since one IP can hold several.
export function controllerId(devices, ip) {
  const base = `ddp-${ip}`;
  let id = base;
  for (let n = 2; devices.some((d) => d.id === id); n++) id = `${base}-${n}`;
  return id;
}
