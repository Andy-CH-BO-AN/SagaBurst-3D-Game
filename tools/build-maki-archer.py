#!/usr/bin/env python3
"""Reproducible Maki authoring. Blender -b --python tools/build-maki-archer.py -- [source.glb]
Only geometry/materials from the user-supplied Maki. Existing Viking contributes
bone coordinate frames, never body geometry. Animations are baked separately.
"""
import bpy,bmesh,json,hashlib,math,sys,struct,heapq
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
import numpy as np
ROOT=Path.cwd();OUT=ROOT/'public/models/characters/v2/maki-archer-t4';OUT.mkdir(parents=True,exist_ok=True)
BOW=ROOT/'public/models/weapons/maki-ranger-bow';BOW.mkdir(parents=True,exist_ok=True)
SOURCE=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else Path.home()/'Downloads/maki_archer.glb'
raw=SOURCE.read_bytes();doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
sha=hashlib.sha256(raw).hexdigest()
if sha!='de18d6e174d8b0e282dfa30a16382af44e1b815512187b8dc5ffea312dd08601':raise ValueError('Unreviewed source GLB: landmarks/island classification require another audit')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes=[o for o in bpy.data.objects if o.type=='MESH']
source_stats=[]
for o in meshes:
 ps=[o.matrix_world@v.co for v in o.data.vertices]
 source_stats.append(dict(name=o.name,vertices=len(ps),triangles=sum(len(p.vertices)-2 for p in o.data.polygons),boundsBlenderM=[[min(v[i] for v in ps) for i in range(3)],[max(v[i] for v in ps) for i in range(3)]],matrixWorld=list(sum((list(row) for row in o.matrix_world),[]))))
sole=min(d['boundsBlenderM'][0][2] for d in source_stats if d['name'].startswith('Boots'))
source_images=[dict(name=i.name,width=i.size[0],height=i.size[1]) for i in bpy.data.images]
source_image_objects=list(bpy.data.images)
# Bake the complete source hierarchy without changing its proportions.
for o in meshes:
 mw=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(mw)
 for v in o.data.vertices:v.co.z-=sole
for o in list(bpy.data.objects):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)

def components(o):
 adj=[set() for v in o.data.vertices]
 for e in o.data.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
 remain=set(range(len(adj)));parts=[]
 while remain:
  stack=[remain.pop()];ids=[]
  while stack:
   i=stack.pop();ids.append(i)
   for j in adj[i]:
    if j in remain:remain.remove(j);stack.append(j)
  parts.append(ids)
 return parts

def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def retain(o,ids):
 bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in ids],context='VERTS');bm.to_mesh(o.data);bm.free()

def export(path,objects):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_all_influences=False,export_extras=True,export_yup=True,export_apply=False)

