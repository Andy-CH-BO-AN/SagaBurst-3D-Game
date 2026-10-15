"""Geometry-only LOD export; never re-export source rig or animation.
Merge coincident mesh vertices before collapse because source UV islands are
geometrically disconnected. Loop UVs and material partitions remain authored.
"""
import bpy, bmesh, json, sys
from mathutils import Vector
source, output = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
result = {}
def xyz(v): return [v.x, v.z, -v.y]
for original in list(bpy.data.objects):
 if original.type != 'MESH': continue
 result[original.name] = {}
 for level, ratio in [(1, .4), (2, .14 if 'Varangian' not in source else .12)]:
  obj = original.copy(); obj.data = original.data.copy(); bpy.context.collection.objects.link(obj)
  for modifier in list(obj.modifiers): obj.modifiers.remove(modifier)
  bm = bmesh.new(); bm.from_mesh(obj.data)
  bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
  bm.to_mesh(obj.data); bm.free()
  bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
  modifier=obj.modifiers.new('LOD surface collapse', 'DECIMATE'); modifier.ratio=ratio; modifier.use_collapse_triangulate=True
  bpy.ops.object.modifier_apply(modifier=modifier.name)
  obj.data.calc_loop_triangles()
  groups={g.index:g.name for g in obj.vertex_groups}
  partitions={}
  for tri in obj.data.loop_triangles:
   p=partitions.setdefault(tri.material_index, {'vertices':[], 'indices':[]})
   for loop_index in tri.loops:
    loop=obj.data.loops[loop_index]; vertex=obj.data.vertices[loop.vertex_index]
    normal=obj.data.corner_normals[loop_index].vector
    uv=obj.data.uv_layers.active.data[loop_index].uv if obj.data.uv_layers.active else Vector((0,0))
    weights=[[groups[g.group], g.weight] for g in vertex.groups if g.weight>0]
    p['indices'].append(len(p['vertices']));p['vertices'].append([xyz(vertex.co),xyz(normal),[uv.x,1-uv.y],weights])
  result[original.name][str(level)]={'primitives':[partitions[k] for k in sorted(partitions)]}
  bpy.data.objects.remove(obj,do_unlink=True)
with open(output,'w') as f: json.dump(result,f,separators=(',',':'))
