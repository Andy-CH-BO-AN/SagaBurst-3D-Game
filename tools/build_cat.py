"""Build only the reference-scale Black Cat mount.

Run from the repository root:
    blender -b --python tools/build_cat.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_animal_mounts import build


build('black_cat')
