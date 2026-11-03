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
                yield path, json.loads(path.read_text(encoding="utf-8"))


# Directories whose non-code, non-document payloads must carry an adjacent *.asset.json
# (docs/PRODUCTION_PLAN.md, 出典記録とファイル管理). data/raw/ is ignored and never published.
SIDECAR_ROOTS = ("scenes", "data", "docs/previews", "assets/shared")
# Files that are exempt, each with its reason. Keep this list short and explicit.
SIDECAR_EXEMPT = {
    "data/sources.json": "the source registry itself; every entry carries its own provider, URL, licence and year",
    "scenes/shinjuku/kabukicho/1976/scene.json": "scene definition (configuration); it references asset IDs whose sidecars hold provenance",
    "scenes/shinjuku/kabukicho/1976/references/README.md": "document describing the approved colour masters",
    "scenes/shinjuku/kabukicho/1976/references/approved-colour-index.json": "index of the approved masters; each master PNG has its own sidecar",
}
EXEMPT_NAMES = {".gitkeep": "empty directory placeholder"}
# Fields every sidecar must carry (present on all records since R01; values may be null where unknown).
REQUIRED_FIELDS = (
    "schema_version", "id", "path", "type", "provider", "source_urls", "license", "target_year",
    "processing", "sha256", "format", "units", "coordinate_system", "geographic_confidence",
    "historical_confidence", "redistribution_review",
)
# Source year must be recorded separately from the reconstruction (target) year (AGENTS.md).
SOURCE_YEAR_FIELDS = ("source_years", "source_year_label", "source_periods")
GEOGRAPHIC_LEVELS = {"verified", "approximate", "unverified", None}


class ProvenanceCoverage(unittest.TestCase):
    def test_every_published_payload_has_a_sidecar_or_a_recorded_exemption(self):
        missing = []
        for root in SIDECAR_ROOTS:
            base = ROOT / root
            if not base.exists():
                continue
            for path in base.rglob("*"):
                rel = path.relative_to(ROOT)
                if path.is_dir() or path.name.endswith(".asset.json") or "raw" in rel.parts[:2]:
                    continue
                if path.name in EXEMPT_NAMES or rel.as_posix() in SIDECAR_EXEMPT:
                    continue
                if not path.with_name(path.name + ".asset.json").is_file():
                    missing.append(rel.as_posix())
        self.assertEqual(missing, [], "payloads without *.asset.json; add a sidecar or an exemption with a reason")

    def test_exemptions_point_at_existing_files(self):
        for rel, reason in SIDECAR_EXEMPT.items():
            with self.subTest(path=rel):
                self.assertTrue((ROOT / rel).is_file())
                self.assertTrue(reason.strip())

    def test_sidecars_carry_required_fields(self):
        for sidecar, record in sidecars():
            with self.subTest(sidecar=sidecar.relative_to(ROOT).as_posix()):
                for field in REQUIRED_FIELDS:
                    self.assertIn(field, record)
                self.assertTrue(any(field in record for field in SOURCE_YEAR_FIELDS),
                                "record the source year(s) separately from target_year")
                self.assertEqual(sidecar.name, Path(record["path"]).name + ".asset.json")
                self.assertIn(record["geographic_confidence"], GEOGRAPHIC_LEVELS)
                self.assertTrue(record["provider"])
                self.assertIsInstance(record["source_urls"], list)
                if record["license"] is not None:
                    self.assertTrue(record.get("license_url"), "licensed records need license_url")
                else:
                    self.assertTrue(record.get("rights_review") or record.get("rights_note"),
                                    "a null licence needs a recorded rights review")

    def test_inferred_records_do_not_claim_verified_history(self):
        for sidecar, record in sidecars():
            if record.get("historical_fact_certification") is not None:
                with self.subTest(sidecar=sidecar.relative_to(ROOT).as_posix()):
                    self.assertFalse(record["historical_fact_certification"])
            if record.get("adoption_status") == "adopted-with-inference":
                with self.subTest(sidecar=sidecar.relative_to(ROOT).as_posix()):
                    self.assertNotEqual(record["historical_confidence"], "verified")


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
        sources = json.loads((ROOT / "data/sources.json").read_text(encoding="utf-8"))["sources"]
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
        hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text(encoding="utf-8"))
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
            record = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotIn("gsi-gazo1-1974-1978", record["dependencies"])
            self.assertTrue(all("gsi.go.jp" not in url for url in record["source_urls"]))
            self.assertIn("PLATEAU", record["provider"])
            self.assertNotIn("as applicable", record["processing"])

    def test_standalone_layout_model_credits_both_geometry_sources(self):
        modern = json.loads((SCENE / "models/modern-baseline.gltf").read_text(encoding="utf-8"))
        layout = json.loads((SCENE / "models/layout-study.gltf").read_text(encoding="utf-8"))
        self.assertIn("PLATEAU", modern["asset"]["copyright"])
        self.assertNotIn("国土地理院", modern["asset"]["copyright"])
        self.assertIn("PLATEAU", layout["asset"]["copyright"])
        self.assertIn("国土地理院", layout["asset"]["copyright"])
        self.assertIn("CC BY 4.0", layout["asset"]["copyright"])


if __name__ == "__main__":
    unittest.main()
