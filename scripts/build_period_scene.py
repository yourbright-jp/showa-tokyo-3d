#!/usr/bin/env python3
"""Build the adopted 1976 layout, with explicit inference and complete source decisions.

This authoring pass does not certify historical truth. It replaces the open
production choices with recorded, reversible decisions and real shared meshes.
Only the Python standard library is required. Font outlines, if supplied by
render_period_scene.py, are appended as authored meshes rather than raster art.
"""
import array
import base64
import copy
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

from import_plateau import ROOT, SCENE, horizontal, load_terrain, normal, triangulate, write_json
from build_blockout import camera_rotation, contains, edge_distance, footprint, pixel_latlon

PERIOD_PATH = ROOT / "data/derived/kabukicho-period-features.json"
CLASS_PATH = ROOT / "data/derived/kabukicho-feature-classification.json"
SPEC_PATH = SCENE / "reconstruction/period-scene-spec.json"
MODEL_PATH = SCENE / "models/reconstruction-adopted.gltf"
GATE_PATH = ROOT / "data/decisions/kabukicho-gate-1976.json"
KOMA_PATH = ROOT / "data/decisions/kabukicho-koma-plaza-1976.json"
SURFACE_PATH = ROOT / "data/decisions/kabukicho-route-surfaces-1976.json"
MILANO_PATH = ROOT / "data/decisions/kabukicho-milano-1976.json"
CONTEXT_PATH = ROOT / "data/decisions/kabukicho-context-massing-1976.json"
TEXT_MESH_PATH = ROOT / "data/derived/kabukicho-sign-text-meshes.json"

PALETTE = {
    "asphalt": [0.22, .235, .25, 1], "paving": [.50, .515, .49, 1],
    "ground": [.37, .39, .37, 1], "concrete": [.69, .70, .66, 1],
    "context-gray": [.52, .55, .53, 1], "context-cream": [.65, .63, .56, 1],
    "context-brick": [.45, .31, .25, 1], "context-blue-gray": [.43, .51, .54, 1],
    "frame": [.15, .17, .18, 1], "glass": [.075, .14, .16, 1],
    "shop-glass": [.22, .24, .20, 1], "metal": [.36, .38, .37, 1],
    "canopy": [.39, .39, .34, 1], "awning-red": [.52, .13, .095, 1],
    "awning-blue": [.12, .27, .34, 1], "awning-green": [.16, .31, .23, 1],
    "sign-white": [.88, .87, .82, 1], "sign-red": [.61, .095, .055, 1],
    "letter-dark": [.08, .085, .08, 1], "gate-red": [.64, .13, .075, 1],
    "bulb": [1.0, .71, .32, 1], "water": [.11, .27, .29, 1],
    "fountain-stone": [.49, .50, .45, 1], "plaza-emblem": [.30, .31, .29, 1],
    "theatre-pale": [.69, .70, .66, 1], "tower-gray": [.53, .54, .49, 1],
}


