#!/usr/bin/env python3
"""Compose r02 review sheets: each station render beside its assigned colour references.

Usage: python3 scripts/make_comparison.py <render_dir> [--out <dir>]
Writes <out>/compare-<station>.jpg and <out>/contact-sheet.jpg. Diagnostic sheets only;
the references are the approved generated colour masters (see references/README.md).
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"
REF_DIR = SCENE / "references/master-v1"
# Mirrors docs/rounds/shinjuku-kabukicho-1976-r02-rules.md (composition ref first).
STATION_REFS = {
    "entrance-approach": ["R01", "R08"],
    "under-gate": ["R08", "R01"],
    "ichibangai-middle": ["R01", "R04"],
    "towards-koma-corner": ["R01", "R02"],
    "plaza-reveal": ["R02", "R09"],
    "koma-front": ["R02"],
}
FONT_PATHS = ["/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"]


def font(size):
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def ref_path(rid):
    return next(REF_DIR.glob(f"{rid}-*.png"))


def fit_h(img, h):
    return img.resize((max(1, round(img.width * h / img.height)), h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("render_dir")
    ap.add_argument("--out")
    a = ap.parse_args()
    rdir = Path(a.render_dir)
    out = Path(a.out) if a.out else rdir / "review"
    out.mkdir(parents=True, exist_ok=True)
    scene = json.loads((SCENE / "scene.json").read_text(encoding="utf-8"))
    ids = [s["id"] for s in scene["route"]["stations"]]
    H = 540
    tiles = []
    for sid in ids:
        f = rdir / f"{sid}.png"
        if not f.exists():
            continue
        render = fit_h(Image.open(f).convert("RGB"), H)
        refs = [fit_h(Image.open(ref_path(r)).convert("RGB"), H) for r in STATION_REFS.get(sid, [])]
        W = render.width + sum(r.width for r in refs) + 12 * len(refs)
        sheet = Image.new("RGB", (W, H + 34), (18, 18, 20))
        d = ImageDraw.Draw(sheet)
        sheet.paste(render, (0, 34))
        d.text((8, 6), f"{sid}  render (r02)", fill=(240, 236, 228), font=font(18))
        x = render.width + 12
        for rid, r in zip(STATION_REFS.get(sid, []), refs):
            sheet.paste(r, (x, 34))
            d.text((x + 8, 6), f"{rid} approved colour reference (target, not evidence)", fill=(200, 196, 188), font=font(16))
            x += r.width + 12
        sheet.save(out / f"compare-{sid}.jpg", quality=88)
        tiles.append((sid, fit_h(Image.open(f).convert("RGB"), 360)))
    if tiles:
        cols = 2
        tw = max(t.width for _, t in tiles)
        rows = (len(tiles) + cols - 1) // cols
        cs = Image.new("RGB", (tw * cols, (360 + 28) * rows), (18, 18, 20))
        d = ImageDraw.Draw(cs)
        for i, (sid, t) in enumerate(tiles):
            x, y = (i % cols) * tw, (i // cols) * (360 + 28)
            d.text((x + 8, y + 5), sid, fill=(240, 236, 228), font=font(16))
            cs.paste(t, (x, y + 28))
        cs.save(out / "contact-sheet.jpg", quality=88)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
