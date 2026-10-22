// How quickly a light can change, by its protocol. Realtime lights take a new frame every 25 ms or
// so; the others are much slower (issue #74), so fast chases and sparkles look steppy on them while
// fades, colour changes and pulses of the whole light look fine. Used to pick looks for them and to
// warn about effects that are too fast.

// Changes a second: `whole` is what a light all one colour manages, `busy` every bulb different.
export const SLOW_PROTOCOLS = {
  pixels: { label: "Per bulb", whole: 6, busy: 1.5 },
  segments: { label: "App segments", whole: 10, busy: 3 },
  whole: { label: "Whole light only", whole: 10, busy: 10 },
};

export const isSlow = (device) => !!device && device.protocol in SLOW_PROTOCOLS;
