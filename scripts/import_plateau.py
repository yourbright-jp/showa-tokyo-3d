#!/usr/bin/env python3
"""Extract a pinned CityGML archive and build an attributed modern blockout.

Standard library only. Local X=east, Y=up, Z=south in metres. GRS80 tangent
horizontal coordinates preserve JGD2011 lat/lon; this is not a WGS84 epoch
transformation. Building bases and roads are intentionally flattened.
"""
import argparse
import array
import base64
import hashlib
import json
import math
import struct
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NS = {"g": "http://www.opengis.net/gml", "b": "http://www.opengis.net/citygml/building/2.0",
      "t": "http://www.opengis.net/citygml/transportation/2.0", "c": "http://www.opengis.net/citygml/2.0"}
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"


def write_json(path, data, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending")
    pending.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False,
                                 **({"separators": (",", ":")} if compact else {"indent": 2})) + "\n")
    pending.replace(path)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def ecef(latitude, longitude):
    lat, lon = math.radians(latitude), math.radians(longitude)
    a, f = 6378137.0, 1 / 298.257222101  # GRS80, JGD2011
    e2 = f * (2 - f)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return (n * math.cos(lat) * math.cos(lon), n * math.cos(lat) * math.sin(lon),
            n * (1 - e2) * math.sin(lat))


def horizontal(latitude, longitude, origin):
    ref = ecef(origin["latitude"], origin["longitude"])
    p = ecef(latitude, longitude)
    d = [p[i] - ref[i] for i in range(3)]
    lat, lon = math.radians(origin["latitude"]), math.radians(origin["longitude"])
    east = -math.sin(lon) * d[0] + math.cos(lon) * d[1]
    north = -math.sin(lat) * math.cos(lon) * d[0] - math.sin(lat) * math.sin(lon) * d[1] + math.cos(lat) * d[2]
    return east, -north


def normal(points):
    out = [0.0, 0.0, 0.0]
    for p, q in zip(points, points[1:] + points[:1]):
        out[0] += (p[1] - q[1]) * (p[2] + q[2])
        out[1] += (p[2] - q[2]) * (p[0] + q[0])
        out[2] += (p[0] - q[0]) * (p[1] + q[1])
    length = math.sqrt(sum(x * x for x in out))
    return [x / length for x in out] if length > 1e-10 else [0, 0, 0]


def triangulate(points):
    """Ear-clip planar simple polygons; reject rather than fill invalid rings."""
    n = normal(points)
    drop = max(range(3), key=lambda i: abs(n[i]))
    axes = [i for i in range(3) if i != drop]
    p = [(v[axes[0]], v[axes[1]]) for v in points]

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))
    if abs(area) < 1e-8:
        return []
    sign = 1 if area > 0 else -1
    ids, triangles = list(range(len(p))), []
    while len(ids) > 3:
        found = False
        for j, b in enumerate(ids):
            a, c = ids[j - 1], ids[(j + 1) % len(ids)]
            corner = sign * cross(p[a], p[b], p[c])
            if abs(corner) < 1e-9:
                ids.pop(j)
                found = True
                break
            if corner < 0:
                continue
            inside = any(min(sign * cross(p[a], p[b], p[k]), sign * cross(p[b], p[c], p[k]),
                             sign * cross(p[c], p[a], p[k])) > -1e-9
                         for k in ids if k not in (a, b, c))
            if not inside:
                triangles.append((a, b, c))
                ids.pop(j)
                found = True
                break
        if not found:
            raise ValueError("Non-simple or numerically degenerate polygon")
    if len(ids) == 3 and abs(cross(*(p[k] for k in ids))) > 1e-9:
        triangles.append(tuple(ids))
    return triangles


def rings(element, lod, check_holes=True):
    result = []
    for polygon in element.findall(".//" + lod + "//g:Polygon", NS):
        if check_holes and polygon.find("g:interior", NS) is not None:
            raise ValueError("Interior rings require a hole-aware triangulator")
        pos = polygon.find("g:exterior/g:LinearRing/g:posList", NS)
        if pos is None or not pos.text:
            raise ValueError("Unsupported coordinate encoding")
        a = list(map(float, pos.text.split()))
        if len(a) % 3:
            raise ValueError("Expected EPSG:6697 XYZ triples")
        points = [a[i:i + 3] for i in range(0, len(a), 3)]
        clean = []
        for p in points:
            if not clean or p != clean[-1]:
                clean.append(p)
        if len(clean) > 1 and clean[0] == clean[-1]:
            clean.pop()
        if len(clean) >= 3:
            result.append(clean)
    return result


