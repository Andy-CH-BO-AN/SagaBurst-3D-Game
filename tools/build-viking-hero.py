#!/usr/bin/env python3
"""Rebuild the revised hero from audited continuous body pieces plus authored armour.
Run from repository root: blender -b --python tools/build-viking-hero.py
Runtime GLBs are exported without actions; retarget-viking-hero.mjs bakes existing clips.
"""
import bpy, bmesh, math, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
import numpy as np
ROOT=Path.cwd(); OUT=ROOT/"public/models/characters/v2/viking-hero-t4"
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/"public/models/characters/v2/viking/lod0.glb"))
rig=next(o for o in bpy.data.objects if o.type=="ARMATURE")
rig.animation_data_clear(); rig.data.pose_position="REST"
for a in list(bpy.data.actions): bpy.data.actions.remove(a)

def islands(o):
 adj=[set() for v in o.data.vertices]
 for e in o.data.edges:
  a,b=e.vertices;adj[a].add(b);adj[b].add(a)
 remaining=set(range(len(adj))); result=[]
 while remaining:
  stack=[remaining.pop()]; ids=[]
  while stack:
   i=stack.pop();ids.append(i)
   for j in adj[i]:
    if j in remaining:remaining.remove(j);stack.append(j)
  result.append(ids)
 return result

def retain(o, keep):
 bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table()
 bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in keep],context="VERTS")
 bm.to_mesh(o.data);bm.free()
head=bpy.data.objects["Head"]
# Reuse only the already face-fitted spectacle/nasal metalwork, not the source
# helmet dome, liner, brow band, cheek guards or horns. This keeps the actual
# face opening topology and avoids projected strips cutting through eyelids.
guard=head.copy();guard.data= head.data.copy();bpy.context.collection.objects.link(guard);guard.name='Hero_fitted_spectacle_nasal_guard'
guard_ids=set()
for part in islands(guard):
 ps=[guard.data.vertices[i].co for i in part]
 if min(p.z for p in ps)>1.64 and max(p.z for p in ps)<1.75 and min(p.y for p in ps)<-.095 and max(abs(p.x) for p in ps)<.100:
  guard_ids.update(part)
retain(guard,guard_ids)
# The audited source stores skin/neck/ears before vertex 3250; later islands
# are the complete old helmet (including eye guard, liner and cheek pieces).
# Keep all skin fragments, rather than guessing by height and retaining armour.
face_ids=set(range(3250))
retain(head,face_ids);head.name="Hero_original_face_neck"
limbs=bpy.data.objects["Legs Hands"]
boots=limbs.copy();boots.data=limbs.data.copy();bpy.context.collection.objects.link(boots);boots.name="Hero_source_boots"
boot_ids=set()
for part in islands(boots):
 if max(boots.data.vertices[i].co.z for i in part)<.215:boot_ids.update(part)
retain(boots,boot_ids)
keep=set()
for part in islands(limbs):
 if len(part)>500 and all(abs(limbs.data.vertices[i].co.x)>.50 for i in part):keep.update(part)
retain(limbs,keep);limbs.name="Hero_hands"
shirt=bpy.data.objects["Tunic"]
shirt_parts=sorted(islands(shirt),key=len,reverse=True)[:2];retain(shirt,set(i for part in shirt_parts for i in part));shirt.name="Hero_continuous_hauberk"
for o in list(bpy.data.objects):
 if o not in [head,guard,limbs,boots,shirt,rig]:bpy.data.objects.remove(o,do_unlink=True)
source_crown=1.8181092739105225  # Authored anatomical scalp apex; source face has an open crown under its cap.
# Anatomical standing plane is 30 mm above the boot outsole in the source frame.
S=2.0/(source_crown-.03)
def warp(p):
 x,y,z=p
 # Thicker chest and wider shoulder girdle, arms translated rather than stretched.
 widen=.01*min(abs(x)/.227568,1)*min(max((z-.85)/.45,0),1)
 return Vector((x*S+math.copysign(widen,x), y*S, z*S))
for o in [head,guard,limbs,boots,shirt]:
 for v in o.data.vertices:v.co=v.co*S if o in [head,guard] else warp(v.co)
 if o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:
   for v in key.data:v.co=v.co*S if o in [head,guard] else warp(v.co)
# Closed anatomical torso under the open source vest. Unioning this volume
# closes its centre slit and prevents see-through chest/abdomen at every LOD.
verts=[];faces=[]
for j in range(25):
 z=1.135+j/24*.535
 rx=float(np.interp(z,[1.135,1.25,1.43,1.57,1.67],[.234,.237,.262,.235,.145]))
 ry=float(np.interp(z,[1.135,1.25,1.43,1.57,1.67],[.166,.180,.194,.16,.108]))
 for i in range(64):
  a=i/64*math.tau;verts.append((rx*math.cos(a),.035+ry*math.sin(a),z))
for j in range(24):
 for i in range(64):
  a=j*64+i;b=j*64+(i+1)%64;faces.append((a,b,b+64,a+64))
