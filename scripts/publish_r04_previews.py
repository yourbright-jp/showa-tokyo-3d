#!/usr/bin/env python3
"""Publish representative r04 (three.js code-generated) stills with provenance sidecars.

Copies a small, representative subset of `renders/` (git-ignored) into
`docs/previews/r04/`, writes a render manifest and an adjacent `*.asset.json` for
every published file and for the r04 review camera. Full-resolution renders stay
in `renders/`. Nothing here upgrades an inferred element to a verified fact.

Usage:
  python3 scripts/publish_r04_previews.py --stations renders/r04-final \
      --walk renders/r04-final-walk --out docs/previews/r04 --date 2026-11-03
  python3 scripts/publish_r04_previews.py --metadata-only --out docs/previews/r04 --date 2026-11-03
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCENE = "scenes/shinjuku/kabukicho/1976"
PROJECT = "yourbright-jp/showa-tokyo-3d contributors"
PROJECT_URL = "https://github.com/yourbright-jp/showa-tokyo-3d"
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
PLATEAU_URL = "https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/13104_shinjuku-ku_pref_2025_citygml_1_op.zip"
GSI_URL = "https://maps.gsi.go.jp/development/ichiran.html"
VIEW_IDS = ["r04-gate-establishing", "r04-gate-rear", "r04-milano-front"]
CAMERAS = {v: f"{SCENE}/cameras/{v}.json" for v in VIEW_IDS}
STATION_IDS = ["entrance-approach", "under-gate", "ichibangai-middle", "towards-koma-corner", "plaza-reveal", "koma-front"]
STILL_SIZE = (1920, 1080)
WALK_SIZE = (1280, 720)
# Data files the viewer reads (viewer/src/core/data.js); hashed into the manifest.
INPUTS = [
    f"{SCENE}/scene.json", "data/derived/kabukicho-layout-features.json", "data/derived/kabukicho-terrain.json",
    "data/derived/kabukicho-period-features.json", f"{SCENE}/cameras/adopted-walk.json",
    "data/decisions/kabukicho-gate-1976.json", "data/decisions/kabukicho-koma-plaza-1976.json",
    "data/decisions/kabukicho-route-surfaces-1976.json",
] + list(CAMERAS.values()) + [f"{SCENE}/cameras/{s}.json" for s in STATION_IDS]
FONTS = [
    {"family": "IPAGothic", "package": "fonts-ipafont-gothic 00303", "license": "IPA Font License Agreement v1.0",
     "license_url": "https://moji.or.jp/ipafont/license/", "font_binary_redistributed": False},
    {"family": "WenQuanYi Zen Hei (fallback only)", "package": "fonts-wqy-zenhei 0.9.45", "license": "GPL-2.0 with font embedding exception",
     "license_url": "http://wenq.org/wqy2/index.cgi?ZenHei", "font_binary_redistributed": False},
]
DEPENDENCIES = ["kabukicho-period-features", "kabukicho-gate-1976", "kabukicho-koma-plaza-1976",
                "kabukicho-route-surfaces-1976", "kabukicho-adopted-walk", "plateau-13104-2025-terrain-crop",
                "kabukicho-r01-kabukicho-layout-features"]


def sha256(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def write_json(path, value):
    (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def source_components():
    return [
        {"source_id": "plateau-13104-shinjuku-ku-2025", "provider": "東京都・新宿区 / Project PLATEAU", "source_url": PLATEAU_URL,
         "license": "CC-BY-4.0", "license_url": CC_BY, "attribution": "東京都・新宿区 3D都市モデル（Project PLATEAU）2025年度を加工して作成",
         "source_release_year": 2025,
         "scope": "Modern building footprints, road polygons and DEM used as the spatial underlay; not evidence of 1976 conditions."},
        {"source_id": "gsi-gazo1-1974-1978", "provider": "国土地理院 / Geospatial Information Authority of Japan", "source_url": GSI_URL,
         "source_period": [1974, 1978], "exact_capture_date": None, "license": "CC-BY-4.0", "license_url": CC_BY,
         "attribution": "国土地理院 地理院タイル gazo1（1974〜1978年）を参照・加工し、showa-tokyo-3d project が配置仮説を作成。",
         "scope": "Inherited through the adopted r03 layout (theatre roof outlines, plaza); raw tiles are not embedded."},
    ]


def base_record(rel, kind, date):
    return {
        "schema_version": 1,
        "id": "",
        "path": rel,
        "type": kind,
        "provider": PROJECT,
        "creator": PROJECT,
        "retrieved_at": date,
        "source_urls": [PROJECT_URL, PLATEAU_URL, GSI_URL],
        "source_components": source_components(),
        "license": "CC-BY-4.0",
        "license_url": CC_BY,
        "license_scope": "Project-derived render/configuration; keep the PLATEAU and GSI attribution. Does not license cited archival photographs or the approved colour masters.",
        "attribution": "東京都・新宿区 3D都市モデル（Project PLATEAU）2025年度を加工して作成 / 国土地理院 地理院タイル gazo1（1974〜1978年）を参照・加工 / showa-tokyo-3d project によるコード生成",
        "source_years": [2025, {"from": 1974, "to": 1978, "exact_capture_date": None}],
        "source_years_scope": "Underlay data years. The adopted landmark decisions cite 1957-1979 sources; see the linked decision records for each year's role.",
        "target_year": 1976,
        "dependencies": DEPENDENCIES,
        "sha256": sha256(rel),
        "size_bytes": (ROOT / rel).stat().st_size,
        "geographic_confidence": "approximate",
        "historical_confidence": "inferred",
        "adoption_status": "adopted-with-inference",
        "historical_fact_certification": False,
        "redistribution_review": "Only code-generated output is published. No photograph, scanned texture, external 3D model or HDR is embedded; the approved colour masters were used only for side-by-side comparison outside these images.",
        "source_photographs_embedded": False,
    }


def image_record(rel, date, meta):
    r = base_record(rel, "rendered-reconstruction-preview", date)
    r.update({
        "processing": meta["processing"],
        "format": Path(rel).suffix.lstrip(".").replace("jpg", "jpeg"),
        "units": "pixels",
        "coordinate_system": None,
        "inferred_elements": "Shopfronts, sign trades and fictional shop names, window interiors, people, clothing, vehicles, street furniture, weathering, lighting and colour grade are period-plausible-generic code generation. Gate, theatre fronts, fountain and lamps follow the adopted r03 inferred decisions. Building heights follow the r03 adopted context rule over modern PLATEAU footprints. The clear-afternoon light is a visual working choice, not a 1976 date/time/weather claim.",
        "appearance_reference_role": "Approved colour masters R01-R09 were compared side by side as a visual target only; never counted as historical evidence and not copied into the image.",
        "font_provenance": {"fonts": FONTS, "scope": "Sign text is rasterised from system fonts into generated canvas textures or extruded glyph outlines; no font binary is redistributed. Typeface details are a production choice, not matched period lettering."},
        "renderer": meta["renderer"],
        "camera_id": meta.get("camera_id"),
        "walk_time_s": meta.get("walk_time_s"),
        "render_resolution_px": meta.get("render_resolution_px"),
        "published_resolution_px": meta.get("published_resolution_px"),
        "render_manifest": "docs/previews/r04/render-manifest.json",
    })
    r["dependencies"] = DEPENDENCIES + ["kabukicho-r04-render-manifest"] + (["kabukicho-r04-camera-" + meta["camera_id"].removeprefix("r04-")] if meta.get("camera_id") in VIEW_IDS else [])
    return r


def camera_record(view_id, date):
    rel = CAMERAS[view_id]
    cam = json.loads((ROOT / rel).read_text(encoding="utf-8"))
    r = base_record(rel, "camera-review-view", date)
    deps = ["plateau-13104-2025-terrain-crop"] + (["kabukicho-gate-1976"] if "gate" in view_id else ["kabukicho-period-features"])
    r.update({
        "id": "kabukicho-r04-camera-" + view_id.removeprefix("r04-"),
        "processing": "scripts/make_r04_views.py: " + json.dumps(cam["derivation"], ensure_ascii=False) + f"; eye 1.6 m above the modern DEM TIN; {cam['focal_length_35mm_equivalent_mm']} mm equivalent.",
        "format": "json",
        "units": "metres",
        "coordinate_system": "local east-up-south metres; origin JGD2011 35.6945, 139.702, 32.0 m (scene.json)",
        "inferred_elements": "Review camera only (" + cam["role"] + "). It does not reconstruct a source photograph's camera position; the six R01 stations and the adopted walk are unchanged.",
        "geographic_confidence": "approximate",
        "historical_confidence": "not-applicable",
    })
    r["dependencies"] = deps
    r.pop("source_photographs_embedded", None)
    r["adoption_status"] = "review-camera"
    return r


def manifest_record(rel, date):
    r = base_record(rel, "render-manifest", date)
    r.update({
        "id": "kabukicho-r04-render-manifest",
        "processing": "scripts/publish_r04_previews.py summarises scripts/render_stills.mjs reports: renderer versions, source commit, input hashes, per-image timings and output hashes.",
        "format": "json", "units": None, "coordinate_system": None,
        "inferred_elements": "Records how the previews were produced; certifies no historical fact.",
    })
    r["dependencies"] = DEPENDENCIES + ["kabukicho-r04-camera-" + v.removeprefix("r04-") for v in VIEW_IDS]
    return r


def label_font(size):
    for p in ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def contact_sheet(paths, labels, out, tile=(640, 360), cols=2):
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (tile[0] * cols, (tile[1] + 26) * rows), (18, 18, 20))
    d = ImageDraw.Draw(sheet)
    for i, (p, lab) in enumerate(zip(paths, labels)):
        x, y = (i % cols) * tile[0], (i // cols) * (tile[1] + 26)
        d.text((x + 8, y + 4), lab, fill=(236, 232, 224), font=label_font(15))
        sheet.paste(Image.open(p).convert("RGB").resize(tile, Image.LANCZOS), (x, y + 26))
    sheet.save(out, quality=90)


def publish(a):
    out = Path(a.out)
    (ROOT / out).mkdir(parents=True, exist_ok=True)
    reports = {}
    for d in [a.stations, a.walk]:
        rep = json.loads((ROOT / d / "render-report.json").read_text(encoding="utf-8"))
        for s in rep["stations"]:
            reports[(d, s["station"])] = (rep, s)
    published, entries = [], []

    def put(src_dir, sid, dst_name, size, meta):
        rep, s = reports[(src_dir, sid)]
        if not s["done"] or s["error"] or s["moduleErrors"]:
            raise SystemExit(f"{sid}: render failed, not publishing")
        src = ROOT / src_dir / f"{sid}.png"
        img = Image.open(src).convert("RGB")
        if img.size != size:
            img = img.resize(size, Image.LANCZOS)
        rel = f"{out.as_posix()}/{dst_name}"
        img.save(ROOT / rel, quality=92, subsampling=0)
        env = s.get("environment") or rep["environment"]
        renderer = {"engine": f"three.js {env['three']} + headless Chromium {env['browser']} (SwiftShader CPU WebGL2)",
                    "look": rep["look"], "source_commit": env["source_commit"], "worktree_dirty": env["worktree_dirty"]}
        meta = {**meta, "renderer": renderer, "render_resolution_px": [rep["w"], rep["h"]], "published_resolution_px": list(size),
                "processing": f"scripts/render_stills.mjs ({meta['how']}) at {rep['w']}x{rep['h']}; scripts/publish_r04_previews.py re-encodes as JPEG q92" + (f" resized to {size[0]}x{size[1]}" if size != (rep['w'], rep['h']) else "") + "."}
        published.append((rel, meta))
        entries.append({"file": rel, "camera_id": meta.get("camera_id"), "walk_time_s": meta.get("walk_time_s"), "render_ms": s["ms"],
                        "source_commit": env["source_commit"], "worktree_dirty": env["worktree_dirty"],
                        "stats": s["stats"], "sha256": sha256(rel), "module_log": [l for l in s["log"] if l.startswith("module ") or "still rendered" in l]})
        return ROOT / rel

    still_files = []
    for sid in STATION_IDS:
        still_files.append(put(a.stations, sid, f"{sid}.jpg", STILL_SIZE, {"camera_id": sid, "how": f"fixed R01 diagnostic station {sid}"}))
    for vid in VIEW_IDS:
        put(a.stations, vid, f"{vid}.jpg", STILL_SIZE, {"camera_id": vid, "how": f"r04 review camera {vid}"})
    walk_rep = json.loads((ROOT / a.walk / "render-report.json").read_text(encoding="utf-8"))
    walk_files, walk_labels = [], []
    for s in walk_rep["stations"]:
        t = float(s["station"].split("-")[1])
        f = put(a.walk, s["station"], f"walk-{int(t):03d}s.jpg", WALK_SIZE, {"camera_id": "kabukicho-adopted-walk", "walk_time_s": t, "how": f"adopted walk pose at t={t:g} s"})
        walk_files.append(f); walk_labels.append(f"adopted walk t = {t:g} s")
    cs = out / "station-contact-sheet.jpg"
    contact_sheet(still_files, STATION_IDS, ROOT / cs)
    published.append((cs.as_posix(), {"how": "contact sheet", "processing": "scripts/publish_r04_previews.py: 640x360 tiles of the six station previews with station-ID captions (review sheet; captions are not in the renders).",
                                      "renderer": None, "camera_id": None}))
    ws = out / "walk-contact-sheet.jpg"
    contact_sheet(walk_files, walk_labels, ROOT / ws)
    published.append((ws.as_posix(), {"how": "contact sheet", "processing": "scripts/publish_r04_previews.py: 640x360 tiles of the published adopted-walk frames with time captions (sparse samples, not a video).",
                                      "renderer": None, "camera_id": None}))
    first = reports[(a.stations, STATION_IDS[0])][0]
    manifest = {
        "schema_version": 1, "id": "kabukicho-r04-render-manifest", "round": "r04", "date": a.date,
        "renderer": {"three": first["environment"]["three"], "browser": first["environment"]["browser"], "node": first["environment"]["node"],
                     "cpus": first["environment"]["cpus"], "gpu": "none (SwiftShader)"},
        "source_commit": first["environment"]["source_commit"], "worktree_dirty": first["environment"]["worktree_dirty"],
        "look": first["look"], "seed": 1976,
        "fictional_shop_names": next((st["fictionalNames"] for (_, _), (_, st) in reports.items() if st.get("fictionalNames")), None),
        "fictional_shop_names_note": "Invented names from viewer/src/world/signage/vocab.js; not identified with any historical business. Same list for every camera (one deterministic world).",
        "inputs": {p: sha256(p) for p in INPUTS},
        "images": entries,
        "note": "Full 1920x1080 PNG renders remain in git-ignored renders/. Timings were measured on this 4-CPU, no-GPU container.",
    }
    mrel = f"{out.as_posix()}/render-manifest.json"
    write_json(mrel, manifest)
    return published, mrel


def write_sidecars(published, mrel, date):
    ids = []
    for rel, meta in published:
        rec = image_record(rel, date, meta)
        rec["id"] = "kabukicho-r04-" + Path(rel).stem.removeprefix("r04-")
        if meta.get("how") == "contact sheet":
            rec["type"] = "rendered-reconstruction-contact-sheet"
            rec.pop("renderer"); rec.pop("render_resolution_px"); rec.pop("published_resolution_px")
        ids.append(rec["id"])
        write_json(rel + ".asset.json", rec)
    write_json(mrel + ".asset.json", manifest_record(mrel, date))
    for v in VIEW_IDS:
        write_json(CAMERAS[v] + ".asset.json", camera_record(v, date))
    return ids


def main():
    ap = argparse.ArgumentParser(description="Publish r04 previews with provenance sidecars.")
    ap.add_argument("--stations", help="render dir holding the six stations and review views (with render-report.json)")
    ap.add_argument("--walk", help="render dir holding adopted-walk frames (with render-report.json)")
    ap.add_argument("--out", default="docs/previews/r04")
    ap.add_argument("--date", required=True, help="publication date YYYY-MM-DD (recorded as retrieved_at)")
    ap.add_argument("--metadata-only", action="store_true", help="only (re)write the review-camera sidecars")
    a = ap.parse_args()
    if a.metadata_only:
        for v in VIEW_IDS:
            write_json(CAMERAS[v] + ".asset.json", camera_record(v, a.date))
        print("wrote camera sidecars")
        return
    if not (a.stations and a.walk):
        ap.error("--stations and --walk are required unless --metadata-only")
    published, mrel = publish(a)
    ids = write_sidecars(published, mrel, a.date)
    print(f"published {len(published)} files + manifest to {a.out}: {', '.join(ids)}")


if __name__ == "__main__":
    main()
