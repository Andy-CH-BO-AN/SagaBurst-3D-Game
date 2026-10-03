"""Fit the supplied static corgi to a canine rig; preserve its mesh and maps.

This builds the geometry/rig source and retained jump/land/hit actions only.
For runtime locomotion and reviewed packaging, use tools/blender/README.md.

Blender -b --python tools/build-corgi.py -- source.glb output-directory
Outputs are staged, not declared runtime-ready; provenance and visual QA are
required before promotion. All authored landmarks below are specific to this GLB.
"""
import bpy
import bmesh
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
source, out = Path(args[0]).resolve(), Path(args[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
sha = hashlib.sha256(source.read_bytes()).hexdigest()
if sha != '498dcc12755599e30de1c458f2eb852609876968c89490c8616456d072a0c19d':
    raise ValueError('Source changed: remeasure corgi landmarks before rebuilding')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
body = next(o for o in bpy.data.objects if o.type == 'MESH')
body.name = 'corgi_body_lod0'
world = body.matrix_world.copy()
body.parent = None
body.matrix_world = Matrix.Identity(4)
body.data.transform(world)
# Blender is Z-up / -Y-forward; glTF export converts to Y-up / +Z-forward.
# Source stands along Blender +X. Bake uniform scale and +Z gameplay forward.
yaw, scale = math.pi/2, 4.0
for v in body.data.vertices:
    x, y, z = v.co
    v.co = Vector((-y*scale, -(x-.03)*scale, (z+.004958895035)*scale))
for o in list(bpy.data.objects):
    if o != body:
        bpy.data.objects.remove(o, do_unlink=True)

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def export(path, objects, animations=False):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
        use_selection=True, export_animations=animations, export_animation_mode='ACTIONS',
        export_skins=True, export_all_influences=False, export_extras=True,
        export_yup=True, export_apply=False, export_image_format='AUTO')

export(out/'normalized-source.glb', [body])
bm = bmesh.new()
bm.from_mesh(body.data)
# Join UV split positions for the heat solver. UVs live on loops and are preserved.
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
bm.to_mesh(body.data)
bm.free()
body.data.update()
bvh = BVHTree.FromPolygons([v.co for v in body.data.vertices], [p.vertices for p in body.data.polygons])

def B(p):
    """Game-space metres -> Blender."""
    return Vector((p[0], -p[2], p[1]))

armature = bpy.data.armatures.new('corgi_rig')
rig = bpy.data.objects.new('corgi_rig', armature)
bpy.context.collection.objects.link(rig)
activate(rig)
bpy.ops.object.mode_set(mode='EDIT')
landmarks = {}
def bone(name, head, tail, parent=None, deform=True):
    b = armature.edit_bones.new(name)
    b.head, b.tail = B(head), B(tail)
    if parent:
        b.parent = armature.edit_bones[parent]
    b.use_deform = deform
    landmarks[name] = {'head': list(head), 'tail': list(tail), 'parent': parent}

bone('corgi_torso', [0,.95,-.15], [0,1.20,-.15])
bone('corgi_chest', [0,1.06,.66], [0,1.38,.90], 'corgi_torso')
bone('corgi_neck', [0,1.38,.90], [0,1.65,1.13], 'corgi_chest')
bone('corgi_head', [0,1.65,1.13], [0,1.69,1.52], 'corgi_neck')
for side,sign in [('l',1),('r',-1)]:
    x=sign*.29
    bone('corgi_front_upper_'+side,[x,.85,.69],[x,.43,.69],'corgi_chest')
    bone('corgi_front_lower_'+side,[x,.43,.69],[x,.12,.76],'corgi_front_upper_'+side)
    bone('corgi_front_paw_'+side,[x,.12,.76],[x,.06,.96],'corgi_front_lower_'+side)
    bone('corgi_rear_upper_'+side,[x,.89,-.98],[x,.45,-.82],'corgi_torso')
    bone('corgi_rear_lower_'+side,[x,.45,-.82],[x,.23,-1.07],'corgi_rear_upper_'+side)
    bone('corgi_rear_ankle_'+side,[x,.23,-1.07],[x,.10,-1.02],'corgi_rear_lower_'+side)
    bone('corgi_rear_paw_'+side,[x,.10,-1.02],[x,.06,-.84],'corgi_rear_ankle_'+side)
bone('corgi_tail_0',[0,.67,-1.23],[0,.51,-1.35],'corgi_torso')
bone('socket_saddle_seat',[0,1.40,-.20],[0,1.45,-.20],'corgi_torso',False)
bone('socket_camera',[0,1.9,-.20],[0,1.95,-.20],'corgi_torso',False)
bpy.ops.object.mode_set(mode='OBJECT')
activate(body)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Head/eyes/whiskers keep their source shape. A narrow neck blend avoids
# heat-weight spill from the cheek into a nearby shoulder or opposite foreleg.
deforms = [b.name for b in armature.bones if b.use_deform]
def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)

