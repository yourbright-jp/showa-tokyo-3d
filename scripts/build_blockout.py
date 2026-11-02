#!/usr/bin/env python3
"""Build a provisional period-layout study and six camera proposals."""
import json
import math
from pathlib import Path
from import_plateau import ROOT, SCENE, export_gltf, export_glb, horizontal, normal, write_json


def pixel_latlon(pixel, space):
    scale = 256 * 2 ** space["zoom"]
    x = space["tile_x"] * 256 + pixel[0]
    y = space["tile_y"] * 256 + pixel[1]
    return [math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / scale)))), x / scale * 360 - 180]


def contains(point, polygon):
    x, z = point
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[2] > z) != (b[2] > z) and x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]:
            inside = not inside
    return inside


def main():
    data = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text())
    h = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text())
    origin, space = data["config"]["origin_jgd2011"], h["pixel_space"]
    removed = set(h["replace_modern_feature_ids"])
    features = [f for f in data["features"] if f["id"] not in removed]
    for proxy in h["proxies"]:
        latlons = [pixel_latlon(p, space) for p in proxy["pixels"]]
        footprint = [[*horizontal(*ll, origin)] for ll in latlons]
        bottom = [[round(x, 4), 0, round(z, 4)] for x, z in footprint]
        top = [[p[0], proxy["height_assumption_m"], p[2]] for p in bottom]
        if normal(top)[1] < 0:
            bottom.reverse()
            top.reverse()
        walls = [[bottom[i], bottom[(i + 1) % len(bottom)], top[(i + 1) % len(top)], top[i]] for i in range(len(bottom))]
        features.append({"id": proxy["id"], "name": proxy["name"], "kind": "building", "source_lod": None,
            "centroid_latlon": [sum(p[i] for p in latlons) / len(latlons) for i in (0, 1)],
            "height_m": proxy["height_assumption_m"], "height_verified": False,
            "historical_status": "inferred-roof-proxy", "polygons": [list(reversed(bottom)), top] + walls})
    stations = []
    for s in h["stations"]:
        ll = pixel_latlon(s["pixel"], space)
        x, z = horizontal(*ll, origin)
        stations.append({**s, "latlon_jgd2011_approx": ll, "position_m": [round(x, 4), 1.6, round(z, 4)],
                         "position_status": "aerial-interpreted-proposal"})
    lengths = [math.dist(a["position_m"], b["position_m"]) for a, b in zip(stations, stations[1:])]
    route = {"schema_version": 1, "status": "provisional-from-period-aerial", "historical_confidence": "unverified",
        "source_period": h["source_period"], "exact_capture_date": None, "distance_m": round(sum(lengths), 3),
        "nominal_speed_m_s": 1, "nominal_duration_s": round(sum(lengths), 3), "eye_height_m": 1.6,
        "focal_length_35mm_equivalent_mm": 35, "stations": stations, "geometry": {
            "type": "LineString", "coordinate_space": "local-east-up-south-metres",
            "coordinates": [[p["position_m"][0], 0, p["position_m"][2]] for p in stations]},
        "limitations": h["limitations"]}
    for i, station in enumerate(stations):
        eye = station["position_m"]
        if station.get("look_at_pixel"):
            tx, tz = horizontal(*pixel_latlon(station["look_at_pixel"], space), origin)
            target = [round(tx, 4), eye[1], round(tz, 4)]
        else:
            target = stations[i + 1]["position_m"] if i + 1 < len(stations) else [eye[0] + 12, eye[1], eye[2]]
        station["look_at_m"] = target
        write_json(SCENE / "cameras" / (station["id"] + ".json"), {"schema_version": 1,
            "id": station["id"], "status": "proposal", "position_m": eye, "look_at_m": target,
            "height_m": 1.6, "focal_length_35mm_equivalent_mm": 35, "source": "aerial-interpreted-proposal"})
    collisions = []
    minimum_clearance = float("inf")
    road_samples = total = 0
    for segment, (a, b) in enumerate(zip(stations, stations[1:])):
        count = math.ceil(math.dist(a["position_m"], b["position_m"]) / 0.5)
        for j in range(count + 1):
            t = j / count
            p = [a["position_m"][k] * (1 - t) + b["position_m"][k] * t for k in (0, 2)]
            total += 1
            if any(contains(p, ring) for f in features if f["kind"] == "road" for ring in f["polygons"]):
                road_samples += 1
            for f in features:
                if f["kind"] != "building":
                    continue
                for ring in f["polygons"]:
                    if max(v[1] for v in ring) >= 0.01:
                        continue
                    if contains(p, ring):
                        collisions.append({"segment": segment, "t": round(t, 5), "feature_id": f["id"], "position_xz": p})
                    for v, w in zip(ring, ring[1:] + ring[:1]):
                        dx, dz = w[0] - v[0], w[2] - v[2]
                        den = dx * dx + dz * dz
                        k = max(0, min(1, ((p[0] - v[0]) * dx + (p[1] - v[2]) * dz) / den)) if den else 0
                        minimum_clearance = min(minimum_clearance, math.hypot(p[0] - v[0] - k * dx, p[1] - v[2] - k * dz))
    route["validation"] = {"spacing_m_at_most": 0.5, "samples": total, "samples_on_modern_road": road_samples,
        "building_interior_collisions": len(collisions), "collision_feature_ids": sorted({c["feature_id"] for c in collisions}),
        "minimum_sampled_building_edge_clearance_m": round(minimum_clearance, 3),
        "scope": "sampled static footprint centreline and edge clearance only; no continuous swept body, props, slope, dynamic objects or historical street survey"}
    write_json(SCENE / "cameras/route-proposal.json", route)
    write_json(ROOT / "data/derived/route-collision-report.json", {"validation": route["validation"], "collisions": collisions})
    cfg = dict(data["config"])
    intermediate = ROOT / "tmp/layout-study-base.gltf"
    export_gltf(features, intermediate, cfg)
    model = json.loads(intermediate.read_text())
    model["scenes"][0]["name"] = "Provisional period-layout study with modern context"
    model["extras"].update({"role": "provisional-period-layout-study", "historical_confidence": "unverified",
        "removed_modern_ids": sorted(removed), "proxy_height_verified": False})
    model["materials"].append({"name": "inferred theatre volumes", "doubleSided": True,
        "pbrMetallicRoughness": {"baseColorFactor": [0.79, 0.43, 0.17, 1], "metallicFactor": 0, "roughnessFactor": 1}})
    for node in model["nodes"]:
        if node.get("extras", {}).get("historical_status") == "inferred-roof-proxy":
            model["meshes"][node["mesh"]]["primitives"][0]["material"] = 2
    model["cameras"] = []
    for station in stations:
        p, target = station["position_m"], station["look_at_m"]
        yaw = math.atan2(-(target[0] - p[0]), -(target[2] - p[2]))
        model["cameras"].append({"name": station["id"], "type": "perspective", "perspective": {
            "aspectRatio": 16 / 9, "yfov": 2 * math.atan(36 / (16 / 9) / (2 * 35)), "znear": 0.1, "zfar": 2000}})
        model["scenes"][0]["nodes"].append(len(model["nodes"]))
        model["nodes"].append({"name": station["id"], "camera": len(model["cameras"]) - 1,
            "translation": p, "rotation": [0, math.sin(yaw / 2), 0, math.cos(yaw / 2)], "extras": {"status": "proposal"}})
    write_json(SCENE / "models/layout-study.gltf", model, compact=True)
    export_glb(model, ROOT / "renders/r01/layout-study.glb")
    write_json(ROOT / "data/derived/kabukicho-layout-features.json", {"config": cfg, "features": features}, compact=True)
    print(json.dumps({"route_distance_m": route["distance_m"], "validation": route["validation"]}))


if __name__ == "__main__":
    main()
