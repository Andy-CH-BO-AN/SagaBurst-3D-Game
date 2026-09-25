"""Build the original low-poly Black Cat/Corgi mount GLBs with Blender 5.x.

Run: blender -b --python tools/build_animal_mounts.py
All coordinates below are game metres: +Y up, +Z forward.
"""

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


OUT = Path(__file__).resolve().parents[1] / 'public/models/mounts/v1'
TARGETS = (11000, 4300, 1500)

# Black Cat v1 silhouette review uses the supplied reference-sheet dimensions.
# Keep these values literal for now; horse-scale enlargement comes after the
# feline anatomy/silhouette is approved in the mount studio.
CAT_SHOULDER_HEIGHT = .85
CAT_SADDLE_HEIGHT = .94
CAT_SADDLE_WIDTH = .40
CAT_CAMERA_HEIGHT = 1.30


def v(point):
    x, y, z = point
    return (x, -z, y)


def material(name, color, roughness=0.86, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    pbr = next((node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if pbr is None:
        pbr = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(pbr.outputs['BSDF'], output.inputs['Surface'])
    pbr.inputs['Base Color'].default_value = (*color, 1)
    pbr.inputs['Roughness'].default_value = roughness
    pbr.inputs['Metallic'].default_value = metallic
    return mat


def sphere(name, center, radius, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=v(center))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (radius[0], radius[2], radius[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def segment(name, a, b, radius_a, radius_b, vertices=14):
    aa, bb = Vector(v(a)), Vector(v(b))
    delta = bb - aa
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_a, radius2=radius_b, depth=delta.length, location=(aa + bb) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def ear(name, x, base_y, z, half_width, height, depth):
    pts = [
        (x - half_width, base_y, z - depth), (x + half_width, base_y, z - depth),
        (x - half_width * 0.85, base_y, z + depth), (x + half_width * 0.85, base_y, z + depth),
        (x - half_width * 0.38, base_y + height * 0.68, z),
        (x + half_width * 0.38, base_y + height * 0.68, z),
        (x, base_y + height, z - depth * 0.2),
    ]
    faces = [(0, 1, 3, 2), (0, 4, 6, 5, 1), (2, 3, 5, 6, 4), (0, 2, 4), (1, 5, 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([v(p) for p in pts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def sculpt(kind):
    cat = kind == 'black_cat'
    parts = []
    def s(name, center, radius): parts.append(sphere(name, center, radius))
    def seg(name, a, b, ra, rb): parts.append(segment(name, a, b, ra, rb))

    if cat:
        # Reference-sheet silhouette (metres): shoulder 0.85, overall height
        # 1.05, body length about 1.55, chest width 0.36.  The priority of
        # this pass is to read unmistakably as a cat before scaling it up.
        s('ribcage', (0, .58, .08), (.18, .27, .43))
        s('chest_keel', (0, .50, .39), (.16, .20, .24))
        s('waist', (0, .57, -.28), (.145, .18, .26))
        s('pelvis', (0, .60, -.47), (.17, .22, .27))
        s('haunch', (0, .59, -.54), (.19, .24, .25))

        # Thin, tapered feline neck; never a straight cylinder between torso
        # and head.
        seg('neck_base', (0, .70, .46), (0, .79, .59), .115, .095)
        seg('neck_upper', (0, .78, .58), (0, .84, .66), .095, .078)

        # Compact domestic-cat head: broad cheeks, short muzzle, small nose.
        s('skull', (0, .86, .66), (.075, .075, .08))
        s('forehead', (0, .90, .64), (.068, .055, .065))
        for side in (-1, 1):
            s('cheek', (side * .052, .83, .72), (.045, .038, .045))
            s('whisker_pad', (side * .030, .805, .758), (.035, .026, .034))
        s('jaw', (0, .785, .745), (.062, .025, .050))
        for side in (-1, 1):
            # Ear bases are sunk into the skull so the ears grow from the head
            # instead of looking like detached spikes.
            parts.append(ear('feline_ear', side * .055, .92, .65, .035, .13, .025))
    else:
        # Long deep corgi torso, with a horse-width back at the seat.
        s('long_ribcage', (0, 1.14, -.22), (.365, .43, 1.03))
        s('waist', (0, 1.13, -.69), (.34, .38, .61))
        s('shoulders', (0, 1.16, .61), (.43, .46, .50))
        s('haunch', (0, 1.13, -1.22), (.44, .42, .45))
        s('deep_chest', (0, 1.01, .82), (.36, .43, .35))
        s('ruff', (0, 1.43, 1.02), (.34, .35, .34))
        s('skull', (0, 1.65, 1.38), (.37, .29, .33))
        for side in (-1, 1):
            s('corgi_cheek', (side * .21, 1.55, 1.53), (.17, .18, .17))
            parts.append(ear('corgi_ear', side * .255, 1.83, 1.23, .17, .35, .085))
        s('short_broad_muzzle', (0, 1.54, 1.65), (.255, .145, .23))
        s('jaw', (0, 1.43, 1.61), (.22, .09, .20))

    leg_x = .115 if cat else .365
    front_z = .47 if cat else .68
    rear_z = -.52 if cat else -1.23
    for side in (-1, 1):
        x = side * leg_x
        if cat:
            # Strong shoulder / thigh, narrow wrist / hock, compact paws.
            # This is the key feline read from the reference sheet.
            s('front_shoulder', (x, .63, .46), (.085, .18, .11))
            seg('front_upper', (x, .62, .47), (x, .37, .49), .065, .050)
            seg('front_lower', (x, .36, .49), (x, .12, .54), .047, .033)
            s('front_paw', (x, .055, .585), (.045, .035, .0525))

            # Cat hind leg zig-zag: hip -> forward knee -> rear hock -> paw.
            s('rear_thigh', (x, .60, -.52), (.095, .18, .12))
            seg('rear_upper', (x, .61, -.55), (x, .41, -.34), .075, .055)
            seg('rear_hock', (x, .40, -.35), (x, .20, -.62), .052, .038)
            seg('rear_lower', (x, .19, -.61), (x, .10, -.48), .036, .029)
            s('rear_paw', (x, .055, -.425), (.045, .035, .0525))
        else:
            s('front_shoulder', (x, 1.10, front_z), (.275, .38, .31))
            s('front_upper', (x, .80, .70), (.215, .34, .23))
            s('front_lower', (x, .36, .75), (.165, .30, .18))
            s('front_paw', (x, .12, .92), (.23, .12, .28))
            s('rear_thigh', (x, .98, rear_z), (.31, .38, .34))
            s('rear_hock', (x, .55, rear_z - .10), (.20, .31, .20))
            s('rear_lower', (x, .31, rear_z), (.16, .27, .17))
            s('rear_paw', (x, .12, rear_z + .13), (.23, .12, .27))

    if cat:
        seg('tail_base', (0, .62, -.73), (0, .52, -.92), .055, .048)
        seg('tail_middle', (0, .52, -.91), (0, .36, -1.18), .048, .035)
        seg('tail_tip', (0, .36, -1.17), (0, .32, -1.48), .035, .022)
        s('tail_end', (0, .33, -1.53), (.025, .025, .035))
    else:
        s('docked_tail', (0, 1.35, -1.58), (.13, .13, .19))

    body = join(parts, 'animal_body_source')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # All anatomy, including the limb roots, becomes one watertight skin.
    body.data.remesh_voxel_size = .012 if cat else .027
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.voxel_remesh()
    smooth = body.modifiers.new('soft_anatomy', 'SMOOTH')
    smooth.factor = .55 if cat else 1.35
    smooth.iterations = 1 if cat else 3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    return body


def decimate(obj, target):
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if triangles > target:
        mod = obj.modifiers.new('low_poly_budget', 'DECIMATE')
        mod.ratio = target / triangles
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def armature(kind):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = f'{kind}_quadruped_rig'
    bones = arm.data.edit_bones
    bones.remove(bones[0])
    points = {}
    def add(name, parent, point, end):
        bone = bones.new(name)
        bone.head = v(point)
        bone.tail = v(end)
        if parent:
            bone.parent = bones[parent]
            bone.use_connect = False
        points[name] = point
    if kind == 'black_cat':
        add('root', None, (0, 0, 0), (0, .12, 0))
        add('body', 'root', (0, .58, -.28), (0, .59, .02))
        add('chest_spine', 'body', (0, .61, .16), (0, .69, .44))
        add('neck', 'chest_spine', (0, .70, .46), (0, .81, .62))
        add('head', 'neck', (0, .84, .65), (0, .84, .79))
    else:
        add('root', None, (0, 0, 0), (0, .2, 0))
        add('body', 'root', (0, 1.16, -.4), (0, 1.16, -.1))
        add('chest_spine', 'body', (0, 1.24, .42), (0, 1.31, .70))
        add('neck', 'chest_spine', (0, 1.43, 1.00), (0, 1.58, 1.18))
        add('head', 'neck', (0, 1.65, 1.37), (0, 1.67, 1.66))
    for front in (True, False):
        for side in (-1, 1):
            label = f'{"front" if front else "rear"}_{"l" if side < 0 else "r"}'
            x = side * (.115 if kind == 'black_cat' else .365)
            parent = 'chest_spine' if front else 'body'
            if kind == 'black_cat' and front:
                add(f'{label}_upper_leg', parent, (x, .63, .46), (x, .37, .49))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .36, .49), (x, .12, .54))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .105, .54), (x, .055, .64))
            elif kind == 'black_cat':
                add(f'{label}_upper_leg', parent, (x, .61, -.55), (x, .41, -.34))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .40, -.35), (x, .20, -.62))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .12, -.49), (x, .055, -.39))
            else:
                z = .68 if front else -1.23
                add(f'{label}_upper_leg', parent, (x, 1.1, z), (x, .65, z))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .58, z), (x, .20, z + .06))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .15, z + .15), (x, .11, z + .31))
    if kind == 'black_cat':
        add('tail_base', 'body', (0, .62, -.73), (0, .52, -.92))
        add('tail_middle', 'tail_base', (0, .52, -.91), (0, .36, -1.18))
        add('tail_tip', 'tail_middle', (0, .36, -1.17), (0, .32, -1.48))
    else:
        add('tail', 'body', (0, 1.35, -1.54), (0, 1.35, -1.72))
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm, points


