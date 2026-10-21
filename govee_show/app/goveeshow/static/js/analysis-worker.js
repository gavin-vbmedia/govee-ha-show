// Runs song analysis off the main thread, so the editor stays responsive while it listens.

import { analyse } from "./analysis.js";

self.onmessage = (e) => {
  try {
    self.postMessage({ result: analyse(e.data.samples, e.data.rate) });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
