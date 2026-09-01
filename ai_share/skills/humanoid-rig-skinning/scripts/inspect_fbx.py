#!/usr/bin/env python3
"""Import an FBX in Blender and emit a deterministic structural audit as JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--source-label")
    return parser.parse_args(args)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def world_bounds(mesh_objects: list[bpy.types.Object]) -> dict[str, list[float]] | None:
    points = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
    if not points:
        return None
    minimum = [min(point[index] for point in points) for index in range(3)]
    maximum = [max(point[index] for point in points) for index in range(3)]
    return {
        "min": [round(value, 6) for value in minimum],
        "max": [round(value, 6) for value in maximum],
        "size": [round(maximum[index] - minimum[index], 6) for index in range(3)],
    }


def main() -> None:
    options = parse_args()
    source = options.fbx.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=True)

    objects = sorted(bpy.context.scene.objects, key=lambda item: item.name)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    triangle_count = sum(
        sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)
        for obj in meshes
    )

    payload = {
        "source": options.source_label or source.name,
        "sha256": sha256(source),
        "blenderVersion": bpy.app.version_string,
        "scene": {
            "unitSystem": bpy.context.scene.unit_settings.system,
            "scaleLength": bpy.context.scene.unit_settings.scale_length,
            "bounds": world_bounds(meshes),
            "triangles": triangle_count,
        },
        "objects": [
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "scale": [round(value, 6) for value in obj.scale],
                "modifiers": [modifier.type for modifier in obj.modifiers],
            }
            for obj in objects
        ],
        "meshes": [
            {
                "name": obj.name,
                "vertices": len(obj.data.vertices),
                "triangles": sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons),
                "bounds": world_bounds([obj]),
                "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                "vertexGroups": [group.name for group in obj.vertex_groups],
            }
            for obj in meshes
        ],
        "armatures": [
            {
                "name": obj.name,
                "bones": [bone.name for bone in obj.data.bones],
                "boneCount": len(obj.data.bones),
                "boneLandmarks": {
                    bone.name: {
                        "head": [round(value, 6) for value in (obj.matrix_world @ bone.head_local)],
                        "tail": [round(value, 6) for value in (obj.matrix_world @ bone.tail_local)],
                        "parent": bone.parent.name if bone.parent else None,
                    }
                    for bone in obj.data.bones
                },
            }
            for obj in armatures
        ],
        "materials": sorted(material.name for material in bpy.data.materials),
        "images": sorted(
            [{
                "name": image.name,
                "filepath": Path(bpy.path.abspath(image.filepath)).name,
                "size": list(image.size),
                "packed": image.packed_file is not None,
            }
            for image in bpy.data.images
            ],
            key=lambda item: item["name"],
        ),
        "actions": sorted(action.name for action in bpy.data.actions),
    }

    encoded = json.dumps(payload, indent=2, sort_keys=True)
    if options.output:
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_text(encoded + "\n", encoding="utf-8")
    print("ASSET_INSPECT_JSON_BEGIN")
    print(encoded)
    print("ASSET_INSPECT_JSON_END")


if __name__ == "__main__":
    main()
