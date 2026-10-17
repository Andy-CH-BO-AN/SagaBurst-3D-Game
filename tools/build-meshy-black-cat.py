"""Source-pinned Midnight Rider rig, skin, whisker repair and baked mount package.
Run with Blender background: -- source.glb decoded-accepted-donor.glb staging-directory.
No original source or intermediate blend is intended for publication.
"""
import bpy, math, json, hashlib, sys, bmesh
from pathlib import Path
from mathutils import Vector, Quaternion, Matrix
from collections import defaultdict
source, donor_path, out = [Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]]
out.mkdir(parents=True,exist_ok=True)
config=json.loads((Path(__file__).parent/'meshy-mounts/black-cat.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest()==config['sourceSha256'], 'Source differs: remeasure rather than removing hash check'
assert hashlib.sha256(donor_path.read_bytes()).hexdigest()==config['animationDonor']['decodedSha256'], 'Animation donor differs from pinned accepted source'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
o=next(o for o in bpy.data.objects if o.type=='MESH')
import importlib.util
def local_module(filename):
 spec=importlib.util.spec_from_file_location(filename.replace('-','_'),Path(__file__).parent/'meshy-mounts'/filename)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
muzzle_report=local_module('repair-black-cat-muzzle.py').repair_black_cat_muzzle(o)

# Preserve source tack exactly; reconstruct only its concealed fur.
fur_module=local_module('reconstruct-black-cat-fur.py')
def subset(name, indices, material_override=None):
 src=o.data;points=[v.co.copy()for v in src.vertices];polys=[];uvs=[];norms=[]
 for i in indices:
  p=src.polygons[i];polys.append(list(p.vertices));uvs.append([tuple(src.uv_layers.active.data[l].uv)for l in p.loop_indices]);norms.append([tuple(src.corner_normals[l].vector)for l in p.loop_indices])
 used=sorted({v for poly in polys for v in poly});remap={old:new for new,old in enumerate(used)};points=[points[v]for v in used];polys=[[remap[v]for v in poly]for poly in polys]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(points,[],polys);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 for ma in src.materials:mesh.materials.append(ma)
 layer=mesh.uv_layers.new(name='UVMap');flatten=[]
 for pi,p in enumerate(mesh.polygons):
  p.use_smooth=src.polygons[indices[pi]].use_smooth;p.material_index=material_override if material_override is not None else src.polygons[indices[pi]].material_index
  for j,l in enumerate(p.loop_indices):layer.data[l].uv=uvs[pi][j];flatten.append(norms[pi][j])
 mesh.normals_split_custom_set(flatten)
 return obj
gear_mask=fur_module.classify_gear(o)
gear_ids=[i for i,v in enumerate(gear_mask)if v];body_ids=[i for i,v in enumerate(gear_mask)if not v]
solver=o.copy();solver.data=o.data.copy();solver.name='temporary_heat_solver';bpy.context.collection.objects.link(solver)
body=subset('cat_body_lod0',body_ids);gear=subset('cat_saddle_leather',gear_ids)
bare=fur_module.build_unarmored(o,gear_mask=gear_mask);bpy.data.objects.remove(o,do_unlink=True)
# Construct six tapered, curved whiskers in one mesh, later joined to body.
from mathutils.bvhtree import BVHTree
face_surface=BVHTree.FromPolygons([v.co for v in solver.data.vertices],[list(p.vertices)for p in solver.data.polygons])
wv=[];wf=[];whisker_roots=[]
for sign in [-1,1]:
 for k in range(3):
  start=Vector((sign*(.047+k*.005),-1.2,.272+(k-1)*.009))
  hit,_,_,_=face_surface.ray_cast(start,Vector((0,1,0)))
  assert hit is not None, 'Whisker root did not contact repaired muzzle'
  start=hit+Vector((0,.001,0));whisker_roots.append(list(start))
  for j in range(9):
   t=j/8;center=start+Vector((sign*(.16+.012*k)*t,-.027*t-.016*t*t,(k-1)*.025*t+.012*math.sin(t*math.pi)))
   r=.0017*(1-.88*t)
   for h in range(4):wv.append(tuple(center+Vector((0,math.cos(h*math.pi/2)*r,math.sin(h*math.pi/2)*r))))
  b=len(wv)-36
  for j in range(8):
   for h in range(4):a=b+j*4+h;bb=b+j*4+(h+1)%4;wf.extend([(a,bb,bb+4),(a,bb+4,a+4)])
mesh=bpy.data.meshes.new('six_head_whiskers');mesh.from_pydata(wv,[],wf);mesh.update();whiskers=bpy.data.objects.new('six_head_whiskers',mesh);bpy.context.collection.objects.link(whiskers)
wm=bpy.data.materials.new('whisker_ivory');wm.use_nodes=True;wp=wm.node_tree.nodes.get('Principled BSDF');wp.inputs['Base Color'].default_value=(.55,.53,.49,1);wp.inputs['Roughness'].default_value=.8;mesh.materials.append(wm)
for p in mesh.polygons:p.use_smooth=True
scale=config['uniformScale']
def norm(p):return Vector((p[0]*scale,p[1]*scale-config['forwardOffset'],(p[2]-config['sourceGroundZ'])*scale))
for ob in [body,gear,bare,whiskers,solver]:
 for v in ob.data.vertices:v.co=norm(v.co)

def activate(obj):
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
arm=bpy.data.armatures.new('black_cat_rig');rig=bpy.data.objects.new('black_cat_rig',arm);bpy.context.collection.objects.link(rig);activate(rig);bpy.ops.object.mode_set(mode='EDIT')
for name,h,t,parent in config['bones']:
 b=arm.edit_bones.new(name);b.head=norm(h);b.tail=norm(t);b.use_deform=not name.startswith('socket_')
 if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
# Compute weights on a welded temporary solver, then transfer by exact positions.
bm=bmesh.new();bm.from_mesh(solver.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-5);bm.to_mesh(solver.data);bm.free();activate(solver);rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.parent_set(type='ARMATURE_AUTO')
from mathutils.kdtree import KDTree
kd=KDTree(len(solver.data.vertices))
for v in solver.data.vertices:kd.insert(v.co,v.index)
kd.balance()
# The complete unarmored skin has a different concealed anatomical surface;
# solve its own weights rather than transferring nearby rigid armor weights.
bare_solver=bare.copy();bare_solver.data=bare.data.copy();bpy.context.collection.objects.link(bare_solver)
bm=bmesh.new();bm.from_mesh(bare_solver.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-5);bm.to_mesh(bare_solver.data);bm.free()
activate(bare_solver);rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.parent_set(type='ARMATURE_AUTO')
bare_kd=KDTree(len(bare_solver.data.vertices))
for v in bare_solver.data.vertices:bare_kd.insert(v.co,v.index)
bare_kd.balance()
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def set_weights(obj,idx,w):
 w=sorted([(n,v)for n,v in w.items()if v>1e-7],key=lambda p:-p[1])[:4];total=sum(v for n,v in w)
 for n,v in w:
  g=obj.vertex_groups.get(n)or obj.vertex_groups.new(name=n);g.add([idx],v/total,'REPLACE')
# Use actual source tack vertices, rather than an axis-aligned pannier box,
# to anchor armor and its shared body seam without capturing the lower leg.
rear_tack=[v.co.copy() for v in gear.data.vertices if (v.co.y+config['forwardOffset'])/scale > -.30]
tack_kd=KDTree(len(rear_tack))
for i,p in enumerate(rear_tack):tack_kd.insert(p,i)
tack_kd.balance()
for obj in [body,bare,gear]:
 for v in obj.data.vertices:
  weight_source=bare_solver if obj==bare else solver;weight_kd=bare_kd if obj==bare else kd
  q,idx,d=weight_kd.find(v.co);sv=weight_source.data.vertices[idx];w={weight_source.vertex_groups[g.group].name:g.weight for g in sv.groups if g.weight>0}
  if obj==bare:
   blended=defaultdict(float);total=0
   for _,near,distance in bare_kd.find_range(v.co,.16):
    factor=math.exp(-((distance/.065)**2));total+=factor
    for g in bare_solver.data.vertices[near].groups:
     blended[bare_solver.vertex_groups[g.group].name]+=g.weight*factor
   if total:w={n:a/total for n,a in blended.items()}
  if not w:
   bn=min((b for b in arm.bones if b.use_deform),key=lambda b:(v.co-b.head_local).length_squared);w={bn.name:1}
  source_y=(v.co.y+config['forwardOffset'])/scale;source_z=v.co.z/scale+config['sourceGroundZ']
  # Head and eyes stay rigid; only the narrow neck blends to chest.
  h=smooth(.10,.19,source_z)*(1-smooth(-.74,-.60,source_y))
  if source_z>.30 and source_y<-.58:h=1.0
  if h:w={n:a*(1-h)for n,a in w.items()};w['cat_head']=w.get('cat_head',0)+h
  # The source is fused: shared seam positions must have identical skin weights.
  # Anchor the actual seat to the back, with a smooth lower torso transition.
  back=smooth(-.09,.10,source_z)*smooth(-.48,-.30,source_y)*(1-smooth(.34,.43,source_y))
  source_x=v.co.x/scale
  _,_,tack_distance=tack_kd.find(v.co)
  pannier=(1-smooth(0,.10,tack_distance))*smooth(-.35,-.25,source_y)
  torso=back if obj==bare else max(back,pannier)
  if obj!=bare and source_y>.05 and source_z<-.10:
   side='_l' if source_x>0 else '_r'
   limb={n:a for n,a in w.items()if n.startswith('cat_rear_')and n.endswith(side)}
   if limb:
    total=sum(limb.values());w={n:a/total for n,a in limb.items()}
  # Above the measured rear knee, blend toward thigh before the back;
  # a direct torso/lower-leg blend folds the thin pannier across two joints.
  if obj!=bare and source_y>.05:
   side='_l' if source_x>0 else '_r';upper='cat_rear_upper'+side
   amount=smooth(-.30,-.20,source_z)
   for n in list(w):
    if n.startswith(('cat_rear_lower','cat_rear_ankle','cat_rear_paw')) and n.endswith(side):
     transfer=w[n]*amount;w[n]-=transfer;w[upper]=w.get(upper,0)+transfer
  if torso:w={n:a*(1-torso)for n,a in w.items()};w['cat_torso']=w.get('cat_torso',0)+torso
  set_weights(obj,v.index,w)
 mod=obj.modifiers.new('Quadruped skin','ARMATURE');mod.object=rig;obj.parent=rig
for v in whiskers.data.vertices:set_weights(whiskers,v.index,{'cat_head':1})
mod=whiskers.modifiers.new('Head skin','ARMATURE');mod.object=rig;whiskers.parent=rig
bpy.data.objects.remove(solver,do_unlink=True);bpy.data.objects.remove(bare_solver,do_unlink=True)
# Both complete skins receive the same six head-bound whiskers.
bare_whiskers=whiskers.copy();bare_whiskers.data=whiskers.data.copy();bpy.context.collection.objects.link(bare_whiskers)
activate(body);whiskers.select_set(True);bpy.ops.object.join();body.name='cat_body_lod0'
activate(bare);bare_whiskers.select_set(True);bpy.ops.object.join();bare.name='cat_unarmored_lod0';bare['replacesEquippedBody']=True
lods=[body,gear,bare]
def weld_lod_topology(obj):
 # glTF render vertices split at UV and flat-normal seams. Collapse needs the
 # actual geometric graph, otherwise it merely drops disconnected triangles.
 mesh=obj.data;key=lambda co:tuple(round(c,6)for c in co)
 saved={tuple(sorted(key(mesh.vertices[q].co)for q in p.vertices)):{key(mesh.vertices[mesh.loops[l].vertex_index].co):tuple(mesh.corner_normals[l].vector)for l in p.loop_indices}for p in mesh.polygons}
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bm.to_mesh(mesh);bm.free();mesh.update()
 normals=[]
 for p in mesh.polygons:
  by_vertex=saved.get(tuple(sorted(key(mesh.vertices[q].co)for q in p.vertices)),{})
  p.use_smooth=True
  for li in p.loop_indices:normals.append(by_vertex.get(key(mesh.vertices[mesh.loops[li].vertex_index].co),tuple(p.normal)))
 mesh.normals_split_custom_set(normals)
for level,ratio in [(1,.48),(2,.18)]:
 for original,name in [(body,'cat_body_lod'),(gear,'cat_equipment_lod'),(bare,'cat_unarmored_lod')]:
  obj=original.copy();obj.data=original.data.copy();obj.name=name+str(level);bpy.context.collection.objects.link(obj);weld_lod_topology(obj);activate(obj);dec=obj.modifiers.new('Measured LOD reduction','DECIMATE');dec.ratio=({1:.36,2:.14}[level] if original==bare else ratio);bpy.ops.object.modifier_apply(modifier=dec.name);lods.append(obj)
# Seven accepted actions are the animation donor, retargeted into measured rest bases.
before=set(bpy.data.objects);before_a=set(bpy.data.actions);bpy.ops.import_scene.gltf(filepath=str(donor_path),bone_heuristic='BLENDER');donor=next(x for x in set(bpy.data.objects)-before if x.type=='ARMATURE');donor.name='accepted_cat_animation_donor';actions=list(set(bpy.data.actions)-before_a)
for x in set(bpy.data.objects)-before:x.hide_render=True
scene=bpy.context.scene;scene.render.fps=60
def select_action(obj,action):
 obj.animation_data_create()
 for t in obj.animation_data.nla_tracks:t.mute=True
 obj.animation_data.action=action
idle=next(a for a in actions if a.name.startswith('idle'));select_action(donor,idle);scene.frame_set(0);bpy.context.view_layer.update()
reference={p.name:p.rotation_quaternion.copy()for p in donor.pose.bones};oldrest={b.name:b.matrix_local.to_quaternion()for b in donor.data.bones};newrest={b.name:b.matrix_local.to_quaternion()for b in arm.bones};durations={'idle':10,'walk':1.2,'run':.8,'death':1.8,'jump':.7666666666666667,'land':.6333333333333333,'hit':.6333333333333333}
# Imported donor FCurves were authored in the import-time 24fps scene.
for clip,seconds in durations.items():
 da=next(a for a in actions if a.name.startswith(clip));select_action(donor,da);a=bpy.data.actions.new(clip);select_action(rig,a);a.use_fake_user=True;previous={}
 for frame in range(round(seconds*60)+1):
  t=frame/60;scene.frame_set(int(t*24),subframe=(t*24)%1);bpy.context.view_layer.update()
  for p in rig.pose.bones:
   p.rotation_mode='QUATERNION';p.location=Vector();p.scale=Vector((1,1,1))
   if p.name.startswith('socket_'):p.rotation_quaternion=Quaternion();continue
   d=donor.pose.bones[p.name];delta=reference[p.name].inverted()@d.rotation_quaternion;basis=newrest[p.name].inverted()@oldrest[p.name];q=basis@delta@basis.inverted();q.normalize()
   if p.name in previous and q.dot(previous[p.name])<0:q.negate()
   previous[p.name]=q.copy();p.rotation_quaternion=q
   if p.name=='cat_torso':p.location=d.location.copy()
   p.keyframe_insert('rotation_quaternion',frame=frame)
   if p.name=='cat_torso':p.keyframe_insert('location',frame=frame)
 for fc in a.fcurves:
  for k in fc.keyframe_points:k.interpolation='LINEAR'
select_action(rig,None)
for p in rig.pose.bones:p.rotation_quaternion=Quaternion();p.location=Vector();p.scale=Vector((1,1,1))
for x in list(set(bpy.data.objects)-before):bpy.data.objects.remove(x,do_unlink=True)
for a in actions:bpy.data.actions.remove(a)
# Reserve a thin atlas strip for repaired fur and whiskers. One shared material,
# normal map and packed metal/rough texture keep each body a single primitive.
import numpy as np
base_material=body.data.materials[0]
source_images=sorted({node.image for node in base_material.node_tree.nodes if node.type=='TEX_IMAGE' and node.image},key=lambda image:image.name)
for image in source_images:
 assert len(image.pixels[:])==image.size[0]*image.size[1]*4, 'Source texture failed to decode'
 target=1024 if 'metallic_roughness' in image.name else 2048
 strip=target//128
 image.scale(target,target-strip)
 pixels=np.array(image.pixels[:],dtype=np.float32).reshape(target-strip,target,4)
 atlas=np.ones((target,target,4),dtype=np.float32);atlas[strip:]=pixels
 if 'normal' in image.name.lower():atlas[:strip,:,:3]=[.5,.5,1]
 elif 'metallic_roughness' in image.name:atlas[:strip,:,:3]=[1,.65,0]
 else:
  atlas[:strip,:target//2,:3]=[.075,.075,.078]
  atlas[:strip,target//2:,:3]=[.80,.79,.76]
 image.scale(target,target);image.pixels.foreach_set(atlas.ravel());image.update();image.pack()
for ob in lods:
 mesh=ob.data;layer=mesh.uv_layers.active
 for poly in mesh.polygons:
  material=mesh.materials[poly.material_index]
  tile='fur' if material.name=='repair_fur' else ('whisker' if material.name=='whisker_ivory' else None)
  for li in poly.loop_indices:
   if tile:layer.data[li].uv=(.25 if tile=='fur' else .75,1/256)
   else:layer.data[li].uv.y=layer.data[li].uv.y*(127/128)+1/128
  poly.material_index=0
 mesh.materials.clear();mesh.materials.append(base_material)
# Local exported pose contact correction, not a Mount root/gameplay adjustment.
# Keep jump ascent intact and correct only mesh penetration below the sole plane.
ground_corrections={}
for action in [a for a in bpy.data.actions if a.name in durations]:
 select_action(rig,action)
 curves=[next(fc for fc in action.fcurves if fc.data_path=='pose.bones["cat_torso"].location' and fc.array_index==axis)for axis in range(3)]
 up=arm.bones['cat_torso'].matrix_local.to_3x3().inverted()@Vector((0,0,1));corrections=[]
 for frame in range(round(durations[action.name]*60)+1):
  scene.frame_set(frame);dg=bpy.context.evaluated_depsgraph_get();lowest=1e9
  for ob in [body,gear]:
   evaluated=ob.evaluated_get(dg);mesh=evaluated.to_mesh();lowest=min(lowest,min((evaluated.matrix_world@v.co).z for v in mesh.vertices));evaluated.to_mesh_clear()
  corrections.append(max(0,-lowest))
 ground_corrections[action.name]={'minimum':min(corrections),'maximum':max(corrections)}
 for axis,curve in enumerate(curves):
  for frame,key in enumerate(curve.keyframe_points):key.co.y+=corrections[frame]*up[axis]
select_action(rig,None)
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
# Save editable staging, then export selected production mesh/rig only.
for ob in lods:ob.hide_render=False
scene.frame_set(0);bpy.ops.wm.save_as_mainfile(filepath=str(out/'black-cat.blend'))
bpy.ops.object.select_all(action='DESELECT')
for ob in [rig,*lods]:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'black-cat.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_all_influences=False,export_extras=True,export_yup=True,export_apply=False,export_image_format='AUTO')
report={'sourceSha256':config['sourceSha256'],'sourceTriangles':10322,'muzzleRepair':muzzle_report,'groundCorrections':ground_corrections,'uniformScale':scale,'landmarks':config['bones'],'clips':durations,'geometryTriangles':{ob.name:sum(len(p.vertices)-2 for p in ob.data.polygons)for ob in lods},'whiskers':{'count':6,'bone':'cat_head','segments':8,'sourceRoots':whisker_roots},'validation':{'browserGameplay':False,'visualReview':False}}
(out/'build.json').write_text(json.dumps(report,indent=2));print('BUILD',json.dumps(report))
