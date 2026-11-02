"""Published-asset integrity and attribution contracts.

These checks do not certify historical correctness. They prevent source mix-ups,
stale file hashes and missing dependency records when geometry is regenerated.
"""
import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"


def sidecars():
    for directory in (ROOT / "data", ROOT / "docs/previews", ROOT / "scenes"):
        for path in directory.rglob("*.asset.json"):
            if "raw" not in path.relative_to(ROOT).parts:
                yield path, json.loads(path.read_text())


class ProvenanceContracts(unittest.TestCase):
    def test_published_asset_paths_and_hashes_match_payloads(self):
        records = list(sidecars())
        self.assertTrue(records)
        for sidecar, record in records:
            with self.subTest(asset=record["path"]):
                relative = Path(record["path"])
                self.assertFalse(relative.is_absolute())
                self.assertNotIn("..", relative.parts)
                payload = ROOT / relative
                self.assertTrue(payload.is_file(), str(sidecar))
                self.assertEqual(hashlib.sha256(payload.read_bytes()).hexdigest(), record["sha256"])

    def test_dependency_ids_resolve_to_assets_or_registered_sources(self):
        records = list(sidecars())
        sources = json.loads((ROOT / "data/sources.json").read_text())["sources"]
        ids = [record["id"] for _, record in records]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate asset IDs")
        known = set(ids)
        for source in sources:
            known.add(source["id"])
            known.update(source.get("aliases", []))
        for _, record in records:
            for dependency in record.get("dependencies", []):
                with self.subTest(asset=record["id"], dependency=dependency):
                    self.assertIn(dependency, known)
                    self.assertNotEqual(dependency, record["id"])
            for component in record.get("source_components", []):
                with self.subTest(asset=record["id"], component=component["source_id"]):
                    self.assertIn(component["source_id"], known)
        hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text())
        evidence_groups = [hypothesis["plaza"]["evidence_sources"]]
        evidence_groups.extend(decision["evidence"] for decision in hypothesis["removal_decisions"])
        for group in evidence_groups:
            for source_id in group:
                with self.subTest(hypothesis_evidence=source_id):
                    self.assertIn(source_id, known)

    def test_modern_underlay_does_not_claim_historical_aerial_sources(self):
        paths = [ROOT / "data/derived/kabukicho-modern-features.json.asset.json",
                 SCENE / "models/modern-baseline.gltf.asset.json"]
        for path in paths:
            record = json.loads(path.read_text())
            self.assertNotIn("gsi-gazo1-1974-1978", record["dependencies"])
            self.assertTrue(all("gsi.go.jp" not in url for url in record["source_urls"]))
            self.assertIn("PLATEAU", record["provider"])
            self.assertNotIn("as applicable", record["processing"])

    def test_standalone_layout_model_credits_both_geometry_sources(self):
        modern = json.loads((SCENE / "models/modern-baseline.gltf").read_text())
        layout = json.loads((SCENE / "models/layout-study.gltf").read_text())
        self.assertIn("PLATEAU", modern["asset"]["copyright"])
        self.assertNotIn("国土地理院", modern["asset"]["copyright"])
        self.assertIn("PLATEAU", layout["asset"]["copyright"])
        self.assertIn("国土地理院", layout["asset"]["copyright"])
        self.assertIn("CC BY 4.0", layout["asset"]["copyright"])


if __name__ == "__main__":
    unittest.main()
