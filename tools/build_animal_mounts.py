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
        # Rebuilt from scratch around a feline side silhouette:
        # deep chest -> tucked waist -> powerful pelvis, with a short muzzle,
        # tapered sloping neck, compact paws and angular feline hind legs.
        s('ribcage', (0, 1.17, .10), (.285, .40, .66))
        s('chest_keel', (0, 1.02, .48), (.245, .34, .36))
        s('waist', (0, 1.18, -.48), (.19, .255, .43))
        s('pelvis', (0, 1.17, -.90), (.285, .34, .38))
        s('haunch', (0, 1.12, -1.08), (.325, .38, .39))

        # Feline neck should rise diagonally from the shoulders and visibly taper.
        seg('neck_base', (0, 1.30, .68), (0, 1.45, .98), .205, .165)
        seg('neck_upper', (0, 1.44, .96), (0, 1.57, 1.20), .17, .135)

        # Broad, shallow cat skull with a very short muzzle.
        s('skull', (0, 1.64, 1.33), (.31, .235, .265))
        s('forehead', (0, 1.70, 1.28), (.255, .165, .205))
        for side in (-1, 1):
            s('cheek', (side * .165, 1.56, 1.46), (.135, .11, .135))
            s('whisker_pad', (side * .085, 1.50, 1.57), (.105, .075, .085))
        s('jaw', (0, 1.45, 1.50), (.175, .07, .145))
        for side in (-1, 1):
            # Compact ears with their bases buried into the skull silhouette.
            parts.append(ear('feline_ear', side * .18, 1.76, 1.20, .105, .22, .055))
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

    leg_x = .325 if cat else .365
    front_z = .68
    rear_z = -1.04 if cat else -1.23
    for side in (-1, 1):
        x = side * leg_x
        if cat:
            # Front legs stay relatively straight but taper hard toward the wrist.
            s('front_shoulder', (x, 1.12, .60), (.19, .34, .245))
            seg('front_upper', (x, .98, .63), (x, .64, .70), .15, .115)
            seg('front_lower', (x, .62, .70), (x, .20, .79), .105, .075)
            s('front_paw', (x, .105, .90), (.135, .085, .185))

            # Cat hind legs need an obvious knee/hock zig-zag, not a vertical dog leg.
            s('rear_thigh', (x, 1.05, -.92), (.24, .35, .29))
            seg('rear_upper', (x, .98, -.92), (x, .69, -.72), .16, .12)
            seg('rear_hock', (x, .68, -.73), (x, .34, -1.04), .115, .085)
            seg('rear_lower', (x, .33, -1.03), (x, .17, -.89), .08, .065)
            s('rear_paw', (x, .105, -.78), (.14, .085, .19))
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
        seg('tail_base', (0, 1.18, -1.30), (0, .98, -1.58), .105, .09)
        seg('tail_middle', (0, .99, -1.56), (0, .82, -1.93), .09, .065)
        seg('tail_tip', (0, .83, -1.91), (0, .78, -2.24), .065, .035)
        s('tail_end', (0, .78, -2.26), (.04, .045, .06))
    else:
        s('docked_tail', (0, 1.35, -1.58), (.13, .13, .19))

    body = join(parts, 'animal_body_source')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # All anatomy, including the limb roots, becomes one watertight skin.
    body.data.remesh_voxel_size = .022 if cat else .027
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
    add('root', None, (0, 0, 0), (0, .2, 0))
    add('body', 'root', (0, 1.16, -.4), (0, 1.16, -.1))
    add('chest_spine', 'body', (0, 1.24, .42), (0, 1.31, .70))
    if kind == 'black_cat':
        add('neck', 'chest_spine', (0, 1.31, .72), (0, 1.54, 1.16))
        add('head', 'neck', (0, 1.60, 1.28), (0, 1.62, 1.56))
    else:
        add('neck', 'chest_spine', (0, 1.43, 1.00), (0, 1.58, 1.18))
        add('head', 'neck', (0, 1.65, 1.37), (0, 1.67, 1.66))
    for front in (True, False):
        for side in (-1, 1):
            label = f'{"front" if front else "rear"}_{"l" if side < 0 else "r"}'
            x = side * (.325 if kind == 'black_cat' else .365)
            parent = 'chest_spine' if front else 'body'
            if kind == 'black_cat' and front:
                add(f'{label}_upper_leg', parent, (x, 1.04, .62), (x, .64, .70))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .62, .70), (x, .20, .79))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .16, .82), (x, .10, 1.00))
            elif kind == 'black_cat':
                add(f'{label}_upper_leg', parent, (x, 1.02, -.92), (x, .69, -.72))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .68, -.73), (x, .34, -1.04))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .18, -.90), (x, .10, -.76))
            else:
                z = .68 if front else -1.23
                add(f'{label}_upper_leg', parent, (x, 1.1, z), (x, .65, z))
                add(f'{label}_lower_leg', f'{label}_upper_leg', (x, .58, z), (x, .20, z + .06))
                add(f'{label}_paw', f'{label}_lower_leg', (x, .15, z + .15), (x, .11, z + .31))
    if kind == 'black_cat':
        add('tail_base', 'body', (0, 1.18, -1.30), (0, .98, -1.58))
        add('tail_middle', 'tail_base', (0, .99, -1.56), (0, .82, -1.93))
        add('tail_tip', 'tail_middle', (0, .83, -1.91), (0, .78, -2.24))
    else:
        add('tail', 'body', (0, 1.35, -1.54), (0, 1.35, -1.72))
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm, points


