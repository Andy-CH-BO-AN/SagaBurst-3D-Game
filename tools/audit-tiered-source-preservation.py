"""Compare original surface/body skin with the hand-refined pre-LOD build.
Run after builder; no exported artifact mutation. New hand vertices are allowed,
never a replacement body mesh. Reports are consumed by the JS structural audit.
"""
import bpy, json, sys, hashlib
from pathlib import Path
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
root = Path.cwd()
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
source_root=Path(args[0]).resolve() if args else root/'output/tiered-sources'
def key(p): return tuple(round(float(x), 6) for x in p)
def weights(obj, vertex, aliases=None):
    return {(aliases or {}).get(obj.vertex_groups[g.group].name, obj.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
def hand(w): return max(w.get('hand_l',0),w.get('hand_r',0))
def face_signature(points, uvs):
    # Cyclic orientation/order is irrelevant; exact corner position+UV is not.
    return tuple(sorted((key(p),tuple(round(float(x),6)for x in uv))for p,uv in zip(points,uvs)))
for id in ['roman-t1','roman-t2','viking-t1','viking-t2']:
    d=root/'public/models/characters/v2'/id
    info=json.loads((d/'blender-measurements.json').read_text());aliases=json.loads((d/'bone-map.json').read_text())['sourceToProject']
    sources=list((source_root/id).rglob('*.fbx'))
    assert len(sources)==1,('Expected one original FBX',id,sources)
    assert hashlib.sha256(sources[0].read_bytes()).hexdigest()==info['sourceSha256'],('Source hash mismatch',id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(sources[0]))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    for item in bpy.context.scene.objects:item.animation_data_clear()
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    rig.data.pose_position='REST';bpy.context.view_layer.update()
    obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    matrix=Matrix.Scale(info['normalization']['uniformScale'],4)@Matrix.Translation((0,0,-info['normalization']['sourceGround']))@obj.matrix_world
    source=[(matrix@v.co,weights(obj,v,aliases))for v in obj.data.vertices]
    by_position={}
    for p,w in source:by_position.setdefault(key(p),[]).append((p,w))
    tree=KDTree(len(source))
    for i,(p,w)in enumerate(source):tree.insert(p,i)
    tree.balance()
    polygons=[tuple(p.vertices)for p in obj.data.polygons]
    affected=[];body_faces=[]
    for polygon in obj.data.polygons:
        indices=list(polygon.vertices)
        edited=any(hand(source[a][1])>.95 and hand(source[b][1])>.95 for a,b in zip(indices,indices[1:]+indices[:1]))
        affected.append(edited)
        if not edited:body_faces.append(face_signature([source[i][0]for i in indices],[obj.data.uv_layers.active.data[l].uv for l in polygon.loop_indices]))
    surface=BVHTree.FromPolygons([p for p,w in source],polygons,all_triangles=False)
    bpy.ops.wm.open_mainfile(filepath=str(root/'output/tiered-sources'/id/'finger-rig.blend'))
    obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    found=set();unchanged=changed=inserted=0;maxpos=0;max_surface=0
    for v in obj.data.vertices:
        nearest,index,distance=tree.find(v.co)
        candidates=by_position[key(source[index][0])] if distance<1e-6 else []
        current=weights(obj,v)
        if candidates:
            p,original=min(candidates,key=lambda pw:(v.co-pw[0]).length)
            found.add(key(p));maxpos=max(maxpos,(v.co-p).length)
            diff=min(max([abs(current.get(n,0)-w.get(n,0))for n in set(current)|set(w)]or[0])for _,w in candidates)
            if diff<1e-7:unchanged+=1
            else:
                assert any(hand(w)>=.45 for _,w in candidates),('Body weight changed',id,tuple(v.co))
                changed+=1
        else:
            nearest,normal,face,distance=surface.find_nearest(v.co)
            assert distance<1e-6 and affected[face],('New vertex outside refined source hand surface',id,tuple(v.co),distance,face)
            max_surface=max(max_surface,distance);inserted+=1
    assert found==set(by_position),('Original source vertex removed/moved',id,len(found),len(by_position))
    def canonical(p):
        nearest,index,distance=tree.find(p)
        return source[index][0] if distance<1e-6 else p
    actual_faces={face_signature([canonical(obj.data.vertices[i].co) for i in p.vertices],[obj.data.uv_layers.active.data[l].uv for l in p.loop_indices])for p in obj.data.polygons}
    assert all(f in actual_faces for f in body_faces),('Non-hand topology/UV changed',id)
    report={'sourceFbxSha256':info['sourceSha256'],'sourceVertexCount':len(source),'retainedOriginalVertexPositions':True,'unchangedNonHandTopologyAndUvs':True,'normalizedPositionMaxDifferenceM':maxpos,'unchangedWeightVertices':unchanged,'changedHandWeightVertices':changed,'insertedHandSurfaceVertices':inserted,'newVertexSourceSurfaceMaxDistanceM':max_surface,'changedOutsideSourceHandOwnership':0,'method':'Coordinate-matched original source versus pre-LOD finger rig. Every original position retained. Weight edits restricted to original hand>=0.45 vertices. New vertices confined to original faces with hand-owned subdivision edges; all unaffected face topology/UV corners retained.'}
    (root/'output/tiered-sources'/id/'source-preservation-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(id,report)