bow=bpy.data.objects['Spirit_Bow_Bow_Arrow_0'];arrow=bpy.data.objects['Flaming_Arrow_Bow_Arrow_0'];body=[o for o in meshes if o not in [bow,arrow]]
# Keep a source-pose comparison GLB. This is the same Maki, with bow/held arrow
# removed; ground translation is the only change. Excluded from runtime loading.
comparison=ROOT/'output/maki-source';comparison.mkdir(parents=True,exist_ok=True)
export(comparison/'source-body.glb',body)
# The handle is a disconnected 72-vertex source island (verified source hash).
handle=next(ids for ids in components(bow) if len(ids)==72)
pts=np.array([list(bow.data.vertices[i].co) for i in handle]);grip=Vector(pts.mean(axis=0));_,_,axes=np.linalg.svd(pts-pts.mean(axis=0),full_matrices=False);up=Vector(axes[0]);
if up.x<0:up=-up
# Main body and straight baked string become two connected islands after welding
# duplicate seam vertices. UVs remain per loop, so welding does not discard UVs.
bm=bmesh.new();bm.from_mesh(bow.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bm.to_mesh(bow.data);bm.free()
parts=sorted(components(bow),key=len,reverse=True)
if [len(p) for p in parts]!=[2320,1640]:raise ValueError('Bow island audit changed')
string_points=[bow.data.vertices[i].co for i in parts[1]]
a=min(string_points,key=lambda p:p.dot(up));b=max(string_points,key=lambda p:p.dot(up));up=(b-a).normalized()
mid=(a+b)/2;shoot=(grip-mid);shoot-=up*shoot.dot(up);shoot.normalize();normal=shoot.cross(up).normalized()
# Canonical bow: +Y up and -Z shooting in glTF, grip at the origin.
frame=Matrix((normal,shoot,up)).to_4x4();frame.translation=-(frame.to_3x3()@grip)
string_endpoints=[frame@a,frame@b]
retain(bow,set(parts[0]));bow.data.transform(frame);bow.name='Maki_original_Spirit_Bow'
# Hand landmarks are authored in the preserved source pose, then stored in each
# fitted bone's local coordinates. No global Viking hand offsets are reused.
source_grip=grip.copy();source_up=up.copy();source_shoot=shoot.copy()
bpy.data.objects.remove(arrow,do_unlink=True)
# Read only the project's skeleton frames. Delete all imported Viking surfaces.
existing=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/characters/v2/viking/lod0.glb'))
rig=next(o for o in bpy.data.objects if o not in existing and o.type=='ARMATURE');rig.animation_data_clear();rig.data.pose_position='REST'
for o in list(bpy.data.objects):
 if o not in existing and o!=rig:bpy.data.objects.remove(o,do_unlink=True)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
rig.name='project_humanoid';canonical={b.name:b.matrix_local.copy() for b in rig.data.bones}
def V(x,y,z):return Vector((x,y,z-sole))
land={
 'hips':V(0,.012,.815),'spine':V(0,.004,.935),'chest':V(0,0,1.045),'upper_chest':V(0,0,1.14),'neck':V(0,0,1.205),'head':V(.008,-.01,1.282),
 'clavicle_l':V(.035,0,1.165),'upper_arm_l':V(.137,0,1.155),'lower_arm_l':V(.151,-.095,.970),'hand_l':V(.157,-.250,.862),
 'clavicle_r':V(-.035,0,1.165),'upper_arm_r':V(-.137,0,1.155),'lower_arm_r':V(-.133,-.064,.970),'hand_r':V(-.026,-.191,.880),
}
for side,s in [('l',1),('r',-1)]:
 land.update({f'upper_leg_{side}':V(s*.075,.012,.815),f'lower_leg_{side}':V(s*.115,-.014,.473),f'foot_{side}':V(s*.120,0,.115),f'toe_{side}':V(s*.12,-.110,.040)})
tails={'hand_l':V(.176,-.305,.815),'hand_r':V(.039,-.235,.832),'head':V(.008,-.01,1.422)}
nexts={'hips':'spine','spine':'chest','chest':'upper_chest','upper_chest':'neck','neck':'head'}
for side in ['l','r']:
 nexts.update({f'clavicle_{side}':f'upper_arm_{side}',f'upper_arm_{side}':f'lower_arm_{side}',f'lower_arm_{side}':f'hand_{side}',f'upper_leg_{side}':f'lower_leg_{side}',f'lower_leg_{side}':f'foot_{side}',f'foot_{side}':f'toe_{side}'})
activate(rig);bpy.ops.object.mode_set(mode='EDIT')
for name,p in land.items():
 b=rig.data.edit_bones[name];old=canonical[name].to_quaternion();direction=(land[nexts[name]]-p) if name in nexts else (tails.get(name,p+Vector((0,-.08,0)))-p)
 q=(old@Vector((0,1,0))).rotation_difference(direction.normalized())@old
 if name=='head':q=Quaternion((0,0,1),.65)@q
 b.matrix=Matrix.Translation(p)@q.to_matrix().to_4x4();b.length=direction.length;b.use_connect=False
for b in rig.data.edit_bones:
 if b.name in land:continue
 parent=b.parent
 p=parent.head.copy()
 if b.name=='socket_back':p+=Vector((0,.1,0))
 if b.name=='socket_head':p=land['head']+Vector((0,0,.12))
 if b.name.startswith('sole_'):p.z=0
 b.head=p;b.tail=p+Vector((0,0,.025));b.use_connect=False
for side in ['l','r']:
 lower=rig.data.edit_bones['lower_arm_'+side]
 twist=rig.data.edit_bones.new('forearm_twist_'+side)
 twist.parent=lower;twist.head=lower.head.copy();twist.tail=lower.tail.copy();twist.roll=lower.roll;twist.length=lower.length*.6;twist.use_connect=False
for side in ['l','r']:
 lower=rig.data.edit_bones['lower_arm_'+side]
 for name in ['forearm_twist_mid_'+side,'forearm_twist_distal_'+side]:
  twist=rig.data.edit_bones.new(name)
  twist.parent=lower;twist.head=lower.head.copy();twist.tail=lower.tail.copy();twist.roll=lower.roll;twist.use_connect=False
upper=rig.data.edit_bones['upper_arm_l']
deltoid=rig.data.edit_bones.new('deltoid_l')
deltoid.parent=upper.parent;deltoid.head=upper.head.copy();deltoid.tail=upper.tail.copy();deltoid.roll=upper.roll;deltoid.use_connect=False
bpy.ops.object.mode_set(mode='OBJECT')
# Region-aware weights on the original posed mesh; no source body substitutions.
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def mix(a,b,t):
 out={n:w*(1-t) for n,w in a.items()}
 for n,w in b.items():out[n]=out.get(n,0)+w*t
 return out

def leg(p):
 side='l' if p.x>0 else 'r';z=p.z+sole
 w=mix({f'upper_leg_{side}':1},{f'lower_leg_{side}':1},smooth((.54-z)/.12))
 w=mix(w,{f'foot_{side}':1},smooth((.20-z)/.09));return mix(w,{'hips':1},smooth((z-.75)/.10))
def torso(p):
 z=p.z+sole
 if z<.82:
  skirt=mix({'upper_leg_r':1},{'upper_leg_l':1},smooth((p.x+.08)/.16))
  return mix(skirt,{'hips':1},.35+.65*smooth((z-.68)/.14))
 if z<.96:return mix({'hips':1},{'spine':1},smooth((z-.83)/.12))
 if z<1.08:return mix({'spine':1},{'chest':1},smooth((z-.96)/.12))
 return mix({'chest':1},{'upper_chest':1},smooth((z-1.08)/.08))
def arm(p,side):
 sh,el,wr=[land[n+side] for n in ['upper_arm_','lower_arm_','hand_']]
 t=(p-el).dot((wr-el).normalized())
 twist_fraction=smooth((t/(wr-el).length-.20)/.65)
 # Adjacent frames preserve forearm volume for both bow and axe pronation.
 frames=[f'forearm_twist_{side}',f'forearm_twist_mid_{side}',f'forearm_twist_distal_{side}',f'lower_arm_{side}']
 interval=min(2,int(twist_fraction*3));fraction=twist_fraction*3-interval
 forearm=mix({frames[interval]:1},{frames[interval+1]:1},fraction)
 w=mix({f'upper_arm_{side}':1},forearm,smooth((t+.025)/.05))
 t=(p-wr).dot((wr-el).normalized())
 return mix(w,{f'hand_{side}':1},smooth((t+.023)/.046))
def shoulder_support(p,w):
 # Shoulder cap/upper garment belongs to the clavicle between chest and arm.
 # The source had no rig; assigning this region only to chest freezes the
 # shoulder even when the upper arm has raised.
 z=p.z+sole
 lateral=smooth((abs(p.x)-.04)/.07)
 height=smooth((z-1.08)/.055)*(1-smooth((z-1.17)/.06))
 depth=1-smooth((abs(p.y)-.025)/.065)
 return mix(w,{f"clavicle_{'l' if p.x>0 else 'r'}":1},lateral*height*depth)
def sleeve_skin(p,side,sw):
 base=shoulder_support(p,torso(p));limb=arm(p,side)
 linear=mix(base,limb,sw)
 if side!='l':return linear
 # Preserve the deltoid arc at the shoulder joint, without lifting the lower
 # axilla/body panel. The helper only subdivides the large shoulder rotation.
 radius=(p-land['upper_arm_l']).length
 influence=1-smooth((radius-.035)/.045)
 curved=mix(base,{'deltoid_l':1},sw*2) if sw<.5 else mix({'deltoid_l':1},limb,sw*2-1)
 return mix(linear,curved,influence)

# Compute sleeve influence ALONG the garment, never across the air gap between
# sleeve and chest. Work on a welded analysis copy; preserve original UV seams.
jacket=bpy.data.objects['Jacket_Jecket_0'];bm=bmesh.new();bm.from_mesh(jacket.data)
cloth_ids=set(i for ids in components(jacket) if len(ids)>=1000 for i in ids)
bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in cloth_ids],context='VERTS')
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bm.verts.ensure_lookup_table();bm.verts.index_update()
bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.faces.ensure_lookup_table();bm.faces.index_update()
remaining=set(v for e in bm.edges if e.is_boundary for v in e.verts);cuffs=[]
while remaining:
 stack=[remaining.pop()];loop=[]
 while stack:
  v=stack.pop();loop.append(v)
  for e in v.link_edges:
   u=e.other_vert(v)
   if e.is_boundary and u in remaining:remaining.remove(u);stack.append(u)
 center=sum((v.co for v in loop),Vector())/len(loop)
 if len(loop)==25 and abs(center.x)>.1 and .99<center.z+sole<1.03:cuffs.append(loop)
