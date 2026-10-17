"""Restore only the hidden fur of the hash-pinned Meshy Saddled Corgi.

Blender: restore_corgi_fur(visible_source_body, original_equipment, output_dir)
returns one complete equipment-off object. Original exposed faces, positions,
UVs, material and split normals are copied without modification. The concealed
patch uses a boundary-constrained fair surface, removes folded tack topology,
then overlaps 0.25 mm below original fur with matching corner normals.

The external --solve process needs NumPy and SciPy (normal system Python).
No bpy dependencies are imported by that process. The reconstructed color
field is baked into the existing reserved right-hand atlas strip. Runtime
remains one material and one SkinnedMesh for the off copy.

Call once after the builder creates its fresh source-fur atlas reservation.
The helper reads that source detail before replacing the reservation; do not
call it twice against an already-restored atlas. Every NPZ input is generated
from the passed source objects in the same call. No staging asset is required.
Geometry operators were validated with Blender 4.3.2; use the same Blender
version when reproducing the accepted topology.
"""
from pathlib import Path
import sys, math, json, os
SECTIONS=[(-1.8,.65,.14,.20),(-1.5,.80,.25,.33),(-1.2,.84,.31,.36),(-.6,.84,.32,.35),(0,.86,.32,.36),(.45,.94,.28,.37),(.78,1.22,.25,.30)]

def _solve(src,target):
    # Avoid unrelated inspect.py in a staging directory shadowing Python stdlib.
    sys.path=[p for p in sys.path if Path(p or '.').resolve()!=Path(__file__).resolve().parent]
    import numpy as np
    from scipy.sparse import coo_matrix,diags
    from scipy.sparse.linalg import spsolve
    from scipy.interpolate import griddata
    from scipy.ndimage import gaussian_filter
    with np.load(src) as j:
        v=j['coords'];e=j['edges'];c=j['colors'];fixed=j['fixed']
    n=len(v)
    a,b=e.T;A=coo_matrix((np.ones(len(a)*2),(np.r_[a,b],np.r_[b,a])),shape=(n,n)).tocsr()
    L=diags(1/A.sum(1).A.ravel())@A-diags(np.ones(n));H=L.T@L
    isfix=np.zeros(n,bool);isfix[fixed]=True;u=np.flatnonzero(~isfix)
    sec=np.array(SECTIONS);z=-v[:,1];cy,rx,ry=[np.interp(z,sec[:,0],sec[:,i])for i in [1,2,3]]
    th=np.arctan2(v[:,0]/rx,(v[:,2]-cy)/ry);prior=np.c_[np.sin(th)*rx,v[:,1],cy+np.cos(th)*ry]
    fair=v.copy();strength=.001
    fair[u]=spsolve(H[u][:,u]+diags(np.full(len(u),strength)), -H[u][:,fixed]@v[fixed]+strength*prior[u])
    f=np.flatnonzero(np.isfinite(c[:,0]));u=np.flatnonzero(~np.isfinite(c[:,0]));L=diags(A.sum(1).A.ravel())-A
    c[u]=spsolve(L[u][:,u],-L[u][:,f]@c[f]);c=np.clip(c,0,1)
    z=-fair[:,1];cy,rx,ry=[np.interp(z,sec[:,0],sec[:,i])for i in [1,2,3]]
    th=np.arctan2(fair[:,0]/rx,(fair[:,2]-cy)/ry)
    uv=np.c_[(fair[:,1]+1.5)/3.5,(th+np.pi)/(2*np.pi)]
    good=(fair[:,2]>.35)&(fair[:,2]<1.55)&(fair[:,1]>-.95);uv=uv[good];c=c[good]
    uv=np.r_[uv,uv+[0,-1],uv+[0,1]];c=np.r_[c,c,c]
    yy,xx=np.mgrid[0:512,0:1024];points=np.c_[xx.ravel()/1023,yy.ravel()/511]
    tex=griddata(uv,c,points,method='linear');bad=~np.isfinite(tex[:,0])
    tex[bad]=griddata(uv,c,points[bad],method='nearest')
    tex=gaussian_filter(tex.reshape(512,1024,3),sigma=(3,3,0))
    np.savez(target,coords=fair,texture=tex)