faces.extend([tuple(reversed(range(64))),tuple(range(24*64,25*64))])
core_data=bpy.data.meshes.new('Closed_abdominal_surface');core_data.from_pydata(verts,[],faces);core_data.update()
core=bpy.data.objects.new('Closed_abdominal_surface',core_data);bpy.context.collection.objects.link(core)
for v in core_data.vertices:
 chest=max(0,min(1,(v.co.z-1.22)/.35));hips=max(0,min(1,(1.30-v.co.z)/.165));spine=max(0,1-chest-hips);total=chest+hips+spine
 for name,w in [('chest',chest),('spine',spine),('hips',hips)]:
  if w:
   group=core.vertex_groups.get(name) or core.vertex_groups.new(name=name);group.add([v.index],w/total,'REPLACE')
bpy.ops.object.select_all(action='DESELECT');shirt.select_set(True);core.select_set(True);bpy.context.view_layer.objects.active=shirt;bpy.ops.object.join()
# Remove buried duplicate surfaces by voxel-unioning the source shirt and vest.
# Preserve the nearest original blended skin weights on the continuous exterior.
# Solidifying before union closes the open hems without filling arm openings.
original_weights=[{shirt.vertex_groups[g.group].name:g.weight for g in v.groups} for v in shirt.data.vertices]
kd=KDTree(len(shirt.data.vertices))
for v in shirt.data.vertices:kd.insert(v.co,v.index)
kd.balance()
bpy.context.view_layer.objects.active=shirt
solid=shirt.modifiers.new("Garment_shell_union","SOLIDIFY");solid.thickness=.010;solid.offset=0;bpy.ops.object.modifier_apply(modifier=solid.name)
remesh=shirt.modifiers.new("Continuous_shoulder_surface","REMESH");remesh.mode='VOXEL';remesh.voxel_size=.005;remesh.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=remesh.name)
shirt.vertex_groups.clear()
for v in shirt.data.vertices:
 near=kd.find_n(v.co,3);w={};total=0
 for co,index,d in near:
  influence=1/max(d,.0001);total+=influence
  for name,value in original_weights[index].items():w[name]=w.get(name,0)+value*influence
 w=sorted(w.items(),key=lambda p:p[1],reverse=True)[:4];total=sum(value for name,value in w)
 for name,value in w:
  group=shirt.vertex_groups.get(name) or shirt.vertex_groups.new(name=name);group.add([v.index],value/total,'REPLACE')
# Trim lower vest below the new belt, then tuck it inside the belt volume.
bm=bmesh.new();bm.from_mesh(shirt.data)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,1.135),plane_no=(0,0,1),clear_inner=True)
bm.to_mesh(shirt.data);bm.free()
for v in shirt.data.vertices:
 if abs(v.co.x)<.26 and v.co.z<1.3:
  t=max(0,min(1,(1.30-v.co.z)/.12));r=math.sqrt((v.co.x/.233)**2+((v.co.y-.045)/.161)**2)
  if r>1:v.co.x*=1-t+t/r;v.co.y=.045+(v.co.y-.045)*(1-t+t/r)
# Reduce only the voxel-unioned garment before shared LOD generation. Otherwise
# its dense surface would consume the budget and destroy face/boot/cloth detail.
bpy.context.view_layer.objects.active=shirt
count=sum(len(p.vertices)-2 for p in shirt.data.polygons)
reduce=shirt.modifiers.new('Garment_authoring_budget','DECIMATE');reduce.ratio=min(1,20000/count);bpy.ops.object.modifier_apply(modifier=reduce.name)
shirt.data.uv_layers.new(name='UVMap')
# Move rest joints, retain each original local frame (and roll) for exact delta retargeting.
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for b in rig.data.edit_bones:
 h=warp(b.head); direction=(b.tail-b.head)*S;b.head=h;b.tail=h+direction
# Independent, optional cloth chain; required humanoid joints stay unchanged.
parent=rig.data.edit_bones["chest"]
for name,top,bottom in [("cape_upper",1.73,1.39),("cape_mid",1.39,1.05),("cape_lower",1.05,.72)]:
 b=rig.data.edit_bones.new(name);b.head=(0,.26,top);b.tail=(0,.29,bottom);b.parent=parent;parent=b
bpy.ops.object.mode_set(mode="OBJECT");rig.select_set(False)
for o in [head,guard,limbs,boots,shirt]:
 o.parent=rig
 for m in o.modifiers:
  if m.type=="ARMATURE":m.object=rig
# Fix actual root/object transforms into exported geometry.
rig.name="project_humanoid"

