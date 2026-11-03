"""Contracts for the r04 code-generated viewer inputs.

They check reproducibility and naming rules only; they do not judge appearance or
historical correctness.
"""
import json
import re
import subprocess
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"
VOCAB = ROOT / "viewer/src/world/signage/vocab.js"
DATA_JS = ROOT / "viewer/src/core/data.js"


def js_string_array(source, name):
    m = re.search(r"export const %s = \[(.*?)\];" % name, source, re.S)
    if not m:
        raise AssertionError(f"{name} not found")
    return re.findall(r"'([^']*)'", m.group(1))


class R04ViewerContracts(unittest.TestCase):
    def test_review_cameras_regenerate_identically(self):
        out = subprocess.run([sys.executable, str(ROOT / "scripts/make_r04_views.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)

    def test_review_cameras_are_registered_and_not_route_stations(self):
        views = js_string_array(DATA_JS.read_text(encoding="utf-8"), "REVIEW_VIEWS")
        stations = {s["id"] for s in json.loads((SCENE / "scene.json").read_text(encoding="utf-8"))["route"]["stations"]}
        self.assertTrue(views)
        for v in views:
            with self.subTest(view=v):
                cam = json.loads((SCENE / f"cameras/{v}.json").read_text(encoding="utf-8"))
                self.assertNotIn(v, stations)
                self.assertEqual(cam["status"], "r04-diagnostic-view")
                self.assertTrue((SCENE / f"cameras/{v}.json.asset.json").is_file())

    def test_fictional_name_lists_avoid_blocked_words(self):
        src = VOCAB.read_text(encoding="utf-8")
        blocked = js_string_array(src, "BLOCKLIST")
        for name in ("NAME_STEMS", "KANA_NAMES", "SURNAMES"):
            for stem in js_string_array(src, name):
                with self.subTest(list=name, stem=stem):
                    self.assertFalse(any(b in stem for b in blocked))

    def test_signs_print_no_telephone_numbers(self):
        plan = (ROOT / "viewer/src/world/signage/plan.js").read_text(encoding="utf-8")
        self.assertNotRegex(plan, r"\bphone\(")


if __name__ == "__main__":
    unittest.main()


def atlas_regions(path):
    """Resolve region('name', x, y, w, h) calls in the street-prop atlas painter."""
    src = path.read_text(encoding="utf-8")
    body = src[src.index("cpuCanvasTexture(1024, 1024"):]
    regs, env = [], {}
    for line in body.splitlines():
        m = re.search(r"const x = (\d+), y = (\d+)(?:, w = (\d+), h = (\d+)|, s = (\d+))?", line)
        if m:
            env = {"x": int(m.group(1)), "y": int(m.group(2))}
            if m.group(3):
                env.update(w=int(m.group(3)), h=int(m.group(4)))
            if m.group(5):
                env["s"] = int(m.group(5))
        for rm in re.finditer(r"region\('(\w+)', ([^,]+), ([^,]+), ([^,]+), ([^)]+)\)", line):
            vals = [eval(e, {"__builtins__": {}}, dict(env)) for e in rm.groups()[1:]]  # small integer expressions only
            regs.append((rm.group(1), *vals))
    return regs


class StreetpropsAtlas(unittest.TestCase):
    def test_atlas_regions_do_not_overlap(self):
        regs = atlas_regions(ROOT / "viewer/src/world/streetprops/materials.js")
        self.assertGreater(len(regs), 20)
        for i, a in enumerate(regs):
            self.assertTrue(0 <= a[1] and a[1] + a[3] <= 1024 and 0 <= a[2] and a[2] + a[4] <= 1024, a)
            for b in regs[i + 1:]:
                with self.subTest(a=a[0], b=b[0]):
                    overlap = a[1] < b[1] + b[3] and b[1] < a[1] + a[3] and a[2] < b[2] + b[4] and b[2] < a[2] + a[4]
                    self.assertFalse(overlap, f"{a} overlaps {b}")
