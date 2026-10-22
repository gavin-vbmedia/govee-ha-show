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
    return `${model.name}: not tested with this add-on yet. Most Govee lights with LAN Control work on Realtime: `
      + "add it and press Test. If only part of it lights up, try Per bulb.";
  }
  return `${model.name}: ${model.note || (status === "works" ? "works on Realtime." : "")}`.trim();
}