def weights(index):
    return {body.vertex_groups[g.group].name:g.weight for g in body.data.vertices[index].groups if g.weight > 0}

def assign(index, values):
    values = sorted(values.items(), key=lambda p:p[1], reverse=True)[:4]
    total = sum(w for _,w in values)
    for g in body.vertex_groups:
        g.remove([index])
    for name, weight in values:
        group = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
        group.add([index], weight/total, 'REPLACE')

unweighted = 0
for v in body.data.vertices:
    x,y,z = v.co.x, v.co.z, -v.co.y
    w = weights(v.index)
    if not w:
        unweighted += 1
        name = min(deforms, key=lambda n:(v.co-armature.bones[n].head_local).length_squared)
        w = {name:1}
    head_blend = smooth(1.44,1.62,y) * smooth(.88,1.10,z)
    if head_blend:
        w = {n:a*(1-head_blend) for n,a in w.items()}
        w['corgi_head'] = w.get('corgi_head',0)+head_blend
    # Keep the saddle-bearing back on the torso rather than following the
    # nearest femur. Heat weighting alone pulled the pad through the hindquarter.
    back_blend = smooth(.60,.90,y)*smooth(-1.10,-.87,z)*(1-smooth(.48,.68,z))
    if back_blend:
        w = {n:a*(1-back_blend) for n,a in w.items()}
        w['corgi_torso'] = w.get('corgi_torso',0)+back_blend
    # The low belly lies close to both thighs. Limit leg influence to each
    # anatomical leg root; heat weights alone fold the belly between the paws.
    leg_region = (1-smooth(.38,.72,y))*smooth(.12,.24,abs(x))
    front_region = smooth(.28,.52,z)*(1-smooth(.99,1.14,z))
    rear_region = smooth(-1.30,-1.13,z)*(1-smooth(-.72,-.53,z))
    base = {n:a for n,a in w.items() if not any(tag in n for tag in ['_front_','_rear_'])}
    if not base: base={'corgi_torso':1}
    total_base=sum(base.values()); base={n:a/total_base for n,a in base.items()}
    leg_weights={n:a for n,a in w.items() if any(tag in n for tag in ['_front_','_rear_'])}
    strength=leg_region*max(front_region,rear_region)
    total_leg=sum(leg_weights.values())
    w={n:a*(1-strength) for n,a in base.items()}
    if total_leg:
        for n,a in leg_weights.items():w[n]=a/total_leg*strength
    assign(v.index,w)

# A fitted leather saddle replaces the old body's dimensional assumptions.
def mat(name, color, roughness, metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    m.diffuse_color=(*color,1)
    node=m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*color,1)
    node.inputs['Roughness'].default_value=roughness
    node.inputs['Metallic'].default_value=metal
    return m
leather=mat('corgi_saddle_leather',(.048,.027,.015),.85)
trim=mat('corgi_saddle_binding',(.12,.075,.033),.7)
brass=mat('corgi_saddle_brass',(.29,.18,.065),.4,.65)
tack=[]
def surface(name, rows, cols, fn, material):
    vertices=[B(fn(i/cols,j/rows)) for j in range(rows+1) for i in range(cols+1)]
    faces=[]
    for j in range(rows):
        for i in range(cols):
            k=j*(cols+1)+i;faces.append((k,k+1,k+cols+2,k+cols+1))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(material)
    for p in o.data.polygons:p.use_smooth=True
    tack.append(o);return o
