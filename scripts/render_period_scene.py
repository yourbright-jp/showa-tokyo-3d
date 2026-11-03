#!/usr/bin/env python3
"""Render the adopted reconstruction and prepare reusable CJK sign meshes.

Run with Blender 4.5 LTS. All dimensions use the scene's shared metre datum.
This renderer does not confer historical verification on inferred geometry.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scenes/shinjuku/kabukicho/1976"


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--font", required=True, type=Path)
    p.add_argument("--output", type=Path, default=ROOT / "renders/r03/period")
    p.add_argument("--prepare-text-meshes", action="store_true")
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=720)
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--views", default="entrance-approach,under-gate,ichibangai-middle,towards-koma-corner,plaza-reveal,koma-front")
    p.add_argument("--engine", choices=["cycles", "eevee"], default="cycles")
    p.add_argument("--walk-samples", type=int, default=0, help="Sparse full-route frames; not a rendered full movie")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".pending")
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def blender_point(point):
    return Vector((point[0], -point[2], point[1]))


def text_object(node, font):
    data = bpy.data.curves.new(node["id"], "FONT")
    data.body = node["text"]
    data.font = font
    data.size = node.get("height_m", .5) / .8
    data.extrude = node.get("extrude_m", .016)
    data.bevel_depth = .001
    data.bevel_resolution = 0
    data.resolution_u = 4
    data.align_x, data.align_y = "CENTER", "CENTER"
    obj = bpy.data.objects.new(node["id"], data)
    bpy.context.scene.collection.objects.link(obj)
    if "gate-name" in node["id"]:
        data.space_character = 1.1
    # CJK em metrics differ markedly from Latin metrics. Fit visible evaluated
    # glyph bounds, then center those bounds rather than the font's line box.
    bounds = None
    for _ in range(3):
        bpy.context.view_layer.update()
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated_mesh = evaluated.to_mesh()
        if not evaluated_mesh.vertices:
            raise ValueError("No visible glyph geometry: " + node["id"])
        bounds = [(min(v.co[axis] for v in evaluated_mesh.vertices),
                   max(v.co[axis] for v in evaluated_mesh.vertices)) for axis in (0, 1)]
        evaluated.to_mesh_clear()
        actual_height = bounds[1][1] - bounds[1][0]
        if abs(actual_height - node.get("height_m", .5)) < .00001:
            break
        data.size *= node.get("height_m", .5) / actual_height
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    center_x = (min(v.co.x for v in evaluated_mesh.vertices) + max(v.co.x for v in evaluated_mesh.vertices)) / 2
    center_y = (min(v.co.y for v in evaluated_mesh.vertices) + max(v.co.y for v in evaluated_mesh.vertices)) / 2
    evaluated.to_mesh_clear()
    dx, dz = node.get("baseline_direction_xz", [1, 0])
    right = Vector((dx, -dz, 0)).normalized()
    up = Vector((0, 0, 1))
    outward = right.cross(up).normalized()
    obj.matrix_world = Matrix((right, up, outward)).transposed().to_4x4()
    obj.location = blender_point(node["position_m"]) - right * center_x - up * center_y
    material_name = "Lettering " + node.get("material_key", "custom")
    material = bpy.data.materials.get(material_name)
    if material is None:
        material = bpy.data.materials.new(material_name)
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        rgb = node.get("color_rgba", [1, 1, 1, 1])
        linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in rgb[:3]]
        shader.inputs["Base Color"].default_value = (*linear, rgb[3] if len(rgb) > 3 else 1)
        shader.inputs["Roughness"].default_value = .48
    data.materials.append(material)
    return obj


def prepare_text(args, data):
    font = bpy.data.fonts.load(str(args.font.resolve()))
    features = []
    for node in data.get("text_nodes", []):
        obj = text_object(node, font)
        bpy.context.view_layer.update()
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        polygons = []
        for triangle in mesh.loop_triangles:
            ring = []
            for index in triangle.vertices:
                p = obj.matrix_world @ mesh.vertices[index].co
                ring.append([round(p.x, 6), round(p.z, 6), round(-p.y, 6)])
            polygons.append(ring)
        evaluated.to_mesh_clear()
        features.append({"id": node["id"] + "-glyphs", "name": node["text"], "kind": "building",
                         "role": "stable-sign-lettering", "historical_status": "adopted-inferred",
                         "material_key": node.get("material_key", "sign-white"),
                         "source_decision_id": node.get("source_decision_id", node.get("decision_id")),
                         "text": node["text"], "polygons": polygons})
        bpy.data.objects.remove(obj, do_unlink=True)
    output = ROOT / "data/derived/kabukicho-sign-text-meshes.json"
    write_json(output, {"schema_version": 1, "id": "kabukicho-sign-text-meshes",
                       "font": {"name": font.name, "source": "Noto Fonts bundled with Blender 4.5.15 LTS",
                                "sha256": hashlib.sha256(args.font.read_bytes()).hexdigest(),
                                "license": "OFL-1.1", "license_url": "https://openfontlicense.org/"},
                       "processing": "Blender font curves fitted to requested visible glyph height and visible-bounds center, then tessellated into extruded world-space triangles; no photographic texture",
                       "glyph_fitting": "visible-glyph-bounds-v1",
                       "units": "metres", "coordinate_system": "local east/up/south; common orthometric height offset 32 m",
                       "input_text_nodes_sha256": hashlib.sha256(json.dumps(data.get("text_nodes", []), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                       "features": features})
    print("SIGN_MESHES=" + json.dumps({"features": len(features), "triangles": sum(len(f["polygons"]) for f in features)}), flush=True)


def surface_materials():
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        tree = material.node_tree
        shader = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not shader:
            continue
        name = material.name.lower()
        if "glass" in name or "window" in name:
            shader.inputs["Metallic"].default_value = .35
            shader.inputs["Roughness"].default_value = .22
        elif any(word in name for word in ("concrete", "plaster", "paving", "road", "asphalt", "stone")):
            noise = tree.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 34 if "asphalt" in name else 13
            noise.inputs["Detail"].default_value = 3
            bump = tree.nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = .16
            bump.inputs["Distance"].default_value = .018
            tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
            tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
            base = shader.inputs["Base Color"].default_value[:]
            variation = tree.nodes.new("ShaderNodeMixRGB")
            variation.blend_type = "MULTIPLY"
            variation.inputs[0].default_value = .24
            variation.inputs[1].default_value = base
            tree.links.new(noise.outputs["Fac"], variation.inputs[2])
            tree.links.new(variation.outputs["Color"], shader.inputs["Base Color"])


def environment(args):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Late afternoon sky: adopted look")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    sky = world.node_tree.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(37)
    sky.sun_rotation = math.radians(210)
    sky.sun_disc = False
    sky.altitude = 35
    sky.air_density = 1
    sky.dust_density = 1.7
    background.inputs["Strength"].default_value = .32
    world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
    scene.world = world
    light = bpy.data.lights.new("Daylight sun", "SUN")
    light.energy, light.angle = 2.2, math.radians(3)
    obj = bpy.data.objects.new("Daylight sun", light)
    scene.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(35), math.radians(-22), math.radians(-38))
    scene.render.engine = "CYCLES" if args.engine == "cycles" else "BLENDER_EEVEE_NEXT"
    if args.engine == "cycles":
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = .035
        scene.cycles.max_bounces = 5
        scene.cycles.transparent_max_bounces = 5
    scene.render.threads_mode, scene.render.threads = "FIXED", 8
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = .1
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1


def main():
    args = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data = json.loads((ROOT / "data/derived/kabukicho-period-features.json").read_text(encoding="utf-8"))
    if args.prepare_text_meshes:
        prepare_text(args, data)
        return
    model = SCENE / "models/reconstruction-adopted.gltf"
    bpy.ops.import_scene.gltf(filepath=str(model.resolve()))
    glyphs_included = data.get("generation", {}).get("font_meshes_included", False) or any(f.get("role") == "stable-sign-lettering" for f in data["features"])
    if not glyphs_included:
        font = bpy.data.fonts.load(str(args.font.resolve()))
        for node in data.get("text_nodes", []):
            text_object(node, font)
    surface_materials()
    environment(args)
    args.output.mkdir(parents=True, exist_ok=True)
    images = []
    selected_views = [name for name in args.views.split(",") if name]
    walk_details = {}
    if args.walk_samples:
        walk = json.loads((SCENE / "cameras/adopted-walk.json").read_text(encoding="utf-8"))
        for index in range(args.walk_samples):
            target_time = walk["duration_s"] * index / max(1, args.walk_samples - 1)
            sample = min(walk["samples"], key=lambda s: abs(s["time_s"] - target_time))
            name = f"walk-{index:02d}"
            camera_data = bpy.data.cameras.new(name)
            camera_data.lens, camera_data.sensor_width = 35, 36
            camera_data.clip_start, camera_data.clip_end = .08, 1000
            camera = bpy.data.objects.new(name, camera_data)
            bpy.context.scene.collection.objects.link(camera)
            camera.location = blender_point(sample["position_m"])
            camera.rotation_euler = (blender_point(sample["look_at_m"]) - camera.location).to_track_quat("-Z", "Y").to_euler()
            selected_views.append(name)
            walk_details[name] = {"time_s": sample["time_s"], "phase": sample.get("phase"),
                                  "position_m": sample["position_m"], "look_at_m": sample["look_at_m"]}
    for name in selected_views:
        camera = bpy.data.objects.get(name)
        if camera is None or camera.type != "CAMERA":
            raise ValueError("Missing shared camera " + name)
        bpy.context.scene.camera = camera
        path = args.output / (name + ".png")
        bpy.context.scene.render.filepath = str(path.resolve())
        started = time.monotonic()
        bpy.ops.render.render(write_still=True)
        images.append({"camera": name, "file": path.name, "seconds": round(time.monotonic() - started, 2), **walk_details.get(name, {})})
        print("PERIOD_FRAME=" + json.dumps(images[-1]), flush=True)
    write_json(args.output / "render-manifest.json", {"blender": bpy.app.version_string,
               "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
               "render_engine": args.engine, "samples": args.samples,
               "resolution": [args.width, args.height], "images": images,
               "historical_status": "Adopted reconstruction with documented inferences; not a historical photograph"})


if __name__ == "__main__":
    main()
