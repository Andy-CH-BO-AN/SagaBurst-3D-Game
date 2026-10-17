#!/usr/bin/env python3
"""Normalize the hash-locked, already-rigged Meshy Bandit without replacing its mesh.

blender -b --python-exit-code 1 --python tools/build-meshy-bandit.py -- \
  output/meshy-bandit/source.glb output/meshy-bandit

Builds body-lod0/1/2.glb with the original 23 joints and calibrated sockets.
The companion retarget/package step owns clips and the existing Bandit hammer.
LOD2 uses a reviewed ~4K budget: the nominal 2K simplification collapsed its face
and hands. Preserve source facial/neck/hand features and silhouette endpoints.
Source downloads, rest-pose measurements and renders remain outside publication.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

SOURCE_SHA256 = 'fcc975506d11b7ecd2e3eaadee55f0b28ae280e05bb814bafa5e75e8588cef64'
HEIGHT = 1.75
ALIASES = {'mixamorig:Hips': 'hips', 'mixamorig:Spine': 'spine',
           'mixamorig:Spine1': 'chest', 'mixamorig:Spine2': 'upper_chest',
           'mixamorig:Neck': 'neck', 'mixamorig:Head': 'head', 'headfront': 'headfront'}
for side, suffix in [('Left', 'l'), ('Right', 'r')]:
    for old, new in [('Shoulder', 'clavicle'), ('Arm', 'upper_arm'),
                     ('ForeArm', 'lower_arm'), ('Hand', 'hand'),
                     ('UpLeg', 'upper_leg'), ('Leg', 'lower_leg'),
                     ('Foot', 'foot'), ('ToeBase', 'toe')]:
        ALIASES[f'mixamorig:{side}{old}'] = f'{new}_{suffix}'


def numbers(v):
    return [float(x) for x in v]


def gltf_vector(v):
    return [float(v.x), float(v.z), float(-v.y)]


def bounds(points):
    return [[min(p[k] for p in points) for k in range(3)],
            [max(p[k] for p in points) for k in range(3)]]


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def read_glb(path):
    raw = path.read_bytes()
    assert raw[:4] == b'glTF'
    length = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+length]), raw[28+length:]


def accessor(doc, binary, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    width = np.dtype(dtype).itemsize * components
    return np.ndarray((a['count'], components), dtype=dtype, buffer=binary,
                      offset=offset, strides=(view.get('byteStride', width), np.dtype(dtype).itemsize)).copy()


def normalize_weights(obj):
    groups = {group.index: group for group in obj.vertex_groups}
    maximum_error = 0.0
    for vertex in obj.data.vertices:
        weights = sorted([(g.group, g.weight) for g in vertex.groups if g.weight > 0],
                         key=lambda entry: (-entry[1], entry[0]))[:4]
        total = sum(weight for _, weight in weights)
        if total <= 0:
            raise ValueError(f'Unweighted vertex {vertex.index}')
        for group in list(vertex.groups):
            groups[group.group].remove([vertex.index])
        for index, weight in weights:
            groups[index].add([vertex.index], weight / total, 'REPLACE')
        maximum_error = max(maximum_error, abs(sum(g.weight for g in vertex.groups)-1))
    return maximum_error


def exported_metrics(path):
    doc, binary = read_glb(path)
    positions = []
    triangles = 0
    max_weight_error = 0.0
    max_influences = 0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            positions.extend(accessor(doc, binary, primitive['attributes']['POSITION']).tolist())
            triangles += doc['accessors'][primitive['indices']]['count'] // 3
            weights = accessor(doc, binary, primitive['attributes']['WEIGHTS_0'])
            max_weight_error = max(max_weight_error, float(np.max(np.abs(weights.sum(axis=1)-1))))
            max_influences = max(max_influences, int(np.max(np.count_nonzero(weights > 1e-8, axis=1))))
    assert max_weight_error < 1e-5
    assert len(doc['skins']) == 1 and len(doc['skins'][0]['joints']) == 23
    assert not doc.get('animations')
    assert all(max(abs(value-1) for value in node.get('scale', [1, 1, 1])) < 1e-5 for node in doc['nodes'])
    assert all(math.isfinite(value) for position in positions for value in position)
    texture_sizes = []
    for image in doc.get('images', []):
        view = doc['bufferViews'][image['bufferView']]
        png = binary[view.get('byteOffset', 0):][:view['byteLength']]
        assert png[:8] == b'\x89PNG\r\n\x1a\n'
        texture_sizes.append(list(struct.unpack_from('>II', png, 16)))
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size,
            'triangles': triangles, 'boundsGltf': bounds(positions), 'textureDimensions': texture_sizes,
            'jointCount': 23, 'maxInfluences': max_influences, 'maxWeightSumError': max_weight_error}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    args.source = args.source.resolve()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    actual_sha = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if actual_sha != SOURCE_SHA256:
        raise ValueError('Source hash mismatch. Inspect and recalibrate a new source before rebuilding.')
    source_doc, source_binary = read_glb(args.source)
    assert len(source_doc['skins']) == 1 and len(source_doc['skins'][0]['joints']) == 23
    assert {source_doc['nodes'][index]['name'] for index in source_doc['skins'][0]['joints']} == set(ALIASES)
    source_triangles = sum(source_doc['accessors'][p['indices']]['count']//3
                           for mesh in source_doc['meshes'] for p in mesh['primitives'])
    assert source_triangles == 15273

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH'
              and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers)]
    assert len(meshes) == 1
    mesh = meshes[0]
    # The glTF importer creates an Icosphere for custom bone shapes: it is not source geometry.
    for obj in list(bpy.context.scene.objects):
        if obj not in [rig, mesh]:
            bpy.data.objects.remove(obj, do_unlink=True)
    for bone in rig.pose.bones:
        bone.custom_shape = None
        bone.matrix_basis = Matrix.Identity(4)
    for obj in [rig, mesh]:
        obj.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()

    points = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
    original_bounds = bounds(points)
    scale = HEIGHT / (original_bounds[1][2]-original_bounds[0][2])
    hips = rig.matrix_world @ rig.data.bones['mixamorig:Hips'].head_local
    # Source already faces Blender -Y (exported +Z); preserve that orientation.
    normalized = Matrix.Scale(scale, 4) @ Matrix.Translation((-hips.x, -hips.y, -original_bounds[0][2]))
    mesh_transform = normalized @ mesh.matrix_world.copy()
    rig_transform = normalized @ rig.matrix_world.copy()
    expected_positions = [mesh_transform @ vertex.co for vertex in mesh.data.vertices]
    mesh.parent = None
    mesh.data.transform(mesh_transform)
    mesh.matrix_world = Matrix.Identity(4)
    rig.data.transform(rig_transform)
    rig.matrix_world = Matrix.Identity(4)
    mesh.parent = rig
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    mesh.matrix_basis = Matrix.Identity(4)
    rig.name = 'MeshyBanditRig'
    rig.data.name = 'MeshyBanditOriginal23Bones'
    mesh.name = 'Meshy_Bandit_Body'
    mesh.data.name = 'MeshyBanditSourceSurface'
    assert max((vertex.co-expected_positions[vertex.index]).length for vertex in mesh.data.vertices) < 1e-7
    for old, new in ALIASES.items():
        rig.data.bones[old].name = new
    # Imported bone tails are ~100 times too long (centimetre-root glTF heuristic).
    # Length only affects Blender display and bone parenting; retain every matrix orientation.
    next_bone = {'hips': 'spine', 'spine': 'chest', 'chest': 'upper_chest',
                 'upper_chest': 'neck', 'neck': 'head', 'head': 'headfront'}
    for side in ['l', 'r']:
        for name, child in [('clavicle', 'upper_arm'), ('upper_arm', 'lower_arm'),
                            ('lower_arm', 'hand'), ('upper_leg', 'lower_leg'),
                            ('lower_leg', 'foot'), ('foot', 'toe')]:
            next_bone[f'{name}_{side}'] = f'{child}_{side}'
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:
        if bone.name in next_bone:
            length = (rig.data.edit_bones[next_bone[bone.name]].head-bone.head).length
        else:
            length = .13 if bone.name.startswith('hand_') else .07
        bone.length = length
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    assert len(rig.data.bones) == 23
    normalize_weights(mesh)
    grip_path = Path(__file__).resolve().parent / 'lib' / 'meshy-bandit-grip.py'
    grip_spec = importlib.util.spec_from_file_location('meshy_bandit_grip', grip_path)
    grip_module = importlib.util.module_from_spec(grip_spec)
    grip_spec.loader.exec_module(grip_module)
    grip_audit = grip_module.tighten_right_hand(mesh, rig)

    # Preserve the original atlas; remove the erroneous duplicate albedo emission and metal default.
    source_image = next(node.image for mat in mesh.data.materials for node in mat.node_tree.nodes
                        if node.type == 'TEX_IMAGE' and node.image)
    source_image.colorspace_settings.name = 'sRGB'
    original_pixels = np.array(source_image.pixels[:], dtype=np.float32)
    original_size = tuple(source_image.size)
    mat = mesh.data.materials[0]
    mat.name = 'Meshy_Bandit_Cloth_Leather'
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = source_image
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = .88
    bsdf.inputs['IOR'].default_value = 1.45
    bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Emission Strength'].default_value = 0
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    mat.use_backface_culling = False

    socket_audit = {}
    def socket(name, parent, local_position):
        bone = rig.data.bones[parent]
        obj = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(obj)
        obj.empty_display_type = 'PLAIN_AXES'
        obj.empty_display_size = .03
        obj.parent = rig
        obj.parent_type = 'BONE'
        obj.parent_bone = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        # Blender attaches objects to the bone tail; glTF attaches to its head.
        obj.matrix_basis = Matrix.Translation((0, -bone.length, 0)) @ Matrix.Translation(local_position)
        obj['binding'] = 'source-calibrated'
        world = bone.matrix_local @ Vector(local_position)
        socket_audit[name] = {'parent': parent, 'boneLocalPosition': numbers(local_position),
                              'worldRestGltf': gltf_vector(world)}
        return obj

    for side in ['l', 'r']:
        socket(f'socket_hand_{side}', f'hand_{side}', Vector((-.015 if side == 'l' else .015, .09, 0)))
        socket(f'socket_foot_{side}', f'foot_{side}', Vector((0, 0, 0)))
        foot = rig.data.bones[f'foot_{side}']
        foot_groups = {mesh.vertex_groups[f'{name}_{side}'].index for name in ['foot', 'toe']}
        foot_points = [v.co for v in mesh.data.vertices
                       if sum(g.weight for g in v.groups if g.group in foot_groups) > .5]
        sole_z = min(p.z for p in foot_points)
        lowest = [p for p in foot_points if p.z < sole_z + .006]
        center = sum(lowest, Vector()) / len(lowest)
        center.z = sole_z
        socket(f'sole_{side}', f'foot_{side}', foot.matrix_local.inverted() @ center)
    socket('socket_head', 'head', Vector((0, 0, 0)))
    socket('socket_pelvis', 'hips', Vector((0, 0, 0)))
    chest = rig.data.bones['chest']
    back_world = Vector((chest.head_local.x, .12, chest.head_local.z))
    socket('socket_back', 'chest', chest.matrix_local.inverted() @ back_world)
    bpy.context.view_layer.update()

    bone_audit = {}
    for bone in rig.data.bones:
        rotation = bone.matrix_local.to_3x3()
        bone_audit[bone.name] = {'parent': bone.parent.name if bone.parent else None,
                               'headGltf': gltf_vector(bone.head_local),
                               'matrixWorldBlender': [numbers(row) for row in bone.matrix_local],
                               'localAxesWorldGltf': {name: gltf_vector(rotation @ axis)
                                                     for name, axis in [('x', Vector((1, 0, 0))),
                                                                        ('y', Vector((0, 1, 0))),
                                                                        ('z', Vector((0, 0, 1)))]}}
    hand_audit = {}
    for side in ['l', 'r']:
        bone = rig.data.bones[f'hand_{side}']
        group = mesh.vertex_groups[f'hand_{side}'].index
        hand_points = [bone.matrix_local.inverted() @ vertex.co for vertex in mesh.data.vertices
                       if sum(g.weight for g in vertex.groups if g.group == group) > .5]
        hand_audit[side] = {'majorityWeightedVertexCount': len(hand_points),
                            'boundsBoneLocal': bounds(hand_points),
                            'centroidBoneLocal': numbers(sum(hand_points, Vector())/len(hand_points)),
                            'gripBoneLocal': [-.015 if side == 'l' else .015, .09, 0],
                            'shapeMode': 'static-source-surface-partial-C-grip' if side == 'r' else 'source-open-hand-no-finger-joints'}
    base_mesh = mesh.data.copy()
    metrics = {}
    for lod, size, target in [(0, 2048, 15273), (1, 1024, 6000), (2, 512, 4000)]:
        mesh.data = base_mesh.copy()
        if lod:
            # Weld coincident UV-split vertices only on reduced LODs. UVs remain per face corner.
            bm = bmesh.new()
            bm.from_mesh(mesh.data)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
            bm.to_mesh(mesh.data)
            bm.free()
            mesh.data.validate(clean_customdata=True)
            mesh.data.update()
            triangle_count = sum(len(p.vertices)-2 for p in mesh.data.polygons)
            activate(mesh)
            modifier = mesh.modifiers.new('SourceMeshDecimation', 'DECIMATE')
            modifier.ratio = target / triangle_count
            modifier.use_collapse_triangulate = True
            # Zero influence protects measured sole, crown and toe-tip silhouette points.
            # This retains source endpoints while permitting the reviewed ~4K LOD2 budget.
            protected = mesh.vertex_groups.new(name='LOD_landmark_protection')
            hand_groups = {mesh.vertex_groups[name].index for name in ['hand_l', 'hand_r']}
            for vertex in mesh.data.vertices:
                at_landmark = (vertex.co.z < .008 or vertex.co.z > 1.745
                               or (vertex.co.z < .16 and vertex.co.y < -.15))
                at_feature = lod == 2 and (((vertex.co.z > 1.46 and vertex.co.y < -.035) or (1.34 < vertex.co.z < 1.48 and abs(vertex.co.x) < .08))
                              or sum(g.weight for g in vertex.groups if g.group in hand_groups) > .45)
                weight = 0.0 if at_landmark or at_feature else 1.0
                protected.add([vertex.index], weight, 'REPLACE')
            modifier.vertex_group = protected.name
            modifier.vertex_group_factor = 100.0
            bpy.ops.object.modifier_move_up(modifier=modifier.name)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            mesh.vertex_groups.remove(mesh.vertex_groups['LOD_landmark_protection'])
            mesh.data.validate(clean_customdata=True)
            mesh.data.update()
        normalize_weights(mesh)
        source_image.scale(*original_size)
        source_image.pixels.foreach_set(original_pixels)
        source_image.scale(min(size, original_size[0]), min(size, original_size[1]))
        source_image.filepath_raw = str(args.out / f'body-atlas-lod{lod}.png')
        source_image.file_format = 'PNG'
        source_image.pack()
        for obj in bpy.context.scene.objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        filename = args.out / f'body-lod{lod}.glb'
        bpy.ops.export_scene.gltf(filepath=str(filename), export_format='GLB',
                                  use_selection=True, export_animations=False, export_skins=True,
                                  export_all_influences=False, export_yup=True,
                                  export_apply=False, export_extras=True, export_image_format='AUTO')
        metrics[f'lod{lod}'] = exported_metrics(filename)
        assert abs(metrics[f'lod{lod}']['triangles']-target) <= (0 if lod == 0 else target * .05)
        assert metrics[f'lod{lod}']['textureDimensions'] == [[size, size]]
    audit = {'sourceSha256': actual_sha, 'sourceTriangles': source_triangles,
             'sourceBoundsBlenderM': original_bounds, 'uniformScaleAfterSourceRoot': scale,
             'sourceRootScaleBaked': .01, 'heightTargetM': HEIGHT,
             'lodTargetTriangles': {'lod0': 15273, 'lod1': 6000, 'lod2': 4000},
             'lod2BudgetException': {'nominal': 2000, 'reviewedTarget': 4000,
                                     'reason': '2K collapsed face, hands and torso; 4K with face, neck and hand protection passed front/side/back rest inspection.'},
             'lodLandmarkProtection': 'Source sole below .008m, crown above 1.745m, toe tip forward .15m below ankle .16m',
             'normalizationMatrixBlender': [numbers(row) for row in normalized],
             'coordinateConvention': '+Y up, +Z forward, anatomical right -X',
             'boneAliasesSourceToCanonical': ALIASES, 'bones': bone_audit,
             'sockets': socket_audit, 'hands': hand_audit, 'staticRightHandGrip': grip_audit, 'lods': metrics,
             'materials': {'baseColor': 'original Meshy atlas', 'metallic': 0,
                           'roughness': .88, 'emission': 0},
             'limitations': ['Source has no independent finger bones; right grip is a static partial C curl, left hand remains authored open.',
                             'Source thumb/hammer overlap remains; static surface tightening is not a fully articulated closed fist.',
                             'Only neutral body preparation here; final retargeted action QA is separate.']}
    (args.out / 'body-build-metrics.json').write_text(json.dumps(audit, indent=2)+'\n')
    print(json.dumps({'lods': metrics, 'hands': hand_audit}, indent=2))


if __name__ == '__main__':
    main()
