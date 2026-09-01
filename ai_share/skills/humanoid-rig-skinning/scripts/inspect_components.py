#!/usr/bin/env python3
"""Report connected mesh islands and world-space bounds from an FBX."""

from __future__ import annotations

import argparse
from collections import deque
import json
from pathlib import Path
import sys

import bpy


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("fbx", type=Path)
    parser.add_argument("--mesh")
    parser.add_argument("--output", type=Path)
    return parser.parse_args(args)


def components(obj: bpy.types.Object) -> list[dict[str, object]]:
    mesh = obj.data
    adjacency: list[set[int]] = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        adjacency[left].add(right)
        adjacency[right].add(left)

    polygon_counts = [0] * len(mesh.vertices)
    for polygon in mesh.polygons:
        if polygon.vertices:
            polygon_counts[polygon.vertices[0]] += max(0, len(polygon.vertices) - 2)

    remaining = set(range(len(mesh.vertices)))
    results = []
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
        points = [obj.matrix_world @ mesh.vertices[index].co for index in island]
        minimum = [min(point[axis] for point in points) for axis in range(3)]
        maximum = [max(point[axis] for point in points) for axis in range(3)]
        results.append(
            {
                "vertices": len(island),
                "trianglesApprox": sum(polygon_counts[index] for index in island),
                "bounds": {
                    "min": [round(value, 6) for value in minimum],
                    "max": [round(value, 6) for value in maximum],
                    "size": [round(maximum[axis] - minimum[axis], 6) for axis in range(3)],
                },
            }
        )
    return sorted(results, key=lambda item: (-item["vertices"], item["bounds"]["min"]))


def main() -> None:
    options = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(options.fbx.resolve()), use_anim=False)
    payload = {
        obj.name: components(obj)
        for obj in sorted(bpy.context.scene.objects, key=lambda item: item.name)
        if obj.type == "MESH" and (not options.mesh or obj.name == options.mesh)
    }
    encoded = json.dumps(payload, indent=2, sort_keys=True)
    if options.output:
        options.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
