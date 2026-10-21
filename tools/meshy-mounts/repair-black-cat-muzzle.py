"""Local repair for the pinned Meshy Midnight Rider black-cat source.
Call repair_black_cat_muzzle(imported_object) before separating body and equipment.
No file inputs, file writes, operators on unrelated objects, or external dependencies.
A temporary repair_fur material marks generated faces for the caller's atlas pass.
"""
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon, delaunay_2d_cdt
from collections import defaultdict

def _pixels(image):
    array = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(array)
    return array.reshape(image.size[1], image.size[0], 4)

def _clean_root_maps(obj):
    images = {}
    for material in obj.data.materials:
        if not material or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or not node.image:
                continue
            name = node.image.name.lower()
            role = 'normal' if 'normal' in name else 'rough' if 'rough' in name else 'base'
            images.setdefault(role, node.image)
    if not all(role in images for role in ('base', 'normal', 'rough')):
        raise RuntimeError('The source must retain its base, tangent normal, and metallic-roughness maps.')
    mesh = obj.data
    vertices = np.array([v.co[:] for v in mesh.vertices])
    faces = np.array([p.vertices[:] for p in mesh.polygons])
    uvs = np.array([v.uv[:] for v in mesh.uv_layers.active.data]).reshape(-1, 3, 2)
    base = _pixels(images['base']).copy()
    candidates = []
    for i, face in enumerate(faces):
        p = vertices[face]
        if p[:, 1].min() < -.77 and p[:, 2].min() < .313 and p[:, 2].max() > .205 and np.abs(p[:, 0]).max() > .029:
            candidates.append(i)
    stats = {}
    for role in ('base', 'normal', 'rough'):
        image = images[role]
        array = _pixels(image).copy()
        height, width = array.shape[:2]
        changed = 0
        for i in candidates:
            triangle = uvs[i] * np.array([width, height]) - .5
            low = np.maximum(0, np.floor(triangle.min(0)).astype(int))
            high = np.minimum([width - 1, height - 1], np.ceil(triangle.max(0)).astype(int))
            if np.any(high < low):
                continue
            transform = np.stack([triangle[1] - triangle[0], triangle[2] - triangle[0]], axis=1)
            if abs(np.linalg.det(transform)) < 1e-10:
                continue
            xx, yy = np.meshgrid(np.arange(low[0], high[0]+1), np.arange(low[1], high[1]+1))
            xy = np.stack([xx, yy], axis=-1)
            bc = (xy - triangle[0]) @ np.linalg.inv(transform).T
            weights = np.stack([1-bc.sum(-1), bc[..., 0], bc[..., 1]], axis=-1)
            inside = (weights >= -.001).all(-1)
            xyz = weights @ vertices[faces[i]]
            region = inside & (np.abs(xyz[..., 0]) > .029) & (xyz[..., 1] < -.77) & (xyz[..., 2] > .205) & (xyz[..., 2] < .313)
            source = base[np.clip(((yy+.5)/height*base.shape[0]).astype(int), 0, base.shape[0]-1), np.clip(((xx+.5)/width*base.shape[1]).astype(int), 0, base.shape[1]-1), :3]
            mask = region & (source.max(-1) > 27/255)
            if not mask.any():
                continue
            block = array[low[1]:high[1]+1, low[0]:high[0]+1]
            if role == 'base':
                block[mask, :3] = [19/255, 19/255, 20/255]
            elif role == 'rough':
                block[mask, :3] = [1, .625, 0]
            else:
                valid = inside & (source.max(-1) <= 24/255)
                donors = np.argwhere(valid)
                targets = np.argwhere(mask)
                if len(donors):
                    # Bounded nearest-neighbor fill within this exact UV triangle.
                    # Staying inside the triangle preserves its tangent-space frame.
                    if len(donors) > 3000:
                        donors = donors[::int(np.ceil(len(donors)/3000))]
                    values = block[donors[:, 0], donors[:, 1], :3].copy()
                    for offset in range(0, len(targets), 128):
                        subset = targets[offset:offset+128]
                        distances = ((subset[:, None] - donors[None]) ** 2).sum(-1)
                        nearest = distances.argmin(1)
                        block[subset[:, 0], subset[:, 1], :3] = values[nearest]
            changed += int(mask.sum())
        image.pixels.foreach_set(array.ravel())
        image.update()
        image.pack()
        stats[role] = changed
    return images, stats