def material(name,color,metal=0,rough=.65,pattern=None):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get("Principled BSDF");p.inputs["Base Color"].default_value=(*color,1);p.inputs["Metallic"].default_value=metal;p.inputs["Roughness"].default_value=rough
 if pattern:
  n=512; yy,xx=np.mgrid[0:n,0:n]/n
  if pattern=="mail":
   # Eight alternating interlinked rows; no individual ring meshes.
   u=xx*8;v=yy*8;u+=.5*(np.floor(v)%2)
   dx=(u%1-.5)/.46;dy=(v%1-.5)/.39
   d=np.abs(np.sqrt(dx*dx+dy*dy)-.83);h=np.exp(-(d/.17)**2)
   shade=.22+.78*h
  elif pattern=="trim":
   u=xx*8;v=yy*2;d=np.minimum(abs((u+v)%1-.5),abs((u-v)%1-.5));h=np.exp(-(d/.065)**2);shade=.25+.75*h
  else:
   h=.5+.012*np.sin(xx*math.tau*128)*np.sin(yy*math.tau*128)+.018*np.sin(xx*math.tau*9+np.cos(yy*math.tau*7));shade=.94+.06*h
  rgba=np.ones((n,n,4),dtype=np.float32)
  for c in range(3):rgba[:,:,c]=np.clip(color[c]*shade,0,1)
  im=bpy.data.images.new(name+"_albedo",width=n,height=n);im.pixels.foreach_set(rgba.ravel());im.pack()
  tex=m.node_tree.nodes.new("ShaderNodeTexImage");tex.image=im;
  if pattern!="mail":m.node_tree.links.new(tex.outputs["Color"],p.inputs["Base Color"])
  gy,gx=np.gradient(h);norm=np.stack([-gx*12,-gy*12,np.ones_like(h)],axis=2);norm/=np.linalg.norm(norm,axis=2)[:,:,None];rgba[:,:,:3]=norm*.5+.5
  im=bpy.data.images.new(name+"_normal",width=n,height=n);im.colorspace_settings.name="Non-Color";im.pixels.foreach_set(rgba.ravel());im.pack()
  tex=m.node_tree.nodes.new("ShaderNodeTexImage");tex.image=im;normal=m.node_tree.nodes.new("ShaderNodeNormalMap");m.node_tree.links.new(tex.outputs["Color"],normal.inputs["Color"]);m.node_tree.links.new(normal.outputs["Normal"],p.inputs["Normal"])
 return m
mail=material("Hero_silver_chainmail",(.38,.42,.47),.85,.38,"mail")
red=material("Hero_oxblood_linen",(.19,.028,.038),0,.9,"weave")
blue=material("Hero_navy_trousers",(.035,.065,.12),0,.95,"weave")
linen=material("Hero_flax_wraps",(.64,.56,.40),0,.95,"weave")
leather=material("Hero_brown_leather",(.036,.012,.005),0,.72)
steel=material("Hero_forged_steel",(.38,.42,.47),.85,.38)
gold=material("Hero_aged_brass",(.50,.31,.095),.72,.38)
cloak=material("Hero_blue_violet_cloak",(.045,.026,.18),0,.96,"weave")
stitch=material("Hero_red_cloak_stitch",(.19,.028,.034),0,.94)
trim=material("Hero_woven_gold_border",(.60,.37,.11),.15,.8,"trim")
guard.data.materials.clear();guard.data.materials.append(steel)
shirt.data.materials.clear();shirt.data.materials.append(mail);shirt.data.materials.append(red)
for poly in shirt.data.polygons:
 forearm=0
 for i in poly.vertices:
  for g in shirt.data.vertices[i].groups:
   if shirt.vertex_groups[g.group].name.startswith(("lower_arm_","hand_")):forearm+=g.weight
 poly.material_index=1 if forearm/len(poly.vertices)>.38 else 0
 # A physical metre UV basis keeps chain rings consistent across torso and sleeves.
 for li in poly.loop_indices:
  v=shirt.data.vertices[shirt.data.loops[li].vertex_index].co
  shirt.data.uv_layers.active.data[li].uv=((v.y if abs(poly.normal.x)>.7 else v.x)*10,v.z*10)
boots.data.materials.clear();boots.data.materials.append(leather)

def mesh(name,verts,faces,mat,weights,uv=None):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(mat)
 for p in d.polygons:p.use_smooth=True
 if uv:
  layer=d.uv_layers.new(name="UVMap")
  for p in d.polygons:
   for li in p.loop_indices:layer.data[li].uv=uv[d.loops[li].vertex_index]
 for i,w in enumerate(weights):
  for bone,value in w.items():
   if value>0:
    g=o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone);g.add([i],value,"REPLACE")
 o.parent=rig;m=o.modifiers.new("Hero_skin","ARMATURE");m.object=rig
 return o

def surface(name,fn,weight,mat,nu=64,nv=16,uscale=1,vscale=1):
 verts=[];uv=[];weights=[];faces=[]
 for j in range(nv+1):
  for i in range(nu+1):
   u=i/nu;v=j/nv;p=fn(u,v);verts.append(p);uv.append((u*uscale,v*vscale));weights.append(weight(u,v,p))
 for j in range(nv):
  for i in range(nu):
   a=j*(nu+1)+i;faces.append((a,a+1,a+nu+2,a+nu+1))
 return mesh(name,verts,faces,mat,weights,uv)