def influence(kind, point):
    x, y, z = point
    weights = {}
    def put(name, value): weights[name] = max(weights.get(name, 0), value)
    def clamp01(value): return max(0, min(1, value))

    if kind == 'black_cat':
        # Reference-scale feline weights.  Keep shoulders blended into the
        # chest while distal limbs become increasingly rigid toward the paw.
        chest = clamp01((z + .16) / .60)
        put('body', 1 - chest)
        put('chest_spine', chest)

        if z > .40 and y > .60:
            t = clamp01((z - .40) / .23)
            weights = {name: value * (1 - t) for name, value in weights.items()}
            put('neck', t)

        if z > .62 and y > .74:
            t = clamp01((z - .62) / .16)
            weights = {name: value * (1 - t) for name, value in weights.items()}
            put('head', t)

        if z < -.70 and abs(x) < .13 and y > .16:
            tail = 'tail_tip' if z < -1.27 else 'tail_middle' if z < -1.00 else 'tail_base'
            weights = {tail: 1}
        else:
            for front in (True, False):
                leg_z = .49 if front else -.49
                if abs(z - leg_z) > .29 or abs(x) < .045 or abs(x) > .22 or y > .72:
                    continue
                side = 'l' if x < 0 else 'r'
                prefix = f'{"front" if front else "rear"}_{side}'
                blend = clamp01((.72 - y) / .24)
                limb = f'{prefix}_paw' if y < .13 else f'{prefix}_lower_leg' if y < .40 else f'{prefix}_upper_leg'
                weights = {name: value * (1 - blend) for name, value in weights.items()}
                put(limb, blend)
    else:
        # Existing horse-scale corgi weighting remains unchanged.
        chest = clamp01((z + .12) / .75)
        put('body', 1 - chest)
        put('chest_spine', chest)
        if z > .88 and y > 1.17:
            t = clamp01((z - .88) / .35)
            put('body', (1 - chest) * (1 - t))
            put('chest_spine', chest * (1 - t))
            put('neck', t)
        if z > 1.25 and y > 1.37:
            t = clamp01((z - 1.25) / .28)
            weights = {name: value * (1 - t) for name, value in weights.items()}
            put('head', t)
        if z < -1.39 and abs(x) < .20 and y > 1.08:
            weights = {'tail': 1}
        for front in (True, False):
            leg_z = .68 if front else -1.23
            if abs(z - leg_z) > .40 or abs(x) < .20 or abs(x) > .66 or y > 1.24:
                continue
            side = 'l' if x < 0 else 'r'
            prefix = f'{"front" if front else "rear"}_{side}'
            blend = clamp01((1.24 - y) / .30)
            limb = f'{prefix}_paw' if y < .22 else f'{prefix}_lower_leg' if y < .57 else f'{prefix}_upper_leg'
            weights = {name: value * (1 - blend) for name, value in weights.items()}
            put(limb, blend)

    total = sum(weights.values())
    return {name: value / total for name, value in weights.items() if value > .001}


