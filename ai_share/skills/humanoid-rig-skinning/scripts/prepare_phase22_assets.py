#!/usr/bin/env python3
"""Prepare Phase 22 humanoid LOD GLBs from the audited FBX sources."""

from __future__ import annotations

import argparse
from collections import deque
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector


TARGETS = {
    "viking": {"height": 1.86, "shoulder": 0.54},
    "roman": {"height": 1.78, "shoulder": 0.46},
}
LOD_SPECS = (("lod0", 60000, 2048), ("lod1", 20000, 1024), ("lod2", 6000, 512))


VIKING_BONE_MAP = {
    "pelvis": "hips",
    "spine_01": "spine",
    "spine_02": "chest",
    "spine_03": "upper_chest",
    "neck_01": "neck",
    "head": "head",
    "clavicle_l": "clavicle_l",
    "clavicle_r": "clavicle_r",
    "upperarm_l": "upper_arm_l",
    "upperarm_r": "upper_arm_r",
    "lowerarm_l": "lower_arm_l",
    "lowerarm_r": "lower_arm_r",
    "hand_l": "hand_l",
    "hand_r": "hand_r",
    "thigh_l": "upper_leg_l",
    "thigh_r": "upper_leg_r",
    "calf_l": "lower_leg_l",
    "calf_r": "lower_leg_r",
    "foot_l": "foot_l",
    "foot_r": "foot_r",
    "ball_l": "toe_l",
    "ball_r": "toe_r",
}


def options() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("faction", choices=("viking", "roman"))
    parser.add_argument("source", type=Path)
    parser.add_argument("texture_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    return parser.parse_args(args)


def reset_and_import(source: Path) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.ops.import_scene.fbx(filepath=str(source.resolve()), use_anim=False)


def mesh_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def object_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def scene_bounds() -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in mesh_objects() for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def remove_viking_back_equipment(obj: bpy.types.Object) -> int:
    mesh = obj.data
    adjacency: list[set[int]] = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        adjacency[left].add(right)
        adjacency[right].add(left)
    remaining = set(range(len(mesh.vertices)))
    remove_indices: set[int] = set()
    while remaining:
        seed = min(remaining)
        queue = deque([seed])
        island = []
        remaining.remove(seed)
        while queue:
            current = queue.popleft()
            island.append(current)
            for neighbour in adjacency[current]:
                if neighbour in remaining:
                    remaining.remove(neighbour)
                    queue.append(neighbour)
        world_points = [obj.matrix_world @ mesh.vertices[index].co for index in island]
        if min(point.y for point in world_points) > 0.18:
            remove_indices.update(island)

    if not remove_indices:
        return 0
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[index] for index in sorted(remove_indices)], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(remove_indices)


def bake_mesh_world(obj: bpy.types.Object) -> None:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(world)
    for modifier in list(obj.modifiers):
        obj.modifiers.remove(modifier)


def merge_group(obj: bpy.types.Object, source_name: str, target_name: str) -> None:
    source = obj.vertex_groups.get(source_name)
    if source is None:
        return
    target = obj.vertex_groups.get(target_name) or obj.vertex_groups.new(name=target_name)
    for vertex in obj.data.vertices:
        try:
            weight = source.weight(vertex.index)
        except RuntimeError:
            continue
        if weight > 0:
            try:
                existing = target.weight(vertex.index)
            except RuntimeError:
                existing = 0.0
            target.add([vertex.index], min(1.0, existing + weight), "REPLACE")
    obj.vertex_groups.remove(source)


