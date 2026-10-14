"""Resize embedded source PNGs extracted by simplify-selected-t5.mjs.

Requires Pillow. Keeps source UVs; does not rebake or recolour the material.
"""
from pathlib import Path
import sys
from PIL import Image

directory = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/t5-lod-candidate')
for faction in ('roman', 'viking'):
    for index in range(3):
        with Image.open(directory / f'{faction}-source-{index}.png') as image:
            for size in (1024, 512):
                image.resize((size, size), Image.Resampling.LANCZOS).save(directory / f'{faction}-{size}-{index}.png')
