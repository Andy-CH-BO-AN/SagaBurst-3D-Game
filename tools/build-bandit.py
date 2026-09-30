"""Convert the user's Fantasy Bandit downloads without rebuilding its appearance.

blender -b --python tools/build-bandit.py -- base.fbx extracted-directory output-directory
The extracted directory contains Bandit@*.fbx and Textures/. Sources stay outside Git.
"""
import bpy, json, sys, hashlib
from pathlib import Path
from mathutils import Matrix, Vector
import numpy as np

base, source, out = [Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]]
out.mkdir(parents=True, exist_ok=True)
bindings={'idle':'idle','walk':'walk','run':'run_forward','swordSlash':'attack','hit':'hit_damage','death':'falling_back'}
aliases={'Hips':'hips','Spine':'spine','Spine1':'chest','Spine2':'upper_chest','Neck':'neck','Head':'head'}
for side,suffix in [('Left','l'),('Right','r')]:
 for old,new in [('Shoulder','clavicle'),('Arm','upper_arm'),('ForeArm','lower_arm'),('Hand','hand'),('UpLeg','upper_leg'),('Leg','lower_leg'),('Foot','foot'),('ToeBase','toe')]: aliases[side+old]=new+'_'+suffix

def import_fbx(path):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.fbx(filepath=str(path))
 return next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')

def points(objects):
 dg=bpy.context.evaluated_depsgraph_get()
 return [o.matrix_world@v.co for o in objects for v in o.evaluated_get(dg).data.vertices]

samples={}; provenance=[]; idle_bounds=None
for name,filename in bindings.items():
 path=source/f'Bandit@{filename}.fbx'; rig=import_fbx(path)
 action=rig.animation_data.action; first,last=map(int,action.frame_range)
 frames=[]
 for f in range(first,last+1):
  bpy.context.scene.frame_set(f)
  frames.append({('RightHand'+b.name.split('Hand',1)[1] if b.name.startswith('R') and 'Hand' in b.name else b.name):b.matrix_basis.copy() for b in rig.pose.bones})
  if name=='idle' and f==first:
   pts=points([o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.polygons) and o.name!='Weapon'])
   idle_bounds=[min(v.z for v in pts),max(v.z for v in pts)]
 samples[name]=frames
 provenance.append({'clip':name,'source':'tokeshi','sourceClip':path.name,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'firstFrame':first,'lastFrame':last,'sourceFps':30,'loop':name in ['idle','walk','run'],'duration':.48 if name=='swordSlash' else (last-first)/30})

rig=import_fbx(base);rig.name='BanditRig'
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.polygons)]
for o in list(bpy.context.scene.objects):
 if o!=rig and o not in meshes: bpy.data.objects.remove(o,do_unlink=True)
S=1.75/(idle_bounds[1]-idle_bounds[0]); ground=-idle_bounds[0]*S
# Bake uniform scale into mesh coordinates and armature bind translations.
for o in meshes:
 o.data.transform(Matrix.Scale(S,4)@o.matrix_world)
 o.matrix_world=Matrix.Identity(4)
rig.data.transform(Matrix.Scale(S,4)@rig.matrix_world)
rig.matrix_world=Matrix.Identity(4)
rig.location.z=ground
for o in meshes: o.location.z=0
for old,new in aliases.items(): rig.data.bones[old].name=new
(out/'bone-map.json').write_text(json.dumps(aliases,indent=2)+'\n')

# Weapon vertices are rigidly weighted to RightHand in the supplied FBX.
# Preserve its exact bind-space transform; no replacement geometry or runtime IK.
weapon=bpy.data.objects['Weapon']; weapon.name='Bandit_Hammer'
hand=rig.data.bones['hand_r']
weapon.data.transform(hand.matrix_local.inverted())
weapon.modifiers.clear(); weapon.vertex_groups.clear()
weapon.parent=rig;weapon.parent_type='BONE';weapon.parent_bone='hand_r'
weapon.matrix_parent_inverse=Matrix.Identity(4)
weapon.matrix_basis=Matrix.Translation((0,-hand.length,0))

