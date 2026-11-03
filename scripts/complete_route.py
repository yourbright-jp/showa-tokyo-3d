#!/usr/bin/env python3
"""Adopt and audit the route's paving joins and a terrain-following film walk.

The R01 diagnostic cameras remain immutable inputs. Historical paving and props
are modelling decisions with explicit inference, never a claim of a 1976 survey.
"""
import argparse
import bisect
import json
import math
from pathlib import Path

from import_plateau import ROOT, SCENE, horizontal, load_terrain, write_json
from build_blockout import contains, edge_distance, footprint, pixel_latlon, camera_rotation

DECISION_PATH = ROOT / "data/decisions/kabukicho-route-surfaces-1976.json"
REPORT_PATH = ROOT / "data/derived/kabukicho-route-completion.json"
WALK_PATH = SCENE / "cameras/adopted-walk.json"
PERIOD_PATH = ROOT / "data/derived/kabukicho-period-features.json"
SPACING = .25
BODY_RADIUS = .35
BODY_HEIGHT = 1.8


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def sub(a, b):
    return [a[i] - b[i] for i in range(2)]


def lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(len(a))]


def xz(point):
    return [point[0], point[2]]


def ring3(ring):
    return [[p[0], 0, p[1]] for p in ring]


def segment_edge_parameters(a, b, c, d):
    """Parameters along AB at any intersection, including collinear overlaps."""
    ab, cd, ac = sub(b, a), sub(d, c), sub(c, a)
    den = cross(ab, cd)
    if abs(den) > 1e-10:
        t, u = cross(ac, cd) / den, cross(ac, ab) / den
        return [max(0., min(1., t))] if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9 else []
    if abs(cross(ac, ab)) > 1e-8:
        return []
    length2 = sum(v * v for v in ab)
    if length2 < 1e-16:
        return [0.] if math.dist(a, c) < 1e-8 else []
    ts = [sum((p[i] - a[i]) * ab[i] for i in range(2)) / length2 for p in (c, d)]
    lo, hi = max(0., min(ts)), min(1., max(ts))
    return [lo, hi] if lo <= hi + 1e-9 else []


def point_segment_distance(p, a, b):
    ab = sub(b, a)
    den = sum(v * v for v in ab)
    t = max(0., min(1., sum((p[i] - a[i]) * ab[i] for i in range(2)) / den)) if den else 0
    return math.dist(p, lerp(a, b, t))


def segment_distance(a, b, c, d):
    if segment_edge_parameters(a, b, c, d):
        return 0.
    return min(point_segment_distance(a, c, d), point_segment_distance(b, c, d),
               point_segment_distance(c, a, b), point_segment_distance(d, a, b))


def polygon_distance(a, b, polygon):
    ring = ring3(polygon)
    if contains(a, ring) or contains(b, ring):
        return 0.
    return min(segment_distance(a, b, c, d) for c, d in zip(polygon, polygon[1:] + polygon[:1]))


def covered(p, ring):
    return contains(p, ring) or edge_distance(p, ring) < 1e-7


def surface_category(p, surfaces):
    for surface in surfaces:
        if covered(p, surface["boundary_m"]):
            return surface["category"], surface["id"]
    return "unclassified", None


def partition_surface_segment(a, b, surfaces):
    """Split at every surface edge, so midpoint tests cover entire intervals."""
    params = [0., 1.]
    for surface in surfaces:
        polygon = [xz(p) for p in surface["boundary_m"]]
        for c, d in zip(polygon, polygon[1:] + polygon[:1]):
            params.extend(segment_edge_parameters(a, b, c, d))
    params = sorted(set(round(t, 12) for t in params))
    return [(lo, hi, *surface_category(lerp(a, b, (lo + hi) / 2), surfaces))
            for lo, hi in zip(params, params[1:]) if hi - lo > 1e-10]


