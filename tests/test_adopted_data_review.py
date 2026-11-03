"""Contracts for the r05 revisions of adopted data (docs/rounds/shinjuku-kabukicho-1976-r05-data-review.md).

They check that each revised decision is materialized in the generated geometry and
that the problem it resolves is gone from the fixed cameras. They do not certify the
revised values as historical fact.
"""
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"
sys.path.insert(0, str(ROOT / "scripts"))
from build_blockout import contains, footprint

KOMA = "data/decisions/kabukicho-koma-plaza-1976.json"
MILANO = "data/decisions/kabukicho-milano-1976.json"
CONTEXT = "data/decisions/kabukicho-context-massing-1976.json"
FASCIA_ALLOWANCE_M = 0.07  # authored canopy fascia above the slab in the r04 viewer (fasciaUp)
LAMP_CLEARANCE_M = 0.6     # pole radius 0.18 m plus cast collar and scroll arms


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def eyes():
    cameras = {sid: read(f"{SCENE.relative_to(ROOT).as_posix()}/cameras/{sid}.json")["position_m"]
               for sid in ("towards-koma-corner", "plaza-reveal", "koma-front")}
    walk = read(f"{SCENE.relative_to(ROOT).as_posix()}/cameras/adopted-walk.json")["samples"]
    for t in (184, 230):
        cameras[f"walk-{t}"] = min(walk, key=lambda s: abs(s["time_s"] - t))["position_m"]
    cameras["walk-arrival"] = walk[-1]["position_m"]
    return cameras


