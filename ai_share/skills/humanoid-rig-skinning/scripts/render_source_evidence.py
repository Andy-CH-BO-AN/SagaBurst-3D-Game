#!/usr/bin/env python3
"""Render neutral-light front and side evidence from an FBX source."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--textures", type=Path)
    parser.add_argument("--faction", choices=("viking", "roman"), required=True)
    return parser.parse_args(args)


def look_at(camera: bpy.types.Object, point: Vector) -> None:
    camera.rotation_euler = (point - camera.location).to_track_quat("-Z", "Y").to_euler()


def mesh_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def image_by_stem(stem: str, texture_dir: Path | None) -> bpy.types.Image | None:
    normalized = stem.lower().replace(" ", "_")
    for image in bpy.data.images:
        path_stem = Path(bpy.path.abspath(image.filepath)).stem.lower().replace(" ", "_")
        if path_stem == normalized and image.size[0] > 0:
            return image
    if texture_dir:
        for candidate in texture_dir.iterdir():
            candidate_stem = candidate.stem.lower().replace(" ", "_")
            if candidate.is_file() and candidate_stem == normalized:
                return bpy.data.images.load(str(candidate.resolve()), check_existing=True)
    return None


def rebuild_material(material: bpy.types.Material, base_image: bpy.types.Image | None, metallic: float) -> None:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.55
    shader.inputs["Metallic"].default_value = metallic
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if base_image:
        base_image.colorspace_settings.name = "sRGB"
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = base_image
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    else:
        shader.inputs["Base Color"].default_value = (0.32, 0.24, 0.18, 1.0)


def setup_materials(faction: str, texture_dir: Path | None) -> None:
    if faction == "viking":
        names = {
            "Head": "Head_Base_color",
            "Kit": "Kit_Base_color",
            "Legs Hands": "Legs Hands_Base_color",
            "Tunic": "Tunic_Base_color",
        }
    else:
        names = {
            "Armour_top": "Armour_top_TXTR",
            "Boots": "Boots_TXTR",
            "Dangles": "Dangles_TXTR",
            "Full_figure_42_T_pose": "Full_figure_42_T_pose_TXTR",
            "Helmet3": "Helmet3_TXTR",
            "New_arms": "New_arms_TXTR",
            "New_eye": "New_eye_TXTR",
            "New_eye_2": "New_eye_2_TXTR",
            "New_head": "New_head_TXTR",
            "New_legs": "New_legs_TXTR",
            "Scabbard": "Scabbard_TXTR",
            "Scutum_04_01": "Scutum_04_01_TXTR",
            "Sword2_1": "Sword2_1_TXTR",
            "Ties": "Tunic_1_TXTR",
            "Tunic_1": "Tunic_1_TXTR",
            "Wrist_guard1": "Wrist_guard1_TXTR",
        }
    for obj in (item for item in bpy.context.scene.objects if item.type == "MESH"):
        image = image_by_stem(names.get(obj.name, ""), texture_dir)
        metal = 0.65 if any(token in obj.name.lower() for token in ("armour", "helmet", "sword")) else 0.0
        for slot in obj.material_slots:
            if slot.material:
                rebuild_material(slot.material, image, metal)


def setup_scene(meshes: list[bpy.types.Object]) -> tuple[Vector, float, float]:
    minimum, maximum = mesh_bounds(meshes)
    center = (minimum + maximum) * 0.5
    width = maximum.x - minimum.x
    depth = maximum.y - minimum.y
    height = maximum.z - minimum.z

    world = bpy.context.scene.world or bpy.data.worlds.new("NeutralWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.055, 0.055, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65

    for name, location, energy, size in (
        ("Key", (-3.0, -4.0, 5.0), 900.0, 4.0),
        ("Fill", (3.0, -2.0, 3.0), 550.0, 3.0),
        ("Rim", (1.0, 3.0, 4.0), 750.0, 3.0),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        light.location = location
        bpy.context.collection.objects.link(light)
        look_at(light, center)

    plane_data = bpy.data.meshes.new("Ground")
    plane = bpy.data.objects.new("Ground", plane_data)
    bpy.context.collection.objects.link(plane)
    half = max(width, depth, height) * 1.4
    plane_data.from_pydata([(-half, -half, minimum.z), (half, -half, minimum.z), (half, half, minimum.z), (-half, half, minimum.z)], [], [(0, 1, 2, 3)])
    ground_mat = bpy.data.materials.new("GroundNeutral")
    rebuild_material(ground_mat, None, 0.0)
    ground_mat.node_tree.nodes.get("Principled BSDF")
    plane.data.materials.append(ground_mat)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    return center, max(width, height) * 1.15, max(depth, height) * 1.15


def render_view(output: Path, center: Vector, position: Vector, ortho_scale: float) -> None:
    camera_data = bpy.data.cameras.new(f"Camera_{output.stem}")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new(f"Camera_{output.stem}", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = position
    look_at(camera, center)
    bpy.context.scene.camera = camera
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main() -> None:
    options = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(options.fbx.resolve()), use_anim=False)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    setup_materials(options.faction, options.textures.resolve() if options.textures else None)
    center, front_scale, side_scale = setup_scene(meshes)
    options.output_dir.mkdir(parents=True, exist_ok=True)
    distance = max(front_scale, side_scale) * 2.5
    render_view(options.output_dir / "source-front.png", center, Vector((center.x, center.y - distance, center.z)), front_scale)
    render_view(options.output_dir / "source-side.png", center, Vector((center.x + distance, center.y, center.z)), side_scale)


if __name__ == "__main__":
    main()
