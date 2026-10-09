#!/usr/bin/env python3
"""Build supplied CC-BY assets, then run retarget-paladin.mjs.
blender -b --python tools/build-paladin.py -- /path/to/source-directory
Source GLBs stay outside public/. No substitute meshes are generated.
"""
import bpy, json, sys, hashlib, struct, re
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path.cwd()
SOURCE = Path(sys.argv[sys.argv.index('--') + 1])
OUT = ROOT / 'public/models/characters/v2/roman-hero-t4'
EQUIP = ROOT / 'public/models/weapons/paladin'
OUT.mkdir(parents=True, exist_ok=True)
EQUIP.mkdir(parents=True, exist_ok=True)

def load(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / name))
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and o.name != 'Icosphere']

def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

def flatten(objects):
    for o in objects:
        matrix = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = matrix
    select(objects)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def textures(maxsize):
    for image in bpy.data.images:
        if image.size[0] > maxsize or image.size[1] > maxsize:
            f = maxsize / max(image.size)
            image.scale(round(image.size[0] * f), round(image.size[1] * f))
            image.pack()

def export(objects, path):
    select(objects)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_animations=False, export_yup=True, export_extras=True, export_image_format='JPEG', export_jpeg_quality=88)

def triangles(objects):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects if o.type == 'MESH')

def provenance(name):
    b = (SOURCE / name).read_bytes()
    doc = json.loads(b[20:20 + struct.unpack_from('<I', b, 12)[0]])
    return dict(doc['asset']['extras'], sourceSha256=hashlib.sha256(b).hexdigest(), sourceFile=name, bytes=len(b))

# Extract the actual long sword, whose source blade points down.
meshes = load('paladin.glb')
sword = next(o for o in meshes if o.name == 'bastardsword_weapons_0')
flatten([sword])
# Source guard z=101, pommel z=135.7; leather grip centre z=119.
for v in sword.data.vertices:
    x, y, z = v.co
    v.co = Vector((x * .00987, (y + 38.03) * .00987, (119 - z) * .00987 + .15))
textures(1024)
export([sword], EQUIP / 'sword.glb')

# Source mace points along +X; fit a 1.25m weapon to the canonical grip.
meshes = load('paladin_mace_free_download.glb')
flatten(meshes)
for o in meshes:
    for v in o.data.vertices:
        x, y, z = v.co
        v.co = Vector((z * .625, y * .625, (x + .35) * .625 + .15))
textures(512)
export(meshes, EQUIP / 'mace.glb')

# The two large surfaces are the complete shield. Other meshes form straps/grips.
meshes = load('paladin_shield_free_download.glb')
body = [o for o in meshes if o.name in ['defaultMaterial.002', 'defaultMaterial.004']]
flatten(body)
for o in body:
    for v in o.data.vertices:
        x, y, z = v.co
        v.co = Vector((x * .55, y * .55 - .21, z * .55))
textures(1024)
export(body, EQUIP / 'shield.glb')

# Procedural mounted/FK poses use the established project bone axes.
load(str(ROOT / 'public/models/characters/v2/roman/lod0.glb'))
project_rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
project_axes = {b.name: (project_rig.matrix_world @ b.matrix_local).to_quaternion().to_matrix().to_4x4()
                for b in project_rig.data.bones}
# Character retains source skinning; both swords and scabbards are excluded.
meshes = load('paladin.glb')
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
body = [o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers)]
flatten([rig, *body])
for p in rig.pose.bones:
    # Retain authored digit curl while normalizing the large limb pose.
    if not re.match(r'^[LR]_(thumb|point|middle|ring|pink)', p.name):
        p.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
# Canonical anatomical T-pose before world-rest animation retarget.
for side, sign in [('L', 1), ('R', -1)]:
    for prefix, child in [('arm', 'elbow'), ('elbow', 'wrist')]:
        bone = next(p for p in rig.pose.bones if p.name.startswith(side + '_' + prefix + '_'))
        end = next(p for p in rig.pose.bones if p.name.startswith(side + '_' + child + '_'))
        rotation = (end.head - bone.head).normalized().rotation_difference(Vector((sign, 0, 0)))
        bone.matrix = Matrix.Translation(bone.head) @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-bone.head) @ bone.matrix
        bpy.context.view_layer.update()
