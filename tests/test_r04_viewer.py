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
