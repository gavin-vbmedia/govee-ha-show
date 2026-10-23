// Our list of Govee lights (static/models.json): what we've found on real lights, and the settings
// a new light of that model starts with. A model with no status hasn't been tested with the add-on.

export const STATUS = {
  works: { badge: "✓ works", cls: "ok" },
  limited: { badge: "⚠ limited", cls: "warn" },
  untested: { badge: "? untested", cls: "unknown" },
};

export const statusOf = (model) => (model && STATUS[model.status] ? model.status : "untested");

// What a new light of this model starts with: {protocol?, segments?, bulbs?}.
export function modelDefaults(model) {
  const out = {};
  for (const key of ["protocol", "segments", "bulbs"]) if (model?.[key]) out[key] = model[key];
  return out;
}

// A new light: the add-on's usual settings, then the model's, then what's given (name, ip…).
export function newLight(model, fields) {
  return { segments: 15, reverse: false, gradient: false, protocol: "standard", brightness: 100,
    ...modelDefaults(model), ...fields };
}

// What the badge's tooltip says about a model.
export function modelSummary(model) {
  const status = statusOf(model);
  if (status === "untested") {
    const lan = model.lan ? "Govee lists it as having LAN Control, which HA-liday Show needs. "
      : "It isn't on Govee's list of lights with LAN Control, but that list misses some lights that have it. ";
    return `${model.name}: not tested with HA-liday Show yet. ${lan}Add it and press Test: most lights with LAN `
      + "Control work on Realtime, and if only part of it lights up, try Per bulb.";
  }
  return `${model.name}: ${model.note || (status === "works" ? "works on Realtime." : "")}`.trim();
}
