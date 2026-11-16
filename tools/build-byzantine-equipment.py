#!/usr/bin/env python3
"""Normalize the two user-supplied Byzantine equipment GLBs; Python 3 + NumPy.

Usage: python3 tools/build-byzantine-equipment.py /path/to/downloads
Only a uniform node transform changes. Topology, UVs, normals, material and
the three embedded JPEG textures are retained byte for byte. The lance is
scaled to a 3.3 m visible length (gameplay reach remains WeaponData.range =
3.9 m); the eagle shield follows the existing faction-shield contract (+Z face,
rear grip behind the boss, offline silhouette collision bands).
"""
import sys, json, re, importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('meshy', Path(__file__).with_name('build-meshy-weapons.py'))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
RIGHTS = 'User supplied Meshy GLB for SagaBurst; same Meshy-equipment redistribution basis as faction-shields/sources.json (confirmed 2026-11-02).'

def load(name, sha):
    doc, binary, actual = lib.read(SOURCE / name)
    if sha and actual != sha:
        raise ValueError(f'Unexpected source {name}: {actual}')
    primitive = doc['meshes'][0]['primitives'][0]
    points = lib.array(doc, binary, primitive['attributes']['POSITION'])
    triangles = lib.array(doc, binary, primitive['indices']).reshape(-1, 3)
    return doc, binary, actual, points, triangles

# ---- lance ---------------------------------------------------------------
LANCE_FILE = 'Meshy_AI_Byzantine_Standard_Sp_1107021416_texture.glb'
doc, binary, sha, points, triangles = load(LANCE_FILE, None)
VISIBLE_LENGTH = 3.3
scale = VISIBLE_LENGTH / float(np.ptp(points[:, 1]))
butt = points[points[:, 1] < points[:, 1].min() + .05]
tip = points[points[:, 1] > points[:, 1].max() - .01]
axis_x = (butt[:, 0].min() + butt[:, 0].max()) / 2   # shaft axis, measured at the ferrule
axis_z = (butt[:, 2].min() + butt[:, 2].max()) / 2
offset = np.array([-axis_x * scale, 2.8 - points[:, 1].max() * scale, -axis_z * scale])
matrix = np.eye(4); matrix[:3, :3] *= scale; matrix[:3, 3] = offset
doc['nodes'][0]['matrix'] = matrix.T.flatten().tolist()
final = points @ matrix[:3, :3].T + matrix[:3, 3]
lance = {'id': 'byzantine_standard_lance_t5', 'sourceFile': LANCE_FILE, 'sourceSha256': sha,
    'sourceProvider': 'Meshy; user-supplied GLB', 'publishedPath': 'models/weapons/byzantine/standard-lance.glb',
    'rightsEvidence': RIGHTS, 'build': 'python3 tools/build-byzantine-equipment.py SOURCE_DIRECTORY',
    'geometryPolicy': 'All source accessor, index, UV, normal, material and image bytes retained; uniform node transform only.',
    'triangles': len(triangles), 'uniformScale': scale, 'sourceToAttachmentMatrix': matrix.T.flatten().tolist(),
    'boundsMin': final.min(0).tolist(), 'boundsMax': final.max(0).tolist(),
    'gripCenterLocal': [0, .15, 0], 'longAxis': '+Y', 'visibleLengthMeters': VISIBLE_LENGTH,
    'tipLocal': [0, 2.8, 0], 'supportPointLocal': [0, .33, 0], 'gameplayHitRangeMeters': 3.9}
doc['asset'].setdefault('extras', {})['byzantineEquipment'] = lance
out = ROOT / 'public/models/weapons/byzantine'; out.mkdir(parents=True, exist_ok=True)
lance['finalSha256'] = lib.write(out / 'standard-lance.glb', doc, binary)
(out / 'sources.json').write_text(json.dumps([lance], indent=2) + '\n')
(out / 'ATTRIBUTION.md').write_text('# Byzantine standard lance\n\nUser-supplied Meshy model (`' + LANCE_FILE + '`). Uniform node transform only; see sources.json for hashes, matrix and bounds. Visible length 3.3 m; gameplay reach is the weapon database range (3.9 m).\n')
print('lance', final.min(0), final.max(0))

