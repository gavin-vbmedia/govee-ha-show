"""The editor bakes in JavaScript; make sure Python decodes exactly what it writes."""
import shutil
import subprocess
from pathlib import Path

import pytest

from halidayshow import baked

EFFECTS_JS = Path(__file__).parent.parent / "haliday_show/app/halidayshow/static/js/effects.js"
SCRIPT = f"""
import {{ bake, newClip }} from {str(EFFECTS_JS.as_uri())!r};
const show = {{ duration: 2, tracks: [
  {{ device: "porch", clips: [newClip("rainbow", 0, 2)] }},
  {{ device: "tree", clips: [newClip("chase", 0.5, 1.5)] }},
] }};
process.stdout.write(Buffer.from(bake(show, {{ porch: {{ segments: 15 }}, tree: {{ segments: 10 }} }})));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_js_bake_decodes_in_python():
    blob = subprocess.run(["node", "--input-type=module", "-e", SCRIPT],
                          check=True, capture_output=True).stdout
    b = baked.decode(blob)
    assert (b.fps, b.frames, b.stride) == (40, 80, 75)
    assert [t.device for t in b.tracks] == ["porch", "tree"]
    assert b.track_frame(b.tracks[1], 0) == bytes(30)  # chase hasn't started yet
    assert any(b.track_frame(b.tracks[0], 0))