def influence(kind, point):
    x, y, z = point
    weights = {}
    def put(name, value): weights[name] = max(weights.get(name, 0), value)
    # Main spine blend; below the ribcage the relevant leg branch takes over.
    chest = max(0, min(1, (z + .12) / .75))
    put('body', 1 - chest)
    put('chest_spine', chest)
    if z > .88 and y > 1.17:
        t = max(0, min(1, (z - .88) / .35))
        put('body', (1 - chest) * (1 - t))
        put('chest_spine', chest * (1 - t))
        put('neck', t)
    if z > 1.25 and y > 1.37:
        t = max(0, min(1, (z - 1.25) / .28))
        weights = {name: value * (1 - t) for name, value in weights.items()}
        put('head', t)
    if kind == 'black_cat' and z < -1.30 and abs(x) < .18 and y > .65:
        tail = 'tail_tip' if z < -2.02 else 'tail_middle' if z < -1.66 else 'tail_base'
        weights = {tail: 1}
    elif kind == 'corgi' and z < -1.39 and abs(x) < .20 and y > 1.08:
        weights = {'tail': 1}
    for front in (True, False):
        leg_z = .68 if front else (-.90 if kind == 'black_cat' else -1.23)
        leg_window = .46 if kind == 'black_cat' else .40
        if abs(z - leg_z) > leg_window or abs(x) < .20 or abs(x) > .66 or y > 1.24:
            continue
        side = 'l' if x < 0 else 'r'
        prefix = f'{"front" if front else "rear"}_{side}'
        blend = max(0, min(1, (1.24 - y) / .30))
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
    cat = kind == 'black_cat'
    for side in (-1, 1):
        add(sphere('eye', (side * (.175 if cat else .19), 1.665 if cat else 1.72, 1.57 if cat else 1.69), (.068 if cat else .043, .038 if cat else .034, .009 if cat else .022), 12, 8), mats['eye'], 'eye')
        if cat:
            add(sphere('pupil', (side * .175, 1.665, 1.579), (.012, .031, .005), 10, 6), mats['dark'], 'pupil')
    add(sphere('nose', (0, 1.515 if cat else 1.58, 1.665 if cat else 1.85), (.052 if cat else .085, .034 if cat else .042, .025 if cat else .035), 10, 6), mats['dark'], 'nose')
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
        'shoulderHeightM': 1.62, 'saddleHeightM': 1.82,
        'saddleWidthM': .74,
        'triangles': {'lod0': counts[0], 'lod1': counts[1], 'lod2': counts[2]},
        'bones': [bone.name for bone in arm.data.bones],
        'sockets': ['socket_saddle_seat', 'socket_camera'],
        'authorship': 'Original Blender-generated sculpt and rig for this project; no third-party model or texture.',
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(kind, counts, 'GLB bytes', (destination / 'mount.glb').stat().st_size)


for animal in ('black_cat', 'corgi'):
    build(animal)