def rigid(b):return lambda u,v,p:{b:1}
# Sleeves and trousers use the rest joint positions, with continuous weights over each joint.
def joint(n):return rig.data.bones[n].head_local.copy()
def limb(name,a,b,r0,r1,mat,bone0,bone1=None,nu=32,nv=14,cap=False):
 axis=(b-a).normalized();x=axis.cross(Vector((0,1,0))).normalized();y=axis.cross(x).normalized()
 def fn(u,v):
  ang=u*math.tau;r=(r0*(1-v)+r1*v)*(1+.038*math.sin(v*math.pi*10+ang*3)*math.sin(v*math.pi));r*=min(1,.04+v*5) if cap else 1;p=a.lerp(b,v)+r*(math.cos(ang)*x+math.sin(ang)*y);return p
 def w(u,v,p):
  t=max(0,(v-.72)/.28)*.4 if bone1 else 0;return {bone0:1-t,**({bone1:t} if bone1 else {})}
 return surface(name,fn,w,mat,nu,nv,5,5)
continuous_legs=[]
for side in ["l","r"]:
 shoulder,elbow,wrist=[joint(n+side) for n in ["upper_arm_","lower_arm_","hand_"]]
 limb("Hero_embroidered_cuff",elbow.lerp(wrist,.82),wrist,.065,.060,trim,"lower_arm_"+side)
 hip,knee,ankle=[joint(n+side) for n in ["upper_leg_","lower_leg_","foot_"]]
 # One continuous leg surface crosses the knee and ankle. Shared ring vertices
 # and identical weights prevent cracks when adjacent limb bones bend.
 def leg_point(u,v):
  t=v*2
  center=hip.lerp(knee,t) if t<=1 else knee.lerp(ankle,t-1)
  axis=(knee-hip).lerp(ankle-knee,max(0,min(1,(v-.35)/.3))).normalized()
  xx=axis.cross(Vector((0,1,0))).normalized();yy=axis.cross(xx).normalized()
  radius=float(np.interp(v,[0,.30,.48,.55,.7,.92,1],[.119,.125,.105,.101,.098,.073,.065]))
  radius*=1+.027*math.sin(v*math.pi*18+u*math.tau*3)*math.sin(v*math.pi)
  return center+radius*(math.cos(u*math.tau)*xx+math.sin(u*math.tau)*yy)
 def leg_weight(u,v,p):
  lower=max(0,min(1,(v-.32)/.35));foot=max(0,min(1,(v-.83)/.17))
  return {"upper_leg_"+side:1-lower,"lower_leg_"+side:lower*(1-foot),"foot_"+side:lower*foot}
 leg=surface("Hero_continuous_trouser_wrap_boot_"+side,leg_point,leg_weight,blue,48,56,5,9)
 continuous_legs.append(leg)
 leg.data.materials.append(linen);leg.data.materials.append(leather)
 for poly in leg.data.polygons:
  v=sum(leg.data.vertices[i].co.z for i in poly.vertices)/len(poly.vertices)
  ring=poly.index//48
  poly.material_index=2 if ring>=47 else 1 if ring>=31 else 0
 # Cloth strips follow the same surface and weights as the calf underneath.
 for direction in [-1,1]:
  def wrap(u,v,direction=direction):
   t=.54+v*.29;angle=(direction*v*2.5+u*.025)%1
   p=leg_point(angle,t);center=knee.lerp(ankle,(t-.5)*2)
   return center+(p-center)*1.04
  surface("Hero_crossed_leather_bindings",wrap,lambda u,v,p:leg_weight(u,.54+v*.29,p),leather,3,72,1,5)
# The split hem envelopes each actual thigh, using the same centreline and
 # deformation weights as the trousers. Its upper strip alone blends to hips;
 # keeping 22% hip weight at the bottom made the old hem lag through bent thighs.
 sign=1 if side=="l" else -1
 for back in [-1,1]:
  def panel(u,v,back=back):
   a=.028+u*(math.pi-.056)
   t=.37*v
   center=hip.lerp(knee,t*2)
   axis=(knee-hip).normalized();xx=axis.cross(Vector((0,1,0))).normalized();yy=axis.cross(xx).normalized()
   # Each front/back half wraps its own leg with 30 mm of rest clearance.
   radius=float(np.interp(t,[0,.30,.48],[.119,.125,.105]))+.032
   lower=center+radius*(math.cos(a)*xx-back*math.sin(a)*yy)
   lower.z+=.012*math.sin(a*3)*v
   top_x=sign*.126+.122*math.cos(a)
   top=Vector((top_x,.035+back*.208*math.sqrt(max(.04,1-(top_x/.252)**2)),1.14))
   blend=min(1,v/.30);blend=blend*blend*(3-2*blend)
   return top.lerp(lower,blend)
  def panel_weight(u,v,p):
   t=.37*v;leg_weights=leg_weight(u,t,p)
   follow=min(1,v/.30);follow=follow*follow*(3-2*follow)
   return {"hips":1-follow,**{n:w*follow for n,w in leg_weights.items()}}
  surface("Hero_thigh_clearance_mail_panel_"+side,panel,panel_weight,mail,32,24,4,6)
  for name,material_,start,end,offset in [("Hero_red_skirt_border",red,.94,1.025,.003),("Hero_skirt_braid",trim,1.005,1.035,.005)]:
   def border(u,v,start=start,end=end,offset=offset):
    q=panel(u,start+(end-start)*v);q.y+=back*offset;return q
   surface(name,border,lambda u,v,p,start=start,end=end:panel_weight(u,start+(end-start)*v,p),material_,32,3,4,1)