# ---- shield --------------------------------------------------------------
SHIELD_FILE = 'Meshy_AI_Crimson_Byzantine_Aeg_1107021405_texture.glb'
doc, binary, sha, points, triangles = load(SHIELD_FILE, None)
height = 1.1
scale = height / float(np.ptp(points[:, 1]))
offset = -(points.min(0) + points.max(0)) * scale / 2
core = points[np.hypot(points[:, 0], points[:, 1] * .6) < .06]
rear_center = float(core[:, 2].min())          # measured rear surface behind the boss
offset[2] = .155 - rear_center * scale         # other faction shields: rear centre ~.13-.16, grip at .085
matrix = np.eye(4); matrix[:3, :3] *= scale; matrix[:3, 3] = offset
doc['nodes'][0]['matrix'] = matrix.T.flatten().tolist()
final = points @ matrix[:3, :3].T + matrix[:3, 3]
bands = []
tri = final[triangles]
step = height / 32
for bottom in np.arange(-height / 2 + step, height / 2 - step, step):
    top = bottom + step
    widths, depths = [], []
    for y in np.linspace(bottom, top, 9):
        hits = []
        for a, b in ((tri[:, 0], tri[:, 1]), (tri[:, 1], tri[:, 2]), (tri[:, 2], tri[:, 0])):
            crossing = (a[:, 1] <= y) & (b[:, 1] > y) | (b[:, 1] <= y) & (a[:, 1] > y)
            aa, bb = a[crossing], b[crossing]
            if len(aa):
                hits.extend(aa + (bb-aa) * ((y-aa[:, 1]) / (bb[:, 1]-aa[:, 1]))[:, None])
        hits = np.asarray(hits)
        if not len(hits):
            continue
        widths.append(min(-hits[:, 0].min(), hits[:, 0].max()))
        depths.append((float(hits[:, 2].min()), float(hits[:, 2].max())))
    if len(widths) == 9 and min(widths) > .006:
        bands.append([round(float(bottom), 6), round(float(top), 6), round(float(min(widths)-.003), 6),
            round(min(d[0] for d in depths), 6), round(max(d[1] for d in depths), 6)])
shield = {'id': 'byzantine_eagle_shield_t5', 'sourceFile': SHIELD_FILE, 'sourceSha256': sha,
    'sourceProvider': 'Meshy; user-supplied GLB', 'publishedPath': 'models/weapons/faction-shields/byzantine-eagle.glb',
    'rightsEvidence': RIGHTS, 'build': 'python3 tools/build-byzantine-equipment.py SOURCE_DIRECTORY',
    'geometryPolicy': 'All source accessor, index, UV, normal, material and image bytes retained; uniform node transform only.',
    'triangles': len(triangles), 'uniformScale': scale, 'sourceToAttachmentMatrix': matrix.T.flatten().tolist(),
    'boundsMin': final.min(0).tolist(), 'boundsMax': final.max(0).tolist(), 'gripCenterLocal': [0, 0, .085],
    'front': '+Z', 'heightMeters': height, 'collisionBands': bands,
    'collisionPolicy': '32 horizontal silhouette slices, nine samples per slice, 3mm inward margin; no runtime triangle queries.'}
doc['asset'].setdefault('extras', {})['factionEquipment'] = shield
folder = ROOT / 'public/models/weapons/faction-shields'
shield['finalSha256'] = lib.write(folder / 'byzantine-eagle.glb', doc, binary)
records = [r for r in json.loads((folder / 'sources.json').read_text()) if r['id'] != shield['id']] + [shield]
(folder / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
ts_path = ROOT / 'src/combat/FactionShieldGeometry.ts'
text = ts_path.read_text()
head, body = text.split(' = ', 1)
colliders = json.loads(body)
colliders[shield['id']] = bands
ts_path.write_text(head + ' = ' + json.dumps(colliders, indent=2) + '\n')
print('shield', final.min(0), final.max(0), len(bands), 'bands')
