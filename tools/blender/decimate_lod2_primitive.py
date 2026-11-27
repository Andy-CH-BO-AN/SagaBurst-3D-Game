import bpy
import bmesh
import json
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
input_path, output_path = argv[0], argv[1]

with open(input_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

positions = data['positions']
normals = data['normals']
uvs = data['uvs']
indices = data['indices']
joint_indices = data['joints']
joint_weights = data['weights']
joint_sets = int(data['jointSets'])
max_influences = joint_sets * 4
protect_mask = data.get('protectMask', [])
target_triangles = int(data['targetTriangles'])
compute_tangents = bool(data.get('computeTangents', False))

num_verts = len(positions) // 3
num_tris = len(indices) // 3

bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('Lod2Decimate')
verts = [(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) for i in range(num_verts)]
faces = [(indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]) for i in range(num_tris)]
me.from_pydata(verts, [], faces)

uv_layer = me.uv_layers.new(name='UVMap')
loop_uvs = uv_layer.data
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        loop_uvs[li].uv = (uvs[vi * 2], 1.0 - uvs[vi * 2 + 1])

# Store split vertex normals so seam normals survive welding where identical
if len(normals) == num_verts * 3:
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    vert_normals = [(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) for i in range(num_verts)]
    me.normals_split_custom_set_from_vertices(vert_normals)

obj = bpy.data.objects.new('Lod2DecimateObj', me)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj

# Create vertex groups for joints
used_joints = sorted({j for v in range(num_verts) for k in range(max_influences)
                      if (j := joint_indices[v * max_influences + k]) is not None
                      and joint_weights[v * max_influences + k] > 0.0})
vgroups = {j: obj.vertex_groups.new(name=f'j_{j}') for j in used_joints}
for v in range(num_verts):
    for k in range(max_influences):
        w = joint_weights[v * max_influences + k]
        if w > 0.0:
            j = joint_indices[v * max_influences + k]
            vgroups[j].add([v], float(w), 'REPLACE')

pin_verts = [v for v, flag in enumerate(protect_mask) if flag]
if pin_verts:
    pin_group = obj.vertex_groups.new(name='__pin_hand')
    pin_group.add(pin_verts, 1.0, 'REPLACE')

# Weld coincident split seam vertices in BMesh while keeping face loop UVs and vertex weights
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(me)
bm.free()
me.update()

current_tris = len(me.polygons)
pin_count = len(pin_verts)
use_pin = bool(pin_verts) and (pin_count < num_verts * 0.35)

# Apply iterative collapse to hit close to target_triangles
ratio = max(0.05, min(0.99, target_triangles / max(1, current_tris)))
mod = obj.modifiers.new(name='Decimate', type='DECIMATE')
mod.decimate_type = 'COLLAPSE'
mod.ratio = ratio
mod.use_collapse_triangulate = True
if use_pin:
    mod.vertex_group = '__pin_hand'
    mod.invert_vertex_group = True

bpy.ops.object.modifier_apply(modifier=mod.name)

# Safety second pass if protected vertex group constrained the first collapse ratio
after_pass1 = len(obj.data.polygons)
if after_pass1 > target_triangles * 1.12 and use_pin:
    # Adjust ratio on unprotected region to approach target_triangles closely
    ratio2 = max(0.08, min(0.95, target_triangles / max(1, after_pass1)))
    mod2 = obj.modifiers.new(name='Decimate2', type='DECIMATE')
    mod2.decimate_type = 'COLLAPSE'
    mod2.ratio = ratio2
    mod2.use_collapse_triangulate = True
    mod2.vertex_group = '__pin_hand'
    mod2.invert_vertex_group = True
    bpy.ops.object.modifier_apply(modifier=mod2.name)

tri_mod = obj.modifiers.new(name='Triangulate', type='TRIANGULATE')
tri_mod.quad_method = 'BEAUTY'
tri_mod.ngon_method = 'BEAUTY'
bpy.ops.object.modifier_apply(modifier=tri_mod.name)

out_me = obj.data
out_me.polygons.foreach_set('use_smooth', [True] * len(out_me.polygons))
out_me.update()
if compute_tangents and out_me.uv_layers:
    out_me.calc_tangents(uvmap=out_me.uv_layers[0].name)

uv_data = out_me.uv_layers[0].data if out_me.uv_layers else None

# Build vertex groups lookup: group index -> bone joint index
group_to_joint = {}
for g in obj.vertex_groups:
    if g.name.startswith('j_'):
        group_to_joint[g.index] = int(g.name[2:])

vert_skins = []
for v in out_me.vertices:
    pairs = []
    for g_el in v.groups:
        if g_el.group in group_to_joint and g_el.weight > 1e-6:
            pairs.append((group_to_joint[g_el.group], float(g_el.weight)))
    pairs.sort(key=lambda pair: pair[1], reverse=True)
    pairs = pairs[:max_influences]
    total = sum(w for _, w in pairs)
    if total > 1e-6:
        pairs = [(j, w / total) for j, w in pairs]
    else:
        pairs = [(0, 1.0)]
    while len(pairs) < max_influences:
        pairs.append((0, 0.0))
    vert_skins.append(pairs)

vertex_map = {}
out_positions = []
out_normals = []
out_uvs = []
out_tangents = []
out_joints = []
out_weights = []
out_indices = []

for poly in out_me.polygons:
    if poly.loop_total != 3:
        raise RuntimeError(f'Expected triangles after Triangulate, got {poly.loop_total}')
    for li in poly.loop_indices:
        loop = out_me.loops[li]
        vi = loop.vertex_index
        n = loop.normal
        if n.length_squared > 1e-12:
            n = n.normalized()
        else:
            n = Vector((0.0, 1.0, 0.0))
        u, v_coord = (uv_data[li].uv[0], 1.0 - uv_data[li].uv[1]) if uv_data else (0.0, 0.0)
        if compute_tangents:
            t = loop.tangent
            tsign = loop.bitangent_sign
            key = (vi, round(n.x, 4), round(n.y, 4), round(n.z, 4), round(u, 5), round(v_coord, 5),
                   round(t.x, 3), round(t.y, 3), round(t.z, 3), 1 if tsign >= 0 else -1)
        else:
            key = (vi, round(n.x, 4), round(n.y, 4), round(n.z, 4), round(u, 5), round(v_coord, 5))
        idx = vertex_map.get(key)
        if idx is None:
            idx = len(out_positions) // 3
            vertex_map[key] = idx
            co = out_me.vertices[vi].co
            out_positions.extend([float(co.x), float(co.y), float(co.z)])
            out_normals.extend([float(n.x), float(n.y), float(n.z)])
            out_uvs.extend([float(u), float(v_coord)])
            if compute_tangents:
                out_tangents.extend([float(t.x), float(t.y), float(t.z), float(tsign)])
            for j, w in vert_skins[vi]:
                out_joints.append(int(j))
                out_weights.append(float(w))
        out_indices.append(idx)

result = {
    'beforeTris': num_tris,
    'afterTris': len(out_indices) // 3,
    'vertexCount': len(out_positions) // 3,
    'jointSets': joint_sets,
    'positions': out_positions,
    'normals': out_normals,
    'uvs': out_uvs,
    'joints': out_joints,
    'weights': out_weights,
    'indices': out_indices,
}
if compute_tangents:
    result['tangents'] = out_tangents

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result, f)

print(f'DECIMATED {num_tris} -> {result["afterTris"]} tris ({result["vertexCount"]} verts, pin={use_pin})')