def top(x,z):
    hit=bvh.ray_cast(B((x,2.6,z)),Vector((0,0,-1)))
    return hit[0].z if hit[0] else 1.35
def pad(u,t):
    angle=(u-.5)*math.pi*.75;z=.23-t*.97
    # Sample each upper cross-section of the real source rather than an ellipsoid.
    center=B((0,.92,z));direction=Vector((math.sin(angle),0,math.cos(angle)))
    hit=bvh.ray_cast(center+direction*1.1,-direction)
    p=(hit[0] if hit[0] else center+direction*.38)+direction*.016
    return [p.x,p.z,-p.y]
surface('corgi_saddle_pad',20,32,pad,leather)
def seat(u,t):
    # Low rounded cushion follows the source back; no vertical box walls.
    z=.16-t*.72
    width=.245*max(.001,math.sin(math.pi*t))**.30
    x=(2*u-1)*width
    return [x,top(x,z)+.022+.025*(1-(2*u-1)**2)*math.sin(math.pi*t),z]
surface('corgi_saddle_seat',28,20,seat,leather)
seat_height=seat(.5,.5)[1]
activate(rig)
bpy.ops.object.mode_set(mode='EDIT')
for name,height in [('socket_saddle_seat',seat_height),('socket_camera',seat_height+.5)]:
    b=armature.edit_bones[name];b.head=B((0,height,-.20));b.tail=B((0,height+.05,-.20))
    landmarks[name]['head']=[0,height,-.20];landmarks[name]['tail']=[0,height+.05,-.20]
bpy.ops.object.mode_set(mode='OBJECT')
def tube(name,points,radius,material):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=2
    sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
    for p,q in zip(sp.points,points):p.co=(*B(q),1)
    obj=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(obj);activate(obj);bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(material);tack.append(obj)
for edge in [0,1]:
    tube('corgi_pad_binding',[pad(edge,i/32) for i in range(33)],.008,trim)
    tube('corgi_pad_binding',[pad(i/32,edge) for i in range(33)],.008,trim)
    tube('corgi_seat_binding',[seat(edge,i/24) for i in range(25)],.008,trim)
    tube('corgi_seat_binding',[seat(i/24,edge) for i in range(25)],.008,trim)
# A minimal fitted saddle leaves the original coat, head and legs visible.
for sign in [-1,1]:
    tube('corgi_stirrup_strap',[[sign*.22,seat_height-.03,-.18],[sign*.48,seat_height-.26,-.02],[sign*.59,seat_height-.46,.14]],.015,leather)
    tube('corgi_stirrup',[[sign*.59,seat_height-.45,.14],[sign*.67,seat_height-.59,.14],[sign*.59,seat_height-.62,.14],[sign*.51,seat_height-.59,.14],[sign*.59,seat_height-.45,.14]],.012,brass)
def surface_weights(point):
    location,_,index,_=bvh.find_nearest(point)
    ids=body.data.polygons[index].vertices
    a,b,c=[body.data.vertices[i].co for i in ids[:3]]
    v0,v1,v2=b-a,c-a,location-a
    d00,d01,d11,d20,d21=v0.dot(v0),v0.dot(v1),v1.dot(v1),v2.dot(v0),v2.dot(v1)
    den=d00*d11-d01*d01
    if abs(den)<1e-15:return weights(ids[0])
    v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den
    result={}
    for i,factor in zip(ids,[1-v-w,v,w]):
        for name,value in weights(i).items():result[name]=result.get(name,0)+value*max(0,factor)
    result=dict(sorted(result.items(),key=lambda p:p[1],reverse=True)[:4])
    total=sum(result.values());return {name:value/total for name,value in result.items()}
for o in tack:
    fitted=o.name.startswith(('corgi_armour','corgi_pad','corgi_saddle_pad'))
    for v in o.data.vertices:
        w=surface_weights(v.co) if fitted else {'corgi_torso':1}
        for name,weight in w.items():
            group=o.vertex_groups.get(name) or o.vertex_groups.new(name=name)
            group.add([v.index],weight,'REPLACE')
    modifier=o.modifiers.new('Canine saddle','ARMATURE');modifier.object=rig;o.parent=rig
