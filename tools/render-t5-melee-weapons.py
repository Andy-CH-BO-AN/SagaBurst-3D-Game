"""Offline source/final front, side and back review with identical framing.

Run the asset builder first, then:
blender -b -t 6 --python tools/render-t5-melee-weapons.py
Renders go to ignored output/t5-melee-assets/. These are asset comparisons,
not game-camera, character-grip, combat, or GPU performance validation.
"""
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/t5-melee-assets'


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj.matrix_world @ vertex.co
            for obj in bpy.context.scene.objects if obj.type == 'MESH'
            for vertex in obj.data.vertices]


def studio(center, height):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.world = bpy.data.worlds.new('Neutral asset-review studio')
    scene.world.color = (.3, .3, .3)
    for offset, energy, size in [((2, -4, 5), 650, 4),
                                 ((-3, -1, 1), 400, 3),
                                 ((2, 4, 3), 850, 3)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(offset) * height)
        light = bpy.context.object
        light.data.energy = energy * height ** 2
        light.data.size = size * height
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = height * 1.12
    scene.camera = camera
    scene.render.resolution_x = 600
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    # Alpha permits an objective silhouette comparison without guessing colour.
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    return scene, camera


for name in ['sword', 'axe', 'lance']:
    before = OUT / f'{name}-before.glb'
    points = load(before)
    low = Vector([min(point[i] for point in points) for i in range(3)])
    high = Vector([max(point[i] for point in points) for i in range(3)])
    center, height = (low + high) * .5, (high - low).z
    for version, path in [('before', before),
                          ('after', ROOT / f'public/models/weapons/t5/{name}.glb')]:
        load(path)
        scene, camera = studio(center, height)
        for view, direction in [('front', (0, -1, 0)),
                                ('side', (1, 0, 0)), ('back', (0, 1, 0))]:
            camera.location = center + Vector(direction) * height * 3
            camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(OUT / f'{name}-{version}-{view}.png')
            bpy.ops.render.render(write_still=True)