# Fuse the original boot shape and continuous calf into a single surface. Transfer
# source material/UV and weights back after remeshing; use one ankle weight field
# on BOTH the foot and shaft so flexion cannot tear their join apart.
join_parts=[boots,*continuous_legs]
# The source boot opening is medial to the foot pivot. Fit the leather to the
# actual opening, not the animation bone centre (which made the outer ankle bulge).
boot_centers={}
for side in ["l","r"]:
 ps=[v.co for v in boots.data.vertices if (.12<v.co.z<.21) and ((v.co.x>0)==(side=="l"))]
 boot_centers[side]=Vector(((min(p.x for p in ps)+max(p.x for p in ps))/2,(min(p.y for p in ps)+max(p.y for p in ps))/2,0))
source_vertices=[];source_faces=[];source_materials=[];source_weights=[];palette=[]
for o in join_parts:
 offset=len(source_vertices);source_vertices.extend(v.co.copy() for v in o.data.vertices)
 for v in o.data.vertices:source_weights.append({o.vertex_groups[g.group].name:g.weight for g in v.groups})
 for face in o.data.polygons:
  source_faces.append(tuple(offset+i for i in face.vertices))
  mat=o.data.materials[face.material_index]
  if mat not in palette:palette.append(mat)
  source_materials.append(palette.index(mat))
source_bvh=BVHTree.FromPolygons(source_vertices,source_faces)
bpy.ops.object.select_all(action="DESELECT")
for o in join_parts:
 # Close source cross-sections before the volume union. A solidified hollow
 # tube leaves internal ankle walls that fold out as rectangular creases.
 bm=bmesh.new();bm.from_mesh(o.data)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
 boundary=[e for e in bm.edges if e.is_boundary]
 if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 o.select_set(True)
bpy.context.view_layer.objects.active=boots;bpy.ops.object.join();boots.name="Hero_welded_legs_and_boots"
union=boots.modifiers.new("Continuous_boot_ankle_union","REMESH");union.mode="VOXEL";union.voxel_size=.0035;union.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=union.name)
smooth=boots.modifiers.new("Smooth_boot_shaft_junction","SMOOTH");smooth.factor=.3;smooth.iterations=2;bpy.ops.object.modifier_apply(modifier=smooth.name)
# Sculpt one tapered ankle envelope, eliminating the original shoe's narrow
# neck beneath the larger authored shaft. Preserve the toe/heel below 70 mm.
for v in boots.data.vertices:
 z=v.co.z
 if .07<z<.33:
  side="l" if v.co.x>0 else "r"
  knee,ankle=joint("lower_leg_"+side),joint("foot_"+side)
  center=ankle.lerp(knee,(z-ankle.z)/(knee.z-ankle.z));center.z=z
  delta=v.co-center
  angle=math.atan2(delta.y,delta.x)
  rx=float(np.interp(z,[.07,.12,.20,.33],[.066,.061,.066,.087]))
  ry=float(np.interp(z,[.07,.12,.20,.33],[.085,.073,.074,.087]))
  opening=boot_centers[side].copy();opening.z=z
  fit=max(0,min(1,(.33-z)/.18));fit=fit*fit*(3-2*fit)
  center=center.lerp(opening,fit)
  envelope=center+Vector((rx*math.cos(angle),ry*math.sin(angle),0))
  mask=min(1,(z-.07)/.055,(.33-z)/.09);mask=max(0,mask);mask=mask*mask*(3-2*mask)
  v.co=v.co.lerp(envelope,.90*mask)
# Round the former cylinder rim over a broad ankle band rather than keeping
# a flat cut-off above the original shoe. A local mask preserves toes and soles.
rounding=boots.vertex_groups.new(name="authoring_ankle_rounding")
for v in boots.data.vertices:
 z=v.co.z
 weight=max(0,1-abs(z-.155)/.13)
 weight=weight*weight*(3-2*weight)
 if weight>0:rounding.add([v.index],weight,"REPLACE")
ankle_smooth=boots.modifiers.new("Continuous_leather_ankle_transition","SMOOTH");ankle_smooth.vertex_group=rounding.name;ankle_smooth.factor=.8;ankle_smooth.iterations=90;bpy.ops.object.modifier_apply(modifier=ankle_smooth.name)
count=sum(len(p.vertices)-2 for p in boots.data.polygons)
reduce=boots.modifiers.new("Leg_boot_authoring_budget","DECIMATE");reduce.ratio=min(1,20000/count);bpy.ops.object.modifier_apply(modifier=reduce.name)
boots.vertex_groups.clear();boots.data.materials.clear()
for mat in palette:boots.data.materials.append(mat)
for v in boots.data.vertices:
 nearest=source_bvh.find_nearest(v.co);face=source_faces[nearest[2]]
 idx=min(face,key=lambda i:(source_vertices[i]-v.co).length_squared)
 weights=source_weights[idx]
 if v.co.z<.36:
  side="l" if v.co.x>0 else "r"
  foot=max(0,min(1,(.30-v.co.z)/.18));foot=foot*foot*(3-2*foot)
  weights={"lower_leg_"+side:1-foot,"foot_"+side:foot}
 for name,value in weights.items():
  if value>0:
   group=boots.vertex_groups.get(name) or boots.vertex_groups.new(name=name);group.add([v.index],value,"REPLACE")
