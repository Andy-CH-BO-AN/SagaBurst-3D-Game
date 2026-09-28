/** Remove unreachable GLB resources without changing retained payload bytes. */
export function packGlbResources(doc,binary){
  const compact=(key,used)=>{const map=new Map(),list=[];doc[key].forEach((value,i)=>{if(used.has(i)){map.set(i,list.length);list.push(value)}});doc[key]=list;return map}
  let map=compact('meshes',new Set(doc.nodes.flatMap(n=>n.mesh===undefined?[]:[n.mesh])))
  for(const n of doc.nodes)if(n.mesh!==undefined)n.mesh=map.get(n.mesh)
  map=compact('materials',new Set(doc.meshes.flatMap(m=>m.primitives.map(p=>p.material))))
  for(const m of doc.meshes)for(const p of m.primitives)p.material=map.get(p.material)
  const textureRefs=doc.materials.flatMap(m=>[m.normalTexture,m.occlusionTexture,m.emissiveTexture,m.pbrMetallicRoughness?.baseColorTexture,m.pbrMetallicRoughness?.metallicRoughnessTexture].filter(Boolean))
  map=compact('textures',new Set(textureRefs.map(t=>t.index)));for(const t of textureRefs)t.index=map.get(t.index)
  map=compact('images',new Set(doc.textures.map(t=>t.source)));for(const t of doc.textures)t.source=map.get(t.source)
  const used=new Set(doc.skins.map(s=>s.inverseBindMatrices))
  for(const m of doc.meshes)for(const p of m.primitives){used.add(p.indices);Object.values(p.attributes).forEach(i=>used.add(i));for(const t of p.targets??[])Object.values(t).forEach(i=>used.add(i))}
  for(const a of doc.animations)for(const s of a.samplers){used.add(s.input);used.add(s.output)}
  map=compact('accessors',used)
  for(const s of doc.skins)s.inverseBindMatrices=map.get(s.inverseBindMatrices)
  for(const m of doc.meshes)for(const p of m.primitives){p.indices=map.get(p.indices);for(const key of Object.keys(p.attributes))p.attributes[key]=map.get(p.attributes[key]);for(const t of p.targets??[])for(const key of Object.keys(t))t[key]=map.get(t[key])}
  for(const a of doc.animations)for(const s of a.samplers){s.input=map.get(s.input);s.output=map.get(s.output)}
  const buffer=binary,views=new Set([...doc.accessors.map(a=>a.bufferView),...doc.images.map(i=>i.bufferView)]),packed=[];let offset=0
  map=compact('bufferViews',views)
  for(const v of doc.bufferViews){const bytes=buffer.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),pad=(4-offset%4)%4;if(pad){packed.push(Buffer.alloc(pad));offset+=pad}v.byteOffset=offset;packed.push(bytes);offset+=bytes.length}
  for(const a of doc.accessors)a.bufferView=map.get(a.bufferView);for(const i of doc.images)i.bufferView=map.get(i.bufferView)
  doc.buffers[0].byteLength=offset
  return Buffer.concat(packed)
}
