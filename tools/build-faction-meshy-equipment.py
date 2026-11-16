#!/usr/bin/env python3
"""Rebuild four user-supplied faction equipment GLBs; requires NumPy/Pillow.
Usage: python3 tools/build-faction-meshy-equipment.py /path/to/sources
Original topology, UVs, normals and textures are retained. Only a uniform node
transform changes attachment space. Shield slices are measured offline.
"""
import sys, json, hashlib, importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('meshy', Path(__file__).with_name('build-meshy-weapons.py'))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
ROOT = Path.cwd()
SOURCE = Path(sys.argv[1])
DEFINITIONS = [
    ('spear_t4', 'Meshy_AI_Shadowsteel_Spear_1101105959_texture.glb', '5bf59710d12bebfb2d92618b3761fe0697e5793081c2163c2f1112ed9d023b22', 'high-tier/spear.glb', 3.1),
    ('axe_t5', 'Meshy_AI_Wolfcarver_Battleaxe_1101110240_texture.glb', 'fa8cd1a947eedeea4dd0f373160724ffd8fa73df3a5c92bd4ce673db3beece73', 't5/axe.glb', 1.9),
    ('roman_officer_shield_t4', 'Meshy_AI_Starlit_Silverwood_Sh_1101110012_texture.glb', 'e288939b5a70cb57ce34cd448a778ced9797be889bca07ecc40d6f3383d4f24a', 'faction-shields/roman-officer.glb', 1.1),
    ('viking_berserker_shield_t5', 'Meshy_AI_Wolfguard_Shield_1101110419_texture.glb', '867a69e686e97745021771d86ebb639b771a365e9ca4a99a043aa04c0c44c25d', 'faction-shields/viking-berserker.glb', .9),
]
records = []
colliders = {}
for item_id, filename, expected, target, height in DEFINITIONS:
    doc, binary, sha = lib.read(SOURCE / filename)
    if sha != expected:
        raise ValueError(f'Unexpected source: {filename}')
    primitive = doc['meshes'][0]['primitives'][0]
    points = lib.array(doc, binary, primitive['attributes']['POSITION'])
    triangles = lib.array(doc, binary, primitive['indices']).reshape(-1, 3)
    scale = height / float(np.ptp(points[:, 1]))
    offset = -(points.min(0) + points.max(0)) * scale / 2
    shield = 'shield' in item_id
    if shield:
        # +Z is the decorated face; keep the rear grip behind the board.
        offset[2] = .13 - points[:, 2].min() * scale
    else:
        tip_y = 2.6 if item_id == 'spear_t4' else 1.51
        offset[1] = tip_y - points[:, 1].max() * scale
        shaft = points[(points[:, 1] > -.6) & (points[:, 1] < -.1)]
        offset[0] = -np.median(shaft[:, 0]) * scale
        offset[2] = -np.median(shaft[:, 2]) * scale
        if item_id == 'spear_t4':
            offset[0] = -points[np.argmax(points[:, 1]), 0] * scale
            offset[2] = -points[np.argmax(points[:, 1]), 2] * scale
    matrix = np.eye(4)
    matrix[:3, :3] *= scale
    matrix[:3, 3] = offset
    if item_id == 'axe_t5':
        # Source single blade projects -X. Canonical carry requires +X so
        # the cutting edge faces down when the mounted shaft points forward.
        rotation = np.diag([-1., 1., -1., 1.])
        matrix = rotation @ matrix
    doc['nodes'][0]['matrix'] = matrix.T.flatten().tolist()
    final = points @ matrix[:3, :3].T + matrix[:3, 3]
    metadata = {'id': item_id, 'sourceFile': filename, 'sourceSha256': sha,
        'sourceProvider': 'Meshy; user-supplied GLB', 'publishedPath': 'models/weapons/' + target,
        'rightsEvidence': 'User confirmed generation/use and GitHub redistribution rights in Codex chat, 2026-11-02.',
        'build': 'python3 tools/build-faction-meshy-equipment.py SOURCE_DIRECTORY',
        'geometryPolicy': 'All source accessor, index, UV, normal, material and image bytes retained; uniform node transform only.',
        'triangles': len(triangles), 'uniformScale': scale, 'sourceToAttachmentMatrix': matrix.T.flatten().tolist(),
        'boundsMin': final.min(0).tolist(), 'boundsMax': final.max(0).tolist(),
        'gripCenterLocal': [0, 0, .085] if shield else [0, .15, 0]}
    if shield:
        # Intersect the real triangles with horizontal planes. Inset the band
        # to the narrowest measured outline across its full height; exclude
        # the isolated handle and ornamental silhouette spikes.
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
        colliders[item_id] = bands
        metadata.update(front='+Z', heightMeters=height, collisionBands=bands,
            collisionPolicy='32 horizontal silhouette slices, nine samples per slice, 3mm inward margin; no runtime triangle queries.')
    else:
        metadata.update(longAxis='+Y', tipLocal=[0, 2.6 if item_id == 'spear_t4' else 1.51, 0])
        if item_id == 'spear_t4':
            metadata['supportPointLocal'] = [0, .33, 0]
    doc['asset'].setdefault('extras', {})['factionEquipment'] = metadata
    out = ROOT / 'public/models/weapons' / target
    out.parent.mkdir(parents=True, exist_ok=True)
    metadata['finalSha256'] = lib.write(out, doc, binary)
    records.append(metadata)
    print(item_id, len(triangles), final.min(0), final.max(0))
folder = ROOT / 'public/models/weapons/faction-shields'
(folder / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
(folder / 'ATTRIBUTION.md').write_text('# Meshy faction equipment\n\nFour user-supplied Meshy models. User confirmed use and GitHub redistribution rights on 2026-11-02. No new third-party license is asserted. See sources.json for filenames, hashes, transforms and collider measurements. Original downloads remain outside the runtime bundle.\n')
ts = '// Generated by tools/build-faction-meshy-equipment.py from the real shield silhouettes.\n'
ts += 'export const FACTION_SHIELD_BANDS: Readonly<Record<string, readonly (readonly number[])[]>> = ' + json.dumps(colliders, indent=2) + '\n'
(ROOT / 'src/combat/FactionShieldGeometry.ts').write_text(ts)

