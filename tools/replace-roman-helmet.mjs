/** Replace only T4 headgear; body, skin, skeleton and animation buffers stay intact.
 * Full rebuild: build-roman-hero -> retarget-roman-hero -> audit-roman-hero.
 * Existing T4 update: this script (Blender + Pillow/numpy), then audit-roman-hero.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as THREE from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/roman-hero-t4'
const source='artifacts/character_sources/roman-helmet/source.glb', prepared='output/roman-helmet/prepared'
const sha=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const attribution=JSON.parse(fs.readFileSync('artifacts/character_sources/roman-helmet/attribution.json'))
if(sha(source)!==attribution.sourceSha256)throw Error('Unexpected Roman helmet source')
if(!process.argv.includes('--prepared'))execFileSync(process.env.ROMAN_HERO_BLENDER??'blender',['-b','--python','tools/prepare-roman-helmet.py','--',source,prepared],{stdio:'inherit'})
execFileSync(process.env.ROMAN_HERO_PYTHON??'python3',['tools/roman-helmet-textures.py',source,`${dir}/lod0.glb`,prepared],{stdio:'inherit'})
const palette=JSON.parse(fs.readFileSync(`${prepared}/palette.json`))
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`))
for(let lod=0;lod<3;lod++){
  const path=`${dir}/lod${lod}.glb`,asset=readGlb(path),doc=asset.document
  const rig=await loadRig(asset),helmet=await loadRig(readGlb(`${prepared}/lod${lod}.glb`))
  rig.scene.updateMatrixWorld(true)
  // Source faces +X. Offline fit preserves head anatomy and the source ornaments.
  helmet.scene.rotation.y=-Math.PI/2;helmet.scene.scale.set(.43,.30,.375);helmet.scene.position.set(0,1.84,.004)
  helmet.scene.updateMatrixWorld(true)
  const inverse=rig.scene.getObjectByName('head').matrixWorld.clone().invert()
  const chunks=[asset.binary];let offset=asset.binary.length
  const appendBytes=bytes=>{const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad}
    const view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(bytes);offset+=bytes.length;return view}
  const append=(values,type)=>{const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],a={bufferView:appendBytes(Buffer.from(values.buffer,values.byteOffset,values.byteLength)),componentType:values instanceof Float32Array?5126:5125,count:values.length/components,type}
    if(type==='VEC3'){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++){const j=i%3;a.min[j]=Math.min(a.min[j],values[i]);a.max[j]=Math.max(a.max[j],values[i])}}
    doc.accessors.push(a);return doc.accessors.length-1}
  const body=doc.materials.find(m=>m.name==='Armour_top0').pbrMetallicRoughness
  const material=doc.materials.length,image=doc.images.length,texture=doc.textures.length
  doc.images.push({name:'Praetorian_helmet_albedo',mimeType:'image/png',bufferView:appendBytes(fs.readFileSync(`${prepared}/albedo${lod}.png`))})
  doc.textures.push({source:image})
  doc.materials.push({name:'Praetorian_source_helmet',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:texture},metallicFactor:body.metallicFactor,roughnessFactor:body.roughnessFactor}})
  const primitives=[]
  helmet.scene.traverse(o=>{if(!o.isMesh)return
    const geometry=o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld))
    if(!geometry.attributes.uv)throw Error('Source UVs lost during LOD preparation')
    primitives.push({attributes:{POSITION:append(geometry.attributes.position.array,'VEC3'),NORMAL:append(geometry.attributes.normal.array,'VEC3'),TEXCOORD_0:append(geometry.attributes.uv.array,'VEC2')},indices:append(new Uint32Array(geometry.index.array),'SCALAR'),material})
  })
  const mesh=doc.meshes.length;doc.meshes.push({name:'Praetorian_Roman_helmet',primitives})
  const head=doc.nodes.find(n=>n.name==='head');head.children??=[];head.children.push(doc.nodes.length)
  doc.nodes.push({name:'Praetorian_Roman_helmet',mesh,extras:{rigidAttachment:'head',sourceSha256:attribution.sourceSha256,originalIntegratedCheekGuards:true}})
  const obsolete=new Set(doc.nodes.flatMap((n,i)=>['Helmet3','Praetorian_face_mask','Praetorian_Roman_helmet'].includes(n.name)&&i!==doc.nodes.length-1?[i]:[]))
  // Remove old nodes outright and remap all node references, including animation targets.
  const nodeMap=new Map(),nodes=[];doc.nodes.forEach((n,i)=>{if(!obsolete.has(i)){nodeMap.set(i,nodes.length);nodes.push(n)}})
  for(const n of nodes)if(n.children)n.children=n.children.filter(i=>nodeMap.has(i)).map(i=>nodeMap.get(i))
  for(const s of doc.scenes)s.nodes=s.nodes.filter(i=>nodeMap.has(i)).map(i=>nodeMap.get(i))
  for(const s of doc.skins){s.joints=s.joints.map(i=>nodeMap.get(i));if(s.skeleton!==undefined)s.skeleton=nodeMap.get(s.skeleton)}
  for(const a of doc.animations)for(const c of a.channels)c.target.node=nodeMap.get(c.target.node)
  doc.nodes=nodes
  // Pack reachable resources only: no old helmet/mask geometry or textures survive.
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
  const buffer=Buffer.concat(chunks),views=new Set([...doc.accessors.map(a=>a.bufferView),...doc.images.map(i=>i.bufferView)]),packed=[];offset=0
  map=compact('bufferViews',views)
  for(const v of doc.bufferViews){const bytes=buffer.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),pad=(4-offset%4)%4;if(pad){packed.push(Buffer.alloc(pad));offset+=pad}v.byteOffset=offset;packed.push(bytes);offset+=bytes.length}
  for(const a of doc.accessors)a.bufferView=map.get(a.bufferView);for(const i of doc.images)i.bufferView=map.get(i.bufferView)
  doc.buffers[0].byteLength=offset
  delete doc.asset.extras.romanHeroBuild.maskTriangles;delete doc.asset.extras.romanHeroBuild.maskFit
  const triangles=primitives.reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0)
  doc.asset.extras.romanHelmetReplacement={sourceSha256:attribution.sourceSha256,triangles,sourceScale:[.43,.30,.375],sourceYawRadians:-Math.PI/2,worldPositionM:[0,1.84,.004],headUnchanged:true,palette}
  fs.writeFileSync(path,encodeGlb(doc,Buffer.concat(packed)))
  const actual=await loadRig(readGlb(path));actual.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(actual.scene,true)
  const total=doc.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0)
  manifest.fileSha256[`lod${lod}`]=sha(path);manifest.metrics.triangles[`lod${lod}`]=total
  Object.assign(manifest.lodMeasurements[lod],{triangles:total,helmetTriangles:triangles,materials:doc.materials.length,sha256:sha(path),bytes:fs.statSync(path).size,overallHeightM:box.max.y-box.min.y})
  manifest.lodMeasurements[lod].textures=manifest.lodMeasurements[lod].textures.filter(t=>!t.name.startsWith('Helmet3')&&t.name!=='Praetorian_helmet_albedo')
  manifest.lodMeasurements[lod].textures.push({name:'Praetorian_helmet_albedo',width:[2048,1024,512][lod],height:[2048,1024,512][lod]})
  delete manifest.lodMeasurements[lod].maskTriangles
}
manifest.metrics.overallHeightM=manifest.lodMeasurements[0].overallHeightM
manifest.helmetSource=attribution;manifest.helmetFit={headUnchanged:true,sourceScale:[.43,.30,.375],sourceYawRadians:-Math.PI/2,worldPositionM:[0,1.84,.004],palette}
manifest.modifications=manifest.modifications.filter(s=>!s.startsWith('Head-parented facial shell')&&!s.startsWith('Replacement helmet:')).map(s=>s.replace('face, neck, helmet and visible','face, neck and visible').replace('dark eye rims; ',''))
manifest.modifications.push('Replacement helmet: supplied stratovarius1980 CC BY 4.0 Roman helmet, with its original integrated cheek guards retained as requested. Old Helmet3 and generated face mask removed from all LODs. Source-derived LODs with re-baked original color atlas, offline fit and torso-sampled steel/gold palette; original head, skeleton, body and animation data unchanged by replacement.')
manifest.visualAcceptance='Front, side, three-quarter and animation review required after export; see docs/roman-t4-helmet-validation.md.'
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
const bones=JSON.parse(fs.readFileSync(`${dir}/bone-map.json`));bones.rigidAttachments={Praetorian_Roman_helmet:'head'};fs.writeFileSync(`${dir}/bone-map.json`,JSON.stringify(bones,null,2)+'\n')
const evidence=JSON.parse(fs.readFileSync(`${dir}/attribution-evidence.json`));evidence.helmet=attribution;fs.writeFileSync(`${dir}/attribution-evidence.json`,JSON.stringify(evidence,null,2)+'\n')
const credits=fs.readFileSync(`${dir}/ATTRIBUTION.md`,'utf8').split('\n## Replacement helmet')[0].replace('measured facial shell, ','')
fs.writeFileSync(`${dir}/ATTRIBUTION.md`,`${credits}\n## Replacement helmet\n\n${attribution.title} by ${attribution.author}. ${attribution.url}\n\nLicense: ${attribution.license} (${attribution.licenseUrl}). Source SHA-256: ${attribution.sourceSha256}.\n\nChanges: source-derived LOD simplification, head fitting, torso-matched recoloring and rigid head attachment. Original integrated face/cheek guards and source decoration retained with user approval. No new decorative geometry. Rebuild using tools/replace-roman-helmet.mjs after preparing the T4 body.\n`)
console.log(JSON.stringify({helmet:attribution.title,lods:manifest.lodMeasurements.map(({triangles,helmetTriangles,bytes})=>({triangles,helmetTriangles,bytes}))},null,2))
