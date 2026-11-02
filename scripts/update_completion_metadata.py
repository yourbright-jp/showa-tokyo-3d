#!/usr/bin/env python3
"""Refresh provenance for the adopted R03 reconstruction, without changing R01.

Run after all decision, scene, walk and preview generators. This tool does not
turn an adopted inference into a verified historical claim, redistribute source
photographs, or alter the immutable approved colour-reference masters.
"""
import argparse
import hashlib
import json
from pathlib import Path

from import_plateau import ROOT, write_json
from update_asset_metadata import PROJECT, PROJECT_URL, DATE, CC_BY, MIT, source_components

SCENE = "scenes/shinjuku/kabukicho/1976"
DECISIONS = {
    "gate": "data/decisions/kabukicho-gate-1976.json",
    "koma": "data/decisions/kabukicho-koma-plaza-1976.json",
    "surfaces": "data/decisions/kabukicho-route-surfaces-1976.json",
}
IDS = {
    "gate": "kabukicho-gate-1976", "koma": "kabukicho-koma-plaza-1976",
    "surfaces": "kabukicho-route-surfaces-1976", "features": "kabukicho-period-features",
    "classification": "kabukicho-feature-classification", "model": "kabukicho-reconstruction-adopted",
    "spec": "kabukicho-period-scene-spec", "walk": "kabukicho-adopted-walk",
    "report": "kabukicho-route-completion", "text_meshes": "kabukicho-sign-text-meshes",
    "render_manifest": "kabukicho-period-render-manifest",
}
BASE_DEPS = ["kabukicho-r01-kabukicho-modern-features", "plateau-13104-2025-terrain-crop",
             "kabukicho-r01-kabukicho-layout-hypothesis"]
