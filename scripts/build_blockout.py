#!/usr/bin/env python3
"""Build a provisional period-layout study and terrain-aware camera proposals."""
import json
import math
from import_plateau import ROOT, SCENE, export_gltf, export_glb, horizontal, normal, write_json, load_terrain


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


def footprint(feature):
    """Lowest horizontal LOD1 face, independent of the common vertical datum."""
    candidates = [ring for ring in feature["polygons"] if abs(normal(ring)[1]) > .95]
    if not candidates:
        raise ValueError("Building has no horizontal footprint: " + feature["id"])
    return min(candidates, key=lambda ring: sum(p[1] for p in ring) / len(ring))


def edge_distance(point, ring):
    x, z = point
    distance = float("inf")
    for a, b in zip(ring, ring[1:] + ring[:1]):
        dx, dz = b[0] - a[0], b[2] - a[2]
        den = dx * dx + dz * dz
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / den)) if den else 0
        distance = min(distance, math.hypot(x - a[0] - t * dx, z - a[2] - t * dz))
    return distance


def heading(a, b):
    return math.degrees(math.atan2(b[0] - a[0], -(b[2] - a[2]))) % 360


def camera_rotation(eye, target):
    dx, dy, dz = [target[i] - eye[i] for i in range(3)]
    yaw = math.atan2(-dx, -dz)
    pitch = math.atan2(dy, math.hypot(dx, dz))
    sy, cy, sp, cp = math.sin(yaw / 2), math.cos(yaw / 2), math.sin(pitch / 2), math.cos(pitch / 2)
    # Yaw about world Y followed by local X pitch. glTF camera looks along -Z.
    return [cy * sp, sy * cp, -sy * sp, cy * cp]


