#!/usr/bin/env python3
"""Publish before/after comparison sheets for the r05 adopted-data review, with provenance sidecars.

Reads two `render_stills.mjs --batch` output folders (git-ignored `renders/`) that hold the
same six stations and three review views, and writes to `docs/previews/r05-data-review/`:
- one before/after sheet per view whose adopted data changed (plaza-reveal, koma-front,
  r04-milano-front) plus two crops of the revised signs,
- before and after contact sheets of all nine views,
- a manifest with both renders' environments, source commits and image hashes.
Every published file gets an adjacent *.asset.json. Nothing here upgrades an inferred
element to a verified fact.

Usage:
  python scripts/publish_r05_data_review.py --before renders/r05-data-before --after renders/r05-data-after --date 2026-11-03
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from publish_r04_previews import FONTS, ROOT, base_record, sha256, write_json

OUT = "docs/previews/r05-data-review"
VIEWS = ["entrance-approach", "under-gate", "ichibangai-middle", "towards-koma-corner", "plaza-reveal", "koma-front",
         "r04-gate-establishing", "r04-gate-rear", "r04-milano-front"]
PAIRS = [  # (view, crop box in the 1920x1080 render or None, output stem, what changed)
    ("plaza-reveal", None, "plaza-reveal", "Koma names on the canopy; lamp moved off コマ劇場; forecourt box bldg_cef4146e omitted; クラブハイツ in the top band"),
    ("koma-front", None, "koma-front", "Koma names on the canopy; north lamp moved off コマ劇場"),
    ("r04-milano-front", None, "milano-front", "Milano public front narrowed beside the retained north neighbour; review camera follows the name"),
    ("koma-front", (560, 520, 1240, 700), "koma-front-signs", "crop: canopy-mounted コマ東宝 / コマ劇場"),
    ("plaza-reveal", (60, 560, 760, 760), "plaza-reveal-toho", "crop: Toho Kaikan front, クラブハイツ band and the omitted forecourt box"),
]
DEPENDENCIES = ["kabukicho-period-features", "kabukicho-gate-1976", "kabukicho-koma-plaza-1976", "kabukicho-milano-1976",
                "kabukicho-context-massing-1976", "kabukicho-route-surfaces-1976", "kabukicho-adopted-walk",
                "plateau-13104-2025-terrain-crop", "kabukicho-r01-kabukicho-layout-features", "kabukicho-r05-data-review-manifest"]


def label_font(size):
    for p in (ROOT / "local-fonts/ipag.ttf", Path("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf")):
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def report(folder):
    rep = json.loads((ROOT / folder / "render-report.json").read_text(encoding="utf-8"))
    by_id = {s["station"]: s for s in rep["stations"]}
    for view in VIEWS:
        s = by_id.get(view)
        if not s or not s["done"] or s["error"] or s["moduleErrors"] or s.get("fontWarnings"):
            raise SystemExit(f"{folder}: {view} missing or failed; not publishing")
    return rep, by_id


def labelled(img, text, font):
    band = 30
    out = Image.new("RGB", (img.width, img.height + band), (18, 18, 20))
    ImageDraw.Draw(out).text((10, 5), text, fill=(236, 232, 224), font=font)
    out.paste(img, (0, band))
    return out


def stack(images):
    out = Image.new("RGB", (max(i.width for i in images), sum(i.height for i in images)), (18, 18, 20))
    y = 0
    for i in images:
        out.paste(i, (0, y)); y += i.height
    return out


def main():
    ap = argparse.ArgumentParser(description="Publish r05 adopted-data review comparison sheets.")
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--date", required=True)
    a = ap.parse_args()
    reps = {"before": report(a.before), "after": report(a.after)}
    dirs = {"before": a.before, "after": a.after}
    envs = {k: v[0]["environment"] for k, v in reps.items()}
    labels = {k: f"{k}: commit {envs[k]['source_commit'][:7]}{' + uncommitted changes' if envs[k]['worktree_dirty'] else ''}" for k in reps}
    font = label_font(18)
    (ROOT / OUT).mkdir(parents=True, exist_ok=True)
    published = []

    for view, crop, stem, change in PAIRS:
        panels = []
        for side in ("before", "after"):
            img = Image.open(ROOT / dirs[side] / f"{view}.png").convert("RGB")
            if crop:
                img = img.crop(crop)
                img = img.resize((1280, round(img.height * 1280 / img.width)), Image.LANCZOS)
            else:
                img = img.resize((1280, 720), Image.LANCZOS)
            panels.append(labelled(img, f"{view} | {labels[side]}", font))
        rel = f"{OUT}/{stem}-before-after.jpg"
        stack(panels).save(ROOT / rel, quality=90, subsampling=0)
        published.append((rel, {"camera_id": view, "kind": "before-after", "change": change, "crop_px": list(crop) if crop else None}))

    for side in ("before", "after"):
        tiles = []
        for view in VIEWS:
            img = Image.open(ROOT / dirs[side] / f"{view}.png").convert("RGB").resize((640, 360), Image.LANCZOS)
            tiles.append(labelled(img, view, label_font(15)))
        sheet = Image.new("RGB", (640 * 3, tiles[0].height * 3), (18, 18, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 3) * 640, (i // 3) * t.height))
        rel = f"{OUT}/contact-sheet-{side}.jpg"
        labelled(sheet, labels[side], font).save(ROOT / rel, quality=88)
        published.append((rel, {"camera_id": None, "kind": f"contact-sheet-{side}", "change": "all nine views", "crop_px": None}))

    manifest = {
        "schema_version": 1, "id": "kabukicho-r05-data-review-manifest", "round": "r05 adopted-data review", "date": a.date,
        "renders": {side: {"folder": dirs[side], "environment": envs[side], "look": reps[side][0]["look"],
                           "accumulation": reps[side][0].get("accumulation"),
                           "views": {v: {"ms": reps[side][1][v]["ms"], "webgl_renderer": (reps[side][1][v].get("gpu") or {}).get("renderer")}
                                     for v in VIEWS}} for side in reps},
        "images": [{"path": rel, "sha256": sha256(rel), **meta} for rel, meta in published],
        "note": "Full-resolution PNGs remain in git-ignored renders/. Changes outside the revised items (distant sign texts, shop contents, people) come from the viewer's world-wide sign-name uniqueness pass, which depends on building order (r04 unresolved item 9), not from data changes at those places.",
    }
    mrel = f"{OUT}/manifest.json"
    write_json(mrel, manifest)

    for rel, meta in published:
        r = base_record(rel, "rendered-reconstruction-comparison", a.date)
        r.update({
            "id": "kabukicho-r05-data-review-" + Path(rel).stem,
            "processing": f"scripts/publish_r05_data_review.py: two scripts/render_stills.mjs --gpu --batch --spp 64 renders ({labels['before']}; {labels['after']}) "
                          + ("resized to 1280 px wide and stacked with captions" if meta["kind"] == "before-after" else "tiled at 640x360 with view captions")
                          + (f", cropped to {meta['crop_px']}" if meta["crop_px"] else "") + "; JPEG.",
            "format": "jpeg", "units": "pixels", "coordinate_system": None,
            "inferred_elements": "Both images are code-generated reconstructions. Revised items follow the r05 decision revisions (kabukicho-koma-plaza-1976, kabukicho-milano-1976, kabukicho-context-massing-1976); every other element keeps the r04 tiers (period-plausible-generic shopfronts, fictional names, people, light).",
            "comparison_change": meta["change"],
            "camera_id": meta["camera_id"],
            "font_provenance": {"fonts": FONTS, "scope": "Sign text is rasterised from fonts into generated textures; captions use IPA Gothic when present locally. No font binary is redistributed."},
            "render_manifest": mrel,
        })
        r["dependencies"] = DEPENDENCIES
        write_json(rel + ".asset.json", r)
    m = base_record(mrel, "render-manifest", a.date)
    m.update({"id": "kabukicho-r05-data-review-manifest", "format": "json", "units": None, "coordinate_system": None,
              "processing": "scripts/publish_r05_data_review.py summarises the two render reports: environments, source commits, timings and output hashes.",
              "inferred_elements": "Records how the comparison sheets were produced; certifies no historical fact."})
    m["dependencies"] = [d for d in DEPENDENCIES if d != "kabukicho-r05-data-review-manifest"]
    write_json(mrel + ".asset.json", m)
    print(json.dumps({"published": [rel for rel, _ in published] + [mrel]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
