"""Retarget the user-selected rigged snow-leopard GLB without replacing its rig.
Blender -b --python-exit-code 1 --python tools/blender/build_snow_leopard.py -- --source-glb PATH
 --donor-decoded output/snow-leopard/donor.glb --output-directory output/snow-leopard
Meshopt/source-preserving LOD packaging: tools/blender/snow_leopard_package.mjs.
"""
import argparse,bpy,hashlib,json,math,sys
import numpy as np
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--skin-mode',choices=['original','fitted'],default='fitted');p.add_argument('--source-glb',required=True);p.add_argument('--donor-decoded',required=True);p.add_argument('--output-directory',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=Path(a.source_glb);out=Path(a.output_directory);out.mkdir(parents=True,exist_ok=True)
assert hashlib.sha256(source.read_bytes()).hexdigest()=='a149122f5ec78ad5573fb5591f4993867bae29b56a75b4979fa4b3592e8d674c','Review replacement source explicitly'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source));rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');body=next(o for o in bpy.data.objects if o.type=='MESH' and o.name=='output_unwrapped')
for o in list(bpy.data.objects):
 if o not in [rig,body]:bpy.data.objects.remove(o,do_unlink=True)
rig.name='snow_leopard_rig';body.name='snow_leopard_body_lod0'
# Preserve native rest matrices, source positions, corner normals, and UV loops.
source_rest={b.name:[list(r) for r in b.matrix_local] for b in rig.data.bones};source_positions=[tuple(v.co) for v in body.data.vertices];source_normals=[tuple(n.vector) for n in body.data.corner_normals]
mat=body.data.materials[0];shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');images=[n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'];base=next(i for i in images if 'metallic' not in i.name);mr=next(i for i in images if 'metallic' in i.name)
# Read source material mask before resizing maps. UV-identical vertex copies agree.
mr.colorspace_settings.name='Non-Color';mr.scale(1024,1024);pixels=list(mr.pixels);size=1024
metal=[[] for _ in body.data.vertices]
for loop in body.data.loops:
 u,v=body.data.uv_layers.active.data[loop.index].uv;x=min(size-1,max(0,int(u*size)));y=min(size-1,max(0,int(v*size)));metal[loop.vertex_index].append(pixels[(y*size+x)*4+2])
metal=[sum(m)/len(m) if m else 0 for m in metal]
coincident={}
for v in body.data.vertices:coincident.setdefault(tuple(round(x,6) for x in v.co),[]).append(v.index)
for indices in coincident.values():
 value=max(metal[i] for i in indices)
 for i in indices:metal[i]=value
base.scale(2048,2048);base.file_format='JPEG';base.filepath_raw=str(out/'base-color.jpg');base.save();mr.file_format='PNG';mr.filepath_raw=str(out/'metallic-roughness.png');mr.save()
# Authored plate regions are measured in the unchanged source rest coordinates.
# Thin edge collars retain the source chainmail/skin blend; plate interiors are rigid.
original_weights=[{body.vertex_groups[g.group].name:g.weight for g in v.groups} for v in body.data.vertices];patched={};plate_regions={};plate_specs={};plate_members={}
def assign(i,w):
 for g in body.vertex_groups:g.remove([i])
 w=dict(sorted(w.items(),key=lambda p:p[1],reverse=True)[:4]);total=sum(w.values())
 for n,value in w.items():body.vertex_groups[n].add([i],value/total,'REPLACE')
def box_alpha(p,bounds,feather):
 return max(0,min(1,min(min(v-lo,hi-v) for v,(lo,hi) in zip(p,bounds))/feather))
# Bounds select visible side plates, excluding the source midline saddle and belly.
for side,sign in [('l',1),('r',-1)]:
 plate_specs['plate_shoulder_'+side]=dict(sign=sign,bounds=[(.275,.66),(-1.14,-.57),(.565,1.325)],feather=.045)
 plate_specs['plate_hip_'+side]=dict(sign=sign,bounds=[(.28,.64),(.105,.86),(.555,1.29)],feather=.045)
plate_specs['plate_croup']=dict(sign=1,bounds=[(-.62,.62),(.21,.94),(1.18,1.67)],feather=.035)
vertex_plate={}
for v in body.data.vertices:
 x,y,z=v.co
 if a.skin_mode=='original':continue
 # Leave chainmail, fur and leather outside the separately measured saddle intact.
 choices=[]
 if metal[v.index]>.48:
  for name,spec in plate_specs.items():
   alpha=box_alpha((x*spec['sign'],y,z),spec['bounds'],spec['feather'])
   if alpha>0:choices.append((alpha,name))
 if choices:
  alpha,name=max(choices,key=lambda p:(p[0],p[1]=='plate_croup'));vertex_plate[v.index]=(name,alpha);plate_members.setdefault(name,[]).append(v.index)