class RevisedAdoptedData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.period = read("data/derived/kabukicho-period-features.json")
        cls.features = {f["id"]: f for f in cls.period["features"]}
        cls.nodes = {n["id"]: n for n in cls.period["text_nodes"]}
        cls.spec = read(f"{SCENE.relative_to(ROOT).as_posix()}/reconstruction/period-scene-spec.json")
        cls.facades = {f["id"]: f for f in cls.spec["facades"]}

    def glyph_points(self, node_id):
        return [p for ring in self.features[node_id + "-glyphs"]["polygons"] for p in ring]

    def test_revision_records_keep_evidence_counterevidence_and_previous_values(self):
        for path in (KOMA, MILANO, CONTEXT):
            decision = read(path)
            self.assertTrue(decision["revisions"])
            for revision in decision["revisions"]:
                with self.subTest(revision=revision["id"]):
                    for key in ("date", "resolves", "issue", "previous", "adopted", "counter_evidence", "inferred_parameters"):
                        self.assertTrue(revision.get(key), key)
                    self.assertIs(revision["historical_fact_certification"], False)
                    alternatives = revision.get("alternatives", decision.get("alternatives"))
                    self.assertEqual(sum(1 for a in alternatives if a["adopted"]), 1)
        self.assertEqual(read(MILANO)["supersedes"], "milano-facade-adoption-rule")
        decision_ids = {d["id"] for d in self.spec["decisions"]}
        self.assertTrue({"kabukicho-milano-1976", "kabukicho-context-massing-1976", "period-background-context-rule"} <= decision_ids)
        self.assertNotIn("milano-facade-adoption-rule", decision_ids)

    def test_koma_names_stand_on_the_canopy_and_clear_its_edge_from_every_route_view(self):
        facade = self.facades["koma-south-roof-proxy"]
        out = facade["outward_direction_xz"]
        offset = lambda p: p[0] * out[0] + p[2] * out[1]
        canopy = [p for ring in self.features["koma-south-canopy"]["polygons"] for p in ring]
        canopy_edge = max(offset(p) for p in canopy)
        canopy_top = max(p[1] for p in canopy)
        mounting = read(KOMA)["buildings"][0]["parameters"]["sign_mounting"]
        self.assertEqual(mounting["mode"], "freestanding-letters-on-canopy-top")
        for node_id in ("koma-south-name-0", "koma-south-name-1"):
            points = self.glyph_points(node_id)
            bottom = min(p[1] for p in points)
            with self.subTest(sign=node_id):
                self.assertAlmostEqual(bottom, canopy_top + mounting["support_rail_height_m"], delta=1e-4,
                                       msg="glyphs sit on the support rail on the canopy slab")
                back = min(offset(p) for p in points)
                self.assertGreater(back, canopy_edge - 0.5, "letters stand near the canopy edge, not on the wall")
                self.assertLess(max(offset(p) for p in points), canopy_edge, "letters stay on the canopy")
                for camera, eye in eyes().items():
                    if camera not in ("walk-arrival", "plaza-reveal", "koma-front"):
                        continue
                    eye_o = offset(eye)
                    for p in points:
                        if p[1] > bottom + 1e-3:
                            continue
                        ray_y = p[1] + (eye[1] - p[1]) * (canopy_edge - back) / (eye_o - back)
                        self.assertGreater(ray_y, canopy_top + FASCIA_ALLOWANCE_M,
                                           f"{camera}: canopy edge hides the bottom of {node_id}")

    def test_no_plaza_lamp_stands_in_front_of_a_theatre_name(self):
        lamps = {}
        for lamp in ("north", "middle", "south"):
            pole = [p for ring in self.features[f"plaza-lamp-{lamp}-pole"]["polygons"] for p in ring]
            lamps[lamp] = ((min(p[0] for p in pole) + max(p[0] for p in pole)) / 2,
                           (min(p[2] for p in pole) + max(p[2] for p in pole)) / 2, max(p[1] for p in pole))
        for node_id in ("koma-south-name-0", "koma-south-name-1", "adjacent-theatre-name-0", "adjacent-theatre-name-1"):
            node = self.nodes[node_id]
            bx, bz = node["baseline_direction_xz"]
            points = self.glyph_points(node_id)
            along = [(p[0] - node["position_m"][0]) * bx + (p[2] - node["position_m"][2]) * bz for p in points]
            ys = [p[1] for p in points]
            targets = [[node["position_m"][0] + bx * s, y, node["position_m"][2] + bz * s]
                       for s in [min(along) + (max(along) - min(along)) * k / 8 for k in range(9)]
                       for y in (min(ys), (min(ys) + max(ys)) / 2, max(ys))]
            for camera, eye in eyes().items():
                for lamp, (lx, lz, top) in lamps.items():
                    closest = math.inf
                    for target in targets:
                        for k in range(121):
                            t = k / 120
                            q = [eye[i] + (target[i] - eye[i]) * t for i in range(3)]
                            if q[1] <= top:
                                closest = min(closest, math.hypot(q[0] - lx, q[2] - lz))
                    with self.subTest(sign=node_id, camera=camera, lamp=lamp):
                        self.assertGreaterEqual(closest, LAMP_CLEARANCE_M)

    def test_milano_public_front_has_a_clear_forecourt_and_carries_the_name(self):
        record = self.facades["milano-roof-proxy"]
        decision = read(MILANO)["building"]
        self.assertEqual(record["public_frontage_span_fraction"], decision["public_frontage_span_fraction"])
        (ax, az), (bx, bz) = record["public_frontage_endpoints_xz"]
        width = math.hypot(bx - ax, bz - az)
        self.assertAlmostEqual(width, record["frontage_width_m"], delta=1e-3)
        self.assertLess(width, record["edge_width_m"])
        ux, uz = (bx - ax) / width, (bz - az) / width
        ox, oz = record["outward_direction_xz"]
        strip = [[ax + ux * s + ox * d, az + uz * s + oz * d]
                 for s in [width * k / 48 for k in range(49)] for d in (0.3, 1.0, 2.0, 3.0)]
        neighbour = read(MILANO)["north_neighbour"]["feature_id"]
        self.assertEqual(self.features[neighbour]["kind"], "building", "the aerial-supported neighbour is retained")
        for feature in self.period["features"]:
            if feature["kind"] != "building" or feature.get("role") == "stable-sign-lettering" or feature["id"].startswith("milano"):
                continue
            ring = footprint(feature)
            with self.subTest(building=feature["id"]):
                self.assertFalse(any(contains(point, ring) for point in strip),
                                 "a building stands within 3 m in front of the Milano public front")
        for node_id in ("milano-name-0", "milano-entrance-label"):
            node = self.nodes[node_id]
            s = (node["position_m"][0] - ax) * ux + (node["position_m"][2] - az) * uz
            half = len(node["text"]) * node["height_m"] / 2
            with self.subTest(sign=node_id):
                self.assertGreater(s - half, 0)
                self.assertLess(s + half, width)

    def test_low_background_structures_keep_their_height_and_the_forecourt_one_is_omitted(self):
        rule = read(CONTEXT)["parameters"]
        low = rule["low_structure_exception"]
        checked = 0
        for feature in self.period["features"]:
            if feature["kind"] != "building" or feature.get("source_height_m") is None:
                continue
            if feature["source_height_m"] >= low["source_height_below_m"]:
                continue
            checked += 1
            with self.subTest(building=feature["id"]):
                if feature["distance_to_route_m"] >= low["applies_at_route_distance_m_or_more"]:
                    self.assertAlmostEqual(feature["height_m"], feature["source_height_m"], places=4)
                else:
                    self.assertGreaterEqual(feature["height_m"], rule["minimum_height_m"])
        self.assertEqual(checked, 25)
        classification = {r["source_feature_id"]: r for r in read("data/derived/kabukicho-feature-classification.json")["features"]}
        modern = {f["id"] for f in read("data/derived/kabukicho-modern-features.json")["features"]}
        for feature_id in rule["omitted_feature_ids"]:
            with self.subTest(omitted=feature_id):
                self.assertEqual(classification[feature_id]["disposition"], "omitted")
                self.assertEqual(classification[feature_id]["decision_id"], "kabukicho-context-massing-1976")
                self.assertNotIn(feature_id, self.features)
                self.assertIn(feature_id, modern, "the modern baseline keeps the omitted structure")

    def test_club_heights_letters_sit_in_the_top_band_of_the_low_front(self):
        decision = next(b for b in read(KOMA)["buildings"] if b["proxy_id"] == "adjacent-theatre-roof-proxy")
        record = self.facades["adjacent-theatre-roof-proxy"]
        ys = [p[1] for p in self.glyph_points("adjacent-theatre-name-1")]
        top, bottom = max(ys) - record["base_y_m"], min(ys) - record["base_y_m"]
        front = decision["parameters"]["lower_front_height_m"]
        self.assertLess(top, front, "the letters stay on the low front, not the set-back tower")
        self.assertGreater(bottom, front - 1.2, "the letters are in the top band, above the glazed upper level")


if __name__ == "__main__":
    unittest.main()
