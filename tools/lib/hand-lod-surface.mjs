import * as T from 'three'

/** Retain the authored LOD0 hand topology in lower LODs. Only the distal
 * hand region is replaced; source UVs/weights and all body faces survive. */
export function preserveHandLodSurface(source, target) {
 const first=rig=>{let result;rig.scene.traverse(o=>{if(o.isSkinnedMesh)result??=o});return result}
 source.scene.updateMatrixWorld(true);target.scene.updateMatrixWorld(true)
 const a=first(source),b=first(target),g=b.geometry,s=a.geometry,keep=[],add=[],report=[]
 const selected=(mesh,side)=>{
  const geometry=mesh.geometry,h=mesh.skeleton.bones.find(b=>b.name===`hand_${side}`),point=new T.Vector3(),faces=[]
  const owned=i=>{let sum=0;for(let k=0;k<4;k++){
   const name=mesh.skeleton.bones[geometry.attributes.skinIndex.getComponent(i,k)].name
   if(name===h.name||/^(thumb|index|middle|ring|pinky)_/.test(name)&&name.endsWith(`_${side}`))sum+=geometry.attributes.skinWeight.getComponent(i,k)
  }return sum}
  for(let i=0;i<geometry.index.count;i+=3){const f=[0,1,2].map(j=>geometry.index.getX(i+j));let along=0
   for(const v of f)along+=h.worldToLocal(mesh.localToWorld(point.fromBufferAttribute(geometry.attributes.position,v))).y/3
   if(along>.025&&f.reduce((sum,v)=>sum+owned(v)/3,0)>.5)faces.push(i)
  }
  return faces
 }
 const removed=new Set()
 for(const side of ['l','r']){
  const old=selected(b,side),next=selected(a,side);old.forEach(i=>removed.add(i));add.push(...next)
  report.push({side,removedTriangles:old.length,newHandTriangles:next.length,source:'Original LOD0 hand topology/UV/weights'})
 }
 for(let i=0;i<g.index.count;i+=3)if(!removed.has(i))keep.push(g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2))
 const arrays=Object.fromEntries(['position','normal','uv','skinIndex','skinWeight'].map(key=>[key,Array.from(g.attributes[key].array)])),mapping=new Map(),conversion=b.matrixWorld.clone().invert().multiply(a.matrixWorld)
 for(const index of add)for(let j=0;j<3;j++){
  const old=s.index.getX(index+j)
  if(!mapping.has(old)){
   const id=arrays.position.length/3;mapping.set(old,id)
   arrays.position.push(...new T.Vector3().fromBufferAttribute(s.attributes.position,old).applyMatrix4(conversion).toArray())
   arrays.normal.push(...new T.Vector3().fromBufferAttribute(s.attributes.normal,old).transformDirection(conversion).toArray())
   arrays.uv.push(s.attributes.uv.getX(old),s.attributes.uv.getY(old))
   for(let k=0;k<4;k++){
    const name=a.skeleton.bones[s.attributes.skinIndex.getComponent(old,k)].name,i=b.skeleton.bones.findIndex(b=>b.name===name)
    if(i<0)throw Error(`Missing LOD joint ${name}`)
    arrays.skinIndex.push(i);arrays.skinWeight.push(s.attributes.skinWeight.getComponent(old,k))
   }
  }
  keep.push(mapping.get(old))
 }
 const geometry=new T.BufferGeometry()
 for(const [key,values]of Object.entries(arrays))geometry.setAttribute(key,new T.BufferAttribute(key==='skinIndex'?new Uint16Array(values):new Float32Array(values),key==='uv'?2:key.startsWith('skin')?4:3))
 geometry.setIndex(keep);geometry.computeBoundingBox();geometry.computeBoundingSphere();b.geometry=geometry
 return {meshes:[b],removePrimitives:[],boneRecords:[],report}
}