# Build rigid fit bones, keeping every original bone and its exact rest transform.
def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
activate(rig);bpy.ops.object.mode_set(mode='EDIT')
for name,indices in plate_members.items():
 center=sum((body.data.vertices[i].co for i in indices),Vector())/len(indices);b=rig.data.edit_bones.new(name);b.head=center;b.tail=center+Vector((0,0,.1));b.parent=rig.data.edit_bones['Bone_000'];b.use_deform=True
bpy.ops.object.mode_set(mode='OBJECT')
for name in plate_members:body.vertex_groups.new(name=name)
for i,(name,alpha) in vertex_plate.items():
 w={n:v*(1-alpha) for n,v in original_weights[i].items()};w[name]=alpha;assign(i,w);patched[i]=name
plate_fit={}
for name,indices in plate_members.items():
 # Uniformly sample actual source plate vertices; UV duplicates do not bias the fit.
 unique={tuple(source_positions[i]):i for i in indices if vertex_plate[i][1]>.99};ids=list(unique.values());ids=ids[::max(1,len(ids)//300)]
 points=np.array([source_positions[i] for i in ids]);weights=np.zeros((len(ids),48))
 for row,i in enumerate(ids):
  for bone,value in original_weights[i].items():weights[row,int(bone[5:])]=value
 plate_fit[name]=(points,weights);plate_regions[name]={'vertices':len(indices),'rigidCoreVertices':sum(vertex_plate[i][1]>.99 for i in indices),'fitVertices':len(ids),'sourceBounds':plate_specs[name]}
# Rigid helmet and saddle bearing have very small native axial articulation.
for v in body.data.vertices:
 if a.skin_mode=='original' or v.index in vertex_plate:continue
 x,y,z=v.co
 alpha=box_alpha((x,y,z),[(-.46,.46),(-.59,.25),(.79,1.78)],.05)
 if .28<abs(x)<.55 and -.36<y<.06 and .50<z<1.02:alpha=1
 if alpha>0:n='Bone_001'
 elif y<-1.40 and z>.92 and metal[v.index]>.48:n='Bone_024';alpha=min(1,(-1.40-y)/.04)
 else:continue
 w={bone:value*(1-alpha) for bone,value in original_weights[v.index].items()};w[n]=w.get(n,0)+alpha;assign(v.index,w);patched[v.index]=n
# Add measured bearing socket while preserving all48 native source joints.
def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
bvh=BVHTree.FromPolygons([v.co for v in body.data.vertices],[p.vertices for p in body.data.polygons]);seat=bvh.ray_cast(Vector((0,-.1666,3)),Vector((0,0,-1)))[0]
activate(rig);bpy.ops.object.mode_set(mode='EDIT')
for n,pos in [('socket_saddle_seat',seat),('socket_camera',seat+Vector((0,0,.30)))]:
 bone=rig.data.edit_bones.new(n);bone.head=pos;bone.tail=pos+Vector((0,0,.05));bone.parent=rig.data.edit_bones['Bone_001'];bone.use_deform=False
bpy.ops.object.mode_set(mode='OBJECT');rest_target={n:b.matrix_local.copy() for n,b in rig.data.bones.items()}
# Mappings are geometric, never based on assuming source naming/bases match donor.
mapping={}
def mapto(names,donor):
 for name in names:mapping['Bone_'+str(name).zfill(3)]=donor
mapto([0,1,3,2],'cat_torso');mapto([17,16,15,14,31,37],'cat_chest');mapto([25],'cat_neck');mapto([24,23],'cat_head')
for side,bones in [('l',[30,29,28,27]),('r',[36,35,34,33])]:
 for number,tag in zip(bones,['upper','lower','lower','paw']):mapto([number],'cat_front_'+tag+'_'+side)
for side,bones in [('l',[22,21,20,19]),('r',[13,12,11,10])]:
 for number,tag in zip(bones,['upper','lower','ankle','paw']):mapto([number],'cat_rear_'+tag+'_'+side)
mapto([18],'cat_rear_paw_l');mapto([9],'cat_rear_paw_r')
for index,number in enumerate([8,7,6,5,4]):mapto([number],'cat_tail_'+str(index))
# Decode/import current Production BlackCat; sample poses at original durations.
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(Path(a.donor_decoded).resolve()));donor_objects=set(bpy.data.objects)-before;donor=next(o for o in donor_objects if o.type=='ARMATURE');donor.animation_data_create();scene=bpy.context.scene;source_fps=scene.render.fps
clips=['idle','walk','run','jump','land','hit','death'];source_actions={clip:next(ac for ac in bpy.data.actions if ac.name==clip or ac.name.startswith(clip+'_')) for clip in clips};rest={n:(donor.matrix_world@b.matrix_local).copy() for n,b in donor.data.bones.items()};samples={};durations={}
for clip,act in source_actions.items():
 donor.animation_data.action=act
 if getattr(act,'slots',None):donor.animation_data.action_slot=act.slots[0]
 start,end=act.frame_range;duration=(end-start)/source_fps;durations[clip]=duration;count=round(duration*60);poses=[]
 for f in range(count+1):
  frame=start+(end-start)*f/count;scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update();poses.append({n:(donor.matrix_world@donor.pose.bones[n].matrix).copy() for n in rest})
 samples[clip]=poses
for o in donor_objects:bpy.data.objects.remove(o,do_unlink=True)
for action in source_actions.values():bpy.data.actions.remove(action)
scene.render.fps=60;rig.animation_data_create()

def world_rotation(n,q):
 pb=rig.pose.bones[n];parent=pb.parent
 if parent:q=(parent.matrix.to_quaternion()@parent.bone.matrix_local.to_quaternion().inverted()).inverted()@q
 pb.rotation_quaternion=pb.bone.matrix_local.to_quaternion().inverted()@q;bpy.context.view_layer.update()

# Precompute donor-derived distal swing with angular interpolation (not vector lerp).
def smooth(value):
 value=max(0,min(1,value));return value*value*(3-2*value)
run_distal={};stance={};run_count=len(samples['run'])-1
for side in ['l','r']:
 donor_name='cat_rear_paw_'+side;heights=[sample[donor_name].translation.z for sample in samples['run']];minimum=min(heights)
 low=float(np.quantile(heights[:-1],.25));high=float(np.quantile(heights[:-1],.45))
 stance[side]=[smooth((high-z)/(high-low)) for z in heights]
 for toe in [False,True]:
  angles=[]
  for sample in samples['run'][:-1]:
   paw=sample[donor_name].translation;hip=sample['cat_rear_upper_'+side].translation;floor=rest[donor_name].translation.z
   release=smooth((paw.z-floor-.05)/.35)*smooth((paw.y-hip.y-.15)/.50)
   direction=sample[donor_name].to_quaternion()@Vector((0,1,0));ankle=sample['cat_rear_ankle_'+side].to_quaternion()@Vector((0,1,0))
   angle=math.atan2(direction.z,-direction.y);other=math.atan2(ankle.z,-ankle.y);difference=(other-angle+math.pi)%(2*math.pi)-math.pi
   angles.append(angle+difference*release*(1 if toe else .88))
  angles=np.unwrap(angles);kernel=np.exp(-.5*(np.arange(-7,8)/3.0)**2);kernel/=kernel.sum();filtered=[sum(angles[(i+j)%run_count]*k for j,k in zip(range(-7,8),kernel)) for i in range(run_count)];filtered.append(filtered[0]);run_distal[(side,toe)]=[Vector((0,-math.cos(v),math.sin(v))) for v in filtered]
run_limb={}
for donor_name in sorted(set(mapping.values())):
 if not any(tag in donor_name for tag in ['_upper_','_lower_','_ankle_','_paw_']):continue
 angles=[]
 for sample in samples['run'][:-1]:
  direction=sample[donor_name].to_quaternion()@Vector((0,1,0));angles.append(math.atan2(direction.z,-direction.y))
 angles=np.unwrap(angles);kernel=np.exp(-.5*(np.arange(-4,5)/1.25)**2);kernel/=kernel.sum();filtered=[sum(angles[(i+j)%run_count]*k for j,k in zip(range(-4,5),kernel)) for i in range(run_count)];filtered.append(filtered[0]);run_limb[donor_name]=[Vector((0,-math.cos(v),math.sin(v))) for v in filtered]

# Actual native foot surface groups used for contact correction after body placement.
foot_vertices={side:[i for i,p in enumerate(source_positions) if p[2]<.2 and sum(w for n,w in original_weights[i].items() if int(n[5:]) in chain)>.6] for side,chain in [('l',[20,19,18]),('r',[11,10,9]),('front_l',[28,27,26]),('front_r',[34,33,32])]}

contacts={}
for clip in ['run','walk']:
 contacts[clip]={}
 for side,donor_name in [('l','cat_rear_paw_l'),('r','cat_rear_paw_r'),('front_l','cat_front_paw_l'),('front_r','cat_front_paw_r')]:
  heights=[sample[donor_name].translation.z for sample in samples[clip]];low=float(np.quantile(heights[:-1],.25));high=float(np.quantile(heights[:-1],.50))
  contacts[clip][side]=[smooth((high-z)/max(.001,high-low)) for z in heights]
  if clip=='run' and side.startswith('front'):
   count=len(heights)-1;core=[i for i,z in enumerate(heights[:-1]) if z<=low]
   envelope=[smooth(1-min(min(abs(i-j),count-abs(i-j)) for j in core)/6) for i in range(count)];contacts[clip][side]=envelope+[envelope[0]]
tail_vertices=[i for i,w in enumerate(original_weights) if sum(value for n,value in w.items() if int(n[5:]) in [4,5,6,7,8])>.5]
def clear_tail():
 bpy.context.view_layer.update();evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());height=min(evaluated.data.vertices[i].co.z for i in tail_vertices)
 if height>=.002:return 0
 q=rig.pose.bones['Bone_008'].matrix.to_quaternion().copy();low=0;high=math.radians(45)
 for _ in range(15):
  angle=(low+high)/2;world_rotation('Bone_008',Quaternion((1,0,0),angle)@q);evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());height=min(evaluated.data.vertices[i].co.z for i in tail_vertices)
  if height<.002:low=angle
  else:high=angle
 world_rotation('Bone_008',Quaternion((1,0,0),high)@q);return high

