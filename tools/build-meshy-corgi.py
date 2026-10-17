"""Build the SHA-pinned Saddled Corgi Knight on the existing quadruped contract.

blender -b --python tools/build-meshy-corgi.py -- SOURCE.glb DECODED_DONOR.glb OUT
The donor is the accepted corgi-v2 animation package decoded by animal_glb.mjs.
This source-specific builder does not reuse the old Corgi geometry masks/pivots.
Outputs are staged: visual/runtime validation is required before promotion.
"""
import bpy,bmesh,hashlib,json,math,sys,subprocess,os
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
import numpy as np
source,donor,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:])
out.mkdir(parents=True,exist_ok=True)
SOURCE_SHA='0d0a7925220ef045b7c70ed7071248565b742d76ea3d356d64b19f49a90175df'
assert hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA,'Source changed; remeasure landmarks'
DONOR_DECODED_SHA='2afa16764607268b84123dfec818aac141fc1c1fb2afdb4ebd6a51bab19bf5fa'
assert hashlib.sha256(donor.read_bytes()).hexdigest()==DONOR_DECODED_SHA,'Use the pinned accepted animation donor, not rebuilt output'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
body=next(o for o in bpy.data.objects if o.type=='MESH');body.name='corgi_body_lod0'
world=body.matrix_world.copy();body.parent=None;body.matrix_world=Matrix.Identity(4);body.data.transform(world)
# Source front is Blender -Y. Uniform source-to-game scale, ground from paw minimum.
scale=1.65;ground=-.6375860571861267
for v in body.data.vertices:v.co=Vector((v.co.x*scale,v.co.y*scale+.2,(v.co.z-ground)*scale))
for o in list(bpy.data.objects):
 if o!=body:bpy.data.objects.remove(o,do_unlink=True)
body.data.update()
# The source has a few calf triangles spanning several joints. Conforming
# edge subdivision retains the exact rest surface/UV/normal interpolation while
# supplying enough vertices for ordinary linear skinning through ankle flexion.
def refine_leg_topology(src):
 tris=[]
 for p in src.polygons:
  tris.append([(src.vertices[src.loops[i].vertex_index].co.copy(),src.uv_layers.active.data[i].uv.copy(),src.corner_normals[i].vector.copy())for i in p.loop_indices])
 def key(a,b):return tuple(sorted((tuple(round(v,6)for v in a),tuple(round(v,6)for v in b))))
 for _ in range(2):
  marked=set()
  for tri in tris:
   for a,b in zip(tri,tri[1:]+tri[:1]):
    p,q=a[0],b[0];c=(p+q)/2
    if .02<c.z<.65 and abs(c.x)>.05 and (-c.y< -1.0 or -c.y>.10) and abs(p.z-q.z)>.12:marked.add(key(p,q))
  def split(tri):
   for i in range(3):
    a,b,c=tri[i],tri[(i+1)%3],tri[(i+2)%3]
    if key(a[0],b[0])in marked:
     mid=((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2]).normalized())
     return split([a,mid,c])+split([mid,b,c])
   return [tri]
  tris=[t for tri in tris for t in split(tri)]
 m=bpy.data.meshes.new('source_skin_ready');m.from_pydata([v[0]for tri in tris for v in tri],[],[(i*3,i*3+1,i*3+2)for i in range(len(tris))]);m.update()
 for mat in src.materials:m.materials.append(mat)
 uv=m.uv_layers.new(name='UVMap');normals=[]
 for i,v in enumerate(v for tri in tris for v in tri):uv.data[i].uv=v[1];normals.append(v[2])
 for p in m.polygons:p.use_smooth=True
 m.normals_split_custom_set(normals);return m
body.data=refine_leg_topology(body.data)
source_render=body.data.copy()
bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-5);bm.to_mesh(body.data);bm.free();body.data.update()
# Preserve original UV/materials; 4096 MR is resized to 1024, not thrown away.
for image in bpy.data.images:
 if 'metallic_roughness' in image.name:image.scale(1024,1024)
 if image.has_data:image.pack()
