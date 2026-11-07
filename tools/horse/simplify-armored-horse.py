"""Run through Blender MCP after build-armored-horse.mjs stages roundtrip.glb.
Weld geometric UV/normal duplicates while keeping per-corner UVs, then decimate.
Does not modify the review scene or the source LOD0; writes staged LOD data only.
"""
import bpy, bmesh, json, struct
from pathlib import Path
stage = Path(globals().get('ARMORED_HORSE_STAGE', 'output/armored-warhorse'))
# Read the uncompressed review GLB numerically. The glTF importer rebases a skin
# into the donor armature's rest coordinates; copying its mesh data alone would
# bake those centimetre-scale coordinates into our metre-scale runtime asset.
raw = (stage/'roundtrip.glb').read_bytes()
json_length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+json_length]); binary = raw[28+json_length:]
def attribute(index):
    ac = doc['accessors'][index]; view = doc['bufferViews'][ac['bufferView']]
    width = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[ac['type']]
    fmt = {5123:'H',5125:'I',5126:'f'}[ac['componentType']]; size = struct.calcsize(fmt)
    offset = view.get('byteOffset',0)+ac.get('byteOffset',0); stride = view.get('byteStride',width*size)
    return [struct.unpack_from('<'+fmt*width,binary,offset+i*stride) for i in range(ac['count'])]
source = next(m for m in doc['meshes'] if m['name']=='armored_horse_lod0')['primitives'][0]
attrs = source['attributes']; positions = attribute(attrs['POSITION']); normals = attribute(attrs['NORMAL'])
uvs = attribute(attrs['TEXCOORD_0']); joints = attribute(attrs['JOINTS_0']); weights = attribute(attrs['WEIGHTS_0'])
indices = [v[0] for v in attribute(source['indices'])]
mesh = bpy.data.meshes.new('armored_lod_source')
mesh.from_pydata([(p[0],-p[2],p[1]) for p in positions],[],[indices[i:i+3] for i in range(0,len(indices),3)])
mesh.normals_split_custom_set_from_vertices([(n[0],-n[2],n[1]) for n in normals])
uv_layer = mesh.uv_layers.new(name='source_uv')
for loop in mesh.loops:
    uv = uvs[loop.vertex_index]; uv_layer.data[loop.index].uv = (uv[0],1-uv[1])
ob = bpy.data.objects.new('armored_lod_source',mesh); bpy.context.scene.collection.objects.link(ob)
owned = {ob}
for node in doc['skins'][0]['joints']: ob.vertex_groups.new(name=doc['nodes'][node]['name'])
for i,(js,ws) in enumerate(zip(joints,weights)):
    for j,w in zip(js,ws):
        if w>1e-7: ob.vertex_groups[j].add([i],w,'REPLACE')
# Bake the original PBR surfaces into new LOD UVs; otherwise collapse interpolates
# across disconnected source atlas islands and produces metallic checkerboards.
high = ob.copy(); high.data = ob.data.copy(); bpy.context.scene.collection.objects.link(high); owned.add(high)
high_material = bpy.data.materials.new('armored_bake_source'); high_material.use_nodes = True
high.data.materials.append(high_material)
scene = bpy.context.scene; original_engine = scene.render.engine
try: scene.render.engine = 'CYCLES'
except TypeError as error: raise RuntimeError('Cycles is required for source-preserving LOD texture baking') from error
scene.cycles.samples = 1
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = .06; scene.render.bake.max_ray_distance = .18; scene.render.bake.margin = 3
scene.render.bake.use_clear = True