if len(cuffs)!=2:raise ValueError('Source sleeve boundary audit changed')
dist=[math.inf]*len(bm.verts);queue=[]
for loop in cuffs:
 for v in loop:dist[v.index]=0;heapq.heappush(queue,(0,v.index))
while queue:
 d,i=heapq.heappop(queue)
 if d!=dist[i]:continue
 v=bm.verts[i]
 for e in v.link_edges:
  u=e.other_vert(v);candidate=d+(u.co-v.co).length
  if candidate<dist[u.index]:dist[u.index]=candidate;heapq.heappush(queue,(candidate,u.index))
# Keep the upper sleeve attached to the upper arm through its full length.
# Blend only around the shoulder seam; the previous 10.5 cm blend started
# near the elbow and pinned most of the sleeve to the chest during arm raises.
field=[]
for v,d in zip(bm.verts,dist):
 sw=1-smooth((d-.125)/.065) if math.isfinite(d) else 0
 # The sleeve joins the torso at the armpit. Only the outer shoulder panel
 # follows the upper arm there; the chest-side cloth remains on the torso.
 shoulder_band=smooth((v.co.z+sole-1.055)/.05)
 outer_panel=smooth((abs(v.co.x)-.075)/.065)
 sw*=((1-shoulder_band)+shoulder_band*outer_panel)
 field.append(sw)