def fit_plates():
 native=np.array([rig.pose.bones['Bone_'+str(i).zfill(3)].matrix @ rest_target['Bone_'+str(i).zfill(3)].inverted() for i in range(48)])
 for name,(points,weights) in plate_fit.items():
  moved=np.einsum('nb,bij,nj->ni',weights,native,np.c_[points,np.ones(len(points))])[:,:3];c=points.mean(axis=0);d=moved.mean(axis=0);u,_,vh=np.linalg.svd((points-c).T@(moved-d));rot=vh.T@u.T
  if np.linalg.det(rot)<0:vh[-1,:]*=-1;rot=vh.T@u.T
  transform=Matrix(rot.tolist()).to_4x4();transform.translation=Vector(d-rot@c);rig.pose.bones[name].matrix=transform@rest_target[name];bpy.context.view_layer.update()

def solve_hind_contact(side,desired_height):
 numbers={'l':[22,21,20,19,18],'r':[13,12,11,10,9],'front_l':[30,29,28,27,26],'front_r':[36,35,34,33,32]}[side];names=['Bone_'+str(n).zfill(3) for n in numbers];distal={n:rig.pose.bones[n].matrix.to_quaternion().copy() for n in names[3:]}
 for iteration in range(5):
  bpy.context.view_layer.update();evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());height=min(evaluated.data.vertices[i].co.z for i in foot_vertices[side]);error=height-desired_height
  if abs(error)<.0005:break
  points=[rig.pose.bones[n].head.copy() for n in names[:4]];anchor=points[0].copy();lengths=[(points[i+1]-points[i]).length for i in range(3)];target=points[-1].copy();target.z-=error
  direction=target-anchor
  if direction.length>sum(lengths)*.999:target=anchor+direction.normalized()*sum(lengths)*.999
  if side.startswith('front') and clip=='run':
   # Native front lower/carpal segments share one donor lower direction. Treat
   # their existing shape as one assembly, rather than letting a redundant
   # straight joint flip independently under a three-link IK solution.
   q0=rig.pose.bones[names[0]].matrix.to_quaternion().copy();lower={n:rig.pose.bones[n].matrix.to_quaternion().copy() for n in names[1:3]};chord=points[3]-points[1];l1=lengths[0];l2=chord.length
   axis=(target-anchor).normalized();distance=min(l1+l2-.0001,max(abs(l1-l2)+.0001,(target-anchor).length));target=anchor+axis*distance
   along=(l1*l1-l2*l2+distance*distance)/(2*distance);bend=math.sqrt(max(0,l1*l1-along*along));pole=Vector((0,1,0));pole-=axis*pole.dot(axis)
   if pole.length<.0001:pole=Vector((0,0,-1));pole-=axis*pole.dot(axis)
   elbow=anchor+axis*along+pole.normalized()*bend
   world_rotation(names[0],(q0@Vector((0,1,0))).rotation_difference((elbow-anchor).normalized())@q0)
   turn=chord.normalized().rotation_difference((target-elbow).normalized())
   for n,q in lower.items():world_rotation(n,turn@q)
  else:
   # FABRIK keeps the native three segment lengths and starts from its current
   # knee/hock bend. No bone translation/scaling or source rest edits are used.
   for _ in range(30):
    points[-1]=target.copy()
    for i in range(2,-1,-1):points[i]=points[i+1]+(points[i]-points[i+1]).normalized()*lengths[i]
    points[0]=anchor.copy()
    for i in range(3):points[i+1]=points[i]+(points[i+1]-points[i]).normalized()*lengths[i]
    if (points[-1]-target).length<.00005:break
   for i,n in enumerate(names[:3]):
    current=rig.pose.bones[n].matrix.to_quaternion();axis=current@Vector((0,1,0));world_rotation(n,axis.rotation_difference((points[i+1]-points[i]).normalized())@current)
  for n,q in distal.items():world_rotation(n,q)
 return height