def bake_lod(candidate, lod):
    bpy.ops.object.select_all(action='DESELECT'); candidate.select_set(True); bpy.context.view_layer.objects.active = candidate
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.003, area_weight=1.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    target = bpy.data.materials.new('armored_bake_target'); target.use_nodes = True
    candidate.data.materials.clear(); candidate.data.materials.append(target)
    tex = target.node_tree.nodes.new('ShaderNodeTexImage'); target.node_tree.nodes.active = tex
    for name in ['base-color','metallic-roughness','normal']:
        nodes = high_material.node_tree.nodes; nodes.clear(); links = high_material.node_tree.links
        output = nodes.new('ShaderNodeOutputMaterial'); source_tex = nodes.new('ShaderNodeTexImage')
        source_tex.image = bpy.data.images.load(str(stage/(name+'.jpg')),check_existing=True)
        if name!='base-color': source_tex.image.colorspace_settings.name='Non-Color'
        if name=='normal':
            shader = nodes.new('ShaderNodeBsdfPrincipled'); normal = nodes.new('ShaderNodeNormalMap')
            links.new(source_tex.outputs['Color'],normal.inputs['Color']); links.new(normal.outputs['Normal'],shader.inputs['Normal'])
            links.new(shader.outputs['BSDF'],output.inputs['Surface'])
        else:
            shader = nodes.new('ShaderNodeEmission'); links.new(source_tex.outputs['Color'],shader.inputs['Color']); links.new(shader.outputs[0],output.inputs['Surface'])
        image = bpy.data.images.new('armored_lod'+str(lod)+'_'+name,2048,2048,alpha=False)
        if name!='base-color': image.colorspace_settings.name='Non-Color'
        tex.image = image
        bpy.ops.object.select_all(action='DESELECT'); high.select_set(True); candidate.select_set(True); bpy.context.view_layer.objects.active=candidate
        bpy.ops.object.bake(type='NORMAL' if name=='normal' else 'EMIT')
        image.filepath_raw = str(stage/('lod'+str(lod)+'-'+name+'.png')); image.file_format='PNG'; image.save()
        print('ARMORED_BAKED',lod,name)
    high.hide_render=True; candidate.hide_render=True
# Skin modifier stays unapplied: simplification operates in the exact exported bind space.
ob.modifiers.clear()
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
# UV/normal copies with different skin ownership must remain separate.
groups = {}
for v in ob.data.vertices:
    signature = tuple(sorted((g.group, round(g.weight, 6)) for g in v.groups if g.weight > 1e-7))
    groups.setdefault(signature, []).append(bm.verts[v.index])
for vertices in groups.values(): bmesh.ops.remove_doubles(bm, verts=vertices, dist=0.00001)
bm.to_mesh(ob.data); bm.free()
results = {}
for lod, ratio in [(1, 0.38), (2, 0.13)]:
    candidate = ob.copy(); candidate.data = ob.data.copy(); bpy.context.scene.collection.objects.link(candidate); owned.add(candidate)
    bpy.ops.object.select_all(action='DESELECT'); candidate.select_set(True); bpy.context.view_layer.objects.active = candidate
    modifier = candidate.modifiers.new('silhouette_decimation', 'DECIMATE'); modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    high.hide_render=False; candidate.hide_render=False
    bake_lod(candidate,lod)
    mesh = candidate.data; mesh.calc_loop_triangles()
    positions, normals, uvs, weights, names, indices = [], [], [], [], [], []
    for tri in mesh.loop_triangles:
        for li in tri.loops:
            loop = mesh.loops[li]; v = mesh.vertices[loop.vertex_index]; co = v.co; n = mesh.corner_normals[li].vector
            positions.extend([co.x, co.z, -co.y]); normals.extend([n.x, n.z, -n.y]); uv = mesh.uv_layers.active.data[li].uv; uvs.extend([uv.x, 1-uv.y])
            groups = sorted([(candidate.vertex_groups[g.group].name, g.weight) for g in v.groups if g.weight > 1e-5], key=lambda g:-g[1])[:4]
            total = sum(g[1] for g in groups)
            names.extend([groups[i][0] if i < len(groups) else '_rootJoint' for i in range(4)])
            weights.extend([groups[i][1]/total if i < len(groups) else 0 for i in range(4)])
            indices.append(len(indices))
    results[str(lod)] = dict(positions=positions, normals=normals, uv=uvs, weights=weights, jointNames=names, indices=indices, triangles=len(indices)//3)
    print('ARMORED_LOD', lod, len(indices)//3)
(stage/'simplified-lods.json').write_text(json.dumps(dict(skinRevision='reviewed-baked-lods-v14', sourceSha256='cd3e443eec8d404c4cc4b1b8f800ade5c6679533de1847a78ac1d7a3e4b36ad2', lods=results)))
for o in owned: bpy.data.objects.remove(o, do_unlink=True)
scene.render.engine = original_engine
