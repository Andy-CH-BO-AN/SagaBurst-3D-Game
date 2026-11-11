"""Bake the two user-supplied Meshy warrior sculptures into static architecture statues.

Usage (Blender 5.2, background):
  blender -b --factory-startup -P tools/build-architecture-statues.py -- /path/to/downloads

Both sources are untextured, unrigged 29-31K triangle meshes. Each output GLB keeps
only POSITION/NORMAL in two LOD meshes (`LOD0`, `LOD1`), feet on y=0, centred on
x/z, unit height and the figure's face toward local +Z. Town architecture scales
and tints them as carved stone (Roman) or timber (Viking); no skeleton, material,
NPC or animation is imported. Outputs are rebuilt deterministically from the
checked source hashes.
"""
import sys
from pathlib import Path
import bpy
import bmesh
import hashlib
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models' / 'architecture'
RIGHTS = 'User supplied Meshy GLB for SagaBurst; the repository owner supplied this file and requested its use as static town architecture on 2026-11-11.'
SOURCES = {
    'roman-byzantine-statue': ('Meshy_AI_byzantine_warrior_30k_1111102334_generate.glb',
                               '0f4910ec5052c90c15d4fae2298a0099dba16868f23da179b3e448d37443c941'),
    'viking-berserker-statue': ('Meshy_AI_Ironclad_Berserker_1111103126_generate.glb',
                                '3c566402188ec05a5b89587b190f40e47f481b03255e12564f5c2d9c20bcb9e4'),
}
# Triangle budgets: LOD0 for near inspection, LOD1 beyond ~45m.
LOD_TRIANGLES = (6000, 1400)
# Meshy exports face glTF +Z; this rotation (degrees about +Y) corrects a source
# that faces elsewhere. Measured visually in the DEV showcase.
FACING_DEGREES = {'roman-byzantine-statue': 0.0, 'viking-berserker-statue': 0.0}

source_dir = Path(sys.argv[sys.argv.index('--') + 1])
OUT.mkdir(parents=True, exist_ok=True)


def triangles(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


for name, (file, sha) in SOURCES.items():
    path = source_dir / file
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != sha:
        raise ValueError(f'Unexpected source {file}: {digest}')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(meshes) != 1:
        raise ValueError(f'{file}: expected one mesh, found {len(meshes)}')
    source = meshes[0]
    bpy.context.view_layer.objects.active = source
    source.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Weld Meshy's split vertices so decimation keeps a closed silhouette.
    bm = bmesh.new(); bm.from_mesh(source.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(source.data); bm.free()
    # Unit height, feet on the ground, centred. glTF +Y up imports as Blender +Z up.
    xs = [v.co.x for v in source.data.vertices]; ys = [v.co.y for v in source.data.vertices]; zs = [v.co.z for v in source.data.vertices]
    height = max(zs) - min(zs)
    centre = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs))
    source.data.transform(Matrix.Translation((-centre[0], -centre[1], -centre[2])))
    source.data.transform(Matrix.Scale(1 / height, 4))
    source.data.transform(Matrix.Rotation(FACING_DEGREES[name] * 3.14159265358979 / 180, 4, 'Z'))
    lods = []
    for level, budget in enumerate(LOD_TRIANGLES):
        lod = source.copy(); lod.data = source.data.copy(); lod.name = f'LOD{level}'; lod.data.name = f'LOD{level}'
        bpy.context.scene.collection.objects.link(lod)
        modifier = lod.modifiers.new('decimate', 'DECIMATE')
        modifier.ratio = min(1, budget / triangles(source))
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = lod
        bpy.ops.object.select_all(action='DESELECT'); lod.select_set(True)
        bpy.ops.object.modifier_apply(modifier='decimate')
        # Carved material reads best with soft normals and crisp creases.
        bpy.ops.object.shade_auto_smooth(angle=0.75)
        lods.append(lod)
        print(f'{name} LOD{level}: {triangles(lod)} triangles')
    bpy.data.objects.remove(source)
    bpy.ops.object.select_all(action='DESELECT')
    for lod in lods: lod.select_set(True)
    target = OUT / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True,
                              export_materials='NONE', export_texcoords=False, export_normals=True,
                              export_apply=True, export_yup=True, export_extras=False)
    print(f'{target.relative_to(ROOT)} {target.stat().st_size} bytes; source sha256 {sha}')

(OUT / 'SOURCES.md').write_text(
    '# Architecture statue sources\n\n'
    'Rebuild: `blender -b --factory-startup -P tools/build-architecture-statues.py -- <downloads>`\n\n'
    + ''.join(f'- `{name}.glb` ← `{file}` (sha256 `{sha}`)\n' for name, (file, sha) in SOURCES.items())
    + f'\n{RIGHTS}\n', encoding='utf-8')