# Consolidate fitted tack by material while keeping its skin weights.
combined=[]
material_groups=[(m,[o for o in tack if o.data.materials[0]==m]) for m in [leather,trim,brass]]
for material,objects in material_groups:
    activate(objects[0])
    for o in objects:o.select_set(True)
    bpy.ops.object.join();obj=bpy.context.object;obj.name=material.name;combined.append(obj)
tack=combined

# One skin across every LOD. Source UV/material intent survives decimation.
lods=[body]
for level,target in [(1,20000),(2,6000)]:
    obj=body.copy();obj.data=body.data.copy();obj.name='corgi_body_lod'+str(level)
    bpy.context.collection.objects.link(obj);activate(obj)
    dec=obj.modifiers.new('LOD reduction','DECIMATE');dec.ratio=target/99991
    bpy.ops.object.modifier_apply(modifier=dec.name)
    lods.append(obj)

# Preserve the ancillary actions still used by gameplay. Locomotion and death
# are owned by the donor-retarget pipeline in tools/blender/.
rig.animation_data_create()
fps=30;bpy.context.scene.render.fps=fps
axes={b.name:{axis:b.matrix_local.to_quaternion().inverted()@B(vector) for axis,vector in [('x',(1,0,0)),('y',(0,1,0)),('z',(0,0,1))]} for b in armature.bones}
def rotate(name,axis,angle):
    rig.pose.bones[name].rotation_quaternion @= Quaternion(axes[name][axis],angle)
clips={'jump':.75,'land':.6,'hit':.6}
for clip,duration in clips.items():
    action=bpy.data.actions.new(clip);rig.animation_data.action=action
    count=round(duration*fps)
    for f in range(count+1):
        t=f/count;phase=t*2*math.pi
        for p in rig.pose.bones:
            p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion();p.location=Vector()
        if clip in ['jump','land']:
            a=math.sin(min(t/.6,1)*math.pi/2) if clip=='jump' else math.sin(math.pi*t)
            for side in ['l','r']:
                for end in ['front','rear']:
                    rotate('corgi_'+end+'_upper_'+side,'x',(-.35 if clip=='jump' else -.13)*a)
                    rotate('corgi_'+end+'_lower_'+side,'x',(.65 if clip=='jump' else .3)*a)
            rotate('corgi_torso','x',(-.1 if clip=='jump' else .05)*a)
            if clip=='land':rig.pose.bones['corgi_torso'].location=axes['corgi_torso']['y']*(-.07*a)
        elif clip=='hit':
            rotate('corgi_neck','x',-.12*math.sin(math.pi*t));rotate('corgi_head','x',-.08*math.sin(math.pi*t))
        for i in range(1):rotate('corgi_tail_'+str(i),'y',math.sin(phase+i*.4)*.035)
        for p in rig.pose.bones:
            p.keyframe_insert('rotation_quaternion',frame=f+1)
            if p.name=='corgi_torso':p.keyframe_insert('location',frame=f+1)
    action.use_fake_user=True
rig.animation_data.action=None
for p in rig.pose.bones:p.rotation_quaternion=Quaternion();p.location=Vector()
bpy.context.scene.frame_set(1)
for image in bpy.data.images:
    if max(image.size)>2048:image.scale(2048,2048)
export(out/'corgi-rig.glb',[rig,*lods,*tack],True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'corgi-rig.blend'))
report={'sourceSha256':sha,'uniformScale':scale,'sourceHeadingRadians':yaw,'forward':'+Z','unweightedBeforeRepair':unweighted,
    'saddleHeightM':seat_height,'landmarks':landmarks,'triangles':{o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in lods},'clips':clips,
    'images':[{'name':i.name,'size':list(i.size)} for i in bpy.data.images]}
(out/'build.json').write_text(json.dumps(report,indent=2))
print('CORGI_BUILD',json.dumps(report))