def socket(name,parent,position=None):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
 b=rig.data.bones[parent];o.parent=rig;o.parent_type='BONE';o.parent_bone=parent
 o.matrix_basis=Matrix.Translation((0,-b.length,0))
 if position is not None: o.matrix_basis=Matrix.Translation((0,-b.length,0))@Matrix.Translation(position)
 return o
for name,parent in [('hand_l','hand_l'),('hand_r','hand_r'),('head','head'),('back','spine'),('pelvis','hips'),('foot_l','foot_l'),('foot_r','foot_r')]: socket('socket_'+name,parent)
for suffix in ['l','r']:
 foot=rig.data.bones['foot_'+suffix]
 sole=foot.matrix_local.inverted()@Vector((foot.head_local.x,foot.head_local.y,-ground))
 socket('sole_'+suffix,'foot_'+suffix,sole)
# Mark actual source hammer head and shaft contact in the right hand's frame.
# The source hammer head lies at original Blender Y < -2.4.
original_head=[v.co for v in weapon.data.vertices if (hand.matrix_local@v.co).y < -2.4*S]
head_center=sum(original_head,Vector())/len(original_head)
socket('hammer_tip','hand_r',head_center)
socket('hammer_grip','hand_r',Vector((0,.045,0)))

def texture(mat,filename,space):
 image=bpy.data.images.load(str(filename),check_existing=True)
 image.colorspace_settings.name=space
 n=mat.node_tree.nodes.new('ShaderNodeTexImage');n.image=image
 return n
for mat in bpy.data.materials:
 if not any(mat in list(o.data.materials) for o in meshes):continue
 mat.use_nodes=True;mat.node_tree.nodes.clear()
 bs=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled');output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');links=mat.node_tree.links
 links.new(bs.outputs['BSDF'],output.inputs['Surface'])
 eye=mat.name=='Mat_Eye'; role=mat.name.replace('Mat_','')
 folder=source/'Textures'/('Eye' if eye else 'PBR_Metallic_Roughness')
 for kind,input_name in [('BaseColor','Base Color'),('Roughness','Roughness'),('Metallic','Metallic'),('Normal','Normal')]:
  path=folder/(('eye_'+kind.lower()+'.png') if eye else f'Bandit_Low_Mat_{role}_{kind}.tga')
  if not path.exists():continue
  node=texture(mat,path,'sRGB' if kind=='BaseColor' else 'Non-Color')
  if kind=='Normal':
   normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');links.new(node.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bs.inputs['Normal'])
  else:links.new(node.outputs['Color'],bs.inputs[input_name])
 # glTF's standard AO input, using the supplied UE4 packed map's red channel.
 ao_path=(source/'Textures/Eye/eye_ambientocclusion.png') if eye else source/'Textures/UE4'/f'Bandit_Low_Mat_{role}_OcclusionRoughnessMetallic.tga'
 group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
 if not group.interface.items_tree:group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 ao=mat.node_tree.nodes.new('ShaderNodeGroup');ao.node_tree=group
 channel=mat.node_tree.nodes.new('ShaderNodeSeparateColor');links.new(texture(mat,ao_path,'Non-Color').outputs['Color'],channel.inputs['Color']);links.new(channel.outputs['Red'],ao.inputs['Occlusion'])

