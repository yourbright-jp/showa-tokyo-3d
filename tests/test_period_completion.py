"""Cross-artifact contracts for an adopted, explicitly inferred reconstruction.

These tests check materialized geometry and traceable choices. They do not treat
an adopted status, an attractive image or an automated score as historical proof.
Continuous route mathematics and motion are covered in test_route_completion.py.
"""
import base64
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"
sys.path.insert(0, str(ROOT / "scripts"))
from build_blockout import contains, edge_distance
from update_completion_metadata import DECISIONS, IDS, PATHS

MASTER_SHA256 = {
    "R01": "01f6804a812e2cac601bd04f5d5ae816454cdb1523019928427452a1bf8b3b23",
    "R02": "7ab245c59c0641c3ed37e40c4e87437d6415362d0a174a2631c30bb3b013216c",
    "R03": "eec63409a882e0e6293d00effb5e85b70379fc45bc3c9768bab64495ae9a6fa7",
    "R04": "672679d1043784add943f87acb159a3b492770a0d42429e2d29c1bda2a98f7d1",
    "R05": "7e6d5846a19af55b4a80cd36538afb96dc2cdd0ead2a845892f176c921fddc6b",
    "R06": "02f6a057c782fa748311a9c74c4ddcb6753597ff74a2df65e65dd738bae1d4f3",
    "R07": "0620d66b0adb2fe6e6bc758a919c8e6bc6aa65101180faae40680fbc2739bf12",
    "R08": "64109fd6f3d79c3cdedab6ddffcc52b5f88dd73198835dd54b4e80561aa1d246",
    "R09": "4532cef746814726ca432393db9786ce848804c977255ea1ad5a689d59cc35f7",
}


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def decision_ids(spec):
    values = spec["decisions"]
    if isinstance(values, dict):
        return set(values)
    return {value["id"] if isinstance(value, dict) else value for value in values}


