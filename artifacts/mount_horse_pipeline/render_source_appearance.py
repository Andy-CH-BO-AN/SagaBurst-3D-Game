#!/usr/bin/env python3
"""Render the untouched source horse materials and particle groom for review."""

from __future__ import annotations

import json
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE = Path("/Users/chenboan/Downloads/Horse Rigged All Gaits.blend")
PIPELINE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PIPELINE_DIR / "renders/source_appearance"
REPORT_PATH = PIPELINE_DIR / "reports/source_appearance_audit.json"
VISIBLE_OBJECTS = {
    "horse",
    "bit",
    "bridle",
    "bridle.body",
    "reins",
    "saddle",
    "saddle.pad",
    "saddle.stirrup",
    "saddle.stirrup.strap",
}


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_review_environment() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 650
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = ""

    world = bpy.data.worlds.new("source_appearance_world")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.045, 0.052, 0.06, 1.0)
    background.inputs["Strength"].default_value = 0.62
    scene.world = world

    ground_material = bpy.data.materials.new("source_review_ground")
    ground_material.diffuse_color = (0.12, 0.13, 0.14, 1.0)
    ground_material.roughness = 0.88
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "source_review_ground"
    ground.data.materials.append(ground_material)

    for name, energy, size, location in (
        ("source_key", 1550, 5.0, (4.8, -4.8, 6.2)),
        ("source_fill", 850, 4.0, (-4.2, 1.8, 4.0)),
        ("source_rim", 1050, 3.0, (1.2, 5.0, 4.8)),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        look_at(light, Vector((0, 0, 1.15)))

    camera_data = bpy.data.cameras.new("source_review_camera")
    camera = bpy.data.objects.new("source_review_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(
            evaluated.matrix_world @ Vector(corner)
            for corner in evaluated.bound_box
        )
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def render(
    camera: bpy.types.Object,
    name: str,
    position: Vector,
    target: Vector,
    orthographic: bool,
    ortho_scale: float = 3.4,
) -> None:
    camera.location = position
    look_at(camera, target)
    camera.data.type = "ORTHO" if orthographic else "PERSP"
    if orthographic:
        camera.data.ortho_scale = ortho_scale
    else:
        camera.data.lens = 58
    bpy.context.scene.render.filepath = str(OUTPUT_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    except RuntimeError as exc:
        if "invalid 'from' pointer" not in str(exc) or "horse" not in bpy.data.objects:
            raise

    rig = bpy.data.objects["horse.rig"]
    if rig.animation_data:
        rig.animation_data.action = None
    rig.data.pose_position = "REST"
    bpy.context.scene.frame_set(0)
    for obj in bpy.context.scene.objects:
        obj.hide_render = obj.name not in VISIBLE_OBJECTS
    visible = [bpy.data.objects[name] for name in VISIBLE_OBJECTS if name in bpy.data.objects]
    bpy.context.view_layer.update()

    minimum, maximum = world_bounds(visible)
    center = (minimum + maximum) * 0.5
    height = maximum.z - minimum.z
    length = maximum.y - minimum.y
    camera = add_review_environment()
    target = center + Vector((0, 0, 0.04))

    render(
        camera,
        "source_front",
        Vector((center.x, minimum.y - 6.0, center.z)),
        target,
        True,
        max(3.0, height * 1.34),
    )
    render(
        camera,
        "source_side",
        Vector((maximum.x + 6.0, center.y, center.z)),
        target,
        True,
        max(4.2, length * 1.18),
    )
    render(
        camera,
        "source_three_quarter",
        center + Vector((4.7, -5.8, 2.0)),
        target,
        False,
    )
    tail_root = rig.matrix_world @ rig.data.bones["DEF-tail.001"].head_local
    render(
        camera,
        "source_tail_closeup",
        tail_root + Vector((2.4, 0.5, 0.35)),
        tail_root + Vector((0.0, 0.34, -0.26)),
        False,
    )

    audit = {
        "source": str(SOURCE),
        "renderEngine": bpy.context.scene.render.engine,
        "sourceObjects": sorted(VISIBLE_OBJECTS),
        "materials": {
            obj.name: [
                slot.material.name if slot.material else None
                for slot in obj.material_slots
            ]
            for obj in visible
            if obj.type == "MESH"
        },
        "particleSystems": [
            {
                "name": system.name,
                "type": system.settings.type,
                "count": system.settings.count,
                "hairLength": system.settings.hair_length,
                "childType": system.settings.child_type,
                "renderedChildCount": system.settings.rendered_child_count,
                "kink": system.settings.kink,
                "clumpFactor": system.settings.clump_factor,
                "roughness1": system.settings.roughness_1,
                "roughness2": system.settings.roughness_2,
                "hairDynamics": system.use_hair_dynamics,
            }
            for system in bpy.data.objects["horse"].particle_systems
        ],
        "bounds": {"min": list(minimum), "max": list(maximum)},
        "outputs": sorted(path.name for path in OUTPUT_DIR.glob("*.png")),
        "note": (
            "Horse meshes, source materials, particle systems and hair dynamics "
            "are unmodified; only review lights, ground and cameras were added."
        ),
    }
    REPORT_PATH.write_text(
        json.dumps(audit, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print("SOURCE_APPEARANCE_COMPLETE=" + json.dumps(audit))


if __name__ == "__main__":
    main()
