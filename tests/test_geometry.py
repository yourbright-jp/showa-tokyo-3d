import base64
import json
import math
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from import_plateau import (
    TerrainSampler, drape_zero_height_roads, export_glb, horizontal, load_terrain,
    normal, parse_features, triangulate,
)


class GeometryContracts(unittest.TestCase):
    def test_local_axes_and_scale(self):
        origin = {"latitude": 35.6945, "longitude": 139.702}
        self.assertEqual(horizontal(35.6945, 139.702, origin), (0, 0))
        east, south = horizontal(35.6945, 139.703, origin)
        self.assertTrue(90 < east < 91)
        self.assertLess(abs(south), 0.01)
        east, south = horizontal(35.6955, 139.702, origin)
        self.assertTrue(-112 < south < -110)
        self.assertLess(abs(east), 0.01)

    def test_concave_polygon_preserves_area(self):
        ring = [[0, 0, 0], [2, 0, 0], [2, 0, 2], [1, 0, 1], [0, 0, 2]]
        area = 0
        for ids in triangulate(ring):
            a, b, c = [ring[i] for i in ids]
            area += abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2
        self.assertAlmostEqual(area, 3)

    def test_wrong_crs_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.gml"
            p.write_text('<g:CityModel xmlns:g="http://www.opengis.net/gml"><g:Envelope srsName="EPSG:4326"/></g:CityModel>')
            with self.assertRaisesRegex(ValueError, "CRS"):
                parse_features(p, "building", {"selection_bounds": {}})

    def test_terrain_interpolation_preserves_slopes_and_rejects_extrapolation(self):
        # A deliberately sloped triangle: y = 1 + x/2 + z.
        terrain = TerrainSampler({
            "origin_jgd2011": {"height_m": 32.0},
            "vertices_m": [[0, 1, 0], [10, 6, 0], [0, 11, 10]],
            "triangles": [[0, 1, 2]],
        })
        self.assertAlmostEqual(terrain.height(2, 3), 5.0)
        self.assertAlmostEqual(terrain.orthometric_height(2, 3), 37.0)
        self.assertAlmostEqual(terrain.height(10, 0), 6.0)
        with self.assertRaises(ValueError):
            terrain.height(8, 8)

    def test_import_keeps_common_height_datum_and_separate_survey_year(self):
        # Equal-height buildings retain their different source bases. The first
        # pair's 7 m base difference must survive instead of both becoming 0.
        def building(identifier, base, survey):
            year = f"<uro:surveyYear>{survey}</uro:surveyYear>" if survey else ""
            rings = []
            for height in (base, base + 10):
                points = f"35.6945 139.702 {height} 35.6945 139.7021 {height} 35.6946 139.7021 {height} 35.6945 139.702 {height}"
                rings.append(f"<g:surfaceMember><g:Polygon><g:exterior><g:LinearRing><g:posList>{points}</g:posList></g:LinearRing></g:exterior></g:Polygon></g:surfaceMember>")
            return f"<b:Building g:id='{identifier}'><c:creationDate>2024-03-15</c:creationDate>{year}<b:lod1Solid><g:Solid><g:exterior><g:CompositeSurface>{''.join(rings)}</g:CompositeSurface></g:exterior></g:Solid></b:lod1Solid></b:Building>"

        xml = ("<c:CityModel xmlns:g='http://www.opengis.net/gml' "
               "xmlns:b='http://www.opengis.net/citygml/building/2.0' "
               "xmlns:c='http://www.opengis.net/citygml/2.0' "
               "xmlns:uro='https://www.geospatial.jp/iur/uro/3.2'>"
               "<g:boundedBy><g:Envelope srsName='http://www.opengis.net/def/crs/EPSG/0/6697'/></g:boundedBy>"
               + building("lower", 30, 2021) + building("upper", 37, "0001")
               + building("missing-year", 40, None)
               + "</c:CityModel>")
        config = {"origin_jgd2011": {"latitude": 35.6945, "longitude": 139.702, "height_m": 32},
                  "selection_bounds": {"south": 35.69, "north": 35.70, "west": 139.70, "east": 139.71}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "buildings.gml"
            path.write_text(xml)
            features, scanned = parse_features(path, "building", config)
        self.assertEqual(scanned, 3)
        low, high, missing = features
        bases = [min(p[1] for ring in f["polygons"] for p in ring) for f in features]
        self.assertEqual(bases, [-2, 5, 8])
        self.assertEqual([f["height_m"] for f in features], [10, 10, 10])
        self.assertEqual(low["source_survey_year"], 2021)
        self.assertEqual(low["source_creation_date"], "2024-03-15")
        self.assertIsNone(high["source_survey_year"])
        self.assertEqual(high["source_survey_year_raw"], "0001")
        self.assertIsNone(missing["source_survey_year"])

    def test_committed_buildings_preserve_source_elevations(self):
        config = json.loads((ROOT / "data/kabukicho-intake.json").read_text(encoding="utf-8"))
        datum = config["origin_jgd2011"]["height_m"]
        data = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text(encoding="utf-8"))
        buildings = [f for f in data["features"] if f["kind"] == "building"]
        self.assertTrue(buildings)
        bases = []
        for feature in buildings:
            ys = [p[1] for ring in feature["polygons"] for p in ring]
            bases.append(min(ys))
            self.assertAlmostEqual(min(ys) + datum, feature["source_base_height_m"], places=3)
            self.assertAlmostEqual(max(ys) - min(ys), feature["height_m"], places=3)
            self.assertIn("source_survey_year", feature)
            year = feature["source_survey_year"]
            self.assertTrue(year is None or isinstance(year, int))
        self.assertGreater(max(bases) - min(bases), 1.0)

    def test_station_eyes_follow_source_terrain(self):
        config = json.loads((ROOT / "data/kabukicho-intake.json").read_text(encoding="utf-8"))
        terrain = load_terrain(config)
        route = json.loads((ROOT / "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json").read_text(encoding="utf-8"))
        for station in route["stations"]:
            x, y, z = station["position_m"]
            self.assertAlmostEqual(y - terrain.height(x, z), 1.6, places=3)

    def test_missing_road_heights_drape_to_terrain_without_masking_real_elevations(self):
        terrain = TerrainSampler({
            "id": "test-terrain", "origin_jgd2011": {"height_m": 32.0},
            "vertices_m": [[0, 1, 0], [10, 6, 0], [0, 11, 10]],
            "triangles": [[0, 1, 2]],
        })
        road = {"kind": "road", "source_base_height_m": 0, "height_m": 0,
                "polygons": [[[0, -32, 0], [1, -32, 0], [0, -32, 1]]]}
        drape_zero_height_roads([road], terrain)
        self.assertEqual([p[1] for p in road["polygons"][0]], [1.02, 1.52, 2.02])
        self.assertEqual(road["source_base_height_m"], 0)
        real_elevations = {"kind": "road", "source_base_height_m": 30, "height_m": 0,
                           "polygons": [[[0, -2, 0], [1, -2, 0], [0, -2, 1]]]}
        with self.assertRaises(ValueError):
            drape_zero_height_roads([real_elevations], terrain)

    def test_committed_road_vertices_follow_terrain(self):
        config = json.loads((ROOT / "data/kabukicho-intake.json").read_text(encoding="utf-8"))
        terrain = load_terrain(config)
        data = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text(encoding="utf-8"))
        roads = [f for f in data["features"] if f["kind"] == "road"]
        self.assertTrue(roads)
        for feature in roads:
            for ring in feature["polygons"]:
                for x, y, z in ring:
                    self.assertAlmostEqual(y - terrain.height(x, z), .02, places=3)

    def test_committed_gltf_buffers_and_camera_rotations(self):
        scene = ROOT / "scenes/shinjuku/kabukicho/1976"
        route = json.loads((scene / "cameras/route-proposal.json").read_text(encoding="utf-8"))
        definition = json.loads((scene / "scene.json").read_text(encoding="utf-8"))
        for key in ["distance_m", "geometry", "stations", "validation"]:
            self.assertEqual(definition["route"][key], route[key], "Scene must not retain stale camera or route data")
        for name in ["modern-baseline", "layout-study"]:
            doc = json.loads((scene / f"models/{name}.gltf").read_text(encoding="utf-8"))
            data = base64.b64decode(doc["buffers"][0]["uri"].split(",", 1)[1], validate=True)
            self.assertEqual(len(data), doc["buffers"][0]["byteLength"])
            for a in doc["accessors"]:
                view = doc["bufferViews"][a["bufferView"]]
                start, size = view.get("byteOffset", 0), view["byteLength"]
                self.assertLessEqual(start + size, len(data))
                self.assertEqual(a["count"] * 3 * 4, size)
                values = struct.unpack("<" + "f" * (size // 4), data[start:start + size])
                self.assertTrue(all(math.isfinite(v) for v in values))
            with tempfile.TemporaryDirectory() as d:
                path = Path(d) / "model.glb"
                export_glb(doc, path)
                self.assertEqual(struct.unpack("<III", path.read_bytes()[:12]), (0x46546c67, 2, path.stat().st_size))
            if name == "layout-study":
                cameras = [n for n in doc["nodes"] if "camera" in n]
                self.assertEqual(len(cameras), 6)
                for node, station in zip(cameras, route["stations"]):
                    self.assertEqual(node["translation"], station["position_m"])
                    perspective = doc["cameras"][node["camera"]]["perspective"]
                    focal = station.get("focal_length_35mm_equivalent_mm", route["focal_length_35mm_equivalent_mm"])
                    # A 36 mm-wide frame is cropped to the exported aspect ratio.
                    self.assertAlmostEqual(math.tan(perspective["yfov"] / 2) * perspective["aspectRatio"], 18 / focal)
                    q = node["rotation"]
                    self.assertAlmostEqual(sum(v * v for v in q), 1)
                    direction = [a - b for a, b in zip(station["look_at_m"], station["position_m"])]
                    length = math.sqrt(sum(v * v for v in direction))
                    x, y, z, w = q
                    # glTF cameras look along local -Z. Check full quaternion,
                    # including terrain-induced pitch, rather than yaw alone.
                    forward = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))]
                    for value, target in zip(forward, direction):
                        self.assertAlmostEqual(value, target / length, places=6)

    def test_proposal_remains_uncertified_and_clear_of_static_footprints(self):
        p = ROOT / "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json"
        route = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(route["historical_confidence"], "unverified")
        self.assertEqual(route["validation"]["building_interior_collisions"], 0)
        self.assertGreater(route["validation"]["minimum_sampled_building_edge_clearance_m"], .5)

    def test_bend_and_arrival_stations_have_their_declared_spatial_roles(self):
        hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text(encoding="utf-8"))
        route = json.loads((ROOT / "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json").read_text(encoding="utf-8"))
        stations = route["stations"]
        d_index = next(i for i, s in enumerate(stations) if s["id"] == "towards-koma-corner")
        before, bend, after = [stations[i]["position_m"] for i in (d_index - 1, d_index, d_index + 1)]
        incoming = [bend[i] - before[i] for i in (0, 2)]
        outgoing = [after[i] - bend[i] for i in (0, 2)]
        cosine = sum(a * b for a, b in zip(incoming, outgoing)) / (math.hypot(*incoming) * math.hypot(*outgoing))
        turn = math.degrees(math.acos(max(-1, min(1, cosine))))
        self.assertGreater(turn, 10, "D must show a real route bend, rather than the old nearly straight alignment")

        polygon = hypothesis["plaza"]["boundary_pixels"]
        self.assertFalse(hypothesis["plaza"]["boundary_verified"])
        for station in hypothesis["stations"]:
            if station["id"] not in {"plaza-reveal", "koma-front"}:
                continue
            x, y = station["pixel"]
            # Winding-angle inclusion is independent of the builder's ray test.
            angle = 0
            for a, b in zip(polygon, polygon[1:] + polygon[:1]):
                u, v = (a[0] - x, a[1] - y), (b[0] - x, b[1] - y)
                angle += math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])
            self.assertAlmostEqual(abs(angle), 2 * math.pi, places=6, msg=station["id"])

    def test_inferred_period_removals_preserve_the_modern_baseline(self):
        hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text(encoding="utf-8"))
        modern = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text(encoding="utf-8"))
        layout = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text(encoding="utf-8"))
        modern_ids = {f["id"] for f in modern["features"]}
        layout_ids = {f["id"] for f in layout["features"]}
        decisions = hypothesis["removal_decisions"]
        self.assertIn("bldg_6e446aed-295c-4d08-82ee-f0d8c77fca2b", {d["feature_id"] for d in decisions})
        for decision in decisions:
            self.assertEqual(decision["decision"], "omit-from-period-layout-only")
            self.assertEqual(decision["confidence"], "inferred")
            self.assertTrue(decision["baseline_preserved"])
            self.assertTrue(decision["evidence"])
            self.assertIn(decision["feature_id"], modern_ids)
            self.assertNotIn(decision["feature_id"], layout_ids)

    def test_proxy_roof_normals_point_up(self):
        data = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text(encoding="utf-8"))
        for f in data["features"]:
            if f.get("historical_status") != "inferred-roof-proxy":
                continue
            top = max(f["polygons"], key=lambda r: min(p[1] for p in r))
            self.assertGreater(normal(top)[1], .99)


if __name__ == "__main__":
    unittest.main()