def restore_corgi_fur(visible_body,equipment,out,python=None):
    import bpy,bmesh,numpy as np,subprocess
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    out=Path(out).resolve();out.mkdir(parents=True,exist_ok=True)
    temporary_mesh_names=[]
    def active(o):
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    def clone(o,name):
        q=o.copy();q.data=o.data.copy();q.name=name;bpy.context.collection.objects.link(q)
        temporary_mesh_names.append(q.data.name)
        for m in list(q.modifiers):q.modifiers.remove(m)
        for g in list(q.vertex_groups):q.vertex_groups.remove(g)
        q.parent=None;q.hide_render=True
        return q
    def smooth(a,b,x):
        t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
    # Combine the original source without introducing a new surface yet.
    whole=clone(equipment,'corgi_fair_source');whole.data.materials.clear()
    original_mat=visible_body.data.materials[0];whole.data.materials.append(original_mat);marker=original_mat.copy();whole.data.materials.append(marker)
    for p in whole.data.polygons:p.material_index=1
    copy=clone(visible_body,'corgi_fur_constraint');copy.data.materials.clear();copy.data.materials.append(original_mat)
    for p in copy.data.polygons:p.material_index=0
    active(whole);copy.select_set(True);bpy.ops.object.join()
    bm=bmesh.new();bm.from_mesh(whole.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-5)
    bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table();bm.edges.ensure_lookup_table()
    fixed=np.array(sorted({v.index for f in bm.faces if f.material_index==0 for v in f.verts}))
    coords=np.array([v.co[:]for v in bm.verts]);edges=np.array([[v.index for v in e.verts]for e in bm.edges])
    bm.to_mesh(whole.data);bm.free();whole.data.update()
    base=next(n.image for n in original_mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'metallic' not in n.image.name and 'normal' not in n.image.name)
    pix=np.asarray(base.pixels[:],dtype=np.float32).reshape(base.size[1],base.size[0],4)
    samples=[[]for _ in whole.data.vertices];uv=whole.data.uv_layers.active.data
    for p in whole.data.polygons:
        if p.material_index!=0:continue
        center=np.mean([uv[i].uv[:]for i in p.loop_indices],axis=0)
        for li in p.loop_indices:
            u,v=.75*np.array(uv[li].uv[:])+.25*center
            color=pix[min(base.size[1]-1,int(v*base.size[1])),min(base.size[0]-1,int(u*base.size[0])),:3]
            if min(color)>.18 and max(color)>.55:samples[whole.data.loops[li].vertex_index].append(color)
    colors=np.array([np.mean(a,axis=0)if a else [np.nan]*3 for a in samples])
    src=out/'corgi-concealed-fair-input.npz';dst=out/'corgi-concealed-fair-result.npz'
    np.savez(src,coords=coords,edges=edges,fixed=fixed,colors=colors)
    subprocess.run([python or os.environ.get('MESHY_PATCH_PYTHON','python'),str(Path(__file__).resolve()),'--solve',str(src),str(dst)],check=True)
    with np.load(dst) as solved:
        solved_coords=solved['coords'];solved_texture=solved['texture']
    for v,co in zip(whole.data.vertices,solved_coords):v.co=co
    whole.data.update()
    # A guide, not the final visible body: erase fused tack handles and folds.
    patch=clone(whole,'corgi_concealed_patch');active(patch)
    m=patch.modifiers.new('Reconstruct concealed surface','REMESH');m.mode='VOXEL';m.voxel_size=.008;m.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=m.name)
    g=patch.vertex_groups.new(name='Concealed guide fairing')
    for v in patch.data.vertices:
        x,y,z=v.co;w=smooth(-1,-.65,y)*(1-smooth(1.50,1.70,y))*smooth(.25,.55,z)*(1-smooth(1.3,1.7,z))
        if w:g.add([v.index],w,'REPLACE')
    m=patch.modifiers.new('Fair concealed guide','SMOOTH');m.factor=1;m.iterations=110;m.vertex_group=g.name;bpy.ops.object.modifier_apply(modifier=m.name)
    m=patch.modifiers.new('Concealed patch tessellation','DECIMATE');m.ratio=.08;bpy.ops.object.modifier_apply(modifier=m.name)
    bv=BVHTree.FromPolygons([v.co for v in whole.data.vertices],[p.vertices for p in whole.data.polygons])
    fur=BVHTree.FromPolygons([v.co for v in visible_body.data.vertices],[p.vertices for p in visible_body.data.polygons])
    keep=set()
    for p in patch.data.polygons:
        hit=bv.find_nearest(p.center);fh=fur.find_nearest(p.center)
        if whole.data.polygons[hit[2]].material_index==1 or fh[3]>.025:keep.add(p.index)
    edgefaces={}
    for p in patch.data.polygons:
        for e in p.edge_keys:edgefaces.setdefault(tuple(sorted(e)),[]).append(p.index)
    for _ in range(2):
        old=set(keep)
        for fs in edgefaces.values():
            if any(i in old for i in fs):keep.update(fs)
    for v in patch.data.vertices:
        hit=fur.find_nearest(v.co);d=hit[3]
        if d<.09:
            t=smooth(.02,.09,d);v.co=v.co*t+(hit[0]-hit[1]*.00025)*(1-t)
    bm=bmesh.new();bm.from_mesh(patch.data);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.index not in keep],context='FACES');bm.to_mesh(patch.data);bm.free();patch.data.update()
    # Source pigmentation is smoothly extended; original skin retains its atlas.
    tex=solved_texture;h,w=tex.shape[:2];canvas=np.ones((h,w,4),np.float32);canvas[:,:,:3]=tex
    x=round(base.size[0]*15/16)+1;detail=pix[:40,x:x+62,:3].mean(2);detail/=max(float(detail.mean()),1e-6)
    yy,xx=np.indices((h,w));canvas[:,:,:3]*=(1+.65*(detail[yy%40,xx%62]-1))[:,:,None]
    # Reuse the reserved right atlas strip. Transpose the color field so its
    # long body axis has full atlas height; radial color is smooth enough for
    # the 128-pixel strip. Source UVs stay entirely left of this reservation.
    size_x,size_y=base.size[:];x0=round(size_x*15/16);margin_x=2;margin_y=1
    tw=size_x-x0-2*margin_x;tile_h=size_y-2*margin_y
    tx=np.linspace(0,canvas.shape[0]-1,tw);ty=np.linspace(0,canvas.shape[1]-1,tile_h)
    xa=np.floor(tx).astype(int);xb=np.minimum(xa+1,canvas.shape[0]-1);xf=tx-xa
    middle=canvas[xa]*(1-xf[:,None,None])+canvas[xb]*xf[:,None,None]
    ya=np.floor(ty).astype(int);yb=np.minimum(ya+1,canvas.shape[1]-1);yf=ty-ya
    resized=(middle[:,ya]*(1-yf[None,:,None])+middle[:,yb]*yf[None,:,None]).transpose(1,0,2)
    atlas=pix.copy();atlas[margin_y:size_y-margin_y,x0+margin_x:size_x-margin_x]=resized
    atlas[:margin_y,x0:]=atlas[margin_y:margin_y+1,x0:]
    atlas[size_y-margin_y:,x0:]=atlas[size_y-margin_y-1:size_y-margin_y,x0:]
    atlas[:,x0:x0+margin_x]=atlas[:,x0+margin_x:x0+margin_x+1]
    atlas[:,size_x-margin_x:]=atlas[:,size_x-margin_x-1:size_x-margin_x]
    base.pixels.foreach_set(np.clip(atlas,0,1).ravel());base.update();base.pack()
    for node in original_mat.node_tree.nodes:
        if node.type!='TEX_IMAGE' or not node.image or node.image==base:continue
        image=node.image;w2,h2=image.size[:];arr=np.asarray(image.pixels[:],dtype=np.float32).reshape(h2,w2,4);start=round(w2*15/16)
        if 'normal' in image.name:arr[:,start:,:3]=[.5,.5,1]
        elif 'metallic' in image.name:arr[:,start:,:3]=[0,.86,0]
        else:continue
        image.pixels.foreach_set(arr.ravel());image.update();image.pack()
    patch.data.materials.clear();patch.data.materials.append(original_mat)
    if not patch.data.uv_layers:patch.data.uv_layers.new(name='UVMap')
    uv=patch.data.uv_layers.active.data;sec=np.array(SECTIONS)
    for p in patch.data.polygons:
        p.material_index=0;p.use_smooth=True;values=[]
        for li in p.loop_indices:
            co=patch.data.vertices[patch.data.loops[li].vertex_index].co;z=-co.y
            cy,rx,ry=[np.interp(z,sec[:,0],sec[:,i])for i in [1,2,3]];th=math.atan2(co.x/rx,(co.z-cy)/ry)
            values.append(((co.y+1.5)/3.5,(th+math.pi)/(2*math.pi)))
        if max(v[1]for v in values)-min(v[1]for v in values)>.5:values=[(u,t+1 if t<.5 else t)for u,t in values]
        for li,(longitudinal,radial) in zip(p.loop_indices,values):
            uv[li].uv=((x0+margin_x+max(0,min(1,radial))*(tw-1))/size_x,(margin_y+longitudinal*(tile_h-1))/size_y)
    patch.data.update();normals=[]
    for li,l in enumerate(patch.data.loops):
        co=patch.data.vertices[l.vertex_index].co;hit=fur.find_nearest(co);old=patch.data.corner_normals[li].vector.copy();d=hit[3]
        if d<.09:
            p=visible_body.data.polygons[hit[2]];vs=[visible_body.data.vertices[i].co for i in p.vertices];ns=[visible_body.data.corner_normals[i].vector for i in p.loop_indices]
            n=barycentric_transform(hit[0],*vs,*ns);n.normalize();t=smooth(.01,.09,d);old=old*t+n*(1-t);old.normalize()
        normals.append(old)
    patch.data.normals_split_custom_set(normals)
    patch_faces=len(patch.data.polygons)
    # Only this copy is combined: equipped source objects are never altered.
    original_copy=clone(visible_body,'corgi_off_original_fur');active(patch);original_copy.select_set(True);bpy.ops.object.join()
    patch.name='corgi_unarmored_lod0';patch.hide_render=False;patch['replacesEquippedBody']=True
    for g in list(patch.vertex_groups):patch.vertex_groups.remove(g)
    bpy.data.objects.remove(whole,do_unlink=True)
    # Join/remesh may leave zero-user copies. Clean only IDs created here,
    # never the caller's source meshes, images or shared material.
    for name in dict.fromkeys(temporary_mesh_names):
        mesh=bpy.data.meshes.get(name)
        if mesh is not None and mesh.users==0:bpy.data.meshes.remove(mesh)
    if marker.users==0:bpy.data.materials.remove(marker)
    report={'method':'source-constrained fair guide; concealed patch only','retainedOriginalFaces':len(visible_body.data.polygons),'concealedPatchFaces':patch_faces,'originalVertexDisplacement':0,'boundaryUnderlapMetres':.00025,'materials':len(patch.data.materials),'texture':[w,h]}
    (out/'corgi-concealed-patch-report.json').write_text(json.dumps(report,indent=2))
    return patch

if __name__=='__main__' and '--solve' in sys.argv:
    i=sys.argv.index('--solve');_solve(sys.argv[i+1],sys.argv[i+2])