def remap_viking_groups(obj: bpy.types.Object) -> None:
    for old, new in VIKING_BONE_MAP.items():
        group = obj.vertex_groups.get(old)
        if group:
            group.name = new
    for side in ("l", "r"):
        for name in ("upperarm_twist_01",):
            merge_group(obj, f"{name}_{side}", f"upper_arm_{side}")
        for name in ("lowerarm_twist_01",):
            merge_group(obj, f"{name}_{side}", f"lower_arm_{side}")
        for name in ("thigh_twist_01",):
            merge_group(obj, f"{name}_{side}", f"upper_leg_{side}")
        for name in ("calf_twist_01",):
            merge_group(obj, f"{name}_{side}", f"lower_leg_{side}")
        for finger in ("index", "middle", "pinky", "ring", "thumb"):
            for segment in ("01", "02", "03"):
                merge_group(obj, f"{finger}_{segment}_{side}", f"hand_{side}")


def new_armature() -> bpy.types.Object:
    data = bpy.data.armatures.new("project-humanoid-v1")
    armature = bpy.data.objects.new("project_humanoid", data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    return armature


def add_edit_bone(
    armature: bpy.types.Object,
    name: str,
    head: Vector,
    tail: Vector,
    parent: str | None = None,
    deform: bool = True,
) -> None:
    bone = armature.data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail if (tail - head).length > 0.001 else head + Vector((0.0, 0.0, 0.05))
    bone.use_deform = deform
    if parent:
        bone.parent = armature.data.edit_bones[parent]


def add_sockets(armature: bpy.types.Object, sole_z: float = 0.0) -> None:
    bones = armature.data.edit_bones
    socket_specs = [
        ("socket_hand_l", "hand_l", (bones["hand_l"].head + bones["hand_l"].tail) * 0.5),
        ("socket_hand_r", "hand_r", (bones["hand_r"].head + bones["hand_r"].tail) * 0.5),
        ("socket_back", "chest", bones["chest"].head + Vector((0.0, 0.14, 0.08))),
        ("socket_head", "head", bones["head"].head + Vector((0.0, 0.0, 0.12))),
        ("socket_pelvis", "hips", bones["hips"].head),
        ("socket_foot_l", "foot_l", bones["foot_l"].head),
        ("socket_foot_r", "foot_r", bones["foot_r"].head),
        ("sole_l", "foot_l", Vector((bones["foot_l"].head.x, bones["foot_l"].head.y, sole_z))),
        ("sole_r", "foot_r", Vector((bones["foot_r"].head.x, bones["foot_r"].head.y, sole_z))),
    ]
    for name, parent, head in socket_specs:
        add_edit_bone(armature, name, head, head + Vector((0.0, 0.0, 0.05)), parent, False)


def prepare_viking(target_height: float) -> tuple[bpy.types.Object, dict[str, float]]:
    source_armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    source_bones = {
        bone.name: {
            "head": source_armature.matrix_world @ bone.head_local,
            "tail": source_armature.matrix_world @ bone.tail_local,
        }
        for bone in source_armature.data.bones
    }
    kit = bpy.data.objects.get("Kit")
    removed_vertices = remove_viking_back_equipment(kit) if kit else 0

    head_min, head_max = object_bounds(bpy.data.objects["Head"])
    legs_min, _ = object_bounds(bpy.data.objects["Legs Hands"])
    floor = legs_min.z
    source_height = head_max.z - floor
    scale = target_height / source_height

    meshes = mesh_objects()
    for obj in meshes:
        bake_mesh_world(obj)
        obj.data.transform(Matrix.Translation((0.0, 0.0, -floor)))
        obj.data.transform(Matrix.Scale(scale, 4))
        remap_viking_groups(obj)

    bpy.data.objects.remove(source_armature, do_unlink=True)
    armature = new_armature()
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def point(name: str) -> Vector:
        value = source_bones[name]["head"].copy()
        value.z -= floor
        return value * scale

    joint = {name: point(name) for name in VIKING_BONE_MAP}
    layout = (
        ("hips", joint["pelvis"], joint["spine_01"], None),
        ("spine", joint["spine_01"], joint["spine_02"], "hips"),
        ("chest", joint["spine_02"], joint["spine_03"], "spine"),
        ("upper_chest", joint["spine_03"], joint["neck_01"], "chest"),
        ("neck", joint["neck_01"], joint["head"], "upper_chest"),
        ("head", joint["head"], joint["head"] + Vector((0.0, 0.0, 0.20)), "neck"),
    )
    for name, head, tail, parent in layout:
        add_edit_bone(armature, name, head, tail, parent)
    for side in ("l", "r"):
        add_edit_bone(armature, f"clavicle_{side}", joint[f"clavicle_{side}"], joint[f"upperarm_{side}"], "upper_chest")
        add_edit_bone(armature, f"upper_arm_{side}", joint[f"upperarm_{side}"], joint[f"lowerarm_{side}"], f"clavicle_{side}")
        add_edit_bone(armature, f"lower_arm_{side}", joint[f"lowerarm_{side}"], joint[f"hand_{side}"], f"upper_arm_{side}")
        hand_tail = joint[f"hand_{side}"] + Vector(((0.14 if side == "l" else -0.14), 0.0, 0.0))
        add_edit_bone(armature, f"hand_{side}", joint[f"hand_{side}"], hand_tail, f"lower_arm_{side}")
        add_edit_bone(armature, f"upper_leg_{side}", joint[f"thigh_{side}"], joint[f"calf_{side}"], "hips")
        add_edit_bone(armature, f"lower_leg_{side}", joint[f"calf_{side}"], joint[f"foot_{side}"], f"upper_leg_{side}")
        add_edit_bone(armature, f"foot_{side}", joint[f"foot_{side}"], joint[f"ball_{side}"], f"lower_leg_{side}")
        toe_tail = joint[f"ball_{side}"] + Vector((0.0, -0.14, 0.0))
        add_edit_bone(armature, f"toe_{side}", joint[f"ball_{side}"], toe_tail, f"foot_{side}")
    add_sockets(armature)
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)

    for obj in meshes:
        obj.parent = armature
        modifier = obj.modifiers.new("project_humanoid_skin", "ARMATURE")
        modifier.object = armature

    shoulder = abs(joint["upperarm_l"].x - joint["upperarm_r"].x)
    neck = abs(joint["head"].z - joint["neck_01"].z)
    knee = ((joint["calf_l"].z + joint["calf_r"].z) * 0.5)
    return armature, {
        "sourceHeightM": source_height,
        "uniformScaleApplied": scale,
        "heightM": target_height,
        "shoulderWidthM": shoulder,
        "neckLengthM": neck,
        "kneeHeightM": knee,
        "removedBackEquipmentVertices": removed_vertices,
    }