uv=boots.data.uv_layers.new(name="UVMap")
for poly in boots.data.polygons:
 poly.material_index=source_materials[source_bvh.find_nearest(poly.center)[2]];poly.use_smooth=True
 for li in poly.loop_indices:
  q=boots.data.vertices[boots.data.loops[li].vertex_index].co;uv.data[li].uv=(q.x*10,q.z*10)

# Belt and suspended leather strap.
surface("Hero_waist_belt",lambda u,v:(.248*math.cos(u*math.tau),.045+.178*math.sin(u*math.tau),1.11+v*.060),rigid("hips"),leather,72,3,5,1)
surface("Hero_belt_tail",lambda u,v:(-.034+u*.056,-.148-.066*v,1.14-v*.36),rigid("hips"),leather,4,24,1,3)
# Tube strips for helmet bands and belt hardware. Low-cost solids.
def tube(name,points,radius,mat,bone="head",sides=8,weights=None):
 verts=[];uv=[];ww=[];faces=[]
 for j,p in enumerate(points):
  p=Vector(p);t=(Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])).normalized();ref=Vector((0,1,0)) if abs(t.y)<.95 else Vector((1,0,0));x=t.cross(ref).normalized();y=t.cross(x).normalized()
  r=float(radius if isinstance(radius,(int,float)) else radius[j])
  for i in range(sides):
   ang=i/sides*math.tau;verts.append(p+r*(x*math.cos(ang)+y*math.sin(ang)));uv.append((i/sides,j/max(1,len(points)-1)));ww.append(weights(j,p) if weights else {bone:1})
 for j in range(len(points)-1):
  for i in range(sides):
   a=j*sides+i;b=j*sides+(i+1)%sides;faces.append((a,b,b+sides,a+sides))
 return mesh(name,verts,faces,mat,ww,uv)
for i in range(16):
 a=i/16*math.tau;p=Vector((.251*math.cos(a),.045+.18*math.sin(a),1.14));tube("Hero_belt_stud",[p,p+Vector((0,0,.009))],.009,gold,"hips",6)
tube("Hero_belt_buckle",[(-.055,-.14,1.12),(.025,-.14,1.12),(.025,-.14,1.168),(-.055,-.14,1.168),(-.055,-.14,1.12)],.008,gold,"hips")
# Fresh conical helmet, brow band, eye openings and nasal guard.
cz=source_crown*S;hy=.013*S
scalp=material("Hero_anatomical_scalp",(.49,.30,.21),0,.84)
surface("Hero_anatomical_scalp",lambda u,v:(.080*math.cos(u*math.tau)*math.cos(v*math.pi/2),hy+.080*math.sin(u*math.tau)*math.cos(v*math.pi/2),cz-.105+.105*math.sin(v*math.pi/2)),rigid("head"),scalp,48,16,1,1)
# Fit the shell to measured head cross sections, with only 5 mm padding.
head_bvh=BVHTree.FromPolygons([v.co for v in head.data.vertices],[list(p.vertices) for p in head.data.polygons])
head_center=Vector((-.0045*S,.013*S,0))
def head_radius(a,z):
 origin=Vector((head_center.x,head_center.y,z));direction=Vector((math.cos(a),math.sin(a),0))
 hit,_,_,distance=head_bvh.ray_cast(origin+direction*.35,-direction,.35)
 if hit is not None and .35-distance>.025:return .35-distance
 # Sparse/open scalp sections use the nearest actual skin section, never a
 # guessed global head size; the apex itself is closed by the authored scalp.
 candidates=[v.co for v in head.data.vertices if abs(v.co.z-z)<.025 and abs(math.atan2(math.sin(math.atan2(v.co.y-head_center.y,v.co.x-head_center.x)-a),math.cos(math.atan2(v.co.y-head_center.y,v.co.x-head_center.x)-a)))<.22]
 return max(((p-origin).length for p in candidates),default=.085)
def helmet_point(u,v):
 a=u*math.tau;base=head_radius(a,cz-.108)+.005
 z=cz-.108+v*.168
 r=base*(1-v**2.15)
 if z<cz-.01:r=max(r,head_radius(a,z)+.004)
 return (head_center.x+r*math.cos(a),head_center.y+r*math.sin(a),z)
surface("Hero_head_fitted_conical_helmet",helmet_point,rigid("head"),steel,96,28,3,2)
tube("Hero_fitted_helmet_brow",[helmet_point(u,0) for u in np.linspace(0,1,97)],.004,steel)
for u in [0,.25,.5,.75]:
 tube("Hero_helmet_meridian",[helmet_point(u,v) for v in np.linspace(0,1,30)],.003,steel)