class AdoptedReconstruction(unittest.TestCase):
    def test_choices_have_parameters_evidence_and_explicit_inference(self):
        registered_sources = {source["id"] for source in read("data/sources.json")["sources"]}
        for path in DECISIONS.values():
            decision = read(path)
            with self.subTest(decision=decision["id"]):
                self.assertTrue(decision["decision_complete"])
                self.assertEqual(decision["historical_confidence"], "inferred")
                self.assertEqual(decision["target_year"], 1976)
                self.assertTrue(decision["evidence"])
                for evidence in decision["evidence"]:
                    self.assertTrue(evidence["url"].startswith("https://"))
                    self.assertIn(evidence["id"], registered_sources)
        gate = read(DECISIONS["gate"])
        self.assertEqual(gate["adopted_variant"], "curved-incandescent")
        self.assertTrue(gate["contradictions"], "Adoption must not erase the conflicting gate chronology")
        self.assertFalse(gate["verification"]["historical_fact_certification"])
        parameters = gate["parameters"]
        self.assertGreater(parameters["post_center_span_m"], 5)
        self.assertGreater(parameters["overall_height_m"], 5)
        self.assertIn("assum", parameters["dimension_status"].lower())
        self.assertEqual(parameters["sign_text"], "歌舞伎町一番街")
        koma = read(DECISIONS["koma"])
        self.assertEqual({b["proxy_id"] for b in koma["buildings"]},
                         {"koma-south-roof-proxy", "adjacent-theatre-roof-proxy"})
        self.assertEqual(len({b["adopted_identity"] for b in koma["buildings"]}), 2)
        for building in koma["buildings"]:
            self.assertGreater(building["height_assumption_m"], 0)
            self.assertTrue(building["parameters"])
            self.assertTrue(building["inferred_elements"])
            self.assertEqual(len(building["frontage_edge_pixels"]), 2)

    def test_every_modern_feature_has_one_materialized_disposition(self):
        modern = read("data/derived/kabukicho-modern-features.json")["features"]
        classification = read(PATHS["classification"])
        generated = read(PATHS["features"])
        features = classification["features"]
        source_by_id = {f["id"]: f for f in modern}
        output_ids = {f["id"] for f in generated["features"]}
        self.assertEqual(len(features), len(modern))
        self.assertEqual(len({f["source_feature_id"] for f in features}), len(features))
        self.assertEqual({f["source_feature_id"] for f in features}, set(source_by_id))
        self.assertEqual(classification["source_feature_count"], len(modern))
        self.assertEqual(classification["unclassified_count"], 0)
        self.assertEqual(Counter(f["disposition"] for f in features), classification["counts_by_disposition"])
        known_decisions = decision_ids(read(PATHS["spec"])) | set(IDS.values())
        allowed = {"inferred-period-context", "replaced", "omitted",
                   "adopted-road-alignment-reference", "adopted-terrain-reference"}
        for record in features:
            with self.subTest(source=record["source_feature_id"]):
                self.assertIn(record["disposition"], allowed)
                self.assertIn(record["historical_truth_status"], {"inferred", "modern-reference"})
                self.assertTrue(record["reason"])
                self.assertTrue(record["evidence_ids"])
                self.assertIn(record["decision_id"], known_decisions)
                produced = record["generated_feature_ids"]
                if record["disposition"] == "omitted":
                    self.assertEqual(produced, [])
                else:
                    self.assertTrue(produced, "A classified kept/replaced feature needs actual output geometry")
                self.assertTrue(set(produced) <= output_ids)
                if source_by_id[record["source_feature_id"]]["kind"] == "building":
                    self.assertEqual(record["source_survey_year"],
                                     source_by_id[record["source_feature_id"]]["source_survey_year"])

    def test_period_geometry_contains_physical_gate_facades_and_declared_obstacles(self):
        data = read(PATHS["features"])
        features = data["features"]
        self.assertEqual(len({f["id"] for f in features}), len(features))
        self.assertTrue(data["obstacles"])
        self.assertTrue(data["text_nodes"])
        text = json.dumps(data["text_nodes"], ensure_ascii=False)
        self.assertIn("歌舞伎町一番街", text)
        self.assertIn("コマ劇場", text)
        self.assertIn("プラザ劇場", text)
        gate = [f for f in features if f.get("decision_id") == IDS["gate"]]
        vertices = [p for f in gate for ring in f["polygons"] for p in ring]
        self.assertTrue(vertices, "The adopted gate must be materialized, not just a status field")
        self.assertGreater(max(p[1] for p in vertices) - min(p[1] for p in vertices), 5)
        self.assertGreater(math.hypot(max(p[0] for p in vertices) - min(p[0] for p in vertices),
                                      max(p[2] for p in vertices) - min(p[2] for p in vertices)), 8)
        parameters = read(DECISIONS["gate"])["parameters"]
        anchor, right = parameters["anchor_local_m"], parameters["right_xz"]
        u = [(p[0] - anchor[0]) * right[0] + (p[2] - anchor[2]) * right[1] for p in vertices]
        self.assertAlmostEqual(max(u) - min(u), parameters["overall_width_m"], delta=.001,
                               msg="Tail radius and declared overall width must be represented in actual gate geometry")
        self.assertAlmostEqual(max(p[1] for p in vertices) - anchor[1], parameters["overall_height_m"], delta=.001)
        self.assertTrue(any(f["kind"] == "facade" for f in features))
        for feature in features:
            self.assertNotIn(feature.get("historical_status"), {"modern-unreviewed", "unclassified"})
            self.assertTrue(feature["polygons"])
            for ring in feature["polygons"]:
                self.assertGreaterEqual(len(ring), 3)
                self.assertTrue(all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in ring))
        obstacle_ids = [o["id"] for o in data["obstacles"]]
        self.assertEqual(len(obstacle_ids), len(set(obstacle_ids)))
        self.assertTrue(any("fountain" in identity for identity in obstacle_ids))
        self.assertTrue(any("gate" in identity for identity in obstacle_ids))

    def test_original_four_points_are_inside_real_adopted_connector_polygons(self):
        decision = read(DECISIONS["surfaces"])
        connectors = {s["id"]: s for s in decision["connector_surfaces"]}
        points = decision["original_unclassified_samples"]
        self.assertEqual(len(points), 4)
        for point in points:
            surface = connectors[point["surface_id"]]
            ring = surface["boundary_m"]
            xz = point["position_xz_m"]
            self.assertTrue(contains(xz, ring) or edge_distance(xz, ring) < 1e-6)
            self.assertEqual(point["adopted_category"], surface["category"])
            self.assertEqual(surface["historical_confidence"], "inferred")

    def test_self_contained_gltf_has_valid_mesh_data_and_shared_cameras(self):
        doc = read(PATHS["model"])
        self.assertEqual(doc["asset"]["version"], "2.0")
        self.assertIn("PLATEAU", doc["asset"]["copyright"])
        self.assertIn("国土地理院", doc["asset"]["copyright"])
        materials = {m["name"]: m["pbrMetallicRoughness"]["baseColorFactor"] for m in doc["materials"]}

        def linear(values):
            return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]

        gate = read(DECISIONS["gate"])["parameters"]
        for source_key, material_key in [("body_color_srgb", "gate-body"),
                                         ("plate_color_srgb", "gate-plate"),
                                         ("letter_color_srgb", "gate-lettering")]:
            colour = gate[source_key].lstrip("#")
            expected = linear([int(colour[i:i + 2], 16) / 255 for i in (0, 2, 4)])
            for value, target in zip(materials[material_key][:3], expected):
                self.assertAlmostEqual(value, target, places=7)
        for building in read(DECISIONS["koma"])["buildings"]:
            prefix = building["proxy_id"].removesuffix("-roof-proxy")
            for source_key, suffix in [("wall_base_color_rgb", "wall"), ("metal_base_color_rgb", "metal"),
                                       ("glazing_base_color_rgb", "glass")]:
                if source_key not in building["parameters"]:
                    continue
                expected = linear(building["parameters"][source_key])
                for value, target in zip(materials[prefix + "-" + suffix][:3], expected):
                    self.assertAlmostEqual(value, target, places=7)
        buffers = []
        for buffer in doc["buffers"]:
            self.assertTrue(buffer["uri"].startswith("data:"))
            content = base64.b64decode(buffer["uri"].split(",", 1)[1], validate=True)
            self.assertEqual(len(content), buffer["byteLength"])
            buffers.append(content)
        component_widths = {5120: (1, "b"), 5121: (1, "B"), 5122: (2, "h"),
                            5123: (2, "H"), 5125: (4, "I"), 5126: (4, "f")}
        arities = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
        for accessor in doc["accessors"]:
            view = doc["bufferViews"][accessor["bufferView"]]
            width, code = component_widths[accessor["componentType"]]
            arity = arities[accessor["type"]]
            stride = view.get("byteStride", width * arity)
            start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            end = start + (accessor["count"] - 1) * stride + width * arity
            self.assertLessEqual(end, view.get("byteOffset", 0) + view["byteLength"])
            self.assertLessEqual(end, len(buffers[view["buffer"]]))
            for index in range(accessor["count"]):
                values = struct.unpack_from("<" + code * arity, buffers[view["buffer"]], start + stride * index)
                self.assertTrue(all(math.isfinite(v) for v in values))
        for mesh in doc["meshes"]:
            for primitive in mesh["primitives"]:
                self.assertIn("POSITION", primitive["attributes"])
                self.assertLess(primitive["material"], len(doc["materials"]))
        route = read(f"{SCENE.relative_to(ROOT).as_posix()}/cameras/route-proposal.json")
        nodes = [n for n in doc["nodes"] if "camera" in n]
        self.assertEqual(len(nodes), len(route["stations"]))
        for node, station in zip(nodes, route["stations"]):
            self.assertEqual(node["translation"], station["position_m"])
        self.assertFalse(doc.get("images"), "The procedural model must not smuggle in archival-photo billboards")

    def test_approved_colour_masters_are_byte_identical(self):
        sidecars = list((SCENE / "references/master-v1").glob("*.asset.json"))
        self.assertEqual(len(sidecars), 9)
        for path in sidecars:
            record = json.loads(path.read_text(encoding="utf-8"))
            sha = hashlib.sha256((ROOT / record["path"]).read_bytes()).hexdigest()
            self.assertEqual(sha, MASTER_SHA256[record["id"]])

    def test_stable_sign_strings_are_current_extruded_distributable_geometry(self):
        generated = read(PATHS["features"])
        glyphs = read(PATHS["text_meshes"])
        nodes = generated["text_nodes"]
        recipe = json.dumps(nodes, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(glyphs["input_text_nodes_sha256"], hashlib.sha256(recipe).hexdigest(),
                         "Sign geometry is stale relative to the current placement/text recipe")
        self.assertEqual(glyphs["font"]["license"], "OFL-1.1")
        self.assertTrue(glyphs["font"]["sha256"])
        self.assertIn("CJK", glyphs["font"]["name"])
        self.assertEqual(glyphs["glyph_fitting"], "visible-glyph-bounds-v1")
        output = {f["id"]: f for f in generated["features"]}
        by_id = {f["id"]: f for f in glyphs["features"]}
        gltf = read(PATHS["model"])
        model_meshes = {mesh["name"] for mesh in gltf["meshes"]}
        self.assertEqual(len(nodes), len(by_id))
        self.assertTrue(gltf["extras"]["font_meshes_included"])
        self.assertIn("Noto Project Authors", gltf["asset"]["copyright"])
        self.assertIn("OFL", gltf["asset"]["copyright"])
        for node in nodes:
            identity = node["id"] + "-glyphs"
            with self.subTest(sign=node["id"]):
                self.assertIn(identity, by_id)
                self.assertIn(identity, output)
                self.assertIn(identity, model_meshes)
                self.assertEqual(by_id[identity]["text"], node["text"])
                self.assertEqual(output[identity]["polygons"], by_id[identity]["polygons"])
                polygons = by_id[identity]["polygons"]
                self.assertTrue(polygons)
                self.assertTrue(all(len(ring) == 3 for ring in polygons))
                ys = [p[1] for ring in polygons for p in ring]
                self.assertAlmostEqual(max(ys) - min(ys), node.get("height_m", .5), delta=1e-4,
                                       msg="Physical visible glyph height must match the sign recipe, not font-em height")
                self.assertAlmostEqual((max(ys) + min(ys)) / 2, node["position_m"][1], delta=1e-4,
                                       msg="Visible glyph bounds must be centered on their recorded sign position")
                if node["id"] in {"ichibangai-gate-name-front", "ichibangai-gate-name-rear"}:
                    plate = output["ichibangai-gate-nameplate"]
                    plate_ys = [p[1] for ring in plate["polygons"] for p in ring]
                    self.assertAlmostEqual((max(ys) + min(ys)) / 2,
                                           (max(plate_ys) + min(plate_ys)) / 2, delta=1e-4,
                                           msg="Both gate name faces must be centered on the physical nameplate")
                elif "-name-" in node["id"]:
                    canopy = output[node["id"].split("-name-", 1)[0] + "-canopy"]
                    canopy_top = max(p[1] for ring in canopy["polygons"] for p in ring)
                    self.assertGreater(min(ys), canopy_top + 1e-4,
                                       "Facade-name glyphs must clear the actual canopy, including its thickness")
                elif node["id"].endswith("-generic-shop-text"):
                    source_id = node["id"].removesuffix("-generic-shop-text")
                    pane = output[source_id + "-period-facade-sign-white"]
                    pane_ys = [p[1] for ring in pane["polygons"] for p in ring]
                    self.assertAlmostEqual((max(ys) + min(ys)) / 2,
                                           (max(pane_ys) + min(pane_ys)) / 2, delta=1e-4,
                                           msg="Generic shop-category lettering must be centered on its physical sign pane")
                dx, dz = node.get("baseline_direction_xz", [1, 0])
                depth = [p[0] * dz - p[2] * dx for ring in polygons for p in ring]
                self.assertGreater(max(depth) - min(depth), .005,
                                   "Lettering must retain physical extrusion, rather than a flat photo panel")

    def test_new_metadata_distinguishes_adoption_from_historical_proof(self):
        evidence_by_decision = {read(path)["id"]: {item["id"]: item for item in read(path)["evidence"]}
                                for path in DECISIONS.values()}
        for key, path in PATHS.items():
            record = read(path + ".asset.json")
            self.assertEqual(record["id"], IDS[key])
            self.assertEqual(record["historical_confidence"], "inferred")
            self.assertFalse(record["historical_fact_certification"])
            self.assertNotIn("as applicable", record["processing"])
            self.assertEqual(record["sha256"], hashlib.sha256((ROOT / path).read_bytes()).hexdigest())
            for source in record["source_components"]:
                if source.get("decision_asset_id"):
                    evidence = evidence_by_decision[source["decision_asset_id"]][source["evidence_id"]]
                    for temporal_key in ("year_role", "represented_event_year", "year_range", "source_year_range",
                                         "capture_date", "capture_date_status", "source_date_status"):
                        if temporal_key in evidence:
                            self.assertEqual(source[temporal_key], evidence[temporal_key],
                                             "Source temporal roles must survive metadata generation")
                if source.get("evidence_only"):
                    self.assertIsNone(source["license"])
                    self.assertIn("no", source["rights_status"].lower())
                    self.assertTrue(source["source_url"].startswith("https://"))
            if key in {"features", "model", "text_meshes"}:
                if key != "text_meshes":
                    self.assertIn(IDS["text_meshes"], record["dependencies"])
                self.assertEqual(record["font_provenance"]["license"], "OFL-1.1")
                font = next(source for source in record["source_components"]
                            if source["source_id"] == "noto-cjk-blender-4-5-15")
                self.assertEqual(font["font_file_sha256"], read(PATHS["text_meshes"])["font"]["sha256"])
        graph = {}
        for directory in (ROOT / "data", ROOT / "docs/previews", ROOT / "scenes"):
            for path in directory.rglob("*.asset.json"):
                if "raw" in path.relative_to(ROOT).parts:
                    continue
                record = json.loads(path.read_text(encoding="utf-8"))
                graph[record["id"]] = record.get("dependencies", [])
        active, visited = set(), set()

        def visit(identity):
            self.assertNotIn(identity, active, "Asset provenance must be acyclic: " + identity)
            if identity in visited or identity not in graph:
                return
            active.add(identity)
            for dependency in graph[identity]:
                visit(dependency)
            active.remove(identity)
            visited.add(identity)

        for identity in graph:
            visit(identity)

    def test_published_period_frames_match_the_rendered_model_and_manifest(self):
        manifest = read(PATHS["render_manifest"])
        model_sha = hashlib.sha256((ROOT / PATHS["model"]).read_bytes()).hexdigest()
        self.assertEqual(manifest["source_render"]["model_sha256"], model_sha,
                         "The published images must use the actual final model")
        images = manifest["images"]
        self.assertEqual(len(images), 14, "Six shared views and eight sparse walk frames must be present")
        self.assertEqual(len({item["path"] for item in images}), len(images))
        cameras = {item["camera"] for item in images}
        route = read("scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json")
        self.assertTrue({s["id"] for s in route["stations"]} <= cameras)
        self.assertEqual(len([name for name in cameras if name.startswith("walk-")]), 8)
        for item in images:
            relative = Path(item["path"])
            self.assertFalse(relative.is_absolute())
            self.assertNotIn("..", relative.parts)
            self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), item["sha256"])
        walk = read(PATHS["walk"])
        for index in range(8):
            item = next(frame for frame in images if frame["camera"] == f"walk-{index:02d}")
            target_time = walk["duration_s"] * index / 7
            expected = min(walk["samples"], key=lambda sample: abs(sample["time_s"] - target_time))
            self.assertAlmostEqual(item["time_s"], expected["time_s"], places=6)
            self.assertEqual(item["position_m"], expected["position_m"])
            self.assertEqual(item["look_at_m"], expected["look_at_m"])
        for path in manifest["sheet_paths"]:
            self.assertTrue((ROOT / path).is_file())

    def test_entrance_stills_use_the_adopted_gate_and_current_terrain_specification(self):
        manifest = read("docs/previews/r03/entrance-render-manifest.json")
        spec_path = "scenes/shinjuku/kabukicho/1976/detail/entrance-detail-spec.json"
        self.assertEqual(manifest["spec_sha256"], hashlib.sha256((ROOT / spec_path).read_bytes()).hexdigest())
        self.assertEqual(manifest["gate_decision_sha256"], hashlib.sha256((ROOT / DECISIONS["gate"]).read_bytes()).hexdigest())
        self.assertEqual(manifest["gate"], "curved")
        self.assertTrue(manifest["gate_adopted_for_1976"])
        self.assertFalse(manifest["gate_verified_for1976"])
        self.assertEqual(manifest["common_orthometric_datum_m"], 32)
        self.assertTrue(manifest["terrain_relative_authored_geometry"])
        self.assertFalse(manifest["third_party_rasters_embedded"])
        self.assertFalse(manifest["font_binary_distributed"])
        self.assertEqual(manifest["font_sha256"], read(PATHS["text_meshes"])["font"]["sha256"])
        previews = manifest["published_previews"]
        self.assertEqual(len(previews), 4)
        for item in previews:
            path = Path(item["path"])
            self.assertFalse(path.is_absolute())
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), item["sha256"])


if __name__ == "__main__":
    unittest.main()