mesh=body.data
img=bpy.data.images.get('texture_0');pixels=np.asarray(img.pixels[:],dtype=np.float32).reshape(img.size[1],img.size[0],4)
uv=mesh.uv_layers.active.data
# Leather is source brown/dark, bounded to the equipment-bearing torso. These
# thresholds are specific to the hash-pinned source and verified in on/off previews.
mr=bpy.data.images.get('texture_0_metallic_roughness');mrpixels=np.asarray(mr.pixels[:],dtype=np.float32).reshape(mr.size[1],mr.size[0],4)
selected=set()
for p in mesh.polygons:
 c=p.center;u,v=np.mean([uv[i].uv[:]for i in p.loop_indices],axis=0)
 samples=[uv[i].uv[:]for i in p.loop_indices]+[(u,v)]
 colors=[pixels[min(img.size[1]-1,int(vv*img.size[1])),min(img.size[0]-1,int(uu*img.size[0])),:3]for uu,vv in samples]
 rgb=min(colors,key=lambda c:max(c))
 metal=mrpixels[min(mr.size[1]-1,int(v*mr.size[1])),min(mr.size[0]-1,int(u*mr.size[0])),2]
 x,y,z=c.x,c.z,-c.y
 tack=(max(rgb)<.60 or metal>.20) and .30<y<1.48 and -1.67<z<1.03
 saddle=y>1.19 and -1.1<z<.32
 if tack or saddle:selected.add(p.index)
# Include seam-edge triangles around actual leather/metal only.
edges={}
for p in mesh.polygons:
 for e in p.edge_keys:edges.setdefault(tuple(sorted(e)),[]).append(p.index)
seed=set(selected)
for fs in edges.values():
 if any(i in seed for i in fs):
  for i in fs:
   c=mesh.polygons[i].center
   if .3<c.z<1.48 and -1.67< -c.y<1.03:selected.add(i)
adj=[set()for _ in mesh.vertices]
for e in mesh.edges:
 a,b=e.vertices;adj[a].add(b);adj[b].add(a)
verts_eq=set(v for i in selected for v in mesh.polygons[i].vertices)
# Split original surface verbatim; the body below is reconstructed locally.
def subset(name,selected_faces,src=None):
 src=src or body.data
 faces=[p for p in src.polygons if p.index in selected_faces]
 used=sorted({v for p in faces for v in p.vertices});remap={v:i for i,v in enumerate(used)}
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([src.vertices[i].co[:]for i in used],[],[[remap[v]for v in p.vertices]for p in faces]);mesh.update()
 for mat in src.materials:mesh.materials.append(mat)
 uvout=mesh.uv_layers.new(name='UVMap');normals=[]
 for old,new in zip(faces,mesh.polygons):
  new.use_smooth=old.use_smooth
  for oli,nli in zip(old.loop_indices,new.loop_indices):
   uvout.data[nli].uv=src.uv_layers.active.data[oli].uv
   normals.append(src.corner_normals[oli].vector[:])
 mesh.normals_split_custom_set(normals)
 o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);return o
equip=subset('corgi_saddle_leather',selected,source_render)
visible_body=subset('corgi_visible_source',set(range(len(mesh.polygons)))-selected,source_render)
# Reserve an atlas strip for source-derived fur. All original texture layers
# and UVs are remapped together, leaving original appearance unchanged.
patch=None
for yy in range(0,pixels.shape[0]-32,16):
 for xx in range(0,pixels.shape[1]-32,16):
  a=pixels[yy:yy+32,xx:xx+32,:3];r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
  ok=(r>.30)&(r>g*1.25)&(r<g*2.3)&(b<g*.85)&(b>g*.25)
  if np.mean(ok)>.995 and np.std(r)>.012:patch=a.copy();break
 if patch is not None:break