# Blend the fitted source mask into the new shell across the forehead. The
# transition joins the upper mask ridge to the cap before a solid metal union.
guard_points=[v.co.copy() for v in guard.data.vertices if v.co.y<-.025]
def integrated_brow(u,v):
 top=Vector(helmet_point(.5+u*.5,.075))
 nearby=sorted(guard_points,key=lambda p:abs(p.x-top.x))[:35]
 bottom=max(nearby,key=lambda p:p.z).copy()
 # Follow the shared x section to avoid a ragged outline from UV-split vertices.
 bottom.x=top.x
 p=bottom.lerp(top,v);p.y-=.002*math.sin(v*math.pi)
 return p
surface('Hero_integrated_mask_brow',integrated_brow,rigid('head'),steel,64,12,2,1)
# Smooth shoulder shawl: a draped collar with a diagonal front hem and open arms.
# Its weights are sampled from the continuous shoulder surface, not rigid chest-only.
cloth_kd=KDTree(len(shirt.data.vertices))
for v in shirt.data.vertices:cloth_kd.insert(v.co,v.index)
cloth_kd.balance()
def shawl_point(u,v):
 a=u*math.tau;front=max(0,-math.sin(a))
 x=(.13+v*.24)*math.cos(a)
 y=.045+(.105+v*.12)*math.sin(a)
 z=1.76-v*(.09+.16*front)+.04*x*v+.008*math.sin(v*math.pi*5+u*math.tau*2)*math.sin(v*math.pi)
 return (x,y,z)
def shawl_weight(u,v,p):
 _,index,_=cloth_kd.find(p);vertex=shirt.data.vertices[index]
 return {shirt.vertex_groups[g.group].name:g.weight for g in vertex.groups}
surface("Hero_draped_shoulder_shawl",shawl_point,shawl_weight,cloak,96,22,3,2)
tube("Hero_shawl_red_edge",[shawl_point(u,1) for u in np.linspace(0,1,97)],.003,stitch,sides=6,weights=lambda j,p:shawl_weight(j/96,1,p))
# The back cape shares the shawl's entire rear perimeter and skin weights.
# Its top row is welded at export; gravity-oriented bones bend the lower fabric.
def cape_point(u,v):
 top=Vector(shawl_point(u*.5,1));x=top.x*(1+.08*v)
 y=top.y+(.285-top.y)*(1-math.exp(-v*9))+.018*math.sin(u*math.pi*14)*math.sin(v*math.pi)
 return (x,y,top.z-.91*v+.012*math.cos(u*math.pi*4)*v)
def cape_weight(u,v,p):
 if v<.24:
  mix=v/.24;result={name:w*(1-mix) for name,w in shawl_weight(u*.5,1,shawl_point(u*.5,1)).items()};result['cape_upper']=mix;return result
 t=(v-.24)/.76*2;idx=min(1,int(t));f=t-idx;names=['cape_upper','cape_mid','cape_lower']
 return {names[idx]:1-f,names[idx+1]:f}
surface('Hero_continuous_back_cloak',cape_point,cape_weight,cloak,48,40,3,4)
for edge in [0,1]:
 tube('Hero_cloak_red_edge',[cape_point(edge,v) for v in np.linspace(0,1,40)],.003,stitch,weights=lambda j,p,edge=edge:cape_weight(edge,j/39,p))
tube('Hero_cloak_red_hem',[cape_point(u,1) for u in np.linspace(0,1,49)],.004,stitch,weights=lambda j,p:cape_weight(j/48,1,p))
# Brooch anchored to the upper chest rather than an arm.
brooch=Vector(shawl_point(.86,.66));brooch.y-=.007
brooch_weights=shawl_weight(.86,.66,brooch)
tube("Hero_cloak_ring_brooch",[brooch+Vector((.023*math.cos(a),0,.023*math.sin(a))) for a in np.linspace(0,math.tau,32)],.004,gold,weights=lambda j,p:brooch_weights)
# Mail coif open at the face, flared at the shoulder.
def fitted_aventail(u,v):
 a=(.34+u*1.32)*math.pi-math.pi/2
 z=cz-.11-v*.25
 r=head_radius(a,z)+.004
 return (head_center.x+r*math.cos(a),head_center.y+r*math.sin(a),z)
coif_kd=KDTree(len(head.data.vertices))
for vertex in head.data.vertices:coif_kd.insert(vertex.co,vertex.index)
coif_kd.balance()
def coif_weights(u,v,p):
 _,index,_=coif_kd.find(p)
 return {head.vertex_groups[g.group].name:g.weight for g in head.data.vertices[index].groups}
surface("Hero_head_fitted_mail_aventail",fitted_aventail,coif_weights,mail,72,26,5,4)