def polygon_area_xz(ring):
    return abs(sum(a[0] * b[2] - b[0] * a[2] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def xz_distance_to_path(point, path):
    return min(edge_distance(point, [a, b]) for a, b in zip(path, path[1:]))


class Builder:
    def __init__(self, modern, layout, gate, koma, surfaces, milano, context):
        self.modern, self.layout = modern, layout
        self.milano, self.context = milano, context
        self.context_omitted = set(context["parameters"]["omitted_feature_ids"])
        self.low_kept = set()
        self.config = modern["config"]
        self.origin = self.config["origin_jgd2011"]
        self.terrain = load_terrain(self.config)
        self.hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text(encoding="utf-8"))
        self.space = self.hypothesis["pixel_space"]
        self.route = json.loads((SCENE / "cameras/route-proposal.json").read_text(encoding="utf-8"))
        self.path = self.route["geometry"]["coordinates"]
        self.gate, self.koma, self.surfaces = gate, koma, surfaces
        self.features, self.obstacles, self.text_nodes, self.classifications = [], [], [], []
        self.current_decision = "period-background-context-rule"
        self.current_evidence = ["gsi-gazo1-1974-1978"]
        self.source_map = {f["id"]: f for f in modern["features"]}
        self.generated_for_source = defaultdict(list)

    def xy(self, pixel):
        return horizontal(*pixel_latlon(pixel, self.space), self.origin)

    def ground(self, x, z):
        return self.terrain.height(x, z)

    def add(self, identifier, polygons, material, kind="fixture", name=None,
            source_feature_ids=None, **extras):
        polygons = [[[round(float(v), 5) for v in p] for p in ring] for ring in polygons if len(ring) >= 3]
        if not polygons:
            raise ValueError("Empty authored geometry " + identifier)
        feature = {"id": identifier, "name": name or identifier, "kind": kind,
            "material_key": material, "historical_status": "adopted-inferred",
            "historical_truth_status": "inferred", "decision_id": self.current_decision,
            "source_decision_id": self.current_decision, "evidence_ids": list(self.current_evidence),
            "source_ids": list(self.current_evidence), "source_feature_ids": source_feature_ids or [],
            "polygons": polygons, **extras}
        self.features.append(feature)
        for source_id in source_feature_ids or []:
            if identifier not in self.generated_for_source[source_id]:
                self.generated_for_source[source_id].append(identifier)
        return feature

    def obstacle(self, identifier, outline, height, min_height=0, role="ground", **extras):
        self.obstacles.append({"id": identifier, "footprint_xz": [[round(x, 5), round(z, 5)] for x, z in outline],
            "physical_height_m": height, "min_height_above_ground_m": min_height,
            "collision_role": role, "underside_clearance_m": min_height if role == "overhead" else None,
            "source_decision_id": self.current_decision, **extras})

    def box(self, identifier, center, dims, material, u=(1, 0), v=(0, 1), **extras):
        x, y, z = center
        w, h, depth = dims
        corners = [[x + sx * w / 2 * u[0] + sz * depth / 2 * v[0], y + sy * h / 2,
                    z + sx * w / 2 * u[1] + sz * depth / 2 * v[1]]
                   for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
        faces = [[corners[i] for i in ids] for ids in
                 [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]]
        # The corner frame can have either orientation; orient each face outwards.
        for face in faces:
            n = normal(face)
            mid = [sum(p[a] for p in face) / len(face) for a in range(3)]
            if sum(n[a] * (mid[a] - center[a]) for a in range(3)) < 0:
                face.reverse()
        return self.add(identifier, faces, material, **extras)

    def cylinder(self, identifier, center_xz, bottom_y, height, radius, material,
                 radius_z=None, segments=20, rotation_degrees=0, **extras):
        rx, rz = radius, radius_z or radius
        angle = math.radians(rotation_degrees)
        low = [[center_xz[0] + rx * math.cos(t * math.tau / segments) * math.cos(angle) - rz * math.sin(t * math.tau / segments) * math.sin(angle), bottom_y,
                center_xz[1] + rx * math.cos(t * math.tau / segments) * math.sin(angle) + rz * math.sin(t * math.tau / segments) * math.cos(angle)] for t in range(segments)]
        high = [[p[0], bottom_y + height, p[2]] for p in low]
        if normal(high)[1] < 0:
            low.reverse(); high.reverse()
        faces = [list(reversed(low)), high]
        faces.extend([[low[i], low[(i + 1) % segments], high[(i + 1) % segments], high[i]] for i in range(segments)])
        return self.add(identifier, faces, material, **extras)

    def sphere(self, identifier, center, radius, material, segments=10, rings=5):
        faces = []
        for row in range(rings):
            a, b = -math.pi / 2 + math.pi * row / rings, -math.pi / 2 + math.pi * (row + 1) / rings
            for col in range(segments):
                p, q = math.tau * col / segments, math.tau * (col + 1) / segments
                pts = [[center[0] + radius * math.cos(h) * math.cos(t), center[1] + radius * math.sin(h),
                        center[2] + radius * math.cos(h) * math.sin(t)] for h, t in [(a, p), (a, q), (b, q), (b, p)]]
                clean = []
                for point in pts:
                    if not clean or math.dist(point, clean[-1]) > 1e-8:
                        clean.append(point)
                if len(clean) > 2 and math.dist(clean[0], clean[-1]) < 1e-8:
                    clean.pop()
                if len(clean) > 2:
                    n = normal(clean)
                    midpoint = [sum(p[a] for p in clean) / len(clean) for a in range(3)]
                    if sum(n[a] * (midpoint[a] - center[a]) for a in range(3)) < 0:
                        clean.reverse()
                    faces.append(clean)
        return self.add(identifier, faces, material)

    def text(self, identifier, text, pos, baseline, height, material="letter-dark", **extras):
        self.text_nodes.append({"id": identifier, "text": text,
            "position_m": [round(p, 5) for p in pos], "baseline_direction_xz": list(baseline),
            "height_m": height, "extrude_m": .012, "material_key": material,
            "color_rgba": PALETTE[material], "align": "CENTER", "decision_id": self.current_decision,
            "evidence_ids": list(self.current_evidence), "historical_truth_status": "inferred", **extras})

    def build_ground(self):
        self.current_decision = "period-ground-adoption-rule"
        self.current_evidence = ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"]
        terrain_feature = next(f for f in self.modern["features"] if f["kind"] == "terrain")
        roads = [f for f in self.modern["features"] if f["kind"] == "road"]
        masks = []
        for road in roads:
            for ring in road["polygons"]:
                masks.append((min(p[0] for p in ring), max(p[0] for p in ring),
                              min(p[2] for p in ring), max(p[2] for p in ring), ring))
        plaza_ring = self.layout["plaza"]["boundary_m"]
        connector = []
        if self.surfaces:
            for surface in self.surfaces.get("connector_surfaces", self.surfaces.get("surfaces", self.surfaces.get("adopted_surfaces", []))):
                ring = surface.get("boundary_m", surface.get("polygon_m", []))
                if ring:
                    connector.append(ring)
                elif surface.get("boundary_pixels"):
                    connector.append([[*self.xy(p)[:1], 0, self.xy(p)[1]] for p in surface["boundary_pixels"]])
        polygons, materials = [], []
        for ring in terrain_feature["polygons"]:
            x = sum(p[0] for p in ring) / 3; z = sum(p[2] for p in ring) / 3
            on_road = any(a <= x <= b and c <= z <= d and contains([x, z], r) for a, b, c, d, r in masks)
            in_plaza = contains([x, z], plaza_ring) or any(contains([x, z], r) for r in connector)
            polygons.append(ring)
            materials.append("paving" if in_plaza else "asphalt" if on_road else "ground")
        source_ids = [f["id"] for f in self.modern["features"] if f["kind"] in {"road", "terrain"}]
        self.add("period-ground-surface", polygons, "ground", kind="terrain", source_feature_ids=source_ids,
            polygon_material_keys=materials, historical_truth_status="modern-reference",
            historical_status="adopted-modern-terrain-reference",
            processing="Source TIN preserved exactly; road/plaza surface colours are centroid-mask interpretations, not historical surveyed pavement boundaries.")

    def build_context(self):
        removed = set(self.hypothesis["replace_modern_feature_ids"]) | self.context_omitted
        palette = ["context-gray", "context-cream", "context-brick", "context-blue-gray"]
        rule = self.context["parameters"]
        low = rule["low_structure_exception"]
        for source in self.modern["features"]:
            if source["kind"] != "building" or source["id"] in removed:
                continue
            f = copy.deepcopy(source)
            ring = footprint(f)
            centroid = [sum(p[a] for p in ring) / len(ring) for a in (0, 2)]
            distance = xz_distance_to_path(centroid, self.path)
            near = distance < rule["near_route_radius_m"]
            base_y = min(p[1] for r in f["polygons"] for p in r)
            source_h = max(p[1] for r in f["polygons"] for p in r) - base_y
            cap = rule["near_height_cap_m"] if near else rule["far_height_cap_m"]
            storey = rule["storey_height_m"]
            height_processing = (f"Inferred period storey scale: {storey:g} m; minimum {rule['minimum_height_m']:g} m; near-route cap {rule['near_height_cap_m']:g} m, "
                                 f"other context cap {rule['far_height_cap_m']:g} m. Modern surveyed height is retained separately, not asserted for 1976.")
            if source_h < low["source_height_below_m"] and distance >= low["applies_at_route_distance_m_or_more"]:
                # r05 (kabukicho-context-massing-1976): low background structures keep the modern height.
                adopted_h = source_h
                self.low_kept.add(source["id"])
                height_processing = ("Low background structure: modern source height kept (r05 low-structure exception of "
                                     + self.context["id"] + "); not asserted for 1976.")
            else:
                adopted_h = min(cap, max(rule["minimum_height_m"], round(source_h / storey) * storey))
            seed = int(hashlib.sha256(source["id"].encode()).hexdigest()[:8], 16)
            colour = palette[seed % len(palette)]
            for polygon in f["polygons"]:
                for point in polygon:
                    point[1] = base_y + (point[1] - base_y) * adopted_h / max(source_h, .01)
            self.current_decision = "period-background-context-rule"
            self.current_evidence = ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"]
            extra = {k: v for k, v in f.items() if k not in {"polygons", "id", "name", "kind", "historical_status", "height_m"}}
            self.add(f["id"], f["polygons"], colour, kind="building", name=f.get("name") or "Inferred period context",
                source_feature_ids=[f["id"]], source_height_m=round(source_h, 4), height_m=round(adopted_h, 4),
                height_processing=height_processing,
                distance_to_route_m=round(distance, 3), periodization="massing-and-near-route-facade" if near else "conservative-background-massing", **extra)
            if near:
                self.context_facade(source, ring, adopted_h, seed)

    def context_facade(self, source, ring, height, seed):
        # Use the source face nearest the path, not arbitrary cardinal frontages.
        edges = [(a, b) for a, b in zip(ring, ring[1:] + ring[:1]) if math.hypot(a[0] - b[0], a[2] - b[2]) > 3]
        if not edges:
            return
        a, b = min(edges, key=lambda e: xz_distance_to_path([(e[0][0] + e[1][0]) / 2, (e[0][2] + e[1][2]) / 2], self.path))
        width = math.hypot(b[0] - a[0], b[2] - a[2])
        u = ((b[0] - a[0]) / width, (b[2] - a[2]) / width)
        midpoint = ((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)
        center = (sum(p[0] for p in ring) / len(ring), sum(p[2] for p in ring) / len(ring))
        out = (-u[1], u[0])
        if (midpoint[0] - center[0]) * out[0] + (midpoint[1] - center[1]) * out[1] < 0:
            out = (-out[0], -out[1])
        # Keep relief shallow so adopted passing space is not consumed by an
        # invented arcade. Doors/windows are recessed behind outer frames.
        base = min(p[1] for p in ring)
        batches = defaultdict(list)
        old_add = self.add
        def capture(identifier, polygons, material, **kwargs):
            batches[material].extend(polygons)
            return {"id": identifier}
        self.add = capture
        cols = max(1, min(8, int(width / 2.2)))
        floors = max(2, min(7, int(height / 3.2)))
        for floor in range(1, floors):
            for col in range(cols):
                t = (col + .5) / cols - .5
                x, z = midpoint[0] + u[0] * t * width, midpoint[1] + u[1] * t * width
                w = min(1.15, width / cols * .68); y = base + floor * 3.2 + 1.2
                if y + .7 > base + height:
                    continue
                self.box("frame", [x + out[0] * .035, y, z + out[1] * .035], [w + .14, 1.5, .10], "frame", u, out)
                self.box("glass", [x + out[0] * .095, y, z + out[1] * .095], [w, 1.36, .025], "glass", u, out)
                self.box("jamb", [x + out[0] * .12, y, z + out[1] * .12], [.045, 1.36, .035], "metal", u, out)
        self.box("shop", [midpoint[0] + out[0] * .035, base + 1.5, midpoint[1] + out[1] * .035], [width * .86, 2.7, .09], "frame", u, out)
        self.box("shopglass", [midpoint[0] + out[0] * .09, base + 1.5, midpoint[1] + out[1] * .09], [width * .82, 2.45, .03], "shop-glass", u, out)
        for col in range(cols + 1):
            off = (col / cols - .5) * width * .84
            self.box("shopmullion", [midpoint[0] + u[0] * off + out[0] * .13, base + 1.5, midpoint[1] + u[1] * off + out[1] * .13], [.065, 2.6, .05], "metal", u, out)
        awning = ["awning-red", "awning-blue", "awning-green"][seed % 3]
        self.box("awning", [midpoint[0] + out[0] * .35, base + 3.12, midpoint[1] + out[1] * .35], [width * .96, .14, .8], awning, u, out)
        self.box("sign", [midpoint[0] + out[0] * .12, base + 3.70, midpoint[1] + out[1] * .12], [min(width * .84, 7), .8, .12], "sign-white", u, out)
        self.add = old_add
        for material, polygons in batches.items():
            self.add(source["id"] + "-period-facade-" + material, polygons, material, kind="facade", source_feature_ids=[source["id"]],
                generic_frontage=True, tenancy_status="Generic era-compatible shop type; no historical tenant identity is asserted.")
        # Limit generic text to the camera corridor. All content is stable across
        # frames and deliberately avoids invented named businesses/programmes.
        if xz_distance_to_path(midpoint, self.path) < 19 and width > 3.5:
            words = ["喫茶", "食堂", "理容", "写真", "レコード", "麻雀"]
            baseline = u if out == (-u[1], u[0]) else (-u[0], -u[1])
            self.text(source["id"] + "-generic-shop-text", words[seed % len(words)],
                [midpoint[0] + out[0] * .19, base + 3.70, midpoint[1] + out[1] * .19], baseline, .55,
                inference_note="Generic shop-category lettering is authored; it does not identify the original premises.")

    def build_gate(self):
        self.current_decision = self.gate["id"]
        self.current_evidence = [e["id"] for e in self.gate["evidence"]]
        p = self.gate["parameters"]
        def from_hex(value):
            value = value.removeprefix("#")
            if len(value) != 6: raise ValueError("Gate colour must be an sRGB #RRGGBB value")
            return [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [1]
        PALETTE["gate-body"] = from_hex(p["body_color_srgb"])
        PALETTE["gate-plate"] = from_hex(p["plate_color_srgb"])
        PALETTE["gate-lettering"] = from_hex(p["letter_color_srgb"])
        anchor = p["anchor_local_m"]
        forward, right = p["forward_xz"], p["right_xz"]
        center_u = p["center_u_m"]
        def world(u, v, h):
            x = anchor[0] + right[0] * u + forward[0] * v
            z = anchor[2] + right[1] * u + forward[1] * v
            return [x, anchor[1] + h, z]
        for i, u in enumerate(p["post_center_u_m"]):
            x, _, z = world(u, 0, 0); ground = self.ground(x, z)
            self.cylinder(f"ichibangai-gate-post-{i}", [x, z], ground, p["post_height_m"], p["post_radius_m"], "gate-body")
            self.cylinder(f"ichibangai-gate-foot-{i}", [x, z], ground, p["post_base_height_m"], p["post_base_radius_m"], "metal")
            outline = [[x + p["post_base_radius_m"] * math.cos(t * math.tau / 20), z + p["post_base_radius_m"] * math.sin(t * math.tau / 20)] for t in range(20)]
            self.obstacle(f"ichibangai-gate-post-{i}", outline, p["post_height_m"])
        # A closed, extruded ellipse band; the interior is an actual hole.
        ring_polygons = []
        for i in range(64):
            lo, hi = math.tau * i / 64, math.tau * (i + 1) / 64
            outer = [(p["oval_width_m"] / 2, p["oval_height_m"] / 2),
                     (p["oval_width_m"] / 2 - p["oval_ring_thickness_m"], p["oval_height_m"] / 2 - p["oval_ring_thickness_m"])]
            for depth in (-p["body_depth_m"] / 2, p["body_depth_m"] / 2):
                face = [world(center_u + rx * math.cos(t), depth, p["oval_center_height_m"] + ry * math.sin(t))
                        for rx, ry, t in [(outer[0][0], outer[0][1], lo), (outer[0][0], outer[0][1], hi),
                                          (outer[1][0], outer[1][1], hi), (outer[1][0], outer[1][1], lo)]]
                if depth > 0: face.reverse()
                ring_polygons.append(face)
            for side, (rx, ry) in enumerate(outer):
                face = [world(center_u + rx * math.cos(t), d, p["oval_center_height_m"] + ry * math.sin(t))
                        for t, d in [(lo, -p["body_depth_m"] / 2), (hi, -p["body_depth_m"] / 2),
                                     (hi, p["body_depth_m"] / 2), (lo, p["body_depth_m"] / 2)]]
                if side == 0: face.reverse()
                ring_polygons.append(face)
        self.add("ichibangai-curved-gate-ring", ring_polygons, "gate-body")
        self.box("ichibangai-gate-nameplate", world(center_u, 0, p["oval_center_height_m"]),
                 [p["central_plate_width_m"], p["central_plate_height_m"], p["central_plate_depth_m"]], "gate-plate", right, forward)
        self.text("ichibangai-gate-name-front", p["sign_text"], world(center_u, -p["central_plate_depth_m"] / 2 - .018, p["oval_center_height_m"]),
                  right, .63, "gate-lettering")
        self.text("ichibangai-gate-name-rear", p["reverse_text"], world(center_u, p["central_plate_depth_m"] / 2 + .018, p["oval_center_height_m"]),
                  [-right[0], -right[1]], .63, "gate-lettering", inference_note=p["reverse_text_status"])
        tails = []
        tube_radius = p["tail_section_radius_m"]
        def outward_face(face, center):
            n = normal(face)
            midpoint = [sum(point[k] for point in face) / len(face) for k in range(3)]
            if sum(n[k] * (midpoint[k] - center[k]) for k in range(3)) < 0:
                face.reverse()
            return face
        # Circular tube sections follow the adopted centreline. Spherical
        # elbows/endcaps use the street u/v frame, so exact +/-u and top poles
        # preserve the declared 10.64 m outer span and 7.80 m tip height.
        for sign in (-1, 1):
            pts = p["tail_points_right_relative_uh_m"]
            for a, b in zip(pts, pts[1:]):
                du, dh = sign * (b[0] - a[0]), b[1] - a[1]
                length = math.hypot(du, dh)
                tangent_normal_u, tangent_normal_h = dh / length, -du / length
                rings = []
                for q in (a, b):
                    ring = []
                    for j in range(16):
                        theta = math.tau * j / 16
                        local_u = tube_radius * math.cos(theta) * tangent_normal_u
                        local_h = tube_radius * math.cos(theta) * tangent_normal_h
                        local_v = tube_radius * math.sin(theta)
                        ring.append(world(center_u + sign * q[0] + local_u, local_v, q[1] + local_h))
                    rings.append(ring)
                center = world(center_u + sign * (a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2)
                for j in range(16):
                    k = (j + 1) % 16
                    tails.append(outward_face([rings[0][j], rings[0][k], rings[1][k], rings[1][j]], center))
                tails.append(outward_face(rings[0], center))
                tails.append(outward_face(rings[1], center))
            for q in pts:
                center = world(center_u + sign * q[0], 0, q[1])
                for row in range(8):
                    low = -math.pi / 2 + math.pi * row / 8
                    high = -math.pi / 2 + math.pi * (row + 1) / 8
                    for col in range(16):
                        lo, hi = math.tau * col / 16, math.tau * (col + 1) / 16
                        face = [world(center_u + sign * q[0] + tube_radius * math.cos(phi) * math.cos(theta),
                                      tube_radius * math.cos(phi) * math.sin(theta),
                                      q[1] + tube_radius * math.sin(phi))
                                for phi, theta in [(low, lo), (low, hi), (high, hi), (high, lo)]]
                        clean = []
                        for point in face:
                            if not clean or math.dist(point, clean[-1]) > 1e-8: clean.append(point)
                        if len(clean) > 2 and math.dist(clean[0], clean[-1]) < 1e-8: clean.pop()
                        if len(clean) >= 3: tails.append(outward_face(clean, center))
        self.add("ichibangai-gate-upturned-tails", tails, "gate-body", tube_radius_m=tube_radius,
                 geometry_method="circular segment tubes with spherical street-frame joints/endcaps")
        # Bulbs use compact octahedra (not luminous modern LED strips).
        bulbs = []
        radius = p["bulb_diameter_m"] / 2
        for row in range(p["bulb_rows"]):
            rx = p["oval_width_m"] / 2 - .035 - row * .065
            ry = p["oval_height_m"] / 2 - .035 - row * .065
            for i in range(p["bulbs_per_oval_row"]):
                t = math.tau * i / p["bulbs_per_oval_row"]
                c = world(center_u + rx * math.cos(t), -p["body_depth_m"] / 2 - .045, p["oval_center_height_m"] + ry * math.sin(t))
                vertices = [[c[0] + radius, c[1], c[2]], [c[0] - radius, c[1], c[2]],
                            [c[0], c[1] + radius, c[2]], [c[0], c[1] - radius, c[2]],
                            [c[0], c[1], c[2] + radius], [c[0], c[1], c[2] - radius]]
                bulbs.extend([[vertices[j] for j in ids] for ids in [(0, 2, 4), (4, 2, 1), (1, 2, 5), (5, 2, 0),
                                                                    (4, 3, 0), (1, 3, 4), (5, 3, 1), (0, 3, 5)]])
        # Tail bulbs use the adopted per-side count, spaced along the actual
        # polyline arc rather than grouped at control points.
        tail_points = p["tail_points_right_relative_uh_m"]
        lengths = [math.dist(a, b) for a, b in zip(tail_points, tail_points[1:])]
        for sign in (-1, 1):
            for i in range(p["tail_bulbs_per_side"]):
                distance = sum(lengths) * (i + .5) / p["tail_bulbs_per_side"]
                for a, b, length in zip(tail_points, tail_points[1:], lengths):
                    if distance <= length + 1e-9:
                        t = distance / length
                        u = a[0] + (b[0] - a[0]) * t
                        h = a[1] + (b[1] - a[1]) * t
                        break
                    distance -= length
                c = world(center_u + sign * u, -p["tail_section_radius_m"] - radius, h)
                vertices = [[c[0] + radius, c[1], c[2]], [c[0] - radius, c[1], c[2]],
                            [c[0], c[1] + radius, c[2]], [c[0], c[1] - radius, c[2]],
                            [c[0], c[1], c[2] + radius], [c[0], c[1], c[2] - radius]]
                bulbs.extend([[vertices[j] for j in ids] for ids in [(0, 2, 4), (4, 2, 1), (1, 2, 5), (5, 2, 0),
                                                                    (4, 3, 0), (1, 3, 4), (5, 3, 1), (0, 3, 5)]])
        self.add("ichibangai-incandescent-bulbs", bulbs, "bulb",
                 bulb_count=p["bulb_rows"] * p["bulbs_per_oval_row"] + 2 * p["tail_bulbs_per_side"],
                 oval_bulb_count=p["bulb_rows"] * p["bulbs_per_oval_row"], tail_bulb_count=2 * p["tail_bulbs_per_side"])
        outline = [[*world(u, v, 0)[::2]] for u, v in [(p["post_center_u_m"][0], -.3), (p["post_center_u_m"][1], -.3),
                                                              (p["post_center_u_m"][1], .3), (p["post_center_u_m"][0], .3)]]
        self.obstacle("ichibangai-gate-overhead", outline, p["overall_height_m"] - p["minimum_clearance_m"],
                      min_height=p["minimum_clearance_m"], role="overhead")

    def extrude(self, identifier, outline, base, height, material, **extras):
        low = [[p[0], base, p[1]] for p in outline]
        top = [[p[0], base + height, p[1]] for p in outline]
        if normal(top)[1] < 0:
            low.reverse(); top.reverse()
        faces = [list(reversed(low)), top]
        faces.extend([[low[i], low[(i + 1) % len(low)], top[(i + 1) % len(low)], top[i]] for i in range(len(low))])
        return self.add(identifier, faces, material, kind="building", footprint_xz=outline, **extras)

    def clipped_mass_outline(self, outline, origin, u, inward, setback, min_u=None, max_u=None):
        def clip(points, direction, bound, keep_greater):
            out = []
            def value(p): return (p[0] - origin[0]) * direction[0] + (p[1] - origin[1]) * direction[1] - bound
            for a, b in zip(points, points[1:] + points[:1]):
                va, vb = value(a), value(b)
                ina, inb = (va >= -1e-8, vb >= -1e-8) if keep_greater else (va <= 1e-8, vb <= 1e-8)
                if ina: out.append(a)
                if ina != inb:
                    t = va / (va - vb)
                    out.append([a[i] + (b[i] - a[i]) * t for i in range(2)])
            return out
        points = clip(outline, inward, setback, True)
        if min_u is not None: points = clip(points, u, min_u, True)
        if max_u is not None: points = clip(points, u, max_u, False)
        if len(points) < 3: raise ValueError("Adopted tower setback leaves no footprint")
        return points

    def facade(self, proxy, edge_pixels, parameters, label, tower=False, span_fraction=(0.0, 1.0)):
        a, b = [self.xy(p) for p in edge_pixels]
        edge_width = math.dist(a, b)
        u = ((b[0] - a[0]) / edge_width, (b[1] - a[1]) / edge_width)
        # A public front may occupy only part of the traced roof edge (fractions from the first pixel);
        # the direction stays that of the whole traced edge.
        if tuple(span_fraction) != (0.0, 1.0):
            a, b = [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in span_fraction]
        width = math.dist(a, b)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        footprint_ring = footprint(proxy)
        center = [sum(p[k] for p in footprint_ring) / len(footprint_ring) for k in (0, 2)]
        out = (-u[1], u[0])
        if (mid[0] - center[0]) * out[0] + (mid[1] - center[1]) * out[1] < 0:
            out = (-out[0], -out[1])
        base = min(p[1] for r in proxy["polygons"] for p in r)
        def at(t, offset, y):
            return [mid[0] + (t - .5) * width * u[0] + out[0] * offset, base + y,
                    mid[1] + (t - .5) * width * u[1] + out[1] * offset]
        identifier = proxy["id"].replace("-roof-proxy", "")
        wall_material = identifier + "-wall" if parameters.get("wall_base_color_rgb") else "theatre-pale"
        metal_material = identifier + "-metal" if parameters.get("metal_base_color_rgb") else "metal"
        glass_material = identifier + "-glass" if parameters.get("glazing_base_color_rgb") else "glass"
        for key, parameter in [(wall_material, "wall_base_color_rgb"), (metal_material, "metal_base_color_rgb"), (glass_material, "glazing_base_color_rgb")]:
            if parameter in parameters: PALETTE[key] = list(parameters[parameter]) + [1]
        lower_height = parameters.get("lower_front_height_m", 10)
        canopy_depth = parameters.get("canopy_depth_m", 1.5)
        canopy_clearance = parameters.get("canopy_height_m", 3.1)
        canopy_thickness = parameters.get("canopy_thickness_m", .22)
        self.box(identifier + "-front-wall", at(.5, .07, lower_height / 2), [width, lower_height, .18], wall_material, u, out, kind="facade")
        entry_h = parameters.get("entrance_height_m", 2.6)
        step_h = parameters.get("entry_steps_total_height_m", parameters.get("threshold_steps_total_height_m", .3))
        span = parameters.get("entrance_span_fraction", [.15, .85])
        bays = parameters.get("entrance_bays", 3 if tower else 7)
        entry_y = step_h + entry_h / 2
        self.box(identifier + "-entrance-dark-recess", at(.5, .18, entry_y), [width * (span[1] - span[0]), entry_h + .1, .10], metal_material, u, out, kind="facade")
        for i in range(bays):
            t = span[0] + (span[1] - span[0]) * (i + .5) / bays
            door_w = parameters.get("entrance_bay_width_m", 1.8)
            self.box(identifier + f"-door-{i}", at(t, .245, entry_y), [door_w, entry_h, .045], glass_material, u, out, kind="facade")
            self.box(identifier + f"-door-mullion-{i}", at(t, .285, entry_y), [.065, entry_h, .045], metal_material, u, out, kind="facade")
        self.box(identifier + "-canopy", at(.5, canopy_depth / 2 + .12, canopy_clearance + canopy_thickness / 2), [width * .96, canopy_thickness, canopy_depth], metal_material, u, out, kind="facade")
        corners = [[at(t, d, 0)[0], at(t, d, 0)[2]] for t, d in [(0, .1), (1, .1), (1, canopy_depth + .12), (0, canopy_depth + .12)]]
        self.obstacle(identifier + "-canopy", corners, canopy_thickness, min_height=canopy_clearance, role="overhead")
        rows = parameters.get("upper_window_rows_m", [])
        cols = parameters.get("upper_window_columns", 9)
        for row, y in enumerate(rows):
            for col in range(cols):
                self.box(identifier + f"-upper-window-{row}-{col}", at((col + .5) / cols, .20, y),
                         [parameters.get("upper_window_width_m", .75), parameters.get("upper_window_height_m", 1.0), .06], glass_material, u, out, kind="facade")
        baseline = u if out == (-u[1], u[0]) else (-u[0], -u[1])
        signs = parameters.get("signs", [{"text": label, "fraction": .5, "height_m": 5.5}])
        mounting = parameters.get("sign_mounting")
        for i, sign in enumerate(signs):
            glyph_h = .85 if len(sign["text"]) < 7 else .72
            offset = .27
            if mounting and sign["text"] in mounting["applies_to"]:
                if mounting["mode"] != "freestanding-letters-on-canopy-top":
                    raise ValueError("Unhandled adopted sign mounting: " + mounting["mode"])
                # Letters stand on the canopy slab: face set back from its outer edge, bottom on a support rail.
                offset = canopy_depth + .12 - mounting["face_setback_from_canopy_outer_edge_m"]
                rail_top = canopy_clearance + canopy_thickness + mounting["support_rail_height_m"]
                if sign["height_m"] - glyph_h / 2 < rail_top - 1e-6:
                    raise ValueError(f"Canopy-mounted sign {sign['text']} must sit on its rail ({rail_top:.3f} m)")
            self.text(identifier + f"-name-{i}", sign["text"], at(sign["fraction"], offset, sign["height_m"]), baseline,
                      glyph_h, "letter-dark")
        self.text(identifier + "-entrance-label", "入口", at(.5, .32, canopy_clearance - .50), baseline, .30, "sign-white")
        # Physical threshold / central staircase, not a painted decal.
        steps_n = parameters.get("entry_steps_count", parameters.get("threshold_step_count", 2))
        steps_w = parameters.get("entry_steps_width_m", width * (span[1] - span[0]))
        steps_depth = parameters.get("entry_steps_outward_depth_m", parameters.get("threshold_steps_outward_depth_m", 1.6))
        for j in range(steps_n):
            h = step_h * (j + 1) / steps_n
            depth = steps_depth * (steps_n - j) / steps_n
            self.box(identifier + f"-entry-step-{j}", at(.5, depth / 2 + .22, h / 2), [steps_w, h, depth], "concrete", u, out)
        step_corners = [[at(.5 + offset / width, d, 0)[0], at(.5 + offset / width, d, 0)[2]]
                        for offset, d in [(-steps_w / 2, .22), (steps_w / 2, .22),
                                          (steps_w / 2, steps_depth + .22), (-steps_w / 2, steps_depth + .22)]]
        self.obstacle(identifier + "-entry-steps", step_corners, step_h)
        if tower:
            top_h = proxy["height_m"]
            setback = parameters["tower_rear_setback_m"]
            fraction = parameters["tower_frontage_fraction"]
            for row in range(parameters["tower_window_rows"]):
                y = lower_height + (row + .5) * (top_h - lower_height) / parameters["tower_window_rows"]
                for col in range(parameters["tower_window_columns"]):
                    t = .5 + ((col + .5) / parameters["tower_window_columns"] - .5) * fraction
                    self.box(identifier + f"-tower-window-{row}-{col}", at(t, -setback + .13, y), [1.15, 1.7, .06], glass_material, u, out, kind="facade")
            for i in range(parameters.get("emblem_rings", 3)):
                radius = parameters.get("emblem_radius_m", 1.5) - i * .35
                faces = []
                for j in range(48):
                    lo, hi = j * math.tau / 48, (j + 1) * math.tau / 48
                    pts = []
                    for r, t in [(radius, lo), (radius, hi), (radius - .11, hi), (radius - .11, lo)]:
                        c = at(.78, .27 + .012 * i, parameters.get("emblem_center_height_m", 5.8))
                        pts.append([c[0] + baseline[0] * r * math.cos(t), c[1] + r * math.sin(t), c[2] + baseline[1] * r * math.cos(t)])
                    faces.append(pts)
                self.add(identifier + f"-round-emblem-{i}", faces, "plaza-emblem", kind="facade")
        record = {"id": proxy["id"], "frontage_edge_pixels": edge_pixels, "frontage_width_m": round(width, 3),
                  "outward_direction_xz": list(out), "baseline_direction_xz": list(baseline), "base_y_m": base,
                  "adopted_parameters": parameters}
        if tuple(span_fraction) != (0.0, 1.0):
            record.update({"edge_width_m": round(edge_width, 3), "public_frontage_span_fraction": list(span_fraction),
                           "public_frontage_endpoints_xz": [[round(a[0], 5), round(a[1], 5)], [round(b[0], 5), round(b[1], 5)]]})
        return record

    def build_theatres(self):
        self.current_decision = self.koma["id"]
        self.current_evidence = [e["id"] for e in self.koma["evidence"]]
        adopted = {b["proxy_id"]: b for b in self.koma["buildings"]}
        proxy_sources = {"milano-roof-proxy": "bldg_159ebc0b-e5cd-4de8-a027-e924ee337964",
                         "koma-south-roof-proxy": "bldg_7506fc9f-1045-4cdc-9f35-9de5a01de82d",
                         "adjacent-theatre-roof-proxy": "bldg_7506fc9f-1045-4cdc-9f35-9de5a01de82d"}
        records = []
        for source in self.layout["features"]:
            if source.get("historical_status") != "inferred-roof-proxy": continue
            f = copy.deepcopy(source)
            source_id = proxy_sources[f["id"]]
            if f["id"] not in adopted:
                milano = self.milano["building"]
                if f["id"] != milano["proxy_id"] or f["height_m"] != milano["height_assumption_m"]:
                    raise ValueError("Milano decision does not match the layout proxy " + f["id"])
                self.current_decision = self.milano["id"]
                self.current_evidence = [e["id"] for e in self.milano["evidence"]]
                self.add(f["id"], f["polygons"], "theatre-pale", kind="building", name="ミラノ座・採用復元",
                         source_feature_ids=[source_id], height_m=f["height_m"], adopted_identity=milano["adopted_identity"])
                records.append(self.facade(f, milano["frontage_edge_pixels"], milano["parameters"], milano["adopted_identity"],
                                           span_fraction=tuple(milano["public_frontage_span_fraction"])))
                continue
            self.current_decision = self.koma["id"]
            self.current_evidence = [e["id"] for e in self.koma["evidence"]]
            decision = adopted[f["id"]]; params = decision["parameters"]
            a, b = [self.xy(p) for p in decision["frontage_edge_pixels"]]
            width = math.dist(a, b); u = ((b[0] - a[0]) / width, (b[1] - a[1]) / width)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            ring = footprint(f); outline = [[p[0], p[2]] for p in ring]
            centroid = [sum(p[i] for p in outline) / len(outline) for i in (0, 1)]
            inward = (-u[1], u[0])
            if (centroid[0] - mid[0]) * inward[0] + (centroid[1] - mid[1]) * inward[1] < 0:
                inward = (-inward[0], -inward[1])
            base = min(p[1] for r in f["polygons"] for p in r)
            low_h = params["lower_front_height_m"]
            mass_wall_key = f["id"].replace("-roof-proxy", "") + "-wall" if params.get("wall_base_color_rgb") else "theatre-pale"
            if params.get("wall_base_color_rgb"): PALETTE[mass_wall_key] = list(params["wall_base_color_rgb"]) + [1]
            self.extrude(f["id"] + "-lower-front-mass", outline, base, low_h, mass_wall_key,
                         source_feature_ids=[source_id], name=decision["adopted_identity"] + "・低層部", height_m=low_h,
                         adopted_identity=decision["adopted_identity"])
            tower = f["id"] == "adjacent-theatre-roof-proxy"
            setback = params.get("tower_rear_setback_m", params.get("lower_front_depth_m", 5))
            fraction = params.get("tower_frontage_fraction", 1)
            upper = self.clipped_mass_outline(outline, mid, u, inward, setback,
                -width * fraction / 2 if tower else None, width * fraction / 2 if tower else None)
            self.extrude(f["id"], upper, base + low_h, decision["height_assumption_m"] - low_h,
                         mass_wall_key, source_feature_ids=[source_id],
                         name=decision["adopted_identity"] + "・後退した上部", height_m=decision["height_assumption_m"],
                         adopted_identity=decision["adopted_identity"], lower_front_height_m=low_h, setback_m=setback,
                         total_height_status="adopted assumption, not measured historical height")
            records.append(self.facade(f, decision["frontage_edge_pixels"], params, decision["adopted_identity"], tower=tower))
        return records

    def build_plaza_props(self):
        self.current_decision = self.koma["id"]
        self.current_evidence = [e["id"] for e in self.koma["evidence"]]
        for prop in self.koma.get("plaza_props", []):
            identifier, kind = prop["id"], prop["type"]
            x, z = self.xy(prop["center_pixel"]); base = self.ground(x, z)
            if kind == "elliptical-fountain":
                rx, rz = prop["radius_east_west_m"], prop["radius_north_south_m"]
                angle = math.radians(prop["rotation_deg_clockwise_from_north"])
                def oval(r_x, r_z, y):
                    return [[x + r_x * math.cos(t * math.tau / 48) * math.cos(angle) - r_z * math.sin(t * math.tau / 48) * math.sin(angle), y,
                             z + r_x * math.cos(t * math.tau / 48) * math.sin(angle) + r_z * math.sin(t * math.tau / 48) * math.cos(angle)] for t in range(48)]
                footprint_points = oval(rx, rz, base)
                foundation = min(self.ground(p[0], p[2]) for p in footprint_points) - .03
                outer_bottom = oval(rx, rz, foundation)
                outer_top = oval(rx, rz, base + prop["rim_height_m"])
                inner_bottom = oval(rx - prop["rim_width_m"], rz - prop["rim_width_m"], foundation)
                inner_top = oval(rx - prop["rim_width_m"], rz - prop["rim_width_m"], base + prop["rim_height_m"])
                faces = []
                for i in range(48):
                    j = (i + 1) % 48
                    faces.extend([[outer_bottom[i], outer_bottom[j], outer_top[j], outer_top[i]],
                                  [inner_bottom[j], inner_bottom[i], inner_top[i], inner_top[j]],
                                  [outer_top[i], outer_top[j], inner_top[j], inner_top[i]],
                                  [outer_bottom[j], outer_bottom[i], inner_bottom[i], inner_bottom[j]]])
                faces = [list(reversed(face)) for face in faces]
                self.add(identifier + "-rim", faces, "fountain-stone", adopted_parameters=prop, foundation_note="Foundation extends to the lowest sampled rim ground minus 0.03 m; rim top remains at the adopted centre-ground elevation plus 0.55 m, avoiding a floating basin on the modern slope.")
                self.cylinder(identifier + "-floor", [x, z], foundation, base + .10 - foundation, rx - prop["rim_width_m"], "fountain-stone",
                              radius_z=rz - prop["rim_width_m"], segments=48, rotation_degrees=prop["rotation_deg_clockwise_from_north"])
                water = oval(rx - prop["rim_width_m"], rz - prop["rim_width_m"], base + prop["water_height_above_ground_m"])
                if normal(water)[1] < 0: water.reverse()
                self.add(identifier + "-water", [water], "water")
                self.cylinder(identifier + "-jet-base", [x, z], base + prop["water_height_above_ground_m"], .20, .24, "metal", segments=12)
                self.cylinder(identifier + "-water-jet", [x, z], base + prop["water_height_above_ground_m"] + .20,
                              prop["central_jet_height_m"], .028, "water", segments=8)
                self.obstacle(identifier, [[p[0], p[2]] for p in outer_bottom], prop["rim_height_m"] + prop["central_jet_height_m"],
                              adopted_parameters=prop, uncertainty_note="Adopted approximate fountain location/shape, not a surveyed historical obstacle.")
            elif kind == "multi-globe-streetlamp":
                h = prop["height_m"]; base_r = prop["base_radius_m"]
                self.cylinder(identifier + "-base", [x, z], base, .28, base_r, "metal")
                self.cylinder(identifier + "-pole", [x, z], base, h - .35, prop["post_radius_m"], "metal", segments=12)
                ring_count = prop["globe_count"] - 1
                for i in range(ring_count):
                    theta = math.tau * i / ring_count
                    dx, dz = prop["crown_radius_m"] * math.cos(theta), prop["crown_radius_m"] * math.sin(theta)
                    self.sphere(identifier + f"-globe-{i}", [x + dx, base + h - .33, z + dz], prop["globe_radius_m"], "sign-white")
                    self.box(identifier + f"-crown-arm-{i}", [x + dx / 2, base + h - .4, z + dz / 2],
                             [prop["crown_radius_m"], .045, .045], "metal", (math.cos(theta), math.sin(theta)), (-math.sin(theta), math.cos(theta)))
                self.sphere(identifier + "-upper-globe", [x, base + h, z], prop["globe_radius_m"], "sign-white")
                outline = [[x + base_r * math.cos(t * math.tau / 20), z + base_r * math.sin(t * math.tau / 20)] for t in range(20)]
                self.obstacle(identifier, outline, h + prop["globe_radius_m"], adopted_parameters=prop)
                crown_r = prop["crown_radius_m"] + prop["globe_radius_m"]
                crown = [[x + crown_r * math.cos(t * math.tau / 20), z + crown_r * math.sin(t * math.tau / 20)] for t in range(20)]
                self.obstacle(identifier + "-crown-overhead", crown, .7, min_height=h - .33 - prop["globe_radius_m"], role="overhead")
            else:
                raise ValueError("Unhandled adopted plaza fixture type: " + kind)

    def finish_classification(self):
        removed = set(self.hypothesis["replace_modern_feature_ids"])
        replacements = {"bldg_159ebc0b-e5cd-4de8-a027-e924ee337964", "bldg_7506fc9f-1045-4cdc-9f35-9de5a01de82d"}
        for f in self.modern["features"]:
            if f["kind"] == "building":
                disposition = ("replaced" if f["id"] in replacements else "omitted" if f["id"] in removed | self.context_omitted
                               else "inferred-period-context")
                if f["id"] == "bldg_159ebc0b-e5cd-4de8-a027-e924ee337964":
                    decision = self.milano["id"]
                    evidence = [e["id"] for e in self.milano["evidence"]]
                elif f["id"] in self.context_omitted:
                    decision = self.context["id"]
                    evidence = ["gsi-gazo1-1974-1978"]
                elif disposition == "omitted":
                    decision = "period-site-omission-rule"
                    evidence = ["gsi-gazo1-1974-1978", "shinjuku-plaza-1975"]
                else:
                    decision = self.koma["id"] if f["id"] in removed else "period-background-context-rule"
                    evidence = ["gsi-gazo1-1974-1978", "shinjuku-plaza-1975"] if f["id"] in removed else ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"]
                reason = ("Replaced by adopted historical theatre masses and authored period facade details."
                          if disposition == "replaced" else "Omitted from adopted period space: the 1974-1978 aerial shows the light street in front of the Toho Kaikan and no separate roof here; absence on the mosaic is not proof of absence (r05, kabukicho-context-massing-1976). Baseline retains the modern feature."
                          if f["id"] in self.context_omitted else "Omitted from adopted period space because aerial/near-year plaza evidence supports paving here; baseline retains the modern feature."
                          if disposition == "omitted" else "Explicit inferred background: modern footprint used as spatial scaffold; a low background structure keeps its modern height (r05 low-structure exception) and gets no authored facade. This is not a claim of historical survival or use."
                          if f["id"] in self.low_kept else "Explicit inferred background: modern footprint used as spatial scaffold; source height is transformed to capped period storey massing and near-route facades are authored. This is not a claim of historical survival or tenant identification.")
                truth = "inferred"
            else:
                disposition = "adopted-road-alignment-reference" if f["kind"] == "road" else "adopted-terrain-reference"
                decision = "period-ground-adoption-rule"
                evidence = ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"]
                reason = "Retained modern horizontal road reference / source terrain in the shared TIN surface; its 1976 pavement appearance and ground continuity are explicitly adopted approximations."
                truth = "modern-reference"
            self.classifications.append({"source_feature_id": f["id"], "kind": f["kind"], "disposition": disposition,
                "historical_truth_status": truth, "decision_id": decision, "evidence_ids": evidence,
                "reason": reason, "source_survey_year": f.get("source_survey_year"),
                "generated_feature_ids": self.generated_for_source.get(f["id"], [])})
        counts = Counter(f["disposition"] for f in self.classifications)
        return {"schema_version": 1, "id": "kabukicho-feature-classification", "status": "complete-adopted-with-inference",
            "target_year": 1976, "source_feature_count": len(self.modern["features"]),
            "classified_count": len(self.classifications), "unclassified_count": 0,
            "counts_by_disposition": dict(counts), "historical_certification": False,
            "completion_scope": "Every imported source feature has an explicit production disposition. Inferred period context does not assert historical survival.",
            "features": self.classifications}


def export_period_gltf(data, path):
    binary = bytearray(); doc = {"asset": {"version": "2.0", "generator": "showa-tokyo-3d build_period_scene.py",
        "copyright": "東京都・新宿区3D都市モデル（Project PLATEAU）2025年度を加工 / CC BY 4.0; 国土地理院 gazo1 1974–1978航空写真の解釈を含む; historical photo references are evidence only and not redistributed; authored reconstruction by yourbright-jp."},
        "scene": 0, "scenes": [{"name": "Adopted circa 1976 Kabukicho reconstruction with explicit inference", "nodes": []}],
        "nodes": [], "meshes": [], "bufferViews": [], "accessors": [], "materials": [], "cameras": [],
        "extras": {"id": "kabukicho-reconstruction-adopted", "historical_confidence": "inferred",
                   "target_year": 1976, "decision_complete": True, "source_origin": data["config"]["origin_jgd2011"],
                   "decision_sources": data["decisions"], "text_nodes": data["text_nodes"],
                   "font_meshes_included": data["generation"]["font_meshes_included"]}}
    palette = dict(PALETTE)
    for f in data["features"]:
        if f.get("material_rgba"):
            palette[f["material_key"]] = f["material_rgba"]
    material_map = {}
    def linear(channel):
        return channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4
    for key, color in palette.items():
        color = [linear(c) for c in color[:3]] + color[3:]
        material_map[key] = len(doc["materials"])
        material = {"name": key, "doubleSided": False, "pbrMetallicRoughness": {"baseColorFactor": color,
            "metallicFactor": .5 if key == "metal" or key.endswith("-metal") else .05 if key == "frame" else 0,
            "roughnessFactor": .25 if key in {"glass", "shop-glass", "water"} or key.endswith("-glass") else .78}}
        if key == "bulb":
            material["emissiveFactor"] = [1, .44, .08]
        doc["materials"].append(material)

    def attribute(values):
        offset = len(binary)
        packed = array.array("f", (v for point in values for v in point))
        if sys.byteorder != "little": packed.byteswap()
        binary.extend(packed.tobytes())
        view = len(doc["bufferViews"]); accessor = len(doc["accessors"])
        doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(packed) * 4, "target": 34962})
        doc["accessors"].append({"bufferView": view, "componentType": 5126, "count": len(values), "type": "VEC3",
            "min": [min(p[a] for p in values) for a in range(3)], "max": [max(p[a] for p in values) for a in range(3)]})
        return accessor
    triangles = 0
    for feature in data["features"]:
        batches = defaultdict(lambda: ([], []))
        materials = feature.get("polygon_material_keys")
        for i, ring in enumerate(feature["polygons"]):
            key = materials[i] if materials else feature["material_key"]
            vertices, normals = batches[key]
            n = normal(ring)
            for ids in triangulate(ring):
                vertices.extend(ring[j] for j in ids); normals.extend([n] * 3)
        primitives = []
        for key, (vertices, normals) in batches.items():
            if not vertices: continue
            primitives.append({"attributes": {"POSITION": attribute(vertices), "NORMAL": attribute(normals)},
                "material": material_map[key], "mode": 4})
            triangles += len(vertices) // 3
        if not primitives:
            raise ValueError("No rendered polygons " + feature["id"])
        mesh_i = len(doc["meshes"])
        doc["meshes"].append({"name": feature["id"], "primitives": primitives})
        extras = {k: v for k, v in feature.items() if k not in {"polygons", "polygon_material_keys"}}
        doc["nodes"].append({"name": feature["id"], "mesh": mesh_i, "extras": extras})
        doc["scenes"][0]["nodes"].append(len(doc["nodes"]) - 1)
    route = json.loads((SCENE / "cameras/route-proposal.json").read_text(encoding="utf-8"))
    for s in route["stations"]:
        focal = s.get("focal_length_35mm_equivalent_mm", 35)
        camera = len(doc["cameras"])
        doc["cameras"].append({"name": s["id"], "type": "perspective", "perspective": {"aspectRatio": 16 / 9,
            "yfov": 2 * math.atan(36 / (16 / 9) / (2 * focal)), "znear": .1, "zfar": 2000}})
        doc["nodes"].append({"name": s["id"], "camera": camera, "translation": s["position_m"],
            "rotation": camera_rotation(s["position_m"], s["look_at_m"]), "extras": {"role": "shared diagnostic camera"}})
        doc["scenes"][0]["nodes"].append(len(doc["nodes"]) - 1)
    if data["generation"]["font_meshes_included"]:
        doc["asset"]["copyright"] += " Noto Project Authors / SIL OFL 1.1 (sign text outlines)."
    doc["buffers"] = [{"byteLength": len(binary), "uri": "data:application/octet-stream;base64," + base64.b64encode(binary).decode()}]
    doc["extras"]["triangle_count"] = triangles
    write_json(path, doc, compact=True)
    return triangles


def main():
    modern = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text(encoding="utf-8"))
    layout = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text(encoding="utf-8"))
    gate, koma = [json.loads(p.read_text(encoding="utf-8")) for p in (GATE_PATH, KOMA_PATH)]
    if not gate.get("decision_complete") or not koma.get("decision_complete"):
        raise ValueError("Historical production choices must be adopted before generating this scene")
    if not SURFACE_PATH.exists():
        raise ValueError("Adopted connector surface decision is required")
    surfaces = json.loads(SURFACE_PATH.read_text(encoding="utf-8"))
    if not surfaces.get("decision_complete"):
        raise ValueError("Route surface decision is incomplete")
    milano, context = [json.loads(p.read_text(encoding="utf-8")) for p in (MILANO_PATH, CONTEXT_PATH)]
    for decision in (milano, context):
        if not decision.get("decision_complete"):
            raise ValueError("Adopted decision is incomplete: " + decision["id"])
    builder = Builder(modern, layout, gate, koma, surfaces, milano, context)
    builder.build_ground(); builder.build_context(); builder.build_gate()
    facades = builder.build_theatres(); builder.build_plaza_props()
    fonts = []
    if TEXT_MESH_PATH.exists():
        glyph_doc = json.loads(TEXT_MESH_PATH.read_text(encoding="utf-8"))
        digest = hashlib.sha256(json.dumps(builder.text_nodes, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        fonts = glyph_doc.get("features", []) if glyph_doc.get("input_text_nodes_sha256") == digest else []
        node_map = {n["id"]: n for n in builder.text_nodes}
        for f in fonts:
            node = node_map[f["id"].removesuffix("-glyphs")]
            f.setdefault("historical_status", "adopted-inferred")
            f.setdefault("historical_truth_status", "inferred")
            f.setdefault("decision_id", f.get("source_decision_id", node["decision_id"]))
            f.setdefault("source_feature_ids", [source_id for source_id in builder.source_map if node["id"].startswith(source_id)])
            f.setdefault("evidence_ids", node.get("evidence_ids", []))
            f.setdefault("source_ids", f["evidence_ids"])
            for source_id in f["source_feature_ids"]:
                builder.generated_for_source[source_id].append(f["id"])
            builder.features.append(f)
    classification = builder.finish_classification()
    decisions = [{"id": "period-background-context-rule", "historical_truth_status": "inferred",
        "rule": "Retain modern footprints only as spatial scaffolds, replace height with capped period massing, add near-route authored storefronts. No inferred source building is certified to have survived in 1976.",
        "evidence_ids": ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"],
        "parameters_path": CONTEXT_PATH.relative_to(ROOT).as_posix()},
        {"id": "period-ground-adoption-rule", "historical_truth_status": "modern-reference",
         "rule": "Source TIN retained with one 32 m datum; roads/plaza form material masks. Target-year ground continuity and colours are inferred.",
         "evidence_ids": ["plateau-13104-shinjuku-ku-2025", "gsi-gazo1-1974-1978"]},
        {"id": "period-site-omission-rule", "historical_truth_status": "inferred",
         "rule": "The thin modern strip and modern volume over the adopted plaza are omitted only in the period reconstruction, following the R01 aerial-led reversible removal decisions; baseline preserves both.",
         "path": "data/kabukicho-layout-hypothesis.json",
         "evidence_ids": ["gsi-gazo1-1974-1978", "shinjuku-plaza-1975"]},
        {"id": gate["id"], "path": GATE_PATH.relative_to(ROOT).as_posix()},
        {"id": koma["id"], "path": KOMA_PATH.relative_to(ROOT).as_posix()},
        {"id": milano["id"], "path": MILANO_PATH.relative_to(ROOT).as_posix(), "supersedes": milano["supersedes"]},
        {"id": context["id"], "path": CONTEXT_PATH.relative_to(ROOT).as_posix(), "rule_id": context["rule_id"]}]
    if surfaces:
        decisions.append({"id": surfaces["id"], "path": SURFACE_PATH.relative_to(ROOT).as_posix()})
    spec = {"schema_version": 1, "id": "kabukicho-period-scene-spec", "status": "complete-adopted-with-inference",
        "target_year": 1976, "historical_certification": False, "decision_complete": True,
        "completion_scope": "All imported features have adopted dispositions; gate, theatres, plaza fixtures and street context are modelled. Documentary certainty is not implied.",
        "coordinate_system": {"axes": ["east", "up", "south"], "units": "metres", "origin_jgd2011": modern["config"]["origin_jgd2011"]},
        "decisions": decisions, "facades": facades, "gate_adopted_variant": gate["adopted_variant"],
        "context_rules": {**{k: v for k, v in context["parameters"].items() if k != "omitted_feature_ids"},
            "omitted_feature_ids": context["parameters"]["omitted_feature_ids"], "low_structure_exception_feature_count": len(builder.low_kept),
            "generic_shop_types": ["喫茶", "食堂", "理容", "写真", "レコード", "麻雀"],
            "material_authoring_color_space": "sRGB; glTF baseColorFactor RGB is converted once to linear, alpha unchanged",
            "tenancy_status": "Generic shop types are authored period-compatible categories, not historical named tenants."},
        "ground_rules": {"source_tin_preserved": True, "mask_method": "triangle-centroid road/plaza masks", "ground_1976_status": "adopted-inferred"},
        "text_contract": {"position_m": "absolute local east/up/south metres with common 32 m orthometric offset", "baseline_direction_xz": "right-facing text baseline; local font Y points up", "height_m": "actual visible glyph bounding-box height in metres", "position_reference": "position_m is the physical visible-glyph bounding-box centre", "extrude_m": "physical extrusion"},
        "generation": {"script": "scripts/build_period_scene.py", "font_meshes_included": len(fonts) > 0,
            "font_mesh_feature_count": len(fonts), "font_triangle_count": sum(len(f["polygons"]) for f in fonts),
            "font_mesh_file": TEXT_MESH_PATH.relative_to(ROOT).as_posix() if fonts else None}}
    adopted_plaza = copy.deepcopy(layout["plaza"])
    adopted_plaza["historical_status"] = "adopted-inferred-open-space"
    adopted_plaza["interpretation"] = "Adopted plaza boundary from GSI aerial interpretation. The oval feature is adopted as a fountain; the municipal former-fountain-square record corroborates existence. The 1975 photograph supports open plaza, steps and multi-globe lamps, not an independently geolocated fountain basin."
    adopted_plaza["excluded_detail"] = "Temporary event stages, crowds and exact surveyed historical furnishing coordinates are not claimed. Fountain, threshold/stair geometry and multi-globe lamps are physically reconstructed from explicit adopted assumptions."
    adopted_plaza["adopted_fixture_ids"] = [p["id"] for p in koma["plaza_props"]]
    data = {"schema_version": 1, "id": "kabukicho-period-features", "status": "complete-adopted-with-inference",
        "config": modern["config"], "target_year": 1976, "historical_certification": False, "construction_complete": True,
        "decisions": decisions, "features": builder.features, "obstacles": builder.obstacles,
        "text_nodes": builder.text_nodes, "plaza": adopted_plaza, "generation": spec["generation"]}
    triangles = export_period_gltf(data, MODEL_PATH)
    spec["generation"].update({"feature_count": len(builder.features), "triangle_count": triangles,
        "text_node_count": len(builder.text_nodes), "obstacle_count": len(builder.obstacles)})
    write_json(PERIOD_PATH, data, compact=True)
    write_json(CLASS_PATH, classification)
    write_json(SPEC_PATH, spec)
    print(json.dumps({"features": len(builder.features), "triangles": triangles, "text_nodes": len(builder.text_nodes),
        "physical_obstacles": len(builder.obstacles), "source_classification": classification["counts_by_disposition"],
        "unclassified": classification["unclassified_count"], "font_meshes_included": len(fonts) > 0}))


if __name__ == "__main__":
    main()