def parse_features(path, kind, config):
    expected = "http://www.opengis.net/def/crs/EPSG/0/6697"
    tag = "{" + NS["b" if kind == "building" else "t"] + "}" + ("Building" if kind == "building" else "Road")
    lod = "b:lod1Solid" if kind == "building" else "t:lod1MultiSurface"
    bounds = config["selection_bounds"]
    features, count = [], 0
    checked_crs = False
    for event, el in ET.iterparse(path, events=("end",)):
        if el.tag == "{" + NS["g"] + "}Envelope":
            if el.attrib.get("srsName") != expected:
                raise ValueError("Unexpected source CRS: " + str(el.attrib))
            checked_crs = True
        if el.tag != tag:
            continue
        count += 1
        polygons = rings(el, lod, check_holes=False)
        points = [p for ring in polygons for p in ring]
        if points:
            lat, lon = (sum(p[i] for p in points) / len(points) for i in (0, 1))
            if bounds["south"] <= lat <= bounds["north"] and bounds["west"] <= lon <= bounds["east"]:
                # Reject unsupported rings only for selected features. Unrelated
                # courtyards elsewhere in the 1km source mesh are not exported.
                polygons = rings(el, lod)
                base = min(p[2] for p in points)
                local = []
                for ring in polygons:
                    vertices = []
                    for latitude, longitude, height in ring:
                        x, z = horizontal(latitude, longitude, config["origin_jgd2011"])
                        vertices.append([round(x, 4), round(height - base, 4) if kind == "building" else 0.02, round(z, 4)])
                    local.append(vertices)
                features.append({"id": el.get("{" + NS["g"] + "}id"), "kind": kind,
                    "name": el.findtext("g:name", default="", namespaces=NS), "source_lod": 1,
                    "source_creation_date": el.findtext("c:creationDate", namespaces=NS),
                    "centroid_latlon": [lat, lon], "source_base_height_m": base,
                    "height_m": round(max(p[2] for p in points) - base, 4),
                    "historical_status": "modern-unreviewed", "polygons": local})
        el.clear()
    if not checked_crs:
        raise ValueError("Source did not declare the expected CRS")
    return features, count


