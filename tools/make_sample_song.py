"""Renders the demo's sample song, Jingle Bells as a music box, to static/sample-song.mp3.

The tune (James Lord Pierpont, 1857) is out of copyright and every sound here is made by this
script, so the file is free to ship. Intro, quiet verse, chorus with bass and sleigh bells, the
second half of the verse, the chorus again and an outro: the chorus has to come back for the
editor's Detect to call it the chorus. Needs numpy and ffmpeg (not used by the add-on).

    python tools/make_sample_song.py
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

RATE = 44100
BPM = 120
BEAT = 60 / BPM
OUT = Path(__file__).resolve().parent.parent / "haliday_show/app/halidayshow/static/sample-song.mp3"

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def freq(name: str) -> float:
    """'E5' -> Hz, with A4 = 440."""
    n = NOTE[name[0]] + (1 if "#" in name else 0)
    octave = int(name[-1])
    return 440 * 2 ** ((n + 12 * (octave + 1) - 69) / 12)


def tine(f: float, seconds: float, loud: float) -> np.ndarray:
    """One music-box note: a bright strike that rings away, with a slightly sharp overtone."""
    t = np.arange(int(seconds * RATE)) / RATE
    env = np.exp(-t * 3.2) * (1 - np.exp(-t * 400))
    tone = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 8)
            + 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 14))
    return loud * env * tone


def bell(seconds: float, loud: float, rng) -> np.ndarray:
    """A sleigh-bell shake: a short burst of bright noise."""
    t = np.arange(int(seconds * RATE)) / RATE
    noise = rng.standard_normal(t.size)
    noise = np.diff(noise, prepend=0)  # tilt towards the treble
    return loud * noise * np.exp(-t * 30) * 0.25


# Bars of (note, beats). "-" is a rest.
VERSE = [
    [("G4", 1), ("E5", 1), ("D5", 1), ("C5", 1)], [("G4", 3), ("G4", .5), ("G4", .5)],
    [("G4", 1), ("E5", 1), ("D5", 1), ("C5", 1)], [("A4", 4)],
    [("A4", 1), ("F5", 1), ("E5", 1), ("D5", 1)], [("B4", 4)],
    [("G5", 1), ("G5", 1), ("F5", 1), ("D5", 1)], [("E5", 4)],
    [("G4", 1), ("E5", 1), ("D5", 1), ("C5", 1)], [("G4", 4)],
    [("G4", 1), ("E5", 1), ("D5", 1), ("C5", 1)], [("A4", 3), ("A4", 1)],
    [("A4", 1), ("F5", 1), ("E5", 1), ("D5", 1)], [("G5", 1), ("G5", 1), ("G5", 1), ("G5", 1)],
    [("A5", 1), ("G5", 1), ("F5", 1), ("D5", 1)], [("C5", 2), ("G5", 2)],
]
CHORUS = [
    [("E5", 1), ("E5", 1), ("E5", 2)], [("E5", 1), ("E5", 1), ("E5", 2)],
    [("E5", 1), ("G5", 1), ("C5", 1.5), ("D5", .5)], [("E5", 4)],
    [("F5", 1), ("F5", 1), ("F5", 1.5), ("F5", .5)], [("F5", 1), ("E5", 1), ("E5", 1), ("E5", .5), ("E5", .5)],
    [("E5", 1), ("D5", 1), ("D5", 1), ("E5", 1)], [("D5", 2), ("G5", 2)],
    [("E5", 1), ("E5", 1), ("E5", 2)], [("E5", 1), ("E5", 1), ("E5", 2)],
    [("E5", 1), ("G5", 1), ("C5", 1.5), ("D5", .5)], [("E5", 4)],
    [("F5", 1), ("F5", 1), ("F5", 1.5), ("F5", .5)], [("F5", 1), ("E5", 1), ("E5", 1), ("E5", .5), ("E5", .5)],
    [("G5", 1), ("G5", 1), ("F5", 1), ("D5", 1)], [("C5", 4)],
]
VERSE_CHORDS = "C C C F F G G C C C C F F C G C".split()
CHORUS_CHORDS = "C C C C F C D G C C C C F C G C".split()
ROOT = {"C": "C3", "F": "F3", "G": "G3", "D": "D3"}
TRIAD = {"C": ["C4", "E4", "G4"], "F": ["F4", "A4", "C5"], "G": ["G4", "B4", "D5"], "D": ["D4", "F#4", "A4"]}


def render() -> np.ndarray:
    rng = np.random.default_rng(1857)
    intro, outro = 2, 2
    sections = [(VERSE[:8], VERSE_CHORDS[:8], 0.55, False), (CHORUS, CHORUS_CHORDS, 0.9, True),
                (VERSE[8:], VERSE_CHORDS[8:], 0.55, False), (CHORUS, CHORUS_CHORDS, 0.95, True)]
    bars = intro + sum(len(m) for m, *_ in sections) + outro
    out = np.zeros(int((bars * 4 * BEAT + 3) * RATE))

    def put(sound, at):
        i = int(at * RATE)
        out[i:i + sound.size] += sound[: out.size - i]

    bar = BEAT * 4
    # Intro: the chord rippling up, with a few bells.
    for b in range(intro):
        for k, n in enumerate(TRIAD["C"] * 2):
            put(tine(freq(n), 2.5, 0.25), b * bar + k * BEAT / 2)
        for e in range(8):
            put(bell(0.2, 0.35, rng), b * bar + e * BEAT / 2)
    start = intro * bar
    for melody, chords, loud, full in sections:
        for b, notes in enumerate(melody):
            at = start + b * bar
            t = at
            for n, beats in notes:
                if n != "-":
                    put(tine(freq(n), max(beats * BEAT, 0.6) + 0.8, loud), t)
                t += beats * BEAT
            chord = chords[b]
            # Bass on beats one and three, soft chord on two and four.
            for beat in (0, 2):
                put(tine(freq(ROOT[chord]), 1.6, loud * (0.7 if full else 0.4)), at + beat * BEAT)
            for beat in (1, 3):
                for n in TRIAD[chord]:
                    put(tine(freq(n), 1.0, loud * 0.12), at + beat * BEAT)
            if full:
                for e in range(8):
                    put(bell(0.18, 0.5 if e % 2 == 0 else 0.3, rng), at + e * BEAT / 2)
        start += len(melody) * bar
    # Outro: a last jingle and the home chord ringing out.
    for k, n in enumerate(["G5", "E5", "C5", "G4", "C5", "E5", "G5", "C6"]):
        put(tine(freq(n), 2.5, 0.35), start + k * BEAT / 2)
    for n in ["C4", "E4", "G4", "C5"]:
        put(tine(freq(n), 4.0, 0.3), start + bar)
    put(tine(freq("C3"), 4.0, 0.5), start + bar)
    # End as the last chord dies away: Detect averages loudness in decibels, so seconds of silence at
    # the end would drag the last chorus down to sound like an outro.
    out = out[: int((start + bar + 2.2) * RATE)]
    out /= np.max(np.abs(out)) * 1.12
    # Fade the last half second so it doesn't click.
    fade = int(0.8 * RATE)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def main():
    audio = render()
    pcm = (audio * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-codec:a", "libmp3lame", "-b:a", "128k",
                    "-metadata", "title=Jingle Bells (music box)", "-metadata", "artist=HA-liday Show",
                    str(OUT)], input=pcm, check=True)
    print(f"{OUT} ({OUT.stat().st_size // 1024} KB, {audio.size / RATE:.0f} s)", file=sys.stderr)


if __name__ == "__main__":
    main()
