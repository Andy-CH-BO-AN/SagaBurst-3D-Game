#!/usr/bin/env python3
"""Normalize the user-supplied Centurion Aquila shield GLB; Python 3 + NumPy.

Usage: python3 tools/build-centurion-shield.py /path/to/downloads
Only a uniform node transform changes. Topology, UVs, normals, material and the
three embedded JPEG textures are retained byte for byte. The shield follows the
existing faction-shield contract (+Z face, rear grip at z=.085 behind the boss,
offline silhouette collision bands measured from this mesh, never copied).
"""
import sys, json, importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('meshy', Path(__file__).with_name('build-meshy-weapons.py'))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
SHIELD_FILE = 'Meshy_AI_Aquila_s_Bulwark_1107160911_texture.glb'
SHIELD_SHA = 'dc66ccd3021258206de3b1944a0c850c8d8f3c2b120eb37c088fea411d06402c'
RIGHTS = 'User supplied Meshy GLB for SagaBurst; the repository owner supplied this file and requested its integration on 2026-11-10.'
HEIGHT = 1.1  # Same visible height as the other Roman T4 faction shield (Starlit Aegis).

doc, binary, sha = lib.read(SOURCE / SHIELD_FILE)
if sha != SHIELD_SHA:
    raise ValueError(f'Unexpected source {SHIELD_FILE}: {sha}')
primitive = doc['meshes'][0]['primitives'][0]
points = lib.array(doc, binary, primitive['attributes']['POSITION'])
triangles = lib.array(doc, binary, primitive['indices']).reshape(-1, 3)
if float(points[:, 2].max()) < -float(points[:, 2].min()) * .5:
    raise ValueError('Expected the boss/face toward +Z')

scale = HEIGHT / float(np.ptp(points[:, 1]))
offset = -(points.min(0) + points.max(0)) * scale / 2
# The scutum is curved: measure the board directly behind the boss, then seat it like the other faction shields.
core = points[np.hypot(points[:, 0], points[:, 1] * .6) < .06]
rear_center = float(core[:, 2].min())
offset[2] = .155 - rear_center * scale
matrix = np.eye(4); matrix[:3, :3] *= scale; matrix[:3, 3] = offset
doc['nodes'][0]['matrix'] = matrix.T.flatten().tolist()
final = points @ matrix[:3, :3].T + matrix[:3, 3]

bands = []
tri = final[triangles]
step = HEIGHT / 32
for bottom in np.arange(-HEIGHT / 2 + step, HEIGHT / 2 - step, step):
    top = bottom + step
    widths, depths = [], []
    for y in np.linspace(bottom, top, 9):
        hits = []
        for a, b in ((tri[:, 0], tri[:, 1]), (tri[:, 1], tri[:, 2]), (tri[:, 2], tri[:, 0])):
            crossing = (a[:, 1] <= y) & (b[:, 1] > y) | (b[:, 1] <= y) & (a[:, 1] > y)
            aa, bb = a[crossing], b[crossing]
            if len(aa):
                hits.extend(aa + (bb - aa) * ((y - aa[:, 1]) / (bb[:, 1] - aa[:, 1]))[:, None])
        hits = np.asarray(hits)
        if not len(hits):
            continue
        widths.append(min(-hits[:, 0].min(), hits[:, 0].max()))
        depths.append((float(hits[:, 2].min()), float(hits[:, 2].max())))
    if len(widths) == 9 and min(widths) > .006:
        bands.append([round(float(bottom), 6), round(float(top), 6), round(float(min(widths) - .003), 6),
            round(min(d[0] for d in depths), 6), round(max(d[1] for d in depths), 6)])

shield = {'id': 'centurion_aquila_shield_t4', 'sourceFile': SHIELD_FILE, 'sourceSha256': sha,
    'sourceProvider': 'Meshy; user-supplied GLB', 'publishedPath': 'models/weapons/faction-shields/centurion-aquila.glb',
    'rightsEvidence': RIGHTS, 'build': 'python3 tools/build-centurion-shield.py SOURCE_DIRECTORY',
    'geometryPolicy': 'All source accessor, index, UV, normal, material and image bytes retained; uniform node transform only.',
    'triangles': len(triangles), 'uniformScale': scale, 'sourceToAttachmentMatrix': matrix.T.flatten().tolist(),
    'boundsMin': final.min(0).tolist(), 'boundsMax': final.max(0).tolist(), 'gripCenterLocal': [0, 0, .085],
    'rearCenterZ': .155, 'front': '+Z', 'heightMeters': HEIGHT, 'collisionBands': bands,
    'collisionPolicy': '32 horizontal silhouette slices, nine samples per slice, 3mm inward margin; no runtime triangle queries.'}
doc['asset'].setdefault('extras', {})['factionEquipment'] = shield
folder = ROOT / 'public/models/weapons/faction-shields'
shield['finalSha256'] = lib.write(folder / 'centurion-aquila.glb', doc, binary)
records = [r for r in json.loads((folder / 'sources.json').read_text()) if r['id'] != shield['id']] + [shield]
(folder / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
ts_path = ROOT / 'src/combat/FactionShieldGeometry.ts'
text = ts_path.read_text()
head, body = text.split(' = ', 1)
colliders = json.loads(body)
colliders[shield['id']] = bands
ts_path.write_text(head + ' = ' + json.dumps(colliders, indent=2) + '\n')
print('shield', sha, final.min(0), final.max(0), len(bands), 'bands')
