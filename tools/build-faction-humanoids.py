#!/usr/bin/env python3
"""Fit the three audited Meshy A-pose sources to the shared humanoid contract.

blender -b --python-exit-code 1 --python tools/build-faction-humanoids.py -- SOURCE_ROOT [OUTPUT_ROOT]
Source GLBs stay immutable/outside public. Geometry, UVs and materials originate
only from the hash-guarded input. Bake clips afterward with retarget-faction-humanoids.mjs.
For the reviewed Nordic right hand, apply repair-nordic-right-hand.mjs after
clip baking into a distinct checkpoint, then pack lossless textures/buffers.
verify-faction-publication.mjs compares that corrected checkpoint with publication;
right-hand-repair-audit.json separately records the intentional bind/weight delta.
"""
import bpy,bmesh,json,hashlib,math,sys,struct,io,heapq
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform,tessellate_polygon
import numpy as np
ROOT=Path.cwd();args=sys.argv[sys.argv.index('--')+1:];SOURCES=Path(args[0]);OUT=Path(args[1])if len(args)>1 else ROOT/'output/faction-humanoids/staged';OUT.mkdir(parents=True,exist_ok=True)
CONFIG={
 'viking-civilian':dict(stem='Nordic_Warrior_1016085035',sha='d793d2a8aa196d928bd2188ff66502a02eca2328d6024528a856c6787362172d',title='Nordic Warrior',height=1.78,bodyY=.015,hips=.94,shoulder=[.205,.005,1.415],elbow=[.312,-.048,1.176],wrist=[.400,-.172,.984],palm=[.424,-.199,.914],head=[0,-.012,1.59],neck=[0,0,1.50],legX=.145,knee=.49,ankle=[.166,.03,.115],cape=True,capeY=.165,capeBottom=.47,hem=.65,liningInset=dict(maxM=.045,rearPlaneM=.075,halfWidthM=.16,lateralFadeM=.06,lowerStartM=.66,lowerFadeM=.10,upperStartM=1.26,upperFadeM=.12)),
 'roman-civilian':dict(stem='Roman_Statesman_Pose_1016083929',sha='95ac717b6dde8aa07906b080aefe1a5d6bdffcc7b50b7d5152d2909c195e4274',title='Roman Statesman',height=1.78,bodyY=.06,hips=.95,shoulder=[.184,.05,1.415],elbow=[.286,.045,1.167],wrist=[.380,-.013,.952],palm=[.407,-.043,.875],head=[0,.04,1.60],neck=[0,.045,1.51],legX=.125,knee=.49,ankle=[.137,.065,.105],cape=False,capeY=.19,capeBottom=.47,hem=.49),
 'maki-archer-t4':dict(stem='Shadow_Warden_1016080354',sha='2a7a27018d759fe5130a132a791b1752a9009fba0ee4e3adfbb825210b291789',title='Shadow Warden',height=1.90,bodyY=-.01,hips=1.0,shoulder=[.209,-.02,1.493],elbow=[.307,-.10,1.25],wrist=[.361,-.224,1.022],palm=[.357,-.248,.946],head=[0,-.04,1.67],neck=[0,-.03,1.58],legX=.14,knee=.53,ankle=[.158,.005,.12],cape=True,capeY=.17,capeBottom=.16,hem=.64),
}
def arr(v):return [float(c)for c in v]
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def mix(a,b,t):
 t=max(0,min(1,t));out={k:v*(1-t)for k,v in a.items()}
 for k,v in b.items():out[k]=out.get(k,0)+v*t
 return out
def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def segment(p,a,b):
 d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared));return (p-a-d*t).length,t

def topology_audit(mesh):
 # Analysis weld only. Never destroy LOD0 UV/render topology.
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
 bm.verts.ensure_lookup_table();bm.verts.index_update();rem=set(bm.verts);parts=[]
 while rem:
  queue=[rem.pop()];vs=[]
  while queue:
   v=queue.pop();vs.append(v)
   for e in v.link_edges:
    n=e.other_vert(v)
    if n in rem:rem.remove(n);queue.append(n)
  parts.append({'vertices':len(vs),'bounds':[[min(v.co[k]for v in vs)for k in range(3)],[max(v.co[k]for v in vs)for k in range(3)]]})
 boundary=[e for e in bm.edges if e.is_boundary];result={'weldedVertices':len(bm.verts),'components':sorted(parts,key=lambda p:-p['vertices']),'boundaryEdges':len(boundary)};bm.free();return result