assert patch is not None,'No clean source fur patch'
patch=patch.mean(axis=(0,1))*0.8+patch*0.2
patch=np.concatenate([patch,patch[:,::-1]],axis=1);patch=np.concatenate([patch,patch[::-1]],axis=0)
# Keep the real texture variation; cream uses the same fine fur detail with
# the source breast color, not a flat cap or a new costly procedural material.
cream=np.clip(patch.mean(axis=2)[:,:,None]/patch.mean()*np.array([.95,.94,.90]),0,1)
for im in list(bpy.data.images):
 if len(im.pixels)==0:continue
 size=im.size[0];small=round(size*15/16);im.scale(small,small)
 data=np.array(im.pixels[:],dtype=np.float32).reshape(small,small,4)
 atlas=np.ones((size,size,4),dtype=np.float32)
 if 'normal' in im.name:atlas[:,:,:3]=[.5,.5,1]
 elif 'metallic' in im.name:atlas[:,:,:3]=[0,1,0]
 else:atlas[:,:,:3]=[.5,.3,.15]
 atlas[:small,:small]=data
 if im.name=='texture_0':

  for row in range(128):
   t=max(0,min(1,(row-40)/48));t=t*t*(3-2*t)
   atlas[row,small:small+64,:3]=patch[row%64]*(1-t)+cream[row%64]*t
 fresh=bpy.data.images.new(im.name+'_fur_atlas',width=size,height=size,alpha=True)
 fresh.colorspace_settings.name=im.colorspace_settings.name
 fresh.pixels.foreach_set(atlas.ravel());fresh.update();fresh.pack()
 for mat in bpy.data.materials:
  if mat.use_nodes:
   for node in mat.node_tree.nodes:
    if node.type=='TEX_IMAGE' and node.image==im:node.image=fresh
for o in [body,equip,visible_body]:
 for uvp in o.data.uv_layers.active.data:uvp.uv*=15/16
# New source landmarks, game XYZ metres. All four limbs retain short proportions.
def B(p):return Vector((p[0],-p[2],p[1]))
landmarks={}
def item(n,h,t,p=None):landmarks[n]={'head':h,'tail':t,'parent':p}
item('corgi_torso',[0,.90,-.45],[0,1.15,-.45])
item('corgi_chest',[0,.93,.48],[0,1.25,.66],'corgi_torso')
item('corgi_neck',[0,1.25,.66],[0,1.50,.85],'corgi_chest')
item('corgi_head',[0,1.50,.85],[0,1.55,1.23],'corgi_neck')
for side,sgn in [('l',1),('r',-1)]:
 x=.255*sgn
 item('corgi_front_upper_'+side,[x,.73,.65],[sgn*.20,.39,.31],'corgi_chest')
 item('corgi_front_lower_'+side,[sgn*.20,.39,.31],[sgn*.19,.115,.47],'corgi_front_upper_'+side)
 item('corgi_front_paw_'+side,[sgn*.19,.115,.47],[sgn*.20,.06,.59],'corgi_front_lower_'+side)
 item('corgi_rear_upper_'+side,[sgn*.34,.73,-1.25],[sgn*.20,.39,-1.42],'corgi_torso')
 item('corgi_rear_lower_'+side,[sgn*.20,.39,-1.42],[sgn*.19,.22,-1.50],'corgi_rear_upper_'+side)
 item('corgi_rear_ankle_'+side,[sgn*.19,.22,-1.50],[sgn*.19,.09,-1.44],'corgi_rear_lower_'+side)
 item('corgi_rear_paw_'+side,[sgn*.19,.09,-1.44],[sgn*.19,.055,-1.35],'corgi_rear_ankle_'+side)
