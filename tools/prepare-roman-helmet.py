"""Create source-derived LODs only; run with Blender, never reconstruct geometry."""
import bpy, sys, json
from pathlib import Path
source, output = map(Path, sys.argv[sys.argv.index('--')+1:])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(meshes) == 1, 'Expected the supplied single-mesh helmet'
original = meshes[0]
# Weld coincident UV-split vertices; Blender preserves the UVs per face corner.
bpy.context.view_layer.objects.active = original
bpy.ops.object.select_all(action='DESELECT'); original.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.000001); bpy.ops.object.mode_set(mode='OBJECT')
original.data.calc_loop_triangles()
source_triangles = len(original.data.loop_triangles)
# Re-bake the authored atlas onto each LOD so UV islands do not smear after collapse.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=1
scene.cycles.device='CPU'
source_material=original.data.materials[0]
source_material.use_nodes=True
nodes=source_material.node_tree.nodes
texture=next(n for n in nodes if n.type=='TEX_IMAGE' and n.image and n.image.colorspace_settings.name=='sRGB')
output_node=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
emission=nodes.new('ShaderNodeEmission')
source_material.node_tree.links.new(texture.outputs['Color'],emission.inputs['Color'])
source_material.node_tree.links.new(emission.outputs[0],output_node.inputs['Surface'])
rows=[]
for lod, target in enumerate([11000, 3800, 950]):
    obj = original.copy(); obj.data = original.data.copy(); bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Source-preserving LOD', 'DECIMATE'); modifier.ratio = target/source_triangles
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()
    obj.data.materials.clear()
    material=bpy.data.materials.new(f'Helmet_LOD{lod}');material.use_nodes=True;obj.data.materials.append(material)
    image=bpy.data.images.new(f'Helmet_source_bake_{lod}',width=[2048,1024,512][lod],height=[2048,1024,512][lod])
    node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;material.node_tree.nodes.active=node
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.151917, island_margin=0.012);bpy.ops.object.mode_set(mode='OBJECT')
    original.select_set(True)
    bpy.ops.object.bake(type='EMIT',use_selected_to_active=True,cage_extrusion=0.012,max_ray_distance=0.06,margin=8)
    image.filepath_raw=str((output/f'source-bake{lod}.png').resolve());image.file_format='PNG';image.save()
    original.select_set(False)
    obj.data.materials.clear()
    bpy.ops.export_scene.gltf(filepath=str((output/f'lod{lod}.glb').resolve()), use_selection=True, export_format='GLB', export_animations=False)
    rows.append({'lod':lod, 'triangles':len(obj.data.loop_triangles)})
    bpy.data.objects.remove(obj, do_unlink=True)
(output/'lod-report.json').write_text(json.dumps(rows, indent=2)+'\n')