def bind(mesh, arm, kind, rigid=None):
    groups = {bone.name: mesh.vertex_groups.new(name=bone.name) for bone in arm.data.bones}
    for vertex in mesh.data.vertices:
        point = (vertex.co.x, vertex.co.z, -vertex.co.y)
        for name, weight in ({rigid: 1} if rigid else influence(kind, point)).items():
            groups[name].add([vertex.index], weight, 'REPLACE')
    modifier = mesh.modifiers.new('quadruped_skin', 'ARMATURE')
    modifier.object = arm
    mesh.parent = arm


def color_body(mesh, kind, coat, white):
    mesh.data.materials.clear()
    mesh.data.materials.append(coat)
    if kind == 'black_cat':
        return
    colors = mesh.data.color_attributes.new(name='coat_color', type='FLOAT_COLOR', domain='CORNER')
    pbr = next(node for node in coat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    attribute = next((node for node in coat.node_tree.nodes if node.type == 'VERTEX_COLOR'), None)
    if attribute is None:
        attribute = coat.node_tree.nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'coat_color'
    coat.node_tree.links.new(attribute.outputs['Color'], pbr.inputs['Base Color'])
    def smooth(edge0, edge1, value):
        t = max(0, min(1, (value - edge0) / (edge1 - edge0)))
        return t * t * (3 - 2 * t)
    orange = (.58, .265, .085)
    cream = (.83, .76, .64)
    for poly in mesh.data.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.data.vertices[mesh.data.loops[loop_index].vertex_index]
            x, y, z = vertex.co.x, vertex.co.z, -vertex.co.y
            chest_white = smooth(.58, .78, z) * (1 - smooth(1.30, 1.49, y)) * (1 - smooth(.31, .45, abs(x)))
            muzzle_white = smooth(1.45, 1.59, z) * (1 - smooth(1.64, 1.77, y))
            blaze = smooth(1.45, 1.58, z) * smooth(1.59, 1.68, y) * (1 - smooth(.065, .14, abs(x)))
            paws_white = (1 - smooth(.38, .56, y)) * smooth(.18, .27, abs(x))
            white_mix = max(chest_white, muzzle_white, blaze, paws_white)
            colors.data[loop_index].color = (*[orange[i] * (1 - white_mix) + cream[i] * white_mix for i in range(3)], 1)


def tack(kind, arm, materials):
    pieces = []
    def add(obj, mat, name):
        obj.name = name
        obj.data.materials.append(mat)
        bind(obj, arm, kind, rigid='body')
        pieces.append(obj)

    if kind == 'black_cat':
        # Reference sheet: ~40 cm saddle width, top of seat ~94 cm.
        pad = sphere('pad', (0, .875, -.05), (.20, .022, .25), 20, 10)
        add(pad, materials['pad'], 'saddle_pad')
        seat = sphere('seat', (0, .91, -.05), (.18, .03, .20), 20, 10)
        add(seat, materials['leather'], 'saddle_seat')
        for side in (-1, 1):
            add(segment('girth', (side * .18, .86, -.05), (side * .20, .45, -.05), .018, .018, 8), materials['leather'], 'girth')
            add(segment('stirrup', (side * .22, .47, -.05), (side * .22, .37, -.05), .045, .045, 8), materials['metal'], 'stirrup')
        add(segment('pommel', (0, .90, .11), (0, .97, .13), .035, .030, 8), materials['leather'], 'pommel')
    else:
        pad = sphere('pad', (0, 1.68, -.08), (.41, .075, .45), 20, 10)
        add(pad, materials['pad'], 'saddle_pad')
        seat = sphere('seat', (0, 1.77, -.08), (.37, .08, .39), 20, 10)
        add(seat, materials['leather'], 'saddle_seat')
        for side in (-1, 1):
            add(segment('girth', (side * .37, 1.68, -.08), (side * .40, 1.10, -.08), .035, .035, 8), materials['leather'], 'girth')
            add(segment('stirrup', (side * .42, 1.15, -.08), (side * .42, 1.05, -.08), .09, .09, 8), materials['metal'], 'stirrup')
        add(segment('pommel', (0, 1.73, .24), (0, 1.87, .27), .07, .06, 8), materials['leather'], 'pommel')
    return pieces


def features(kind, arm, mats):
    objects = []
    def add(obj, mat, name):
        obj.name = name
        obj.data.materials.append(mat)
        bind(obj, arm, kind, rigid='head')
        objects.append(obj)

    if kind == 'black_cat':
        for side in (-1, 1):
            add(sphere('eye', (side * .035, .87, .738), (.018, .016, .008), 12, 8), mats['eye'], 'eye')
            add(sphere('pupil', (side * .035, .87, .746), (.0045, .014, .004), 10, 6), mats['dark'], 'pupil')
        add(sphere('nose', (0, .81, .795), (.028, .018, .014), 10, 6), mats['dark'], 'nose')
    else:
        for side in (-1, 1):
            add(sphere('eye', (side * .19, 1.72, 1.69), (.043, .034, .022), 12, 8), mats['eye'], 'eye')
        add(sphere('nose', (0, 1.58, 1.85), (.085, .042, .035), 10, 6), mats['dark'], 'nose')
    return objects


def socket(arm, name, point):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = 'body'
    # parent inverse keeps the authored game-space point on the body bone.
    bpy.context.view_layer.update()
    obj.matrix_world.translation = Vector(v(point))
    return obj


def build(kind):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    cat = kind == 'black_cat'
    mats = {
        'coat': material(f'{kind}_coat', (.045, .048, .054) if cat else (.58, .265, .085)),
        'white': material(f'{kind}_white', (.83, .76, .64)),
        'eye': material(f'{kind}_eyes', (.86, .61, .13) if cat else (.17, .12, .08), .55),
        'dark': material(f'{kind}_nose_pupil', (.025, .024, .022)),
        'leather': material(f'{kind}_leather', (.30, .16, .09)),
        'pad': material(f'{kind}_pad', (.12, .18, .22)),
        'metal': material(f'{kind}_metal', (.60, .48, .28), .42, .4),
    }
    source = sculpt(kind)
    arm, _ = armature(kind)
    lods = []
    counts = []
    for index, target in enumerate(TARGETS):
        body = source.copy()
        body.data = source.data.copy()
        bpy.context.collection.objects.link(body)
        body.name = f'{kind}_body_lod{index}'
        counts.append(decimate(body, target))
        color_body(body, kind, mats['coat'], mats['white'])
        bind(body, arm, kind)
        group = bpy.data.objects.new(f'{kind}_lod{index}', None)
        bpy.context.collection.objects.link(group)
        body.parent = arm
        # Group marker is used by the runtime LOD adapter. Mesh nodes are moved under it in glTF.
        lods.append((group, body))
    bpy.data.objects.remove(source, do_unlink=True)
    tack_objects = tack(kind, arm, mats)
    feature_objects = features(kind, arm, mats)
    if cat:
        socket(arm, 'socket_saddle_seat', (0, CAT_SADDLE_HEIGHT, -.05))
        socket(arm, 'socket_camera', (0, CAT_CAMERA_HEIGHT, .20))
    else:
        socket(arm, 'socket_saddle_seat', (0, 1.82, -.08))
        socket(arm, 'socket_camera', (0, 2.30, .35))
    # The LOD nodes contain only their body. Small tack/facial details are shared.
    # Parenting skinned meshes to the armature preserves a single common skeleton.
    destination = OUT / kind
    destination.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(destination / 'mount.glb'), export_format='GLB', use_selection=True, export_yup=True, export_cameras=False, export_lights=False)
    manifest = {
        'schemaVersion': 1, 'id': kind, 'status': 'ready', 'file': 'mount.glb', 'forward': '+Z',
        'shoulderHeightM': CAT_SHOULDER_HEIGHT if cat else 1.62,
        'saddleHeightM': CAT_SADDLE_HEIGHT if cat else 1.82,
        'saddleWidthM': CAT_SADDLE_WIDTH if cat else .74,
        'triangles': {'lod0': counts[0], 'lod1': counts[1], 'lod2': counts[2]},
        'bones': [bone.name for bone in arm.data.bones],
        'sockets': ['socket_saddle_seat', 'socket_camera'],
        'authorship': 'Original Blender-generated sculpt and rig for this project; no third-party model or texture.',
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(kind, counts, 'GLB bytes', (destination / 'mount.glb').stat().st_size)


if __name__ == '__main__':
    for animal in ('black_cat', 'corgi'):
        build(animal)