item('corgi_tail_0',[0,1.15,-1.40],[0,.62,-1.73],'corgi_torso')
# Seat measured by actual retained source saddle ray, not its front/rear bridges.
from mathutils.bvhtree import BVHTree
bvh=BVHTree.FromPolygons([v.co for v in equip.data.vertices],[p.vertices for p in equip.data.polygons])
seat_z=-.30;hit=bvh.ray_cast(B((0,2.0,seat_z)),Vector((0,0,-1)));assert hit[0],'Source seat surface absent';seat_y=hit[0].z
item('socket_saddle_seat',[0,seat_y,seat_z],[0,seat_y+.05,seat_z],'corgi_torso')
item('socket_camera',[0,seat_y+.5,seat_z],[0,seat_y+.55,seat_z],'corgi_torso')
arm=bpy.data.armatures.new('corgi_rig');rig=bpy.data.objects.new('corgi_rig',arm);bpy.context.collection.objects.link(rig)
def active(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
active(rig);bpy.ops.object.mode_set(mode='EDIT')
for n,d in landmarks.items():
 b=arm.edit_bones.new(n);b.head=B(d['head']);b.tail=B(d['tail']);b.use_deform=not n.startswith('socket_')
 if d['parent']:b.parent=arm.edit_bones[d['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def distseg(p,a,b):
 d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared));return (p-a-d*t).length
# Continuous source-measured limb bands keep belly and saddle off the femurs.
def weights(p,is_equipment=False):
 x,y,z=p.x,p.z,-p.y
 head=smooth(.65,.95,z)*smooth(1.10,1.42,y)
 neck=smooth(.43,.78,z)*smooth(1.00,1.35,y)*(1-head)
 chest=smooth(.1,.55,z)*(1-head-neck)
 w={'corgi_torso':1-head-neck-chest,'corgi_head':head,'corgi_neck':neck,'corgi_chest':chest}
 tail=(1-smooth(-1.70,-1.55,z))*smooth(.40,.70,y)*(1-smooth(.07,.13,abs(x)))
 if tail:
  w={n:a*(1-tail)for n,a in w.items()};w['corgi_tail_0']=tail
 if is_equipment:return w
 for end,lo,hi in [('front',.08,1.02),('rear',-1.95,-.75)]:
  region=smooth(lo,lo+.18,z)*(1-smooth(hi-.18,hi,z))*(1-smooth(.48,.83,y))*smooth(.02,.08,abs(x))*(1-tail)
  if not region:continue
  side='l'if x>=0 else'r';names=[n for n in landmarks if n.startswith('corgi_'+end+'_')and n.endswith('_'+side)]
  # Anatomical cross sections share blend weights. Distance-to-bone weights
  # varied across the thin shin and collapsed it during flexion.
  upper=smooth(.37,.43,y);paw=1-smooth(.10,.16,y)
  if end=='front':
   ds={f'corgi_front_upper_{side}':upper,f'corgi_front_lower_{side}':(1-upper)*(1-paw),f'corgi_front_paw_{side}':(1-upper)*paw}
  else:
   # Broad, low-amplitude distal influence preserves the short thick paw
   # while the lower leg carries its volume; a tight donor hock blend folds it.
   upper=smooth(.25,.56,y);paw=.30*(1-smooth(.10,.65,y))
   ankle=(1-upper)*(1-paw)*.10*(1-smooth(.08,.35,y))
   ds={f'corgi_rear_upper_{side}':upper,f'corgi_rear_lower_{side}':(1-upper)*(1-paw)-ankle,f'corgi_rear_ankle_{side}':ankle,f'corgi_rear_paw_{side}':(1-upper)*paw}
  total=sum(ds.values());w={n:a*(1-region)for n,a in w.items()}
  for n,a in ds.items():w[n]=w.get(n,0)+a/total*region
 return w
def skin(o,gear=False):
 for n in landmarks:
  if not n.startswith('socket_'):o.vertex_groups.new(name=n)
 for v in o.data.vertices:
  ws=sorted(weights(v.co,gear).items(),key=lambda p:p[1],reverse=True)[:4];total=sum(v for _,v in ws)
  for n,a in ws:
   if a>1e-8:o.vertex_groups[n].add([v.index],a/total,'REPLACE')
 mod=o.modifiers.new('Quadruped skin','ARMATURE');mod.object=rig;o.parent=rig
 for p in o.data.polygons:p.use_smooth=True
# Reconstruct only concealed source tack zones. The complete off variant keeps
# original exposed fur/head/ear/paw surfaces and uses the shared source atlas.
import runpy
backing=runpy.run_path(str(Path(__file__).parent/'meshy-mounts/restore-corgi-fur.py'))['restore_corgi_fur'](visible_body,equip,out)
border_changes=[]
bpy.data.objects.remove(body,do_unlink=True);body=visible_body;body.name='corgi_body_lod0'
skin(body);skin(equip);skin(backing)
objects=[body,equip,backing]
def simplify_surface(src,name,ratio):
 positions=[];uvs=[];normals=[]
 src.data.calc_loop_triangles()
 for triangle in src.data.loop_triangles:
  for li in triangle.loops:
   positions.append(list(src.data.vertices[src.data.loops[li].vertex_index].co));uvs.append(list(src.data.uv_layers.active.data[li].uv));normals.append(list(src.data.corner_normals[li].vector))
 input_path=out/'lod-input.json';output_path=out/'lod-output.json'
 input_path.write_text(json.dumps({'positions':positions,'uvs':uvs,'normals':normals}))
 subprocess.run(['node',str(Path(__file__).parent/'meshy-mounts/simplify-corgi-lod.mjs'),str(input_path),str(output_path),str(ratio)],check=True)
 ids=json.loads(output_path.read_text())['indices'];me=bpy.data.meshes.new(name)
 me.from_pydata([positions[i]for i in ids],[],[list(range(i,i+3))for i in range(0,len(ids),3)]);me.update()
 layer=me.uv_layers.new(name='UVMap')
 for li,i in enumerate(ids):layer.data[li].uv=uvs[i]
 for p in me.polygons:p.use_smooth=True
 me.normals_split_custom_set([normals[i]for i in ids]);o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(equip.data.materials[0]);skin(o);return o
for lod,ratio in [(1,.55),(2,.32)]:
 # Index-only simplification retains source UV/normal samples and locks all
 # source cut borders, unlike averaging vertices through the leather atlas.
 for src,name in [(body,f'corgi_body_lod{lod}'),(equip,f'corgi_equipment_lod{lod}'),(backing,f'corgi_unarmored_lod{lod}')]:
  o=simplify_surface(src,name,ratio)
  if src==backing:o['replacesEquippedBody']=True
  objects.append(o)
# Import accepted 7-clip donor, no donor geometry is retained.
before=set(bpy.data.objects);oldactions=set(bpy.data.actions);bpy.ops.import_scene.gltf(filepath=str(donor),bone_heuristic='BLENDER')
imported=set(bpy.data.objects)-before;drig=next(o for o in imported if o.type=='ARMATURE');drig.name='animation_donor';actions={a.name.split('_corgi_rig')[0]:a for a in sorted(set(bpy.data.actions)-oldactions,key=lambda a:a.name)}
assert set(actions)=={'idle','walk','run','jump','land','hit','death'},list(actions)
for o in sorted(imported,key=lambda o:o.name):
 if o!=drig:bpy.data.objects.remove(o,do_unlink=True)
for track in drig.animation_data.nla_tracks:track.mute=True
fps=60;bpy.context.scene.render.fps=fps
rig.animation_data_create();durations={};samples={}
# The glTF importer creates keys at the previous scene's 24 fps.
for clip,da in actions.items():
 duration=da.frame_range[1]/24;durations[clip]=duration;drig.animation_data.action=da
 a=bpy.data.actions.new(clip);rig.animation_data.action=a;a.use_fake_user=True
 frames=round(duration*fps);previous={};idle_reference={}
 for i in range(frames+1):
  t=min(duration,i/fps);bpy.context.scene.frame_set(math.floor(t*24),subframe=(t*24)%1);bpy.context.view_layer.update()
  for p in rig.pose.bones:
   p.rotation_mode='QUATERNION';p.location=(0,0,0);p.scale=(1,1,1)
   if p.name.startswith('socket_'):continue
   old=drig.pose.bones[p.name]
   # Retarget local deformation through source and measured target rest axes.
   oq=old.bone.matrix_local.to_quaternion();nq=p.bone.matrix_local.to_quaternion();q=nq.inverted()@oq@old.rotation_quaternion@oq.inverted()@nq;q.normalize()
   # The accepted donor idle carries a fixed limb-pose offset from its old
   # anatomy. Keep its motion about that reference, on this source's measured
   # four-paw stance; other clips retain their reviewed retarget trajectories.
   if clip=='idle' and ('_front_'in p.name or '_rear_'in p.name):
    if p.name not in idle_reference:idle_reference[p.name]=q.copy()
    q=idle_reference[p.name].inverted()@q;q.normalize()
   if p.name in previous and previous[p.name].dot(q)<0:q.negate()
   p.rotation_quaternion=q;previous[p.name]=q.copy()
   if p.name=='corgi_torso':p.location=old.location.copy()
   p.keyframe_insert('rotation_quaternion',frame=i)
   if p.name=='corgi_torso':p.keyframe_insert('location',frame=i)
 for fc in a.fcurves:
  for k in fc.keyframe_points:k.interpolation='LINEAR'
 samples[clip]=frames+1
rig.animation_data.action=None
bpy.data.objects.remove(drig,do_unlink=True)
for a in list(bpy.data.actions):
 if a.name not in durations:bpy.data.actions.remove(a)
# Ground each action from evaluated LOD0 body plus equipment, keeping airborne
# jump motion owned by gameplay; only correct actual local penetration.
for a in bpy.data.actions:
 rig.animation_data.action=a
 root=rig.pose.bones['corgi_torso'];curves=[next(f for f in a.fcurves if f.data_path=='pose.bones["corgi_torso"].location'and f.array_index==axis) for axis in range(3)];up=root.bone.matrix_local.to_3x3().inverted()@Vector((0,0,1))
 corrections=[]
 for i in range(round(durations[a.name]*fps)+1):
  bpy.context.scene.frame_set(i);dg=bpy.context.evaluated_depsgraph_get();lowest=1e9
  for o in [body,equip]:
   eo=o.evaluated_get(dg);m=eo.to_mesh();lowest=min(lowest,min((eo.matrix_world@v.co).z for v in m.vertices));eo.to_mesh_clear()
  corrections.append(-lowest if lowest<0 else (-lowest*smooth(.15,.65,i/max(1,round(durations[a.name]*fps))) if a.name=='death' else 0))
 for axis,fc in enumerate(curves):
  for i,k in enumerate(fc.keyframe_points):k.co.y+=corrections[i]*up[axis]
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'corgi-source-rig.blend'))
active(rig)
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'corgi-staged.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_all_influences=False,export_extras=True,export_yup=True,export_apply=False)
report={'sourceSha256':SOURCE_SHA,'donorDecodedSha256':hashlib.sha256(donor.read_bytes()).hexdigest(),'uniformScale':scale,'sourceGround':ground,'landmarks':landmarks,'seatHeight':seat_y,'equipmentFaces':len(selected),'unarmoredBorderVertices':len(border_changes),'unarmoredMaxBorderShift':max(border_changes,default=0),'reconstructedBodyVertices':len(backing.data.vertices),'triangles':{o.name:sum(len(p.vertices)-2 for p in o.data.polygons)for o in objects},'clips':durations,'samples':samples,'limitations':['Reconstructed concealed body uses source-fur microtexture and measured tan/cream zones; equipment-on retains source surface.','Offline retarget candidate requires roundtrip/runtime/visual verification.']}
(out/'build-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
