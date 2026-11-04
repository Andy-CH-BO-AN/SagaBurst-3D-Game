/** Rebuild the two supplied 30K heroes. Run from repository root:
 * node tools/build-meshy-faction-heroes.mjs /path/to/source-glbs
 * LOD0 geometry/index accessor bytes are never edited or simplified. Waist skin is corrected explicitly; inverse binds remain unchanged.
 * Donor clips/contracts are frozen to the pre-replacement dev revision.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as T from 'three'
import { readGlb, encodeGlb, loadRig } from './lib/humanoid-glb.mjs'
import { decodeMeshoptGlb } from './lib/meshopt-glb.mjs'
import { packFactionHumanoidBuffers } from './pack-faction-humanoid-buffers.mjs'
import { buildAnatomicalFingerPoses, bakeAnatomicalFingerClips } from './lib/anatomical-finger-pose.mjs'
import { createMeshyWaistSkinRepair } from './lib/meshy-waist-skin.mjs'
import { packGlbResources } from './lib/pack-glb-resources.mjs'
import { bakeFactionClips, collapseConstantTracks } from './lib/faction-humanoid-animation.mjs'
const root = process.argv[2]
if (!root) throw Error('Provide source GLB directory')
const python=process.env.MESHY_PYTHON??'python3'
execFileSync(python,['-c','from PIL import Image'])
const revision = '7cb61c07f9daf41cccd35287a6cc842955c3f137'
const definitions = [
  { id: 'roman-hero-t4', title: 'Gondor Knight', file: 'Meshy_AI_Gondor_Knight_30k_All_Animations.glb', sha: 'a59206334da45915e443cd6880c42c8e11cea319a49a459244ba62da62a1062d', triangles: 31105, height: 1.95 },
  { id: 'viking-hero-t5', title: 'Viking Warrior', file: 'Meshy_AI_viking_warrior_30k_All_Animations.glb', sha: '364e19160ba66ae344be73e3d4c8c5e5437b3caab7d339a979aabefd60cb46e2', triangles: 31256, height: 2.1193006331863145 },
]
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const aliases = { Hips:'hips', Spine:'spine', Spine1:'chest', Spine2:'upper_chest', Neck:'neck', Head:'head' }
for (const [side, suffix] of [['Left','l'],['Right','r']]) {
  for (const [from,to] of Object.entries({Shoulder:'clavicle',Arm:'upper_arm',ForeArm:'lower_arm',Hand:'hand',UpLeg:'upper_leg',Leg:'lower_leg',Foot:'foot',ToeBase:'toe'})) aliases[side+from] = to+'_'+suffix
  for (const [digit,name] of Object.entries({Thumb:'thumb',Index:'index',Middle:'middle',Ring:'ring',Pinky:'pinky'})) for(let i=1;i<=4;i++) aliases[`${side}Hand${digit}${i}`] = `${name}_0${i}_${suffix}`
}
const sockets = { socket_hand_l:'hand_l',socket_hand_r:'hand_r',socket_back:'chest',socket_head:'head',socket_pelvis:'hips',socket_foot_l:'foot_l',socket_foot_r:'foot_r',sole_l:'foot_l',sole_r:'foot_r' }
function accessor(asset,index) {
  const a=asset.document.accessors[index],v=asset.document.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]
  const bytes={5126:4,5125:4,5123:2,5121:1}[a.componentType], method={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType]
  return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>asset.binary[method]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*bytes)+j*bytes)))
}
function payload(asset,index) {
  const a=asset.document.accessors[index],v=asset.document.bufferViews[a.bufferView]
  return asset.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)
}
function appender(doc, initial) {
  const chunks=[initial];let length=initial.length
  const bytes=b=>{const pad=(4-length%4)%4;chunks.push(Buffer.alloc(pad),b);length+=pad;const index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:b.length});length+=b.length;return index}
  const array=(data,type,componentType=5126)=>{const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],index=doc.accessors.length,a={bufferView:bytes(Buffer.from(data.buffer,data.byteOffset,data.byteLength)),componentType,type,count:data.length/width};if(type==='SCALAR'){a.min=[data[0]];a.max=[data.at(-1)]}doc.accessors.push(a);return index}
  return {bytes,array,binary:()=>{doc.buffers=[{byteLength:length}];return Buffer.concat(chunks)}}
}
const position = o => o.getWorldPosition(new T.Vector3())
function handFrame(scene, side) {
  const hand=scene.getObjectByName(`hand_${side}`),local=n=>hand.worldToLocal(position(scene.getObjectByName(n)))
  const index=local(`index_01_${side}`),pinky=local(`pinky_01_${side}`),middle=local(`middle_01_${side}`),thumbBase=local(`thumb_01_${side}`)
  const across=index.clone().sub(pinky).normalize(),finger=middle.clone().normalize();finger.addScaledVector(across,-finger.dot(across)).normalize()
  const normal=new T.Vector3().crossVectors(across,finger).normalize()
  const inward=new T.Vector3(side==='l'?-1:1,0,0).applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()).invert())
  if(normal.dot(inward)<0)normal.negate()
  const base=index.clone().add(pinky).multiplyScalar(.5),surface=base.clone().multiplyScalar(.78).addScaledVector(normal,.012)
  return {gripCenterLocal:surface.clone().addScaledVector(normal,.019).toArray(),gripAxisLocal:across.toArray(),palmNormalLocal:normal.toArray(),fingerDirection:finger.toArray(),wristCenter:[0,0,0],thumbBaseCenter:thumbBase.toArray(),fingerBase:base.dot(finger),gripRadius:.019,palmContactCenter:surface.toArray()}
}
for(const def of definitions) {
  const directory=`public/models/characters/v2/${def.id}`,work=`output/meshy-faction-heroes/${def.id}`
  fs.mkdirSync(work,{recursive:true});fs.mkdirSync(directory,{recursive:true})
  const donorPath=`${work}/donor.glb`,donorBytes=execFileSync('git',['show',`${revision}:${directory}/lod0.glb`],{maxBuffer:100*1024*1024})
  fs.writeFileSync(donorPath,donorBytes)
  const old=JSON.parse(execFileSync('git',['show',`${revision}:${directory}/manifest.json`],{encoding:'utf8'}))
  const donorAsset=await decodeMeshoptGlb(readGlb(donorPath)),donor=await loadRig(donorAsset)
  const bindings=structuredClone(old.animations.embedded)
  for(const supplemental of old.animations.supplemental??[]) {
    const file=`${work}/${supplemental.file}`
    fs.writeFileSync(file,execFileSync('git',['show',`${revision}:${directory}/${supplemental.file}`],{maxBuffer:50*1024*1024}))
    const asset=await loadRig(readGlb(file)),clip=asset.animations.find(c=>c.name===supplemental.lodClips[0])
    if(!clip)throw Error('Missing supplemental donor')
    donor.animations.push(new T.AnimationClip(supplemental.clip,supplemental.duration,clip.tracks))
    bindings.push({...old.animations.embedded.find(b=>b.clip==='axeAttack1H'),clip:supplemental.clip,duration:supplemental.duration})
  }
  const file=path.join(root,def.file),raw=fs.readFileSync(file)
  if(hash(raw)!==def.sha)throw Error(`Unexpected ${def.file}`)
  const source=readGlb(file),doc=structuredClone(source.document),mapping={}
  const reducedPath=`${work}/surface-lods.json`
  execFileSync(process.env.BLENDER??(process.platform==='darwin'?'/Applications/Blender.app/Contents/MacOS/Blender':'blender'),['-b','--python-exit-code','1','--python','tools/simplify-replacement-humanoids.py','--',file,reducedPath,String(10000/def.triangles),String(3000/def.triangles)],{stdio:'ignore'})
  const surfaces=JSON.parse(fs.readFileSync(reducedPath))
  doc.nodes.forEach(n=>{const alias=aliases[n.name?.replace(/^mixamorig:?/,'')];if(alias){mapping[n.name]=alias;n.name=alias}})
  doc.animations=[]
  const originalRig=await loadRig({document:doc,binary:source.binary});originalRig.scene.updateMatrixWorld(true)
  const sourceHipHeight=position(originalRig.scene.getObjectByName('hips')).y
  const skinBuild=appender(doc,source.binary),skinRepairs=[]
  for(const [mi,mesh]of doc.meshes.entries())for(const p of mesh.primitives) {
    const node=source.document.nodes.find(n=>n.mesh===mi),skin=source.document.skins[node.skin]
    const repair=createMeshyWaistSkinRepair(skin.joints.map(i=>source.document.nodes[i].name),sourceHipHeight)
    const positions=accessor(source,p.attributes.POSITION),joints=accessor(source,p.attributes.JOINTS_0),weights=accessor(source,p.attributes.WEIGHTS_0)
    const corrected=positions.map((v,i)=>repair.repair(joints[i].map((joint,k)=>[joint,weights[i][k]]).filter(([,w])=>w>0),v[1]))
    if(corrected.some(entries=>entries.length>4))throw Error('Waist repair exceeded source influence count')
    p.attributes.JOINTS_0=skinBuild.array(new Uint16Array(corrected.flatMap(entries=>Array.from({length:4},(_,k)=>entries[k]?.[0]??0))),'VEC4',5123)
    p.attributes.WEIGHTS_0=skinBuild.array(new Float32Array(corrected.flatMap(entries=>Array.from({length:4},(_,k)=>entries[k]?.[1]??0))),'VEC4')
    skinRepairs.push(repair.report())
  }
  const skinnedBinary=skinBuild.binary()
  const target=await loadRig({document:doc,binary:skinnedBinary});target.scene.updateMatrixWorld(true);donor.scene.updateMatrixWorld(true)
  const box=new T.Box3().setFromObject(target.scene,true),scale=def.height/box.getSize(new T.Vector3()).y,ground=-box.min.y*scale
  // Wrap mesh and complete skin together. Original vertex and inverse-bind bytes
  // are retained. The wrapper is offline metadata, never animated/root motion.
  const wrapper=doc.nodes.length
  doc.nodes.push({name:'humanoid_asset_normalization',scale:[scale,scale,scale],translation:[0,ground,0],children:doc.scenes[doc.scene??0].nodes})
  doc.scenes[doc.scene??0].nodes=[wrapper]
  const frames={l:handFrame(target.scene,'l'),r:handFrame(target.scene,'r')}
  const rest=new Map()
  target.scene.traverse(o=>rest.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()}))
  const reset=(scene,states)=>{for(const[o,t]of states){o.position.copy(t.p);o.quaternion.copy(t.q);o.scale.copy(t.s)}scene.updateMatrixWorld(true)}
  for(const [name,parentName]of Object.entries(sockets)) {
    const parent=target.scene.getObjectByName(parentName),p=new T.Vector3()
    if(name.startsWith('sole_')){p.copy(position(parent));p.y=box.min.y;parent.worldToLocal(p)}
    const node={name,translation:p.toArray(),rotation:parent.getWorldQuaternion(new T.Quaternion()).invert().toArray()}
    const index=doc.nodes.findIndex(n=>n.name===parentName);(doc.nodes[index].children??=[]).push(doc.nodes.length);doc.nodes.push(node)
  }
  const targetMetadata={handGripFrames:{left:{...frames.l,thumbDirection:frames.l.gripAxisLocal,palmNormal:frames.l.palmNormalLocal}},swordGripFrames:{lod0:frames.r},animationRetarget:{groundContact:{mode:'plant',clearanceM:.003}}}
  const bodyBake=bakeFactionClips({source:donor,target,sourceDocument:donorAsset.document,targetDocument:doc,sourceMetadata:{...old,animations:{embedded:bindings}},targetMetadata,fps:30})
  const clips=bodyBake.clips
  // The shared pipeline deliberately delegates the foot-axe overlay to its
  // dedicated builder. Transfer that already-baked target through the same
  // physical-axis path under a temporary generic action name.
  const foot=donor.animations.find(c=>c.name==='axeAttack1HFoot')
  if(foot) {
    const footSource={...donor,animations:[new T.AnimationClip('axeAttack1H',foot.duration,foot.tracks)]}
    const footBinding={...bindings.find(b=>b.clip==='axeAttack1HFoot'),clip:'axeAttack1H'}
    const result=bakeFactionClips({source:footSource,target,sourceDocument:donorAsset.document,targetDocument:doc,sourceMetadata:{...old,animations:{embedded:[footBinding]}},targetMetadata,fps:30})
    result.clips[0].name='axeAttack1HFoot';clips.push(result.clips[0])
  }
  let deathDonor
  if(!clips.some(c=>c.name==='death')) {
    const deathDirectory='public/models/characters/v2/roman-hero-t4',deathPath=`${work}/death-donor.glb`
    fs.writeFileSync(deathPath,execFileSync('git',['show',`${revision}:${deathDirectory}/lod0.glb`],{maxBuffer:50*1024*1024}))
    const deathAsset=await decodeMeshoptGlb(readGlb(deathPath)),deathSource=await loadRig(deathAsset)
    const deathMetadata=JSON.parse(execFileSync('git',['show',`${revision}:${deathDirectory}/manifest.json`],{encoding:'utf8'}))
    deathSource.animations=deathSource.animations.filter(c=>c.name==='death')
    const deathBake=bakeFactionClips({source:deathSource,target,sourceDocument:deathAsset.document,targetDocument:doc,sourceMetadata:deathMetadata,targetMetadata,fps:30})
    clips.push(...deathBake.clips);bindings.push({...deathMetadata.animations.embedded.find(b=>b.clip==='death')})
    deathDonor={revision,asset:`${deathDirectory}/lod0.glb`,sha256:hash(fs.readFileSync(deathPath)),attribution:deathMetadata.attribution}
  }
  reset(target.scene,rest)
  // Natural hands and equipment contact are absolute poses in THIS bind frame.
  // A donor's already-flexed fingers must not receive another grasp rotation.
  const fingerPoses=buildAnatomicalFingerPoses(target,frames)
  clips.splice(0,clips.length,...bakeAnatomicalFingerClips({...target,animations:clips},fingerPoses,bindings))
  reset(target.scene,rest)
  const meshes=[];target.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)})
  const contact=meshes.map(mesh=>({mesh,indices:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i).filter(i=>{const p=new T.Vector3();mesh.getVertexPosition(i,p);return p.applyMatrix4(mesh.matrixWorld).y<.2})}))
  for(const clip of clips) {
    if(['mounted','axeMountedIdle'].includes(clip.name))continue
    reset(target.scene,rest)
    const samplers=clip.tracks.map(t=>{const at=t.name.lastIndexOf('.');return {node:target.scene.getObjectByName(t.name.slice(0,at)),property:t.name.slice(at+1),sample:t.createInterpolant()}})
    const times=[...clip.tracks[0].times],values=[],hips=target.scene.getObjectByName('hips'),point=new T.Vector3()
    const candidates=clip.name==='death'?meshes.map(mesh=>({mesh,indices:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i)})):contact
    for(const time of times) {
      reset(target.scene,rest);for(const s of samplers)s.node[s.property].fromArray(s.sample.evaluate(time));target.scene.updateMatrixWorld(true)
      let min=Infinity
      for(const {mesh,indices}of candidates){mesh.skeleton.update();for(const i of indices){mesh.getVertexPosition(i,point);min=Math.min(min,point.applyMatrix4(mesh.matrixWorld).y)}}
      if(!Number.isFinite(min))throw Error('No finite soles')
      const delta=new T.Vector3(0,-min+.003,0).applyQuaternion(hips.parent.getWorldQuaternion(new T.Quaternion()).invert())
      values.push(...hips.position.clone().add(delta).toArray())
    }
    clip.tracks=clip.tracks.filter(t=>t.name!=='hips.position')
    clip.tracks.push(new T.VectorKeyframeTrack('hips.position',times,values))
  }
  reset(target.scene,rest)
  const constantTrackAudit=collapseConstantTracks(clips)
  const build=appender(doc,skinnedBinary)
  doc.animations=clips.map(clip=>{
    const channels=[],samplers=[]
    for(const track of clip.tracks){const split=track.name.lastIndexOf('.'),name=track.name.slice(0,split),property=track.name.slice(split+1),node=doc.nodes.findIndex(n=>n.name===name||n.name?.replace(':','')===name)
      if(node<0)throw Error(`Missing track ${name}`)
      channels.push({sampler:samplers.length,target:{node,path:property==='position'?'translation':'rotation'}})
      samplers.push({input:build.array(track.times,'SCALAR'),output:build.array(track.values,property==='position'?'VEC3':'VEC4'),interpolation:'LINEAR'})}
    return {name:clip.name,channels,samplers}
  })
  const binary=build.binary(),lods=[],files={},triangles={}
  for(let level=0;level<3;level++) {
    const d=structuredClone(doc),append=appender(d,binary);let count=0,error=0
    for(const [mi,mesh]of d.meshes.entries())for(const [pi,p]of mesh.primitives.entries()) {
      const indices=accessor(source,p.indices).flat()
      if(level===0){count+=indices.length/3;continue}
      const node=source.document.nodes.find(n=>n.mesh===mi),reduced=surfaces[node.name][String(level)].primitives[pi]
      const unique=[],remapped=[],seen=new Map()
      for(const index of reduced.indices){const v=reduced.vertices[index],key=JSON.stringify(v);if(!seen.has(key)){seen.set(key,unique.length);unique.push(v)}remapped.push(seen.get(key))}
      const skin=source.document.skins[node.skin],jointNames=new Map(skin.joints.map((index,i)=>[source.document.nodes[index].name,i]))
      const lowerSkinRepair=createMeshyWaistSkinRepair(skin.joints.map(i=>source.document.nodes[i].name),sourceHipHeight)
      const influences=unique.map(v=>{const weights=v[3].filter(([name])=>jointNames.has(name)).sort((a,b)=>b[1]-a[1]),sum=weights.reduce((s,p)=>s+p[1],0);if(sum<.99||weights.length>16)throw Error('Lost LOD skin weights');error=Math.max(error,Math.abs(1-sum));return lowerSkinRepair.repair(weights.map(([name,w])=>[jointNames.get(name),w/sum]),v[0][1])})
      p.attributes={POSITION:append.array(new Float32Array(unique.flatMap(v=>v[0])),'VEC3'),NORMAL:append.array(new Float32Array(unique.flatMap(v=>v[1])),'VEC3'),TEXCOORD_0:append.array(new Float32Array(unique.flatMap(v=>v[2])),'VEC2'),
        JOINTS_0:append.array(new Uint16Array(influences.flatMap(w=>Array.from({length:4},(_,i)=>w[i]?.[0]??0))),'VEC4',5123),WEIGHTS_0:append.array(new Float32Array(influences.flatMap(w=>Array.from({length:4},(_,i)=>w[i]?.[1]??0))),'VEC4')}
      for(let set=1;set<4;set++) {
        p.attributes[`JOINTS_${set}`]=append.array(new Uint16Array(influences.flatMap(w=>Array.from({length:4},(_,i)=>w[set*4+i]?.[0]??0))),'VEC4',5123)
        p.attributes[`WEIGHTS_${set}`]=append.array(new Float32Array(influences.flatMap(w=>Array.from({length:4},(_,i)=>w[set*4+i]?.[1]??0))),'VEC4')
      }
      const positions=unique.map(v=>v[0]);d.accessors[p.attributes.POSITION].min=[0,1,2].map(c=>Math.min(...positions.map(v=>v[c])));d.accessors[p.attributes.POSITION].max=[0,1,2].map(c=>Math.max(...positions.map(v=>v[c])))
      p.indices=append.array(new Uint32Array(remapped),'SCALAR',5125);count+=remapped.length/3
    }
    const size=[2048,1024,512][level],textures=[]
    for(const image of d.images) {
      const v=source.document.bufferViews[image.bufferView],bytes=source.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)
      const resized=execFileSync(python,['-c','from PIL import Image\nimport io,sys\nim=Image.open(io.BytesIO(sys.stdin.buffer.read()));s=int(sys.argv[1]);im.thumbnail((s,s),Image.Resampling.LANCZOS);o=io.BytesIO();im.save(o,format="PNG");sys.stdout.buffer.write(o.getvalue())',String(size)],{input:bytes,maxBuffer:50*1024*1024})
      image.bufferView=append.bytes(resized);image.mimeType='image/png';textures.push(size)
    }
    const compact=packGlbResources(d,append.binary()),packed=await packFactionHumanoidBuffers({document:d,binary:compact}),bytes=encodeGlb(packed.document,packed.binary),out=`${directory}/lod${level}.glb`
    fs.writeFileSync(out,bytes);files[`lod${level}`]=hash(bytes);triangles[`lod${level}`]=count
    const actual=await decodeMeshoptGlb(readGlb(out)),input=source.document.meshes[0].primitives[0],output=actual.document.meshes[0].primitives[0]
    const preserved={}
    for(const key of [...Object.keys(input.attributes),'indices']) {
      const a=key==='indices'?input.indices:input.attributes[key],b=key==='indices'?output.indices:output.attributes[key]
      preserved[key]=hash(payload(source,a))===hash(payload(actual,b))
    }
    if(level===0&&(count!==def.triangles||['POSITION','NORMAL','TEXCOORD_0','indices'].some(key=>!preserved[key])))throw Error('LOD0 geometry preservation failed')
    lods.push({level,triangles:count,textureMax:size,sha256:hash(bytes),bytes:bytes.length,maxSkinWeightNormalizationError:error,sourceAccessorBytesPreserved:preserved,allBufferViewsByteExact:packed.report.allBufferViewsByteExact,joints:66,animationNames:clips.map(c=>c.name)})
  }
  const left=frames.l,right={...frames.r};delete right.palmContactCenter
  const manifest={schemaVersion:1,id:def.id,status:'ready',skeleton:'project-humanoid-v1',bufferCompression:'EXT_meshopt_compression',source:{title:def.title,sourceFile:def.file,sourceSha256:def.sha,license:'User-supplied Meshy asset; user confirmed use and GitHub redistribution rights, 2026-11-02',licenseEvidence:'attribution-evidence.json'},attribution:`${def.title}: user-supplied Meshy model/textures. Existing SagaBurst animation-source terms retained in animation-donor-manifest.json.`,
    selectedSource:{rig:'mixamo66',uniformScale:1},sharedLodPose:true,handShapeMode:'authored',preserveLodHandTopology:true,
    files:{lod0:'lod0.glb',lod1:'lod1.glb',lod2:'lod2.glb'},fileSha256:files,boneMap:'bone-map.json',audit:'audit.json',
    metrics:{heightM:def.height,overallHeightM:def.height,shoulderWidthM:position(target.scene.getObjectByName('upper_arm_l')).distanceTo(position(target.scene.getObjectByName('upper_arm_r')))*scale,neckLengthM:position(target.scene.getObjectByName('neck')).distanceTo(position(target.scene.getObjectByName('head')))*scale,triangles,textures:{lod0:2048,lod1:1024,lod2:512},uniformScaleAppliedOffline:scale,runtimeScale:[1,1,1]},
    articulatedFingerPoses:{relaxed:fingerPoses.relaxed,grip:fingerPoses.grip},handGripFrames:{left:{palmContactCenter:left.palmContactCenter,palmNormal:left.palmNormalLocal,thumbDir:1,thumbDirection:left.gripAxisLocal,fingerDirection:left.fingerDirection,wristCenter:left.wristCenter,fingerBase:left.fingerBase,thumbBaseCenter:left.thumbBaseCenter}},swordGripFrames:{lod0:right,lod1:right,lod2:right},
    animations:{embedded:bindings,runtimeGenerated:old.animations.runtimeGenerated.filter(name=>!bindings.some(b=>b.clip===name))},animationSources:old.animationSources,
    animationRetarget:{revision,...(deathDonor?{deathDonor}:{}),donor:`${directory}/lod0.glb`,sha256:hash(donorBytes),method:'Existing bakeFactionClips physical-axis pipeline at 30Hz; target-bind absolute finger poses, in-place sole contact; original event metadata and action durations retained.'},
    visualAcceptance:'Requires live game review; structural audit alone does not establish visual acceptance.',knownLimitations:['No dynamic cloth collision. Thirty target-bind finger tracks keep natural and equipment contact poses separate; extreme hand/armour and mounted cloth contact requires visual review.','FPS A/B deliberately deferred by user, 2026-11-02.']}
  if(def.id==='viking-hero-t5') manifest.source.filenameEvidence={
    specificationFilename:'Meshy_AI_viking_warrior_30k_All_Animations(1).glb',
    suppliedAttachmentFilename:def.file,buildInputFilename:def.file,verifiedBuildInputSha256:hash(raw),
    renamedForBuild:false,comparisonFileAvailable:false,
    resolution:'The original conversation attachment and actual Downloads input both omit (1). The user clarified the reviewer filename was likely mistaken on 2026-11-03. Only this supplied file was used; no second (1) file was supplied or found, so byte equality with a differently named file is not asserted.',
  }
  fs.writeFileSync(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
  fs.writeFileSync(`${directory}/animation-donor-manifest.json`,JSON.stringify(old,null,2)+'\n')
  fs.writeFileSync(`${directory}/bone-map.json`,JSON.stringify({skeleton:'project-humanoid-v1',sourceToProject:mapping,skinJointCount:66,sockets,normalization:{scale,ground},sourceInverseBindSha256:hash(payload(source,source.document.skins[0].inverseBindMatrices))},null,2)+'\n')
  fs.writeFileSync(`${directory}/audit.json`,JSON.stringify({builder:'tools/build-meshy-faction-heroes.mjs',sourceSha256:def.sha,sourceTriangles:def.triangles,waistSkinRepairs:skinRepairs,constantTrackAudit,fingerPoseFit: fingerPoses.diagnostics,lod0Policy:'Original vertex, index, normal and UV accessor bytes preserved. Waist leg influences transferred to the existing pelvis; source inverse binds retained. No decimation, remeshing, added/degenerate or hidden triangles.',lods,animationContractPreserved:old.animations.embedded.every(b=>JSON.stringify(manifest.animations.embedded.find(a=>a.clip===b.clip))===JSON.stringify(b)),fps:'Deferred by user; no measurements or performance claim.'},null,2)+'\n')
  fs.writeFileSync(`${directory}/attribution-evidence.json`,JSON.stringify({source:manifest.source,rightsEvidence:'User explicitly confirmed generation/use and GitHub publication rights in this Codex conversation on 2026-11-02.',animationDonor:{revision,manifest:'animation-donor-manifest.json'},sourceDistribution:'Original supplied downloads remain outside the shipped runtime bundle; normalized derivative GLBs only.'},null,2)+'\n')
  fs.writeFileSync(`${directory}/ATTRIBUTION.md`,`# ${def.title}\n\n${manifest.attribution}\n\nUser confirmed use and GitHub redistribution rights on 2026-11-02. This records supplied permission and does not assert CC0 or grant unrelated rights. See attribution-evidence.json, animation-donor-manifest.json and audit.json. Rebuild from the exact user source using tools/build-meshy-faction-heroes.mjs; donor revision ${revision}.\n`)
  console.log(def.id,JSON.stringify({metrics:manifest.metrics,lods:lods.map(({sourceAccessorBytesPreserved,...r})=>r)}))
}
