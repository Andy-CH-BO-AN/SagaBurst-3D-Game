#!/usr/bin/env python3
"""Dependency-free structural audit for binary or JSON glTF files."""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path
from typing import Any


def load_gltf(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        return json.loads(raw.decode("utf-8"))
    if len(raw) < 20:
        raise ValueError("GLB header is truncated")
    magic, version, total_length = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or total_length != len(raw):
        raise ValueError("Expected a complete GLB v2 file")
    offset = 12
    while offset + 8 <= len(raw):
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        chunk = raw[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.rstrip(b" \t\r\n\x00").decode("utf-8"))
    raise ValueError("GLB JSON chunk is missing")


def accessor_count(gltf: dict[str, Any], index: int | None) -> int:
    if index is None:
        return 0
    accessors = gltf.get("accessors", [])
    return int(accessors[index].get("count", 0)) if 0 <= index < len(accessors) else 0


def audit(path: Path) -> dict[str, Any]:
    gltf = load_gltf(path)
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    skins = gltf.get("skins", [])
    triangles = 0
    primitives = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            primitives += 1
            mode = primitive.get("mode", 4)
            count = accessor_count(gltf, primitive.get("indices"))
            if not count:
                count = accessor_count(gltf, primitive.get("attributes", {}).get("POSITION"))
            if mode == 4:
                triangles += count // 3
            elif mode in (5, 6):
                triangles += max(0, count - 2)
    joint_indices = sorted({joint for skin in skins for joint in skin.get("joints", [])})
    joint_names = [nodes[i].get("name", f"node_{i}") for i in joint_indices if i < len(nodes)]
    return {
        "file": path.name,
        "byteLength": path.stat().st_size,
        "asset": gltf.get("asset", {}),
        "counts": {
            "scenes": len(gltf.get("scenes", [])),
            "nodes": len(nodes),
            "meshes": len(meshes),
            "primitives": primitives,
            "triangles": triangles,
            "materials": len(gltf.get("materials", [])),
            "textures": len(gltf.get("textures", [])),
            "images": len(gltf.get("images", [])),
            "skins": len(skins),
            "joints": len(joint_indices),
            "animations": len(gltf.get("animations", [])),
        },
        "jointNames": joint_names,
        "animationNames": [animation.get("name", "") for animation in gltf.get("animations", [])],
        "extensionsUsed": gltf.get("extensionsUsed", []),
        "extensionsRequired": gltf.get("extensionsRequired", []),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = audit(args.file)
    except (OSError, ValueError, json.JSONDecodeError, IndexError) as exc:
        print(f"audit_glb: {exc}", file=sys.stderr)
        return 1
    rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