rig.animation_data_create()
for name,frames in samples.items():
 a=bpy.data.actions.new(name);rig.animation_data.action=a
 for i,frame in enumerate(frames):
  for old,matrix in frame.items():
   b=rig.pose.bones[aliases.get(old,old)]
   # Source walk opens the carrying hand. Preserve its wrist/arm motion but
   # bake the source run's closed grip into the right finger chains in all takes.
   if old.startswith('RightHand') and old!='RightHand':matrix=samples['run'][6][old]
   loc,rot,scale=matrix.decompose();loc*=S
   if old=='Hips':
    floor_offset={'swordSlash':.023,'hit':.023,'death':.023,'walk':.005,'run':-.006}.get(name,0)
    loc+=b.bone.matrix_local.to_3x3().inverted()@Vector((0,0,floor_offset))
   b.rotation_mode='QUATERNION';b.location=loc;b.rotation_quaternion=rot;b.scale=(1,1,1)
   b.keyframe_insert('location',frame=i);b.keyframe_insert('rotation_quaternion',frame=i)
 a.use_fake_user=True
rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
pts=points([o for o in meshes if o!=weapon]);height=max(p.z for p in pts)-min(p.z for p in pts)
neck=(rig.data.bones['head'].head_local-rig.data.bones['neck'].head_local).length
shoulder=(rig.data.bones['upper_arm_l'].head_local-rig.data.bones['upper_arm_r'].head_local).length+.14
audit={'sourceIdleBounds':idle_bounds,'uniformScaleBaked':S,'idleHeightM':height,'idleMinY':min(p.z for p in pts),'neckLengthM':neck,'shoulderWidthM':shoulder,'sourceMeshNames':[o.name for o in meshes],'hammerParent':'hand_r','clips':provenance}

images={im:np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4) for im in bpy.data.images if im.has_data}
original_meshes={o:o.data.copy() for o in meshes}
triangles={}
for lod,resolution,ratio in [(0,2048,1),(1,1024,.52),(2,512,.16)]:
 for o,data in original_meshes.items():
  o.data=data.copy()
  if ratio<1:
   bpy.context.view_layer.objects.active=o
   mod=o.modifiers.new('Bandit_existing_LOD_policy','DECIMATE');mod.ratio=ratio
   bpy.ops.object.modifier_apply(modifier=mod.name)
 triangles['lod'+str(lod)]=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
 for image,pixels in images.items():
  # Resize from original pixels each time; do not repeatedly degrade the maps.
  h,w=pixels.shape[:2];image.scale(w,h);image.pixels.foreach_set(pixels.ravel());image.scale(min(w,resolution),min(h,resolution))
  image.filepath_raw=str(out/(image.name.rsplit('.',1)[0]+'.png'));image.file_format='PNG';image.pack()
 rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(0)
 bpy.ops.export_scene.gltf(filepath=str(out/f'lod{lod}.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_all_influences=False,export_yup=True,export_apply=False,export_extras=True,export_force_sampling=True,export_frame_range=False,export_anim_slide_to_zero=True)

manifest={'schemaVersion':1,'id':'bandit','status':'ready','skeleton':'project-humanoid-v1','source':{'title':'Fantasy Bandit','author':'tokeshi','url':'https://www.cgtrader.com/free-3d-models/character/man/fantasy-bandit','license':'CGTrader Royalty Free (no AI)','licenseUrl':'https://www.cgtrader.com/pages/terms-and-conditions','sourceSha256':hashlib.sha256(base.read_bytes()).hexdigest()},'attribution':'Fantasy Bandit by tokeshi / CGTrader. Licensed for incorporated game use; no standalone redistribution.','modifications':['Uniform measured 1.75 m idle height; preserved source mesh, UVs and skinning','Canonical bone aliases and cached sockets','Original rigid hammer parented to right hand','Source clips and existing three-level LOD policy; PBR 2K/1K/512 maps'],'handShapeMode':'authored','files':{f'lod{i}':f'lod{i}.glb' for i in range(3)},'metrics':{'heightM':height,'shoulderWidthM':shoulder,'neckLengthM':neck,'triangles':triangles,'textures':{'lod0':2048,'lod1':1024,'lod2':512}},'animations':{'embedded':provenance,'runtimeGenerated':[]},'boneMap':'bone-map.json','audit':'audit.json'}
manifest['source']['archives']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [base.parent/'Bandit_animation_fbx.rar',base.parent/'Bandit_textures.rar'] if p.exists()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit))
