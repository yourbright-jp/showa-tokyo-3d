#!/usr/bin/env python3
"""Blender entrance look development; inferred facade studies, never certified1976.

blender -b --python scripts/build_entrance_detail.py -- --font FONT --output DIR
The shared source origin and route cameras are preserved. The calibration and
near-facade cameras are separately named studies. No source raster is embedded.
"""
import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SCENE_DIR = ROOT / "scenes/shinjuku/kabukicho/1976"
SPEC_PATH = SCENE_DIR / "detail/entrance-detail-spec.json"
RNG = random.Random(1976)
COLLECTIONS = {}
M = {}
FONT = None
ANCHOR = None
FORWARD = None
RIGHT = None
ANGLE = None
SPHERE_MESHES = {}


def args_from_cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", required=True, type=Path, help="CJK OTF/TTF, e.g. Noto Sans CJK JP")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--gate", choices=("none", "curved", "straight"), default="none")
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--views", default="entrance-calibration,entrance-approach,near-facade")
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--skip-modern-context", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def collection(name):
    if name not in COLLECTIONS:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLLECTIONS[name] = c
    return COLLECTIONS[name]


def assign(obj, group, material=None):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection(group).objects.link(obj)
    if material:
        obj.data.materials.append(material)
    obj["reconstruction_status"] = "inferred-look-development"
    return obj


def world(u, v, h):
    """Street frame to Blender; underlying world remains X east,Y north,Z up."""
    p = ANCHOR + RIGHT * u + FORWARD * v
    return Vector((p.x, -p.y, h))


def interchange_from_street(u, v, h):
    p = ANCHOR + RIGHT * u + FORWARD * v
    return [round(p.x, 5), h, round(p.y, 5)]


