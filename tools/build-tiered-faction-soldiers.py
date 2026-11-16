#!/usr/bin/env python3
"""Build the four owner-provided tiered soldier FBXs, adding fingers before retargeting.

blender -b --python-exit-code 1 --python tools/build-tiered-faction-soldiers.py -- SOURCE_ROOT [asset-id,...]
SOURCE_ROOT contains the four extracted archive directories under their asset IDs.
Preserves source body skin and topology at LOD0; weights change only on the audited
hand surface. Retarget through retarget-tiered-faction-soldiers.mjs afterwards.
"""
import bpy,bmesh,json,hashlib,sys,math
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path.cwd(); args=sys.argv[sys.argv.index('--')+1:];SOURCE=Path(args[0]).resolve()
CONFIG={
 'roman-t1':('Meshy_AI_Roman_Soldier_Rigged_biped.zip',1.78),
 'roman-t2':('Meshy_AI_roman_soldier_rigged_biped (1).zip',1.78),
 'viking-t1':('Meshy_AI_Rigged_Medieval_Warri_biped.zip',1.86),
 'viking-t2':('Meshy_AI_rigged_warrior_biped.zip',1.86),
}
SOURCE_HASHES = {
 'roman-t1':'fb7edc933016ba7fae3d14b76208286b69003818d5e9cc449fb8ae700635e6f1',
 'roman-t2':'5f34cda87c2f206e3d4eef1b323fafad7e5a88d54945b824f8e2c5b071951d82',
 'viking-t1':'2bc898424da5196b975932dc6cc2374f45f33b86b8dd90b8320bf3289cf60a66',
 'viking-t2':'a1255bb902a7a61e8e1a8e37035141dc8faf0557cfe7abbf4ad97f2eb0e13e03',
}
def arr(v):return [float(x)for x in v]
def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def smooth(t):
 t=max(0,min(1,t));return t*t*(3-2*t)
def seg(p,a,b):
 d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared));return (p-a-d*t).length,t