report={'sourceFile':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'retarget':{'runLimbs':'Absolute anatomical segment direction into native lengths and rest roll; periodic sigma1.25-frame direction filtering removes single-sample donor turns; no angle clamps','otherClips':'Native rest-basis world rotation deltas; walk adds per-foot donor-phase stance contact; idle/walk/run tail clearance rotates native tail base before body floor correction','runDistal':'Signed sagittal angle interpolation from donor paw to metatarsal using donor height and hip-relative extension; periodic Gaussian sigma3frames; extra native toe articulated','runContact':'Native-length local sole penetration correction on all four feet before whole-body floor correction, then all-foot donor-phase stance contact (front run six-frame contact envelope and two-link lower/carpal assembly, other stance q25/q50); baked only'},'sourceNativeHeightM':1.7,'sourceTriangles':29161,'sourceJointCount':48,'sourceRestMatrices':source_rest,'mapping':mapping,'seatGame':[seat.x,seat.z,-seat.y],'armor':{'method':'Source metallic UV mask with measured shoulder, hip and croup volumes, rigid least-squares fitted controllers, 35-45mm edge collars retaining native skin, rigid saddle and helmet cores','patchedVertices':len(patched),'retainedVertexSkin':len(original_weights)-len(patched),'regions':plate_regions},'clips':{}}
for clip in clips:
 act=bpy.data.actions.new(clip);act.use_fake_user=True;rig.animation_data.action=act;previous={};paw_limited=0;proximal_limited=0
 for frame,sample in enumerate(samples[clip],1):
  for pb in rig.pose.bones:pb.rotation_mode='QUATERNION';pb.matrix_basis=Matrix.Identity(4)
  for name,donor_name in mapping.items():
   delta=sample[donor_name].to_quaternion()@rest[donor_name].to_quaternion().inverted()
   if clip=='run' and any(tag in donor_name for tag in ['_upper_','_lower_','_ankle_','_paw_']):
    # Limb rest poses differ: source static paw staggering must not become a
    # persistent angular offset. Transfer anatomical directions, retaining roll.
    target_axis=rest_target[name].to_quaternion()@Vector((0,1,0));desired=run_limb[donor_name][frame-1]
    if '_rear_paw_' in donor_name:desired=run_distal[(donor_name[-1],name in ['Bone_018','Bone_009'])][frame-1]
    delta=target_axis.rotation_difference(desired)
   world_rotation(name,delta@rest_target[name].to_quaternion())
  translation=sample['cat_torso'].translation-rest['cat_torso'].translation;translation.x=0;translation.y=0;translation.z*=rest_target['Bone_000'].translation.z/rest['cat_torso'].translation.z
  rig.pose.bones['Bone_000'].location=rest_target['Bone_000'].to_3x3().inverted()@translation;bpy.context.view_layer.update()
  fit_plates()
  for pb in rig.pose.bones:
   q=pb.rotation_quaternion.normalized()
   if pb.name in previous and q.dot(previous[pb.name])<0:q.negate()
   pb.rotation_quaternion=q;previous[pb.name]=q.copy();pb.keyframe_insert('rotation_quaternion',frame=frame);pb.keyframe_insert('location',frame=frame)
 curves=act.fcurves if not hasattr(act,'layers') else [curve for layer in act.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
 for curve in curves:
  for key in curve.keyframe_points:key.interpolation='LINEAR'
 report['clips'][clip]={'duration':durations[clip],'frames':len(samples[clip]),'fps':60,'pawPoseSamplesLimited':paw_limited,'proximalPoseSamplesLimited':proximal_limited}
# Sample deformed final source surface and correct only penetrations (death rests on flank).
for clip in clips:
 action=bpy.data.actions[clip];rig.animation_data.action=action
 if getattr(action,'slots',None):rig.animation_data.action_slot=action.slots[0]
 corrections=[];contact_errors=[];last_quaternions={}
 for frame in range(1,len(samples[clip])+1):
  scene.frame_set(frame);bpy.context.view_layer.update()
  if clip in ['run','walk']:
   # Correct penetrating soles locally before considering any whole-body lift.
   for side in ['front_l','front_r','l','r']:
    evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());height=min(evaluated.data.vertices[i].co.z for i in foot_vertices[side])
    if height<.002:solve_hind_contact(side,.002)
   fit_plates()
  if clip in ['idle','walk','run']:clear_tail()
  evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());low=min(v.co.z for v in evaluated.data.vertices);correction=(.002-low) if clip=='death' else max(0,.002-low)
  root=rig.pose.bones['Bone_000'];root.location+=rest_target['Bone_000'].to_3x3().inverted()@Vector((0,0,correction));root.keyframe_insert('location',frame=frame);corrections.append(correction)
  if clip in ['idle','walk','run']:
   bpy.context.view_layer.update()
   for side in ([] if clip=='idle' else ['l','r','front_l','front_r']):
    contact=contacts[clip][side][frame-1]
    if contact<=.0001:continue
    evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());height=min(evaluated.data.vertices[i].co.z for i in foot_vertices[side]);goal=(1-contact)*height+contact*.002;solve_hind_contact(side,goal)
   fit_plates()
   for pb in rig.pose.bones:
    q=pb.rotation_quaternion.normalized()
    if pb.name in last_quaternions and q.dot(last_quaternions[pb.name])<0:q.negate()
    pb.rotation_quaternion=q;last_quaternions[pb.name]=q.copy();pb.keyframe_insert('rotation_quaternion',frame=frame);pb.keyframe_insert('location',frame=frame)
   bpy.context.view_layer.update();evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());contact_errors.append({side:min(evaluated.data.vertices[i].co.z for i in foot_vertices[side]) for side in ['l','r']})
 report['clips'][clip]['maximumGroundCorrectionM']=max(corrections)
 if clip=='run':report['clips'][clip]['hindSoleHeightsM']=contact_errors