def apply_scale_and_ground_roman(target_height: float) -> tuple[float, float]:
    for obj in mesh_objects():
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)
    minimum, maximum = scene_bounds()
    source_height = maximum.z - minimum.z
    scale = target_height / source_height
    transform = Matrix.Translation((0.0, 0.0, -minimum.z * scale)) @ Matrix.Scale(scale, 4)
    for obj in mesh_objects():
        obj.data.transform(transform)
    armour = bpy.data.objects.get("Armour_top")
    if armour:
        amin, amax = object_bounds(armour)
        width = amax.x - amin.x
        if width > TARGETS["roman"]["shoulder"]:
            armour.data.transform(Matrix.Diagonal((TARGETS["roman"]["shoulder"] / width, 1.0, 1.0, 1.0)))
    return source_height, scale


def create_roman_armature() -> bpy.types.Object:
    armature = new_armature()
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    layout = (
        ("hips", (0, 0, 1.00), (0, 0, 1.11), None),
        ("spine", (0, 0, 1.11), (0, 0, 1.31), "hips"),
        ("chest", (0, 0, 1.31), (0, 0, 1.48), "spine"),
        ("upper_chest", (0, 0, 1.48), (0, 0, 1.51), "chest"),
        ("neck", (0, 0, 1.51), (0, 0, 1.60), "upper_chest"),
        ("head", (0, 0, 1.60), (0, 0, 1.76), "neck"),
    )
    for name, head, tail, parent in layout:
        add_edit_bone(armature, name, Vector(head), Vector(tail), parent)
    for side, sign in (("l", 1.0), ("r", -1.0)):
        add_edit_bone(armature, f"clavicle_{side}", Vector((0.04 * sign, 0, 1.48)), Vector((0.205 * sign, 0, 1.47)), "upper_chest")
        add_edit_bone(armature, f"upper_arm_{side}", Vector((0.205 * sign, 0, 1.47)), Vector((0.52 * sign, 0, 1.47)), f"clavicle_{side}")
        add_edit_bone(armature, f"lower_arm_{side}", Vector((0.52 * sign, 0, 1.47)), Vector((0.76 * sign, 0, 1.47)), f"upper_arm_{side}")
        add_edit_bone(armature, f"hand_{side}", Vector((0.76 * sign, 0, 1.47)), Vector((0.90 * sign, 0, 1.47)), f"lower_arm_{side}")
        add_edit_bone(armature, f"upper_leg_{side}", Vector((0.105 * sign, 0, 1.00)), Vector((0.10 * sign, 0, 0.516)), "hips")
        add_edit_bone(armature, f"lower_leg_{side}", Vector((0.10 * sign, 0, 0.516)), Vector((0.09 * sign, 0, 0.105)), f"upper_leg_{side}")
        add_edit_bone(armature, f"foot_{side}", Vector((0.09 * sign, 0, 0.105)), Vector((0.09 * sign, -0.18, 0.065)), f"lower_leg_{side}")
        add_edit_bone(armature, f"toe_{side}", Vector((0.09 * sign, -0.18, 0.065)), Vector((0.09 * sign, -0.29, 0.065)), f"foot_{side}")
    add_sockets(armature)
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)
    return armature