# Identify the actual sleeve/body branches below their axillary junction.
# Cuff distance alone crosses into the side panel: points below the armpit
# were getting upper-arm weights and pulling the torso out with the elbow.
# Use connected garment regions as Dirichlet anchors, then diffuse only the
# shoulder transition. Apply the same anatomical rule to both arm raises.
branch_height=1.03
sleeve_branch=set(v for c in cuffs for v in c if v.co.z+sole<branch_height)
stack=list(sleeve_branch)
while stack:
 v=stack.pop()
 for e in v.link_edges:
  u=e.other_vert(v)
  if u not in sleeve_branch and u.co.z+sole<branch_height:
   sleeve_branch.add(u);stack.append(u)
fixed={}
for v in bm.verts:
 if v.co.z+sole<branch_height:fixed[v.index]=1.0 if v in sleeve_branch else 0.0
 elif abs(v.co.x)>.135 and v.co.z+sole<1.18:fixed[v.index]=1.0
 elif abs(v.co.x)<.065:fixed[v.index]=0.0
neighbors=[[(e.other_vert(v).index,1/max((e.other_vert(v).co-v.co).length_squared,1e-8)) for e in v.link_edges] for v in bm.verts]
for i,value in fixed.items():field[i]=value
for iteration in range(1600):
 delta=0
 for v in bm.verts:
  i=v.index
  if i in fixed:continue
  adj=neighbors[i];value=sum(field[j]*w for j,w in adj)/sum(w for _,w in adj)
  delta=max(delta,abs(value-field[i]));field[i]=value
 if delta<1e-7:break
