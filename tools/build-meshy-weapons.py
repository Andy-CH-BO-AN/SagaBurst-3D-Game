#!/usr/bin/env python3
"""Normalize the two user-supplied textured weapons; Python 3 + NumPy.

Usage: python3 tools/build-meshy-weapons.py /path/to/downloads
No decimation or texture re-encoding. Bow string triangles crossing the nock
are split (never discarded) so the existing two-segment draw can animate them.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'bow': ('Meshy_AI_tactical_forest_longb_1025131328_texture.glb', '26f815e1793412b85ac0fe109dc654eedb3be5e30354c7866c2704cc9ce2e338'),
    'lance': ('Meshy_AI_A_legendary_Tier_5_Co_1025132049_texture.glb', '64e9a5aac4142f5a51f424f57c405f8c0de9b56ff3c37c7ee8779e05d6d19a8d'),
}

def read(path):
    raw = path.read_bytes()
    assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 4)[0] == 2
    n = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+n]), bytearray(raw[28+n:]), hashlib.sha256(raw).hexdigest()

def write(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    payload = json.dumps(doc, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    binary += b'\0' * (-len(binary) % 4)
    raw = b'glTF' + struct.pack('<II', 2, 28+len(payload)+len(binary)) + struct.pack('<I4s', len(payload), b'JSON') + payload + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()

def array(doc, binary, index):
    a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    return np.frombuffer(binary, dtype={5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']], count=a['count']*width, offset=v.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, width).copy()

def append(doc, binary, values, kind, component=5126):
    data = np.asarray(values, dtype='<f4' if component == 5126 else '<u4').reshape(-1, {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[kind])
    binary.extend(b'\0' * (-len(binary) % 4))
    view = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': data.nbytes})
    binary.extend(data.tobytes())
    result = len(doc['accessors'])
    doc['accessors'].append({'bufferView': view, 'componentType': component, 'count': len(data), 'type': kind, 'min': data.min(0).tolist(), 'max': data.max(0).tolist()})
    return result

def bow(doc, binary):
    primitive = doc['meshes'][0]['primitives'][0]
    positions = array(doc, binary, primitive['attributes']['POSITION'])
    triangles = array(doc, binary, primitive['indices']).reshape(-1, 3)
    # Source has a disconnected straight string at X > .088, Y=.062..1.847.
    # Flood from its centre; exact source hash guards this topology selection.
    adjacent = [set() for _ in positions]
    for tri in triangles:
        for i in tri: adjacent[i].update(tri)
    _, inv = np.unique(np.round(positions, 5), axis=0, return_inverse=True)
    welded = {}
    for i, key in enumerate(inv): welded.setdefault(key, []).append(i)
    seed = int(np.argmin(np.linalg.norm(positions - [.091, .95, .002], axis=1)))
    island, pending = set(), [seed]
    while pending:
        i = pending.pop()
        if i in island: continue
        island.add(i)
        pending.extend((adjacent[i] | set(welded[inv[i]])) - island)
    string_mask = np.array([all(int(i) in island for i in tri) for tri in triangles])
    assert len(island) == 98 and string_mask.any()
    string_positions = positions[sorted(island)]
    scale = 1.85 / float(positions[:, 1].max() - positions[:, 1].min())
    # Side plane source XY -> canonical YZ; source +X/string faces archer +Z.
    grip = np.array([-.064, .95, .0005])
    rotation = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], dtype=float)
    matrix = np.eye(4); matrix[:3, :3] = rotation * scale; matrix[:3, 3] = -rotation @ grip * scale
    body_indices = append(doc, binary, triangles[~string_mask], 'SCALAR', 5125)
    primitive['indices'] = body_indices
    doc['nodes'] = [{'name': 't4-ranger-bow-body', 'mesh': 0, 'matrix': matrix.T.flatten().tolist()}]
    tip_values = []
    for high in [True, False]:
        end_y = string_positions[:, 1].max() if high else string_positions[:, 1].min()
        ring = string_positions[np.abs(string_positions[:, 1] - end_y) < .0025]
        tip_values.append((rotation @ (ring.mean(0)-grip) * scale).tolist())
    # Preserve original string surface and PBR maps. Clip only triangles crossing
    # the midpoint; interpolate UVs/normals at that seam without deleting faces.
    attrs = primitive['attributes']
    values = np.concatenate([positions, array(doc, binary, attrs['NORMAL']), array(doc, binary, attrs['TEXCOORD_0'])], axis=1)
    seam = float(grip[1]); seam_xz = string_positions[:, [0, 2]].mean(0)
    total = int((~string_mask).sum())
    for high, name in [(True, 'bow-string-top'), (False, 'bow-string-bottom')]:
        result = []
        end_y = float(string_positions[:, 1].max() if high else string_positions[:, 1].min())
        length = abs(end_y-seam)
        for tri in triangles[string_mask]:
            poly = list(values[tri]); clipped = []
            for current, following in zip(poly, poly[1:]+poly[:1]):
                inside = current[1] >= seam if high else current[1] <= seam
                next_inside = following[1] >= seam if high else following[1] <= seam
                if inside: clipped.append(current)
                if inside != next_inside:
                    t = (seam-current[1])/(following[1]-current[1])
                    clipped.append(current + (following-current)*t)
            for i in range(1, len(clipped)-1): result.extend([clipped[0], clipped[i], clipped[i+1]])
        data = np.array(result)
        # Unit-height, centred +Y mesh, exactly as the existing cylinder string.
        # X/Z keep their source thickness; only longitudinal stretch is dynamic.
        data[:, 0] = (data[:, 0]-seam_xz[0])*scale
        data[:, 2] = (data[:, 2]-seam_xz[1])*scale
        data[:, 1] = (data[:, 1]-(end_y+seam)/2)/length
        data[:, 3:6] /= np.maximum(np.linalg.norm(data[:, 3:6], axis=1)[:, None], 1e-12)
        new_attrs = {key: append(doc, binary, data[:, a:b], kind) for key,a,b,kind in [('POSITION',0,3,'VEC3'),('NORMAL',3,6,'VEC3'),('TEXCOORD_0',6,8,'VEC2')]}
        mesh = len(doc['meshes']); doc['meshes'].append({'name':name, 'primitives':[{'attributes':new_attrs, 'material':primitive['material'], 'mode':4}]})
        tip = np.array(tip_values[0 if high else 1]); nock = np.array([0, .02, .15])
        direction = nock-tip; distance = np.linalg.norm(direction); y = direction/distance
        x = np.cross(y, [0, 0, 1]); x /= np.linalg.norm(x); z = np.cross(x, y)
        rest = np.eye(4); rest[:3,:3] = np.column_stack([x, y*distance, z]); rest[:3,3] = (tip+nock)/2
        doc['nodes'].append({'name':name, 'mesh':mesh, 'matrix':rest.T.flatten().tolist()})
        total += len(data)//3
    doc['scenes'] = [{'nodes':list(range(3))}]; doc['scene'] = 0
    metadata = {'id':'maki-ranger-bow', 'gripRadius':.035, 'gripLength':.19, 'gripCenterLocal':[0,0,0], 'shootingAxis':[0,0,-1], 'longitudinalAxis':[0,1,0], 'contactNormal':[-1,0,0], 'topTip':tip_values[0], 'bottomTip':tip_values[1], 'bodyHeightMeters':1.85, 'sourceGripCenter':grip.tolist(), 'sourceToAttachmentMatrix':matrix.T.flatten().tolist(), 'originalTriangles':len(triangles), 'bodyTriangles':int((~string_mask).sum()), 'finalTriangles':total, 'stringGeometry':'Unit-height two-part source string; original triangles preserved, seam crossings split. CharacterBowVisual supplies existing draw transforms.'}
    return metadata

def lance(doc, binary):
    p = array(doc, binary, doc['meshes'][0]['primitives'][0]['attributes']['POSITION'])
    # Fit shaft axis, excluding broad blade. The source is diagonally presented
    # in XY; keep its broad face XY and thickness Z.
    axis = np.array([-.905, .4254]); axis /= np.linalg.norm(axis)
    projected = p[:, :2] @ axis
    shaft = p[(projected < np.quantile(projected, .55)) & (projected > np.quantile(projected, .1)), :2]
    _, eigenvectors = np.linalg.eigh(np.cov(shaft.T)); axis = eigenvectors[:, -1]
    if axis[1] < 0: axis = -axis
    rotation = np.array([[axis[1], -axis[0], 0], [axis[0], axis[1], 0], [0, 0, 1]])
    q = p @ rotation.T
    scale = 3.1 / float(np.ptp(q[:,1]))
    # Use shaft centre (not blade bounding box) to avoid an off-axis grasp.
    shaft_q = shaft @ rotation[:2,:2].T
    offset = np.array([-np.median(shaft_q[:,0])*scale, -.5-q[:,1].min()*scale, -np.median(p[:,2])*scale])
    # The sharp tip must exactly coincide with the existing tip marker.
    tip = q[np.argmax(q[:,1])]
    offset[0] = -tip[0]*scale
    matrix = np.eye(4);matrix[:3,:3] = rotation*scale;matrix[:3,3] = offset
    doc['nodes'][0]['name'] = 't5-lance-attachment-space';doc['nodes'][0]['matrix'] = matrix.T.flatten().tolist()
    final = q*scale+offset
    return {'longAxis':'+Y','broadFace':'XY','gripCenter':[0,.15,0],'supportGripCenter':[0,.33,0],'tipLocal':[0,2.6,0],'lengthMeters':3.1,'boundsMin':final.min(0).tolist(),'boundsMax':final.max(0).tolist(),'sourceToAttachmentMatrix':matrix.T.flatten().tolist(),'uniformScale':scale,'rotationZRadians':float(np.arctan2(rotation[1,0],rotation[0,0])),'sourceGripCenter':((np.array([0,.15,0])-offset)@rotation/scale).tolist()}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source_directory',type=Path);args=parser.parse_args()
    for kind,(filename, expected) in SOURCES.items():
        doc,binary,sha=read(args.source_directory/filename)
        if sha != expected: raise ValueError(f'Source SHA mismatch: {filename}')
        original_binary=bytes(binary)
        metadata=bow(doc,binary) if kind=='bow' else lance(doc,binary)
        record={'sourceFile':filename,'sourceSha256':sha,'sourceProvider':'Meshy; user-supplied textured GLB','build':'tools/build-meshy-weapons.py','attachmentSpace':metadata,'geometryPolicy':'No decimation. Original body accessors and all embedded texture bytes preserved. Bow string split only for existing draw animation.'}
        doc['asset'].setdefault('extras',{}).update(record)
        folder=ROOT/'public/models/weapons'/('maki-ranger-bow' if kind=='bow' else 't5')
        target=folder/('bow.glb' if kind=='bow' else 'lance.glb')
        record['finalSha256']=write(target,doc,binary)
        record['triangles']=sum(doc['accessors'][pr.get('indices',pr['attributes']['POSITION'])]['count']//3 for m in doc['meshes'] for pr in m['primitives'])
        record['bytes']=target.stat().st_size
        if kind=='bow':
            (folder/'attachment.json').write_text(json.dumps({**metadata,'sourceSha256':sha},indent=2)+'\n')
            (folder/'source.json').write_text(json.dumps(record,indent=2)+'\n')
        else:
            records=json.loads((folder/'sources.json').read_text())
            records=[record|{'weapon':'lance'} if r.get('weapon')=='lance' else r for r in records]
            (folder/'sources.json').write_text(json.dumps(records,indent=2)+'\n')
        assert bytes(binary[:len(original_binary)]) == original_binary
        print(kind,json.dumps(record))

if __name__=='__main__':main()
