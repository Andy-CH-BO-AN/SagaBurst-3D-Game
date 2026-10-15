import * as T from 'three'

/** Local posterior cloth repair. Leaves joints, weights and all animation
 * buffers intact; backs only bounded holes in the source cape (not openings
 * for limbs/neck) and provides clearance behind the restored mail torso. */
export function repairVarangianCape(asset) {
  const document = structuredClone(asset.document)
  if (document.asset.extras?.varangianCapeClearance) return { ...asset, audit: document.asset.extras.varangianCapeClearance }
  const binary = asset.binary, chunks = [binary]; let offset = binary.length
  const values = index => {
    const a = document.accessors[index], v = document.bufferViews[a.bufferView]
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]
    const size = {5126:4,5125:4,5123:2,5121:1}[a.componentType]
    const read = {5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType]
    return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,k)=>binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*size)+k*size)))
  }
  const append = (array, type, componentType) => {
    const pad = (4-offset%4)%4; chunks.push(Buffer.alloc(pad)); offset+=pad
    const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),view=document.bufferViews.length
    document.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(bytes);offset+=bytes.length
    const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],a={bufferView:view,componentType,count:array.length/width,type}
    if(type==='VEC3'){a.min=[0,1,2].map(c=>Math.min(...array.filter((_,i)=>i%3===c)));a.max=[0,1,2].map(c=>Math.max(...array.filter((_,i)=>i%3===c)))}
    document.accessors.push(a);return document.accessors.length-1
  }
  const node=document.nodes.find(n=>n.name==='Varangian_Captain'),mesh=document.meshes[node.mesh]
  const audit={version:1,backedRegions:0,addedTriangles:0,movedVertices:0,reprojectedTriangles:0,maxRearOffsetM:.10,preserved:'All original joints, inverse binds, weights and eleven source animation buffers; original UVs except the three LOD2 central-fold triangles; backing copies boundary skin weights and samples the original blue-cloth atlas'}
  for(const p of mesh.primitives){
    const positions=values(p.attributes.POSITION),indices=values(p.indices).flat(),groups=new Map(),representatives=[],weld=[]
    positions.forEach((v,i)=>{const key=v.map(x=>Math.round(x*1e5)).join(',');if(!groups.has(key)){groups.set(key,representatives.length);representatives.push(i)}weld.push(groups.get(key))})
    const originalIndexCount=indices.length
    const edges=new Map(),adj=new Map()
    for(let i=0;i<indices.length;i+=3)for(const [u,v] of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]){
      const a=weld[u],b=weld[v];if(a===b)continue;const key=a<b?`${a},${b}`:`${b},${a}`
      const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1})
      if(!adj.has(a))adj.set(a,new Set());if(!adj.has(b))adj.set(b,new Set());adj.get(a).add(b);adj.get(b).add(a)
    }
    const boundary=new Map()
    for(const {a,b,count}of edges.values())if(count===1){if(!boundary.has(a))boundary.set(a,[]);if(!boundary.has(b))boundary.set(b,[]);boundary.get(a).push(b);boundary.get(b).push(a)}
    const seen=new Set()
    for(const start of boundary.keys()){
      if(seen.has(start))continue
      const component=[],queue=[start];while(queue.length){const n=queue.pop();if(seen.has(n))continue;seen.add(n);component.push(n);queue.push(...boundary.get(n))}
      const ps=component.map(n=>positions[representatives[n]])
      // Every point must be inside the upper posterior cloth patch. This
      // excludes all intended garment boundaries, even after LOD collapse.
      if(component.length<3||!ps.every(([x,y,z])=>Math.abs(x)<.23&&y>.98&&y<1.49&&z<-.08))continue
      // The source has overlapping faces and T-junctions around these posterior
      // cutouts, so they are not manifold rings. A local cloth backing uses
      // their projected outer hull and existing textured/skinned vertices.
      const ordered=[...component].sort((a,b)=>positions[representatives[a]][0]-positions[representatives[b]][0]||positions[representatives[a]][1]-positions[representatives[b]][1])
      const cross=(a,b,c)=>{const p=positions[representatives[a]],q=positions[representatives[b]],r=positions[representatives[c]];return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])}
      const half=points=>{const h=[];for(const p of points){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p)}return h}
      const lower=half(ordered),upper=half([...ordered].reverse()),loop=[...lower.slice(0,-1),...upper.slice(0,-1)]
      const faces=T.ShapeUtils.triangulateShape(loop.map(n=>{const p=positions[representatives[n]];return new T.Vector2(p[0],p[1])}),[])
      for(const face of faces){const tri=face.map(i=>representatives[loop[i]]);tri.reverse();indices.push(...tri)}
      audit.addedTriangles+=faces.length
      audit.backedRegions++
    }
    // Select the connected cloth surface by its cape skinning, then include its
    // chest-weighted collar. Arms/head share the mesh but not this component.
    const skin=document.skins[node.skin],capeJoints=new Set(skin.joints.map((j,i)=>document.nodes[j].name.startsWith('cape_')?i:-1))
    const selected=new Set(),queue=[]
    for(const key of Object.keys(p.attributes).filter(k=>k.startsWith('JOINTS_'))){const js=values(p.attributes[key]),ws=values(p.attributes[key.replace('JOINTS_','WEIGHTS_')]);js.forEach((row,i)=>{if(row.some((j,k)=>capeJoints.has(j)&&ws[i][k]>.05))queue.push(weld[i])})}
    while(queue.length){const n=queue.pop();if(selected.has(n))continue;selected.add(n);queue.push(...adj.get(n)??[])}
    const smooth=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x)}
    positions.forEach((p,i)=>{if(!selected.has(weld[i]))return;const amount=.10*smooth((1.62-p[1])/.16)*smooth((.08-p[2])/.15);if(amount>1e-6){p[2]-=amount;audit.movedVertices++}})
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions.flat(),3));geometry.setIndex(indices);geometry.computeVertexNormals()
    // Preserve original normals outside the altered cloth component.
    const normals=values(p.attributes.NORMAL),computed=geometry.attributes.normal
    normals.forEach((n,i)=>{if(selected.has(weld[i]))n.splice(0,3,computed.getX(i),computed.getY(i),computed.getZ(i))})
    const patchIndices=indices.splice(originalIndexCount),originalCount=positions.length,uvRepair=[]
    // LOD2's long central triangles interpolate across the brown atlas
    // border, producing a false vertical tear. Reproject only that narrow fold.
    if(originalIndexCount/3<3000)for(let i=0;i<indices.length;i+=3){
      const tri=indices.slice(i,i+3),ps=tri.map(v=>positions[v])
      if(ps.every(([x,y,z])=>x>-.14&&x<.005&&y>.45&&z<-.2)&&Math.max(...ps.map(p=>p[1]))-Math.min(...ps.map(p=>p[1]))>.6){
        tri.forEach((v,k)=>{indices[i+k]=originalCount+patchIndices.length+uvRepair.length;uvRepair.push(v)});audit.reprojectedTriangles++
      }
    }
    for(const [semantic,index]of Object.entries(p.attributes)){
      const source=semantic==='POSITION'?positions:semantic==='NORMAL'?normals:values(index)
      const extra=patchIndices.flatMap(i=>semantic==='TEXCOORD_0'
        ?[.3984375+.046875*(positions[i][0]+.23)/.46,.8671875+.046875*(positions[i][1]-.98)/.51]
        :semantic==='POSITION'?[source[i][0],source[i][1],source[i][2]+.002]
        :source[i])
      extra.push(...uvRepair.flatMap(i=>semantic==='TEXCOORD_0'?[.3984375+.046875*T.MathUtils.clamp((positions[i][0]+.14)/.145,0,1),.8671875+.046875*T.MathUtils.clamp((positions[i][1]-.45)/.8,0,1)]:source[i]))
      const a=document.accessors[index],Typed=a.componentType===5126?Float32Array:a.componentType===5123?Uint16Array:Uint8Array
      p.attributes[semantic]=append(new Typed([...source.flat(),...extra]),a.type,a.componentType)
    }
    indices.push(...patchIndices.map((_,i)=>originalCount+i))
    p.indices=append(new Uint32Array(indices),'SCALAR',5125);geometry.dispose()
  }
  if(audit.backedRegions<1||audit.backedRegions>12)throw Error(`Unexpected posterior cape boundary count: ${audit.backedRegions}`)
  document.asset.extras={...document.asset.extras,varangianCapeClearance:audit};document.buffers[0].byteLength=offset
  return {document,binary:Buffer.concat(chunks),audit}
}