surface=[v for v in bm.verts if math.isfinite(dist[v.index])];tree=KDTree(len(surface))
for i,v in enumerate(surface):tree.insert(v.co,i)
tree.balance();sleeve_weights={}
for v in jacket.data.vertices:
 _,i,_=tree.find(v.co)
 sleeve_weights[v.index]=field[surface[i].index]
# Transfer decorations onto their actual supporting cloth triangles, restricted
# to sleeve/body respectively. Barycentric interpolation avoids abrupt weights
# at sparse garment vertices and keeps a badge flush through shoulder bending.
for is_sleeve in [False,True]:
 faces=[f for f in bm.faces if (sum(field[v.index] for v in f.verts)/3>.1)==is_sleeve]
 bvh=BVHTree.FromPolygons([v.co for v in bm.verts],[[v.index for v in f.verts] for f in faces],all_triangles=True)
 for ids in components(jacket):
  if len(ids)>=1000:continue
  center=sum((jacket.data.vertices[i].co for i in ids),Vector())/len(ids)
  if (abs(center.x)>.12 and center.z+sole>1.005)!=is_sleeve:continue
  for i in ids:
   loc,_,face_index,_=bvh.find_nearest(jacket.data.vertices[i].co)
   vs=list(faces[face_index].verts)
   values=[Vector((field[v.index],0,0)) for v in vs]
   sleeve_weights[i]=max(0,min(1,barycentric_transform(loc,*[v.co for v in vs],*values).x))
shoulder_faces=[f for f in bm.faces if all(v.co.z+sole>1.075 for v in f.verts)]
shoulder_triangles=[[v.co.copy() for v in f.verts] for f in shoulder_faces]
shoulder_values=[[Vector((field[v.index],0,0)) for v in f.verts] for f in shoulder_faces]
shoulder_bvh=BVHTree.FromPolygons([v.co for v in bm.verts],[[v.index for v in f.verts] for f in shoulder_faces],all_triangles=True)
bm.free()
for o in body:
 o.vertex_groups.clear();assign={}
 for ids in components(o):
  center=sum((o.data.vertices[i].co for i in ids),Vector())/len(ids)
  side='l' if center.x>.10 else 'r'
  for i in ids:
   p=o.data.vertices[i].co;z=p.z+sole;n=o.name
   if n.startswith(('Gloves','Maki Body')):w=arm(p,side)
   elif n.startswith(('Boots','Pants')):w=leg(p)
   elif n.startswith(('Eyes','Maki Face')):w=mix({'neck':1},{'head':1},smooth((z-1.20)/.06))
   elif n.startswith(('Arrow Stack','Quiver')):w={'chest':1}
   elif n.startswith('Hood'):
    w=mix({'upper_chest':1},{'neck':1},smooth((z-1.19)/.04));w=mix(w,{'head':1},smooth((z-1.235)/.05));w=shoulder_support(p,w)
    # The hood shoulder flap rests on the jacket. Transfer the same skin field
    # at their overlap so raising the arm cannot separate the two layers.
    if abs(p.x)>.06 and z<1.235:
     loc,_,fi,_=shoulder_bvh.find_nearest(p)
     sw=max(0,min(1,barycentric_transform(loc,*shoulder_triangles[fi],*shoulder_values[fi]).x))
     support=sleeve_skin(p,'l' if p.x>0 else 'r',sw)
     cap=smooth((abs(p.x)-.10)/.035)*(1-smooth((abs(p.y)-.02)/.05))*smooth((z-1.10)/.05)*(1-smooth((z-1.19)/.045))
     w=mix(w,support,cap)
   else:
    w=torso(p)
    if n.startswith('Jacket'):
     w=shoulder_support(p,w)
     sw=sleeve_weights[i]
     w=sleeve_skin(p,'l' if p.x>0 else 'r',sw)
   w=sorted(((n,v) for n,v in w.items() if v>1e-6),key=lambda a:-a[1])[:4];total=sum(v for n,v in w)
   for name,v in w:
    g=o.vertex_groups.get(name) or o.vertex_groups.new(name=name);g.add([i],v/total,'REPLACE')
 o.parent=rig;m=o.modifiers.new('Maki_fitted_skin','ARMATURE');m.object=rig
