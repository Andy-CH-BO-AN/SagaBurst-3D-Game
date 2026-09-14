"""Blender: read the supplied archives and sample immutable source rigs only."""
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
parser.add_argument('--mode', choices=['locomotion', 'attack'], required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
incoming = Path('artifacts/animation_sources/incoming')
clips = {
    'idle': ('Animations/Male/Idles/HumanM@Idle01.fbx', 2.7),
    'walk': ('Animations/Male/Movement/Walk/HumanM@Walk01_Forward.fbx', .8),
    'run': ('Animations/Male/Movement/Run/HumanM@Run01_Forward.fbx', .6),
} if args.mode == 'locomotion' else {
    'swordSlash': ('Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb', .48),
}
archive = incoming / ('Human Archer Animations FREE.zip' if args.mode == 'locomotion' else 'Universal Animation Library 2[Standard].zip')
result = {'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'clips': {}}
axis = Matrix.Rotation(-math.pi / 2, 4, 'X')

def rotation(matrix):
    q = matrix.to_quaternion().normalized()
    return [q.x, q.y, q.z, q.w]

with tempfile.TemporaryDirectory() as temp, zipfile.ZipFile(archive) as z:
    for name, (entry, duration) in clips.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = Path(temp) / Path(entry).name
        path.write_bytes(z.read(entry))
        if path.suffix == '.fbx':
            bpy.ops.import_scene.fbx(filepath=str(path))
        else:
            bpy.ops.import_scene.gltf(filepath=str(path))
        rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
        if args.mode == 'attack':
            action = next(a for a in bpy.data.actions if 'Sword_Regular_A' in a.name and 'Rec' not in a.name)
            rig.animation_data_create()
            rig.animation_data.action = action
            if action.slots:
                rig.animation_data.action_slot = action.slots[0]
        else:
            action = rig.animation_data.action
        start, end = action.frame_range
        rest = {b.name: {
            'rotation': rotation(axis @ rig.matrix_world @ b.matrix_local),
            'position': list((axis @ rig.matrix_world @ b.matrix_local).translation),
            'parent': b.parent.name if b.parent else None,
        } for b in rig.data.bones}
        times = [i / 30 for i in range(math.ceil(duration * 30))] + [duration]
        if args.mode == 'attack':
            times = sorted(set(times + [.252]))
        poses = []
        for time in times:
            phase = time / duration
            if args.mode == 'attack':
                # Blade crosses character-forward at source phase .575. Smooth
                # monotonic retiming aligns that sweep with the fixed hit event.
                phase += (.575 - .525) / math.sin(math.pi * .525) * math.sin(math.pi * phase)
            frame = start + (end - start) * phase
            bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
            poses.append({b.name: rotation(axis @ rig.matrix_world @ b.matrix) for b in rig.pose.bones})
        result['clips'][name] = {'sourceClip': action.name, 'sourceFrames': [start, end], 'duration': duration, 'rest': rest, 'times': times, 'poses': poses}
        if args.mode == 'attack':
            result['clips'][name]['timeMapping'] = {'method': 'u + amplitude * sin(pi * u)', 'amplitude': (.575 - .525) / math.sin(math.pi * .525), 'contactSeconds': .252, 'sourceContactNormalized': .575}
        print(f'{name}：已取樣 {len(times)} 個時間點，來源 {action.name}')
out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, ensure_ascii=False), encoding='utf8')