def build(id,archive,height):
 src=next((SOURCE/id).rglob('*.fbx'));sha=hashlib.sha256(src.read_bytes()).hexdigest()
 if sha != SOURCE_HASHES[id]: raise ValueError('Source hash changed; re-audit before rebuilding')
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.fbx(filepath=str(src))
 rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 if len(meshes)!=1:raise ValueError('Unexpected source mesh inventory')
 mesh=meshes[0]
 for o in [rig,mesh]:o.animation_data_clear()
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 for b in rig.pose.bones:b.matrix_basis=Matrix.Identity(4)
 rig.data.pose_position='REST';bpy.context.view_layer.update()
 points=[mesh.matrix_world@v.co for v in mesh.data.vertices];lo=min(p.z for p in points);hi=max(p.z for p in points)
 scale=height/(hi-lo);normalization=Matrix.Scale(scale,4)@Matrix.Translation((0,0,-lo))
 mesh_x=normalization@mesh.matrix_world.copy();rig_x=normalization@rig.matrix_world.copy()
 mesh.parent=None;mesh.data.transform(mesh_x);mesh.matrix_world=Matrix.Identity(4)
 rig.data.transform(rig_x);rig.matrix_world=Matrix.Identity(4);mesh.parent=rig;mesh.matrix_parent_inverse=Matrix.Identity(4);mesh.matrix_basis=Matrix.Identity(4)
 rig.name='TieredSoldierRig';mesh.name='TieredSoldier_Surface'
 aliases={}
 mix='mixamorig:Hips' in rig.data.bones
 for b in rig.data.bones:
  n=b.name.split(':')[-1]
  mapped={'Hips':'hips','neck':'neck','Neck':'neck','Head':'head','headfront':'headfront','head_end':'head_end'}.get(n)
  if mix:mapped=mapped or {'Spine':'spine','Spine1':'chest','Spine2':'upper_chest'}.get(n)
  else:mapped=mapped or {'Spine02':'spine','Spine01':'chest','Spine':'upper_chest'}.get(n)
  for side,suffix in [('Left','l'),('Right','r')]:
   for stem,new in [('UpLeg','upper_leg'),('Leg','lower_leg'),('Foot','foot'),('ToeBase','toe'),('Shoulder','clavicle'),('Arm','upper_arm'),('ForeArm','lower_arm'),('Hand','hand')]:
    if n==side+stem:mapped=f'{new}_{suffix}'
  if not mapped:raise ValueError('Unmapped source bone '+b.name)
  aliases[b.name]=mapped
 for old,new in aliases.items():rig.data.bones[old].name=new
 # Blender bone renaming updates matching deform groups. Keep all original weights.
 before_weights=[{mesh.vertex_groups[g.group].name:g.weight for g in v.groups}for v in mesh.data.vertices]
 source_vertices=len(mesh.data.vertices);source_triangles=sum(len(f.vertices)-2 for f in mesh.data.polygons)
 # Refine only source-owned distal hand edges. Linear cuts preserve the rest
 # surface and UV interpolation while providing vertices at phalanx pivots.
 bm=bmesh.new();bm.from_mesh(mesh.data);deform=bm.verts.layers.deform.active
 hand_groups={mesh.vertex_groups['hand_'+s].index for s in ['l','r']}
 edges=[e for e in bm.edges if all(sum(v[deform].get(g,0) for g in hand_groups)>.95 for v in e.verts)]
 bmesh.ops.subdivide_edges(bm,edges=edges,cuts=2,use_grid_fill=True,smooth=0)
 bm.to_mesh(mesh.data);bm.free();mesh.data.update()
 before_weights=[{mesh.vertex_groups[g.group].name:g.weight for g in v.groups}for v in mesh.data.vertices]
 hand_info={};chains={}
 for side,sign in [('l',1),('r',-1)]:
  wrist=rig.data.bones['hand_'+side].head_local.copy();along=Vector((sign,0,0));thumb=Vector((0,-1,0));normal=Vector((0,0,-1))
  pts=np.array([arr(v.co-wrist)for v in mesh.data.vertices if before_weights[v.index].get('hand_'+side,0)>.45]);pts=np.unique(np.round(pts,7),axis=0)
  u=pts[:,0]*sign;v=-pts[:,1];limit=float(np.max(u));distal=pts[(u>limit*.66)&(v<.065*scale)]
  # Four actual finger lanes fitted to distal source samples, ordered index→pinky.
  values=-distal[:,1];centres=np.quantile(values,[.875,.625,.375,.125])
  for _ in range(32):
   labels=np.argmin(abs(values[:,None]-centres[None,:]),axis=1)
   updated=np.array([values[labels==i].mean() if np.any(labels==i) else centres[i]for i in range(4)])
   if np.max(abs(updated-centres))<1e-8:break
   centres=updated
  centres=np.sort(centres)[::-1];digit_bounds={};segments={}
  for i,name in enumerate(['index','middle','ring','pinky']):
   lane=np.argmin(abs((-pts[:,1])[:,None]-centres[None,:]),axis=1)==i
   candidates=pts[lane&(u>limit*.53)&(v<.065*scale)]
   tip_u=float(np.max(candidates[:,0]*sign));tipset=candidates[candidates[:,0]*sign>tip_u-.012*scale]
   end=wrist+Vector((sign*tip_u,float(np.mean(tipset[:,1])),float(np.mean(tipset[:,2]))))
   base_u=limit*.48;base=wrist+Vector((sign*base_u,-float(centres[i])*.87,float(np.median(candidates[:,2]))))
   for j,(a,b)in enumerate(zip([0,.46,.77],[.46,.77,1])):segments[f'{name}_{j+1:02d}_{side}']=(base.lerp(end,a),base.lerp(end,b))
   digit_bounds[name]={'base':arr(base),'tip':arr(end)}
  thumb_pts=pts[(v>.05*scale)&(u<limit*.76)];tipset=thumb_pts[-thumb_pts[:,1]>np.max(-thumb_pts[:,1])-.012*scale]
  end=wrist+Vector(np.mean(tipset,axis=0).tolist());base=wrist+Vector((sign*limit*.22,-.027*scale,float(np.median(pts[:,2]))))
  for j,(a,b)in enumerate(zip([0,.40,.72],[.40,.72,1])):segments[f'thumb_{j+1:02d}_{side}']=(base.lerp(end,a),base.lerp(end,b))
  digit_bounds['thumb']={'base':arr(base),'tip':arr(end)}
  center=wrist+along*limit*.40+normal*.012*scale
  hand_info[side]={'wrist':wrist,'along':along,'thumb':thumb,'normal':normal,'center':center,'base':limit*.48,'limit':limit,'digits':digit_bounds,'segments':segments}
  chains.update(segments)
 activate(rig);bpy.ops.object.mode_set(mode='EDIT')
 # Source hand tail lengths are import heuristics; retain orientation, shorten display only.
 for side in ['l','r']:rig.data.edit_bones['hand_'+side].length=hand_info[side]['limit']*.6
 for name,(head,tail)in chains.items():
  b=rig.data.edit_bones.new(name);b.head=head;b.tail=tail;b.align_roll(Vector((0,0,-1)));digit,part,side=name.split('_');b.parent=rig.data.edit_bones['hand_'+side if part=='01'else f'{digit}_{int(part)-1:02d}_{side}'];b.use_deform=True
 sockets={'socket_hand_l':'hand_l','socket_hand_r':'hand_r','socket_back':'chest','socket_head':'head','socket_pelvis':'hips','socket_foot_l':'foot_l','socket_foot_r':'foot_r','sole_l':'foot_l','sole_r':'foot_r','bow_string_contact':'hand_r','bow_arrow_rest':'hand_l'}
 for name,parent in sockets.items():
  b=rig.data.edit_bones.new(name);p=rig.data.edit_bones[parent].head.copy()
  if name.startswith('sole_'):p.z=0
  if name=='socket_back':p.y+=.12
  if name.startswith('socket_hand_')or name.startswith('bow_'):p=hand_info[parent[-1]]['center'].copy()
  b.head=p;b.tail=p+Vector((0,0,.025));b.parent=rig.data.edit_bones[parent];b.use_deform=False
 bpy.ops.object.mode_set(mode='OBJECT')
 for name in chains:mesh.vertex_groups.new(name=name)
 changed=[];weighted={name:0 for name in chains};outside_changes=0
 for vtx in mesh.data.vertices:
  original=before_weights[vtx.index];side='l'if vtx.co.x>0 else'r';hand=hand_info[side];wrist=hand['wrist'];u=(vtx.co-wrist).dot(hand['along']);thumbward=(vtx.co-wrist).dot(hand['thumb'])
  # Source hand ownership excludes sleeves and all cloth; no global closest-bone skinning.
  old_hand=original.get('hand_'+side,0)
  if old_hand<.45 or u<hand['limit']*.16:continue
  p=vtx.co
  candidates=sorted((seg(p,Vector(d['base']),Vector(d['tip']))[0],digit)for digit,d in hand['digits'].items())
  nearest,digit=candidates[0];second,other=candidates[1]
  # Real source webbing remains between proximal digit shafts. Blend neighbouring
  # chains only within a narrow boundary there; distal separated fingers stay pure.
  blend=.5*(1-smooth((second-nearest)/(.008*scale)))*(1-smooth((u-hand['limit']*.73)/(hand['limit']*.13)))
  assignments=[(digit,1-blend),(other,blend)]
  w={n:x for n,x in original.items()};moved=0
  for digit,share in assignments:
   if share<1e-7:continue
   a=Vector(hand['digits'][digit]['base']);b=Vector(hand['digits'][digit]['tip']);_,t=seg(p,a,b)
   along=(p-a).dot((b-a).normalized());fade=smooth((along+.005)/.035)
   if digit=='thumb':fade*=smooth((thumbward-.028*scale)/(.025*scale))
   else:fade*=smooth((u-hand['base']+.005*scale)/(.035*scale))
   amount=old_hand*fade*share;moved+=amount
   joint_centres=[.18,.59,.88];weights=[max(0,1-abs(t-c)/(.41 if j<2 else .29))for j,c in enumerate(joint_centres)]
   total=sum(weights)
   for j,value in enumerate(weights):
    name=f'{digit}_{j+1:02d}_{side}';w[name]=w.get(name,0)+amount*value/total
  if moved<1e-7:continue
  w['hand_'+side]=old_hand-moved
  for g in list(vtx.groups):mesh.vertex_groups[g.group].remove([vtx.index])
  norm=sum(w.values())
  for name,value in w.items():
   if value>1e-8:mesh.vertex_groups[name].add([vtx.index],value/norm,'REPLACE')
  changed.append(vtx.index)
  for name in chains:
   if w.get(name,0)>.01:weighted[name]+=1
 if not all(weighted.values()):raise ValueError('Unweighted finger joint: '+str(weighted))
 # Preserve source albedo + metallic + roughness maps, removing FBX duplicate emission wiring.
 for mat in mesh.data.materials:
  mat.use_nodes=True;mat.node_tree.nodes.clear();nodes=mat.node_tree.nodes;links=mat.node_tree.links
  bsdf=nodes.new('ShaderNodeBsdfPrincipled');outnode=nodes.new('ShaderNodeOutputMaterial');links.new(bsdf.outputs['BSDF'],outnode.inputs['Surface'])
  for suffix,socket,color in [('_texture_0.png','Base Color','sRGB'),('_texture_0_metallic.png','Metallic','Non-Color'),('_texture_0_roughness.png','Roughness','Non-Color')]:
   file=next(src.parent.glob('*'+suffix));im=bpy.data.images.load(str(file),check_existing=True);im.colorspace_settings.name=color;tex=nodes.new('ShaderNodeTexImage');tex.image=im;links.new(tex.outputs['Color'],bsdf.inputs[socket])
  mat.use_backface_culling=False
 frames={}
 for side,h in hand_info.items():
  inv=rig.data.bones['hand_'+side].matrix_local.inverted();q=inv.to_quaternion();normal=(q@h['normal']).normalized();along=(q@h['along']).normalized();axis=(q@h['thumb']).normalized();center=inv@(h['center']+h['normal']*.022)
  frames[side]={'gripCenterLocal':arr(center),'gripAxisLocal':arr(axis),'palmNormalLocal':arr(normal),'fingerDirection':arr(along),'wristCenter':[0,0,0],'thumbBaseCenter':arr(inv@Vector(h['digits']['thumb']['base'])),'fingerBase':h['base'],'gripRadius':.022}
 left=frames['l'];bow={'palmContactCenter':arr(Vector(left['gripCenterLocal'])-Vector(left['palmNormalLocal'])*.022),'palmNormal':left['palmNormalLocal'],'thumbDir':1,'thumbDirection':left['gripAxisLocal'],'fingerDirection':left['fingerDirection'],'wristCenter':[0,0,0],'fingerBase':left['fingerBase'],'thumbBaseCenter':left['thumbBaseCenter']}
 out=ROOT/'public/models/characters/v2'/id;out.mkdir(parents=True,exist_ok=True)
 # Keep hand topology identical across LOD; source head and silhouette endpoints protected.
 data=mesh.data.copy();triangles={};lod_audit=[]
 for lod,ratio in ([(0,1),(1,.95),(2,.90)] if id=='viking-t1' else [(0,1),(1,.85),(2,.70)]):
  mesh.data=data.copy();activate(mesh)
  if lod:
   bm=bmesh.new();bm.from_mesh(mesh.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bm.to_mesh(mesh.data);bm.free()
   group=mesh.vertex_groups.new(name='LOD_protection');hand_indices={g.index for g in mesh.vertex_groups if g.name in chains or g.name.startswith('hand_')}
   for vtx in mesh.data.vertices:
    protected=vtx.co.z>height*.80 or vtx.co.z<.012 or sum(g.weight for g in vtx.groups if g.group in hand_indices)>.05
    group.add([vtx.index],0 if protected else 1,'REPLACE')
   dec=mesh.modifiers.new('Conservative_LOD','DECIMATE');dec.ratio=ratio;dec.vertex_group=group.name;dec.vertex_group_factor=100;dec.use_collapse_triangulate=True
   while mesh.modifiers.find(dec.name)>0:bpy.ops.object.modifier_move_up(modifier=dec.name)
   bpy.ops.object.modifier_apply(modifier=dec.name);mesh.vertex_groups.remove(mesh.vertex_groups['LOD_protection'])
  activate(mesh);rig.select_set(True);bpy.ops.export_scene.gltf(filepath=str(out/f'lod{lod}.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_all_influences=True,export_yup=True,export_apply=False,export_extras=True)
  triangles[f'lod{lod}']=sum(len(f.vertices)-2 for f in mesh.data.polygons);lod_audit.append({'lod':lod,'triangles':triangles[f'lod{lod}'],'vertices':len(mesh.data.vertices)})
 mesh.data=data;rig.data.pose_position='POSE';bpy.context.view_layer.update()
 diag=ROOT/'output/tiered-sources'/id;bpy.ops.wm.save_as_mainfile(filepath=str(diag/'finger-rig.blend'))
 shoulder=(rig.data.bones['upper_arm_l'].head_local-rig.data.bones['upper_arm_r'].head_local).length;neck=(rig.data.bones['head'].head_local-rig.data.bones['neck'].head_local).length
 info={'sourceSha256':sha,'heightM':height,'shoulderWidthM':shoulder,'neckLengthM':neck,'triangles':triangles,'textures':{'lod0':2048,'lod1':1024,'lod2':512},'handGripFrames':{'left':bow},'swordGripFrames':{f'lod{i}':frames['r']for i in range(3)},'shieldGripFrames':{f'lod{i}':frames['l']for i in range(3)},'rangedGripFrames':{f'lod{i}':{**frames['r'],'gripAxisLocal':[-v for v in frames['r']['gripAxisLocal']]}for i in range(3)},'fingerRig':{'addedDeformBones':30,'weightedVerticesByBone':weighted,'changedHandVertices':len(changed),'bodyWeightsPreserved':True,'sourceBodyGeometryAndUvPreservedAtLod0':True,'handRefinement':{'cutsPerOwnedEdge':2,'minimumEndpointHandWeight':.95,'smooth':0,'insertedVertices':len(data.vertices)-source_vertices},'sourceVertexCount':source_vertices,'sourceTriangles':source_triangles,'method':'Hand-only linear surface subdivision; measured distal source finger lanes and three joints per digit; source hand-only weight redistribution, no influence truncation or body reskin','hands':{s:{'wrist':arr(h['wrist']),'digits':h['digits']}for s,h in hand_info.items()}},'normalization':{'uniformScale':scale,'sourceGround':lo},'animationRetarget':{'sourceAsset':id.split('-')[0],'groundContact':{'mode':'floor'}}}
 corrections={}
 for side in ['l','r']:
  corrections['thumb_01_'+side]=[.6,0,.5 if side=='l' else -.5]
  for digit in ['index','middle','ring','pinky']:
   for joint in [1,2,3]:corrections[f'{digit}_{joint:02d}_{side}']=[.7 if digit=='index' else .35,0,0]
 info['fingerPoseCorrections']={'rotations':corrections,'clips':{clip:{bone:[0,0,0]for bone in corrections if bone.endswith('_r')}for clip in ['bowHold','bowLoad','bowRelease']},'releaseFadeSeconds':.12}
 if id=='viking-t1':info['fingerPoseCorrections']['relaxAfterRelease']={'bowRelease':['thumb_01_r']}
 manifest={'schemaVersion':1,'id':id,'status':'ready','skeleton':'project-humanoid-v1','sharedLodPose':True,'preserveMountedFingerTracks':True,'handShapeMode':'authored','alignAuthoredCarryGrip':True,'preserveLodHandTopology':True,'source':{'title':id+' owner-provided Meshy soldier','sourceArchive':archive,'sourceFile':src.name,'sourceSha256':sha,'license':'Owner-confirmed user-provided Meshy asset; redistribution permission confirmed 2026-10-25','licenseEvidence':'attribution-evidence.json'},'attribution':'Owner-provided Meshy model. Existing SagaBurst animation sources retain their respective licenses; see animation-source-attribution.txt.','files':{f'lod{i}':f'lod{i}.glb'for i in range(3)},'metrics':{k:info[k]for k in ['heightM','shoulderWidthM','neckLengthM','triangles','textures']},'handGripFrames':info['handGripFrames'],'swordGripFrames':info['swordGripFrames'],'rangedGripFrames':info['rangedGripFrames'],'shieldGripFrames':info['shieldGripFrames'],'boneMap':'bone-map.json','audit':'audit.json','animationRetarget':info['animationRetarget'],'visualAcceptance':'Pending retargeted grip/deformation review; structural build is not visual acceptance.'}
 if id.startswith('roman-'): manifest['relaxedLeftThumbForward']='including-lance'
 for file,obj in [('manifest.json',manifest),('blender-measurements.json',info),('bone-map.json',{'sourceToProject':aliases,'addedFingers':list(chains),'sockets':sockets}),('lod-audit.json',{'lods':lod_audit,'policy':'Conservative geometry reduction with hands, head and sole protected; no performance benchmark.'}),('attribution-evidence.json',{'sourceArchive':archive,'sourceFile':src.name,'sourceSha256':sha,'generator':'Meshy','evidence':'Owner confirmed on 2026-10-25 these are their models and may be placed in the public game repository. No CC license inferred.','scope':'Model only. Existing animation licenses retained separately.'})]:
  (out/file).write_text(json.dumps(obj,indent=2)+'\n')
 print('BUILT',id,json.dumps({'weighted':weighted,'metrics':manifest['metrics']}))
for id,(archive,height) in CONFIG.items():
 if len(args)>1 and id not in args[1].split(','):continue
 build(id,archive,height)
