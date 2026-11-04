"""Extract the already licensed Kevin Iglesias male hand for the local repair.

blender -b --python tools/prepare-hand-reference.py -- HumanM_Model.fbx output.json
The reference download stays outside public/. No complete reference model is shipped.
"""
import bpy, sys, json, hashlib
from mathutils import Vector, Matrix
from pathlib import Path

source, destination = map(Path, sys.argv[sys.argv.index('--') + 1:])
sha = hashlib.sha256(source.read_bytes()).hexdigest()
if sha != '88fd0684f0b3331cc4056b2ddafebf506d52c21c32e18884fd28214c0a8d75cb':
    raise ValueError('Expected Human Melee Animations FREE/Models/HumanM_Model.fbx')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['HumanM_BodyMesh']
result = {'sourceSha256': sha, 'author': 'Kevin Iglesias', 'source': 'Human Melee Animations FREE/Models/HumanM_Model.fbx', 'license': 'Unity Asset Store EULA; embedded character derivative only', 'hands': {}}
for side in ['l', 'r']:
    def name(digit, joint):
        return f'B-{digit if digit in ["pinky", "thumb"] else digit + "Finger"}{joint:02}.{side.upper()}'
    hand = arm.data.bones[f'B-hand.{side.upper()}']
    origin = arm.matrix_world @ hand.head_local
    position = lambda n: arm.matrix_world @ arm.data.bones[n].head_local
    x = (position(name('index', 1)) - position(name('pinky', 1))).normalized()
    y = (position(name('middle', 1)) - origin).normalized()
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y).normalized()
    basis = Matrix((x, y, z)).transposed()
    inverse = basis.transposed()
    aliases = {hand.name: f'hand_{side}'}
    for digit in ['thumb', 'index', 'middle', 'ring', 'pinky']:
        for joint in [1, 2, 3]: aliases[name(digit, joint)] = f'{digit}_{joint:02}_{side}'
    groups = {g.index: aliases[g.name] for g in body.vertex_groups if g.name in aliases}
    owned = {v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups) > .5}
    faces = [list(p.vertices) for p in body.data.polygons if all(i in owned for i in p.vertices)]
    used = sorted(set(i for f in faces for i in f))
    length = max((inverse @ (body.matrix_world @ body.data.vertices[i].co - origin)).y for i in used)
    canonical = lambda p: list(inverse @ (p-origin) / length)
    bones = {}
    for old, new in aliases.items():
        b = arm.data.bones[old]
        bones[new] = {'head': canonical(position(old)), 'tail': canonical(arm.matrix_world @ b.tail_local), 'rotation': list((inverse @ arm.matrix_world.to_3x3() @ b.matrix_local.to_3x3()).to_quaternion())}
    local = {v: i for i, v in enumerate(used)}
    mesh = bpy.data.meshes.new('ReferenceHand')
    mesh.from_pydata([canonical(body.matrix_world @ body.data.vertices[i].co) for i in used], [], [[local[i] for i in f] for f in faces])
    mesh.update()
    obj = bpy.data.objects.new('ReferenceHand', mesh); bpy.context.collection.objects.link(obj)
    for new in aliases.values(): obj.vertex_groups.new(name=new)
    for source_index, target_index in local.items():
        weights = {groups[g.group]: g.weight for g in body.data.vertices[source_index].groups if g.group in groups}
        total = sum(weights.values())
        for n,w in weights.items(): obj.vertex_groups[n].add([target_index], w/total, 'REPLACE')
    variants = {}
    # The original reference has connected palm/web topology. Decimation is
    # local to this hand and never applied to a character's body or equipment.
    for label, budget in [('captain0', 3000), ('captain1', 800), ('captain2', 500), ('ranger0', 200), ('ranger1', 350), ('ranger2', 300)]:
        copy = obj.copy(); copy.data=obj.data.copy(); bpy.context.collection.objects.link(copy)
        bpy.context.view_layer.objects.active=copy;copy.select_set(True)
        if label.startswith('captain'):
            modifier=copy.modifiers.new('Palm surface continuity','SUBSURF');modifier.levels=2
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.context.view_layer.update()
        triangles=sum(len(p.vertices)-2 for p in copy.data.polygons)
        if triangles>budget:
            modifier=copy.modifiers.new('Local hand LOD','DECIMATE');modifier.ratio=budget/triangles
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        copy.data.calc_loop_triangles()
        weights=[]
        for v in copy.data.vertices:
            entries=sorted([(copy.vertex_groups[g.group].name,g.weight) for g in v.groups if g.weight>0],key=lambda i:-i[1])[:4]
            total=sum(w for n,w in entries)
            weights.append([[n,w/total] for n,w in entries])
        variants[label]={'positions':[list(v.co) for v in copy.data.vertices], 'normals':[list(v.normal) for v in copy.data.vertices], 'weights':weights, 'triangles':[list(p.vertices) for p in copy.data.loop_triangles]}
        bpy.data.objects.remove(copy,do_unlink=True)
    result['hands'][side]={'lengthM':length,'bones':bones,'surfaces':variants}
    bpy.data.objects.remove(obj,do_unlink=True)
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(json.dumps(result,separators=(',',':')))
print('REFERENCE', {s:{k:len(v['triangles']) for k,v in h['surfaces'].items()} for s,h in result['hands'].items()})