for o in body:
    select([o])
    mod = next(m for m in o.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
select([rig])
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
name_map = {'hips_01': 'hips', 'spine_012': 'spine', 'chest_013': 'chest', 'neck_061': 'neck', 'head_062': 'head'}
for side, suffix in [('L', 'l'), ('R', 'r')]:
    for source, target in [('shoulder', 'clavicle'), ('arm', 'upper_arm'), ('elbow', 'lower_arm'), ('wrist', 'hand'),
                           ('leg', 'upper_leg'), ('knee', 'lower_leg'), ('ankle', 'foot'), ('foot', 'toe')]:
        b = next(b for b in rig.data.bones if b.name.startswith(side + '_' + source + '_'))
        name_map[b.name] = target + '_' + suffix
for old, new in name_map.items():
    rig.data.bones[old].name = new
    for o in body:
        group = o.vertex_groups.get(old)
        if group:
            group.name = new
# Digit curls are already baked and no gameplay clip animates individual fingers.
# Collapse their weights to the nearest mapped joint instead of updating dozens
# of static source joints for every NPC. Skin deformation remains equivalent.
canonical = set(name_map.values())
collapsed = {}
for bone in rig.data.bones:
    if bone.name in canonical:
        continue
    parent = bone.parent
    while parent and parent.name not in canonical:
        parent = parent.parent
    if parent:
        collapsed[bone.name] = parent.name
for o in body:
    for old, parent in collapsed.items():
        group = o.vertex_groups.get(old)
        if not group:
            continue
        target = o.vertex_groups.get(parent) or o.vertex_groups.new(name=parent)
        for vertex in o.data.vertices:
            weight = next((g.weight for g in vertex.groups if g.group == group.index), 0)
            if weight:
                target.add([vertex.index], weight, 'ADD')
        o.vertex_groups.remove(group)
select([rig])
bpy.ops.object.mode_set(mode='EDIT')
for name in collapsed:
    rig.data.edit_bones.remove(rig.data.edit_bones[name])
bpy.ops.object.mode_set(mode='OBJECT')
points = [v.co for o in body for v in o.data.vertices]
floor = min(p.z for p in points)
top = max(p.z for p in points)
scale = 1.95 / (top - floor)

def normalize(p):
    return Vector((p.x * scale, p.y * scale, (p.z - floor) * scale))

for o in body:
    for v in o.data.vertices:
        v.co = normalize(v.co)
    modifier = o.modifiers.new('Paladin_skin', 'ARMATURE')
    modifier.object = rig
    o.parent = rig
select([rig])
bpy.ops.object.mode_set(mode='EDIT')
for b in rig.data.edit_bones:
    h, t = normalize(b.head), normalize(b.tail)
    b.head, b.tail = h, t
    if b.name in project_axes:
        matrix = project_axes[b.name].copy()
        matrix.translation = h
        b.matrix = matrix
for name, parent in [('socket_hand_l', 'hand_l'), ('socket_hand_r', 'hand_r'), ('socket_back', 'chest'),
                     ('socket_head', 'head'), ('socket_pelvis', 'hips'), ('socket_foot_l', 'foot_l'),
                     ('socket_foot_r', 'foot_r'), ('sole_l', 'foot_l'), ('sole_r', 'foot_r')]:
    p = rig.data.edit_bones[parent]
    b = rig.data.edit_bones.new(name)
    b.head = p.head
    b.tail = p.head + Vector((0, 0, .03))
    b.parent = p
    if name.startswith('sole_'):
        b.head.z = .003
        b.tail = b.head + Vector((0, 0, .03))
bpy.ops.object.mode_set(mode='OBJECT')
rig.name = 'project_humanoid'
for o in body:
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])
base_count = triangles(body)
metrics = {'heightM': 1.95, 'heightDefinition': 'Overall armoured stature including helmet horns; enclosed anatomical crown unavailable',
           'uniformScaleAppliedOffline': scale, 'sourceBoundsZ': [floor, top], 'triangles': {}}
metrics['neckLengthM'] = (rig.data.bones['head'].head_local - rig.data.bones['neck'].head_local).length
metrics['shoulderWidthM'] = (rig.data.bones['upper_arm_l'].head_local - rig.data.bones['upper_arm_r'].head_local).length
metrics['shoulderWidthDefinition'] = 'Anatomical shoulder joint span in normalized T-pose; pauldron silhouette extends beyond joints'
for lod, budget, tex in [(0, 16000, 2048), (1, 7800, 1024), (2, 1900, 512)]:
    copies = []
    for o in body:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.collection.objects.link(c)
        copies.append(c)
        if lod:
            select([c])
            dec = c.modifiers.new('LOD_budget', 'DECIMATE')
            dec.ratio = min(1, budget / base_count)
            bpy.ops.object.modifier_move_up(modifier=dec.name)
            bpy.ops.object.modifier_apply(modifier=dec.name)
    textures(tex)
    export([rig, *copies], OUT / f'lod{lod}.glb')
    metrics['triangles'][f'lod{lod}'] = triangles(copies)
    for c in copies:
        bpy.data.objects.remove(c, do_unlink=True)
(OUT / 'paladin-build.json').write_text(json.dumps(metrics, indent=2) + '\n')
(OUT / 'bone-map.json').write_text(json.dumps({'skeleton': 'project-humanoid-v1', 'sourceToProject': name_map,
    'method': 'Original source skin; offline T-pose normalization and world-rest animation retarget'}, indent=2) + '\n')
(EQUIP / 'sources.json').write_text(json.dumps([provenance(n) for n in ['paladin.glb', 'paladin_mace_free_download.glb', 'paladin_shield_free_download.glb']], indent=2) + '\n')
print(json.dumps(metrics))
