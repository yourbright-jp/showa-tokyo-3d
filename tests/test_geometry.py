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
from import_plateau import horizontal, triangulate, export_glb, parse_features, normal


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

    def test_committed_gltf_buffers_and_camera_rotations(self):
        scene = ROOT / "scenes/shinjuku/kabukicho/1976"
        route = json.loads((scene / "cameras/route-proposal.json").read_text())
        for name in ["modern-baseline", "layout-study"]:
            doc = json.loads((scene / f"models/{name}.gltf").read_text())
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
                    q = node["rotation"]
                    self.assertAlmostEqual(sum(v * v for v in q), 1)
                    dx = station["look_at_m"][0] - station["position_m"][0]
                    dz = station["look_at_m"][2] - station["position_m"][2]
                    length = math.hypot(dx, dz)
                    self.assertAlmostEqual(-2 * q[1] * q[3], dx / length)
                    self.assertAlmostEqual(-(1 - 2 * q[1] ** 2), dz / length)

    def test_proposal_remains_uncertified_and_clear_of_static_footprints(self):
        p = ROOT / "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json"
        route = json.loads(p.read_text())
        self.assertEqual(route["historical_confidence"], "unverified")
        self.assertEqual(route["validation"]["building_interior_collisions"], 0)
        self.assertGreater(route["validation"]["minimum_sampled_building_edge_clearance_m"], .5)

    def test_proxy_roof_normals_point_up(self):
        data = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text())
        for f in data["features"]:
            if f.get("historical_status") != "inferred-roof-proxy":
                continue
            top = max(f["polygons"], key=lambda r: min(p[1] for p in r))
            self.assertGreater(normal(top)[1], .99)


if __name__ == "__main__":
    unittest.main()
