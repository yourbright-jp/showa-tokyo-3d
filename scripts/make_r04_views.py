#!/usr/bin/env python3
"""Write the r04 supplementary diagnostic camera(s).

The six R01 station cameras and the adopted walk are left untouched. The fixed
`entrance-approach` station is level and ~10.8 m from the adopted gate, so the gate
oval (6.45 m centre height) lies above its 35 mm frame. r04 adds a separate
diagnostic view from the far side of the main road, matching the R01 composition
reference (a frontal view of the gate across the road). It is a review camera, not a
route station and not a historical camera position.

Usage: python3 scripts/make_r04_views.py [--check]
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"
GATE = ROOT / "data/decisions/kabukicho-gate-1976.json"
TERRAIN = ROOT / "data/derived/kabukicho-terrain.json"
OUT = SCENE / "cameras/r04-gate-establishing.json"

BACK_DISTANCE_M = 42.0  # far kerb side of the modern road polygon (road ends ~44 m back on this axis)
EYE_M = 1.6
FOCAL_MM = 35
LOOK_HEIGHT_ABOVE_GROUND_M = 5.2  # slight upward pitch so the gate and flanking upper floors share the frame


def height_at(terrain, x, z):
    V, T = terrain["vertices_m"], terrain["triangles"]
    for tri in T:
        a, b, c = (V[i] for i in tri)
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
        l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
        l3 = 1 - l1 - l2
        if min(l1, l2, l3) >= -1e-9:
            return l1 * a[1] + l2 * b[1] + l3 * c[1]
    raise ValueError(f"point outside terrain: {x}, {z}")


def build():
    gate = json.loads(GATE.read_text(encoding="utf-8"))["parameters"]
    terrain = json.loads(TERRAIN.read_text(encoding="utf-8"))
    ax, ay, az = gate["anchor_local_m"]
    fx, fz = gate["forward_xz"]
    rx, rz = gate["right_xz"]
    cu = gate["center_u_m"]
    gx, gz = ax + rx * cu, az + rz * cu
    px, pz = gx - fx * BACK_DISTANCE_M, gz - fz * BACK_DISTANCE_M
    ground = height_at(terrain, px, pz)
    gate_ground = height_at(terrain, gx, gz)
    look = [round(gx, 4), round(gate_ground + LOOK_HEIGHT_ABOVE_GROUND_M, 4), round(gz, 4)]
    pos = [round(px, 4), round(ground + EYE_M, 4), round(pz, 4)]
    pitch = math.degrees(math.atan2(look[1] - pos[1], math.hypot(look[0] - pos[0], look[2] - pos[2])))
    return {
        "schema_version": 1,
        "id": "r04-gate-establishing",
        "status": "r04-diagnostic-view",
        "role": "supplementary review camera for the adopted gate; not a route station",
        "position_m": pos,
        "look_at_m": look,
        "height_m": EYE_M,
        "height_reference": "above modern DEM TIN surface",
        "ground_height_local_m": round(ground, 4),
        "focal_length_35mm_equivalent_mm": FOCAL_MM,
        "camera_pitch_degrees": round(pitch, 3),
        "derivation": {
            "gate_decision": "data/decisions/kabukicho-gate-1976.json",
            "gate_centre_xz_m": [round(gx, 4), round(gz, 4)],
            "back_distance_along_gate_forward_m": BACK_DISTANCE_M,
            "look_height_above_gate_ground_m": LOOK_HEIGHT_ABOVE_GROUND_M,
            "script": "scripts/make_r04_views.py",
        },
        "composition_reference": "R01 (approved colour reference; composition target only, not evidence)",
        "historical_confidence": "not-applicable: review camera; the R01 source photograph's camera position is not reconstructed",
        "source": "r04-review-camera",
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="verify the committed file matches without writing")
    a = ap.parse_args()
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if a.check:
        if OUT.read_text(encoding="utf-8") != text:
            raise SystemExit(f"{OUT.relative_to(ROOT)} is stale")
        print("ok")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} pitch {data['camera_pitch_degrees']} deg")


if __name__ == "__main__":
    main()
