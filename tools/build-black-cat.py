"""Fit the supplied static black cat to a feline rig; preserve its mesh and maps.

This builds the geometry/rig source and retained jump/land/hit actions only.
For runtime locomotion and reviewed packaging, use tools/blender/README.md.

Blender -b --python tools/build-black-cat.py -- source.glb output-directory
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
if sha != '4aec818094bf09a57ff44a24ea0be24a1cf7100f4e7a4b632c21df4dc92f2b57':
    raise ValueError('Source changed: remeasure feline landmarks before rebuilding')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
body = next(o for o in bpy.data.objects if o.type == 'MESH')
body.name = 'cat_body_lod0'
world = body.matrix_world.copy()
body.parent = None
body.matrix_world = Matrix.Identity(4)
body.data.transform(world)
# Blender is Z-up / -Y-forward; glTF export converts to Y-up / +Z-forward.
# Paw-pair centres determine the source's 32.44-degree heading.
yaw, scale = 0.5662370775115807, 3.5
c, s = math.cos(yaw), math.sin(yaw)
for v in body.data.vertices:
    x, y, z = v.co.x - .0057151015, v.co.z, -v.co.y - .0034821599
    v.co = Vector(((x*c-z*s)*scale, -(x*s+z*c)*scale, (y-.000041)*scale))
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

armature = bpy.data.armatures.new('black_cat_rig')
rig = bpy.data.objects.new('black_cat_rig', armature)
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

bone('cat_torso', [0,1.15,-.1], [0,1.35,-.1])
bone('cat_chest', [0,1.28,.42], [0,1.46,.68], 'cat_torso')
bone('cat_neck', [0,1.46,.68], [-.035,1.70,.96], 'cat_chest')
bone('cat_head', [-.035,1.70,.96], [-.12,1.88,1.14], 'cat_neck')
for side, sign in [('l',1), ('r',-1)]:
    # Source paws are slightly staggered; keep the authored stance.
    x = sign * .218
    front_z = .90 if sign == 1 else .84
    bone('cat_front_upper_'+side, [x,1.28,.59], [x,.73,.64], 'cat_chest')
    bone('cat_front_lower_'+side, [x,.73,.64], [x,.15,front_z-.08], 'cat_front_upper_'+side)
    bone('cat_front_paw_'+side, [x,.15,front_z-.08], [x,.06,front_z+.13], 'cat_front_lower_'+side)
    x = sign * .245
    rear_z = -.85 if sign == 1 else -.90
    bone('cat_rear_upper_'+side, [x,1.22,-.84], [x,.69,-.61], 'cat_torso')
    bone('cat_rear_lower_'+side, [x,.69,-.61], [x,.31,rear_z-.15], 'cat_rear_upper_'+side)
    bone('cat_rear_ankle_'+side, [x,.31,rear_z-.15], [x,.105,rear_z], 'cat_rear_lower_'+side)
    bone('cat_rear_paw_'+side, [x,.105,rear_z], [x,.06,rear_z+.17], 'cat_rear_ankle_'+side)
tail = [[0,1.18,-1.12],[-.015,.91,-1.40],[-.04,.64,-1.65],[-.06,.46,-1.89],[-.07,.40,-2.12],[-.075,.49,-2.28]]
for i in range(len(tail)-1):
    bone('cat_tail_'+str(i), tail[i], tail[i+1], 'cat_torso' if i == 0 else 'cat_tail_'+str(i-1))
bone('socket_saddle_seat', [0,1.65,-.15], [0,1.70,-.15], 'cat_torso', False)
bone('socket_camera', [0,1.90,-.15], [0,1.95,-.15], 'cat_torso', False)
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
    head_blend = smooth(1.57,1.76,y) * smooth(.72,.96,z)
    if head_blend:
        w = {n:a*(1-head_blend) for n,a in w.items()}
        w['cat_head'] = w.get('cat_head',0)+head_blend
    # Keep the saddle-bearing back on the torso rather than following the
    # nearest femur. Heat weighting alone pulled the pad through the hindquarter.
    back_blend = smooth(.79,1.05,y)*smooth(-.91,-.70,z)*(1-smooth(.27,.47,z))
    if back_blend:
        w = {n:a*(1-back_blend) for n,a in w.items()}
        w['cat_torso'] = w.get('cat_torso',0)+back_blend
    assign(v.index,w)

# A fitted leather saddle replaces the old body's dimensional assumptions.
def mat(name, color, roughness, metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*color,1)
    node.inputs['Roughness'].default_value=roughness
    node.inputs['Metallic'].default_value=metal
    return m
leather=mat('cat_saddle_leather',(.048,.027,.015),.85)
trim=mat('cat_saddle_binding',(.12,.075,.033),.7)
brass=mat('cat_saddle_brass',(.29,.18,.065),.4,.65)
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
    angle=(u-.5)*math.pi*.86;z=.24-t*.91
    # Sample each upper cross-section of the real source rather than an ellipsoid.
    center=B((0,1.13,z));direction=Vector((math.sin(angle),0,math.cos(angle)))
    hit=bvh.ray_cast(center+direction*1.1,-direction)
    p=(hit[0] if hit[0] else center+direction*.38)+direction*.016
    return [p.x,p.z,-p.y]
surface('cat_saddle_pad',20,32,pad,leather)
def seat(u,t):
    z=.17-t*.65;end=abs(2*t-1)**4;w=.17+.055*end;x=(2*u-1)*w
    return [x,max(1.65,top(x,z)+.044)+end*.045+x*x*.1,z]
surface('cat_saddle_seat',24,16,seat,leather)
for side in [0,1]:
    surface('cat_saddle_side_'+str(side),24,6,lambda u,t,side=side:[
        seat(side,t)[0],seat(side,t)[1]*(1-u)+(top(seat(side,t)[0],seat(side,t)[2])+.017)*u,seat(side,t)[2]],leather)
def tube(name,points,radius,material):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=2
    sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
    for p,q in zip(sp.points,points):p.co=(*B(q),1)
    obj=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(obj);activate(obj);bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(material);tack.append(obj)
for edge in [0,1]:
    tube('cat_pad_binding',[pad(edge,i/32) for i in range(33)],.008,trim)
    tube('cat_pad_binding',[pad(i/32,edge) for i in range(33)],.008,trim)
    tube('cat_seat_binding',[seat(edge,i/24) for i in range(25)],.008,trim)
    tube('cat_seat_binding',[seat(i/24,edge) for i in range(25)],.008,trim)
for sign in [-1,1]:
    # Low, open side flaps leave room for the rider's bent knees.
    surface('cat_saddle_flap_'+str(sign),14,10,lambda u,t,sign=sign:[sign*(.25+.10*math.sin(t*math.pi/2)),1.57-t*.38,-.12+(u-.5)*.38],leather)
    tube('cat_stirrup_strap',[[sign*.23,1.59,-.13],[sign*.42,1.32,-.04],[sign*.51,1.14,.035]],.017,leather)
    tube('cat_stirrup',[[sign*.51,1.15,.035],[sign*.59,.99,.035],[sign*.51,.96,.035],[sign*.43,.99,.035],[sign*.51,1.15,.035]],.012,brass)
# Retain the armoured mount design, fitted to this cat's actual shoulder/hip.
for sign in [-1,1]:
    for end,z0,z1 in [('shoulder',.38,.80),('hip',-1.03,-.69)]:
        def panel(u,t,sign=sign,z0=z0,z1=z1):
            z=z0+(z1-z0)*t;angle=.76+u*.91
            center=B((0,1.02,z));direction=Vector((sign*math.sin(angle),0,math.cos(angle)))
            hit=bvh.ray_cast(center+direction*.85,-direction)
            p=(hit[0] if hit[0] else center+direction*.30)+direction*.035
            return [p.x,p.z,-p.y]
        surface('cat_armour_'+end+'_'+str(sign),12,16,panel,leather)
        for edge in [0,1]:
            tube('cat_armour_binding',[panel(edge,i/20) for i in range(21)],.006,trim)
            tube('cat_armour_binding',[panel(i/20,edge) for i in range(21)],.006,trim)
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
    fitted=o.name.startswith(('cat_armour','cat_pad','cat_saddle_pad'))
    for v in o.data.vertices:
        w=surface_weights(v.co) if fitted else {'cat_torso':1}
        for name,weight in w.items():
            group=o.vertex_groups.get(name) or o.vertex_groups.new(name=name)
            group.add([v.index],weight,'REPLACE')
    modifier=o.modifiers.new('Feline saddle','ARMATURE');modifier.object=rig;o.parent=rig
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
    obj=body.copy();obj.data=body.data.copy();obj.name='cat_body_lod'+str(level)
    bpy.context.collection.objects.link(obj);activate(obj)
    dec=obj.modifiers.new('LOD reduction','DECIMATE');dec.ratio=target/71856
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
        # The downloaded pose looks across its shoulder. Keep the original
        # facial geometry but have the mounted cat look along gameplay +Z.
        rotate('cat_neck','y',.36)
        rotate('cat_head','y',yaw-.36)
        if clip in ['jump','land']:
            a=math.sin(min(t/.6,1)*math.pi/2) if clip=='jump' else math.sin(math.pi*t)
            for side in ['l','r']:
                for end in ['front','rear']:
                    rotate('cat_'+end+'_upper_'+side,'x',(-.35 if clip=='jump' else -.13)*a)
                    rotate('cat_'+end+'_lower_'+side,'x',(.65 if clip=='jump' else .3)*a)
            rotate('cat_torso','x',(-.1 if clip=='jump' else .05)*a)
            if clip=='land':rig.pose.bones['cat_torso'].location=axes['cat_torso']['y']*(-.07*a)
        elif clip=='hit':
            rotate('cat_neck','x',-.12*math.sin(math.pi*t));rotate('cat_head','x',-.08*math.sin(math.pi*t))
        for i in range(5):rotate('cat_tail_'+str(i),'y',math.sin(phase+i*.4)*.035)
        for p in rig.pose.bones:
            p.keyframe_insert('rotation_quaternion',frame=f+1)
            if p.name=='cat_torso':p.keyframe_insert('location',frame=f+1)
    action.use_fake_user=True
rig.animation_data.action=None
for p in rig.pose.bones:p.rotation_quaternion=Quaternion();p.location=Vector()
bpy.context.scene.frame_set(1)
for image in bpy.data.images:
    if max(image.size)>2048:image.scale(2048,2048)
export(out/'black-cat-rig.glb',[rig,*lods,*tack],True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'black-cat-rig.blend'))
report={'sourceSha256':sha,'uniformScale':scale,'sourceHeadingRadians':yaw,'forward':'+Z','unweightedBeforeRepair':unweighted,
    'landmarks':landmarks,'triangles':{o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in lods},'clips':clips,
    'images':[{'name':i.name,'size':list(i.size)} for i in bpy.data.images]}
(out/'build.json').write_text(json.dumps(report,indent=2))
print('BLACK_CAT_BUILD',json.dumps(report))
