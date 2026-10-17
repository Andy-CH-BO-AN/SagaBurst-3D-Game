"""Source-space unarmored repair. Import and call build_unarmored(source_object)."""
import bpy, math, bmesh, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
from collections import defaultdict
from pathlib import Path

def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def sample_colors(src):
 mat=src.data.materials[0];node=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'normal' not in n.image.name and 'metallic' not in n.image.name)
 im=node.image;a=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4);uv=src.data.uv_layers.active.data;cols=[]
 for p in src.data.polygons:
  u,v=np.mean([uv[l].uv[:]for l in p.loop_indices],axis=0);cols.append(a[min(max(int(v*im.size[1]),0),im.size[1]-1),min(max(int(u*im.size[0]),0),im.size[0]-1),:3])
 return cols

def effective_fur_normals(src):
 """Fold the source tangent normal map into graft corner normals only."""
 me=src.data;me.calc_tangents(uvmap=me.uv_layers.active.name)
 im=next(n.image for n in me.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'normal' in n.image.name.lower())
 pixels=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4);W,H=im.size;result={}
 for li,loop in enumerate(me.loops):
  u,v=me.uv_layers.active.data[li].uv;x=u*W-.5;y=v*H-.5;ix=math.floor(x);iy=math.floor(y);fx=x-ix;fy=y-iy
  rgb=(pixels[iy%H,ix%W,:3]*(1-fx)+pixels[iy%H,(ix+1)%W,:3]*fx)*(1-fy)+(pixels[(iy+1)%H,ix%W,:3]*(1-fx)+pixels[(iy+1)%H,(ix+1)%W,:3]*fx)*fy
  mapped=Vector(tuple(float(q*2-1)for q in rgb)).normalized();n=me.corner_normals[li].vector.copy();t=loop.tangent.copy();b=n.cross(t)*loop.bitangent_sign
  result[li]=(t*mapped.x+b*mapped.y+n*mapped.z).normalized()
 return result

def classify_gear(src):
 """Return one bool per current source polygon; no fixed polygon IDs.

 This includes the covered torso surface, so equipped/off rendering uses the
 complete replacement body as intended. Original exposed limbs remain body.
 """
 result=[]
 for p,rgb in zip(src.data.polygons,sample_colors(src)):
  x,y,z=p.center
  core= -.44<y<.28 and z>-.15
  gear=(((-.84<y and z<.20) or -.78<y) and y<.38 and -.27<z<.34 and max(rgb)>.112) or core
  result.append(bool(gear))
 return result