# Project-space conversions used by JSON metadata (Blender Z-up -> glTF Y-up).
C=Matrix.Rotation(-math.pi/2,4,'X')
def arr(v):return [float(x) for x in v]
def local_point(name,p):return rig.data.bones[name].matrix_local.inverted()@p
def local_dir(name,p):return rig.data.bones[name].matrix_local.to_quaternion().inverted()@p
left_center=local_point('hand_l',source_grip);left_axis=-local_dir('hand_l',source_up).normalized();left_normal=local_dir('hand_l',source_shoot).normalized()
# GLTF bone local bases survive export, unlike root coordinates.
left={'palmContactCenter':arr(left_center-left_normal*.016),'palmNormal':arr(left_normal),'thumbDir':1,'thumbDirection':arr(left_axis),'fingerDirection':[0,1,0],'wristCenter':[0,0,0],'fingerBase':.048,'thumbBaseCenter':arr(left_center-left_axis*.024)}
right_center=local_point('hand_r',V(.033,-.228,.834));right_axis=local_dir('hand_r',Vector((.80,.55,.22)).normalized());right_normal=local_dir('hand_r',Vector((.30,-.05,-.95)).normalized());right_normal-=right_axis*right_axis.dot(right_normal);right_normal.normalize()
right={'gripCenterLocal':arr(right_center),'gripAxisLocal':arr(right_axis),'palmNormalLocal':arr(right_normal),'fingerDirection':[0,1,0],'wristCenter':[0,0,0],'thumbBaseCenter':arr(right_center-right_axis*.02),'fingerBase':.043,'gripRadius':.022}
# Explicit authored contact landmarks prevent mirrored assumptions on a posed,
# asymmetric source. Children are non-deforming bones for all LODs.
activate(rig);bpy.ops.object.mode_set(mode='EDIT')
for name,parent,p in [('bow_string_contact','hand_r',V(.025,-.243,.826)),('bow_arrow_rest','hand_l',source_grip-source_up*.037+normal*.02)]:
 b=rig.data.edit_bones.new(name);b.head=p;b.tail=p+Vector((0,0,.01));b.parent=rig.data.edit_bones[parent];b.use_deform=False
bpy.ops.object.mode_set(mode='OBJECT')
# Preserve the fitted rest hierarchy, axes and lengths for audit / animation bake.
rig_info={b.name:{'parent':b.parent.name if b.parent else None,'headBlenderM':arr(b.head_local),'tailBlenderM':arr(b.tail_local),'restMatrixBlender':list(sum((list(r) for r in b.matrix_local),[])),'lengthM':b.length} for b in rig.data.bones}
# Every LOD is reduced from the same source. Prefer face/hands and silhouette;
# reducing hidden quiver arrows saves detail where it is least visible.
source_data={o:o.data.copy() for o in body}
export(BOW/'bow.glb',[bow])
triangles={};texture_sizes={}
for lod,budget,tex in [(0,60000,2048),(1,20000,1024),(2,6000,512)]:
 scores={o:sum(len(p.vertices)-2 for p in source_data[o].polygons)*(.45 if o.name.startswith('Arrow Stack') else 1.25 if o.name.startswith(('Maki Face','Gloves')) else 1) for o in body};total=sum(scores.values())
 for o in body:
  o.data=source_data[o].copy();count=sum(len(p.vertices)-2 for p in o.data.polygons);target=budget*scores[o]/total
  activate(o);m=o.modifiers.new('Maki_LOD_budget','DECIMATE');m.ratio=min(1,target/count);m.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=m.name)
 for im in source_image_objects:
  if max(im.size)>tex:im.scale(min(tex,im.size[0]),min(tex,im.size[1]));im.pack()
 export(OUT/f'lod{lod}.glb',[rig,*body]);triangles[f'lod{lod}']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in body);texture_sizes[f'lod{lod}']=max(min(tex,i['width'],i['height']) for i in source_images)