def terrain_polyline(a, b, terrain, spacing=SPACING):
    """Include TIN edge crossings, then refine each planar span to <= spacing."""
    params = [0., 1.]
    lo, hi = [min(a[k], b[k]) for k in range(2)], [max(a[k], b[k]) for k in range(2)]
    for ids in terrain.triangles:
        tri = [xz(terrain.vertices[i]) for i in ids]
        if any(max(p[k] for p in tri) < lo[k] or min(p[k] for p in tri) > hi[k] for k in range(2)):
            continue
        for c, d in zip(tri, tri[1:] + tri[:1]):
            params.extend(segment_edge_parameters(a, b, c, d))
    params = sorted(set(round(t, 12) for t in params))
    points = []
    for lo, hi in zip(params, params[1:]):
        p, q = lerp(a, b, lo), lerp(a, b, hi)
        p, q = [p[0], terrain.height(*p), p[1]], [q[0], terrain.height(*q), q[1]]
        count = max(1, math.ceil(math.dist(p, q) / spacing))
        points.extend(lerp(p, q, j / count) for j in range(count))
    end = [b[0], terrain.height(*b), b[1]]
    return points + [end]


def heading(a, b):
    return math.degrees(math.atan2(b[0] - a[0], -(b[2] - a[2]))) % 360


def signed_angle(a, b):
    return (b - a + 180) % 360 - 180


def speed_time(distance, total, acceleration_distance=1.5):
    """1 m/s cruise with constant acceleration/deceleration to rest at turns."""
    distance = max(0., min(total, distance))
    ramp = min(acceleration_distance, total / 2)
    acceleration = 1. / (2 * ramp)
    ramp_time = 1. / acceleration
    if distance < ramp:
        return math.sqrt(2 * distance / acceleration)
    if distance <= total - ramp:
        return ramp_time + distance - ramp
    decel_distance = distance - (total - ramp)
    return ramp_time + total - 2 * ramp + (1 - math.sqrt(max(0., 1 - 2 * acceleration * decel_distance))) / acceleration


def cumulative_distances(points):
    result = [0.]
    for a, b in zip(points, points[1:]):
        result.append(result[-1] + math.dist(a, b))
    return result


def at_distance(points, distances, distance):
    i = min(len(points) - 2, max(0, bisect.bisect_right(distances, distance) - 1))
    span = distances[i + 1] - distances[i]
    return lerp(points[i], points[i + 1], (distance - distances[i]) / span if span else 0.)


