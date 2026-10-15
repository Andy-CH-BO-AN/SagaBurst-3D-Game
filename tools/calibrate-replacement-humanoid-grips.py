"""Reproduce hand/haft calibration from the three user-provided deliveries.

Usage: python tools/calibrate-replacement-humanoid-grips.py SOURCE_ROOT OUTPUT_JSON
Requires numpy. Reads GLB and calibration JSON as data; executes no delivery code.
No hand vertices, weights, animation keys or weapon geometry are changed.
"""
import glob
import json
import pathlib
import struct
import sys
import numpy as np


def matrix(t, q, s):
    x, y, z, w = np.asarray(q) / np.linalg.norm(q)
    result = np.eye(4)
    result[:3, :3] = np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ]) @ np.diag(s)
    result[:3, 3] = t
    return result


class Asset:
    """Small GLB data reader and linear/spherical animation sampler."""
    def __init__(self, path):
        blob = pathlib.Path(path).read_bytes()
        magic, version, length = struct.unpack_from('<III', blob)
        if magic != 0x46546c67 or version != 2 or length != len(blob):
            raise ValueError('Invalid GLB header')
        chunks = {}
        offset = 12
        while offset < length:
            size, kind = struct.unpack_from('<II', blob, offset)
            chunks[kind] = blob[offset+8:offset+8+size]
            offset += 8 + size
        self.d = json.loads(chunks[0x4e4f534a])
        self.binary = chunks[0x004e4942]
        self.primitives = []
        for node in self.d['nodes']:
            if 'mesh' not in node or 'skin' not in node:
                continue
            skin = self.d['skins'][node['skin']]
            inverses = self.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
            for index, primitive in enumerate(self.d['meshes'][node['mesh']]['primitives']):
                attrs = primitive['attributes']
                self.primitives.append(dict(name=node['name'], primitive=index,
                    j=self.accessor(attrs['JOINTS_0']), w=self.accessor(attrs['WEIGHTS_0']),
                    joints=skin['joints'], ib=inverses))

    def accessor(self, index):
        a = self.d['accessors'][index]
        if 'sparse' in a:
            raise ValueError('Sparse calibration accessor unsupported')
        view = self.d['bufferViews'][a['bufferView']]
        if view.get('buffer', 0) != 0:
            raise ValueError('External calibration buffer unsupported')
        dtype = np.dtype({5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', width*dtype.itemsize)
        values = np.ndarray((a['count'], width), dtype, self.binary, offset,
                            strides=(stride, dtype.itemsize)).copy()
        if a.get('normalized'):
            info = np.iinfo(dtype)
            values = np.maximum(values.astype(float)/info.max, -1)
        return values

    def pose(self, clip, time):
        nodes = self.d['nodes']
        values = [{key:np.array(node.get(key, default), dtype=float) for key, default in
                   [('translation',[0,0,0]),('rotation',[0,0,0,1]),('scale',[1,1,1])]} for node in nodes]
        animation = next(a for a in self.d['animations'] if a['name'] == clip)
        for channel in animation['channels']:
            sampler = animation['samplers'][channel['sampler']]
            path = channel['target']['path']
            if path == 'weights':
                continue
            times = self.accessor(sampler['input']).ravel()
            data = self.accessor(sampler['output']).astype(float)
            i = max(0, min(len(times)-1, np.searchsorted(times, time, side='right')-1))
            j = min(i+1, len(times)-1)
            weight = 0 if i == j else np.clip((time-times[i])/(times[j]-times[i]), 0, 1)
            mode = sampler.get('interpolation', 'LINEAR')
            if mode == 'STEP':
                sample = data[i]
            elif mode == 'LINEAR':
                left, right = data[i], data[j]
                if path == 'rotation':
                    dot = np.dot(left, right)
                    if dot < 0:
                        right, dot = -right, -dot
                    if dot < .9995:
                        angle = np.arccos(np.clip(dot, -1, 1))
                        sample = (np.sin((1-weight)*angle)*left + np.sin(weight*angle)*right)/np.sin(angle)
                    else:
                        sample = left*(1-weight) + right*weight
                    sample /= np.linalg.norm(sample)
                else:
                    sample = left*(1-weight) + right*weight
            elif mode == 'CUBICSPLINE':
                duration = times[j]-times[i]
                t2, t3 = weight*weight, weight*weight*weight
                sample = ((2*t3-3*t2+1)*data[3*i+1] + (t3-2*t2+weight)*duration*data[3*i+2]
                          + (-2*t3+3*t2)*data[3*j+1] + (t3-t2)*duration*data[3*j])
                if path == 'rotation':
                    sample /= np.linalg.norm(sample)
            else:
                raise ValueError('Unsupported source interpolation: '+mode)
            values[channel['target']['node']][path] = sample
        parents = {child:index for index,node in enumerate(nodes) for child in node.get('children', [])}
        worlds = {}
        def world(index):
            if index not in worlds:
                node, value = nodes[index], values[index]
                local = np.array(node['matrix']).reshape(4,4).T if 'matrix' in node else matrix(value['translation'], value['rotation'], value['scale'])
                worlds[index] = world(parents[index]) @ local if index in parents else local
            return worlds[index]
        return [world(index) for index in range(len(nodes))]


base = str(pathlib.Path(sys.argv[1]).resolve()) + '/'
result={}
def normalize(v):return (v/np.linalg.norm(v)).tolist()
def sword(center,axis,normal):
 return dict(gripCenterLocal=list(center),gripAxisLocal=normalize(axis),palmNormalLocal=normalize(normal),fingerDirection=[0,1,0],wristCenter=[0,0,0],thumbBaseCenter=[0,.04,0],fingerBase=.08,gripRadius=.024)
def bow(center,axis,normal):
 normal=np.array(normal)/np.linalg.norm(normal)
 return dict(palmContactCenter=(np.array(center)-normal*.028).tolist(),palmNormal=normal.tolist(),thumbDir=1,thumbDirection=normalize(axis),fingerDirection=[0,1,0],wristCenter=[0,0,0],thumbBaseCenter=[0,.04,0],fingerBase=.08)
a=Asset(glob.glob(base+'**/Viking_11Clips_Mock_GripAndWeaponAdjusted_DERIVED.glb',recursive=True)[0]);names={n['name']:i for i,n in enumerate(a.d['nodes'])}
for n in ['MOCK_sword','MOCK_bow','MOCK_axe1','MOCK_axe2']:
 node=a.d['nodes'][names[n]]; m=matrix(node.get('translation',[0,0,0]),node['rotation'],[1,1,1])
 if n=='MOCK_sword':sf=sword(m[:3,3],m[:3,2],m[:3,1])
 if n=='MOCK_bow':
  pose=a.pose('bowHold',.2);bf=bow(m[:3,3],m[:3,2],-m[:3,0])
result['viking']={'sword':sf,'left':bf}
d=json.load(open(glob.glob(base+'**/Calibrated_Sockets_Final.json',recursive=True)[0]))['sockets'];s=d['sword'];b=d['bow_grip'];bm=np.array(b['new_socket_authored_weapon_to_hand_local']);sm=np.array(s['new_socket_authored_weapon_to_hand_local'])
result['roman']={'sword':sword(s['new_grip_axis_center_hand_local'],sm[:3,2],sm[:3,1]),'left':bow(b['new_grip_axis_center_hand_local'],bm[:3,2],-bm[:3,1])}
a=Asset(glob.glob(base+'**/Varangian_Captain_MockWeapons.glb',recursive=True)[0]);names={n['name']:i for i,n in enumerate(a.d['nodes'])}
for pname,hand,action,primitive in [('MOCK_Sword_Demonstration','hand_r','swordSlash',0),('MOCK_Bow_Demonstration','hand_l','bowHold',1)]:
 p=next(p for p in a.primitives if p['name']==pname and p['primitive']==primitive);pose=a.pose(action,.1);ji=p['j'][0,np.argmax(p['w'][0])];m=np.linalg.inv(pose[names[hand]])@pose[p['joints'][ji]]@p['ib'][ji]
 if hand=='hand_r':sf=sword(m[:3,3],-m[:3,2],-m[:3,1])
 else:bf=bow(m[:3,3],-m[:3,2],m[:3,0])
result['viking-hero-t4']={'sword':sf,'left':bf}

# Authored axe frames: column Z follows the source shaft toward its head.
v=Asset(glob.glob(base+'**/Viking_11Clips_Mock_GripAndWeaponAdjusted_DERIVED.glb',recursive=True)[0]);vn={n['name']:n for n in v.d['nodes']}
for name,key in [('MOCK_axe1','axe1'),('MOCK_axe2','axe2')]:
 n=vn[name];result['viking'][key]=matrix(n['translation'],n['rotation'],[1,1,1]).tolist()
result['roman']['axe1']=d['axe1']['new_socket_authored_weapon_to_hand_local']
# roman2 remains its authored animated node, never replaced by a static frame.
for pname,action,key,station in [('MOCK_Axe1H_Demonstration','axeAttack1H','axe1',0),('MOCK_Axe2H_Demonstration','axeAttack2H','axe2',.1)]:
 p=next(p for p in a.primitives if p['name']==pname and p['primitive']==0);pose=a.pose(action,.1);ji=p['j'][0,np.argmax(p['w'][0])];m=np.linalg.inv(pose[names['hand_r']])@pose[p['joints'][ji]]@p['ib'][ji];m[:3,3]-=m[:3,2]*station;m[:3,1:3]*=-1
 result['viking-hero-t4'][key]=m.tolist()


# Throwing uses its own delivered grip orientation, which can be opposite
# the sword (Roman) even though the same right palm holds both weapons.
pilum_node = vn['MOCK_pilum']
pm = matrix(pilum_node['translation'], pilum_node['rotation'], [1, 1, 1])
result['viking']['ranged'] = sword(pm[:3, 3], pm[:3, 2], pm[:3, 1])
rp = d['pilum']
pm = np.array(rp['new_socket_authored_weapon_to_hand_local'])
result['roman']['ranged'] = sword(rp['new_grip_axis_center_hand_local'], pm[:3, 2], pm[:3, 1])
p = next(p for p in a.primitives if p['name'] == 'MOCK_Pilum_Demonstration' and p['primitive'] == 0)
pose = a.pose('pilumThrow', .1)
ji = p['j'][0, np.argmax(p['w'][0])]
pm = np.linalg.inv(pose[names['hand_r']]) @ pose[p['joints'][ji]] @ p['ib'][ji]
result['viking-hero-t4']['ranged'] = sword(pm[:3, 3], -pm[:3, 2], -pm[:3, 1])

# Roman's approved source shield uses a 13mm handle. Move the cylinder
# center along the measured palm normal for SagaBurst's 24mm handle radius.
# This preserves the palm tangent; it is not proof of finger mesh clearance.
shield = d['shield_handle']
normal = np.array(shield['palm_outward_normal_hand_local'])
normal /= np.linalg.norm(normal)
center = np.array(shield['new_grip_axis_center_hand_local']) + normal * (.024 - shield['radius_m'])
frame = sword(center, shield['shaft_axis_hand_local'], normal)
frame['fingerDirection'] = shield['finger_distal_tangent_hand_local']
result['roman']['shield'] = frame

# The delivered cutting edge occupies primitive 3; measure its mean surface
# position against the hips at the documented forward strike phase. This
# records the existing EquipmentPose facing adaptation without editing keys.
node_index = next(i for i, node in enumerate(v.d['nodes']) if node['name'] == 'MOCK_axe2')
hips_index = next(i for i, node in enumerate(v.d['nodes']) if node['name'] == 'Hips')
edge_primitive = v.d['meshes'][v.d['nodes'][node_index]['mesh']]['primitives'][3]
edge_local = v.accessor(edge_primitive['attributes']['POSITION']).mean(axis=0)
strike_time = 127 / 120
pose = v.pose('axeAttack2H', strike_time)
edge_world = (pose[node_index] @ np.r_[edge_local, 1])[:3]
hips_world = pose[hips_index][:3, 3]
delta = edge_world - hips_world
result['viking']['attackFacing'] = dict(clip='axeAttack2H', sourceTime=strike_time,
    edgeLocal=edge_local.tolist(), edgeWorld=edge_world.tolist(), hipsWorld=hips_world.tolist(),
    yawCorrectionRadians=float(-np.arctan2(delta[0], delta[2])))

# Varangian's separate skinned mock cutting edge points along raw -Z.
node = a.d['nodes'][names['MOCK_Axe2H_Demonstration']]
edge_primitive = a.d['meshes'][node['mesh']]['primitives'][2]
edge_local = a.accessor(edge_primitive['attributes']['POSITION']).mean(axis=0)
p = next(p for p in a.primitives if p['name'] == 'MOCK_Axe2H_Demonstration' and p['primitive'] == 2)
ji = p['j'][0, np.argmax(p['w'][0])]
strike_time = 128 / 120
pose = a.pose('axeAttack2H', strike_time)
edge_world = (pose[p['joints'][ji]] @ p['ib'][ji] @ np.r_[edge_local, 1])[:3]
hips_world = pose[names['hips']][:3, 3]
delta = edge_world - hips_world
result['viking-hero-t4']['attackFacing'] = dict(clip='axeAttack2H', sourceTime=strike_time,
    edgeLocal=edge_local.tolist(), edgeWorld=edge_world.tolist(), hipsWorld=hips_world.tolist(),
    yawCorrectionRadians=float(-np.arctan2(delta[0], delta[2])))

pathlib.Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n')
