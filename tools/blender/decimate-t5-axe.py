"""Geometry-only reduction stage called by build-t5-melee-weapons.py.

Blender 4.3.2; the original three meshes and two material assignments survive.
This is an offline asset operation, never a character/socket adjustment.
"""
import bpy
import sys

source, destination, ratio = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
for obj in meshes:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('T5 topology reduction', 'DECIMATE')
    modifier.decimate_type = 'COLLAPSE'
    modifier.ratio = float(ratio)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.ops.export_scene.gltf(
    filepath=destination, export_format='GLB', use_selection=True,
    export_animations=False, export_yup=True, export_extras=True,
    export_image_format='AUTO', export_materials='EXPORT',
)