def make_walk(route, terrain, surfaces, arrival, gate):
    controls = route["geometry"]["coordinates"] + [arrival["ground_position_m"]]
    points, station_indices = [], [0]
    for a, b in zip(controls, controls[1:]):
        segment = terrain_polyline(xz(a), xz(b), terrain)
        points.extend(segment if not points else segment[1:])
        station_indices.append(len(points) - 1)
    distances = cumulative_distances(points)
    legs = [(0, station_indices[3]), (station_indices[3], station_indices[4]),
            (station_indices[4], station_indices[5]), (station_indices[5], station_indices[6])]
    samples, turns, offset = [], [], 0.
    gate_params = gate["parameters"]
    gate_anchor = gate_params["anchor_local_m"]
    gate_target = [gate_anchor[0] + gate_params["right_xz"][0] * gate_params["center_u_m"],
                   gate_anchor[1] + gate_params["oval_center_height_m"],
                   gate_anchor[2] + gate_params["right_xz"][1] * gate_params["center_u_m"]]
    first_eye = [points[0][0], points[0][1] + 1.6, points[0][2]]
    gate_yaw = heading(first_eye, gate_target)
    gate_pitch = math.degrees(math.atan2(gate_target[1] - first_eye[1], math.dist(xz(first_eye), xz(gate_target))))

    def append(ground, distance, time_s, yaw, pitch, phase, target_override=None):
        position = [ground[0], ground[1] + 1.6, ground[2]]
        target = [position[0] + math.sin(math.radians(yaw)) * 10,
                  position[1] + math.tan(math.radians(pitch)) * 10,
                  position[2] - math.cos(math.radians(yaw)) * 10]
        if target_override is not None:
            target = target_override
        q = camera_rotation(position, target)
        if samples and sum(a * b for a, b in zip(q, samples[-1]["quaternion_xyzw"])) < 0:
            q = [-v for v in q]
        category, sid = surface_category(xz(ground), surfaces)
        samples.append({"time_s": round(time_s, 7), "ground_position_m": [round(v, 7) for v in ground],
            "position_m": [round(v, 7) for v in position], "look_at_m": [round(v, 7) for v in target],
            "quaternion_xyzw": q, "heading_deg": round(yaw % 360, 7), "pitch_deg": round(pitch, 7),
            "cumulative_ground_distance_m": round(distance, 7), "surface_category": category,
            "surface_id": sid, "phase": phase})

    for li, (start, end) in enumerate(legs):
        origin_distance, length = distances[start], distances[end] - distances[start]
        for index in range(start + (1 if li else 0), end + 1):
            distance = distances[index]
            relative = distance - origin_distance
            a = at_distance(points[start:end + 1], [v - origin_distance for v in distances[start:end + 1]], max(0., relative - 1.5))
            b = at_distance(points[start:end + 1], [v - origin_distance for v in distances[start:end + 1]], min(length, relative + 1.5))
            yaw, pitch = heading(a, b), 0.
            if li == 0 and distance < 16.:
                u = distance / 16.
                weight = 1 - u * u * (3 - 2 * u)
                yaw += signed_angle(yaw, gate_yaw) * weight
                pitch = gate_pitch * weight
            append(points[index], distance, offset + speed_time(relative, length), yaw, pitch, "walk")
        offset += speed_time(length, length)
        yaw0 = samples[-1]["heading_deg"]
        if li < len(legs) - 1:
            yaw1 = heading(points[end], points[end + 1])
            turn_id = route["stations"][3 + li]["id"]
            pitch1, final_hold = 0., False
        else:
            eye = [points[end][0], points[end][1] + 1.6, points[end][2]]
            target = arrival["look_at_m"]
            yaw1 = heading(eye, target)
            pitch1 = math.degrees(math.atan2(target[1] - eye[1], math.dist(xz(eye), xz(target))))
            turn_id, final_hold = "theatre-arrival-door-look", True
        angle = signed_angle(yaw0, yaw1)
        duration = max(1.5, 1.5 * math.hypot(angle, pitch1) / 35.)
        count = math.ceil(duration * 15)
        turns.append({"id": turn_id, "start_s": round(offset, 7), "duration_s": round(duration, 7),
                      "signed_yaw_degrees": round(angle, 7), "translation_during_pan_m": 0,
                      "easing": "3u^2 - 2u^3; zero angular velocity at endpoints"})
        for j in range(1, count + 1):
            u = j / count
            weight = u * u * (3 - 2 * u)
            append(points[end], distances[end], offset + duration * u, yaw0 + angle * weight,
                   pitch1 * weight, "arrival-pan" if final_hold else "turn-in-place",
                   arrival["look_at_m"] if final_hold and j == count else None)
        offset += duration
        if final_hold:
            for j in range(1, 31):
                append(points[end], distances[end], offset + j / 15, yaw1, pitch1, "arrival-hold", arrival["look_at_m"])
            offset += 2
    return {"schema_version": 1, "id": "kabukicho-adopted-walk", "status": "adopted-with-inference",
            "historical_confidence": "inferred", "target_year": 1976,
            "coordinate_space": "local-east-up-south-metres", "origin_jgd2011": terrain.data["origin_jgd2011"],
            "focal_length_35mm_equivalent_mm": 35, "eye_height_above_ground_m": 1.6,
            "route_diagnostic_cameras_modified": False, "terminal_station": arrival,
            "route_control_points_m": controls, "ground_distance_m": round(distances[-1], 7),
            "duration_s": round(offset, 7), "sample_spacing_m_at_most": SPACING,
            "motion_plan": {"cruise_speed_m_s": 1, "acceleration_distance_m": 1.5,
                "turns": turns, "position_method": "R01 station polyline plus the adopted Koma entrance forecourt stop, split at source TIN edges and refined to 0.25 m 3D spacing",
                "orientation_method": "Initial gaze at the adopted gate plate eases down to street level over 16 m; 1.5 m fore/aft tangent window inside each moving leg; stationary eased pans at sharp turns and arrival",
                "initial_gate_gaze": {"source_decision_id": gate["id"], "target_m": gate_target,
                    "initial_heading_deg": gate_yaw, "initial_pitch_deg": gate_pitch,
                    "ease_to_street_distance_m": 16., "easing": "1 - (3u^2 - 2u^3)"},
                "timing_method": "constant acceleration to 1 m/s, cruise, constant deceleration to rest before stationary pans",
                "playback": "Positions and quaternions are key samples. Interpolate position by the stated arc-distance speed profile, terrain height by the TIN, and orientation with shortest-path quaternion interpolation."},
            "samples": samples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decisions-only", action="store_true", help="Prepare the adopted paving/arrival decisions before building the period model; do not issue a route audit")
    parser.add_argument("--allow-missing-period-obstacles", action="store_true", help="Development only; output explicitly marks incomplete prop checks")
    args = parser.parse_args()
    route = json.loads((SCENE / "cameras/route-proposal.json").read_text(encoding="utf-8"))
    layout = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text(encoding="utf-8"))
    h = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text(encoding="utf-8"))
    terrain = load_terrain(layout["config"])
    connector_pixels = [[185.5, 287], [189.5, 287], [192, 280], [188, 280]]
    connector = {"id": "ichibangai-plaza-paving-join", "category": "adopted-connector-paving", "boundary_pixels": connector_pixels,
                 "boundary_m": [], "historical_confidence": "inferred", "evidence_sources": ["gsi-gazo1-1974-1978"],
                 "interpretation": "A short street-to-plaza paving join, visible as the continuation of the aerial street corridor; adopted to bridge an annotation/source-polygon seam, not a newly surveyed road."}
    for pixel in connector_pixels:
        x, z = horizontal(*pixel_latlon(pixel, h["pixel_space"]), layout["config"]["origin_jgd2011"])
        connector["boundary_m"].append([round(x, 7), round(terrain.height(x, z), 7), round(z, 7)])
    koma = json.loads((ROOT / "data/decisions/kabukicho-koma-plaza-1976.json").read_text(encoding="utf-8"))
    theatre = next(b for b in koma["buildings"] if b["proxy_id"] == "koma-south-roof-proxy")
    edge = [horizontal(*pixel_latlon(p, h["pixel_space"]), layout["config"]["origin_jgd2011"]) for p in theatre["frontage_edge_pixels"]]
    width = math.dist(*edge)
    tangent = [(edge[1][k] - edge[0][k]) / width for k in range(2)]
    outward = [-tangent[1], tangent[0]]
    proxy = next(f for f in layout["features"] if f["id"] == theatre["proxy_id"])
    outline = footprint(proxy)
    centroid = [sum(p[k] for p in outline) / len(outline) for k in (0, 2)]
    mid = lerp(*edge, .5)
    if sum((mid[k] - centroid[k]) * outward[k] for k in range(2)) < 0:
        outward = [-v for v in outward]
    entrance_xz = lerp(*edge, theatre["entrance_fraction"])
    terminal_xz = [entrance_xz[k] + outward[k] * 9 for k in range(2)]
    gaze_xz = lerp(*edge, .44)
    target_xz = [gaze_xz[k] + outward[k] * .245 for k in range(2)]
    arrival = {"id": "theatre-arrival", "name": "旧コマ劇場の採用入口前", "source_decision_id": koma["id"],
        "frontage_proxy_id": theatre["proxy_id"], "entrance_fraction": theatre["entrance_fraction"],
        "frontage_edge_pixels": theatre["frontage_edge_pixels"], "frontage_edge_xz_m": edge,
        "outward_unit_vector_xz": outward, "stop_offset_outward_from_frontage_m": 9.0,
        "final_gaze_frontage_fraction": .44, "final_gaze_height_above_ground_m": 2.25,
        "framing_choice": "Stand back in the adopted entrance forecourt so the Koma name, canopy, doors and threshold share a 35 mm frame; avoid a dark glass close-up.",
        "entrance_edge_position_xz_m": entrance_xz,
        "ground_position_m": [terminal_xz[0], terrain.height(*terminal_xz), terminal_xz[1]],
        "look_at_m": [target_xz[0], terrain.height(*target_xz) + 2.25, target_xz[1]],
        "historical_confidence": "inferred", "entry_behavior": "Stop outside the physical threshold steps; do not enter the auditorium.",
        "position_status": "Adopted from the inferred western frontage and entrance fraction, not a surveyed 1976 entrance."}
    apron = {"id": "koma-entrance-forecourt-paving", "category": "adopted-theatre-forecourt-paving", "boundary_m": [],
        "historical_confidence": "inferred", "source_decision_id": koma["id"],
        "evidence_sources": ["gsi-gazo1-1974-1978", "shinjuku-koma-1957", "shinjuku-plaza-1975"],
        "interpretation": "Adopt the paved apron between the plaza and the adopted theatre entrance. The inner edge remains outside the modeled steps; exact historical paving limits are inferred.",
        "frontage_fraction_range": [.08, .92], "outward_depth_range_m": [2.0, 18.0]}
    for fraction, depth in ((.08, 2.), (.92, 2.), (.92, 18.), (.08, 18.)):
        point = [edge[0][k] + (edge[1][k] - edge[0][k]) * fraction + outward[k] * depth for k in range(2)]
        apron["boundary_m"].append([point[0], terrain.height(*point), point[1]])
    surfaces = [{"id": f["id"], "category": "modern-road-corridor-adopted-for-1976", "boundary_m": ring}
                for f in layout["features"] if f["kind"] == "road" for ring in f["polygons"]]
    surfaces.append({"id": route["plaza"]["id"], "category": "adopted-plaza-paving", "boundary_m": route["plaza"]["boundary_m"]})
    original = []
    for segment, (a, b) in enumerate(zip(route["stations"], route["stations"][1:])):
        n = math.ceil(math.dist(xz(a["position_m"]), xz(b["position_m"])) / .5)
        for j in range(n + 1):
            t = j / n
            p = lerp(xz(a["position_m"]), xz(b["position_m"]), t)
            if surface_category(p, surfaces)[0] == "unclassified":
                nearest = min((edge_distance(p, s["boundary_m"]), s["id"]) for s in surfaces if s["category"].startswith("modern-road"))
                original.append({"segment_index": segment, "sample_index": j, "segment_sample_count": n + 1, "t": t,
                    "position_xz_m": p, "pixel": lerp(a["pixel"], b["pixel"], t),
                    "nearest_road_distance_m": nearest[0], "nearest_road_id": nearest[1],
                    "adopted_category": connector["category"], "surface_id": connector["id"]})
    if len(original) != 4:
        raise ValueError("The original R01 route no longer has exactly the reviewed four unclassified samples")
    surfaces.extend([connector, apron])
    for sample in original:
        if surface_category(sample["position_xz_m"], [connector])[0] == "unclassified":
            raise ValueError("Adopted paving join fails to classify an original gap sample")
    decision = {"schema_version": 1, "id": "kabukicho-route-surfaces-1976", "status": "adopted-with-inference",
        "decision_complete": True, "target_year": 1976, "historical_confidence": "inferred",
        "user_authorization": "Complete the classification and historical decisions; where evidence cannot resolve a detail, adopt and label a reasoned estimate.",
        "source_route": "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json",
        "pixel_space": h["pixel_space"], "horizontal_uncertainty_m_assumption": h["horizontal_uncertainty_m_assumption"],
        "coordinate_precision_note": "Stored decimals support reproducibility and do not imply a surveyed historical position.",
        "connector_surfaces": [connector, apron], "theatre_arrival": arrival, "original_unclassified_samples": original,
        "dependencies": ["kabukicho-koma-plaza-1976"],
        "evidence": [{"id": "gsi-gazo1-1974-1978", "url": "https://maps.gsi.go.jp/development/ichiran.html", "year_range": [1974, 1978],
            "what_supports": "The visually continuous street/paving band near native mosaic pixels x187.5-187.9,y283.9-285.4. The native image is approximately 1 m per pixel; no exact 1976 survey is claimed."},
            {"id": "plateau-13104-shinjuku-ku-2025", "url": "https://www.mlit.go.jp/plateau/open-data/", "year": 2025,
             "what_supports": "Modern source road polygons lie only 0.064-0.347 m from the four unclassified centreline points. These polygon edges are modern reference, not historical paving boundaries."}],
        "assumptions": ["The short gap is paving between the street and plaza rather than a historical obstacle or building.",
            "The adopted Koma entrance fraction and frontage define a paved forecourt; the terminal stop is 9 m outside that frontage and before the physical threshold steps.",
            "The explicit connector is an inferred surface, not a correction to PLATEAU or a surveyed 1976 boundary.",
            "All retained modern road corridors are adopted for route construction, with historical status inferred where the aerial does not resolve detail."],
        "reversibility": "The R01 route, road polygons and plaza hypothesis remain unchanged; the adopted paving join is a separate polygon."}
    write_json(DECISION_PATH, decision)
    if args.decisions_only:
        print(json.dumps({"route_decisions_prepared": True, "audit_performed": False, "connector_surfaces": len(decision["connector_surfaces"])}))
        return
    gate = json.loads((ROOT / "data/decisions/kabukicho-gate-1976.json").read_text(encoding="utf-8"))
    walk = make_walk(route, terrain, surfaces, dict(arrival), gate)
    adopted_controls = walk["route_control_points_m"]
    continuous_gaps = []
    for si, (a, b) in enumerate(zip(adopted_controls, adopted_controls[1:])):
        for lo, hi, category, sid in partition_surface_segment(xz(a), xz(b), surfaces):
            if category == "unclassified":
                continuous_gaps.append({"segment_index": si, "t_interval": [lo, hi], "horizontal_length_m": (hi - lo) * math.dist(xz(a), xz(b))})
    unclassified = [i for i, sample in enumerate(walk["samples"]) if sample["surface_category"] == "unclassified"]
    period = json.loads(PERIOD_PATH.read_text(encoding="utf-8")) if PERIOD_PATH.exists() else {}
    obstacles_complete = bool(period.get("construction_complete"))
    if not obstacles_complete and not args.allow_missing_period_obstacles:
        raise ValueError("Build the complete period features with explicit obstacle footprints before the final route audit")
    obstacles = period.get("obstacles", [])
    if obstacles_complete and not obstacles:
        raise ValueError("The adopted period model supplies no explicit obstacles")
    ground_validation = {"source_tin_triangles": len(terrain.triangles), "period_ground_triangles": None,
                         "ground_matches_source_tin": False, "legacy_vertex_draped_road_planes_absent": False}
    if obstacles_complete:
        actual_ground = [f for f in period["features"] if f["kind"] == "terrain"]
        if len(actual_ground) != 1:
            raise ValueError("Expected one exact terrain-following adopted ground mesh")
        key = lambda points: tuple(sorted(tuple(v) for v in points))
        source_faces = {key([terrain.vertices[i] for i in ids]) for ids in terrain.triangles}
        actual_faces = {key(ring) for ring in actual_ground[0]["polygons"]}
        ground_validation.update({"period_ground_feature_id": actual_ground[0]["id"],
            "period_ground_triangles": len(actual_ground[0]["polygons"]),
            "ground_matches_source_tin": source_faces == actual_faces,
            "legacy_vertex_draped_road_planes_absent": not any(f["kind"] == "road" for f in period["features"])})
        if not ground_validation["ground_matches_source_tin"] or not ground_validation["legacy_vertex_draped_road_planes_absent"]:
            raise ValueError("Visible adopted ground must match the TIN, without floating vertex-draped road interiors")
    buildings = [(f["id"], [[p[0], p[2]] for p in footprint(f)]) for f in layout["features"] if f["kind"] == "building"]
    minima, collisions, overhead = {"building": [float("inf"), None], "prop": [float("inf"), None]}, [], []
    segments = [(xz(a), xz(b)) for a, b in zip(adopted_controls, adopted_controls[1:])]
    for kind, items in (("building", [{"id": fid, "footprint_xz": ring} for fid, ring in buildings]), ("prop", obstacles)):
        for obstacle in items:
            polygon = obstacle["footprint_xz"]
            if obstacle.get("collision_role") == "overhead" and obstacle.get("underside_clearance_m", 0) >= 2.2:
                if any(polygon_distance(a, b, polygon) <= BODY_RADIUS for a, b in segments):
                    overhead.append({"id": obstacle["id"], "underside_clearance_m": obstacle["underside_clearance_m"]})
                continue
            for si, (a, b) in enumerate(segments):
                clearance = polygon_distance(a, b, polygon)
                if clearance < minima[kind][0]:
                    minima[kind] = [clearance, obstacle["id"]]
                if clearance <= BODY_RADIUS:
                    collisions.append({"id": obstacle["id"], "kind": kind, "segment_index": si,
                                       "centreline_clearance_m": round(clearance, 7), "body_radius_m": BODY_RADIUS})
    terminal_clearances = []
    terminal = xz(arrival["ground_position_m"])
    for fid, polygon in buildings:
        terminal_clearances.append((polygon_distance(terminal, terminal, polygon), fid))
    for obstacle in obstacles:
        if obstacle.get("collision_role") != "overhead":
            terminal_clearances.append((polygon_distance(terminal, terminal, obstacle["footprint_xz"]), obstacle["id"]))
    terminal_minimum = min(terminal_clearances)
    walk["terminal_station"]["minimum_net_static_clearance_m"] = round(terminal_minimum[0] - BODY_RADIUS, 7)
    walk["terminal_station"]["nearest_terminal_obstacle_id"] = terminal_minimum[1]
    if walk["terminal_station"]["minimum_net_static_clearance_m"] < .5:
        raise ValueError("Adopted theatre arrival stop must leave at least 0.5 m net body clearance")
    all_clearance = min(v[0] for v in minima.values())
    angular_rates, moving_speeds, gradients, quaternion_aim_errors = [], [], [], []
    for sample in walk["samples"]:
        qx, qy, qz, qw = sample["quaternion_xyzw"]
        forward = [-2 * (qx * qz + qw * qy), -2 * (qy * qz - qw * qx), -(1 - 2 * (qx * qx + qy * qy))]
        aim = [a - b for a, b in zip(sample["look_at_m"], sample["position_m"])]
        norm = math.sqrt(sum(v * v for v in aim))
        quaternion_aim_errors.append(math.sqrt(sum((a - b / norm) ** 2 for a, b in zip(forward, aim))))
    for a, b in zip(walk["samples"], walk["samples"][1:]):
        dt = b["time_s"] - a["time_s"]
        if dt <= 0:
            raise ValueError("Walk timestamps are not strictly increasing")
        dot = sum(v * w for v, w in zip(a["quaternion_xyzw"], b["quaternion_xyzw"]))
        angular_rates.append(math.degrees(2 * math.acos(min(1., max(-1., dot)))) / dt)
        distance = math.dist(a["ground_position_m"], b["ground_position_m"])
        moving_speeds.append(distance / dt)
        horizontal_distance = math.dist(xz(a["ground_position_m"]), xz(b["ground_position_m"]))
        if horizontal_distance > 1e-7:
            gradients.append(abs(b["ground_position_m"][1] - a["ground_position_m"][1]) / horizontal_distance)
    report = {"schema_version": 1, "id": "kabukicho-route-completion", "status": "complete" if obstacles_complete else "development-awaiting-period-obstacles",
        "historical_confidence": "inferred", "original_R01": {"sample_count": route["validation"]["samples"], "unclassified_count": len(original), "records": original},
        "adopted": {"unclassified_samples": len(unclassified), "continuous_unclassified_length_m": round(sum(g["horizontal_length_m"] for g in continuous_gaps), 9),
            "continuous_surface_gaps": continuous_gaps, "sample_count_including_stationary_pans": len(walk["samples"]),
            "sample_spacing_m_at_most": SPACING, "ground_distance_m": walk["ground_distance_m"], "duration_s": walk["duration_s"],
            "classification_method": "Road/plaza/connector polygon membership; split every segment at every surface edge and test every resulting interval, in addition to dense samples.",
            "paving_decision": "kabukicho-route-surfaces-1976", "terminal_station": walk["terminal_station"]},
        "collision_validation": {"body_radius_m": BODY_RADIUS, "body_height_m": BODY_HEIGHT, "continuous": True,
            "method": "Exact 2D segment-to-polygon edge distances for the union of swept body discs; model ground obstacles and buildings. Overhead objects are exempt only with explicit underside clearance >=2.2 m.",
            "buildings_checked": len(buildings), "prop_obstacles_checked": len(obstacles), "period_obstacles_complete": obstacles_complete,
            "building_clearance_m": round(minima["building"][0], 7), "nearest_building_id": minima["building"][1],
            "obstacle_clearance_m": round(minima["prop"][0], 7) if math.isfinite(minima["prop"][0]) else None,
            "nearest_prop_id": minima["prop"][1], "minimum_net_clearance_m": round(all_clearance - BODY_RADIUS, 7),
            "collisions": collisions, "overhead_passages": overhead},
        "ground_surface_validation": ground_validation,
        "motion_validation": {"maximum_sampled_angular_velocity_deg_s": round(max(angular_rates), 6),
            "maximum_sampled_speed_m_s": round(max(moving_speeds), 6),
            "maximum_ground_gradient_fraction": round(max(gradients), 6),
            "maximum_quaternion_aim_unit_vector_error": max(quaternion_aim_errors),
            "stationary_turns_have_eased_endpoints": True, "fixed_lens_mm_equivalent": 35,
            "scope": "Numerical camera samples and the specified interpolation plan; actual frame playback remains a separate visual check."},
        "limitations": ["Completion means every adopted route surface and modeled obstacle has a recorded decision; inferred historical facts remain inferred.",
            "This checks modeled static geometry, not live crowds, bicycles, vehicles or unrecorded historical obstacles.",
            "Modern DEM heights are adopted for ground construction; a 1976 terrain survey is unavailable.",
            "Camera motion samples and easing are a reproducible motion plan, not a rendered or visually approved movie."]}
    if continuous_gaps or unclassified or collisions:
        write_json(REPORT_PATH, report)
        raise ValueError("The adopted route retains a paving gap or a swept-body collision; inspect the report")
    write_json(DECISION_PATH, decision)
    write_json(WALK_PATH, walk, compact=True)
    write_json(REPORT_PATH, report)
    print(json.dumps({"original_gap_samples": len(original), "unclassified_samples": len(unclassified),
        "continuous_unclassified_length_m": report["adopted"]["continuous_unclassified_length_m"],
        "ground_distance_m": walk["ground_distance_m"], "duration_s": walk["duration_s"],
        "samples": len(walk["samples"]), "prop_obstacles_complete": obstacles_complete,
        "minimum_net_clearance_m": report["collision_validation"]["minimum_net_clearance_m"]}))


if __name__ == "__main__":
    main()