# Source-position-welded connected surface regions replace the rejected sparse
# triangle masks. UV/normal duplicates inside each patch share one controller.
# Fused connections use continuous collars; original geometry and corner data stay.
regions=json.loads(Path(__file__).with_name('snow_leopard_skin_regions.json').read_text());assert regions['sourceSha256']==hashlib.sha256(source.read_bytes()).hexdigest()
coherent_patches=regions['patches']
if a.skin_mode=='fitted':
 from collections import deque
 mesh=body.data;canonical=[tuple(round(c,6) for c in v.co) for v in mesh.vertices];point_ids={};copies={}
 for i,key in enumerate(canonical):
  point_ids.setdefault(key,len(point_ids));copies.setdefault(point_ids[key],[]).append(i)
 assert len(point_ids)==regions['canonicalPositions'],'Canonical source vertex order changed'
 vertex_point=[point_ids[k] for k in canonical];adjacency={i:set() for i in copies};point_faces={i:set() for i in copies}
 for poly in mesh.polygons:
  points=[vertex_point[i] for i in poly.vertices]
  for i in points:point_faces[i].add(poly.index)
  for i,j in zip(points,points[1:]+points[:1]):adjacency[i].add(j);adjacency[j].add(i)
 field={point:{body.vertex_groups[g.group].name:g.weight for g in mesh.vertices[indices[0]].groups} for point,indices in copies.items()}
 # The torso/strap domain overlaps the connected inner thighs and shoulders.
 # Retain the native limb field across that collar instead of pinning it to
 # Bone_001: otherwise an axial vertex and its moving neighbour form a sheet.
 # Use all native chain influences, including zero-weight neighbours via the
 # smooth collar, rather than guessing limb ownership from a bounding box.
 limb_bones={'Bone_'+str(n).zfill(3) for n in list(range(9,14))+list(range(18,23))+list(range(26,31))+list(range(32,37))}
 limb_collar={};native_field={}
 for point,indices in copies.items():
  native=original_weights[indices[0]].copy()
  # Inner attachment skin is shared with the axial body, not a rigid calf.
  # Route distal pull through the corresponding upper segment in this band;
  # actual paw/shaft cores (without axial weight) remain exactly native.
  axial=sum(weight for name,weight in native.items() if name in {'Bone_000','Bone_001','Bone_002','Bone_003','Bone_014','Bone_015','Bone_016','Bone_017','Bone_031','Bone_037'})
  t=max(0,min(1,(axial-.15)/.20));proximal=t*t*(3-2*t);t=max(0,min(1,(mesh.vertices[indices[0]].co.z-.45)/.25));proximal*=t*t*(3-2*t)
  for chain,upper in [([9,10,11,12],13),([18,19,20,21],22),([26,27,28,29],30),([32,33,34,35],36)]:
   upper='Bone_'+str(upper).zfill(3)
   for number in chain:
    name='Bone_'+str(number).zfill(3);transfer=native.get(name,0)*proximal
    if transfer:native[name]-=transfer;native[upper]=native.get(upper,0)+transfer
  native_field[point]=native
  influence=sum(weight for name,weight in native.items() if name in limb_bones)
  t=max(0,min(1,(influence-.15)/.45));blend=t*t*(3-2*t)
  # The native hip/shoulder pivots are at 1.10-1.13m. Fade below them,
  # preserving the saddle bearing and upper torso instead of softening armor.
  height=mesh.vertices[indices[0]].co.z;t=max(0,min(1,(1.13-height)/.23));blend*=t*t*(3-2*t);limb_collar[point]=blend
  if blend:
   current=field[point];field[point]={name:current.get(name,0)*(1-blend)+native.get(name,0)*blend for name in set(current)|set(native)}
 patch_reports=[]
 for patch in coherent_patches:
  face_set=set(patch['faces']);points={vertex_point[i] for face in face_set for i in mesh.polygons[face].vertices};excluded=set(patch['excludedCanonicalPoints']);boundary={point for point in points if point_faces[point]-face_set}|(excluded&points)
  distance={point:0 for point in boundary};queue=deque(boundary)
  while queue:
   point=queue.popleft()
   for other in adjacency[point]&points:
    if other not in distance:distance[other]=distance[point]+1;queue.append(other)
  rigid_count=0
  for point in points:
   if point in excluded:continue
   t=min(1,distance.get(point,3)/3);alpha=t*t*(3-2*t)
   if patch['controller']=='Bone_001':alpha*=1-limb_collar[point]
   if not alpha:continue
   weights={name:value*(1-alpha) for name,value in field[point].items()};weights[patch['controller']]=weights.get(patch['controller'],0)+alpha;field[point]=weights
   rigid_count+=alpha==1
  patch_reports.append({'id':patch['id'],'controller':patch['controller'],'sourceFaces':len(face_set),'canonicalPoints':len(points),'boundaryPoints':len(boundary),'rigidInteriorPoints':rigid_count,'transition':'Three position-welded edge rings, smoothstep to unchanged boundary field'})
 # Overlapping fields never soften the source-verified rigid plate cores.
 for controller,points in regions['lockedCoreCanonicalPointsByController'].items():
  for point in points:field[point]={controller:1}
 # Relax the shared attachment field on both sides of the collar, not only
 # vertices that already have limb weights. Fixed distal, torso and rigid-armor
 # cores bound this local harmonic solve; geometry and rest bones never move.
 locked={point for points in regions['lockedCoreCanonicalPointsByController'].values() for point in points}
 coordinates={point:mesh.vertices[indices[0]].co for point,indices in copies.items()}
 collar={point for point in copies if .48<coordinates[point].z<1.35 and sum(weight for name,weight in native_field[point].items() if name in limb_bones)>.05}
 for _ in range(2):collar|={other for point in collar for other in adjacency[point] if .48<coordinates[other].z<1.35}
 # Keep the accepted saddle panel/bearing and the fitted armor interiors rigid.
 fixed=locked|{point for point in copies if coordinates[point].z<=.53 or coordinates[point].z>=1.35 or (-.54<coordinates[point].y<.08 and coordinates[point].z>.98)}
 for point in collar:
  if any(name.startswith('plate_') and weight>.999 for name,weight in field[point].items()):fixed.add(point)
 free=sorted(collar-fixed);names=[group.name for group in body.vertex_groups];columns={name:i for i,name in enumerate(names)}
 values=np.zeros((len(copies),len(names)))
 for point,weights in field.items():
  for name,weight in weights.items():values[point,columns[name]]=weight
 initial=values.copy();links=np.array([(point,other) for point in free for other in adjacency[point]],dtype=int)
 if len(links):
  lengths=np.array([max(.005,(coordinates[point]-coordinates[other]).length) for point,other in links]);conductance=1/lengths
  degree=np.bincount(links[:,0],weights=conductance,minlength=len(copies));screen=.03*degree
  for _ in range(120):
   total=np.zeros_like(values);np.add.at(total,links[:,0],values[links[:,1]]*conductance[:,None])
   values[free]=(total[free]+initial[free]*screen[free,None])/(degree[free]+screen[free])[:,None]
  for point in free:field[point]={name:float(values[point,column]) for name,column in columns.items() if values[point,column]>1e-8}
 all_indices=list(range(len(mesh.vertices)))
 for group in body.vertex_groups:group.remove(all_indices)
 for point,indices in copies.items():
  weights=dict(sorted(field[point].items(),key=lambda item:item[1],reverse=True)[:4]);total=sum(weights.values());weights={name:value/total for name,value in weights.items() if value>1e-8}
  for name,value in weights.items():body.vertex_groups[name].add(indices,value,'REPLACE')
 # The source topology is intact, so internal UV/normal seams cannot separate.
 maximum_copy_weight_error=0
 for indices in copies.values():
  reference={body.vertex_groups[g.group].name:g.weight for g in mesh.vertices[indices[0]].groups}
  for index in indices[1:]:
   weights={body.vertex_groups[g.group].name:g.weight for g in mesh.vertices[index].groups};maximum_copy_weight_error=max(maximum_copy_weight_error,max((abs(reference.get(name,0)-weights.get(name,0)) for name in set(reference)|set(weights)),default=0))
 assert maximum_copy_weight_error==0
 report['armor']['method']='Source material/geometry anchors and position-welded connected skin fields; fitted rigid plate cores, upper-segment limb-root support, harmonic attachment collars and axial belly straps; unchanged source topology'
 report['armor']['limbRootCollar']={'method':'Restore upper-segment participation in axial/limb bridges, retain native distal cores, and preserve limb weights through the overlapping torso/strap domain, with smooth native-chain influence collar from 0.15 to 0.60, fading from 0.90m to the 1.13m native proximal pivots; axial scapula helpers, saddle bearing and rigid plate cores retained','canonicalPoints':sum(value>0 for value in limb_collar.values()),'harmonicCollarPoints':len(free),'harmonicIterations':120,'harmonicScreen':.03}
 report['armor']['innerLining']={'addedFaces':0,'addedVertices':0,'note':'Rejected synthetic lining removed; original connected torso surface retained'}
 report['armor']['recessedBacking']={'addedFaces':0,'addedVertices':0,'note':'Rejected isolated triangle copies removed'}
 report['armor']['connectorUnderlap']={'faces':sum(len(p['faces']) for p in coherent_patches),'sourceTopologyUnchanged':True,'maximumCoincidentCopyWeightError':maximum_copy_weight_error,'patches':patch_reports,'method':'Position-welded source surface fields with three-ring continuous collars. All original triangles remain connected; coincident UV/normal copies share identical weights. No split edges, added geometry or moved source vertices.'}

