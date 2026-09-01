#!/usr/bin/env python3
"""Import a GLB in Blender and record actual embedded image dimensions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import bpy


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args(args)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(options.glb.resolve()))
    images = sorted(
        [
            {
                "name": image.name,
                "width": int(image.size[0]),
                "height": int(image.size[1]),
                "colorspace": image.colorspace_settings.name,
                "packed": image.packed_file is not None,
            }
            for image in bpy.data.images
            if image.type == "IMAGE"
        ],
        key=lambda item: item["name"],
    )
    payload = {
        "schemaVersion": 1,
        "file": options.glb.name,
        "imageCount": len(images),
        "maxWidth": max((image["width"] for image in images), default=0),
        "maxHeight": max((image["height"] for image in images), default=0),
        "images": images,
    }
    options.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