def clear_groups(obj: bpy.types.Object) -> None:
    while obj.vertex_groups:
        obj.vertex_groups.remove(obj.vertex_groups[0])


def add_weight(obj: bpy.types.Object, vertex: int, bone: str, value: float) -> None:
    if value <= 0:
        return
    group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    group.add([vertex], value, "REPLACE")


def limb_pair(position: float, joint: float, blend: float, inner: str, outer: str) -> tuple[tuple[str, float], ...]:
    if position < joint - blend:
        return ((inner, 1.0),)
    if position > joint + blend:
        return ((outer, 1.0),)
    outer_weight = (position - (joint - blend)) / (2.0 * blend)
    return ((inner, 1.0 - outer_weight), (outer, outer_weight))


def skin_roman_mesh(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    clear_groups(obj)
    rigid = {
        "Helmet3": "head",
        "New_head": "head",
        "New_eye": "head",
        "New_eye_2": "head",
        "Ties": "chest",
    }
    if obj.name in rigid:
        group = obj.vertex_groups.new(name=rigid[obj.name])
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    else:
        for vertex in obj.data.vertices:
            point = vertex.co
            side = "l" if point.x >= 0 else "r"
            weights: tuple[tuple[str, float], ...]
            if obj.name in {"New_arms", "Wrist_guard1"}:
                distance = abs(point.x)
                if distance < 0.50:
                    weights = ((f"upper_arm_{side}", 1.0),)
                elif distance < 0.73:
                    weights = limb_pair(distance, 0.52, 0.035, f"upper_arm_{side}", f"lower_arm_{side}")
                else:
                    weights = limb_pair(distance, 0.76, 0.035, f"lower_arm_{side}", f"hand_{side}")
            elif obj.name == "Armour_top":
                weights = ((f"upper_arm_{side}", 1.0),) if abs(point.x) > 0.205 else (("chest", 1.0),)
            elif obj.name == "Dangles":
                weights = (("hips", 0.85), (f"upper_leg_{side}", 0.15))
            elif obj.name in {"New_legs", "Boots"}:
                if point.z > 0.55:
                    weights = limb_pair(point.z, 0.56, 0.05, f"lower_leg_{side}", f"upper_leg_{side}")
                elif point.z > 0.12:
                    weights = limb_pair(point.z, 0.50, 0.05, f"foot_{side}", f"lower_leg_{side}")
                else:
                    weights = ((f"foot_{side}", 1.0),)
            elif obj.name == "Tunic_1":
                if abs(point.x) > 0.23 and point.z > 1.25:
                    weights = ((f"upper_arm_{side}", 1.0),)
                elif point.z < 1.05:
                    weights = ((f"upper_leg_{side}", 0.75), ("hips", 0.25))
                elif point.z < 1.18:
                    weights = (("hips", 0.7), ("spine", 0.3))
                else:
                    weights = (("chest", 1.0),)
            else:
                if point.z < 1.08:
                    weights = (("hips", 1.0),)
                elif point.z < 1.30:
                    weights = (("spine", 1.0),)
                else:
                    weights = (("chest", 1.0),)
            for bone, weight in weights:
                add_weight(obj, vertex.index, bone, weight)
    obj.parent = armature
    modifier = obj.modifiers.new("project_humanoid_skin", "ARMATURE")
    modifier.object = armature


def prepare_roman(target_height: float) -> tuple[bpy.types.Object, dict[str, float]]:
    for name in ("Sword2_1", "Scutum_04_01", "Scabbard"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    source_height, scale = apply_scale_and_ground_roman(target_height)
    armature = create_roman_armature()
    for obj in mesh_objects():
        skin_roman_mesh(obj, armature)
    armour = bpy.data.objects.get("Armour_top")
    amin, amax = object_bounds(armour)
    return armature, {
        "sourceHeightM": source_height,
        "uniformScaleApplied": scale,
        "heightM": target_height,
        "shoulderWidthM": amax.x - amin.x,
        "neckLengthM": 0.09,
        "kneeHeightM": 0.516,
        "excludedSourceObjects": ["Sword2_1", "Scutum_04_01", "Scabbard"],
        "weighting": "deterministic segmented initial weights; deformation approval required",
    }


def image_by_stem(stem: str, texture_dir: Path) -> bpy.types.Image | None:
    normalized = stem.lower().replace(" ", "_")
    for image in bpy.data.images:
        current = Path(bpy.path.abspath(image.filepath)).stem.lower().replace(" ", "_")
        if current == normalized and image.size[0] > 0:
            return image
    for path in texture_dir.iterdir():
        if path.is_file() and path.stem.lower().replace(" ", "_") == normalized:
            return bpy.data.images.load(str(path.resolve()), check_existing=True)
    return None


def rebuild_pbr(
    material: bpy.types.Material,
    base: bpy.types.Image | None,
    normal: bpy.types.Image | None,
    roughness: bpy.types.Image | None,
    metallic: bpy.types.Image | None,
    metal_default: float,
) -> None:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (0.34, 0.17, 0.10, 1.0) if base is None else (1, 1, 1, 1)
    shader.inputs["Roughness"].default_value = 0.58
    shader.inputs["Metallic"].default_value = metal_default
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if base:
        base.colorspace_settings.name = "sRGB"
        node = nodes.new("ShaderNodeTexImage")
        node.image = base
        material.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    if roughness:
        roughness.colorspace_settings.name = "Non-Color"
        node = nodes.new("ShaderNodeTexImage")
        node.image = roughness
        material.node_tree.links.new(node.outputs["Color"], shader.inputs["Roughness"])
    if metallic:
        metallic.colorspace_settings.name = "Non-Color"
        node = nodes.new("ShaderNodeTexImage")
        node.image = metallic
        material.node_tree.links.new(node.outputs["Color"], shader.inputs["Metallic"])
    if normal:
        normal.colorspace_settings.name = "Non-Color"
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = normal
        normal_node = nodes.new("ShaderNodeNormalMap")
        normal_node.inputs["Strength"].default_value = 0.65
        material.node_tree.links.new(texture.outputs["Color"], normal_node.inputs["Color"])
        material.node_tree.links.new(normal_node.outputs["Normal"], shader.inputs["Normal"])


def setup_viking_materials(texture_dir: Path) -> None:
    for obj in mesh_objects():
        stem = obj.name
        base = image_by_stem(f"{stem}_Base_color", texture_dir)
        normal = image_by_stem(f"{stem}_Normal", texture_dir)
        rough = image_by_stem(f"{stem}_Roughness", texture_dir)
        metal = image_by_stem(f"{stem}_Metallic", texture_dir)
        for slot in obj.material_slots:
            if slot.material:
                rebuild_pbr(slot.material, base, normal, rough, metal, 0.0)


def setup_roman_materials(texture_dir: Path) -> None:
    name_map = {
        "Armour_top": "Armour_top",
        "Boots": "Boots",
        "Dangles": "Dangles",
        "Full_figure_42_T_pose": "Full_figure_42_T_pose",
        "Helmet3": "Helmet3",
        "New_arms": "New_arms",
        "New_eye": "New_eye",
        "New_eye_2": "New_eye_2",
        "New_head": "New_head",
        "New_legs": "New_legs",
        "Ties": "Tunic_1",
        "Tunic_1": "Tunic_1",
        "Wrist_guard1": "Wrist_guard1",
    }
    for obj in mesh_objects():
        stem = name_map[obj.name]
        base = image_by_stem(f"{stem}_TXTR", texture_dir)
        normal = image_by_stem(f"{stem}_NM", texture_dir)
        metal_default = 0.55 if obj.name in {"Armour_top", "Helmet3", "Wrist_guard1"} else 0.0
        for slot in obj.material_slots:
            if slot.material:
                rebuild_pbr(slot.material, base, normal, None, None, metal_default)


def triangle_count() -> int:
    return sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in mesh_objects())


def decimate_to(target: int) -> None:
    current = triangle_count()
    if current <= target:
        return
    ratio = max(0.01, min(1.0, target / current))
    for obj in mesh_objects():
        modifier = obj.modifiers.new("lod_decimate", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)


def resize_images(size: int) -> None:
    for image in bpy.data.images:
        if image.type == "IMAGE" and image.size[0] > size and image.size[1] > size:
            image.scale(size, size)


def export_glb(path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "ARMATURE"}:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path.resolve()),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_morph=False,
        export_animations=False,
        export_all_influences=True,
        export_def_bones=False,
        export_image_format="AUTO",
        export_materials="EXPORT",
    )