def main():
    data = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text())
    h = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text())
    cfg = dict(data["config"])
    terrain = load_terrain(cfg)
    origin, space = cfg["origin_jgd2011"], h["pixel_space"]
    removed = set(h["replace_modern_feature_ids"])
    features = [f for f in data["features"] if f["id"] not in removed]
    for proxy in h["proxies"]:
        latlons = [pixel_latlon(p, space) for p in proxy["pixels"]]
        outline = [horizontal(*ll, origin) for ll in latlons]
        # A rigid flat foundation is assumed at the mean TIN height of its corners.
        # This preserves a closed volume without claiming a historical foundation survey.
        base_y = sum(terrain.height(x, z) for x, z in outline) / len(outline)
        bottom = [[round(x, 4), round(base_y, 4), round(z, 4)] for x, z in outline]
        top = [[p[0], round(base_y + proxy["height_assumption_m"], 4), p[2]] for p in bottom]
        if normal(top)[1] < 0:
            bottom.reverse()
            top.reverse()
        walls = [[bottom[i], bottom[(i + 1) % len(bottom)], top[(i + 1) % len(top)], top[i]] for i in range(len(bottom))]
        features.append({"id": proxy["id"], "name": proxy["name"], "kind": "building", "source_lod": None,
            "centroid_latlon": [sum(p[i] for p in latlons) / len(latlons) for i in (0, 1)],
            "height_m": proxy["height_assumption_m"], "height_verified": False,
            "base_orthometric_height_m_assumption": round(base_y + origin["height_m"], 4),
            "base_height_method": "mean modern DEM TIN height at interpreted roof corners; assumed rigid foundation",
            "historical_status": "inferred-roof-proxy", "polygons": [list(reversed(bottom)), top] + walls})
    for f in features:
        if f["kind"] == "building":
            f["footprint_xz"] = [[p[0], p[2]] for p in footprint(f)]
    plaza = dict(h["plaza"])
    plaza["boundary_m"] = []
    for pixel in plaza["boundary_pixels"]:
        x, z = horizontal(*pixel_latlon(pixel, space), origin)
        plaza["boundary_m"].append([round(x, 4), round(terrain.height(x, z), 4), round(z, 4)])
    stations = []
    for s in h["stations"]:
        ll = pixel_latlon(s["pixel"], space)
        x, z = horizontal(*ll, origin)
        ground_y = terrain.height(x, z)
        stations.append({**s, "latlon_jgd2011_approx": ll,
            "position_m": [round(x, 4), round(ground_y + 1.6, 4), round(z, 4)],
            "ground_height_local_m": round(ground_y, 4),
            "ground_height_orthometric_m": round(ground_y + origin["height_m"], 4),
            "eye_height_above_ground_m": 1.6,
            "focal_length_35mm_equivalent_mm": s.get("focal_length_35mm_equivalent_mm", 35),
            "in_plaza_hypothesis": contains([x, z], plaza["boundary_m"]),
            "position_status": "aerial-interpreted-proposal"})
    ground_points = [[s["position_m"][0], s["ground_height_local_m"], s["position_m"][2]] for s in stations]
    lengths = [math.dist(a, b) for a, b in zip(ground_points, ground_points[1:])]
    route = {"schema_version": 1, "status": "provisional-from-period-aerial", "historical_confidence": "unverified",
        "source_period": h["source_period"], "exact_capture_date": None, "distance_m": round(sum(lengths), 3),
        "distance_method": "3D station polyline with DEM height at each station; not a continuously terrain-integrated walking distance",
        "nominal_speed_m_s": 1, "nominal_duration_s": round(sum(lengths), 3), "eye_height_m": 1.6,
        "focal_length_35mm_equivalent_mm": 35, "stations": stations, "geometry": {
            "type": "LineString", "coordinate_space": "local-east-up-south-metres", "coordinates": ground_points},
        "vertical_reference": {"source": cfg["terrain_derived_path"], "orthometric_height_offset_m": origin["height_m"],
            "camera_method": "modern DEM TIN surface plus 1.6 m; historical ground levels not verified"},
        "plaza": plaza, "limitations": h["limitations"]}
    proxy_rings = [footprint(f) for f in features if f.get("historical_status") == "inferred-roof-proxy"]
    for i, station in enumerate(stations):
        eye = station["position_m"]
        if station.get("look_at_pixel"):
            tx, tz = horizontal(*pixel_latlon(station["look_at_pixel"], space), origin)
            target = [round(tx, 4), round(terrain.height(tx, tz) + station.get("look_at_height_above_ground_m", 1.6), 4), round(tz, 4)]
        else:
            target = stations[i + 1]["position_m"] if i + 1 < len(stations) else [eye[0] + 12, eye[1], eye[2]]
        station["look_at_m"] = target
        station["camera_heading_degrees_local_north"] = round(heading(eye, target), 3)
        station["camera_pitch_degrees"] = round(math.degrees(math.atan2(target[1] - eye[1], math.hypot(target[0] - eye[0], target[2] - eye[2]))), 3)
        incoming = heading(stations[i - 1]["position_m"], eye) if i else None
        outgoing = heading(eye, stations[i + 1]["position_m"]) if i + 1 < len(stations) else None
        station["route_incoming_heading_deg"] = round(incoming, 3) if incoming is not None else None
        station["route_outgoing_heading_deg"] = round(outgoing, 3) if outgoing is not None else None
        station["route_turn_degrees"] = round(abs((outgoing - incoming + 180) % 360 - 180), 3) if incoming is not None and outgoing is not None else None
        station["minimum_proxy_footprint_distance_m"] = round(min(edge_distance([eye[0], eye[2]], ring) for ring in proxy_rings), 3)
        write_json(SCENE / "cameras" / (station["id"] + ".json"), {"schema_version": 1,
            "id": station["id"], "status": "proposal", "role": station.get("role"), "position_m": eye, "look_at_m": target,
            "height_m": 1.6, "height_reference": "above modern DEM TIN surface", "ground_height_local_m": station["ground_height_local_m"],
            "focal_length_35mm_equivalent_mm": station["focal_length_35mm_equivalent_mm"], "source": "aerial-interpreted-proposal"})
    collisions = []
    minimum_clearance = float("inf")
    road_samples = plaza_samples = both_samples = outside_samples = total = 0
    building_rings = [(f["id"], footprint(f)) for f in features if f["kind"] == "building"]
    for segment, (a, b) in enumerate(zip(stations, stations[1:])):
        count = math.ceil(math.hypot(a["position_m"][0] - b["position_m"][0], a["position_m"][2] - b["position_m"][2]) / 0.5)
        for j in range(count + 1):
            t = j / count
            p = [a["position_m"][k] * (1 - t) + b["position_m"][k] * t for k in (0, 2)]
            total += 1
            on_road = any(contains(p, ring) for f in features if f["kind"] == "road" for ring in f["polygons"])
            in_plaza = contains(p, plaza["boundary_m"])
            if on_road:
                road_samples += 1
            if in_plaza:
                plaza_samples += 1
            both_samples += on_road and in_plaza
            outside_samples += not on_road and not in_plaza
            for fid, ring in building_rings:
                if contains(p, ring):
                    collisions.append({"segment": segment, "t": round(t, 5), "feature_id": fid, "position_xz": p})
                minimum_clearance = min(minimum_clearance, edge_distance(p, ring))
    route["validation"] = {"spacing_m_at_most": 0.5, "samples": total, "samples_on_modern_road": road_samples,
        "samples_in_plaza_hypothesis": plaza_samples,
        "samples_on_modern_road_and_in_plaza": both_samples,
        "samples_on_modern_road_or_in_plaza": total - outside_samples,
        "samples_outside_modern_road_and_plaza": outside_samples,
        "building_interior_collisions": len(collisions), "collision_feature_ids": sorted({c["feature_id"] for c in collisions}),
        "minimum_sampled_building_edge_clearance_m": round(minimum_clearance, 3),
        "scope": "sampled static footprint centreline and edge clearance only; no continuous swept body, fountain/steps, street furniture, dynamic objects or historical street survey"}
    write_json(SCENE / "cameras/route-proposal.json", route)
    write_json(ROOT / "data/derived/route-collision-report.json", {"validation": route["validation"], "collisions": collisions})
    scene = json.loads((SCENE / "scene.json").read_text())
    scene["route"].update({key: route[key] for key in ("status", "distance_m", "geometry", "stations", "validation")})
    scene["route"].update({"source": h["source"], "camera_file": "cameras/route-proposal.json",
        "distance_status": "computed-proposal-not-historical-measurement"})
    camera_defaults = scene.setdefault("camera_proposal", {})
    camera_defaults.update({"height_m": route["eye_height_m"],
        "focal_length_35mm_equivalent_mm": route["focal_length_35mm_equivalent_mm"],
        "station_lens_overrides_mm": {s["id"]: s["focal_length_35mm_equivalent_mm"] for s in stations
            if s["focal_length_35mm_equivalent_mm"] != route["focal_length_35mm_equivalent_mm"]},
        "lens_scope": "Default proposal with per-station geometry diagnostic overrides; continuous film lens and turns remain unapproved."})
    scene["coordinate_system"]["origin_jgd2011"] = origin
    write_json(SCENE / "scene.json", scene)
    intermediate = ROOT / "tmp/layout-study-base.gltf"
    export_gltf(features, intermediate, cfg)
    model = json.loads(intermediate.read_text())
    model["asset"]["copyright"] = ("東京都・新宿区 3D 都市モデル（Project PLATEAU）2025 年度を加工（CC BY 4.0）。"
        "国土地理院の 1974–1978 年航空写真（gazo1）を参照して屋根輪郭・広場・配置を解釈。"
        "高さ、広場境界、現代地物の省略、1976 年の外観は未検証。")
    model["scenes"][0]["name"] = "Provisional period-layout study with modern context and DEM terrain"
    model["extras"].update({"role": "provisional-period-layout-study", "historical_confidence": "unverified",
        "removed_modern_ids": sorted(removed), "removal_decisions": h["removal_decisions"],
        "proxy_height_verified": False, "plaza": plaza})
    model["materials"].append({"name": "inferred theatre volumes", "doubleSided": True,
        "pbrMetallicRoughness": {"baseColorFactor": [0.79, 0.43, 0.17, 1], "metallicFactor": 0, "roughnessFactor": 1}})
    proxy_material = len(model["materials"]) - 1
    for node in model["nodes"]:
        if node.get("extras", {}).get("historical_status") == "inferred-roof-proxy":
            model["meshes"][node["mesh"]]["primitives"][0]["material"] = proxy_material
    model["cameras"] = []
    for station in stations:
        p, target = station["position_m"], station["look_at_m"]
        focal_mm = station["focal_length_35mm_equivalent_mm"]
        model["cameras"].append({"name": station["id"], "type": "perspective", "perspective": {
            "aspectRatio": 16 / 9, "yfov": 2 * math.atan(36 / (16 / 9) / (2 * focal_mm)), "znear": 0.1, "zfar": 2000}})
        model["scenes"][0]["nodes"].append(len(model["nodes"]))
        model["nodes"].append({"name": station["id"], "camera": len(model["cameras"]) - 1,
            "translation": p, "rotation": camera_rotation(p, target), "extras": {"status": "proposal"}})
    write_json(SCENE / "models/layout-study.gltf", model, compact=True)
    export_glb(model, ROOT / "renders/r01/layout-study.glb")
    write_json(ROOT / "data/derived/kabukicho-layout-features.json", {"config": cfg, "features": features, "plaza": plaza}, compact=True)
    print(json.dumps({"route_distance_m": route["distance_m"], "validation": route["validation"], "stations": [{"id":s["id"],"turn_deg":s["route_turn_degrees"],"in_plaza":s["in_plaza_hypothesis"]} for s in stations]}))


if __name__ == "__main__":
    main()
