/** Build the user-selected infantry/Varangian assets without re-exporting animation.
 * Usage: node tools/build-replacement-humanoids.mjs <extracted-library-root> [destination]
 * Requires Blender 4.3+ and Python/Pillow for image resize.
 * LOD0 retains the source tuple except the documented posterior T4 cape repair. All
 * original skin inverse binds and animation accessor bytes remain unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as T from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'
await MeshoptSimplifier.ready
import { repairVarangianCape } from './lib/varangian-cape-clearance.mjs'
import { readGlb, encodeGlb, loadRig } from './lib/humanoid-glb.mjs'
const root = process.argv[2]
if (!root) throw Error('Provide extracted Library source directory')
const destination = process.argv[3] ?? 'public/models/characters/v2'
const ordinary = 'Roman_Viking_Ordinary_LOD0_11Clips_Mock'
const varangian = 'Varangian_Captain_ReviewCandidate_Package/Varangian_Captain_ReviewCandidate'
const definitions = [
  { id: 'viking', rig: 'ordinary22', height: 1.86, file: `${ordinary}/Viking/Viking_Infantry_LOD0_GripAndWeaponAdjusted_DERIVED_11Clips.glb`, sha: 'a66917fffe0b2ab9b682e14675993ddf0f184420a585e9951e629d35a40b8c0c', readme: `${ordinary}/Viking/README_先讀_繁中.txt`, title: 'Ordinary Viking Infantry', archive: `${ordinary}.zip` },
  { id: 'roman', rig: 'roman54', height: 1.78, file: `${ordinary}/Roman/Models/Roman_Infantry_LOD0_Rebuilt_GripAndWeaponAdjusted_11Clips.glb`, sha: 'de47db53ff2f3dadeb4b6ff3e89f1b8ff85830c25eb321f508ef3850ff9ae80d', readme: `${ordinary}/Roman/README_先讀_繁中.txt`, title: 'Ordinary Roman Infantry', archive: `${ordinary}.zip` },
  { id: 'viking-hero-t4', rig: 'varangian63', height: 2, file: `${varangian}/Varangian_Captain_11Clips.glb`, sha: '300c9f894cd4c1f8f0cb1da392768a5078f0363d294fcde153c29c135abd224c', readme: `${varangian}/README_先讀我.txt`, title: 'Blue-Cloaked Varangian Captain', archive: 'Varangian_Captain_ReviewCandidate_Package.zip' },
]
const aliases = { 'Socket_Axe2H_Grip.R':'socket_axe_2h_r', Root:'root', Hips:'hips', Spine:'spine', Chest:'chest', Neck:'neck', Head:'head' }
for (const side of ['L','R']) for (const [source, target] of Object.entries({UpperArm:'upper_arm',Forearm:'lower_arm',Hand:'hand',Thigh:'upper_leg',Shin:'lower_leg',Foot:'foot',Toe:'toe',Clavicle:'clavicle'})) aliases[`${source}.${side}`] = `${target}_${side.toLowerCase()}`
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
function values(asset, index) {
  const a=asset.document.accessors[index], v=asset.document.bufferViews[a.bufferView]
  const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]
  const bytes={5126:4,5125:4,5123:2,5121:1}[a.componentType], method={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType]
  return Array.from({length:a.count},(_,r)=>Array.from({length:width},(_,c)=>asset.binary[method]((v.byteOffset??0)+(a.byteOffset??0)+r*(v.byteStride??width*bytes)+c*bytes)))
}
function compact(document, binary) {
  // Keep only referenced accessors/views. Copy bytes without float round trips.
  for(const a of document.animations){const ids=[...new Set(a.channels.map(c=>c.sampler))];a.channels.forEach(c=>c.sampler=ids.indexOf(c.sampler));a.samplers=ids.map(i=>a.samplers[i])}
  const used=new Set()
  for(const m of document.meshes)for(const p of m.primitives){Object.values(p.attributes).forEach(i=>used.add(i));used.add(p.indices)}
  document.skins.forEach(s=>used.add(s.inverseBindMatrices))
  document.animations.forEach(a=>a.samplers.forEach(s=>{used.add(s.input);used.add(s.output)}))
  const ids=[...used], remap=i=>ids.indexOf(i)
  document.accessors=ids.map(i=>document.accessors[i])
  document.meshes.forEach(m=>m.primitives.forEach(p=>{Object.keys(p.attributes).forEach(k=>p.attributes[k]=remap(p.attributes[k]));p.indices=remap(p.indices)}))
  document.skins.forEach(s=>s.inverseBindMatrices=remap(s.inverseBindMatrices))
  document.animations.forEach(a=>a.samplers.forEach(s=>{s.input=remap(s.input);s.output=remap(s.output)}))
  const views=[...new Set([...document.accessors.map(a=>a.bufferView),...document.images.map(i=>i.bufferView)])]
  const chunks=[];let offset=0
  const packed=views.map(i=>{const v=document.bufferViews[i],pad=(4-offset%4)%4;chunks.push(Buffer.alloc(pad));offset+=pad;const out={...v,byteOffset:offset};chunks.push(binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));offset+=v.byteLength;return out})
  document.accessors.forEach(a=>a.bufferView=views.indexOf(a.bufferView));document.images.forEach(i=>i.bufferView=views.indexOf(i.bufferView));document.bufferViews=packed;document.buffers=[{byteLength:offset}]
  return encodeGlb(document,Buffer.concat(chunks))
}
for(const def of definitions){
  const sourcePath=path.join(root,def.file), sourceBytes=fs.readFileSync(sourcePath), sourceSha=hash(sourceBytes)
  if(def.sha && def.sha!==sourceSha)throw Error(`Unexpected source version ${def.id}`)
  const source=readGlb(sourcePath), document=structuredClone(source.document)
  const originalNames=document.nodes.map(n=>n.name), mapping={}
  if(def.rig!=='varangian63')document.nodes.forEach(n=>{if(aliases[n.name]){mapping[n.name]=aliases[n.name];n.extras={...n.extras,sourceBoneName:n.name};n.name=aliases[n.name]}})
  const base={document,binary:source.binary}, rig=await loadRig(base);rig.scene.updateMatrixWorld(true)
  const bounds=new T.Box3().setFromObject(rig.scene), scale=def.height/(bounds.max.y-bounds.min.y), offset=-bounds.min.y*scale
  // One scene wrapper transforms mesh and joints together. Do not alter inverse
  // binds or animate the wrapper: gameplay root movement remains authoritative.
  for(const scene of document.scenes){const index=document.nodes.length;document.nodes.push({name:'humanoid_asset_normalization',translation:[0,offset,0],scale:[scale,scale,scale],children:scene.nodes});scene.nodes=[index]}
  const sockets={socket_hand_l:'hand_l',socket_hand_r:'hand_r',socket_back:'chest',socket_head:'head',socket_pelvis:'hips',socket_foot_l:'foot_l',socket_foot_r:'foot_r',sole_l:'foot_l',sole_r:'foot_r'}
  for(const [name,parentName]of Object.entries(sockets)){
    if(document.nodes.some(n=>n.name===name))continue
    const parent=rig.scene.getObjectByName(parentName), parentIndex=document.nodes.findIndex(n=>n.name===parentName)
    if(!parent||parentIndex<0)throw Error(`Missing parent ${parentName}`)
    const position=new T.Vector3(), quaternion=parent.getWorldQuaternion(new T.Quaternion()).invert()
    if(name.startsWith('sole_')){position.copy(parent.getWorldPosition(new T.Vector3()));position.y=bounds.min.y;parent.worldToLocal(position)}
    const node={name,translation:position.toArray(),rotation:quaternion.toArray()};(document.nodes[parentIndex].children??=[]).push(document.nodes.length);document.nodes.push(node)
  }
  const authoredGrip=JSON.parse(fs.readFileSync('tools/lib/replacement-humanoid-grips.json'))[def.id]
  for(const [key,name]of [['axe1','socket_axe_1h_r'],['axe2','socket_axe_2h_r']]){
    if(document.nodes.some(n=>n.name===name))continue // Roman's animated source grip wins.
    const matrix=new T.Matrix4().set(...authoredGrip[key].flat()),position=new T.Vector3(),rotation=new T.Quaternion(),size=new T.Vector3()
    matrix.decompose(position,rotation,size);rotation.normalize()
    const parent=document.nodes.findIndex(n=>n.name==='hand_r');(document.nodes[parent].children??=[]).push(document.nodes.length)
    document.nodes.push({name,translation:position.toArray(),rotation:rotation.toArray(),extras:{source:'Measured source mock weapon binding; +Z toward axe head'}})
  }
  const world=n=>rig.scene.getObjectByName(n).getWorldPosition(new T.Vector3())
  const metrics={heightM:bounds.getSize(new T.Vector3()).y*scale,overallHeightM:bounds.getSize(new T.Vector3()).y*scale,shoulderWidthM:world('upper_arm_l').distanceTo(world('upper_arm_r'))*scale,neckLengthM:world('neck').distanceTo(world('head'))*scale,triangles:{},textures:{}}
  const out=path.join(destination,def.id);fs.mkdirSync(out,{recursive:true});const audits=[]
  const geometryPath=path.join('output/humanoid-replacement',`${def.id}-welded.json`)
  fs.mkdirSync(path.dirname(geometryPath),{recursive:true})
  if(def.id!=='viking')execFileSync('blender',['-b','--python-exit-code','1','--python','tools/simplify-replacement-humanoids.py','--',sourcePath,geometryPath],{stdio:'ignore'})
  const geometry=def.id==='viking'?null:JSON.parse(fs.readFileSync(geometryPath))
  const animationHash=hash(Buffer.concat(source.document.animations.flatMap(a=>a.samplers.flatMap(s=>[s.input,s.output])).map(i=>{const a=source.document.accessors[i],v=source.document.bufferViews[a.bufferView];return source.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)})))
  const fileSha256={}
  for(const level of [0,1,2]){
    const d=structuredClone(document), chunks=[source.binary];let offset=source.binary.length
    const append=bytes=>{const pad=(4-offset%4)%4;chunks.push(Buffer.alloc(pad),bytes);offset+=pad;const index=d.bufferViews.length;d.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});offset+=bytes.length;return index}
    let count=0
    const appendArray=(array,type,componentType)=>{const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],view=append(Buffer.from(array.buffer)),a={bufferView:view,componentType,type,count:array.length/components};if(type==='VEC3'){a.min=[0,1,2].map(c=>Math.min(...array.filter((_,i)=>i%3===c)));a.max=[0,1,2].map(c=>Math.max(...array.filter((_,i)=>i%3===c)))}d.accessors.push(a);return d.accessors.length-1}
    d.meshes.forEach((mesh,mi)=>mesh.primitives.forEach((primitive,pi)=>{
      const p=source.document.meshes[mi].primitives[pi],node=source.document.nodes.find(n=>n.mesh===mi),skin=source.document.skins[node.skin]
      if(level===0){count+=source.document.accessors[p.indices].count/3;return}
      if(def.id==='viking'){
        const positions=values(source,p.attributes.POSITION),indices=values(source,p.indices).flat()
        const [reduced,error]=MeshoptSimplifier.simplify(new Uint32Array(indices),new Float32Array(positions.flat()),3,Math.floor(indices.length*(level===1?.4:.12)/3)*3,level===1?.006:.02,[])
        primitive.indices=appendArray(reduced,'SCALAR',5125);count+=reduced.length/3;return
      }
      const sourcePrimitives=source.document.meshes[mi].primitives
      const materialIndex=[...new Set(sourcePrimitives.map(p=>p.material))].indexOf(primitive.material)
      const originalReduced=geometry[node.name]?.[String(level)]?.primitives[materialIndex]
      const siblings=sourcePrimitives.map((p,i)=>p.material===primitive.material?i:-1).filter(i=>i>=0)
      const sibling=siblings.indexOf(pi),triangles=originalReduced?.indices.length/3
      const reduced=originalReduced&&{vertices:originalReduced.vertices,indices:originalReduced.indices.slice(Math.floor(triangles*sibling/siblings.length)*3,Math.floor(triangles*(sibling+1)/siblings.length)*3)}
      if(!reduced)throw Error(`Missing simplified primitive ${node.name}/${pi}`)
      // Blender changes only surface geometry; remap its named vertex groups to
      // the immutable original skin order. Do not import Blender bones/actions.
      const joints=new Map(skin.joints.map((n,i)=>[source.document.nodes[n].name,i]))
      const unique=[],indices=[],seen=new Map()
      for(const index of reduced.indices){const v=reduced.vertices[index],key=JSON.stringify(v);if(!seen.has(key)){seen.set(key,unique.length);unique.push(v)}indices.push(seen.get(key))}
      const weights=unique.map(v=>{const w=v[3].filter(([name])=>joints.has(name));const total=w.reduce((n,p)=>n+p[1],0);if(total<.99)throw Error('Lost skin weight');if(w.length>16)throw Error('Too many influences');return w.map(([name,value])=>[joints.get(name),value/total])})
      const attributes={POSITION:appendArray(new Float32Array(unique.flatMap(v=>v[0])),'VEC3',5126),NORMAL:appendArray(new Float32Array(unique.flatMap(v=>v[1])),'VEC3',5126),TEXCOORD_0:appendArray(new Float32Array(unique.flatMap(v=>v[2])),'VEC2',5126)}
      const sets=Math.ceil(Math.max(...weights.map(w=>w.length))/4)
      for(let set=0;set<sets;set++){attributes[`JOINTS_${set}`]=appendArray(new Uint16Array(weights.flatMap(w=>Array.from({length:4},(_,i)=>w[set*4+i]?.[0]??0))),'VEC4',5123);attributes[`WEIGHTS_${set}`]=appendArray(new Float32Array(weights.flatMap(w=>Array.from({length:4},(_,i)=>w[set*4+i]?.[1]??0))),'VEC4',5126)}
      primitive.attributes=attributes;primitive.indices=appendArray(new Uint32Array(indices),'SCALAR',5125);count+=indices.length/3
    }))
    const size=[2048,1024,512][level]
    d.images.forEach((image,i)=>{const v=source.document.bufferViews[source.document.images[i].bufferView],data=source.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)
      const resized=execFileSync('python3',['-c','from PIL import Image\nimport io,sys\nim=Image.open(io.BytesIO(sys.stdin.buffer.read()))\ns=int(sys.argv[1]); im.thumbnail((s,s),Image.Resampling.LANCZOS)\no=io.BytesIO();im.save(o,format="PNG");sys.stdout.buffer.write(o.getvalue())',String(size)],{input:data,maxBuffer:50*1024*1024})
      image.bufferView=append(resized);image.mimeType='image/png'
    })
    let bytes=compact(d,Buffer.concat(chunks)),repaired=null
    const derivedFromSha256=hash(bytes)
    if(def.rig==='varangian63'){
      const jsonLength=bytes.readUInt32LE(12)
      repaired=repairVarangianCape({document:JSON.parse(bytes.toString('utf8',20,20+jsonLength)),binary:bytes.subarray(28+jsonLength)})
      count+=repaired.audit.addedTriangles
      bytes=encodeGlb(repaired.document,repaired.binary)
    }
    fs.writeFileSync(path.join(out,`lod${level}.glb`),bytes);fileSha256[`lod${level}`]=hash(bytes);metrics.triangles[`lod${level}`]=count;metrics.textures[`lod${level}`]=size
    audits.push({level,triangles:count,bytes:bytes.length,...(repaired?{derivedFromSha256,capeRepair:repaired.audit}:{}),strategy:level&&def.id==='viking'?'Index-only collapse preserves original vertex attributes; welded candidate rejected for new posterior dents.':level?'Coincident vertices welded at 10 micrometers; Blender surface collapse retains loop UVs, interpolated weights remapped to unchanged source skin. Animation/bind bytes preserved.':def.rig==='varangian63'?'Posterior cape backing and tapered rear clearance; all source animation and skin-bind bytes preserved.':'Source geometry unchanged; wrapper normalization and texture resize only.'})
  }
  const timing=JSON.parse(fs.readFileSync('tools/lib/replacement-humanoid-events.json'))[def.id]
  const bindings=source.document.animations.map(a=>{const clip=a.name,duration=Math.max(...a.samplers.map(s=>source.document.accessors[s.input].max[0]));return {clip,source:clip.startsWith('axeAttack')?'Meshy':['swordSlash','pilumThrow'].includes(clip)?'Quaternius':'Kevin Iglesias',sourceClip:clip,loop:['idle','walk','run','axeMountedIdle','bowHold'].includes(clip),duration,...(clip==='walk'?{nominalSpeed:2}:clip==='run'?{nominalSpeed:4}:{}),...(clip.startsWith('axeAttack')?{meleeCycleSeconds:.48}:{}),...(timing[clip]?{events:{...timing[clip],actionComplete:duration}}:{})}})
  const manifest={schemaVersion:1,id:def.id,status:'ready',skeleton:'project-humanoid-v1',source:{title:def.title,sourceArchive:def.archive,sourceEntry:def.file.split('/').slice(def.rig==='varangian63'?2:1).join('/'),sourceSha256:sourceSha,license:'User-supplied Meshy model and derived animation; mixed animation-source licenses retained in source-readme.txt',licenseEvidence:'source-readme.txt'},attribution:`${def.title}: user-provided Meshy model/derivative. Core animations: Kevin Iglesias (Unity Asset Store EULA), Quaternius (CC0); axe attacks: user-provided Meshy source. See source-readme.txt.`,selectedSource:{rig:def.rig,uniformScale:1,seatBearing:JSON.parse(fs.readFileSync('tools/lib/replacement-humanoid-seats.json'))[def.id],...(def.rig==='varangian63'?{seatBearingMesh:'Varangian_Captain'}:{})},handShapeMode:'authored',preserveLodHandTopology:false,bakedEquipmentActions:['axeAttack1H','axeAttack2H'],files:{lod0:'lod0.glb',lod1:'lod1.glb',lod2:'lod2.glb'},metrics,animations:{embedded:bindings,runtimeGenerated:['mounted','death','hit','daggerSlash','greatswordSlash','lanceThrust','mountedLance']},fileSha256,visualAcceptance:'Runtime visual integration pending; structural LOD generation is not gameplay acceptance.',knownLimitations:[def.id==='viking'?'LOD2 exceeds target to preserve source UV/skin surface; lower-count welded candidate showed new posterior dents.':'Lower LODs use surface collapse with interpolated weights; game visual acceptance remains pending.',...(def.rig==='varangian63'?['Source review candidate retains angular inner-skirt folds/gaps under extreme knee flexion.']:[])]}
  if(def.rig==='varangian63')manifest.modifications=['Posterior cape backing and tapered 10 cm rear clearance; three LOD2 central-fold UV triangles reprojected; source joints, weights and eleven clips preserved.']
  // Equipment calibration is provided by the integration stage. Preserve it on
  // rebuild; it is measured in the original local hand frame, unchanged here.
  const oldPath=path.join(out,'manifest.json'),old=fs.existsSync(oldPath)?JSON.parse(fs.readFileSync(oldPath)):{}
  if(old.selectedSource?.rig===def.rig)for(const k of ['handGripFrames','swordGripFrames','equipmentSockets','bakedEquipmentActions'])if(old[k])manifest[k]=old[k]
  const grip=JSON.parse(fs.readFileSync('tools/lib/replacement-humanoid-grips.json'))[def.id]
  if(grip.shield)manifest.shieldGripFrames={lod0:grip.shield,lod1:grip.shield,lod2:grip.shield}
  manifest.rangedGripFrames={lod0:grip.ranged,lod1:grip.ranged,lod2:grip.ranged}
  manifest.handGripFrames={left:grip.left};manifest.swordGripFrames={lod0:grip.sword,lod1:grip.sword,lod2:grip.sword}
  fs.writeFileSync(oldPath,JSON.stringify(manifest,null,2)+'\n')
  fs.writeFileSync(path.join(out,'bone-map.json'),JSON.stringify({rig:def.rig,sourceToProject:mapping,skinJointCount:source.document.skins[0].joints.length,normalization:{scale,offsetY:offset,sourceBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}},preservedDynamicGrip:document.nodes.some(n=>n.name==='socket_axe_2h_r')},null,2)+'\n')
  fs.writeFileSync(path.join(out,'lod-audit.json'),JSON.stringify({sourceSha256:sourceSha,sourceAnimationBufferSha256:animationHash,skinJoints:source.document.skins[0].joints.length,lods:audits},null,2)+'\n')
  fs.copyFileSync(path.join(root,def.readme),path.join(out,'source-readme.txt'))
  if(def.rig==='varangian63')fs.writeFileSync(path.join(out,'source-license.txt'),fs.readFileSync(path.join(root,varangian,'來源授權追溯.txt'),'utf8').trimEnd()+'\n')
  fs.writeFileSync(path.join(out,'attribution-evidence.json'),JSON.stringify({source:manifest.source,attribution:manifest.attribution,scope:"User-provided derivative asset for requested SagaBurst integration. This metadata records supplied provenance; it does not grant new third-party rights.",animationTerms:{Meshy:"User account/service/input rights; not asserted CC0","Kevin Iglesias":"Existing project licensed animation, Unity Asset Store EULA",Quaternius:"CC0 1.0"},modelTerms:def.rig==='varangian63'?"See source-license.txt and source-readme.txt for supplied model provenance.":"Ordinary Meshy model CC BY 4.0 per user-provided source UI record; source README retains full qualification."},null,2)+'\n')
  console.log(def.id,JSON.stringify({sourceSha,metrics,normalization:{scale,offset},lods:audits}))
}