def main() -> None:
    args = options()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reports = {}
    for lod_name, target_triangles, texture_size in LOD_SPECS:
        reset_and_import(args.source)
        if args.faction == "viking":
            armature, metrics = prepare_viking(TARGETS[args.faction]["height"])
            setup_viking_materials(args.texture_dir.resolve())
        else:
            armature, metrics = prepare_roman(TARGETS[args.faction]["height"])
            setup_roman_materials(args.texture_dir.resolve())
        armature["projectSkeleton"] = "project-humanoid-v1"
        decimate_to(target_triangles)
        resize_images(texture_size)
        export_glb(args.output_dir / f"{lod_name}.glb")
        minimum, maximum = scene_bounds()
        reports[lod_name] = {
            **metrics,
            "triangles": triangle_count(),
            "textureSize": texture_size,
            "bounds": {
                "min": [round(value, 6) for value in minimum],
                "max": [round(value, 6) for value in maximum],
                "size": [round(maximum[index] - minimum[index], 6) for index in range(3)],
            },
            "objectScales": {
                obj.name: [round(value, 6) for value in obj.scale]
                for obj in bpy.context.scene.objects
                if obj.type in {"MESH", "ARMATURE"}
            },
        }
    (args.output_dir / "blender-preparation-audit.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "blenderVersion": bpy.app.version_string,
                "faction": args.faction,
                "lods": reports,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