# Bow uses its original material and 2K maps. Static baked string was separated;
# CharacterBowVisual supplies its existing dynamic string and projectile flow.
bow_profile={'id':'maki-ranger-bow','sourceSha256':sha,'sourceMesh':'Spirit_Bow_Bow_Arrow_0','gripRadius':.016,'gripLength':.11,'topTip':arr(C@string_endpoints[1]),'bottomTip':arr(C@string_endpoints[0]),'gripCenterLocal':[0,0,0],'shootingAxis':[0,0,-1],'longitudinalAxis':[0,1,0],'originalBowTriangles':7752,'bodyTriangles':sum(len(p.vertices)-2 for p in bow.data.polygons),'removedStringWeldedVertices':1640,'method':'Extracted original independent mesh; welded UV seam duplicates retaining loop UVs; separated only the straight string island; rigid pivot/basis normalization; original bow surface/material retained.'}
(BOW/'attachment.json').write_text(json.dumps(bow_profile,indent=2)+'\n')
height=max(v.co.z for o in body for v in source_data[o].vertices)
measure={'sourceSha256':sha,'heightM':height,'overallHeightM':height,'heightDefinition':'Original posed shoe outsole to hood top after complete glTF hierarchy; not naked anatomical height. Scalp is covered. No inferred author-page height.','faceHairTopFromSoleM':next(x['boundsBlenderM'][1][2] for x in source_stats if x['name'].startswith('Maki Face'))-sole,'shoulderWidthM':.274,'shoulderDefinition':'Authored shoulder joint span in preserved source pose','neckLengthM':(land['head']-land['neck']).length,'triangles':triangles,'textures':texture_sizes,'uniformScaleApplied':1,'groundTranslationM':-sole,'handGripFrames':{'left':left},'swordGripFrames':{f'lod{i}':right for i in range(3)},'sourcePoseRig':rig_info,'retargetMethod':'New fitted project-humanoid-v1 rig and region-aware normalized skin weights on original static Maki surfaces. Retarget uses physical bone axes and calibrated palm frames; source animation world orientations baked into fitted hierarchy, not renamed bones.'}
(OUT/'blender-measurements.json').write_text(json.dumps(measure,indent=2)+'\n')
(OUT/'source-audit.json').write_text(json.dumps({'sourceFile':SOURCE.name,'sha256':sha,'bytes':len(raw),'asset':doc['asset'],'sceneHierarchy':doc['nodes'],'meshes':source_stats,'skins':doc.get('skins',[]),'animations':doc.get('animations',[]),'materials':doc['materials'],'textures':source_images,'triangles':sum(m['triangles'] for m in source_stats),'coordinates':'glTF +Y up; imported Blender +Z up, -Y forward; source root includes 0.909090936 scale and nested 0.01 scale; full transforms baked, no runtime scaling.','bindPose':'None: static posed mesh, no skin/joints.','sockets':[],'retainedMeshes':[o.name for o in body],'separatedBow':'Spirit_Bow_Bow_Arrow_0','removedHeldArrow':'Flaming_Arrow_Bow_Arrow_0','height':{k:measure[k] for k in ['heightM','heightDefinition','faceHairTopFromSoleM','groundTranslationM']}},indent=2)+'\n')
(OUT/'bone-map.json').write_text(json.dumps({'skeleton':'project-humanoid-v1','sourceSkeleton':None,'method':'New rig; source has no bones to rename or transfer weights from. Only project skeleton frames reused; no Viking geometry.','bones':rig_info},indent=2)+'\n')
print(json.dumps({'measurements':{k:measure[k] for k in ['heightM','triangles','textures']},'bow':bow_profile},indent=2))
