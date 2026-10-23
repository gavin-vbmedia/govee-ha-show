// Colour palettes: presets that ship with the add-on, and how a palette recolours a clip.
// Colours are picked to look right on LEDs, which wash out pastels and dark shades.

import { EFFECTS } from "./effects.js";

export const PRESET_PALETTES = [
  { name: "Christmas", colors: ["#ff0000", "#00b000", "#ffffff", "#ffb000"] },
  { name: "Candy cane", colors: ["#ff0000", "#ffffff"] },
  { name: "Halloween", colors: ["#ff5a00", "#8000ff", "#40ff00"] },
  { name: "Bonfire Night", colors: ["#ff2000", "#ff8000", "#ffd000", "#ffffff"] },
  { name: "Valentine's", colors: ["#ff0030", "#ff3c8c", "#ffffff"] },
  { name: "St Patrick's", colors: ["#00b000", "#80ff00", "#ffffff", "#ffb000"] },
  { name: "Easter", colors: ["#ff80c0", "#80c0ff", "#ffff60", "#80ff80"] },
  { name: "Red, white and blue", colors: ["#ff0000", "#ffffff", "#0030ff"] },
  { name: "Hanukkah", colors: ["#0040ff", "#ffffff", "#80a0ff"] },
  { name: "Diwali", colors: ["#ff9000", "#ffd000", "#ff0060", "#a000ff"] },
  { name: "Pride", colors: ["#ff0000", "#ff8000", "#ffff00", "#00c000", "#0040ff", "#8000ff"] },
  { name: "Ocean", colors: ["#0030ff", "#00a0ff", "#00ffc0", "#ffffff"] },
  { name: "Sunset", colors: ["#ff1000", "#ff6000", "#ffa000", "#ff0080"] },
  { name: "Fire", colors: ["#ff0000", "#ff3000", "#ff7000", "#ffb000"] },
  { name: "Ice", colors: ["#ffffff", "#80e0ff", "#0080ff"] },
  { name: "Forest", colors: ["#00a000", "#60ff00", "#c0ff40", "#ffb000"] },
  { name: "Party", colors: ["#ff00ff", "#00ffff", "#ffff00", "#00ff00"] },
  { name: "Warm white", colors: ["#ffd8a0", "#ffb060", "#ffffff"] },
];

// The preset palette for the time of year, if one is in season: Halloween through October, then
// Bonfire Night, Christmas through December, and so on. null otherwise.
export function seasonalPalette(date = new Date()) {
  const m = date.getMonth() + 1, d = date.getDate();
  const name = m === 10 ? "Halloween" : m === 11 && d <= 7 ? "Bonfire Night" : m === 12 || (m === 11 && d >= 20) ? "Christmas"
    : m === 2 && d <= 14 ? "Valentine's" : m === 3 && d >= 10 && d <= 17 ? "St Patrick's"
      : (m === 3 && d >= 20) || (m === 4 && d <= 20) ? "Easter" : m === 7 && d <= 4 ? "Red, white and blue" : null;
  return PRESET_PALETTES.find((p) => p.name === name) || null;
}

// The colours a palette fills on an effect. Backgrounds stay as they are, usually off.
export function paletteKeys(effect) {
  return (EFFECTS[effect]?.params || []).filter((p) => p.type === "color" && p.key !== "background").map((p) => p.key);
}

// Fill the clip's colours from the palette in order, starting `offset` colours in, so a run of
// clips can step through the palette.
export function applyPalette(clip, colors, offset = 0) {
  const keys = paletteKeys(clip.effect);
  keys.forEach((k, i) => { clip[k] = colors[(offset + i) % colors.length]; });
  return keys.length;
}
