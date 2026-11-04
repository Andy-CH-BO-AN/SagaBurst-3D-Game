import * as T from 'three'

const digits = ['thumb', 'index', 'middle', 'ring', 'pinky']
const point = o => o.getWorldPosition(new T.Vector3())
const orientation = o => o.getWorldQuaternion(new T.Quaternion())
const smooth = x => { x = T.MathUtils.clamp(x, 0, 1); return x*x*(3-2*x) }

/** Increase actual visible surface resolution to an exact retained LOD0 budget.
 * Interpolated vertices lie on the original faces; no hidden/zero-area filler. */
function refine(surface, count) {
  surface = structuredClone(surface)
  const { positions:p, normals:n, weights:w, triangles:f } = surface
  const vertex = indexes => {
    const id=p.length, position=[0,0,0], normal=[0,0,0], weights=new Map()
    for(const i of indexes) {
      for(let c=0;c<3;c++){position[c]+=p[i][c]/indexes.length;normal[c]+=n[i][c]/indexes.length}
      for(const [name,weight]of w[i]) weights.set(name,(weights.get(name)??0)+weight/indexes.length)
    }
    const entries=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),total=entries.reduce((s,e)=>s+e[1],0)
    p.push(position);n.push(normal);w.push(entries.map(([name,v])=>[name,v/total]));return id
  }
  if(count<f.length) throw Error(`Reference hand exceeds local surface budget: ${f.length}>${count}`)
  if((count-f.length)%2) {
    const edges=new Map()
    for(let t=0;t<f.length;t++)for(let j=0;j<3;j++){const a=f[t][j],b=f[t][(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const v=edges.get(key)??[];v.push({t,j,a,b});edges.set(key,v)}
    const boundary=[...edges.values()].find(e=>e.length===1)?.[0]
    if(!boundary)throw Error('Expected open wrist boundary')
    const {t,j,a,b}=boundary,c=f[t][(j+2)%3],m=vertex([a,b]);f[t]=[a,m,c];f.push([m,b,c])
  }
  while(f.length<count) {
    let largest=-1,area=-1
    for(let i=0;i<f.length;i++){const [a,b,c]=f[i].map(j=>new T.Vector3(...p[j]));const v=b.sub(a).cross(c.sub(a)).lengthSq();if(v>area){area=v;largest=i}}
    const [a,b,c]=f[largest],m=vertex([a,b,c]);f[largest]=[a,b,m];f.push([b,c,m],[c,a,m])
  }
  return surface
}

/** Local hand surgery only. Preserve character body, material, wrist, sockets,
 * attachments and skin joint names. Finger rest frames and inverse binds move
 * together; old source animation rotations must be replaced by target poses. */
export function repairReferenceHands(rig, document, id, lod, reference) {
  const captain=id==='viking-hero-t4'
  if(!captain&&id!=='maki-archer-t4')return null
  rig.scene.updateMatrixWorld(true)
  const oldWorld=new Map(),meshes=[]
  rig.scene.traverse(o=>{if(o.isBone)oldWorld.set(o,o.matrixWorld.clone());if(o.isSkinnedMesh)meshes.push(o)})
  const changed=new Set(),removePrimitives=[],tips={},report=[],fingerNames=new Set()
  for(const side of ['l','r']) {
    const hand=rig.scene.getObjectByName(`hand_${side}`),source=reference.hands[side]
    const local=o=>hand.worldToLocal(point(o))
    const bases=Object.fromEntries(digits.map(d=>[d,local(rig.scene.getObjectByName(`${d}_01_${side}`))]))
    const x=bases.index.clone().sub(bases.pinky).normalize(),y=bases.middle.clone().addScaledVector(x,-bases.middle.dot(x)).normalize(),z=x.clone().cross(y).normalize()
    const frame=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z))
    // Length comes from the source surface envelope, not from the old fitted
    // Ranger skeleton (whose joints ended well before the actual fingertips).
    const length=captain?Math.max(...digits.filter(d=>d!=='thumb').map(d=>{
      const b=rig.scene.getObjectByName(`${d}_03_${side}`);return local(b).length()+b.position.length()*.75
    })):.184
    const targetAcross=captain?digits.filter(d=>d!=='thumb').reduce((s,d)=>s+bases[d].dot(x)/4,0):-.025
    const sourceAcross=['index','middle','ring','pinky'].reduce((s,d)=>s+source.bones[`${d}_01_${side}`].head[0]/4,0)
    const offset=targetAcross-sourceAcross*length
    const map=p=>new T.Vector3(...p).multiplyScalar(length).add(new T.Vector3(offset*smooth(p[1]/.45),0,0)).applyQuaternion(frame)
    const handWorld=orientation(hand)
    for(const digit of digits)for(let j=1;j<=3;j++) {
      const name=`${digit}_0${j}_${side}`,b=rig.scene.getObjectByName(name),ref=source.bones[name],q=ref.rotation
      const desired=hand.localToWorld(map(ref.head)),worldQ=handWorld.clone().multiply(frame).multiply(new T.Quaternion(q[1],q[2],q[3],q[0]))
      b.position.copy(b.parent.worldToLocal(desired));b.quaternion.copy(orientation(b.parent).invert().multiply(worldQ));b.updateWorldMatrix(false,true);fingerNames.add(name)
      if(j===3)tips[name]=b.worldToLocal(hand.localToWorld(map(ref.tail))).toArray()
    }
    const owner=new Set(meshes.flatMap(m=>m.skeleton.bones.filter(b=>b===hand||/^(thumb|index|middle|ring|pinky)_/.test(b.name)&&b.name.endsWith(`_${side}`))))
    for(const mesh of meshes) {
      if(captain&&!new RegExp(`^Rebuilt_UpperPalm_${side}001$`).test(mesh.name))continue
      const original=mesh.geometry,position=original.attributes.position,weights=original.attributes.skinWeight,joints=original.attributes.skinIndex,index=original.index
      const owned=v=>{let sum=0;for(let k=0;k<4;k++)if(owner.has(mesh.skeleton.bones[joints.getComponent(v,k)]))sum+=weights.getComponent(v,k);return sum}
      const handPoint=v=>hand.worldToLocal(mesh.localToWorld(new T.Vector3().fromBufferAttribute(position,v)))
      const retained=[],removed=[]
      for(let i=0;i<index.count;i+=3){const f=[0,1,2].map(k=>index.getX(i+k));const center=f.reduce((p,v)=>p.add(handPoint(v).multiplyScalar(1/3)),new T.Vector3());
        if(captain||f.reduce((s,v)=>s+owned(v)/3,0)>.5&&center.y>0)removed.push(f);else retained.push(...f)}
      if(!removed.length)continue
      let budget=removed.length
      if(captain)for(const other of meshes)if(other.name===mesh.name+'_1'){
        budget+=other.geometry.index.count/3;removePrimitives.push(rig.parser.associations.get(other));other.visible=false
      }
      const variant=`${captain?'captain':'ranger'}${lod}`,surface=refine(source.surfaces[variant],lod===0?budget:source.surfaces[variant].triangles.length)
      const arrays={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]}
      // Retain original vertex payloads for all surviving body/sleeve faces.
      if(!captain)for(const key of Object.keys(arrays))arrays[key]=Array.from(original.attributes[key].array)
      const start=arrays.position.length/3,meshInverse=mesh.matrixWorld.clone().invert(),normalQ=orientation(mesh).invert().multiply(handWorld).multiply(frame)
      const candidates=[...new Set(removed.flat())],uv=original.attributes.uv
      const sample=map([0,.3,0]);let nearest=candidates[0],distance=Infinity
      for(const v of candidates){const d=handPoint(v).distanceToSquared(sample);if(d<distance){nearest=v;distance=d}}
      for(let v=0;v<surface.positions.length;v++) {
        const p=hand.localToWorld(map(surface.positions[v])).applyMatrix4(meshInverse)
        arrays.position.push(...p.toArray());arrays.normal.push(...new T.Vector3(...surface.normals[v]).applyQuaternion(normalQ).normalize().toArray())
        arrays.uv.push(uv.getX(nearest),uv.getY(nearest))
        const entries=surface.weights[v],is=[],ws=[]
        for(const [name,w]of entries){const i=mesh.skeleton.bones.findIndex(b=>b.name===name);if(i<0)throw Error(`Missing target ${name}`);is.push(i);ws.push(w)}
        while(is.length<4){is.push(0);ws.push(0)}arrays.skinIndex.push(...is);arrays.skinWeight.push(...ws)
      }
      const geometry=new T.BufferGeometry()
      for(const [key,values]of Object.entries(arrays))geometry.setAttribute(key,new T.BufferAttribute(key==='skinIndex'?new Uint16Array(values):new Float32Array(values),key==='uv'?2:key.startsWith('skin')?4:3))
      geometry.setIndex([...retained,...surface.triangles.flatMap(f=>f.map(v=>v+start))]);geometry.computeBoundingBox();geometry.computeBoundingSphere()
      mesh.geometry=geometry;changed.add(mesh);report.push({side,mesh:mesh.name,removedTriangles:removed.length,newHandTriangles:surface.triangles.length,lengthM:length})
    }
  }
  rig.scene.updateMatrixWorld(true)
  // GLTF can share Matrix4 objects across mesh skeletons. Mutate each inverse
  // bind once, preventing repeated compensation from producing finger twists.
  const seen=new Set()
  for(const mesh of meshes)for(let i=0;i<mesh.skeleton.bones.length;i++){
    const bone=mesh.skeleton.bones[i],inverse=mesh.skeleton.boneInverses[i]
    if(!fingerNames.has(bone.name)||seen.has(inverse))continue
    seen.add(inverse);inverse.premultiply(oldWorld.get(bone)).premultiply(bone.matrixWorld.clone().invert())
  }
  const boneRecords=[...fingerNames].map(name=>{const b=rig.scene.getObjectByName(name);return {name,node:rig.parser.associations.get(b).nodes,translation:b.position.toArray(),rotation:b.quaternion.toArray()}})
  return {meshes:[...changed],removePrimitives,tips,boneRecords,report}
}
