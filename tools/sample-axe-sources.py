"""Blender source-only sampler. Source FBX/meshes never enter the runtime bundle.

blender -b --python tools/sample-axe-sources.py -- --archive <zip> --output output/axe/source.json
"""
import argparse
import bpy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile
from mathutils import Matrix

parser = argparse.ArgumentParser()
parser.add_argument('--archive', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
archive = Path(args.archive)
result = {'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'clips': {}}
axis = Matrix.Rotation(-math.pi / 2, 4, 'X')

def rotation(matrix):
    q = matrix.to_quaternion().normalized()
    return [q.x, q.y, q.z, q.w]

with tempfile.TemporaryDirectory() as temp, zipfile.ZipFile(archive) as z:
    for name, entry in {
        'axeAttack1H': 'Animations/Male/Combat/1H/HumanM@Attack1H01_R.fbx',
        'axeAttack2H': 'Animations/Male/Combat/2H/HumanM@Attack2H01.fbx',
    }.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = Path(temp) / Path(entry).name
        source_bytes = z.read(entry)
        path.write_bytes(source_bytes)
        bpy.ops.import_scene.fbx(filepath=str(path))
        rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
        action = rig.animation_data.action
        start, end = action.frame_range
        rest = {b.name: {
            'rotation': rotation(axis @ rig.matrix_world @ b.matrix_local),
            'position': list((axis @ rig.matrix_world @ b.matrix_local).translation),
            'parent': b.parent.name if b.parent else None,
        } for b in rig.data.bones}
        # Keep the existing 0.48s melee action budget; only contact timing differs.
        duration = .48
        count = round(end - start)
        times = [i / count * duration for i in range(count + 1)]
        poses, positions = [], []
        for i in range(count + 1):
            frame = start + i
            bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
            poses.append({b.name: rotation(axis @ rig.matrix_world @ b.matrix) for b in rig.pose.bones})
            positions.append({b.name: list((axis @ rig.matrix_world @ b.matrix).translation) for b in rig.pose.bones})
        result['clips'][name] = {'sourceClip': Path(entry).stem, 'sourceAction': action.name,
            'sourceFileSha256': hashlib.sha256(source_bytes).hexdigest(), 'sourceFrames': [start, end],
            'sourceFps': bpy.context.scene.render.fps, 'duration': duration,
            'rest': rest, 'times': times, 'poses': poses, 'positions': positions}
        print(name, action.name, start, end, list(rest))
out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result), encoding='utf8')
