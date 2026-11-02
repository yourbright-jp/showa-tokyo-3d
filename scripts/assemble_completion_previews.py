#!/usr/bin/env python3
"""Copy reproducible colour frames and assemble labeled diagnostic sheets."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from import_plateau import ROOT, write_json

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
OUT = ROOT / "docs/previews/r03"


def sheet(items, output, columns, title):
    cell_w, cell_h, header = 640, 394, 64
    rows = (len(items) + columns - 1) // columns
    image = Image.new("RGB", (columns * cell_w, header + rows * cell_h + 30), "#f6f8f9")
    draw = ImageDraw.Draw(image)
    draw.text((20, 12), title, font=ImageFont.truetype(FONT, 25), fill="#153342")
    draw.text((20, 43), "Adopted reconstruction with documented inferences. Colour and dimensions are estimates.",
              font=ImageFont.truetype(FONT, 13), fill="#526875")
    for index, (path, label) in enumerate(items):
        frame = Image.open(path).convert("RGB")
        frame.thumbnail((cell_w, 360))
        x, y = (index % columns) * cell_w, header + (index // columns) * cell_h
        image.paste(frame, (x + (cell_w - frame.width) // 2, y))
        draw.text((x + 12, y + 365), label, font=ImageFont.truetype(FONT, 16), fill="#153342")
    draw.text((20, image.height - 23), "Project PLATEAU / GSI, processed; archived photographs cited as evidence, never used as image textures.",
              font=ImageFont.truetype(FONT, 12), fill="#526875")
    pending = output.with_name(output.stem + ".pending.png")
    image.save(pending)
    pending.replace(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "renders/r03/period-final")
    args = parser.parse_args()
    source_manifest = json.loads((args.input / "render-manifest.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    copied, fixed, walk = [], [], []
    for frame in source_manifest["images"]:
        src = args.input / frame["file"]
        name = "period-" + frame["file"]
        dest = OUT / name
        shutil.copyfile(src, dest)
        with Image.open(dest) as image:
            image.verify()
        entry = {**frame, "path": dest.relative_to(ROOT).as_posix(),
                 "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}
        copied.append(entry)
        if frame["camera"].startswith("walk-"):
            walk.append((dest, f"{frame['time_s']:.1f} s | {frame.get('phase', 'walk')}"))
        else:
            fixed.append((dest, frame["camera"]))
    if fixed:
        sheet(fixed, OUT / "period-contact-sheet.png", 3, "Kabukicho 1976: adopted reconstruction / six fixed views")
    if walk:
        sheet(walk, OUT / "walk-contact-sheet.png", 4, "One shared route: sparse long-take camera samples")
    write_json(ROOT / "data/derived/kabukicho-period-render-manifest.json",
               {"schema_version": 1, "id": "kabukicho-period-render-manifest",
                "source_render": source_manifest, "images": copied,
                "sparse_walk_scope": "Sampled frames from the computed continuous camera trajectory; not a full video render or proof that every intervening frame is visually approved.",
                "sheet_paths": [p.relative_to(ROOT).as_posix() for p in (OUT / "period-contact-sheet.png", OUT / "walk-contact-sheet.png") if p.exists()]})
    print(json.dumps({"copied_frames": len(copied), "fixed_views": len(fixed), "walk_samples": len(walk)}))


if __name__ == "__main__":
    main()
