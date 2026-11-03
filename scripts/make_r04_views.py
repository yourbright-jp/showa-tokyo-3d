#!/usr/bin/env python3
"""Write the r04 supplementary review cameras (not route stations).

The six R01 station cameras and the adopted walk are left untouched. Two of the fixed
stations cannot frame the adopted gate by construction: `entrance-approach` is level and
~10.8 m in front of it (the gate oval, centre 6.45 m, is above the 35 mm frame) and
`under-gate` stands in the gate plane looking along the street. r04 therefore adds:

- r04-gate-establishing: the gate front from the far side of the main road (R01 composition)
- r04-gate-rear: the inferred rear face of the gate from inside Ichibangai, looking back
- r04-milano-front: the adopted Milano-za front from the plaza (R03/R09 material target)

They are review cameras, not historical camera positions.

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
PERIOD = ROOT / "data/derived/kabukicho-period-features.json"
EYE_M = 1.6
FOCAL_MM = 35


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


def inside(x, z, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            hit = not hit
        j = i
    return hit


def solid_rings(period):
    rings = []
    for f in period["features"]:
        if f["kind"] not in ("building", "fixture"):
            continue
        for poly in f.get("polygons", []):
            ys = [p[1] for p in poly]
            if len(poly) >= 3 and max(ys) - min(ys) < 1e-3:  # horizontal faces give the footprint
                rings.append([(p[0], p[2]) for p in poly])
    return rings


def camera(view_id, pos_xz, look_xz, look_h_above_ground, terrain, rings, derivation, composition, role):
    for r in rings:
        if inside(pos_xz[0], pos_xz[1], r):
            raise SystemExit(f"{view_id}: camera position falls inside a solid footprint")
    ground = height_at(terrain, *pos_xz)
    look_ground = height_at(terrain, *look_xz)
    pos = [round(pos_xz[0], 4), round(ground + EYE_M, 4), round(pos_xz[1], 4)]
    look = [round(look_xz[0], 4), round(look_ground + look_h_above_ground, 4), round(look_xz[1], 4)]
    pitch = math.degrees(math.atan2(look[1] - pos[1], math.hypot(look[0] - pos[0], look[2] - pos[2])))
    return {
        "schema_version": 1,
        "id": view_id,
        "status": "r04-diagnostic-view",
        "role": role,
        "position_m": pos,
        "look_at_m": look,
        "height_m": EYE_M,
        "height_reference": "above modern DEM TIN surface",
        "ground_height_local_m": round(ground, 4),
        "focal_length_35mm_equivalent_mm": FOCAL_MM,
        "camera_pitch_degrees": round(pitch, 3),
        "derivation": {**derivation, "script": "scripts/make_r04_views.py"},
        "composition_reference": composition,
        "historical_confidence": "not-applicable: review camera; no source photograph's camera position is reconstructed",
        "source": "r04-review-camera",
    }


def build():
    gate = json.loads(GATE.read_text(encoding="utf-8"))["parameters"]
    terrain = json.loads(TERRAIN.read_text(encoding="utf-8"))
    period = json.loads(PERIOD.read_text(encoding="utf-8"))
    rings = solid_rings(period)
    ax, _, az = gate["anchor_local_m"]
    fx, fz = gate["forward_xz"]
    rx, rz = gate["right_xz"]
    cu = gate["center_u_m"]
    gx, gz = ax + rx * cu, az + rz * cu
    views = {}
    back = 42.0  # far kerb side of the modern road polygon on the gate axis (road ends ~44 m back)
    views["r04-gate-establishing"] = camera(
        "r04-gate-establishing", (gx - fx * back, gz - fz * back), (gx, gz), 5.2, terrain, rings,
        {"gate_decision": "data/decisions/kabukicho-gate-1976.json", "gate_centre_xz_m": [round(gx, 4), round(gz, 4)],
         "back_distance_along_gate_forward_m": back, "look_height_above_gate_ground_m": 5.2},
        "R01 (approved colour reference; composition target only, not evidence)",
        "supplementary review camera for the adopted gate front; not a route station")
    ahead = 18.0
    views["r04-gate-rear"] = camera(
        "r04-gate-rear", (gx + fx * ahead, gz + fz * ahead), (gx, gz), 5.6, terrain, rings,
        {"gate_decision": "data/decisions/kabukicho-gate-1976.json", "gate_centre_xz_m": [round(gx, 4), round(gz, 4)],
         "ahead_distance_along_gate_forward_m": ahead, "look_height_above_gate_ground_m": 5.6},
        "none (no source shows the gate's rear face); light/material R01, R08",
        "supplementary review camera for the inferred rear face of the adopted gate; not a route station")
    name = next(t for t in period["text_nodes"] if t["id"] == "milano-name-0")
    bx, bz = name["baseline_direction_xz"]
    nx, nz = -bz, bx  # outward normal of the adopted Milano-za front (towards the plaza)
    mx, mz = name["position_m"][0], name["position_m"][2]
    dist = 30.0
    views["r04-milano-front"] = camera(
        "r04-milano-front", (mx + nx * dist, mz + nz * dist), (mx, mz), 6.0, terrain, rings,
        {"text_node": "milano-name-0 (data/derived/kabukicho-period-features.json)", "front_point_xz_m": [round(mx, 4), round(mz, 4)],
         "distance_along_front_normal_m": dist, "look_height_above_front_ground_m": 6.0},
        "R03/R09 (approved colour references of 1971-1972 sources; material target only, not evidence)",
        "supplementary review camera for the adopted Milano-za front; not a route station")
    return views


def main():
    ap = argparse.ArgumentParser(description="Write the r04 supplementary review cameras.")
    ap.add_argument("--check", action="store_true", help="verify the committed files match without writing")
    a = ap.parse_args()
    for vid, data in build().items():
        out = SCENE / f"cameras/{vid}.json"
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        if a.check:
            if not out.exists() or out.read_text(encoding="utf-8") != text:
                raise SystemExit(f"{out.relative_to(ROOT)} is stale")
            continue
        out.write_text(text, encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)} pitch {data['camera_pitch_degrees']} deg")
    if a.check:
        print("ok")


if __name__ == "__main__":
    main()