PATHS = {
    **DECISIONS,
    "features": "data/derived/kabukicho-period-features.json",
    "classification": "data/derived/kabukicho-feature-classification.json",
    "model": f"{SCENE}/models/reconstruction-adopted.gltf",
    "spec": f"{SCENE}/reconstruction/period-scene-spec.json",
    "walk": f"{SCENE}/cameras/adopted-walk.json",
    "report": "data/derived/kabukicho-route-completion.json",
    "text_meshes": "data/derived/kabukicho-sign-text-meshes.json",
    "render_manifest": "data/derived/kabukicho-period-render-manifest.json",
}


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def decision_evidence(paths):
    """Keep local evidence IDs separate from registered external source IDs."""
    registry = read("data/sources.json")["sources"]
    by_id = {s["id"]: s for s in registry}
    by_url = {}
    for source in registry:
        for key in ("catalog_url", "image_url", "additional_url", "related_catalogue_url"):
            if source.get(key):
                by_url[source[key]] = source["id"]
    result, seen = [], set()
    for path in paths:
        if not (ROOT / path).exists():
            continue
        document = read(path)
        evidence = document.get("evidence", [])
        if isinstance(evidence, dict):
            evidence = [{"id": key, **value} for key, value in evidence.items()]
        for item in evidence:
            if not isinstance(item, dict):
                continue
            urls = item.get("urls", item.get("source_urls", []))
            if isinstance(urls, str):
                urls = [urls]
            urls = list(dict.fromkeys([*urls, *[item[k] for k in ("url", "source_url") if item.get(k)]]))
            for url in urls:
                if not url.startswith(("https://", "http://")):
                    raise ValueError("Evidence URLs must be public web URLs: " + url)
                evidence_id = item.get("id", item.get("source_id", document["id"]))
                identity = (document["id"], evidence_id, url)
                if identity in seen:
                    continue
                seen.add(identity)
                source_id = item.get("source_id", item.get("id"))
                if source_id not in by_id:
                    source_id = by_url.get(url, "historical-photographs")
                component = {
                    "source_id": source_id,
                    "evidence_id": evidence_id,
                    "provider": item.get("provider", by_id.get(source_id, {}).get("name", "Linked source publisher")),
                    "source_url": url,
                    "source_year": item.get("source_year", item.get("year")),
                    "publication_year": item.get("publication_year"),
                    "what_supports": item.get("what_supports", item.get("supports", item.get("description"))),
                    "evidence_only": True,
                    "license": None,
                    "license_url": None,
                    "rights_status": "Cited research evidence only. No source photograph, aerial raster or page image is embedded; this citation grants no redistribution right in the source material.",
                    "decision_asset_id": document["id"],
                }
                for temporal_key in ("year_role", "represented_event_year", "year_range", "source_year_range",
                                     "capture_date", "capture_date_status", "source_date_status"):
                    if temporal_key in item:
                        component[temporal_key] = item[temporal_key]
                result.append(component)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-complete", action="store_true",
                        help="Fail if any adopted-scene decision/model/walk/report is missing")
    args = parser.parse_args()
    if args.require_complete:
        missing = [path for path in PATHS.values() if not (ROOT / path).is_file()]
        if missing:
            raise FileNotFoundError("Missing completion outputs: " + ", ".join(missing))

    config = read("data/kabukicho-intake.json")
    geo = source_components(config, historical=True)
    glyph_font = read(PATHS["text_meshes"]).get("font", {}) if (ROOT / PATHS["text_meshes"]).exists() else {}
    records = []
    origin = config["origin_jgd2011"]
    coordinates = {"kind": "local-cartesian", "units": "metres", "handedness": "right",
                   "axes": {"x": "east", "y": "up", "z": "south"},
                   "source_crs": config["source_crs"], "origin_jgd2011": origin,
                   "vertical_reference": "Modern source orthometric terrain/building height minus one common 32 m datum; adopted historic forms and surfaces are explicit inferences."}

    def add(path, key, kind, processing, dependencies, decisions=(), geospatial=False,
            authored=False, units="metres", extra=None):
        if not (ROOT / path).is_file():
            return
        components = [dict(c) for c in geo] if geospatial else []
        components.extend(decision_evidence([DECISIONS[name] for name in decisions]))
        if extra and extra.get("font_provenance"):
            artifact = read(path) if path.endswith(".json") else {}
            font = artifact.get("font", {})
            if not isinstance(font, dict):
                font = {}
            if not font:
                font = glyph_font
            font_source = next((s for s in read("data/sources.json")["sources"]
                                if s["id"] == "noto-cjk-blender-4-5-15"), None)
            if font_source is None:
                raise ValueError("Register the verified Blender/Noto font source before publishing glyph-derived assets")
            components.append({
                "source_id": font_source["id"],
                "provider": "The Noto Project Authors; bundled with official Blender 4.5.15 LTS",
                "source_url": "https://download.blender.org/release/Blender4.5/",
                "license": "OFL-1.1", "license_url": "https://openfontlicense.org/open-font-license-official-text/",
                "font_name": font.get("name", "Noto Sans CJK SC Regular"),
                "font_file_sha256": font.get("sha256"),
                "attribution": "Copyright 2018 The Noto Project Authors; SIL Open Font License 1.1.",
                "scope": "Production typography for specific modelled sign strings. This is not evidence of the exact historical lettering, and no font binary is redistributed.",
                "evidence_only": False,
            })
        years = sorted({year for component in components
                        for year in [component.get("source_year"), component.get("source_release_year")]
                        if isinstance(year, int)})
        periods = []
        for component in components:
            period = component.get("source_period")
            if period and period not in periods:
                periods.append(period)
        asset_id = IDS.get(key, key)
        meta = {
            "schema_version": 1, "id": asset_id, "path": path, "type": kind,
            "provider": PROJECT, "creator": PROJECT, "retrieved_at": DATE,
            "source_urls": list(dict.fromkeys([PROJECT_URL, *[c["source_url"] for c in components]])),
            "source_components": components,
            "license": "MIT" if authored else "CC-BY-4.0",
            "license_url": MIT if authored else CC_BY,
            "license_scope": ("Project-authored decision/configuration. Retain the separate upstream attribution and evidence-only rights notices."
                              if authored else "Project-derived scene/render; preserve PLATEAU/GSI attribution where present. This output license does not apply to cited archival photographs or generated colour master images."),
            "attribution": " ".join(dict.fromkeys(c.get("attribution", c.get("provider", "")) for c in components)),
            "source_years": years,
            "source_periods": periods,
            "source_years_scope": "Associated source and represented-event years. Consult each component's year_role, represented_event_year, publication_year and year_range before treating a year as a photograph capture date.",
            "target_year": 1976,
            "processing": processing,
            "dependencies": list(dict.fromkeys(dependencies)),
            "sha256": digest(path), "size_bytes": (ROOT / path).stat().st_size,
            "format": Path(path).suffix.lstrip("."), "units": units,
            "coordinate_system": coordinates if units == "metres" else None,
            "geographic_confidence": "approximate", "historical_confidence": "inferred",
            "adoption_status": "adopted-with-inference",
            "historical_fact_certification": False,
            "inferred_elements": "The user authorized a complete, coherent reconstruction hypothesis. Adoption settles production choices, not historical uncertainty. Exact gate chronology, unseen facades, dimensions, paint colours, context-building survival, plaza objects and historic surface levels remain inferred as recorded in the linked decisions.",
            "redistribution_review": "Only authored/derived geometry, configuration or rendered output is published. Cited archival photographs and source rasters are evidence only and are not republished; no photo-license grant is asserted.",
        }
        if extra:
            meta.update(extra)
        records.append(meta)

    add(PATHS["gate"], "gate", "historical-adoption-decision",
        "Selects the curved incandescent gate for the circa-1976 reconstruction by extrapolating the attributed 1978 photograph, retains the rectangular-1972 chronology conflict and records assumed dimensions, paint, reverse face and placement. No source image is embedded.",
        ["kabukicho-route-proposal", "R01", "R08"], decisions=("gate",), authored=True)
    add(PATHS["koma"], "koma", "historical-adoption-decision",
        "Adopts distinct Koma and neighbouring theatre identities/frontage parameters plus approximate plaza props from historical photo/aerial research. Documents source dates, rejected alternatives, inferred colours and dimensions, and geometry assumptions.",
        ["kabukicho-r01-kabukicho-layout-hypothesis"], decisions=("koma",), geospatial=True, authored=True)
    add(PATHS["surfaces"], "surfaces", "surface-adoption-decision",
        "Independently locates the original unclassified R01 route samples, adopts explicit connecting-paving polygons and records their evidence and inferred status rather than silently reclassifying them as modern surveyed road.",
        ["kabukicho-route-proposal", IDS["koma"], "plateau-13104-2025-terrain-crop"],
        decisions=("surfaces", "koma"), geospatial=True, authored=True)
    add(PATHS["spec"], "spec", "scene-generation-specification",
        "Records all procedural reconstruction rules and adopted decision references used by scripts/build_period_scene.py, including inferred context-building treatments, physical facade/fixture generation and common-datum coordinates.",
        [*BASE_DEPS, IDS["gate"], IDS["koma"], IDS["surfaces"]],
        decisions=("gate", "koma", "surfaces"), geospatial=True, authored=True)
    add(PATHS["classification"], "classification", "complete-feature-classification",
        "scripts/build_period_scene.py enumerates every selected modern source feature exactly once, records its adopted disposition, reason, evidence/decision IDs and generated output feature IDs. Inferred period context is not a claim of verified 1976 survival.",
        [BASE_DEPS[0], IDS["spec"]], decisions=("gate", "koma", "surfaces"), geospatial=True,
        units="feature identifiers and classification records")
    add(PATHS["features"], "features", "adopted-period-geometry-data",
        "scripts/build_period_scene.py generates the adopted terrain-based ground, period-context masses, physical gate, facade depth and plaza fixtures from explicit decision parameters. Geometry remains world-referenced in metres; historical assumptions are retained per feature and decision.",
        [IDS["spec"], IDS["classification"], *BASE_DEPS], decisions=("gate", "koma", "surfaces"), geospatial=True)
    model_dependencies = [IDS["features"], IDS["spec"]]
    add(PATHS["model"], "model", "3d-model",
        "scripts/build_period_scene.py triangulates the adopted period features into self-contained glTF, assigns study materials, embeds fixed diagnostic cameras and preserves PLATEAU/GSI attribution. Explicit sign strings are materialized as extruded world-space glyph meshes from kabukicho-sign-text-meshes; the text recipe is retained for reproducibility. Neither photographic billboards nor a font binary are embedded.",
        model_dependencies, decisions=("gate", "koma", "surfaces"), geospatial=True)
    add(PATHS["walk"], "walk", "adopted-camera-walk",
        "scripts/complete_route.py densifies the adopted walk over source terrain, places eye positions above that terrain, assigns surface categories and records a continuous time/orientation plan. Film lens and motion settings are explicit, separately from the six R01 diagnostic viewpoints.",
        [IDS["surfaces"], IDS["features"], "kabukicho-route-proposal"],
        decisions=("gate", "koma", "surfaces"), geospatial=True)
    add(PATHS["report"], "report", "continuous-route-validation-report",
        "scripts/complete_route.py audits the original unclassified samples and adopted surface coverage, then checks continuous static geometry clearance with an explicit body radius and height, including modelled plaza fixtures. The result applies to the adopted model, not measured historical pedestrian safety.",
        [IDS["walk"], IDS["surfaces"], IDS["features"]],
        decisions=("gate", "koma", "surfaces"), geospatial=True,
        units="metres, seconds, surface categories and validation counts")

    font_notice = {
        "provider": "The Noto Project Authors; font supplied in the official Blender distribution",
        "license": "OFL-1.1",
        "license_url": "https://openfontlicense.org/open-font-license-official-text/",
        "source_url": "https://download.blender.org/release/Blender4.5/",
        "bundled_license_evidence": "Blender 4.5.15 LTS license/license.md, Noto Fonts entry; license/spdx/OFL-1.1.txt",
        "font_binary_redistributed": False,
        "scope": "Specific sign-text outlines or rasterized glyphs only, rather than a redistributed font binary. Preserve font provenance separately from the scene's geographic-data license.",
    }
    add(PATHS["text_meshes"], "text_meshes", "sign-text-meshes",
        "scripts/render_period_scene.py uses the official Blender-bundled Noto Sans CJK SC Regular font to extrude the explicit sign strings from the period scene's text-node recipe into world-space triangles. Visible glyph bounds, rather than font-em dimensions, are fitted to the requested physical height and centered at each sign position. The recorded text-node input hash ties the glyph meshes to their placement recipe; scripts/build_period_scene.py appends the resulting glyph geometry to the distributable glTF. No source photograph or font binary is embedded.",
        [IDS["spec"], IDS["gate"], IDS["koma"]], decisions=("gate", "koma"), geospatial=True,
        extra={"font_provenance": font_notice})
    add(PATHS["render_manifest"], "render_manifest", "render-provenance-manifest",
        "scripts/render_period_scene.py records actual Blender/runtime, font, renderer settings, shared fixed-camera transforms and sparse adopted-walk frame times for the period-scene previews. Sparse frames validate selected views, not every frame of a completed long-take movie.",
        [IDS["model"], IDS["walk"], IDS["text_meshes"], "kabukicho-route-proposal"],
        decisions=("gate", "koma", "surfaces"), geospatial=True, authored=True,
        units="render settings, camera metres, seconds and file hashes", extra={"font_provenance": font_notice})

    entrance_spec = f"{SCENE}/detail/entrance-detail-spec.json"
    if (ROOT / entrance_spec).exists():
        entrance_id = read(entrance_spec).get("id", "kabukicho-entrance-detail-r03")
        add(entrance_spec, entrance_id, "entrance-generation-specification",
            "Project-authored near-field entrance facade, gate, text, material and lighting specification; adapts the accepted appearance targets to a shared terrain-aware 3D study. Precise historic identity and unseen dimensions are inferred, not certified.",
            [IDS["gate"], "kabukicho-route-proposal", "R01", "R08"], decisions=("gate",),
            geospatial=True, authored=True)
    else:
        entrance_id = None

    entrance_manifest = "docs/previews/r03/entrance-render-manifest.json"
    entrance_manifest_id = "kabukicho-entrance-render-manifest"
    if entrance_id and (ROOT / entrance_manifest).exists():
        add(entrance_manifest, entrance_manifest_id, "render-provenance-manifest",
            "scripts/build_entrance_detail.py records the actual Blender version, engine, render dimensions/samples, supplied font identity/hash, camera transforms and shared-terrain checks used to generate the entrance stills. This is execution provenance, not historical certification.",
            [entrance_id, IDS["gate"], "kabukicho-route-proposal"], decisions=("gate",),
            geospatial=True, authored=True, units="render settings, camera metres and file hashes",
            extra={"font_provenance": font_notice})

    preview_dir = ROOT / "docs/previews/r03"
    if preview_dir.exists():
        period_render = read(PATHS["render_manifest"]) if (ROOT / PATHS["render_manifest"]).exists() else {}
        entrance_render = read(entrance_manifest) if (ROOT / entrance_manifest).exists() else {}
        for preview in sorted(preview_dir.iterdir()):
            if preview.suffix not in {".png", ".jpg", ".jpeg", ".svg"}:
                continue
            path = preview.relative_to(ROOT).as_posix()
            entrance = preview.stem.startswith("entrance-")
            walk_view = preview.stem.startswith(("walk-", "period-walk-"))
            dependencies = ([entrance_id, IDS["gate"], "R01", "R08"] if entrance and entrance_id else
                            [IDS["model"], IDS["walk"] if walk_view else "kabukicho-route-proposal"])
            if entrance and (ROOT / entrance_manifest).exists():
                dependencies.append(entrance_manifest_id)
            elif not entrance and (ROOT / PATHS["render_manifest"]).exists():
                dependencies.append(IDS["render_manifest"])
            extra = {"source_photographs_embedded": False,
                     "appearance_reference_role": "Visual colour/material target only; never counted as independent historical evidence."}
            if entrance:
                extra["font_scope"] = "Font glyphs may appear in the rendered image; this raster does not distribute a font file. Consult the render manifest/specification for the supplied font and runtime."
            extra["font_provenance"] = font_notice
            operation = ("Procedural Blender entrance still from scripts/build_entrance_detail.py and its recorded render settings, using the adopted inferred gate and stable three-dimensional text/facades."
                         if entrance else "Rendered diagnostic of the shared adopted period model and walk. Study appearance does not establish historical identity, materials or final movie quality.")
            if preview.stem in {"period-contact-sheet", "walk-contact-sheet"}:
                walk_sheet = preview.stem == "walk-contact-sheet"
                frames = [item for item in period_render.get("images", [])
                          if item["camera"].startswith("walk-") == walk_sheet]
                dependencies.extend("kabukicho-r03-" + Path(item["path"]).stem for item in frames)
                extra["input_preview_paths"] = [item["path"] for item in frames]
                operation = ("scripts/assemble_completion_previews.py combines the eight sparse adopted-walk stills into a labelled contact sheet; selected frames are not a complete rendered movie."
                             if walk_sheet else "scripts/assemble_completion_previews.py combines the six shared fixed-camera period stills into a labelled contact sheet.")
            elif entrance:
                frame = next((item for item in entrance_render.get("published_previews", []) if item["path"] == path), {})
                extra.update({"camera_id": frame.get("camera_id"),
                              "render_engine": entrance_render.get("engine"),
                              "render_samples": entrance_render.get("samples"),
                              "render_resolution_px": entrance_render.get("resolution")})
            else:
                frame = next((item for item in period_render.get("images", []) if item["path"] == path), {})
                extra.update({"camera_id": frame.get("camera"),
                              "walk_time_s": frame.get("time_s"),
                              "walk_phase": frame.get("phase"),
                              "source_model_sha256": period_render.get("source_render", {}).get("model_sha256")})
                if frame.get("camera"):
                    operation = (f"scripts/render_period_scene.py renders the adopted walk at recorded time {frame.get('time_s')} s using the shared model and current walk pose; scripts/assemble_completion_previews.py copies the PNG byte-for-byte."
                                 if walk_view else f"scripts/render_period_scene.py renders shared fixed diagnostic camera {frame['camera']}; scripts/assemble_completion_previews.py copies the PNG byte-for-byte.")
            add(path, "kabukicho-r03-" + preview.stem + ("-svg" if preview.suffix == ".svg" else ""),
                "rendered-reconstruction-preview",
                operation + " No archival photograph is copied as a billboard or texture; preserve the labelled inferred status.",
                dependencies, decisions=("gate",) if entrance else ("gate", "koma", "surfaces"),
                geospatial=True, units="pixels" if preview.suffix != ".svg" else "drawing units", extra=extra)

    # The period feature JSON itself contains the baked glyph triangles after
    # the second builder pass. Both that JSON and the glTF therefore inherit
    # font provenance, rather than assigning it only to the model sidecar.
    if (ROOT / PATHS["text_meshes"]).exists():
        baked_assets = set()
        if (ROOT / PATHS["features"]).exists():
            feature_data = read(PATHS["features"])
            if any(feature.get("role") == "stable-sign-lettering" for feature in feature_data["features"]):
                baked_assets.add(IDS["features"])
        if (ROOT / PATHS["model"]).exists():
            if read(PATHS["model"]).get("extras", {}).get("font_meshes_included"):
                baked_assets.add(IDS["model"])
        font_components = next((record["source_components"] for record in records
                                if record["id"] == IDS["text_meshes"]), [])
        font_component = next((component for component in font_components
                               if component["source_id"] == "noto-cjk-blender-4-5-15"), None)
        if font_component is None:
            raise ValueError("Glyph source metadata lacks the registered Noto font component")
        for record in records:
            if record["id"] not in baked_assets:
                continue
            record["dependencies"] = list(dict.fromkeys([*record["dependencies"], IDS["text_meshes"]]))
            record["font_provenance"] = dict(font_notice)
            record["source_components"].append(dict(font_component))
            record["source_urls"] = list(dict.fromkeys([*record["source_urls"], font_component["source_url"]]))
            record["attribution"] += " " + font_component["attribution"]

    ids = [r["id"] for r in records]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate R03 asset IDs")
    for record in records:
        write_json(ROOT / (record["path"] + ".asset.json"), record)
    print(json.dumps({"r03_asset_records_refreshed": len(records), "sha256_refreshed": True,
                      "legacy_r01_records_modified": False,
                      "approved_reference_masters_modified": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