def repair_black_cat_muzzle(o):
    """Modify only source muzzle webs and return geometry/texture repair statistics."""
    if o.type != 'MESH' or len(o.data.polygons) != 10322:
        raise ValueError('Expected the original 10,322-triangle pinned black-cat source mesh.')
    images, texture_stats = _clean_root_maps(o)
    old = o.data
    pos=[tuple(v.co) for v in old.vertices];faces=[];uvs=[];ns=[];edges=defaultdict(list);edge_loops={};keys={};coords=[];discard=[];source_smooth=[]
    for i,p in enumerate(pos):
     k=tuple(round(v,6)for v in p)
     if k not in keys:keys[k]=len(coords);coords.append(i)
    old.calc_tangents();uv=old.uv_layers.active.data;im=images['normal'];nmap=np.array(im.pixels[:]).reshape(im.size[1],im.size[0],4);shading=defaultdict(lambda:Vector());patchnorm={}
    def shade(li):
     l=old.loops[li];u,v=uv[li].uv;xx=u*im.size[0]-.5;yy=v*im.size[1]-.5;ix=int(math.floor(xx));iy=int(math.floor(yy));tx=xx-ix;ty=yy-iy;rgb=((nmap[iy%im.size[1],ix%im.size[0],:3]*(1-tx)+nmap[iy%im.size[1],(ix+1)%im.size[0],:3]*tx)*(1-ty)+(nmap[(iy+1)%im.size[1],ix%im.size[0],:3]*(1-tx)+nmap[(iy+1)%im.size[1],(ix+1)%im.size[0],:3]*tx)*ty)*2-1;n=l.normal;t=l.tangent;b=n.cross(t)*l.bitangent_sign
     return (t*float(rgb[0])+b*float(rgb[1])+n*float(rgb[2])).normalized()
    def shade_edge(li0,li1,t):
     l0=old.loops[li0];l1=old.loops[li1];u,v=uv[li0].uv.lerp(uv[li1].uv,t);xx=u*im.size[0]-.5;yy=v*im.size[1]-.5;ix=int(math.floor(xx));iy=int(math.floor(yy));tx=xx-ix;ty=yy-iy
     rgb=((nmap[iy%im.size[1],ix%im.size[0],:3]*(1-tx)+nmap[iy%im.size[1],(ix+1)%im.size[0],:3]*tx)*(1-ty)+(nmap[(iy+1)%im.size[1],ix%im.size[0],:3]*(1-tx)+nmap[(iy+1)%im.size[1],(ix+1)%im.size[0],:3]*tx)*ty)*2-1
     n=l0.normal.lerp(l1.normal,t).normalized();tan=l0.tangent.lerp(l1.tangent,t).normalized();b=n.cross(tan)*l0.bitangent_sign
     return (tan*float(rgb[0])+b*float(rgb[1])+n*float(rgb[2])).normalized()
    badids=set()
    for pp in old.polygons:
     x,y,z=pp.center
     if abs(x)>.031 and y<-.78 and .19<z<.301 and pp.area<.00023:badids.add(pp.index)
    facekeys={p.index:[keys[tuple(round(v,6)for v in pos[q])]for q in p.vertices]for p in old.polygons}
    def local(q):
     x,y,z=pos[coords[q]]
     return abs(x)>.025 and y<-.77 and .18<z<.34
    for step in range(8):
     em=defaultdict(list);vf=defaultdict(set)
     for p in old.polygons:
      if p.index in badids:continue
      ff=facekeys[p.index]
      for q in ff:vf[q].add(p.index)
      for a,b in zip(ff,ff[1:]+ff[:1]):em[tuple(sorted((a,b)))].append(p.index)
     remove=set()
     for e,ps in em.items():
      if len(ps)>2 and all(local(q)for q in e):remove.update(sorted(ps,key=lambda i:old.polygons[i].area)[:len(ps)-2])
     if not remove:
      deg=defaultdict(int)
      for e,ps in em.items():
       if len(ps)==1:
        for q in e:deg[q]+=1
      for q,d in deg.items():
       if d!=2 and local(q):remove.update(vf[q])
     if not remove:break
     print('TOPOLOGY',step,'remove',len(remove));badids.update(remove)
    inc=defaultdict(set)
    for pp in old.polygons:
     if pp.index not in badids:
      for q in facekeys[pp.index]:inc[q].add(pp.index)
    seen=set();components=[]
    for pp in old.polygons:
     if pp.index in badids or pp.index in seen:continue
     todo=[pp.index];seen.add(pp.index);part=[]
     while todo:
      i=todo.pop();part.append(i)
      for q in facekeys[i]:
       for j in inc[q]:
        if j not in seen:seen.add(j);todo.append(j)
     components.append(part)
    for part in sorted(components,key=len,reverse=True)[1:]:
     if all(all(local(q)for q in facekeys[i])for i in part):badids.update(part);print('ISLAND',len(part))
    for p in old.polygons:
     x,y,z=p.center
     if p.index in badids:
      discard.append(p.index);continue
     for li in p.loop_indices:shading[keys[tuple(round(v,6)for v in pos[old.loops[li].vertex_index])]]+=shade(li)*p.area
     source_smooth.append(p.use_smooth);faces.append(list(p.vertices));uvs.append([tuple(uv[i].uv)for i in p.loop_indices]);ns.append([tuple(old.corner_normals[i].vector) for i in p.loop_indices])
     for j,(a,b) in enumerate(zip(p.vertices,list(p.vertices[1:])+[p.vertices[0]])):
      aa=keys[tuple(round(v,6)for v in pos[a])];bb=keys[tuple(round(v,6)for v in pos[b])];edges[tuple(sorted([aa,bb]))].append((aa,bb));edge_loops[tuple(sorted([aa,bb]))]=(aa,bb,p.loop_indices[j],p.loop_indices[(j+1)%3])
    patchnorm={coords[k]:v.normalized() for k,v in shading.items()};be=[e[0]for e in edges.values() if len(e)==1];print('BOUND',len(be),'discard',len(discard));startcount=len(faces);loops=[]
    while be:
     a,b=be.pop();loop=[a,b]
     while loop[-1]!=loop[0]:
      j=next((j for j,(a,b)in enumerate(be)if a==loop[-1]or b==loop[-1]),None)
      if j is None:break
      a,b=be.pop(j);loop.append(b if a==loop[-1]else a)
     if loop[-1]!=loop[0]:print('OPEN');continue
     loop=loop[:-1];vs=[Vector(pos[coords[i]])for i in loop];loops.append([list(v)for v in vs]);print('LOOP',len(loop),list(sum(vs,Vector())/len(vs)))
     ordered=vs
     triangles=[[coords[loop[v]] for v in tri]for tri in tessellate_polygon([ordered])]
     for iteration in range(3):
      mids={};next_tri=[]
      def mid(a,b):
       key=tuple(sorted([a,b]))
       if key not in mids:
        mids[key]=len(pos);patchnorm[len(pos)]=(patchnorm[a]+patchnorm[b]).normalized();pos.append(tuple((Vector(pos[a])+Vector(pos[b]))*.5))
       return mids[key]
      for a,b,c in triangles:
       ab=mid(a,b);bc=mid(b,c);ca=mid(c,a);next_tri.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
      triangles=next_tri
     edges2=defaultdict(int);adj=defaultdict(set)
     for fa in triangles:
      for a,b in zip(fa,fa[1:]+fa[:1]):edges2[tuple(sorted((a,b)))]+=1;adj[a].add(b);adj[b].add(a)
     fixed=set(v for e,c in edges2.items() if c==1 for v in e)
     free=set(v for t in triangles for v in t)-fixed
     for q in fixed:
      qq=Vector(pos[q]);samples=[]
      for a,b in zip(loop,loop[1:]+loop[:1]):
       aa,bb,li0,li1=edge_loops[tuple(sorted((a,b)))];pa=Vector(pos[coords[aa]]);pb=Vector(pos[coords[bb]]);e=pb-pa
       if e.length_squared<1e-16:continue
       t=(qq-pa).dot(e)/e.length_squared
       if -.00001<=t<=1.00001 and (qq-(pa+e*t)).length<1e-6:samples.append(shade_edge(li0,li1,max(0,min(1,t))))
      if samples:patchnorm[q]=sum(samples,Vector()).normalized()
     for iteration in range(120):
      nxt={i:sum((Vector(pos[j])for j in adj[i]),Vector())/len(adj[i]) for i in free}
      for i,v in nxt.items():pos[i]=tuple(Vector(pos[i])*.1+v*.9)
      nn={i:sum((patchnorm[j]for j in adj[i]),Vector()).normalized() for i in free}
      patchnorm.update(nn)
     for fa in triangles:
      a,b,c=[Vector(pos[q])for q in fa]
      if (b-a).cross(c-a).dot(sum((patchnorm[q]for q in fa),Vector()))<0:fa.reverse()
      faces.append(fa);uvs.append([(0,0)]*3);ns.append([(0,-1,0)]*3)
    m=bpy.data.meshes.new('repaired_source');m.from_pydata(pos,[],faces);m.update();o.data=m
    for ma in old.materials:m.materials.append(ma)
    ma=bpy.data.materials.new('repair_fur');ma.use_nodes=True;p=ma.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.0065,.0065,.0068,1);p.inputs['Roughness'].default_value=.625;m.materials.append(ma)
    u=m.uv_layers.new(name='UVMap');normals=[]
    for i,p in enumerate(m.polygons):
     p.use_smooth=source_smooth[i] if i<startcount else True;p.material_index=0 if i<startcount else 1
     for j,l in enumerate(p.loop_indices):u.data[l].uv=uvs[i][j];normals.append(ns[i][j])
    avg=defaultdict(lambda:Vector())
    for poly in m.polygons:
     for q in poly.vertices:avg[tuple(round(v,6)for v in m.vertices[q].co)]+=poly.normal*poly.area
    for poly in m.polygons:
     if poly.index>=startcount:
      for li in poly.loop_indices:
       q=m.loops[li].vertex_index;normals[li]=patchnorm[q]
    m.normals_split_custom_set(normals)
    topology_stats = _recap_patch_topology(o, startcount)
    return {
        'source_triangle_count': len(old.polygons),
        'removed_source_faces': sorted(badids),
        'retained_source_faces': [p.index for p in old.polygons if p.index not in badids],
        'first_patch_face': startcount,
        'patch_triangle_count': len(o.data.polygons)-startcount,
        'final_triangle_count': len(o.data.polygons),
        'cap_topology_retriangulation': topology_stats,
        'closed_muzzle_boundaries': len(loops),
        'texture_pixels_cleaned': texture_stats,
        'patch_material_name': ma.name,
        'source_geometry_preserved_outside_removed_faces': True,
    }


