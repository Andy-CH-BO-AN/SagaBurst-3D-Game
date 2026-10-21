"""Measured static right-hand curl on the hash-locked Meshy source surface.

No topology, UV, bone or weight edits. The thumb/palm and left hand are unchanged.
The tilted shaft was measured from the existing Bandit hammer after anatomical
retargeting, before its final uniform idle-height calibration. A triangle-sample
clearance guard prevents the coarse source faces from gaining penetration.
"""
import math
from collections import defaultdict
import numpy as np
from mathutils import Matrix, Vector


def tighten_right_hand(mesh, rig, angle_max=.75, model_scale=1.0):
    bone = rig.data.bones['hand_r']
    into_hand = (rig.matrix_world @ bone.matrix_local).inverted() @ mesh.matrix_world
    out_of_hand = into_hand.inverted()
    original = [vertex.co.copy() for vertex in mesh.data.vertices]
    local = np.array([list((into_hand @ position)/model_scale) for position in original])
    group = mesh.vertex_groups['hand_r'].index
    weights = [tuple((g.group, g.weight) for g in v.groups) for v in mesh.data.vertices]
    old_normals = [item.vector.copy() for item in mesh.data.corner_normals]
    start = .090
    selected = {i for i, p in enumerate(local) if p[1] > start and
                sum(w for g, w in weights[i] if g == group) > .5}
    # Weld only the analysis graph. Source UV seam copies always get identical moves.
    keys = {i: tuple(round(float(x), 6) for x in local[i]) for i in selected}
    adjacency = defaultdict(set)
    for key in keys.values():
        adjacency[key]
    for polygon in mesh.data.polygons:
        points = [keys[i] for i in polygon.vertices if i in selected]
        for a in points:
            adjacency[a].update(points)
    components = []
    while adjacency:
        pending = [next(iter(adjacency))]
        component = set()
        while pending:
            point = pending.pop()
            if point in component:
                continue
            component.add(point)
            pending.extend(adjacency.pop(point, set()) - component)
        components.append(component)
    fingers = max(components, key=len)
    thumb = [component for component in components if component is not fingers]
    assert len(fingers) >= 60 and len(thumb) == 1, 'Source hand topology changed; recalibrate grip.'
    thumb_center = np.mean(list(thumb[0]), axis=0)
    assert thumb_center[0] > .01 and thumb_center[2] < -.025
    active = {index for index, key in keys.items() if key in fingers}
    axis = np.array([.37744, -.41893, 1.0]); axis /= np.linalg.norm(axis)
    center = np.array([.036141, .115502, 0])
    changed = local.copy()
    for index in active:
        p = local[index]; d = p-center
        polar = math.atan2(p[1]-(center[1]-.41893*p[2]), p[0]-(center[0]+.37744*p[2]))
        t = max(0.0, min(1.0, (math.pi-polar-.25)/.9)) if polar > 0 else 0.0
        boundary = min(1.0, (p[1]-start)/.015)
        angle = -angle_max*t*t*(3-2*t)*boundary*boundary*(3-2*boundary)
        changed[index] = center+d*math.cos(angle)+np.cross(axis,d)*math.sin(angle)+axis*np.dot(axis,d)*(1-math.cos(angle))

    faces = np.array([list(p.vertices) for p in mesh.data.polygons if any(i in active for i in p.vertices)])
    assert faces.shape[1] == 3
    samples = np.array([[a,b,8-a-b] for a in range(9) for b in range(9-a)])/8
    def radii(points):
        delta = points-center
        return np.linalg.norm(delta-np.expand_dims(delta@axis,-1)*axis, axis=-1)
    original_clearance = radii(np.einsum('sv,fvc->fsc',samples,local[faces])).min(axis=1)
    # The source already has hidden overlap. Do not worsen it; otherwise keep 20.4mm
    # from the axis of the measured 21.1mm shaft. This is not a perfect-fist claim.
    target = np.minimum(original_clearance, .0204)
    additions = np.zeros(len(local))
    seam_groups = defaultdict(list)
    for i in active:
        seam_groups[keys[i]].append(i)
    for iteration in range(16):
        points = np.einsum('sv,fvc->fsc',samples,changed[faces])
        radial = radii(points)
        deficit = target-radial.min(axis=1)
        if max(deficit) < 1e-5:
            break
        increments = np.zeros(len(local))
        for face_index in np.where(deficit > 1e-5)[0]:
            face = faces[face_index]; sample_index = np.argmin(radial[face_index])
            normal = points[face_index,sample_index]-center
            normal -= axis*np.dot(normal,axis); normal /= np.linalg.norm(normal)
            response = 0.; movable = []
            for corner,index in enumerate(face):
                if index not in active:
                    continue
                direction = changed[index]-center
                direction -= axis*np.dot(direction,axis); direction /= np.linalg.norm(direction)
                response += samples[sample_index,corner]*np.dot(normal,direction)
                movable.append(index)
            amount = min(.003,deficit[face_index]/max(response,.2))
            for index in movable:
                increments[index] = max(increments[index],amount)
        for indices in seam_groups.values():
            amount = max(increments[index] for index in indices)
            if not amount:
                continue
            for index in indices:
                direction = changed[index]-center
                direction -= axis*np.dot(direction,axis)
                changed[index] += direction/np.linalg.norm(direction)*amount
                additions[index] += amount
    assert max(deficit) < .0001, 'Curl increases source shaft penetration; reject candidate.'
    assert max(additions) < .015, 'Curl requires excessive contact correction; reject candidate.'
    moved = {i for i in active if np.linalg.norm(changed[i]-local[i]) > 1e-7}
    for index in moved:
        mesh.data.vertices[index].co = out_of_hand @ Vector(changed[index]*model_scale)

    # Preserve unaffected custom normals. Only transformed face corners receive
    # the inverse-transpose of their actual local surface affine deformation.
    normals = [normal.copy() for normal in old_normals]
    for polygon in mesh.data.polygons:
        ids = list(polygon.vertices)
        if not any(i in moved for i in ids):
            continue
        before = [original[i] for i in ids]
        after = [mesh.data.vertices[i].co.copy() for i in ids]
        def frame(points):
            a,b = points[1]-points[0],points[2]-points[0]
            return Matrix((a,b,a.cross(b).normalized())).transposed()
        deformation = frame(after) @ frame(before).inverted()
        normal_transform = deformation.inverted().transposed()
        for loop_index in polygon.loop_indices:
            normals[loop_index] = (normal_transform @ old_normals[loop_index]).normalized()
    mesh.data.normals_split_custom_set(normals)
    mesh.data.update()
    assert weights == [tuple((g.group,g.weight) for g in v.groups) for v in mesh.data.vertices]
    assert all((vertex.co-original[vertex.index]).length == 0 for vertex in mesh.data.vertices if vertex.index not in moved)
    for indices in seam_groups.values():
        assert max(np.linalg.norm(changed[i]-changed[indices[0]]) for i in indices) < 2e-6
    return {'method': 'static-distal-source-surface-curl', 'bone': 'hand_r',
            'startBoneLocalY': start, 'maximumCurlRadians': angle_max,
            'shaftAxisBoneLocal': axis.tolist(), 'shaftCenterAtLocalZ0': center.tolist(),
            'modifiedVertices': len(moved), 'thumbUnchanged': True,
            'maxVertexDisplacementM': max((mesh.data.vertices[i].co-original[i]).length for i in moved),
            'maxRadialClearanceCorrectionM': float(max(additions)),
            'maxSampledClearanceWorseningM': float(max(0,max(deficit))),
            'triangleSamplesPerFace': len(samples),
            'normals': 'Affected source face-corner normals transformed by actual surface inverse transpose; other normals retained',
            'preserved': ['source topology','source UV seams','all source skin weights','thumb web','palm','wrist','left hand','original 23 joints'],
            'limitation': 'Static partial C grip. Source thumb/shaft overlap is retained; no independent finger articulation.'}