for id,c in CONFIG.items():
 if len(args)>2 and id not in args[2].split(','):continue
 src=SOURCES/f"Meshy_AI_{c['stem']}_texture.glb";raw=src.read_bytes();sha=hashlib.sha256(raw).hexdigest()
 if sha!=c['sha']:raise ValueError(f'{id}: source hash changed; remeasure source before rebuilding')
 profile_path=ROOT/'tools/data/faction-humanoid-run-profiles'/f'{id}.json'
 run_profile=json.loads(profile_path.read_text())if profile_path.exists()else None
 if run_profile and run_profile['sourceSha256']!=sha:raise ValueError('Run clearance profile original source mismatch')
 d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
 if d.get('skins')or d.get('animations'):raise ValueError('Expected audited static source')
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(src))
 meshes=[o for o in bpy.data.objects if o.type=='MESH']
 if len(meshes)!=1:raise ValueError('Source mesh inventory changed')
 mesh=meshes[0];points=[mesh.matrix_world@v.co for v in mesh.data.vertices];lo=min(p.z for p in points);hi=max(p.z for p in points);S=c['height']/(hi-lo)
 normalized=Matrix.Scale(S,4)@Matrix.Translation((0,0,-lo))@mesh.matrix_world
 mesh.parent=None;mesh.matrix_world=Matrix.Identity(4);mesh.data.transform(normalized);mesh.name='FactionHumanoid_Surface';mesh.data.name='SourceMeshySurface'
 for o in list(bpy.data.objects):
  if o!=mesh:bpy.data.objects.remove(o,do_unlink=True)
 out=OUT/id;out.mkdir(parents=True,exist_ok=True)
 source_count=sum(len(f.vertices)-2 for f in mesh.data.polygons);source_vertex_count=len(mesh.data.vertices);audit=topology_audit(mesh.data)
 geometry_hash=hashlib.sha256(np.asarray([tuple(v.co)for v in mesh.data.vertices],dtype='<f4').tobytes()+np.asarray([list(f.vertices)for f in mesh.data.polygons],dtype='<u4').tobytes()).hexdigest()
 mask_path=ROOT/'tools/data/faction-humanoid-surface-masks'/f'{id}.json';reviewed_mask=json.loads(mask_path.read_text())if mask_path.exists()else None
 if reviewed_mask and (reviewed_mask['sourceSha256']!=sha or reviewed_mask['normalizedGeometrySha256']!=geometry_hash):raise ValueError('Reviewed surface mask does not match exact source geometry')
 source_images=[{'name':im.name,'width':im.size[0],'height':im.size[1]}for im in bpy.data.images if im.type=='IMAGE']
 # All landmarks are in the inspected source's normalized Blender coordinates.
 # The same algorithm fits all three, but no vertex IDs or old cape regions are reused.
 H=c['hips'];Y=c['bodyY'];shoulderZ=c['shoulder'][2]
 land={'root':Vector((0,0,0)),'hips':Vector((0,Y,H)),'spine':Vector((0,Y,H+.14)),'chest':Vector((0,Y,H+.29)),'upper_chest':Vector((0,Y,shoulderZ-.025)),'neck':Vector(c['neck']),'head':Vector(c['head'])}
 parents={'hips':'root','spine':'hips','chest':'spine','upper_chest':'chest','neck':'upper_chest','head':'neck'};tails={'head':Vector((c['head'][0],c['head'][1],c['height']-.04)),'root':Vector((0,0,.08))}
 nexts={'hips':'spine','spine':'chest','chest':'upper_chest','upper_chest':'neck','neck':'head'}
 for side,s in [('l',1),('r',-1)]:
  for n,p in [('clavicle',[.04,Y,shoulderZ-.015]),('upper_arm',c['shoulder']),('lower_arm',c['elbow']),('hand',c['wrist']),('upper_leg',[c['legX']*.72,Y,H]),('lower_leg',[c['legX'],Y-.012,c['knee']]),('foot',c['ankle']),('toe',[c['ankle'][0],c['ankle'][1]-.12,.045])]:
   land[n+'_'+side]=Vector((p[0]*s,p[1],p[2]))
  for n,p in [('clavicle','upper_chest'),('upper_arm','clavicle_'+side),('lower_arm','upper_arm_'+side),('hand','lower_arm_'+side),('upper_leg','hips'),('lower_leg','upper_leg_'+side),('foot','lower_leg_'+side),('toe','foot_'+side)]:parents[n+'_'+side]=p
  for n,nxt in [('clavicle','upper_arm'),('upper_arm','lower_arm'),('lower_arm','hand'),('upper_leg','lower_leg'),('lower_leg','foot'),('foot','toe')]:nexts[n+'_'+side]=nxt+'_'+side
  palm=Vector((c['palm'][0]*s,c['palm'][1],c['palm'][2]));tails['hand_'+side]=palm;tails['toe_'+side]=land['toe_'+side]+Vector((0,-.07,0))
 armature=bpy.data.armatures.new('project_humanoid_v1');rig=bpy.data.objects.new('project_humanoid',armature);bpy.context.collection.objects.link(rig);activate(rig);bpy.ops.object.mode_set(mode='EDIT')
 for name,p in land.items():
  b=armature.edit_bones.new(name);b.head=p;b.tail=land[nexts[name]]if name in nexts else tails.get(name,p+Vector((0,0,.08)))
  # Midline +X must match the procedural canonical death/lean convention.
  # Descending limb axes already face +X and retain their fitted roll.
  b.align_roll(Vector((0,-1 if name in ['root','hips','spine','chest','upper_chest','neck','head'] else 1,0)))
  if name in parents:b.parent=armature.edit_bones[parents[name]]
  b.use_connect=False
 # Fingers follow the measured palm plane, with individual phalange chains.
 finger_segments={};hand_frames={}
 for side,s in [('l',1),('r',-1)]:
  wrist=land['hand_'+side];palm=tails['hand_'+side];along=(palm-wrist).normalized()
  normal=Vector((-s,0,0));normal-=along*normal.dot(along);normal.normalize()
  thumb=normal.cross(along).normalized()*s
  if thumb.y>0:thumb=-thumb
  # Palm-facing normal derives from the inspected inward-facing hand, not a wrist turn.
  palm_length=(palm-wrist).length;finger_base=wrist+along*palm_length*.70
  hand_frames[side]={'along':along,'normal':normal,'thumb':thumb,'center':wrist+along*palm_length*.53,'fingerBase':palm_length*.7,'thumbBase':wrist+along*palm_length*.30+thumb*.023}
  for fi,name in enumerate(['index','middle','ring','pinky']):
   across=[.023,.007,-.009,-.024][fi];start=finger_base+thumb*across;length=[.068,.078,.071,.056][fi]
   end=start+along*length+normal*.007
   for j in range(3):
    bn=f'{name}_{j+1:02d}_{side}';b=armature.edit_bones.new(bn);a=start.lerp(end,[0,.45,.76][j]);z=start.lerp(end,[.45,.76,1][j]);b.head=a;b.tail=z;b.align_roll(normal);b.parent=armature.edit_bones['hand_'+side if j==0 else f'{name}_{j:02d}_{side}'];finger_segments[bn]=(a.copy(),z.copy())
  start=hand_frames[side]['thumbBase'];end=start+along*.034+thumb*.027+normal*.010
  for j in range(3):
   bn=f'thumb_{j+1:02d}_{side}';b=armature.edit_bones.new(bn);a=start.lerp(end,j/3);z=start.lerp(end,(j+1)/3);b.head=a;b.tail=z;b.align_roll(normal);b.parent=armature.edit_bones['hand_'+side if j==0 else f'thumb_{j:02d}_{side}'];finger_segments[bn]=(a.copy(),z.copy())
 # Small helper set follows existing cape/skirt methods without cloth simulation.
 cape=[]
 if c['cape']:
  levels=[shoulderZ-.04,H+.18,(H+c['capeBottom'])/2,c['capeBottom']];parent='chest'
  for i,name in enumerate(['cape_upper','cape_mid','cape_lower']):
   b=armature.edit_bones.new(name);b.head=(0,c['capeY'],levels[i]);b.tail=(0,c['capeY']+.02,levels[i+1]);b.parent=armature.edit_bones[parent];b.align_roll(Vector((0,1,0)));parent=name
   cape.append({'name':name,'follow':[.55,.3,0][i],'mountedPitch':[.35,.7,.95][i]})
 skirt=[]
 for side in ['l','r']:
  for panel,follow in [('front',.9),('back',.7)]:
   name=f'skirt_{panel}_{side}';base=armature.edit_bones['upper_leg_'+side];b=armature.edit_bones.new(name);b.head=base.head;b.tail=base.tail;b.roll=base.roll;b.parent=armature.edit_bones['hips'];skirt.append({'name':name,'thigh':'upper_leg_'+side,'follow':follow})
 b=armature.edit_bones.new('skirt_front_center');b.head=(0,Y-.1,H);b.tail=(0,Y-.12,c['hem']);b.parent=armature.edit_bones['hips'];b.align_roll(Vector((0,1,0)))
 sockets={'socket_hand_l':'hand_l','socket_hand_r':'hand_r','socket_back':'chest','socket_head':'head','socket_pelvis':'hips','socket_foot_l':'foot_l','socket_foot_r':'foot_r','sole_l':'foot_l','sole_r':'foot_r','bow_string_contact':'hand_r','bow_arrow_rest':'hand_l'}
 for name,parent in sockets.items():
  b=armature.edit_bones.new(name);p=armature.edit_bones[parent].head.copy()
  if name.startswith('sole_'):p.z=0
  if name=='socket_back':p.y+=.12
  if name=='socket_head':p.z+=.12
  if name.startswith('bow_'):p=hand_frames['r'if name=='bow_string_contact'else'l']['center'].copy()
  b.head=p;b.tail=p+Vector((0,0,.025));b.parent=armature.edit_bones[parent];b.use_deform=False
 bpy.ops.object.mode_set(mode='OBJECT');bpy.context.view_layer.update()
 def torso(p):
  if p.z<H+.14:return mix({'hips':1},{'spine':1},smooth((p.z-H+.02)/.17))
  if p.z<H+.29:return mix({'spine':1},{'chest':1},smooth((p.z-H-.12)/.17))
  return mix({'chest':1},{'upper_chest':1},smooth((p.z-H-.27)/max(.03,shoulderZ-H-.27)))
 def head_weight(p):
  return mix({'neck':1},{'head':1},smooth((p.z-c['neck'][2]+.005)/.09))
 def limb(p,side):
  sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
  axis=(wr-el).normalized();q=(p-el).dot(axis)
  w=mix({'upper_arm_'+side:1},{'lower_arm_'+side:1},smooth((q+.045)/.09));q=(p-wr).dot(axis)
  return mix(w,{'hand_'+side:1},smooth((q+.025)/.05))
 def leg(p,side):
  knee=land['lower_leg_'+side].z;ankle=land['foot_'+side].z
  w=mix({'upper_leg_'+side:1},{'lower_leg_'+side:1},smooth((knee+.065-p.z)/.13));w=mix(w,{'foot_'+side:1},smooth((ankle+.08-p.z)/.1))
  if p.z<ankle*.7:w=mix(w,{'toe_'+side:1},smooth((c['ankle'][1]-.055-p.y)/.08))
  return mix(w,{'hips':1},smooth((p.z-H+.10)/.16))
 def cape_fraction(p):
  if not c['cape']:return 0
  # Source-specific rear surface and lateral overhang measured from section views.
  behind=smooth((p.y-(.10 if id=='viking-civilian'else .075))/.055)
  lateral=smooth((abs(p.x)-(.20 if id=='viking-civilian'else .23))/.045)*smooth((p.y+.035)/.07)
  if id=='maki-archer-t4':lateral=max(lateral,smooth((abs(p.x)-.23)/.045)*(1-smooth((p.z-.78)/.13)))
  return max(behind,lateral)*(1-smooth((p.z-shoulderZ+.03)/.13))*smooth((p.z-c['capeBottom']+.03)/.06)
 def cape_weights(p):
  bs=[rig.data.bones[n]for n in ['cape_upper','cape_mid','cape_lower']]
  centres=[(b.head_local.z+b.tail_local.z)/2 for b in bs]
  if p.z>=centres[0]:return {'cape_upper':1}
  if p.z>=centres[1]:return mix({'cape_upper':1},{'cape_mid':1},smooth((centres[0]-p.z)/(centres[0]-centres[1])))
  return mix({'cape_mid':1},{'cape_lower':1},smooth((centres[1]-p.z)/(centres[1]-centres[2])))
 # Geodesic sleeve field follows the actual connected garment surface, not
 # a world-X cut through the inner elbow. Weld an analysis graph only.
 representatives=[];lookup={};weld=[]
 for v in mesh.data.vertices:
  key=tuple(round(x,5)for x in v.co)
  if key not in lookup:lookup[key]=len(representatives);representatives.append(v.co.copy())
  weld.append(lookup[key])
 surface_color=None
 if id=='viking-civilian':
  image=bpy.data.images.get('texture_0');pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape((image.size[1],image.size[0],4))
  # The imported image pixel buffer retains source sRGB samples; compare the
  # reviewed brown-cloak versus grey-trouser color ratios without recoloring.
  values=[[]for p in representatives];layer=mesh.data.uv_layers.active
  for loop in mesh.data.loops:
   u,v=layer.data[loop.index].uv;x=max(0,min(image.size[0]-1,int(u*image.size[0])));y=max(0,min(image.size[1]-1,int(v*image.size[1])));rgb=pixels[y,x,:3];values[weld[loop.vertex_index]].append(rgb)
  surface_color=[np.mean(v,axis=0)for v in values];del pixels
  print('NORDIC_COLOR_RATIOS',np.quantile([(rgb[0]+.004)/(rgb[2]+.004)for rgb,p in zip(surface_color,representatives)if p.y>.125 and .8<p.z<1.3],[.1,.5,.9]).tolist())
 graph=[{}for p in representatives]
 for f in mesh.data.polygons:
  vi=[weld[i]for i in f.vertices]
  for a,b in zip(vi,vi[1:]+vi[:1]):
   if a!=b:graph[a][b]=graph[b][a]=(representatives[a]-representatives[b]).length
 sleeve_fields={}
 for side,s in [('l',1),('r',-1)]:
  sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
  distances=[math.inf]*len(representatives);queue=[]
  for i,p in enumerate(representatives):
   if (p-wr).length<.055 and p.x*s>.26 and cape_fraction(p)<.35:
    distances[i]=(p-wr).length;heapq.heappush(queue,(distances[i],i))
  while queue:
   distance,i=heapq.heappop(queue)
   if distance!=distances[i]:continue
   for j,length in graph[i].items():
    p=representatives[j]
    if p.x*s<.09 or (cape_fraction(p)>.7 and p.z<shoulderZ-.13):continue
    candidate=distance+length
    if candidate<distances[j]:distances[j]=candidate;heapq.heappush(queue,(candidate,j))
  reach=(wr-el).length+(el-sh).length
  sleeve_fields[side]=[1-smooth((d-(reach-.07))/.14)if math.isfinite(d)else 0 for d in distances]
 # Competing surface-distance labels separate the outer cloak from real
 # inner torso/leg backing, even where the AI source fused the surfaces.
 # All seeds are physical regions measured on these normalized sources.
 cape_field=[0.0]*len(representatives)
 if c['cape']:
  cape_seeds=[];body_seeds=[]
  source_bvh=BVHTree.FromPolygons([v.co for v in mesh.data.vertices],[list(f.vertices)for f in mesh.data.polygons])
  rear_visible=[]
  for i,p in enumerate(representatives):
   side='l'if p.x>=0 else'r';sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
   axis=wr-el;t=max(0,min(1,(p-el).dot(axis)/axis.length_squared));near=el+axis*t
   arm_distance=min(segment(p,sh,el)[0],segment(p,el,wr)[0])
   height_ok=c['capeBottom']+.025<p.z<shoulderZ-.12
   posterior=p.y>(.145 if id=='viking-civilian'else .125)
   side_edge=abs(p.x)>.22 and p.y>(.065 if id=='viking-civilian'else near.y+.075)
   lower_edge=id=='maki-archer-t4' and .22<p.z<.78 and abs(p.x)>.27
   hit,normal,face,distance=source_bvh.ray_cast(Vector((p.x+.000003,2,p.z+.000003)),Vector((0,-1,0)))
   visible=hit is not None and abs(hit.y-p.y)<.008 and .25<p.z<shoulderZ-.10 and p.y>-.015
   rear_visible.append(visible)
   is_cape=(height_ok and (posterior or side_edge or lower_edge))or visible
   # The body backside is a distinct source surface, not generated backing.
   torso_seed=abs(p.x)<.17 and H-.18<p.z<shoulderZ-.10 and p.y<(.105 if p.z<H+.04 else .070)
   limb_seed=arm_distance<.055 and p.y<near.y+.04 and wr.z-.10<p.z<shoulderZ-.12
   leg_seed=p.z<c['hem']-.03 and abs(p.x)<.23 and p.y<Y+.08
   texture_body=False
   if id=='viking-civilian' and p.z<.80:
    rgb=surface_color[i];ratio=(rgb[0]+.004)/(rgb[2]+.004);is_cape=is_cape and ratio>1.75;texture_body=ratio<1.65 and abs(p.x)<.24 and p.y<.14
   if is_cape:cape_seeds.append(i)
   elif torso_seed or limb_seed or leg_seed or texture_body:body_seeds.append(i)
  def field(seeds):
   distances=[math.inf]*len(representatives);queue=[]
   for i in seeds:distances[i]=0.;heapq.heappush(queue,(0.,i))
   while queue:
    distance,i=heapq.heappop(queue)
    if distance!=distances[i]:continue
    for j,length in graph[i].items():
     candidate=distance+length
     if candidate<distances[j]:distances[j]=candidate;heapq.heappush(queue,(candidate,j))
   return distances
  dc,db=field(cape_seeds),field(body_seeds)
  for i,p in enumerate(representatives):
   if math.isfinite(dc[i]) and math.isfinite(db[i]):
    cape_field[i]=smooth((db[i]-dc[i]+.018)/.036)*(1-smooth((p.z-shoulderZ+.08)/.16))
    if id=='viking-civilian':
     cape_field[i]*=smooth((p.z-c['capeBottom']+.035)/.045)
 if reviewed_mask:
  if len(reviewed_mask['capeFractionByWeldedVertex'])!=len(representatives):raise ValueError('Reviewed cape vertex count mismatch')
  cape_field=reviewed_mask['capeFractionByWeldedVertex']
 refine_mantle=id=='viking-civilian' and '--refine-mantle' in args
 if refine_mantle:
  for i,p in enumerate(representatives):
   if not (1.27<p.z<1.48) or (abs(p.x)<.09 and p.y<-.04 and p.z>1.44):continue
   rgb=surface_color[i];ratio=(rgb[0]+.004)/(rgb[2]+.004);mantle=smooth((ratio-1.72)/.14)*(1-smooth((max(rgb)-.40)/.12))
   cape_field[i]=float(max(cape_field[i],mantle))
 region_counts={};cape_indices=[]
 for v in mesh.data.vertices:
  p=v.co;side='l'if p.x>=0 else'r';sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
  da=min(segment(p,sh,el)[0],segment(p,el,wr)[0])
  arm=sleeve_fields[side][weld[v.index]]*(1-smooth((p.z-shoulderZ+.02)/.11))*smooth((p.z-wr.z+.22)/.08)
  # Measured competitive surface field keeps cape, backing, and limbs apart.
  capeF=cape_field[weld[v.index]] if c['cape'] else 0
  # Distal hands must retain the geodesic arm field: an elbow/wrist capsule
  # ends before the fingers. Roman keeps its V3-known-good segmentation.
  hand_region=p.z<wr.z+.04 and (p-wr).length<.19 and abs(p.x)>.30
  if c['cape'] and not hand_region:arm*=1-smooth((da-(.105 if id=='viking-civilian'else .085))/.055)
  arm*=1-capeF
  if p.z>c['neck'][2]-.025:
   w=mix(torso(p),head_weight(p),smooth((p.z-c['neck'][2]+.025)/.08));region='head'
  elif p.z<H:
   w=leg(p,side);region='leg'
   garment=smooth((p.z-c['hem']+.015)/.07)
   if garment>0:
    front='front'if p.y<Y else'back';cloth=mix({'skirt_'+front+'_r':1},{'skirt_'+front+'_l':1},smooth((p.x+.045)/.09))
    if front=='front':cloth=mix(cloth,{'skirt_front_center':1},(1-smooth(abs(p.x)/.09))*.35)
    cloth=mix(cloth,{'hips':1},smooth((p.z-H+.13)/.13));w=mix(w,cloth,garment);region='skirt'
  else:w=torso(p);region='torso'
  if arm>0:w=mix(w,limb(p,side),arm);region='arm'if arm>.5 else region
  hand_surface=p.z<wr.z+.025 and p.z>wr.z-.235 and p.y<wr.y+.065 and abs(p.x)>.275 and (p-wr).length<.245
  if hand_surface and capeF<.1:w={'hand_'+side:1};region='hand'
  if hand_surface and capeF<.1:
   hand=hand_frames[side];along=(p-wr).dot(hand['along']);best=sorted((segment(p,a,b)[0],name)for name,(a,b)in finger_segments.items()if name.endswith('_'+side))[:2]
   if along>hand['fingerBase']-.015 and best[0][0]<.080:
    weights={name:1/max(.006,dist)**4 for dist,name in best};total=sum(weights.values());weights={n:v/total for n,v in weights.items()};w=mix(w,weights,smooth((along-hand['fingerBase']+.015)/.035));region='hand'
  if capeF>0:w=mix(w,cape_weights(p),capeF);cape_indices.append(v.index);region='cape'if capeF>.5 else region
  if abs(p.x)>.13 and p.z>shoulderZ-.06 and p.z<shoulderZ+.06 and capeF<.4 and p.z<c['neck'][2]-.04:
   w=mix(w,{'clavicle_'+side:1},smooth((abs(p.x)-.13)/.08)*.35)
  ranked=sorted(((n,a)for n,a in w.items()if a>1e-5),key=lambda z:-z[1])[:4];total=sum(a for n,a in ranked)
  for n,a in ranked:
   g=mesh.vertex_groups.get(n)or mesh.vertex_groups.new(name=n);g.add([v.index],a/total,'REPLACE')
  region_counts[region]=region_counts.get(region,0)+1
 # The source is fused at the cloak/forearm and cloak/leg contacts. Separate
 # those surface ownership seams in bind space, preserving retained source faces,
 # corner UV and rest position. A face belongs to one deforming surface; mixed
 # vertices must not stretch a sleeve all the way to a hanging cloak panel.
 split_audit={'method':'No cape surface','duplicatedVertices':0,'sourceFacesPreserved':len(mesh.data.polygons)}
 if c['cape']:
  old=mesh.data;old.calc_loop_triangles();uv=old.uv_layers.active
  groups=[g.name for g in mesh.vertex_groups]
  weights=[{groups[g.group]:g.weight for g in v.groups}for v in old.vertices]
  cape_sums=[sum(w for n,w in d.items()if n.startswith('cape_'))for d in weights]
  owners=[sum(cape_sums[i]for i in f.vertices)/len(f.vertices)>.45 and sum(old.vertices[i].co.z for i in f.vertices)/len(f.vertices)<shoulderZ+(.11 if refine_mantle else -.07) for f in old.polygons]
  if reviewed_mask and not refine_mantle:
   approved=set(reviewed_mask['capeFaceIndices']);owners=[f.index in approved for f in old.polygons]
  mapped={};newpts=[];newweights=[];polys=[];uvs=[];normals=[];kept_faces=[];removed_bridges=[]
  def is_bridge(f):
   if reviewed_mask:return f.index in reviewed_mask['removedBridgeFaceIndices']
   values=[cape_sums[i]for i in f.vertices];z=sum(old.vertices[i].co.z for i in f.vertices)/len(f.vertices)
   return max(values)>.85 and min(values)<.15 and z<shoulderZ-.15
  original_edges={}
  for f in old.polygons:
   for a,b in zip(f.vertices,list(f.vertices[1:])+[f.vertices[0]]):
    key=tuple(sorted([tuple(round(x,5)for x in old.vertices[a].co),tuple(round(x,5)for x in old.vertices[b].co)]));original_edges[key]=original_edges.get(key,0)+1
  # Boundary fallback draws from the neighboring body surface of the same face.
  fallback={}
  for f,is_cape in zip(old.polygons,owners):
   if is_cape:continue
   accum={}
   for vi in f.vertices:
    for name,w in weights[vi].items():
     if not name.startswith('cape_'):accum[name]=accum.get(name,0)+w
   if accum:
    for vi in f.vertices:
     target=fallback.setdefault(vi,{})
     for name,w in accum.items():target[name]=target.get(name,0)+w
  for f,is_cape in zip(old.polygons,owners):
   if is_bridge(f):removed_bridges.append(f.index);continue
   kept_faces.append(f.index);face=[]
   for li in f.loop_indices:
    vi=old.loops[li].vertex_index;key=(vi,is_cape)
    if key not in mapped:
     p=old.vertices[vi].co.copy();mapped[key]=len(newpts);newpts.append(p)
     w=mix(torso(p),cape_weights(p),smooth((shoulderZ-.13-p.z)/.20))if is_cape else {n:a for n,a in weights[vi].items()if not n.startswith('cape_')}
     if not w:w=fallback.get(vi)or torso(p)
     if not is_cape:
      side='l'if p.x>=0 else'r';sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
      distance=min(segment(p,sh,el)[0],segment(p,el,wr)[0])
      if wr.z+.025<p.z<shoulderZ+.06:
       amount=smooth((abs(p.x)-.155)/.075)*(1-smooth((distance-.11)/.05))*(1-smooth((p.z-shoulderZ+.04)/.10))
       if amount>0:w=mix(torso(p),limb(p,side),amount)
     ranked=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(v for n,v in ranked);newweights.append({n:v/total for n,v in ranked})
    face.append(mapped[key]);uvs.append(tuple(uv.data[li].uv));normals.append(tuple(old.corner_normals[li].vector))
   polys.append(face)
  new=bpy.data.meshes.new('SourceMeshySurface_SeparatedCloth');new.from_pydata(newpts,[],polys);new.update()
  for m in old.materials:new.materials.append(m)
  layer=new.uv_layers.new(name=uv.name)
  for i,t in enumerate(uvs):layer.data[i].uv=t
  for f,fi in zip(new.polygons,kept_faces):srcf=old.polygons[fi];f.use_smooth=srcf.use_smooth;f.material_index=srcf.material_index
  new.normals_split_custom_set(normals);mesh.data=new
  ownership=new.attributes.new(name='garment_surface_owner',type='INT',domain='POINT')
  provenance=new.attributes.new(name='source_vertex_index',type='INT',domain='POINT')
  for (vi,owner),i in mapped.items():ownership.data[i].value=int(owner);provenance.data[i].value=vi
  mesh.vertex_groups.clear()
  for name in sorted({name for w in newweights for name in w}):mesh.vertex_groups.new(name=name)
  for i,w in enumerate(newweights):
   for name,a in w.items():mesh.vertex_groups[name].add([i],a,'REPLACE')
  # Close only newly cut body loops. Original source boundaries and the
  # intentional ragged cloak hem are excluded by original-edge provenance.
  bm=bmesh.new();bm.from_mesh(new);bm.verts.ensure_lookup_table();deform=bm.verts.layers.deform.active;uvlayer=bm.loops.layers.uv.active
  source_face_layer=bm.faces.layers.int.new('original_source_face_index')
  for f,source_index in zip(bm.faces,kept_faces):f[source_face_layer]=source_index+1
  body=[bm.verts[i]for (vi,owner),i in mapped.items()if not owner]
  # Weld redundant UV/normal seams only on this local repair representation.
  bmesh.ops.remove_doubles(bm,verts=body,dist=.000001)
  cape_ids={mesh.vertex_groups[n].index for n in mesh.vertex_groups.keys()if n.startswith('cape_')}
  ownerlayer=bm.verts.layers.int['garment_surface_owner'];source_index_layer=bm.verts.layers.int['source_vertex_index']
  edges=[]
  for e in bm.edges:
   key=tuple(sorted(tuple(round(x,5)for x in v.co)for v in e.verts))
   if e.is_boundary and all(v[ownerlayer]==0 for v in e.verts):edges.append(e)
  bm.edges.index_update();bm.verts.index_update();loops=[]
  # Recover simple boundary cycles, including loops that touch at source
  # non-manifold vertices. Original dangling edges remain separately audited.
  adjacency={}
  for e in edges:
   a,b=e.verts;adjacency.setdefault(a,{})[b]=e;adjacency.setdefault(b,{})[a]=e
  remaining=set(adjacency);cycles=[]
  while remaining:
   root=min(remaining,key=lambda v:v.index);stack=[root];pred={root:root};used={root:set()}
   while stack:
    z=stack.pop();zused=used[z]
    for nbr in sorted(adjacency[z],key=lambda v:v.index):
     if nbr not in used:pred[nbr]=z;stack.append(nbr);used[nbr]={z}
     elif nbr not in zused:
      pn=used[nbr];cycle=[nbr,z];p=pred[z]
      while p not in pn:cycle.append(p);p=pred[p]
      cycle.append(p);cycles.append(cycle);used[nbr].add(z)
   remaining-=set(pred)
  for vs in cycles:
   part=[adjacency[a][b]for a,b in zip(vs,vs[1:]+vs[:1])];bounds=[[min(v.co[k]for v in vs)for k in range(3)],[max(v.co[k]for v in vs)for k in range(3)]]
   newly_cut=any(original_edges.get(tuple(sorted(tuple(round(x,5)for x in v.co)for v in e.verts)),0)>1 for e in part)
   print('BODY_BOUNDARY',len(part),bounds,newly_cut)
   # Nordic's source has a fused torso/knee line; its complete inner loop is
   # allowed while the outer cape is excluded by explicit surface ownership.
   upper_lining=min(v.co.z for v in vs)>H+.05 and max(v.co.z for v in vs)<shoulderZ+.025
   if len(part)<=260 and newly_cut and (upper_lining or len(part)<=64 or id=='viking-civilian'):loops.append(part)
  added=0;patch_records=[];adjusted_boundary=[];adjusted_lining=[];patch_layer=bm.faces.layers.int.new('lining_patch_id')
  for loop in loops:
   before_count=len(bm.verts)
   # A source-fused cloak contact leaves a thin lateral fin on the sleeve.
   # Constrain only the inspected cut boundary and its body-side one-ring to
   # the measured sleeve envelope, leaving the duplicated cape surface intact.
   ring={v for e in loop for v in e.verts}
   ring|={e.other_vert(v)for v in list(ring)for e in v.link_edges if all(q[ownerlayer]==0 for q in e.verts)}
   for v in ring:
    p=v.co;side='l'if p.x>=0 else'r';sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
    if not (wr.z+.025<p.z<shoulderZ-.07 and abs(p.x)>.19):continue
    axis=el-sh;t=max(0,min(1,(p-sh).dot(axis)/axis.length_squared));near=sh+axis*t
    axis2=wr-el;t2=max(0,min(1,(p-el).dot(axis2)/axis2.length_squared));near2=el+axis2*t2
    if (p-near2).length<(p-near).length:near=near2
    radius=.045;distance=(p-near).length
    armweight=sum(v[deform].get(mesh.vertex_groups[n].index,0)for n in ['upper_arm_'+side,'lower_arm_'+side]if n in mesh.vertex_groups)
    if distance>radius and armweight>.65:
     oldpos=p.copy();v.co=near+(p-near)*(radius/distance);adjusted_boundary.append({'sourceVertexIndex':v[source_index_layer],'from':arr(oldpos),'to':arr(v.co)})
   ordered=[loop[0].verts[0]];current=loop[0].verts[1];previous=loop[0]
   while current!=ordered[0]:
    ordered.append(current);edge=next(e for e in current.link_edges if e in loop and e!=previous);current=edge.other_vert(current);previous=edge
   coords=[v.co.copy()for v in ordered];indices={tuple(p):i for i,p in enumerate(coords)};faces=[]
   for tri in tessellate_polygon([coords]):
    verts=[ordered[p if isinstance(p,int) else indices[tuple(p)]]for p in tri]
    try:faces.append(bm.faces.new(verts))
    except ValueError:
     # A thin source flap can already contain the opposite side's triangle.
     # A separate coincident lining retains UV/weights and closes its backside.
     copies=[]
     for original in verts:
      duplicate=bm.verts.new(original.co);duplicate[ownerlayer]=0
      for group,weight in original[deform].items():duplicate[deform][group]=weight
      copies.append(duplicate)
     faces.append(bm.faces.new(copies))
   patch_id=len(patch_records)+1
   for f in faces:f[patch_layer]=patch_id
   bmesh.ops.triangulate(bm,faces=faces)
   patch_faces={f for f in bm.faces if f[patch_layer]==patch_id}
   # Keep source boundary vertices intact. Refine long internal diagonals so
   # anatomical interpolation cannot turn an upper-back lining into rigid wings.
   internal=[e for e in bm.edges if len(e.link_faces)==2 and all(f in patch_faces for f in e.link_faces) and e.calc_length()>.045]
   if internal:
    result=bmesh.ops.subdivide_edges(bm,edges=internal,cuts=3,use_grid_fill=True)
    patch_faces={f for f in bm.faces if f[patch_layer]==patch_id}
   bmesh.ops.triangulate(bm,faces=list(patch_faces))
   patch_faces={f for f in bm.faces if f[patch_layer]==patch_id}
   if c.get('liningInset'):
    # The inspected center-back stripe is generated body lining, not a cape
    # bridge. Keep only its interior inside the measured torso envelope;
    # original source boundary corners and all upper/sleeve repairs stay fixed.
    boundary=set(ordered);inset_config=c['liningInset']
    for v in {v for f in patch_faces for v in f.verts}-boundary:
     p=v.co;amount=smooth((inset_config['halfWidthM']-abs(p.x))/inset_config['lateralFadeM'])*smooth((p.z-inset_config['lowerStartM'])/inset_config['lowerFadeM'])*(1-smooth((p.z-inset_config['upperStartM'])/inset_config['upperFadeM']))
     inset=min(inset_config['maxM'],max(0,p.y-inset_config['rearPlaneM']))*amount
     if inset>1e-7:
      before=arr(p);v.co.y-=inset;adjusted_lining.append({'patch':patch_id,'from':before,'to':arr(v.co),'insetM':inset})
   for v in {v for f in patch_faces for v in f.verts}:
    p=v.co;side='l'if p.x>=0 else'r';sh,el,wr=[land[n+'_'+side]for n in ['upper_arm','lower_arm','hand']]
    if not (wr.z+.025<p.z<shoulderZ-.07 and abs(p.x)>.19):continue
    candidates=[]
    for a,b in [(sh,el),(el,wr)]:
     axis=b-a;t=max(0,min(1,(p-a).dot(axis)/axis.length_squared));near=a+axis*t;candidates.append(((p-near).length,near))
    distance,near=min(candidates,key=lambda x:x[0]);amount=smooth((abs(p.x)-.155)/.075)*(1-smooth((distance-.11)/.05))*(1-smooth((p.z-shoulderZ+.04)/.10))
    if amount>.65 and distance>.045:v.co=near+(p-near)*(.045/distance)
    w=mix(torso(v.co),limb(v.co,side),amount);ranked=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(a for n,a in ranked);v[deform].clear()
    for name,a in ranked:v[deform][mesh.vertex_groups[name].index]=a/total
   for f in patch_faces:
    f.smooth=True
    # Sample the closest original source surface for each lining corner. The
    # small triangles retain the original material and do not introduce decals.
    for l in f.loops:
     point,normal,fi,distance=source_bvh.find_nearest(l.vert.co)
     sf=old.polygons[fi];ids=list(sf.vertices);lus=list(sf.loop_indices)
     mapped_uv=barycentric_transform(point,*[old.vertices[i].co for i in ids],*[Vector((uv.data[i].uv.x,uv.data[i].uv.y,0))for i in lus])
     l[uvlayer].uv=(mapped_uv.x,mapped_uv.y)
    added+=len(f.verts)-2
   patch_records.append({'boundaryEdges':len(loop),'triangles':len(patch_faces),'addedVertices':len(bm.verts)-before_count,'bounds':[[min(v.co[k]for e in loop for v in e.verts)for k in range(3)],[max(v.co[k]for e in loop for v in e.verts)for k in range(3)]]})
  refinement=reviewed_mask.get('innerCapeRefinement')if reviewed_mask else None
  if '--inner-cape-refinement' in args:refinement=json.loads(Path(args[args.index('--inner-cape-refinement')+1]).read_text())
  refinement_audit={'sourceFaceIndices':[],'addedVertices':0,'addedTriangles':0}
  if refinement:
   if refinement['sourceSha256']!=sha or refinement['normalizedGeometrySha256']!=geometry_hash:raise ValueError('Inner cape refinement source mismatch')
   def corner_signature(loop):return(tuple(round(x,7)for x in loop.vert.co),tuple(round(x,7)for x in loop[uvlayer].uv),tuple(sorted((group,round(weight,6))for group,weight in loop.vert[deform].items()if weight>1e-8)))
   before_corners={corner_signature(loop)for f in bm.faces for loop in f.loops}
   selected=set(refinement['faceIndices']);before_vertex_count=len(bm.verts);before_positions={tuple(v.co)for v in bm.verts};before_triangles=sum(len(f.verts)-2 for f in bm.faces)
   for _ in range(3):
    edges=[e for e in bm.edges if e.calc_length()>refinement['maxEdgeM'] and all(v[ownerlayer]==1 for v in e.verts) and any(f[source_face_layer]-1 in selected for f in e.link_faces)]
    if not edges:break
    bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>3])
   inserted=[v for v in bm.verts if tuple(v.co)not in before_positions]
   for v in inserted:
    v[source_index_layer]=-1;w=mix(torso(v.co),cape_weights(v.co),smooth((shoulderZ-.13-v.co.z)/.20));ranked=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(a for n,a in ranked);v[deform].clear()
    for name,a in ranked:v[deform][mesh.vertex_groups[name].index]=a/total
   refinement_audit={'sourceFaceIndices':sorted(selected),'addedVertices':len(bm.verts)-before_vertex_count,'resampledInsertedVertices':len(inserted),'addedTriangles':sum(len(f.verts)-2 for f in bm.faces)-before_triangles,'maxEdgeTargetM':refinement['maxEdgeM'],'method':'Local original inner-shell edge subdivision; original corner positions and UVs preserved, new corners interpolate source UV and continuous existing cape weights. Outer silhouette and helper bind transforms unchanged.'}
   descendants={}
   for f in bm.faces:
    if f[source_face_layer]>0:descendants[f[source_face_layer]-1]=descendants.get(f[source_face_layer]-1,0)+1
   refinement_audit['affectedSourceFaceIndices']=[i for i,n in sorted(descendants.items())if n>1]
   after_corners={corner_signature(loop)for f in bm.faces for loop in f.loops};missing_corners=before_corners-after_corners
   if missing_corners:raise ValueError(f'Inner-shell refinement changed {len(missing_corners)} existing position/UV/skin corners')
   refinement_audit['existingCornerPreservation']={'cornersBefore':len(before_corners),'missingOrChangedCorners':0,'positionUvDecimals':7,'weightDecimals':6,'beforeSha256':hashlib.sha256(json.dumps(sorted(before_corners),separators=(',',':')).encode()).hexdigest()}
  bm.to_mesh(new);bm.free();new.update()
  actual_added=sum(len(f.vertices)-2 for f in new.polygons)-len(kept_faces)-refinement_audit['addedTriangles']
  if actual_added!=added:raise ValueError(f'Backing accounting mismatch: {actual_added} actual versus {added} classified')
  split_audit={'method':'Source-hash-defined surface seam split; removed only mixed cloak/body bridge faces; closed new bounded body loops using adjacent original UVs','originalSourceVertices':source_vertex_count,'splitSurfaceVerticesBeforeWeld':len(newpts),'duplicatedSourceVertices':len(newpts)-len({vi for vi,owner in mapped}),'removedUnusedSourceVertices':source_vertex_count-len({vi for vi,owner in mapped}),'finalVerticesBeforeLod':len(new.vertices),'sourceFacesPreserved':len(kept_faces),'removedBridgeFaces':removed_bridges,'bodyBackingTriangles':added,'liningPatches':patch_records,'sleeveBoundaryAdjustments':adjusted_boundary,'generatedInteriorLiningAdjustments':adjusted_lining,'generatedInteriorLiningInsetContract':c.get('liningInset'),'capeFaces':sum(owners)}
  split_audit['innerCapeRefinement']=refinement_audit
 if c['cape']:
  mask={'schemaVersion':1,'sourceSha256':sha,'normalizedGeometrySha256':geometry_hash,'sourceVertexCount':source_vertex_count,'sourceTriangleCount':source_count,'capeFractionByWeldedVertex':cape_field,'capeFaceIndices':[i for i,owner in enumerate(owners)if owner],'removedBridgeFaceIndices':removed_bridges,'reviewReference':reviewed_mask.get('reviewReference')if reviewed_mask else 'Candidate: inspect semantic colors and deformed original materials before freezing.'}
  if refinement:mask['innerCapeRefinement']=refinement
  if reviewed_mask.get('lodPairedShell'):mask['lodPairedShell']=reviewed_mask['lodPairedShell']
  (out/'surface-mask.json').write_text(json.dumps(mask,separators=(',',':'))+'\n')
 mesh.parent=rig;modifier=mesh.modifiers.new('Anatomical_Fitted_Skin','ARMATURE');modifier.object=rig
 for mat in mesh.data.materials:
  mat.use_backface_culling=False
 # Original UVs unchanged; source already has connected posterior cloth. Tiny
 # source boundary defects are recorded, not blindly filled across garment hems.
 def point_local(side,p):return rig.data.bones['hand_'+side].matrix_local.inverted()@p
 def dir_local(side,p):return rig.data.bones['hand_'+side].matrix_local.to_quaternion().inverted()@p
 frames={}
 for side,f in hand_frames.items():
  norm=dir_local(side,f['normal']).normalized();axis=dir_local(side,f['thumb']).normalized();along=dir_local(side,f['along']).normalized();centre=point_local(side,f['center'])
  # Surface tangent sampled within the anatomical palm (nearest real source vertex).
  palm_candidates=[v.co for v in mesh.data.vertices if (v.co-f['center']).length<.047 and (v.co-land['hand_'+side]).dot(f['along'])>0]
  if palm_candidates:
   deviations=[(p-f['center']).dot(f['normal'])for p in palm_candidates];surface=float(np.percentile(deviations,80));centre+=norm*(surface+.021)
  frames[side]=dict(gripCenterLocal=arr(centre),gripAxisLocal=arr(axis),palmNormalLocal=arr(norm),fingerDirection=arr(along),wristCenter=[0,0,0],thumbBaseCenter=arr(point_local(side,f['thumbBase'])),fingerBase=f['fingerBase'],gripRadius=.021)
 # The held pilum shaft runs opposite the sword's measured shaft direction.
 # Keep its anatomical palm center/normal; this preserves inward finger curl.
 ranged=dict(frames['r']);ranged['gripAxisLocal']=[-x for x in ranged['gripAxisLocal']]
 left=frames['l'];bow=dict(palmContactCenter=arr(Vector(left['gripCenterLocal'])-Vector(left['palmNormalLocal'])*left['gripRadius']),palmNormal=left['palmNormalLocal'],thumbDir=1,thumbDirection=left['gripAxisLocal'],fingerDirection=left['fingerDirection'],wristCenter=[0,0,0],fingerBase=left['fingerBase'],thumbBaseCenter=left['thumbBaseCenter'])
 rig_info={b.name:{'parent':b.parent.name if b.parent else None,'headBlenderM':arr(b.head_local),'tailBlenderM':arr(b.tail_local),'restMatrixBlender':[float(x)for row in b.matrix_local for x in row],'lengthM':b.length}for b in rig.data.bones}
 # Bearing points lie on upper-thigh / pelvis surfaces, excluding long rear cloth.
 bearing=[]
 for side,s in [('l',1),('r',-1)]:
  # Explicit loop avoids using a stale comprehension variable.
  candidates=[v.co for v in mesh.data.vertices if .05<v.co.x*s<.17 and H-.22<v.co.z<H-.06 and Y+.025<v.co.y<Y+.12]
  if candidates:
   target=Vector((s*.1,Y+.09,H-.12));p=min(candidates,key=lambda p:(p-target).length);bearing.append([p.x,p.z,-p.y])
 data=mesh.data.copy();triangles={};filehash={};lod_records=[]
 lod_shell=(reviewed_mask or{}).get('lodPairedShell')
 if '--paired-lod-shell' in args:lod_shell=json.loads(Path(args[args.index('--paired-lod-shell')+1]).read_text())
 if lod_shell and lod_shell['sourceSha256']!=sha:raise ValueError('Paired LOD shell source mismatch')
 for lod,budget in ([(0,source_count)]if '--lod0-only' in args else[(2,1800)]if '--lod2-only' in args else [(0,source_count),(1,4500),(2,1800)]):
  mesh.data=data.copy();activate(mesh);lod_protection_audit=None
  if lod:
   # Weld only redundant position seams in the analysis-derived LOD mesh. UVs
   # remain loop attributes; Blender collapse interpolates normalized weights.
   bm=bmesh.new();bm.from_mesh(mesh.data);surface=bm.verts.layers.int.get('garment_surface_owner')
   if lod_shell:
    source_layer=bm.faces.layers.int['original_source_face_index'];inner_ids=set(lod_shell['innerSourceFaceIndices']);remove=[f for f in bm.faces if f[source_layer]-1 in inner_ids];removed_lod_inner=sum(len(f.verts)-2 for f in remove)
    bmesh.ops.delete(bm,geom=remove,context='FACES')
   for owner in ([0,1]if surface else [0]):
    verts=[v for v in bm.verts if not surface or v[surface]==owner]
    bmesh.ops.remove_doubles(bm,verts=verts,dist=.000001)
   bm.to_mesh(mesh.data);bm.free()
   dec=mesh.modifiers.new('Offline_Quality_LOD','DECIMATE');dec.ratio=(budget-(200 if lod==2 else 300)if lod_shell else budget)/sum(len(p.vertices)-2 for p in mesh.data.polygons);dec.use_collapse_triangulate=True
   bpy.ops.object.modifier_apply(modifier=dec.name)
   if lod_shell:
    bm=bmesh.new();bm.from_mesh(mesh.data);source_layer=bm.faces.layers.int['original_source_face_index'];owner=bm.verts.layers.int['garment_surface_owner'];deform=bm.verts.layers.deform.active;uvlayer=bm.loops.layers.uv.active
    outer_ids=set(lod_shell['outerSourceFaceIndices']);outer=[f for f in bm.faces if f[source_layer]-1 in outer_ids];bm.normal_update();copies={}
    inner_faces=[old.polygons[i]for i in lod_shell['innerSourceFaceIndices']];inner_bvh=BVHTree.FromPolygons([v.co for v in old.vertices],[list(f.vertices)for f in inner_faces])
    for v in {v for f in outer for v in f.verts}:
     normal=sum((f.normal for f in v.link_faces if f in outer),Vector()).normalized();n=bm.verts.new(v.co-normal*lod_shell['thicknessM']);n[owner]=1
     for group,weight in v[deform].items():n[deform][group]=weight
     copies[v]=n
    lining_triangles=0
    for f in outer:
     n=bm.faces.new([copies[v]for v in reversed(f.verts)]);n.material_index=f.material_index;n.smooth=True;lining_triangles+=len(n.verts)-2
     for loop in n.loops:
      point,normal,index,distance=inner_bvh.find_nearest(loop.vert.co);sf=inner_faces[index];mapped_uv=barycentric_transform(point,*[old.vertices[i].co for i in sf.vertices],*[Vector((uv.data[i].uv.x,uv.data[i].uv.y,0))for i in sf.loop_indices]);loop[uvlayer].uv=(mapped_uv.x,mapped_uv.y)
    pairs=[]
    for a,b in copies.items():
     ranked=sorted(a[deform].items(),key=lambda x:-x[1])[:4];total=sum(w for g,w in ranked);pairs.append({'outer':[a.co.x,a.co.z,-a.co.y],'inner':[b.co.x,b.co.z,-b.co.y],'weights':{mesh.vertex_groups[g].name:w/total for g,w in ranked if w>1e-8}})
    bm.to_mesh(mesh.data);bm.free();mesh.data.update();lod_protection_audit={'pairs':pairs,'method':lod_shell['method'],'removedOriginalInnerTriangles':removed_lod_inner,'pairedLiningTriangles':lining_triangles,'pairedVertices':len(copies),'thicknessM':lod_shell['thicknessM'],'identicalOuterInnerWeights':True}
  # Shared mesh and rig names/rest transforms are invariant across LODs.
  activate(mesh);rig.select_set(True)
  path=out/f'lod{lod}.glb';bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_all_influences=False,export_extras=True,export_yup=True,export_apply=False)
  triangles[f'lod{lod}']=sum(len(p.vertices)-2 for p in mesh.data.polygons);lod_records.append({'level':lod,'triangles':triangles[f'lod{lod}'],'verticesBlender':len(mesh.data.vertices)})
  if lod_protection_audit:lod_records[-1]['pairedCapeSurfacePreservation']=lod_protection_audit
 mesh.data=data
 cloth={'anchor':'chest','cape':cape,'skirt':skirt,'apron':'skirt_front_center'}
 measurements={'sourceSha256':sha,'heightM':c['height'],'overallHeightM':c['height'],'heightDefinition':'Uniform source outsole-to-hair/hood envelope; anatomical scalp under hood not invented.','shoulderWidthM':abs(land['upper_arm_l'].x-land['upper_arm_r'].x),'shoulderDefinition':'Measured fitted shoulder-joint span; outer garment envelope recorded separately.','neckLengthM':(land['head']-land['neck']).length,'triangles':triangles,'textures':{'lod0':2048,'lod1':1024,'lod2':512},'uniformScaleApplied':S,'groundTranslationSourceM':-lo,'sourcePoseRig':rig_info,'handGripFrames':{'left':bow},'swordGripFrames':{f'lod{i}':frames['r']for i in range(3)},'rangedGripFrames':{f'lod{i}':ranged for i in range(3)},'shieldGripFrames':{f'lod{i}':frames['l']for i in range(3)},'clothRig':cloth,'skinRegions':region_counts,'surfaceSplit':split_audit,'capeRepair':{'method':'Reviewed source-index cape/body ownership; localized fused-contact seam split, body lining and source-UV sampling; original ragged cape hem retained.','sourceBoundaryEdges':audit['boundaryEdges'],'backingAddedTriangles':split_audit.get('bodyBackingTriangles',0),'surfaceMask':'surface-mask.json'if c['cape']else None,'visualStatus':'Pending deformation review'}}
 measurements['lodSurfaceRepairs']={f"lod{r['level']}":r['pairedCapeSurfacePreservation']for r in lod_records if 'pairedCapeSurfacePreservation'in r}
 measurements['rangedGripCalibration']={'method':'Opposite anatomical shaft polarity from sword; unchanged measured palm center and normal.','review':'Production held pilum phase .28 front/side/rear and preserved release event.'}
 manifest={'schemaVersion':1,'id':id,'status':'ready','skeleton':'project-humanoid-v1','sharedLodPose':True,'forwardAxeCarry':True,'source':{'title':c['title'],'author':'Meshy','sourceFile':src.name,'sourceSha256':sha,'license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','licenseEvidence':'attribution-evidence.json'},'attribution':f"{c['title']} generated with Meshy; user-supplied free-plan asset under CC BY 4.0. Modified for SagaBurst: uniform normalization, fitted humanoid skinning, cloth helper rig, offline LODs and texture resizing. Animation credits recorded separately.",'files':{f'lod{i}':f'lod{i}.glb'for i in range(3)},'metrics':{k:measurements[k]for k in ['heightM','shoulderWidthM','neckLengthM','triangles','textures']},'boneMap':'bone-map.json','audit':'audit.json','handGripFrames':measurements['handGripFrames'],'swordGripFrames':measurements['swordGripFrames'],'rangedGripFrames':measurements['rangedGripFrames'],'shieldGripFrames':measurements['shieldGripFrames'],'handShapeMode':'authored','preserveLodHandTopology':False,'clothRig':cloth,'animationRetarget':{'sourceAsset':'roman','capeFloorClearanceM':.01,'cape':{'anchor':'chest','bones':[{'name':x['name'],'follow':x['follow']}for x in cape]},'skirt':skirt,'skirtApron':{'name':'skirt_front_center','follow':.9}},'seatBearing':{'mesh':'FactionHumanoid_Surface','points':bearing},'visualAcceptance':'Pending actual exported animation and runtime review. Structural generation is not visual acceptance.','knownLimitations':['Cloth uses fitted helper bones and baked poses; no dynamic cloth collision.','Anatomical scalp is concealed by the Shadow Warden hood; measured height is the source envelope.']if id=='maki-archer-t4'else['Cloth uses fitted helper bones and baked poses; no dynamic cloth collision.']}
 if run_profile:
  measurements['animationRetarget']={'capeRunProfile':run_profile}
  manifest['animationRetarget']['capeRunProfile']=run_profile
 if c['cape']:manifest['knownLimitations'].append('Hard angular inner-sleeve folds remain visible in some raised-arm poses; localized lining closes the reviewed openings without claiming smooth cloth simulation.')
 manifest['relaxedLeftThumbForward']=True
 manifest['knownLimitations'].append('The existing two-handed axe support hand retains its partly open/sliding source pose, emphasized by the low-poly fingers.')
 seam_changes='localized fused-garment seam separation and source-UV sampled inner lining (exact source face, vertex and patch counts in `blender-measurements.json`); 'if c['cape']else''
 if c['cape']and split_audit.get('innerCapeRefinement',{}).get('addedTriangles'):seam_changes+='local original inner-cape tessellation preserving existing position/UV/skin corners; '
 (out/'ATTRIBUTION.md').write_text(f"# {c['title']}\n\nModel generated with **Meshy** and supplied by the user, who confirmed the free Meshy plan. Model licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Meshy policy: https://help.meshy.ai/en/articles/16102098-can-i-use-meshy-assets-commercially\n\nSource: `{src.name}`\n\nSHA-256: `{sha}`\n\nChanges: uniform source-envelope normalization; fitted project-humanoid-v1 skeleton and finger chains; anatomical/topological skin weights; measured garment helper bones without cloth physics; {seam_changes}offline three-level LODs; resized embedded maps; retargeted existing project animation tracks. Original source bytes are preserved outside the runtime bundle.\n\nAnimation sources have their own terms; see `animation-source-attribution.txt` and `animation-retarget-audit.json`. The model's CC BY license does not replace those terms.\n")
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(out/'blender-measurements.json').write_text(json.dumps(measurements,indent=2)+'\n');(out/'bone-map.json').write_text(json.dumps({'skeleton':'project-humanoid-v1','sourceSkeleton':None,'method':'New source-fitted anatomical hierarchy, individual phalanges, cloth helpers and sockets; no replacement body geometry.','bones':rig_info},indent=2)+'\n')
 (out/'source-audit.json').write_text(json.dumps({'sourceFile':src.name,'sha256':sha,'bytes':len(raw),'originalTriangles':source_count,'sourceBoundsBlender':[[min(p[i]for p in points)for i in range(3)],[max(p[i]for p in points)for i in range(3)]],'sourceImages':source_images,'sourceHasSkins':False,'sourceHasAnimations':False,'sourceTopology':audit,'normalization':{'scale':S,'sourceGroundZ':lo},'pixelsInspected':'front, strict side and rear source renders before edits'},indent=2)+'\n')
 (out/'lod-audit.json').write_text(json.dumps({'sourceSha256':sha,'lods':lod_records,'visualAcceptance':'Pending'},indent=2)+'\n');(out/'attribution-evidence.json').write_text(json.dumps({'sourceSha256':sha,'sourceFile':src.name,'generator':'Meshy','userEvidence':'User confirmed all three models were generated with the free Meshy plan.','license':'Creative Commons Attribution 4.0 International','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','policyUrl':'https://help.meshy.ai/en/articles/16102098-can-i-use-meshy-assets-commercially','credit':'Meshy','changes':['Uniform source-envelope normalization','Source-fitted project-humanoid-v1 skinning and phalanges','Measured cape and skirt helper weights',*(['Localized fused-cloth seam separation and source-UV sampled inner lining; exact counts in blender-measurements.json']if c['cape']else[]),'Offline LOD collapse','Embedded texture resolution optimization'],'scope':'Model provenance only. Existing project animation source terms are retained separately.'},indent=2)+'\n')
 print(id,json.dumps({'triangles':triangles,'height':c['height'],'shoulder':measurements['shoulderWidthM'],'neck':measurements['neckLengthM'],'regions':region_counts,'bearing':bearing}))