def _recap_patch_topology(o,cut):
 old=o.data;v=[tuple(q.co)for q in old.vertices];faces=[list(p.vertices)for p in old.polygons[:cut]];uv=[[tuple(old.uv_layers.active.data[li].uv)for li in p.loop_indices]for p in old.polygons[:cut]];normals=[[tuple(old.corner_normals[li].vector)for li in p.loop_indices]for p in old.polygons[:cut]]
 edge=defaultdict(list);inc=defaultdict(set);pn={}
 for p in old.polygons[cut:]:
  for li in p.loop_indices:pn[old.loops[li].vertex_index]=tuple(old.corner_normals[li].vector)
  for a,b in zip(p.vertices,list(p.vertices[1:])+[p.vertices[0]]):edge[tuple(sorted((a,b)))].append(p.index)
  for q in p.vertices:inc[q].add(p.index)
 seen=set();components=[]
 for p in old.polygons[cut:]:
  if p.index in seen:continue
  todo=[p.index];seen.add(p.index);part=[]
  while todo:
   i=todo.pop();part.append(i)
   for q in old.polygons[i].vertices:
    for j in inc[q]:
     if j not in seen:seen.add(j);todo.append(j)
  components.append(part)
 info=[]
 for part in components:
  ids=sorted({q for i in part for q in old.polygons[i].vertices});qmap={q:i for i,q in enumerate(ids)};pts=np.array([v[i]for i in ids]);mean=pts.mean(0);_,_,axes=np.linalg.svd(pts-mean);xy=(pts-mean)@axes[:2].T
  be=[e for e,fs in edge.items() if len(fs)==1 and fs[0]in part];adj=defaultdict(list)
  for a,b in be:adj[a].append(b);adj[b].append(a)
  first=be[0][0];loop=[first];prev=None;here=first
  while True:
   nxt=next(q for q in adj[here]if q!=prev)
   if nxt==first:break
   loop.append(nxt);prev,here=here,nxt
  domain=[qmap[q]for q in loop];poly=xy[domain];area=np.cross(poly,np.roll(poly,-1,axis=0)).sum()
  if area<0:domain.reverse()
  result=delaunay_2d_cdt([Vector(p)for p in xy],[],[domain],1,1e-9,True)
  vc,ed,fa,origin,_,faceorig=result
  mapping=[]
  for k,orig in enumerate(origin):
   if not orig:raise RuntimeError('Unexpected new crossing vertex')
   mapping.append(ids[orig[0]])
  tris=[[mapping[i]for i in t]for t,orig in zip(fa,faceorig) if 0 in orig]
  orient=sum(np.cross(np.array(v[b])-v[a],np.array(v[c])-v[a]).dot(np.array(pn[a])+pn[b]+pn[c])for a,b,c in tris)
  if orient<0:tris=[list(reversed(t))for t in tris]
  for t in tris:faces.append(t);uv.append([(0,0)]*3);normals.append([pn[q]for q in t])
  info.append({'before':len(part),'after':len(tris),'vertices':len(ids),'used_vertices':len(set(q for t in tris for q in t))})
 m=bpy.data.meshes.new('topology_recap');m.from_pydata(v,[],faces);m.update();o.data=m
 for ma in old.materials:m.materials.append(ma)
 u=m.uv_layers.new(name='UVMap');nn=[]
 for i,p in enumerate(m.polygons):
  p.material_index=0 if i<cut else 1;p.use_smooth=old.polygons[i].use_smooth if i<cut else True
  for j,li in enumerate(p.loop_indices):u.data[li].uv=uv[i][j];nn.append(normals[i][j])
 m.normals_split_custom_set(nn)
 return info