def build_unarmored(src, gear_mask=None):
 """Return a complete source-space mesh; leave src untouched and unrigged.

 The temporary repair_fur material is ready for the shared fur atlas strip.
 Exact source triangles/UV/corner normals remain outside the local graft band.
 """
 me=src.data;effective=effective_fur_normals(src);gear_mask=classify_gear(src) if gear_mask is None else gear_mask
 assert len(gear_mask)==len(me.polygons)
 pts=[tuple(v.co)for v in me.vertices];faces=[];uvs=[];norms=[];srcids=[]
 for p,gear in zip(me.polygons,gear_mask):
  if gear:continue
  faces.append(list(p.vertices));srcids.append(p.index);uvs.append([tuple(me.uv_layers.active.data[l].uv)for l in p.loop_indices]);norms.append([tuple(me.corner_normals[l].vector)for l in p.loop_indices])
 mat=bpy.data.materials.get('repair_fur')or bpy.data.materials.new('repair_fur');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.00657,.00657,.00695,1);p.inputs['Roughness'].default_value=.65
 m=bpy.data.meshes.new('preserved_source_fur');m.from_pydata(pts,[],faces);m.update();o=bpy.data.objects.new('cat_unarmored_source',m);bpy.context.collection.objects.link(o)
 for ma in me.materials:m.materials.append(ma)
 m.materials.append(mat);mi=len(m.materials)-1;layer=m.uv_layers.new(name='UVMap');normsflat=[]
 for i,p in enumerate(m.polygons):
  p.use_smooth=me.polygons[srcids[i]].use_smooth;p.material_index=me.polygons[srcids[i]].material_index
  for j,l in enumerate(p.loop_indices):layer.data[l].uv=uvs[i][j];normsflat.append(norms[i][j])
 m.normals_split_custom_set(normsflat)
 # One anatomical loft, no independent shoulder or haunch volumes.
 sections=[(-.81,.02,.270,.02),(-.77,.075,.255,.085),(-.71,.115,.170,.190),(-.63,.140,.130,.215),(-.53,.153,.085,.225),(-.43,.159,.062,.207),(-.27,.159,.066,.196),(-.06,.157,.074,.188),(.13,.155,.084,.189),(.25,.142,.091,.191),(.33,.110,.125,.143),(.39,.065,.155,.082),(.43,.020,.155,.025)]
 # Catmull Rom with uniform Y samples and smooth section interpolation.
 def sec(y):
  k=next((i for i in range(len(sections)-1)if sections[i][0]<=y<=sections[i+1][0]),len(sections)-2);a=sections[max(k-1,0)];b=sections[k];c=sections[k+1];d=sections[min(k+2,len(sections)-1)];t=(y-b[0])/(c[0]-b[0]);return [y]+[.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t)for j in range(1,4)]
 pnts=[];fs=[];N=80;S=64
 for i in range(N):
  y=sections[0][0]+(sections[-1][0]-sections[0][0])*i/(N-1);y,rx,cz,rz=sec(y)
  for j in range(S):
   a=2*math.pi*j/S;pnts.append((rx*math.cos(a),y,cz+rz*math.sin(a)))
 for i in range(N-1):
  for j in range(S):a=i*S+j;b=i*S+(j+1)%S;fs.append((a,a+S,b+S,b))
 pnts.append((0,sections[0][0],sections[0][2]));pnts.append((0,sections[-1][0],sections[-1][2]))
 for j in range(S):fs.append((N*S,(j+1)%S,j));fs.append((N*S+1,(N-1)*S+j,(N-1)*S+(j+1)%S))
 coreme=bpy.data.meshes.new('continuous_anatomical_core');coreme.from_pydata(pnts,[],fs);coreme.update();core=bpy.data.objects.new('continuous_anatomical_core',coreme);bpy.context.collection.objects.link(core);coreme.materials.append(mat)
 for p in coreme.polygons:p.use_smooth=True
 coreme.uv_layers.new(name='UVMap')
 # Orient outward.
 bm=bmesh.new();bm.from_mesh(coreme);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(coreme);bm.free()
 surface=BVHTree.FromPolygons([v.co for v in coreme.vertices],[list(p.vertices)for p in coreme.polygons]);edgecount=defaultdict(int);key=lambda v:tuple(round(float(x),6)for x in v)
 for poly in m.polygons:
  for a,b in zip(poly.vertices,list(poly.vertices[1:])+[poly.vertices[0]]):edgecount[tuple(sorted([key(m.vertices[a].co),key(m.vertices[b].co)]))]+=1
 boundary={p for e,n in edgecount.items()if n==1 for p in e if p[1]>-.78 and p[2]<.35};kd=KDTree(len(boundary))
 for i,p in enumerate(boundary):kd.insert(Vector(p),i)
 kd.balance();changed={}
 for v in m.vertices:
  if v.co.y<-.78 or v.co.z>.35:continue
  co,n,idx,dist=surface.find_nearest(v.co)
  _,_,bd=kd.find(v.co)
  if bd<.07 and dist<.15:
   w=1-min(bd/.07,1);w=w*w*(3-2*w);v.co=v.co.lerp(co-n*.003,w);changed[v.index]=(w,n)
 # Bake source normal-map shading into the neutral graft vertices, then
 # blend only the deformed edge toward the reconstructed core normal.
 for p in m.polygons:
  repaired=any(changed.get(v,(0,None))[0]>.01 for v in p.vertices)
  if repaired:p.material_index=mi;p.use_smooth=True
  for j,li in enumerate(p.loop_indices):
   vi=m.loops[li].vertex_index
   if repaired:
    sn=effective[me.polygons[srcids[p.index]].loop_indices[j]];w,n=changed.get(vi,(0,sn));normsflat[li]=sn.lerp(n,w).normalized()
 m.normals_split_custom_set(normsflat)
 # Join the core without altering the preserved source triangle topology.
 activate(o);core.select_set(True);bpy.ops.object.join()
 # Compact loose source vertices without welding or changing loop normals.
 keep=o.data;used=sorted({v for p in keep.polygons for v in p.vertices});remap={old:i for i,old in enumerate(used)}
 newpts=[tuple(keep.vertices[v].co)for v in used];newfaces=[[remap[v]for v in p.vertices]for p in keep.polygons]
 newuvs=[[tuple(keep.uv_layers.active.data[l].uv)for l in p.loop_indices]for p in keep.polygons]
 newmats=[p.material_index for p in keep.polygons];smoothflags=[p.use_smooth for p in keep.polygons]
 newnorms=[[tuple(keep.corner_normals[l].vector)for l in p.loop_indices]for p in keep.polygons]
 out=bpy.data.meshes.new('unarmored_preserved_head');out.from_pydata(newpts,[],newfaces);out.update()
 for ma in keep.materials:out.materials.append(ma)
 layer=out.uv_layers.new(name='UVMap');nn=[]
 for i,p in enumerate(out.polygons):
  p.use_smooth=smoothflags[i];p.material_index=newmats[i]
  for j,l in enumerate(p.loop_indices):
   layer.data[l].uv=newuvs[i][j];nn.append(newnorms[i][j])
 out.normals_split_custom_set(nn);o.data=out
 o.name='cat_unarmored_lod0';o['replacesEquippedBody']=True;return o
