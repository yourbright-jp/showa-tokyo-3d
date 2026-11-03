#!/usr/bin/env python3
"""Refresh R01 per-asset provenance and byte hashes after geometry/render builds.

No upstream rasters are copied. Approved reference masters and their sidecars are
deliberately outside this updater's scope. Run after the importer, blockout builder
and preview renderer so the recorded hashes describe the final public files.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENE = "scenes/shinjuku/kabukicho/1976"
PROJECT = "yourbright-jp/showa-tokyo-3d contributors"
PROJECT_URL = "https://github.com/yourbright-jp/showa-tokyo-3d"
PLATEAU_ID = "plateau-13104-shinjuku-ku-2025"
GSI_ID = "gsi-gazo1-1974-1978"
PLAZA_PHOTO_ID = "shinjuku-plaza-1975"
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
MIT = "https://opensource.org/license/mit"
GSI_CATALOG = "https://maps.gsi.go.jp/development/ichiran.html"
GSI_TERMS = "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html"
PDL = "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0"
DATE = "2026-11-02"
PRIOR_REVISION = "bb31effa95b3f12ed53e9b1e530f7cb8299b1a66"


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write(path, value):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    pending.replace(path)


def sha256(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def source_components(config, historical):
    result = [{
        "source_id": PLATEAU_ID,
        "provider": "東京都・新宿区 / Project PLATEAU",
        "source_url": config["archive_url"],
        "license": "CC-BY-4.0", "license_url": CC_BY,
        "attribution": config["attribution"],
        "source_release_year": config["source_year"],
        "source_creation_date": config["creation_date"],
        "vertical_processing": config["vertical_mode"],
        "road_elevation_limitations": config["road_elevation_limitations"],
        "scope": "Modern source buildings, roads and terrain; not a single-date view of the current city or evidence of 1976 conditions."
    }]
    if historical:
        result.append({
            "source_id": GSI_ID,
            "provider": "国土地理院 / Geospatial Information Authority of Japan",
            "source_url": GSI_CATALOG,
            "source_period": [1974, 1978], "exact_capture_date": None,
            "license": "CC-BY-4.0", "license_url": CC_BY,
            "upstream_terms": "PDL 1.0; CC BY 4.0 use selected under section 1.7(3)",
            "upstream_terms_urls": [GSI_TERMS, PDL],
            "terms_checked_at": DATE,
            "attribution": "国土地理院 地理院タイル gazo1（1974〜1978年）を参照・加工し、showa-tokyo-3d project が配置仮説を作成。",
            "scope": "Approximate manual interpretation of roof outlines and street space. Raw aerial tiles and historical photographs are not embedded or redistributed."
        })
    return result


def main():
    config = read("data/kabukicho-intake.json")
    plaza_photo = next(source for source in read("data/sources.json")["sources"]
                       if source["id"] == PLAZA_PHOTO_ID)
    modern_path = "data/derived/kabukicho-modern-features.json"
    modern = read(modern_path)
    features = modern.get("features", [])
    years = sorted({f["source_survey_year"] for f in features
                    if f.get("kind") == "building" and f.get("source_survey_year") is not None})
    unknown_years = sum(f.get("kind") == "building" and f.get("source_survey_year") is None for f in features)
    terrain_path = "data/derived/kabukicho-terrain.json"
    terrain = read(terrain_path) if (ROOT / terrain_path).exists() else {}
    h0 = config["origin_jgd2011"]["height_m"]
    coordinate_system = (
        "Local right-handed east/up/south, metres; JGD2011 origin latitude "
        f"{config['origin_jgd2011']['latitude']}, longitude {config['origin_jgd2011']['longitude']}; "
        f"Building/terrain Y = source orthometric height minus {h0:g} m. Source road heights are all zero and treated as missing; road vertices use interpolated terrain Y + 0.02 m, with approximate triangulated interiors. "
        "Horizontal projection: GRS80 ECEF to local tangent east/north, Z = -north."
    )
    modern_years = {
        "dataset_release_year": config["source_year"],
        "dataset_creation_date": config["creation_date"],
        "building_survey_years": years,
        "buildings_with_unknown_survey_year": unknown_years,
        "survey_year_encoding": config.get("survey_year_encoding"),
        "note": "Release year, feature creation date and survey year are distinct. Per-feature survey years are retained; an unknown year is null."
    }
    modern_limit = (
        "Modern reference only. A shared orthometric datum preserves source relative elevations; the terrain is a modern source TIN, not a surveyed 1976 surface. "
        "All 176 selected LOD1 source roads have zero heights, interpreted as missing elevation. Road vertices are draped to the source TIN with a +0.02 m display offset; linearly triangulated polygon interiors are approximate and are not clipped to the TIN. "
        "Building survey years differ or are unknown. Context building identities, historic appearance and circa 1976 street levels are unverified."
    )
    layout_limit = (
        "Manual roof/plaza interpretation from approximately 1 m/pixel historical aerial imagery, uncertain capture date and approximate map-datum alignment. "
        "Proxy heights, plaza boundary, historical layout exclusions and camera placements are explicit hypotheses, not surveyed 1976 dimensions. "
        "The northern theatre identity, actual theatre entrance/façade axis and gate chronology remain unresolved. " + modern_limit
    )
    records = []

    def add(path, asset_id, asset_type, processing, dependencies, historical=False,
            provider=PROJECT, units="metres", authored_config=False,
            inference=None, source_only=None, coordinates=None):
        if not (ROOT / path).exists():
            return
        components = source_components(config, historical)
        if source_only == "gsi":
            components = [c for c in components if c["source_id"] == GSI_ID]
        photo_evidence = historical and asset_type != "source-intake-report"
        if photo_evidence:
            components.append({
                "source_id": PLAZA_PHOTO_ID,
                "provider": "新宿観光振興協会（写真再掲元）",
                "source_url": plaza_photo["catalog_url"],
                "related_catalogue_url": plaza_photo["related_catalogue_url"],
                "source_year": plaza_photo["source_year"],
                "evidence_only": True,
                "license": None, "license_url": None,
                "attribution": "劇場前広場のイベント（1975年）、新宿観光振興協会掲載。関連目録：新宿歴史博物館写真DB ID 9071。",
                "scope": "Visual research corroborating the inferred plaza/open-space boundary and reversible modern-feature omission hypotheses; not proof of exact historical footprints or feature absence. No photograph pixels or textures are embedded.",
                "rights_status": "Historical photograph redistribution permission is unconfirmed. This evidence citation grants no license to copy the photograph; derived geometry/configuration licenses do not apply to the source photograph."
            })
            dependencies = list(dict.fromkeys([*dependencies, PLAZA_PHOTO_ID]))
        sources = [c["source_url"] for c in components]
        if provider == PROJECT:
            sources.append(PROJECT_URL)
        source_years = [config["source_year"]] if source_only != "gsi" else []
        if historical:
            source_years.append({"from": 1974, "to": 1978, "exact_capture_date": None})
        if photo_evidence:
            source_years.append(1975)
        meta = {
            "schema_version": 1, "id": asset_id, "path": path, "type": asset_type,
            "provider": provider, "creator": PROJECT,
            "source_urls": sources, "retrieved_at": DATE,
            "license": "MIT" if authored_config else "CC-BY-4.0",
            "license_url": MIT if authored_config else CC_BY,
            "license_scope": ("Project-authored configuration; retain the distinct upstream terms and attribution in source_components."
                              if authored_config else "Derived data/preview: retain all applicable source_components credits and processing notice. The code repository MIT license does not replace upstream licenses."),
            "attribution": " ".join(c["attribution"] for c in components),
            "source_components": components, "source_years": source_years,
            "source_temporality": modern_years if source_only != "gsi" else {
                "source_period": [1974, 1978], "exact_capture_date": None},
            "target_year": 1976,
            "processing": processing, "dependencies": dependencies,
            "sha256": sha256(path), "format": Path(path).suffix.lstrip("."),
            "units": units, "coordinate_system": coordinates or coordinate_system,
            "geographic_confidence": "approximate", "historical_confidence": "unverified",
            "inferred_elements": inference or (layout_limit if historical else modern_limit),
            "redistribution_review": (
                "PLATEAU source archive README offers CC BY 4.0, selected for the source data. " if source_only != "gsi" else ""
            ) + ("GSI gazo1 is listed under attribution-only non-basic-survey tiles; GSI PDL 1.0 permits CC BY 4.0 use, which is selected here. " if historical else "")
              + "This artifact contains no redistributed archival photographs or raw aerial raster imagery."
        }
        if photo_evidence:
            meta["redistribution_review"] += " The 1975 plaza photograph is cited as evidence only; its redistribution permission and license remain unconfirmed."
        if source_only == "gsi":
            meta["coordinate_system"] = "GSI XYZ/Web Mercator tile indices, EPSG:3857; pixel coordinates in the 512 × 512 mosaic; not local metres."
        records.append(meta)

    intake_id = "kabukicho-plateau-intake-config"
    manifest_id = "kabukicho-plateau-intake-manifest"
    terrain_id = terrain.get("id", "plateau-13104-2025-terrain-crop")
    aerial_id = "kabukicho-gsi-aerial-manifest"
    modern_id = "kabukicho-r01-kabukicho-modern-features"
    hypothesis_id = "kabukicho-r01-kabukicho-layout-hypothesis"
    layout_id = "kabukicho-r01-kabukicho-layout-features"
    route_id = "kabukicho-route-proposal"
    add("data/kabukicho-intake.json", intake_id, "import-configuration",
        "Project-authored selection bounds, source member list, checksums, CRS, license selection and common orthometric datum for scripts/import_plateau.py.",
        [PLATEAU_ID], authored_config=True, units="selection bounds in degrees; orthometric datum in metres",
        coordinates="Source EPSG:6697, axis order latitude/longitude/orthometric height; the config also defines the local east/up/south origin.")
    add("data/derived/kabukicho-intake-manifest.json", manifest_id, "source-intake-report",
        "scripts/import_plateau.py verifies the source archive SHA-256, extracts the specified members, records member checksums and selection/mesh statistics without redistributing the upstream archive.",
        [intake_id, PLATEAU_ID], units="source byte lengths, feature counts and triangle counts",
        coordinates="Not a geometry asset; records the coordinate reference system and origin used by the derived models.")
    add(terrain_path, terrain_id, "terrain-data",
        "scripts/import_plateau.py streams the source DEM TIN, retains whole triangles intersecting the configured crop bounds, projects horizontal coordinates to local east/south and subtracts the single common orthometric datum. Barycentric interpolation uses the retained source triangles without smoothing or extrapolation.",
        [intake_id, PLATEAU_ID], provider="東京都・新宿区 / Project PLATEAU; cropped by " + PROJECT,
        inference=modern_limit)
    add(modern_path, modern_id, "geometry-data",
        "scripts/import_plateau.py selects whole LOD1 building/road features by the configured mean-vertex bounds rule, preserves source IDs and per-feature creation/survey dates, converts building/source-terrain elevations using one shared orthometric datum, and adds the cropped source TIN. All 176 selected LOD1 roads have source height 0.0, interpreted as missing: road vertices are draped to interpolated TIN height +0.02 m for display; triangulated polygon interiors remain approximate rather than TIN-clipped.",
        [intake_id, PLATEAU_ID, terrain_id], provider="東京都・新宿区 / Project PLATEAU; processed by " + PROJECT)
    add(f"{SCENE}/models/modern-baseline.gltf", "kabukicho-modern-baseline", "3d-model",
        "scripts/import_plateau.py triangulates the selected source LOD1 polygons and cropped DEM triangles, writes independent glTF meshes and explicit modern-reference roles, and retains PLATEAU attribution in asset.copyright. Building/terrain elevations preserve one common datum; the source-zero-height road vertices are draped to the DEM +0.02 m, with approximate polygon interiors. No historical aerial interpretation enters this model.",
        [modern_id], provider="東京都・新宿区 / Project PLATEAU; processed by " + PROJECT)
    add("data/derived/gsi-aerial-manifest.json", aerial_id, "source-intake-report",
        "Records the URLs, retrieval date, byte lengths and SHA-256 hashes of four internally inspected GSI gazo1 XYZ tiles. No raw raster tile is published with the manifest.",
        [GSI_ID], historical=True, units="tile indices and bytes", source_only="gsi")
    add("data/kabukicho-layout-hypothesis.json", hypothesis_id, "layout-hypothesis",
        "Project-authored manual annotations in a 512 × 512 GSI gazo1 tile mosaic: approximate roof outlines, an inferred plaza/street boundary, explicit proxy height assumptions, modern-feature replacement/exclusion hypotheses and provisional camera pixels. The registered 1975 plaza photograph corroborates the open-space/plaza interpretation and reversible modern-feature omission hypotheses; historic photo/catalogue URLs also support building identification research. No photograph pixels or textures are embedded, and the evidence citation grants no redistribution permission for the photograph.",
        [aerial_id, GSI_ID, PLAZA_PHOTO_ID], historical=True, authored_config=True, units="native aerial mosaic pixels; height assumptions in metres", source_only="gsi",
        inference="Project-authored interpretation of historical aerial imagery, with explicit roof/plaza annotations and assumed heights. Native pixels are not surveyed coordinates. The aerial period spans 1974–1978, its exact capture date is unknown, and historical building identity/entrance positions remain provisional. Modern feature IDs identify context to be replaced or excluded in the study; PLATEAU did not author this historical layout hypothesis.")
    add("data/derived/kabukicho-layout-features.json", layout_id, "geometry-data",
        "scripts/build_blockout.py copies modern context from the imported features, applies only the explicitly listed layout-study replacements/exclusions, converts the manual aerial roof/plaza annotations to local coordinates, extrudes roof proxies at assumed heights above sampled terrain and records their inferred roles. The preserved modern baseline is a separate asset.",
        [modern_id, hypothesis_id, terrain_id], historical=True)
    add(f"{SCENE}/cameras/route-proposal.json", route_id, "camera-route",
        "scripts/build_blockout.py converts provisional aerial-space camera stations to local coordinates, places each camera 1.6 m above interpolated modern terrain, derives the route and viewing directions, and samples route/footprint clearance. This is a geometry-study route, not a historical survey or approved film camera move.",
        [layout_id, hypothesis_id, terrain_id], historical=True)
    for path in sorted((ROOT / f"{SCENE}/cameras").glob("*.json")):
        if path.name == "route-proposal.json" or path.name.endswith(".asset.json"):
            continue
        add(path.relative_to(ROOT).as_posix(), "kabukicho-camera-" + path.stem, "camera-station",
            "scripts/build_blockout.py writes this station's position, terrain-relative eye height, look target and provisional role from the shared route proposal. This file does not contain a new independent coordinate survey.",
            [route_id], historical=True)
    add("data/derived/route-collision-report.json", "kabukicho-route-collision-report", "geometry-validation-report",
        "scripts/build_blockout.py samples the proposed route against the layout-study static building footprints, records collision feature IDs and sampled edge clearance, and reports the stated validation scope. It does not certify historical building identity, pedestrian swept-volume safety or final continuous camera motion.",
        [route_id, layout_id], historical=True)
    add("data/derived/camera-framing-report.json", "kabukicho-camera-framing-report", "geometry-validation-report",
        "scripts/render_blockout.py rasterizes each current fixed-camera view, counts visible pixels by geometric feature role and reports frame occupancy. This checks provisional geometry/framing only; it does not measure historical accuracy, photographic realism or approved final movie composition.",
        [route_id, layout_id], historical=True, units="visible pixel fractions and metres")
    add(f"{SCENE}/models/layout-study.gltf", "kabukicho-layout-study", "3d-model",
        "scripts/build_blockout.py triangulates the layout-study features, assigns distinct modern/inferred materials and roles, embeds the six shared camera stations, and writes PLATEAU plus GSI processing attribution in glTF asset.copyright.",
        [layout_id, route_id], historical=True)
    preview_dir = ROOT / "docs/previews/r01"
    for path in sorted(preview_dir.iterdir()):
        if path.suffix not in {".png", ".svg"}:
            continue
        role = path.stem
        deps = [layout_id, route_id]
        if role in {"route-plan", "blockout-overview"}:
            operation = "projects the complete provisional street/layout model and route into a labeled plan/overview"
        elif role == "camera-contact-sheet":
            operation = "combines the six fixed-camera geometry previews into a labeled contact sheet"
        elif role == "arrival-context-diagnostic":
            operation = "renders the explicitly labeled layout/context visibility comparison; any restored or hidden modern feature is a diagnostic variant, not a certified historical view"
            deps.append(hypothesis_id)
        elif role == "arrival-camera-revision":
            operation = "compares archived E/F previews from the prior flat-ground geometry and prior camera positions with the revised terrain-aware layout and revised camera positions; both geometry and camera placement change, so this is not an isolated camera-only comparison"
            deps.append(hypothesis_id)
        elif role == "arrival-oblique":
            operation = "renders an additional oblique arrival diagnostic from the current provisional scene"
        else:
            operation = "renders the named fixed-camera station from the current provisional scene"
            deps.append("kabukicho-camera-" + role)
        add(path.relative_to(ROOT).as_posix(), "kabukicho-r01-" + role + ("-svg" if path.suffix == ".svg" else ""),
            "geometry-preview", "scripts/render_blockout.py " + operation + "; rasterizes geometry with study materials, draws labels and includes source/uncertainty notices. No archival photograph raster or generated colour master is used as a texture.",
            deps, historical=True, units="pixels; geometry is in metres")
        if role == "arrival-camera-revision":
            before_urls = [f"{PROJECT_URL}/blob/{PRIOR_REVISION}/docs/previews/r01/{name}.png"
                           for name in ("plaza-reveal", "koma-front")]
            records[-1]["prior_revision"] = PRIOR_REVISION
            records[-1]["prior_preview_source_urls"] = before_urls
            records[-1]["source_urls"].extend(before_urls)
            records[-1]["comparison_scope"] = {
                "before": "Archived E/F rasters from the specified prior commit, using the previous flat-ground geometry and previous camera positions.",
                "after": "Current E/F rasters, using the revised common-datum terrain-aware geometry, explicit layout exclusions and revised camera positions.",
                "controlled_comparison": False,
                "limitation": "The image compares revisions; it does not isolate the effect of camera placement from terrain/layout changes."
            }

    for meta in records:
        write(meta["path"] + ".asset.json", meta)
    update_sources(config, modern_years, terrain)
    print(json.dumps({"asset_records_refreshed": len(records), "sha256_refreshed": True,
                      "approved_reference_masters_modified": False, "building_survey_years": years,
                      "buildings_with_unknown_survey_year": unknown_years}, ensure_ascii=False))


def update_sources(config, temporality, terrain):
    sources = read("data/sources.json")
    for source in sources["sources"]:
        if source["id"] in {"plateau", PLATEAU_ID}:
            source["id"] = PLATEAU_ID
            source["aliases"] = ["plateau"]
            source["notes"] = (
                f"Dataset release {config['source_year']}, created {config['creation_date']}; source surveys and imagery span multiple years. "
                "The same source archive supplies buildings, roads and DEM terrain. One common orthometric datum preserves building/terrain elevations. "
                "All 176 selected source roads have height 0.0, treated as missing: road vertices are draped to the DEM with a +0.02 m display offset; "
                "triangulated polygon interiors are approximate, not TIN-clipped. "
                "the modern underlay does not represent one current-city epoch and is not 1976 evidence."
            )
            source["source_temporality"] = temporality
            source["terrain_member"] = config.get("terrain_member")
            source["terrain_asset_id"] = terrain.get("id", "plateau-13104-2025-terrain-crop")
        elif source["id"] == GSI_ID:
            source["license"] = "CC-BY-4.0"
            source["license_url"] = CC_BY
            source["upstream_terms"] = "PDL 1.0; CC BY 4.0 use selected under section 1.7(3)"
            source["upstream_terms_urls"] = [GSI_TERMS, PDL]
            source["terms_checked_at"] = DATE
            source["attribution"] = "国土地理院 地理院タイル gazo1（1974〜1978年）を参照・加工し、showa-tokyo-3d project が配置仮説を作成。"
            source["redistribution_review"] = "GSI tile catalogue lists gazo1 under non-basic-survey tiles usable with attribution. The project distributes annotated geometry/configuration only; raw tiles and archival photographs are not redistributed. GSI PDL 1.0 permits CC BY 4.0 use, selected here."
            source["notes"] = "XYZ tiles z17 x116399–116400 y51606–51607. Roof/plaza annotations are approximate manual interpretations, not surveyed ground footprints or exact 1976 conditions."
    write("data/sources.json", sources)


if __name__ == "__main__":
    main()