def box(name, center, dims, material, group="Architecture", bevel=0.025):
    # Direct mesh creation avoids an O(scene-size) depsgraph rebuild for every
    # pane/jamb/tile joint. Geometry is identical to an applied-scale cube.
    x, y, z = [d / 2 for d in dims]
    data = bpy.data.meshes.new(name)
    data.from_pydata([(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
                      (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)], [],
                     [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                      (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection(group).objects.link(obj)
    obj.location = world(*center)
    obj.rotation_euler.z = ANGLE
    data.materials.append(material)
    obj["reconstruction_status"] = "inferred-look-development"
    if bevel > 0:
        mod = obj.modifiers.new("Soft manufactured edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.affect = "EDGES"
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


def mesh(name, verts, faces, material, group="Architecture", bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([world(*p) for p in verts], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection(group).objects.link(obj)
    if material:
        data.materials.append(material)
    obj["reconstruction_status"] = "inferred-look-development"
    if bevel:
        mod = obj.modifiers.new("Edge softening", "BEVEL")
        mod.width, mod.segments = bevel, 2
        obj.modifiers.new("Normals", "WEIGHTED_NORMAL")
    return obj


def line(name, points, radius, material, group="Street fittings", cyclic=False):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*world(*co), 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    collection(group).objects.link(obj)
    curve.materials.append(material)
    obj["reconstruction_status"] = "inferred-look-development"
    return obj


def sphere(name, center, radius, material, group="Lighting fittings"):
    # Small repeated bulbs share a true spherical mesh. Operators would rebuild
    # the whole scene's evaluated bevel geometry for every incandescent bulb.
    key = (radius, material.name)
    if key not in SPHERE_MESHES:
        data = bpy.data.meshes.new(name + " shared sphere")
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=radius)
        bm.to_mesh(data)
        bm.free()
        data.materials.append(material)
        for p in data.polygons:
            p.use_smooth = True
        SPHERE_MESHES[key] = data
    obj = bpy.data.objects.new(name, SPHERE_MESHES[key])
    collection(group).objects.link(obj)
    obj.location = world(*center)
    obj["reconstruction_status"] = "inferred-look-development"
    return obj


def cylinder(name, center, radius, height, material, group="Street fittings", vertices=16):
    data = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=vertices,
                         radius1=radius, radius2=radius, depth=height)
    bm.to_mesh(data)
    bm.free()
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    collection(group).objects.link(obj)
    obj.location = world(*center)
    obj["reconstruction_status"] = "inferred-look-development"
    bevel = obj.modifiers.new("Rounded lip", "BEVEL")
    bevel.width, bevel.segments = min(radius * .1, .015), 2
    obj.modifiers.new("Normals", "WEIGHTED_NORMAL")
    return obj


def rgba(rgb):
    return tuple(rgb) + (1,)


def material(name, colour, roughness=.6, metal=0, variation=0.08, scale=8, bump=.05, coat=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgba(colour)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    p = nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = rgba(colour)
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = coat
    tex = nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = 3
    tex.inputs["Roughness"].default_value = .72
    coord = nodes.new("ShaderNodeTexCoord")
    links.new(coord.outputs["Object"], tex.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .18
    ramp.color_ramp.elements[1].position = .82
    ramp.color_ramp.elements[0].color = rgba([max(0, c * (1 - variation)) for c in colour])
    ramp.color_ramp.elements[1].color = rgba([min(1, c * (1 + variation)) for c in colour])
    links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    if bump:
        bn = nodes.new("ShaderNodeBump")
        bn.inputs["Strength"].default_value = .22
        bn.inputs["Distance"].default_value = bump
        links.new(tex.outputs["Fac"], bn.inputs["Height"])
        links.new(bn.outputs["Normal"], p.inputs["Normal"])
    return mat


def emission(name, colour, strength):
    mat = material(name, colour, .28, variation=.01, bump=0)
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Emission Color"].default_value = rgba(colour)
    p.inputs["Emission Strength"].default_value = strength
    return mat


def make_materials():
    definitions = {
        "ivory": ((.68, .63, .51), .38, 0, .07, 17, .009, .24),
        "tilelight": ((.81, .77, .65), .32, 0, .045, 28, .004, .3),
        "grout": ((.30, .28, .24), .9, 0, .12, 80, .004, 0),
        "concrete": ((.53, .52, .46), .78, 0, .12, 5.5, .025, 0),
        "paleconcrete": ((.72, .70, .62), .76, 0, .07, 6, .015, 0),
        "terracotta": ((.31, .17, .11), .8, 0, .15, 20, .012, 0),
        "stone": ((.21, .19, .16), .82, 0, .13, 17, .025, 0),
        "red": ((.57, .035, .022), .35, .15, .06, 23, .002, .26),
        "blue": ((.022, .09, .21), .29, .12, .06, 16, .002, .35),
        "white": ((.87, .84, .74), .32, .08, .035, 28, .001, .23),
        "ink": ((.022, .026, .023), .4, .08, .08, 32, .001, 0),
        "bronze": ((.115, .105, .076), .33, .66, .12, 20, .002, .15),
        "chrome": ((.48, .50, .48), .25, .9, .04, 25, .001, .2),
        "rust": ((.23, .105, .047), .85, .3, .3, 38, .006, 0),
        "canvasred": ((.56, .05, .035), .94, 0, .12, 140, .003, 0),
        "canvaswhite": ((.72, .67, .54), .95, 0, .14, 140, .003, 0),
        "wood": ((.15, .078, .035), .58, 0, .25, 8, .007, .15),
        "interior": ((.105, .08, .045), .83, 0, .15, 6, .01, 0),
        "asphalt": ((.074, .077, .074), .91, 0, .24, 150, .012, 0),
        "asphaltpatch": ((.054, .057, .054), .92, 0, .28, 170, .008, 0),
        "roadpaint": ((.59, .56, .43), .85, 0, .2, 100, .004, 0),
        "curb": ((.40, .39, .34), .89, 0, .14, 25, .016, 0),
        "rubber": ((.024, .023, .02), .96, 0, .1, 50, .003, 0),
        "hazecontext": ((.38, .40, .38), .85, 0, .06, 3, .02, 0),
    }
    for key, values in definitions.items():
        M[key] = material(key, *values)
    glass = material("Smoky float glass, real thickness", (.12, .19, .21), .12, variation=.03, bump=0)
    p = glass.node_tree.nodes.get("Principled BSDF")
    p.inputs["Transmission Weight"].default_value = .62
    p.inputs["IOR"].default_value = 1.49
    p.inputs["Coat Weight"].default_value = .22
    M["glass"] = glass
    M["bulb"] = emission("Warm frosted incandescent glass", (1, .65, .25), 3)
    M["lightbox"] = emission("Aged opal sign face, subdued in daylight", (.9, .80, .59), .18)


def text(name, body, u, v, h, width, height, colour="ink", side="front", extrude=.007, group="Readable source signs"):
    data = bpy.data.curves.new(name, "FONT")
    data.body = body
    data.font = FONT
    data.align_x = "CENTER"
    data.align_y = "CENTER"
    data.size = 1
    data.space_character = 1.04
    data.space_line = .9
    data.extrude = extrude
    data.bevel_depth = .001
    data.bevel_resolution = 1
    obj = bpy.data.objects.new(name, data)
    collection(group).objects.link(obj)
    obj.location = world(u, v, h)
    # Text local X reads horizontally; local Y points vertically upward.
    local_rotation = Matrix.Rotation(math.pi / 2, 4, "X")
    if side == "right-side":
        local_rotation = Matrix.Rotation(math.pi / 2, 4, "Z") @ local_rotation
    elif side == "left-side":
        local_rotation = Matrix.Rotation(-math.pi / 2, 4, "Z") @ local_rotation
    obj.rotation_euler = (Matrix.Rotation(ANGLE, 4, "Z") @ local_rotation).to_euler()
    data.materials.append(M[colour])
    bpy.context.view_layer.update()
    # Dimensions are measured in text's own plane to avoid world-axis skew.
    points = [Vector(p) for p in obj.bound_box]
    tw = max(p.x for p in points) - min(p.x for p in points)
    th = max(p.y for p in points) - min(p.y for p in points)
    factor = min(width / max(tw, .001), height / max(th, .001))
    obj.scale = (factor, factor, factor)
    obj["source_text"] = body
    obj["text_status"] = "Readable source transcription;1976 retention unverified"
    return obj


def front_sign(name, u, v, h, width, height, body, face="white", lettering="ink", depth=.22, size=.78, bulbs=False):
    box(name + " steel cabinet", (u, v, h), (width, depth, height), M["bronze"], "Analog sign cabinets", .025)
    box(name + " inset enamel face", (u, v - depth / 2 - .012, h), (width - .10, .025, height - .10), M[face], "Analog sign cabinets", .012)
    text(name + " readable lettering", body, u, v - depth / 2 - .035, h, width * .91, height * size, lettering)
    # Independent fixing brackets create real projection and shadow.
    for du in (-width * .38, width * .38):
        box(name + " rear angle bracket", (u + du, v + .22, h - height * .25), (.06, .48, .08), M["rust"], "Analog sign cabinets", .008)
    if bulbs:
        for edgeh in (h - height / 2 + .09, h + height / 2 - .09):
            n = max(2, int(width / .22))
            for i in range(n + 1):
                sphere(name + " border bulb", (u - width / 2 + .12 + (width - .24) * i / n, v - depth / 2 - .055, edgeh), .034, M["bulb"], "Analog sign cabinets")


def window_front(name, u, v, h, width, height, divisions=2, lit=False, curtains=False):
    """Recessed aperture: reveal, frames, glass, sill and a real interior beyond."""
    box(name + " dark interior beyond glass", (u, v + .82, h), (width + .10, .12, height + .10), M["interior"], "Shop interiors", .005)
    box(name + " sill", (u, v + .05, h - height / 2 - .055), (width + .20, .54, .11), M["paleconcrete"], bevel=.015)
    box(name + " top reveal", (u, v + .21, h + height / 2 + .045), (width + .18, .42, .09), M["concrete"], bevel=.012)
    for sign in (-1, 1):
        box(name + " reveal jamb", (u + sign * (width / 2 + .035), v + .23, h), (.07, .46, height), M["concrete"], bevel=.01)
    box(name + " glass", (u, v + .34, h), (width, .024, height), M["glass"], "Glazing", .004)
    for du in [-width / 2 + i * width / divisions for i in range(divisions + 1)]:
        box(name + " vertical bronze mullion", (u + du, v + .29, h), (.042, .08, height + .04), M["bronze"], "Glazing", .007)
    for dh in (-height / 2, height / 2):
        box(name + " window frame", (u, v + .29, h + dh), (width + .05, .08, .043), M["bronze"], "Glazing", .007)
    if height > 1.8:
        box(name + " transom", (u, v + .28, h + height * .22), (width, .065, .032), M["bronze"], "Glazing", .004)
    if curtains:
        for du in (-width * .34, width * .34):
            box(name + " recessed curtain", (u + du, v + .57, h), (width * .21, .045, height * .93), M["canvaswhite"], "Shop interiors", .012)
    if lit:
        for du in (-width * .25, width * .25):
            sphere(name + " interior ceiling bulb", (u + du, v + .62, h + height * .32), .065, M["bulb"], "Shop interiors")


def window_side(name, u, v, h, width, height, toward="left", divisions=2):
    """Side-window aperture along street, width is along V; no opaque wall at glass."""
    s = 1 if toward == "left" else -1
    box(name + " shadow box", (u + s * .63, v, h), (.12, width + .10, height + .10), M["interior"], "Shop interiors", .005)
    box(name + " glazing", (u + s * .27, v, h), (.024, width, height), M["glass"], "Glazing", .004)
    for dv in [-width / 2 + i * width / divisions for i in range(divisions + 1)]:
        box(name + " mullion", (u + s * .23, v + dv, h), (.065, .04, height + .04), M["bronze"], "Glazing", .005)
    for dh in (-height / 2, height / 2):
        box(name + " frame", (u + s * .23, v, h + dh), (.065, width + .05, .04), M["bronze"], "Glazing", .005)
    box(name + " projecting sill", (u + s * .10, v, h - height / 2 - .06), (.45, width + .18, .12), M["concrete"], bevel=.012)


def interior_shop(name, u, v, width, depth, ground=.16):
    box(name + " interior floor", (u, v + depth / 2, ground), (width, depth, .12), M["stone"], "Shop interiors", .01)
    box(name + " warm rear wall", (u, v + depth, 1.6), (width, .18, 3), M["wood"], "Shop interiors")
    box(name + " bar top", (u, v + depth * .63, 1.12), (width * .76, .6, .12), M["wood"], "Shop interiors", .035)
    box(name + " bar base", (u, v + depth * .65, .61), (width * .7, .48, 1), M["interior"], "Shop interiors")
    for hh in (1.5, 2.1):
        box(name + " back shelf", (u, v + depth - .2, hh), (width * .78, .23, .06), M["wood"], "Shop interiors", .01)
    for du in (-width * .28, 0, width * .28):
        line(name + " pendant flex", [(u + du, v + depth * .45, 3.05), (u + du, v + depth * .45, 2.55)], .012, M["rubber"], "Shop interiors")
        cylinder(name + " pendant shade", (u + du, v + depth * .45, 2.53), .19, .14, M["bronze"], "Shop interiors")
        sphere(name + " pendant bulb", (u + du, v + depth * .45, 2.43), .07, M["bulb"], "Shop interiors")
    light(name + " soft interior warmth", (u, v + depth * .5, 2.7), (u, v + depth * .6, .7), 80, 2.5, (1, .68, .39))


def awning(name, u, v, width, height=3.0, projection=1.1):
    stripes = max(10, int(width / .20))
    for i in range(stripes):
        a = u - width / 2 + width * i / stripes
        b = u - width / 2 + width * (i + 1) / stripes
        mat = M["canvasred"] if i % 2 == 0 else M["canvaswhite"]
        verts = [(a, v + .07, height + .5), (b, v + .07, height + .5), (b, v - projection, height), (a, v - projection, height)]
        mesh(name + " canvas stripe", verts, [(0, 1, 2, 3)], mat, "Canvas awnings")
        # Scalloped valance has real curved lower silhouette.
        x0, x1 = a, b
        pts = [(x0, v - projection, height), (x1, v - projection, height)]
        pts += [(x1 - (x1 - x0) * j / 8, v - projection - .005, height - .15 - .055 * math.sin(math.pi * j / 8)) for j in range(9)]
        mesh(name + " scalloped valance", pts, [tuple(range(len(pts)))], mat, "Canvas awnings")
    line(name + " front steel rod", [(u - width / 2, v - projection + .02, height + .015), (u + width / 2, v - projection + .02, height + .015)], .023, M["bronze"], "Canvas awnings")
    for du in (-width * .42, width * .42):
        line(name + " diagonal support", [(u + du, v + .08, height - .42), (u + du, v - projection + .05, height + .01)], .023, M["bronze"], "Canvas awnings")


def left_frontage():
    u, width, depth, height = -8.8, 7.6, 18.5, 23.6
    # The shell is open at its camera-facing front and street-facing side.
    box("Suzuya rear masonry", (u, depth - .15, height / 2), (width, .3, height), M["ivory"])
    box("Suzuya outer party wall", (u - width / 2 + .15, depth / 2, height / 2), (.3, depth, height), M["concrete"])
    # Actual floor slabs; the top and underside remain visible through apertures.
    levels = [.16, 3.75, 7.15, 10.65, 14.2, 17.75, 21.25, 23.45]
    for hh in levels:
        box("Suzuya floor slab", (u, depth / 2, hh), (width, depth, .23), M["concrete"], bevel=.018)
    for col in (-12.5, -10.0, -7.55, -5.12):
        box("Suzuya pale tiled full-height pier", (col, .18, 11.85), (.31, .55, 23.3), M["tilelight"])
    # Broad opaque tiled spandrels deliberately differ from the open top-floor bays.
    for hh, tall in [(3.56, .62), (6.75, 1.0), (10.12, .72), (13.92, .55), (17.48, .55), (21.03, .55), (23.4, .36)]:
        box("Suzuya tiled spandrel", (u, .22, hh), (width, .46, tall), M["ivory"])
    for rowh, winh, split in [(5.02, 2.15, 2), (8.48, 2.30, 2), (12.03, 2.35, 2), (15.59, 2.35, 2), (19.12, 2.36, 1), (22.38, 1.55, 1)]:
        for j, col in enumerate((-11.22, -8.77, -6.34)):
            window_front("Suzuya upper bay %.2f/%d" % (rowh, j), col, .22, rowh, 2.05, winh, split, lit=rowh == 5.02, curtains=rowh == 8.48)
    for col in (-11.17, -8.73, -6.3):
        window_front("Suzuya recessed shop window", col, .12, 1.81, 2.02, 2.96, divisions=2, lit=True)
    interior_shop("Suzuya inferred shop interior", u, .62, 6.7, 3.3)
    # Source08 suggests a broad gridded lower glazing field, source01 narrower upper bays.
    for v in (2.15, 5.0, 8.0, 11.1, 14.25, 17.1):
        box("Suzuya side structural pier", (-5.11, v, 10.72), (.34, .31, 21.1), M["ivory"])
    for hh in (3.63, 7.01, 10.51, 14.06, 17.61, 21.12):
        box("Suzuya side spandrel", (-5.12, 10, hh), (.34, 18.5, .54), M["ivory"])
    for i, v in enumerate((3.53, 6.5, 9.53, 12.65, 15.72)):
        for j, hh in enumerate((5.0, 8.5, 12.0, 15.55, 19.1)):
            window_side("Suzuya side recessed bay %d/%d" % (i, j), -5.12, v, hh, 2.45, 2.7, "right", 2)
    # Thin grout lines create restrained surface scale, not flat photo detail.
    for hh in [i * .3 + .4 for i in range(76)]:
        if any(abs(hh - level) < .28 for level in (3.56, 6.75, 10.12, 13.92, 17.48, 21.03)):
            box("Suzuya horizontal tile joint", (u, -.023, hh), (7.5, .008, .008), M["grout"], "Tile relief", 0)
    for col in (-12.5, -10, -7.55, -5.12):
        for hh in (3.55, 6.74, 10.12, 13.92, 17.48, 21.03):
            box("Tiled pier joint", (col, -.101, hh), (.30, .01, .012), M["grout"], "Tile relief", 0)
    front_sign("Suzuya restaurant fascia", u, -.19, 6.88, 7.23, 1.08, "レストラン  すずや", "white", "ink", size=.68)
    front_sign("Suzuya calligraphy cabinet", -5.04, -.31, 12.11, .91, 6.28, "す\nず\nや", "white", "ink", size=.87)
    front_sign("Restaurant sixth floor", u, -.20, 17.75, 7.22, 1.75, "レストラン  6F\nインドネシアラヤ", "white", "red", size=.78)
    front_sign("Fourth floor school cabinet", u, -.20, 13.95, 7.22, 2.15, "4階  簿記", "white", "ink", size=.66)
    front_sign("Small Suzuya nameplate", -8.8, -.41, 3.71, 5.4, .64, "すずや", "red", "white", size=.76)
    awning("Suzuya striped awning", u, -.12, 7.18, 3.02, 1.05)
    # Two projecting lanterns from08; glazing, frame and mounting are modeled.
    for col in (-12.35, -5.28):
        lantern("Suzuya lantern", col, -.44, 4.72)
    rooftop_rail("Suzuya roof rail", -12.55, -5.05, 0, 18.4, height + .18)
    # Distinct metal support structure above roof; no invented billboard wording.
    for col in (-11.6, -6.0):
        box("Roof sign steel upright", (col, 1.0, 24.42), (.14, .14, 2.25), M["rust"], "Roof fittings")
    front_sign("Roof analog restaurant cabinet", u, .65, 25.45, 7.02, 2.2, "すずや", "white", "red", size=.66)


def right_frontage():
    u, width, depth, height = 9.7, 7, 20, 30.4
    box("Right corner rear wall", (u, 19.86, height / 2), (width, .28, height), M["concrete"])
    box("Right corner outer party wall", (13.08, 10, height / 2), (.26, depth, height), M["concrete"])
    for hh in (.14, 3.6, 6.65, 10.05, 13.45, 16.85, 20.25, 23.65, 27.05, 30.2):
        box("Right corner recessed floor slab", (9.74, 10.1, hh), (6.76, 19.8, .24), M["concrete"])
    for col, thick in [(6.31, .42), (8.03, .26), (9.76, .34), (11.47, .28), (13.07, .34)]:
        box("Right full-height projecting concrete fin", (col, -.04, 16.95), (thick, .92, 26.8), M["paleconcrete"], bevel=.035)
    for j, hh in enumerate((5.10, 8.34, 11.75, 15.15, 18.55, 21.95, 25.35, 28.62)):
        # Floors have individually modeled apertures and thin recess bands.
        box("Right recessed horizontal spandrel", (u, .37, hh + 1.34), (6.9, .36, .31), M["concrete"])
        for k, col in enumerate((7.15, 8.88, 10.62, 12.27)):
            window_front("Right corner bay %d/%d" % (j, k), col, .37, hh, 1.28 if k < 3 else 1.12, 2.65, 1, lit=j == 0)
    # Open ground-floor portal with visible jamb thickness and sheltered entry.
    for col in (6.38, 10.25, 13.03):
        box("Right portal stone pier", (col, .35, 1.8), (.42, .85, 3.6), M["stone"])
    box("Right deep shop lintel", (u, -.1, 3.6), (7.0, 1.10, .42), M["stone"])
    window_front("Right recessed bar front", 8.31, .55, 1.78, 3.15, 2.94, 3, lit=True)
    window_front("Right recessed entrance doors", 11.69, .70, 1.78, 2.30, 2.94, 2, lit=True)
    interior_shop("Right inferred pub interior", 9.5, 1.1, 6, 3.6)
    for col in (10.98, 12.08):
        line("Door pull", [(col, .85, .95), (col, .85, 1.55)], .018, M["chrome"], "Glazing")
    # Source01 sidewall is a strong, long structural rhythm rather than a billboard.
    for v in (1, 4.45, 7.9, 11.35, 14.8, 18.25):
        box("Right side pilaster", (6.32, v, 15.2), (.63, .30, 30.2), M["concrete"])
    for hh in (3.6, 6.65, 10.05, 13.45, 16.85, 20.25, 23.65, 27.05, 30.2):
        box("Right street side dark spandrel", (6.39, 10.05, hh), (.38, 19.85, .43), M["stone"])
    for j, v in enumerate((2.68, 6.13, 9.58, 13.03, 16.48)):
        for k, hh in enumerate((5.10, 8.35, 11.75, 15.15, 18.55, 21.95, 25.35, 28.62)):
            window_side("Right side opening %d/%d" % (j, k), 6.33, v, hh, 2.92, 2.60, "left", 2)
    front_sign("Blue pub enamel fascia", 9.62, -.68, 6.02, 6.44, 1.00, "居酒屋 ポテト", "blue", "white", size=.70)
    front_sign("Honjin vertical cabinet", 7.06, -.60, 17.2, 1.01, 10.2, "本\n陣", "lightbox", "ink", size=.58)
    front_sign("Robata narrow cabinet", 8.28, -.62, 16.1, .69, 8.0, "ろ\nば\nた\n本\n陣", "white", "ink", size=.83)
    front_sign("Small Honjin door sign", 12.39, -.33, 4.75, .69, 2.1, "本\n陣", "red", "white", size=.75)
    # Sweeping metal trim beside actual windows; not emissive neon in daylight.
    for offset in (0, .18):
        pts = [(6.74 + offset, -.39, 22.4), (6.74 + offset, -.40, 11.0)]
        pts += [(6.74 + offset + 2.2 * (1 - math.cos(t * math.pi / 2)), -.40, 11 - 2.2 * math.sin(t * math.pi / 2)) for t in [i / 20 for i in range(1, 21)]]
        pts.append((11.7, -.4, 8.8))
        line("Right corner swept metal trim", pts, .065, M["bronze"], "Facade metalwork")
    rooftop_rail("Right corner roof rail", 6.2, 13.2, .2, 19.8, 30.6)
    # A blank enamel backboard is omitted: unreadable source artwork is not filled with fake glyphs.


def adjacent_frontages():
    # Adjacent left: horizontal glazing, russet panels and deep band shadows.
    box("Adjacent west volume", (-17.15, 9.0, 12.7), (8.5, 18, 25.4), M["terracotta"])
    for j, hh in enumerate((2, 5.5, 9.0, 12.5, 16, 19.5, 23)):
        # Glazing sits outside an inset wall face; these distant apertures are not hero interiors.
        for k, uu in enumerate((-20.05, -17.25, -14.45)):
            window_front("West horizontal window %d/%d" % (j, k), uu, -.39, hh, 2.60, 1.75, 2, lit=j == 0)
        box("West proud band", (-17.15, -.24, hh + 1.24), (8.5, .52, .37), M["stone"])
    awning("Adjacent west canvas canopy", -17.1, -.55, 7.5, 2.97, .85)
    # Adjacent right is lower and has a stepped concrete parapet, not a duplicate tower.
    box("East adjacent concrete core", (18.9, 9.1, 11.1), (10.4, 18, 22.2), M["paleconcrete"])
    for j, hh in enumerate((2.0, 5.6, 9.2, 12.8, 16.4, 20.0)):
        for k, uu in enumerate((15.45, 18.9, 22.35)):
            window_front("East separate aperture %d/%d" % (j, k), uu, -.38, hh, 2.4 if j else 2.85, 2.5, 2, lit=j == 0)
        box("East course cap", (18.9, -.12, hh + 1.5), (10.45, .38, .22), M["concrete"])
    box("East taller stair head", (22.3, 8, 23.0), (3.4, 8, 2.0), M["concrete"])
    rooftop_rail("East roof rail", 13.8, 24.1, .2, 17.8, 22.45)
    # Intermediate depth is modest context: a few distinct forms, no generated rows of fake businesses.
    for name, center, dims, mat in [
        ("Left recessed context volume", (-9.6, 27, 8.6), (8.6, 12, 17.2), "terracotta"),
        ("Right narrow context volume", (9.8, 27.5, 9.7), (7.0, 12.2, 19.4), "paleconcrete"),
        ("Left pale distant block", (-9.5, 44, 9), (8.3, 15, 18), "paleconcrete"),
        ("Right low distant block", (10.0, 44, 6.9), (7.1, 15, 13.8), "concrete")]:
        box(name, center, dims, M[mat], "Restrained period context", .04)
    for side, u, v, hh in [("left", -5.25, 27, 7.0), ("right", 6.3, 28.5, 9.0), ("left", -5.3, 42, 6.2), ("right", 6.4, 44, 5.4)]:
        # Individual unlettered awning shapes; uncertain text is left absent.
        box("Distant simple projecting canopy", (u, v, hh), (1.0, 4.4, .18), M["blue"] if side == "left" else M["red"], "Restrained period context", .025)
    # Far-end low obstruction discourages looking into an unfinished procedural canyon.
    box("Far street atmospheric closure", (.6, 65, 5.0), (22, 8, 10), M["hazecontext"], "Restrained period context", .03)


def lantern(name, u, v, h):
    box(name + " mounting arm", (u, v + .07, h), (.12, .5, .12), M["bronze"], "Lighting fittings")
    box(name + " warm glass body", (u, v - .20, h), (.45, .4, 1.18), M["bulb"], "Lighting fittings", .018)
    for du in (-.245, .245):
        for dv in (-.42, .02):
            box(name + " frame", (u + du, v + dv, h), (.055, .055, 1.34), M["bronze"], "Lighting fittings", .008)
    for dh in (-.64, -.22, .22, .64):
        box(name + " cross frame", (u, v - .43, h + dh), (.55, .06, .055), M["bronze"], "Lighting fittings", .008)
    verts = [(u - .38, v - .52, h + .68), (u + .38, v - .52, h + .68), (u + .38, v + .16, h + .68), (u - .38, v + .16, h + .68), (u, v - .18, h + 1.03)]
    mesh(name + " metal pyramidal roof", verts, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], M["bronze"], "Lighting fittings", .012)


def rooftop_rail(name, u0, u1, v0, v1, h):
    for vv in (v0, v1):
        line(name + " horizontal tube", [(u0, vv, h + .68), (u1, vv, h + .68)], .022, M["bronze"], "Roof fittings")
        count = max(2, int((u1 - u0) / 1.3))
        for j in range(count + 1):
            uu = u0 + (u1 - u0) * j / count
            line(name + " upright", [(uu, vv, h), (uu, vv, h + .68)], .02, M["bronze"], "Roof fittings")


def street():
    box("Continuous dry asphalt", (0, 18, -.12), (110, 136, .22), M["asphalt"], "Road and pavement", 0)
    # Sidewalk apron on the large road. The lane itself is not tiled like a plaza.
    box("Yasukuni footway apron", (0, -2.5, -.015), (58, 5.1, .18), M["curb"], "Road and pavement", .01)
    for side, edge in (("west", -5.12), ("east", 6.26)):
        center = edge + (-.35 if side == "west" else .35)
        box(side + " narrow raised shop apron", (center, 10.0, .025), (.68, 20.3, .16), M["curb"], "Road and pavement", .012)
        for v in [i * .9 for i in range(23)]:
            box(side + " curb joint", (center, v, .107), (.66, .013, .004), M["grout"], "Road and pavement", 0)
        box(side + " gutter channel", (edge + (.11 if side == "west" else -.11), 10.0, .003), (.15, 20.2, .045), M["stone"], "Road and pavement", .005)
        for v in (2.6, 9.7, 17.8):
            for j in range(8):
                box(side + " iron drain slots", (edge + (.1 if side == "west" else -.1), v + j * .045, .029), (.27, .019, .014), M["bronze"], "Road and pavement", .002)
    # Road repairs are actual thin geometries with restrained contrast.
    mesh("Irregular repaired asphalt seam", [(-1.4, 4.1, .002), (1.7, 4.4, .002), (1.4, 12.5, .002), (.2, 15.1, .002), (-1.5, 13.2, .002)], [(0, 1, 2, 3, 4)], M["asphaltpatch"], "Road and pavement")
    cylinder("Cast iron service cover", (-1.6, 7.6, .008), .38, .026, M["bronze"], "Road and pavement", 48)
    for z in (-.22, -.11, 0, .11, .22):
        half = math.sqrt(.32 ** 2 - z ** 2)
        line("Service cover casting rib", [(-1.6 - half, 7.6 + z, .028), (-1.6 + half, 7.6 + z, .028)], .009, M["ink"], "Road and pavement")
    # Foreground crossing is separated from the entrance carriageway.
    for u in (-9, -6.8, -4.6, -2.4, -.2, 2.0, 4.2, 6.4, 8.6, 10.8):
        box("Worn crossing stripe", (u, -8.2, -.002), (1.18, 5.3, .007), M["roadpaint"], "Road and pavement", .01)
    for u, v in [(-4.45, 4), (5.6, 5.7), (-4.4, 17), (5.6, 18.5)]:
        cylinder("Short painted kerb bollard", (u, v, .39), .048, .78, M["white"])
        cylinder("Bollard dark foot", (u, v, .10), .063, .18, M["bronze"])


def street_fittings():
    # Two source-inspired clusters of opal globes; positions are inferred.
    for u, v in ((-4.3, 1.55), (5.55, 8.8)):
        cylinder("Fluted streetlight post", (u, v, 2.35), .064, 4.7, M["bronze"])
        cylinder("Streetlight collar", (u, v, 3.9), .092, .13, M["bronze"])
        for du, dh in ((0, .50), (-.42, .23), (.42, .23)):
            line("Streetlight branch", [(u, v, 4.0), (u + du, v, 4.3 + dh)], .027, M["bronze"])
            sphere("Streetlight opal globe", (u + du, v, 4.47 + dh), .145, M["white"])
    # Utility pole and sagging wire paths stay outside the walking centreline.
    for u, v, h in ((5.82, 17.7, 10.7), (-4.72, 35.5, 10.2)):
        cylinder("Painted utility pole", (u, v, h / 2), .12, h, M["stone"], vertices=12)
        box("Pole cross arm", (u, v, h - .7), (2.15, .1, .12), M["wood"], "Street fittings", .02)
        for du in (-.78, -.25, .27, .78):
            cylinder("Ceramic insulator", (u + du, v, h - .52), .055, .24, M["ivory"], vertices=12)
    for offset in (-.5, .1, .7):
        pts = []
        for j in range(31):
            t = j / 30
            pts.append((5.82 * (1 - t) - 4.72 * t + offset, 17.7 * (1 - t) + 35.5 * t, 10.35 * (1 - t) + 9.85 * t - .75 * math.sin(math.pi * t)))
        line("Sagging overhead service cable", pts, .013, M["rubber"])
    line("Frontage telephone cable", [(-12.4, -.5, 7.2), (-5, -.8, 7.0), (6.3, -.8, 7.3), (13.1, -.5, 7.6)], .018, M["rubber"])
    # Narrow pipe work is fixed to masonry rather than floating in front of glass.
    for u, v in ((-5.02, 18.2), (6.21, 19.0)):
        line("Downpipe", [(u, v, 22), (u, v, .38), (u + .2, v, .18)], .035, M["bronze"], "Facade metalwork")


def optional_gate(kind):
    if kind == "none":
        return
    before = set(bpy.data.objects)
    group = "Optional gate hypothesis %s, NOT verified1976" % kind
    for u in (-4.60, 5.65):
        cylinder("Gate inferred support post", (u, 0, 2.80), .11, 5.60, M["red"], group)
        cylinder("Gate post base shoe", (u, 0, .16), .17, .32, M["bronze"], group)
    if kind == "straight":
        front_sign("1972 straight gate hypothesis", .53, -.04, 5.44, 10.55, 1.11, "歌舞伎町一番街", "red", "white", depth=.43, size=.70)
        front_sign("1972 gate header", .53, .01, 6.35, 7.70, .63, "娯楽センター", "white", "red", depth=.23, size=.75)
        for h in (4.87, 6.02):
            line("Straight gate striped metal rim", [(-4.84, -.31, h), (5.9, -.31, h)], .05, M["white"], group)
    else:
        # The two upward-sweeping red tails and central oval follow the source silhouette.
        centeru, centerh, a, b = .52, 5.55, 4.60, .91
        outer = [(centeru + a * math.cos(t), -.11, centerh + b * math.sin(t)) for t in [2 * math.pi * i / 80 for i in range(80)]]
        inner = [(centeru + (a - .28) * math.cos(t), -.12, centerh + (b - .28) * math.sin(t)) for t in [2 * math.pi * i / 80 for i in range(80)]]
        verts = outer + inner
        faces = [(i, (i + 1) % 80, (i + 1) % 80 + 80, i + 80) for i in range(80)]
        mesh("1978 red oval gate hypothesis", verts, faces, M["red"], group)
        for s in (-1, 1):
            pts = [(centeru + s * (3.9 + .9 * t), -.1, 5.1 + 1.45 * t * t) for t in [i / 20 for i in range(21)]]
            line("1978 upward tail cabinet", pts, .22, M["red"], group)
            line("1978 gate rear metal brace", [(centeru + s * 3.9, .12, 4.8), (centeru + s * 5.1, .15, 5.9)], .05, M["bronze"], group)
        front_sign("1978 curved gate word panel", centeru, -.19, centerh, 7.15, .79, "歌舞伎町一番街", "white", "red", depth=.21, size=.74)
        for i in range(90):
            t = 2 * math.pi * i / 90
            sphere("1978 gate individual incandescent bulb", (centeru + 4.48 * math.cos(t), -.17, centerh + .79 * math.sin(t)), .045, M["bulb"], group)
    for obj in list(bpy.data.objects):
        if obj not in before:
            assign(obj, group)
            obj["gate_variant_year"] = 1972 if kind == "straight" else 1978
            obj["verified_for1976"] = False


def modern_context():
    """Read the existing baseline, preserve source vertices; hide overlapping context."""
    path = ROOT / "data/derived/kabukicho-layout-features.json"
    if not path.exists():
        return {"included": False, "reason": "layout-feature input unavailable"}
    data = json.loads(path.read_text())
    visible, hidden = [], []
    c = collection("Modern2025 reference geometry — NOT historical")
    c["source"] = "PLATEAU Tokyo/Shinjuku2025 modified; CC BY4.0"
    for feature in data["features"]:
        if feature["kind"] != "building":
            continue
        points = [p for ring in feature["polygons"] for p in ring]
        cx, cz = [sum(p[k] for p in points) / len(points) for k in (0, 2)]
        q = Vector((cx, cz)) - ANCHOR
        u, v = q.dot(RIGHT), q.dot(FORWARD)
        # Only nearby context matters for reflections and silhouette.
        if abs(u) > 125 or not -30 < v < 135:
            continue
        verts, faces = [], []
        for ring in feature["polygons"]:
            first = len(verts)
            verts.extend([(p[0], -p[2], p[1]) for p in ring])
            faces.append(tuple(range(first, len(verts))))
        meshdata = bpy.data.meshes.new(feature["id"])
        meshdata.from_pydata(verts, [], faces)
        meshdata.materials.append(M["hazecontext"])
        obj = bpy.data.objects.new(feature["id"], meshdata)
        c.objects.link(obj)
        obj["role"] = "modern-reference-only; historical placement unverified"
        obj["source_feature_id"] = feature["id"]
        # Preserve all imported vertices, but do not show modern tower envelopes
        # superimposed on the new period facade calibration set.
        overlap = (-34 < u < 34 and -12 < v < 74)
        obj.hide_render = overlap
        obj.hide_viewport = overlap
        (hidden if overlap else visible).append(feature["id"])
    return {"included": True, "visible_feature_ids": visible, "hidden_overlapping_feature_ids": hidden,
            "geometry_unchanged": True, "license": "CC BY4.0", "attribution": data["config"].get("attribution")}


def light(name, pos, target, energy, size, colour):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    collection("Light rig — daylight look development").objects.link(obj)
    obj.location = world(*pos)
    obj.rotation_euler = (world(*target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def environment():
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("Blue daylight atmosphere, inferred time and weather")
    scene.world.use_nodes = True
    nodes, links = scene.world.node_tree.nodes, scene.world.node_tree.links
    bg = nodes.get("Background")
    sky = nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(39)
    sky.sun_rotation = math.radians(212)
    sky.altitude = .07
    sky.air_density = 1.05
    sky.dust_density = 1.5
    sky.ozone_density = 1
    sky.sun_disc = True
    sky.sun_size = math.radians(1.0)
    sky.sun_intensity = .8
    links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = .32
    data = bpy.data.lights.new("Soft daylight sun", "SUN")
    data.energy = 2.0
    data.angle = math.radians(3.5)
    data.color = (1, .93, .79)
    obj = bpy.data.objects.new("Soft daylight sun", data)
    collection("Light rig — daylight look development").objects.link(obj)
    obj.rotation_euler = (math.radians(31), math.radians(-24), ANGLE + math.radians(-28))
    # Broad sky reflection gives recesses detail without making shop interiors glow.
    light("Open street sky bounce", (0, -13, 17), (0, 8, 9), 1600, 18, (.78, .88, 1))
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = .3
    scene.view_settings.gamma = 1


def camera(name, position, target, lens=35, street_space=False, role="shared-route-proposal"):
    data = bpy.data.cameras.new(name)
    data.lens, data.sensor_width = lens, 36
    data.clip_start, data.clip_end = .08, 750
    data.dof.use_dof = False
    obj = bpy.data.objects.new(name, data)
    collection("Cameras — shared route and labeled separate studies").objects.link(obj)
    obj.location = world(*position) if street_space else Vector((position[0], -position[2], position[1]))
    dest = world(*target) if street_space else Vector((target[0], -target[2], target[1]))
    obj.rotation_euler = (dest - obj.location).to_track_quat("-Z", "Y").to_euler()
    obj["role"] = role
    obj["eye_height_m"] = position[2] if street_space else position[1]
    obj["position_interchange_m"] = [obj.location.x, obj.location.z, -obj.location.y]
    obj["look_at_interchange_m"] = [dest.x, dest.z, -dest.y]
    return obj


def cameras():
    views = {}
    for name in ("entrance-approach", "under-gate"):
        source = json.loads((SCENE_DIR / "cameras" / (name + ".json")).read_text())
        views[name] = camera(name, source["position_m"], source["look_at_m"], source["focal_length_35mm_equivalent_mm"])
    views["entrance-calibration"] = camera("entrance-calibration", (-2.7, -28, 1.6), (.7, 1.8, 12.1), 32, True,
        "separate-reference-framing-calibration; not a route replacement")
    views["near-facade"] = camera("near-facade", (-1.3, 11.2, 1.6), (7.9, 2.7, 5.5), 32, True,
        "separate-oblique-depth-inspection; not a route replacement")
    return views


def build(args):
    global ANCHOR, FORWARD, RIGHT, ANGLE, FONT
    if not args.font.is_file():
        raise FileNotFoundError("Supply an installed redistributable CJK OTF/TTF with --font")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    stations = json.loads((SCENE_DIR / "cameras/route-proposal.json").read_text())["stations"]
    gate = next(s for s in stations if s["id"] == "under-gate")["position_m"]
    middle = next(s for s in stations if s["id"] == "ichibangai-middle")["position_m"]
    ANCHOR = Vector((gate[0], gate[2]))
    FORWARD = Vector((middle[0] - gate[0], middle[2] - gate[2])).normalized()
    RIGHT = Vector((-FORWARD.y, FORWARD.x))
    ANGLE = math.atan2(-RIGHT.y, RIGHT.x)
    FONT = bpy.data.fonts.load(str(args.font.resolve()))
    FONT.pack()
    make_materials()
    print("ENTRANCE_DETAIL_BUILD materials", flush=True)
    context = {"included": False, "reason": "omitted by command-line switch"} if args.skip_modern_context else modern_context()
    street()
    print("ENTRANCE_DETAIL_BUILD baseline and street", flush=True)
    left_frontage()
    print("ENTRANCE_DETAIL_BUILD left frontage", flush=True)
    right_frontage()
    print("ENTRANCE_DETAIL_BUILD right frontage", flush=True)
    adjacent_frontages()
    street_fittings()
    optional_gate(args.gate)
    print("ENTRANCE_DETAIL_BUILD context and fittings", flush=True)
    environment()
    views = cameras()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    scene.render.engine = "CYCLES" if args.engine == "cycles" else "BLENDER_EEVEE_NEXT"
    if args.engine == "cycles":
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = .025
        scene.cycles.max_bounces = 7
        scene.cycles.transmission_bounces = 5
        scene.cycles.transparent_max_bounces = 6
        scene.cycles.use_light_tree = True
    elif hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = args.samples
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.fps = 30
    scene.render.use_file_extension = True
    scene["title"] = "Kabukicho entrance inferred look development, circa1976 target"
    scene["historical_status"] = "Unverified. Not historical certification. See entrance-detail-spec.json."
    scene["gate_variant"] = args.gate
    scene["gate_verified_for1976"] = False
    scene["source_coordinate_mapping"] = "X east,Y up,Z south -> Blender X east,Y north,Z up: (x,-z,y)"
    scene["modern_context_attribution"] = "Project PLATEAU Tokyo/Shinjuku2025 modified data, CC BY4.0"
    selected_views = [name.strip() for name in args.views.split(",") if name.strip()]
    for name in selected_views:
        if name not in views:
            raise ValueError("Unknown view %r, choose %s" % (name, ",".join(views)))
    if not selected_views:
        raise ValueError("Select at least one camera")
    scene.camera = views[selected_views[0]]
    args.output.mkdir(parents=True, exist_ok=True)
    # This copy contains only hashes/provenance, never the source photographs.
    spec = json.loads(SPEC_PATH.read_text())
    (args.output / "entrance-detail-spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
    output_blend = args.output / ("entrance-detail-" + args.gate + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend.resolve()))
    render_files = []
    if not args.no_render:
        for name in selected_views:
            scene.camera = views[name]
            filename = name + "-gate-" + args.gate + ".png"
            scene.render.filepath = str((args.output / filename).resolve())
            bpy.ops.render.render(write_still=True)
            render_files.append(filename)
    manifest = {
        "id": "kabukicho-entrance-detail-r02", "script": str(Path(__file__).relative_to(ROOT)),
        "role": "inferred-look-development-not-historical-certification", "target_year": 1976,
        "gate": args.gate, "gate_source_year_label": {"none": None, "curved": "1978", "straight": "1972"}[args.gate],
        "gate_verified_for1976": False, "blender_version": bpy.app.version_string,
        "engine": args.engine, "samples": args.samples, "resolution": [args.width, args.height],
        "random_seed": 1976, "objects": len(bpy.data.objects), "materials": len(bpy.data.materials),
        "baseline_context": context, "font_filename": args.font.name,
        "font_sha256": hashlib.sha256(args.font.read_bytes()).hexdigest(),
        "spec_sha256": hashlib.sha256(SPEC_PATH.read_bytes()).hexdigest(),
        "blend_filename": output_blend.name, "renders": render_files,
        "validation": {"renders_inspected": False, "independent_historical_critique": "not-performed-by-script", "independent_visual_critique": "not-performed-by-script"},
        "cameras": {name: {"role": obj["role"], "blender_position_m": list(obj.location),
                           "position_interchange_m": list(obj["position_interchange_m"]),
                           "look_at_interchange_m": list(obj["look_at_interchange_m"]),
                           "lens_mm": obj.data.lens} for name, obj in views.items()},
        "authored_asset_license": "MIT", "third_party_rasters_embedded": False,
        "license_notes": "Modern context PLATEAU CC BY4.0; packed CJK font has its own license. Check both before distributing blend."
    }
    (args.output / "build-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    asset = {
        "schema_version": 1, "id": "kabukicho-entrance-detail-r02-" + args.gate,
        "path": output_blend.name, "asset_type": "authored-blender-scene",
        "format": "blend", "units": "metres", "coordinate_system": spec["coordinate_system"],
        "creator": "showa-tokyo-3d reconstruction project", "license_authored_geometry": "MIT",
        "license_url": "https://opensource.org/license/mit",
        "third_party_dependencies": [
            {"asset_id": "kabukicho-layout-study", "source_year": 2025, "role": "modern-reference-only", "license": "CC BY4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/", "attribution": context.get("attribution", "Project PLATEAU Tokyo/Shinjuku2025, modified")},
            {"asset_type": "packed-CJK-font", "filename": args.font.name, "sha256": manifest["font_sha256"], "license": "retain supplied font license; not relicensed by scene MIT"}
        ],
        "reference_source_years": [1972, 1978], "target_reconstruction_year": 1976,
        "source_references": spec["references"], "geographic_status": "approximate",
        "historical_status": "unverified-inferred-look-development",
        "processing": "Script-authored3D geometry, node PBR and stable text; source photographs and approved colour rasters are not embedded. Baseline vertices retain the common origin; overlapping modern context hidden, never overwritten.",
        "sha256": hashlib.sha256(output_blend.read_bytes()).hexdigest(),
        "redistribution": "Authored geometry/code MIT; retain PLATEAU CC BY4.0 attribution and supplied font license. No permission for source photograph redistribution is implied.",
        "validation": manifest["validation"]
    }
    (args.output / (output_blend.name + ".asset.json")).write_text(json.dumps(asset, ensure_ascii=False, indent=2) + "\n")
    print("ENTRANCE_DETAIL_READY " + json.dumps({"blend": str(output_blend), "renders": render_files, "objects": len(bpy.data.objects), "gate": args.gate}))


if __name__ == "__main__":
    build(args_from_cli())
