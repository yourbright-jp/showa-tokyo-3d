#!/usr/bin/env python3
"""Geometry previews, not photographic final frames. CPU rasterizer + plan."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from import_plateau import ROOT, SCENE, normal, triangulate, horizontal, write_json, load_terrain
from build_blockout import pixel_latlon

OUT = ROOT / "docs/previews/r01"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LABELS = ["Entrance approach", "Gate position (unresolved)", "Ichibangai middle",
          "Route bend (proposal)", "Plaza opening (hypothesis)", "Theatre from plaza (oblique)"]


def save_png(image, path):
    pending = path.with_name(path.stem + ".pending.png")
    image.save(pending)
    pending.replace(path)


def unit(v):
    return v / np.linalg.norm(v)


def render(features, eye, target, width=1440, height=810, aerial=False, stats=None, focal_mm=35):
    eye, target = np.array(eye, dtype=float), np.array(target, dtype=float)
    forward = unit(target - eye)
    right = unit(np.cross(forward, [0, 1, 0]))
    up = np.cross(right, forward)
    rotation = np.stack([right, up, forward], axis=1)
    focal = width * focal_mm / 36
    sky = np.array([224, 235, 239], dtype=float)
    rgb = np.empty((height, width, 3), dtype=np.uint8)
    rgb[:] = sky.astype(np.uint8)
    depth = np.full((height, width), np.inf)
    light = unit(np.array([-0.5, 0.85, 0.6]))
    ground = {"id": "flat-ground", "kind": "ground", "polygons": [[[-450, -0.03, -500],
              [-450, -0.03, 350], [450, -0.03, 350], [450, -0.03, -500]]]}
    ownership = np.full((height, width), -1, dtype=np.int32)
    rendered = 0
    draw_features = features if any(f["kind"] == "terrain" for f in features) else [ground] + features
    for feature_index, feature in enumerate(draw_features):
        base = np.array([153, 178, 194] if feature["kind"] == "building" else
                        [161, 179, 189] if feature["kind"] == "road" else [213, 219, 207] if feature["kind"] == "terrain" else [236, 240, 242], dtype=float)
        if feature.get("historical_status") == "inferred-roof-proxy":
            base = np.array([215, 137, 70], dtype=float)
        for ring in feature["polygons"]:
            n = np.array(normal(ring))
            shade = 0.45 + 0.55 * max(0, float(np.dot(n, light)))
            colour = base * shade
            camera = (np.array(ring) - eye) @ rotation
            for ids in triangulate(ring):
                poly = [camera[i] for i in ids]
                clipped = []
                for a, b in zip(poly, poly[1:] + poly[:1]):
                    ina, inb = a[2] >= 0.15, b[2] >= 0.15
                    if ina:
                        clipped.append(a)
                    if ina != inb:
                        clipped.append(a + (b - a) * ((0.15 - a[2]) / (b[2] - a[2])))
                for j in range(1, len(clipped) - 1):
                    tri = np.array([clipped[0], clipped[j], clipped[j + 1]])
                    projected = np.stack([width / 2 + focal * tri[:, 0] / tri[:, 2],
                                          height / 2 - focal * tri[:, 1] / tri[:, 2]], axis=1)
                    x0 = max(0, math.floor(projected[:, 0].min()))
                    x1 = min(width - 1, math.ceil(projected[:, 0].max()))
                    y0 = max(0, math.floor(projected[:, 1].min()))
                    y1 = min(height - 1, math.ceil(projected[:, 1].max()))
                    if x1 < x0 or y1 < y0:
                        continue
                    a, b, c = projected
                    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
                    if abs(den) < 1e-9:
                        continue
                    yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
                    xx, yy = xx + 0.5, yy + 0.5
                    w0 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / den
                    w1 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / den
                    w2 = 1 - w0 - w1
                    inverse = w0 / tri[0, 2] + w1 / tri[1, 2] + w2 / tri[2, 2]
                    valid = (w0 >= -1e-8) & (w1 >= -1e-8) & (w2 >= -1e-8) & (inverse > 0)
                    z = np.divide(1.0, inverse, out=np.full_like(inverse, np.inf), where=valid)
                    region = depth[y0:y1 + 1, x0:x1 + 1]
                    visible = valid & (z < region)
                    fog = np.clip(z / (100000 if aerial else 450), 0, 0.65)
                    shaded = colour[None, None, :] * (1 - fog[:, :, None]) + sky * fog[:, :, None]
                    rgb[y0:y1 + 1, x0:x1 + 1][visible] = np.clip(shaded[visible], 0, 255).astype(np.uint8)
                    region[visible] = z[visible]
                    ownership[y0:y1 + 1, x0:x1 + 1][visible] = feature_index
                    rendered += 1
    if stats is not None:
        total = width * height
        stats.update({"width": width, "height": height,
            "sky_fraction": round(float(np.count_nonzero(ownership == -1)) / total, 5),
            "surface_within_3m_fraction": round(float(np.count_nonzero(depth < 3)) / total, 5),
            "visible_feature_fractions": {f["id"]: round(float(np.count_nonzero(ownership == i)) / total, 5)
                for i, f in enumerate(draw_features) if np.any(ownership == i)}})
    return Image.fromarray(rgb), rendered


def caption(image, title, subtitle):
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, image.width, 83), fill=(250, 252, 252))
    d.text((24, 12), title, fill="#183d50", font=ImageFont.truetype(FONT, 23))
    d.text((24, 48), subtitle, fill="#466675", font=ImageFont.truetype(FONT, 15))
    d.rectangle((0, image.height - 27, image.width, image.height), fill=(250, 252, 252))
    d.text((20, image.height - 23), "PLATEAU Tokyo/Shinjuku 2025, modified (CC BY 4.0); GSI 1974-1978 aerial interpretation. Not a verified 1976 reconstruction.",
           fill="#466675", font=ImageFont.truetype(FONT, 12))
    return image


def plan(features, route):
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    from matplotlib.patches import Polygon, Patch
    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none"})
    fig, ax = plt.subplots(figsize=(12, 11), dpi=160)
    for kind in ["road", "building"]:
        for feature in features:
            if feature["kind"] != kind:
                continue
            inferred = feature.get("historical_status") == "inferred-roof-proxy"
            for ring in feature["polygons"]:
                if kind == "building" and normal(ring)[1] < .6:
                    continue
                ax.add_patch(Polygon([(p[0], -p[2]) for p in ring], facecolor="#dcaa70" if inferred else
                    "#e5ebef" if kind == "building" else "#aebfc9", edgecolor="#a66e31" if inferred else
                    "#7d96a5" if kind == "building" else "none", linewidth=.5))
    hypothesis = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text())
    plaza = hypothesis.get("plaza", {})
    plaza_pixels = plaza.get("boundary_pixels", plaza.get("pixels", []))
    if plaza_pixels:
        origin = json.loads((ROOT / "data/kabukicho-intake.json").read_text())["origin_jgd2011"]
        outline = [horizontal(*pixel_latlon(p, hypothesis["pixel_space"]), origin) for p in plaza_pixels]
        ax.add_patch(Polygon([(p[0], -p[1]) for p in outline], facecolor="#dceacb", edgecolor="#557449",
                             linewidth=1.2, alpha=.65, zorder=4, linestyle="--"))
    points = route["geometry"]["coordinates"]
    ax.plot([p[0] for p in points], [-p[2] for p in points], color="#bb351d", linewidth=3, zorder=10)
    for i, (p, label) in enumerate(zip(points, LABELS)):
        ax.scatter(p[0], -p[2], s=38, color="#bb351d", edgecolor="white", zorder=11)
        station = route["stations"][i]
        target = station["look_at_m"]
        direction = np.array([target[0] - p[0], -(target[2] - p[2])])
        direction = direction / np.linalg.norm(direction) * 10
        ax.arrow(p[0], -p[2], *direction, width=.35, head_width=2.6, color="#9c2713", zorder=11)
        offset = [(-130, -7), (20, -7), (-130, -7), (-145, -25), (-160, 8), (20, 22)][i]
        ax.annotate(chr(65 + i) + "  " + label, (p[0], -p[2]), xytext=offset, textcoords="offset points",
                    fontsize=8, bbox={"facecolor": "white", "alpha": .9, "edgecolor": "none"}, zorder=12)
    ax.text(-132, 159, "Milano\nroof proxy", ha="center", fontsize=9, color="#65411b")
    ax.text(12, 80, "Koma\nroof proxy", ha="center", fontsize=9, color="#65411b")
    ax.text(35, 135, "Adjacent theatre\nidentity unresolved", ha="center", fontsize=8, color="#65411b")
    ax.plot([110, 160], [-112, -112], color="#203e50", lw=3)
    ax.text(135, -122, "50 m", ha="center", fontsize=9)
    ax.annotate("N", xy=(195, 220), xytext=(195, 185), ha="center", fontsize=12,
                arrowprops={"arrowstyle": "->", "color": "#203e50"})
    ax.set_xlim(-185, 225)
    ax.set_ylim(-140, 240)
    ax.set_aspect("equal")
    ax.set_xlabel("East of local JGD2011 origin (m)")
    ax.set_ylabel("North of local JGD2011 origin (m)")
    fig.text(.09, .97, "Kabukicho: provisional period-layout and walking route", fontsize=16, color="#203e50")
    fig.text(.09, .942, "Blue: modern 2025 context | Ochre: aerial-interpreted roof volumes | Red: proposed route", fontsize=9, color="#45616f")
    ax.legend(handles=[Patch(facecolor="#e5ebef", edgecolor="#7d96a5", label="Modern context: historical review pending"),
        Patch(facecolor="#dcaa70", label="1974-1978 roof interpretation: heights assumed"),
        Patch(facecolor="#dceacb", edgecolor="#557449", label="Inferred plaza: boundary unverified")], loc="upper right", fontsize=8)
    fig.text(.105, .025, "Source: Tokyo/Shinjuku Project PLATEAU 2025, modified (CC BY 4.0); GSI gazo1 interpreted. Exact 1976 layout unverified.", fontsize=8)
    fig.subplots_adjust(bottom=.08, top=.9, left=.09, right=.98)
    fig.canvas.draw()
    Image.fromarray(np.asarray(fig.canvas.buffer_rgba()).copy()).convert("RGB").save(OUT / "route-plan.ready.png")
    (OUT / "route-plan.ready.png").replace(OUT / "route-plan.png")
    fig.savefig(OUT / "route-plan.svg")
    plt.close(fig)


def arrival_revision(before_dir):
    """Compare archived views with revised views; both camera and geometry change."""
    sheet = Image.new("RGB", (1920, 1080), "white")
    for row, (letter, station_id) in enumerate((("E", "plaza-reveal"), ("F", "koma-front"))):
        for col, directory in enumerate((before_dir, OUT)):
            image = Image.open(directory / (station_id + ".png")).convert("RGB")
            # Remove each prior caption rather than repeating superseded metadata.
            content = image.crop((0, 83, image.width, image.height - 27)).resize((960, 430))
            panel = Image.new("RGB", (960, 540), "white")
            panel.paste(content, (0, 83))
            caption(panel, f"{'Before' if col == 0 else 'After'}: {letter}",
                    "Old flat geometry and camera position" if col == 0 else
                    "Revised terrain, plaza hypothesis and camera position")
            sheet.paste(panel, (col * 960, row * 540))
    save_png(sheet, OUT / "arrival-camera-revision.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-dir", type=Path,
                        help="Optional directory of archived E/F PNGs for a revision comparison")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.loads((ROOT / "data/derived/kabukicho-layout-features.json").read_text())
    route = json.loads((SCENE / "cameras/route-proposal.json").read_text())
    overview, _ = render(data["features"], [-300, 340, 425], [0, 10, -45], 1920, 1080, aerial=True)
    save_png(caption(overview, "Kabukicho: first 3D layout study", "Modern context + provisional theatre roof volumes. Geometry study; heights and exact 1976 appearance remain unverified."), OUT / "blockout-overview.png")
    images = []
    framing = {"scope": "Uncaptioned geometry raster visibility, not historical accuracy or final appearance approval", "stations": []}
    for i, station in enumerate(route["stations"]):
        stats = {"id": station["id"]}
        image, _ = render(data["features"], station["position_m"], station["look_at_m"], 1280, 720, stats=stats, focal_mm=station.get("focal_length_35mm_equivalent_mm", 35))
        framing["stations"].append(stats)
        save_png(caption(image, chr(65 + i) + "  " + LABELS[i], f"{station.get('focal_length_35mm_equivalent_mm', 35):g} mm equivalent / eye height 1.6 m above terrain / shared 3D world / placeholder geometry"), OUT / (station["id"] + ".png"))
        images.append(image)
    sheet = Image.new("RGB", (1920, 720), "white")
    for i, image in enumerate(images):
        sheet.paste(image.resize((640, 360)), ((i % 3) * 640, (i // 3) * 360))
    save_png(sheet, OUT / "camera-contact-sheet.png")
    h = json.loads((ROOT / "data/kabukicho-layout-hypothesis.json").read_text())
    hidden = set(h["context_hidden_diagnostic_ids"])
    modern = json.loads((ROOT / "data/derived/kabukicho-modern-features.json").read_text())
    retained_features = [f for f in data["features"] if f["id"] not in hidden] + [f for f in modern["features"] if f["id"] in hidden]
    camera = route["stations"][-1]
    retained, _ = render(retained_features, camera["position_m"], camera["look_at_m"], 960, 540, focal_mm=camera.get("focal_length_35mm_equivalent_mm", 35))
    removed, _ = render([f for f in data["features"] if f["id"] not in hidden], camera["position_m"], camera["look_at_m"], 960, 540, focal_mm=camera.get("focal_length_35mm_equivalent_mm", 35))
    caption(retained, "Modern baseline features restored", "Comparison only: modern objects overlap the inferred plaza")
    caption(removed, "Revised layout hypothesis", "Objects omitted from period study; aerial / 1975 photo inference, reversible")
    comparison = Image.new("RGB", (1920, 540))
    comparison.paste(retained, (0, 0))
    comparison.paste(removed, (960, 0))
    save_png(comparison, OUT / "arrival-context-diagnostic.png")
    a, b = route["stations"][4]["position_m"], route["stations"][5]["position_m"]
    eye = [(a[i] + b[i]) / 2 for i in range(3)]
    terrain = load_terrain(data["config"])
    eye[1] = terrain.height(eye[0], eye[2]) + 1.6
    target = camera["look_at_m"][:]
    oblique, _ = render(data["features"], eye, target, 1440, 810, focal_mm=24)
    save_png(caption(oblique, "Arrival layout diagnostic: an intermediate point on the same route",
            "Eye height 1.6 m above terrain, 24 mm equivalent; revised plaza hypothesis and assumed theatre volumes."), OUT / "arrival-oblique.png")
    write_json(ROOT / "data/derived/camera-framing-report.json", framing)
    plan(data["features"], route)
    if args.before_dir:
        arrival_revision(args.before_dir)
    print("Rendered overview, plan and six geometry-only camera views")


if __name__ == "__main__":
    main()