def export_gltf(features, path, config, glb_path=None):
    data = bytearray()
    doc = {"asset": {"version": "2.0", "generator": "showa-tokyo-3d import_plateau.py",
                     "copyright": config["attribution"] + " / CC BY 4.0"},
           "scene": 0, "scenes": [{"name": "Modern PLATEAU underlay, not 1976", "nodes": []}],
           "nodes": [], "meshes": [], "bufferViews": [], "accessors": [],
           "materials": [{"name": "modern buildings", "doubleSided": True, "pbrMetallicRoughness": {
               "baseColorFactor": [0.52, 0.62, 0.68, 1], "metallicFactor": 0, "roughnessFactor": 1}},
               {"name": "modern roads", "doubleSided": True, "pbrMetallicRoughness": {
               "baseColorFactor": [0.23, 0.28, 0.32, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
           "extras": {"source_dataset": config["dataset_id"], "target_reconstruction_year": 1976,
                      "role": "modern-reference-only", "vertical_mode": config["vertical_mode"],
                      "origin_jgd2011": config["origin_jgd2011"]}}
    triangles_total = 0

    def attribute(values):
        while len(data) % 4:
            data.append(0)
        offset = len(data)
        packed = array.array("f", (x for p in values for x in p))
        if sys.byteorder != "little":
            packed.byteswap()
        data.extend(packed.tobytes())
        vi = len(doc["bufferViews"])
        doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(packed) * 4, "target": 34962})
        ai = len(doc["accessors"])
        doc["accessors"].append({"bufferView": vi, "componentType": 5126, "count": len(values), "type": "VEC3",
            "min": [min(p[i] for p in values) for i in range(3)], "max": [max(p[i] for p in values) for i in range(3)]})
        return ai

    for feature in features:
        vertices, normals = [], []
        for ring in feature["polygons"]:
            n = normal(ring)
            for triangle in triangulate(ring):
                for i in triangle:
                    vertices.append(ring[i])
                    normals.append(n)
        if not vertices:
            raise ValueError("Empty exported feature: " + feature["id"])
        triangles_total += len(vertices) // 3
        mesh = {"name": feature["id"], "primitives": [{"attributes": {"POSITION": attribute(vertices), "NORMAL": attribute(normals)},
            "material": 0 if feature["kind"] == "building" else 1, "mode": 4}]}
        index = len(doc["meshes"])
        doc["meshes"].append(mesh)
        doc["nodes"].append({"name": feature["name"] or feature["id"], "mesh": index,
            "extras": {k: v for k, v in feature.items() if k != "polygons"}})
        doc["scenes"][0]["nodes"].append(index)
    doc["buffers"] = [{"byteLength": len(data), "uri": "data:application/octet-stream;base64," + base64.b64encode(data).decode()}]
    write_json(path, doc, compact=True)
    if glb_path:
        export_glb(doc, glb_path)
    return triangles_total


def export_glb(doc, path):
    data = bytearray(base64.b64decode(doc["buffers"][0]["uri"].split(",", 1)[1], validate=True))
    binary_doc = dict(doc)
    binary_doc["buffers"] = [{"byteLength": len(data)}]
    text = json.dumps(binary_doc, ensure_ascii=False, separators=(",", ":")).encode()
    text += b" " * ((-len(text)) % 4)
    data.extend(b"\x00" * ((-len(data)) % 4))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<III", 0x46546c67, 2, 28 + len(text) + len(data)) +
        struct.pack("<II", len(text), 0x4e4f534a) + text + struct.pack("<II", len(data), 0x004e4942) + data)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "data/kabukicho-intake.json")
    ap.add_argument("--archive", type=Path)
    ap.add_argument("--download", action="store_true", help="Download the pinned official archive")
    args = ap.parse_args()
    config = json.loads(args.config.read_text())
    raw = ROOT / "data/raw/plateau-13104-2025"
    raw.mkdir(parents=True, exist_ok=True)
    archive = args.archive
    if args.download:
        archive = raw / "source.zip"
        request = urllib.request.Request(config["archive_url"], headers={"User-Agent": "showa-tokyo-3d/0.1"})
        with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
    if not archive:
        ap.error("Provide --archive PATH or --download")
    expected = config.get("archive_sha256")
    if expected and sha256(archive) != expected:
        raise ValueError("Archive checksum differs from the pinned source; inspect the new version before importing")
    with zipfile.ZipFile(archive) as z:
        for member in config["members"]:
            (raw / Path(member).name).write_bytes(z.read(member))
    features, totals = [], {}
    for kind, filename in [("building", "53394536_bldg_6697_op.gml"), ("road", "53394536_tran_6697_op.gml")]:
        selected, total = parse_features(raw / filename, kind, config)
        features.extend(selected)
        totals[kind] = {"source": total, "selected": len(selected)}
    write_json(ROOT / "data/derived/kabukicho-modern-features.json", {"config": config, "features": features}, compact=True)
    triangles = export_gltf(features, SCENE / "models/modern-baseline.gltf", config,
                            ROOT / "renders/r01/modern-baseline.glb")
    manifest = {"schema_version": 1, "dataset_id": config["dataset_id"], "source_year": 2025,
        "archive_url": config["archive_url"], "archive_sha256": sha256(archive),
        "archive_size_bytes": archive.stat().st_size,
        "files": [{"archive_member": m, "sha256": sha256(raw / Path(m).name),
                   "size_bytes": (raw / Path(m).name).stat().st_size} for m in config["members"]],
        "counts": totals, "triangles": triangles, "geometry_role": "modern-reference-only",
        "source_crs": config["source_crs"], "origin_jgd2011": config["origin_jgd2011"],
        "vertical_mode": config["vertical_mode"], "license": config["license_selected"]}
    write_json(ROOT / "data/derived/kabukicho-intake-manifest.json", manifest)
    print(json.dumps({"counts": totals, "triangles": triangles, "archive_sha256": manifest["archive_sha256"]}))


if __name__ == "__main__":
    main()