# Source triangles, surface positions, UVs, normals and rest matrices remain
# unchanged. Only the shared canonical skin field is repaired.
assert all(tuple(v.co)==p for v,p in zip(body.data.vertices,source_positions))
normal_error=max((n.vector-Vector(p)).length for n,p in zip(body.data.corner_normals,source_normals));print('NORMAL_DIRECTION_MAX_ERROR',normal_error);assert normal_error<.002
assert all([list(r) for r in rig.data.bones[n].matrix_local]==matrix for n,matrix in source_rest.items())
report['preservation']={'sourcePositionsExact':True,'sourceCornerNormalMaxError':normal_error,'source48RestMatricesExact':True,'sourceUV':'unchanged'}
lods=[body]
for level in [1,2]:
 obj=body.copy();obj.data=body.data.copy();obj.name='snow_leopard_body_lod'+str(level);bpy.context.scene.collection.objects.link(obj);lods.append(obj)
rig.animation_data.action=None
for clip in clips:
 action=bpy.data.actions[clip];track=rig.animation_data.nla_tracks.new();track.name=clip;strip=track.strips.new(clip,1,action);strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
 if getattr(action,'slots',None):strip.action_slot=action.slots[0]
for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
scene.frame_set(0);activate(rig)
for obj in lods:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'snow-leopard-uncompressed.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_frame_step=1,export_anim_slide_to_zero=True,export_optimize_animation_size=False,export_def_bones=False,export_armature_object_remove=False,export_leaf_bone=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'snow-leopard-build.blend'));(out/'build-report.json').write_text(json.dumps(report,indent=2)+'\n');print('SNOW_LEOPARD_BUILD',json.dumps({k:v for k,v in report.items() if k!='sourceRestMatrices'}))