shoulder_z=joint("upper_arm_l").z
shoulder_points=[v.co for v in shirt.data.vertices if abs(v.co.z-shoulder_z)<.025]
shoulder_width=max(p.x for p in shoulder_points)-min(p.x for p in shoulder_points)
# Join generated parts by material; retain skin groups and seams, reduce runtime draw calls.
for mat in [mail,red,blue,linen,leather,steel,gold,trim,cloak,stitch]:
 obs=[o for o in bpy.data.objects if o.type=="MESH" and o.data.materials and o.data.materials[0]==mat]
 bpy.ops.object.select_all(action="DESELECT")
 for o in obs:o.select_set(True)
 if obs:
  bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();obs[0].name=mat.name
  if mat==cloak:
   bm=bmesh.new();bm.from_mesh(obs[0].data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0002);bm.to_mesh(obs[0].data);bm.free()
  if mat==steel:
   # A single watertight metal shell, including brow, spectacle and nasal guard.
   metal=obs[0]
   solid=metal.modifiers.new('Integrated_helmet_thickness','SOLIDIFY');solid.thickness=.003;solid.offset=0;bpy.ops.object.modifier_apply(modifier=solid.name)
   union=metal.modifiers.new('Integrated_helmet_surface','REMESH');union.mode='VOXEL';union.voxel_size=.0018;union.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=union.name)
   smooth=metal.modifiers.new('Smooth_forehead_junction','SMOOTH');smooth.factor=.5;smooth.iterations=3;bpy.ops.object.modifier_apply(modifier=smooth.name)
   count=sum(len(p.vertices)-2 for p in metal.data.polygons)
   reduce=metal.modifiers.new('Helmet_authoring_budget','DECIMATE');reduce.ratio=min(1,9000/count);bpy.ops.object.modifier_apply(modifier=reduce.name)
   metal.vertex_groups.clear();group=metal.vertex_groups.new(name='head');group.add(list(range(len(metal.data.vertices))),1,'REPLACE')
   uv=metal.data.uv_layers.new(name='UVMap')
   for poly in metal.data.polygons:
    poly.use_smooth=True
    for li in poly.loop_indices:
     p=metal.data.vertices[metal.data.loops[li].vertex_index].co;uv.data[li].uv=(math.atan2(p.y-hy,p.x)/math.tau,p.z*3)

meshes=[o for o in bpy.data.objects if o.type=="MESH"]
# Ground the actual export, and put sole landmarks at the measured boot underside.
floor=min(v.co.z for o in meshes for v in o.data.vertices)
for o in meshes:
 for v in o.data.vertices:v.co.z-=floor
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode="EDIT")
for b in rig.data.edit_bones:
 b.head.z-=floor;b.tail.z-=floor
 if b.name.startswith("sole_"):
  dz=-b.head.z;b.head.z+=dz;b.tail.z+=dz
bpy.ops.object.mode_set(mode="OBJECT");rig.select_set(False)
cz-=floor
# Mesh-derived stature, independent scalp and outsole planes. No helmet-inclusive substitution.
points=[v.co for o in meshes for v in o.data.vertices]
metrics={"heightM":round(cz-(.03*S-floor),6),"uniformScaleAppliedInBlender":S,"barefootPlaneY":.03*S-floor,"scalpCrownY":max(v.co.z for o in meshes if o.name=="Hero_anatomical_scalp" for v in o.data.vertices),"outsoleY":min(p.z for p in points),"overallHeightM":max(p.z for p in points)-min(p.z for p in points),"shoulderJointSpanM":(joint("upper_arm_l")-joint("upper_arm_r")).length,"shoulderWidthM":shoulder_width,"neckLengthM":abs(joint("head").z-joint("neck").z),"kneeHeightM":joint("lower_leg_l").z,"runtimeScale":[1,1,1],"measurementMethod":"authored closed scalp apex minus anatomical barefoot plane; source face retained below forehead; overall all exported mesh vertices; shirt surface horizontal section within 25 mm of shoulder joint height in rest pose; anatomical sole plane excludes the measured outsole-to-anatomical-sole offset"}
# Save editable source only into ignored authoring output; script is the versioned source.
(ROOT/"output/hero").mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"output/hero/hero-source.blend"))
originals={o.name:o.data.copy() for o in meshes}
triangles={};texturemax={}
for lod,budget,texsize in [(0,58000,2048),(1,19500,1024),(2,5900,512)]:
 for o in meshes:o.data=originals[o.name].copy()
 total=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
 ratio=min(1,budget/total)
 for o in meshes:
  if ratio<1:
   bpy.context.view_layer.objects.active=o;mod=o.modifiers.new("LOD_surface_reduction","DECIMATE");mod.ratio=ratio;bpy.ops.object.modifier_apply(modifier=mod.name)
 for im in bpy.data.images:
  if im.size[0]>texsize:im.scale(texsize,texsize);im.pack()
 triangles[f"lod{lod}"]=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
 texturemax[f"lod{lod}"]=max(im.size[0] for im in bpy.data.images if im.size[0])
 bpy.ops.object.select_all(action="DESELECT");rig.select_set(True)
 for o in meshes:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/f"lod{lod}.glb"),export_format="GLB",use_selection=True,export_animations=False,export_yup=True,export_skins=True,export_all_influences=False,export_extras=True)
metrics["triangles"]=triangles;metrics["textures"]=texturemax
(OUT/"blender-measurements.json").write_text(json.dumps(metrics,indent=2)+"\n")
print("HERO_MEASUREMENTS",json.dumps(metrics))
