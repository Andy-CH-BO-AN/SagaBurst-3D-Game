#!/usr/bin/env python3
"""Render bind and stress poses from an exported humanoid GLB."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def options() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("output_dir", type=Path)
    return parser.parse_args(args)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def evaluated_bounds() -> tuple[Vector, Vector, bool]:
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    finite = True
    for source in bpy.context.scene.objects:
        if source.type != "MESH" or source.name == "EvidenceGround":
            continue
        obj = source.evaluated_get(graph)
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            finite = finite and all(math.isfinite(value) for value in point)
            points.append(point)
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
        finite,
    )


def setup_scene() -> None:
    world = bpy.context.scene.world or bpy.data.worlds.new("NeutralWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.045, 0.045, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    minimum, maximum, _ = evaluated_bounds()
    center = (minimum + maximum) * 0.5
    for name, location, energy, size in (
        ("Key", (-3.0, -4.0, 5.0), 1000.0, 4.0),
        ("Fill", (3.0, -2.0, 3.0), 500.0, 3.0),
        ("Rim", (1.0, 3.0, 4.0), 700.0, 3.0),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        bpy.context.collection.objects.link(light)
        look_at(light, center)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def pose_arms_forward(armature: bpy.types.Object) -> None:
    reset_pose(armature)
    armature.pose.bones["upper_arm_l"].rotation_euler.z = -math.radians(82)
    armature.pose.bones["upper_arm_r"].rotation_euler.z = math.radians(82)
    armature.pose.bones["lower_arm_l"].rotation_euler.z = math.radians(55)
    armature.pose.bones["lower_arm_r"].rotation_euler.z = -math.radians(55)
    bpy.context.view_layer.update()


def pose_mounted(armature: bpy.types.Object) -> None:
    reset_pose(armature)
    # Match the game's restrained saddle pose. Wider stress angles are a separate
    # authoring test; they exaggerate bare Roman thighs without a saddle present.
    armature.pose.bones["hips"].rotation_euler.x = math.radians(4)
    armature.pose.bones["upper_leg_l"].rotation_euler.z = -math.radians(14)
    armature.pose.bones["upper_leg_r"].rotation_euler.z = math.radians(14)
    armature.pose.bones["upper_leg_l"].rotation_euler.x = math.radians(10)
    armature.pose.bones["upper_leg_r"].rotation_euler.x = math.radians(10)
    armature.pose.bones["lower_leg_l"].rotation_euler.x = -math.radians(48)
    armature.pose.bones["lower_leg_r"].rotation_euler.x = -math.radians(48)
    bpy.context.view_layer.update()


def render_view(path: Path, side: bool, ortho_scale: float) -> dict[str, object]:
    minimum, maximum, finite = evaluated_bounds()
    center = (minimum + maximum) * 0.5
    distance = ortho_scale * 2.5
    data = bpy.data.cameras.new(f"Camera_{path.stem}")
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new(f"Camera_{path.stem}", data)
    camera.location = (
        Vector((center.x + distance, center.y, center.z))
        if side
        else Vector((center.x, center.y - distance, center.z))
    )
    bpy.context.collection.objects.link(camera)
    look_at(camera, center)
    bpy.context.scene.camera = camera
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(data)
    size = maximum - minimum
    return {
        "finite": finite,
        "bounds": {
            "min": [round(value, 6) for value in minimum],
            "max": [round(value, 6) for value in maximum],
            "size": [round(value, 6) for value in size],
        },
        "extentPass": finite and max(size) < 4.0,
    }


def main() -> None:
    args = options()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.glb.resolve()))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    setup_scene()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    minimum, maximum, _ = evaluated_bounds()
    fixed_scale = max(maximum.x - minimum.x, maximum.z - minimum.z) * 1.16
    report = {}
    poses = (
        ("bind", lambda: reset_pose(armature)),
        ("arms-forward", lambda: pose_arms_forward(armature)),
        ("mounted", lambda: pose_mounted(armature)),
    )
    for name, apply_pose in poses:
        apply_pose()
        report[name] = {
            "front": render_view(args.output_dir / f"{name}-front.png", False, fixed_scale),
            "side": render_view(args.output_dir / f"{name}-side.png", True, fixed_scale),
        }
    (args.output_dir / "deformation-audit.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "source": args.glb.name,
                "armature": armature.name,
                "poses": report,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
