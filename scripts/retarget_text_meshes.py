#!/usr/bin/env python3
"""Move existing Blender glyph meshes to revised sign positions, without re-tessellating.

scripts/render_period_scene.py (Blender) tessellates each sign string once, fitted to
the visible-glyph bounds and centred on the text node's position. When a revised
adoption decision changes only where a sign stands, the fitted glyphs are the same
shape at a new place, so a pure translation by the position change reproduces what
Blender would output (to the stored 1e-6 m precision).

The script refuses anything else: a changed string, glyph height, baseline direction,
extrusion or alignment, or a new sign, needs the Blender pass. There is no fallback.

Usage (after a first `python scripts/build_period_scene.py` pass has written the
revised text nodes and dropped the stale glyphs):
  git show HEAD:data/derived/kabukicho-period-features.json > previous-period.json
  python scripts/retarget_text_meshes.py --previous previous-period.json --revision r05-adopted-data-review
  python scripts/build_period_scene.py
"""
import argparse
import hashlib
import json
from pathlib import Path

from import_plateau import ROOT, write_json

TEXT_MESH_PATH = ROOT / "data/derived/kabukicho-sign-text-meshes.json"
PERIOD_PATH = ROOT / "data/derived/kabukicho-period-features.json"
# Node fields that determine the tessellated glyph shape (position only moves it).
SHAPE_KEYS = ("text", "height_m", "baseline_direction_xz", "extrude_m", "align")


def nodes_digest(nodes):
    return hashlib.sha256(json.dumps(nodes, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--previous", required=True, help="period-features JSON whose text nodes the current glyph meshes were tessellated for")
    parser.add_argument("--revision", required=True, help="revision label recorded with every moved sign")
    args = parser.parse_args()

    glyphs = json.loads(TEXT_MESH_PATH.read_text(encoding="utf-8"))
    previous = json.loads(Path(args.previous).read_text(encoding="utf-8"))["text_nodes"]
    current = json.loads(PERIOD_PATH.read_text(encoding="utf-8"))["text_nodes"]
    if nodes_digest(previous) != glyphs["input_text_nodes_sha256"]:
        raise SystemExit("--previous text nodes are not the recipe the glyph meshes were made from")
    target = nodes_digest(current)
    if target == glyphs["input_text_nodes_sha256"]:
        print(json.dumps({"retargeted": 0, "note": "glyph meshes already match the text nodes"}))
        return

    old_nodes = {n["id"]: n for n in previous}
    old_features = {f["id"]: f for f in glyphs["features"]}
    features, moved = [], []
    for node in current:
        old = old_nodes.get(node["id"])
        if old is None:
            raise SystemExit(f"{node['id']}: new sign string; run the Blender text-mesh pass")
        changed = [key for key in SHAPE_KEYS if old.get(key) != node.get(key)]
        if changed:
            raise SystemExit(f"{node['id']}: glyph shape inputs changed ({', '.join(changed)}); run the Blender text-mesh pass")
        feature = json.loads(json.dumps(old_features[node["id"] + "-glyphs"]))
        delta = [b - a for a, b in zip(old["position_m"], node["position_m"])]
        if any(abs(v) > 0 for v in delta):
            feature["polygons"] = [[[round(p[i] + delta[i], 6) for i in range(3)] for p in ring] for ring in feature["polygons"]]
            feature["position_revision"] = {"revision": args.revision, "translation_m": [round(v, 6) for v in delta],
                                            "method": "pure translation of the Blender-tessellated glyphs; shape inputs unchanged"}
            moved.append({"id": node["id"], "text": node["text"], "translation_m": [round(v, 6) for v in delta]})
        feature["source_decision_id"] = node["decision_id"]
        feature["material_key"] = node["material_key"]
        features.append(feature)

    glyphs["features"] = features
    glyphs["input_text_nodes_sha256"] = target
    history = glyphs.setdefault("retargeting", [])
    history.append({"revision": args.revision, "script": "scripts/retarget_text_meshes.py",
                    "previous_input_text_nodes_sha256": nodes_digest(previous),
                    "moved_signs": moved, "unchanged_signs": len(features) - len(moved),
                    "note": "Glyph shapes are the original Blender 4.5.15 / Noto Sans CJK SC tessellation; only positions changed."})
    write_json(TEXT_MESH_PATH, glyphs, compact=True)
    print(json.dumps({"retargeted": len(moved), "unchanged": len(features) - len(moved)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
