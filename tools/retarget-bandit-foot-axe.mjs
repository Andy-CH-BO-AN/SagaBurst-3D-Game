/** Reuse the shipped Fantasy Bandit strike, only for selected foot 1H axes.
 * Append a clip; preserve all original clips/buffers and the mounted path.
 * Run after the source asset/LOD builders. No Bandit input is modified. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as T from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
import { frozenBanditDirectory, FROZEN_BANDIT_ASSET, FROZEN_BANDIT_COMMIT, FROZEN_BANDIT_SHA256 } from './lib/frozen-bandit-donor.mjs'
const hash = b => createHash('sha256').update(b).digest('hex')
const sourcePath = path.join(frozenBanditDirectory(), 'lod0.glb')
const sourceHash = hash(fs.readFileSync(sourcePath))
const sourceManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(sourcePath),'manifest.json')))
if (sourceHash !== FROZEN_BANDIT_SHA256 || sourceManifest.fileSha256.lod0 !== sourceHash) throw Error('Bandit source hash mismatch')
const source = await loadRig(readGlb(sourcePath)), sourceClip = source.animations.find(a=>a.name==='swordSlash')
const names = ['spine','chest','upper_chest','neck','head','upper_arm_r','lower_arm_r','hand_r']
const pos = n=>n.getWorldPosition(new T.Vector3()), quat=n=>n.getWorldQuaternion(new T.Quaternion())
const basis = (along,front)=>{const y=along.clone().normalize(),z=front.clone().addScaledVector(y,-front.dot(y)).normalize(),x=new T.Vector3().crossVectors(y,z);return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z))}
const gripBasis = (shaft,finger)=>{const y=shaft.clone().normalize(),x=finger.clone().addScaledVector(y,-finger.dot(y)).normalize();return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,new T.Vector3().crossVectors(x,y)))}
source.scene.updateMatrixWorld(true)
const sourceRest=Object.fromEntries(names.map(n=>[n,{q:quat(source.scene.getObjectByName(n)),p:pos(source.scene.getObjectByName(n))}]))
const hand=source.scene.getObjectByName('hand_r')
const sourceGrip=quat(hand).invert().multiply(gripBasis(pos(source.scene.getObjectByName('hammer_tip')).sub(pos(source.scene.getObjectByName('hammer_grip'))),pos(source.scene.getObjectByName('RightHandMiddle1')).sub(pos(hand))))
const mixMap={hips:'Hips',spine:'Spine',chest:'Spine1',upper_chest:'Spine2',neck:'Neck',head:'Head',upper_arm_r:'RightArm',lower_arm_r:'RightForeArm',hand_r:'RightHand'}
const smooth=x=>{const v=T.MathUtils.clamp(x,0,1);return v*v*(3-2*v)}
for(const id of (process.argv[2]??'viking,roman,viking-hero-t4,roman-hero-t5,viking-hero-t5').split(',')){
 const dir=`public/models/characters/v2/${id}`, manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`))
 const binding=manifest.animations.embedded.find(a=>a.clip==='axeAttack1H'),duration=binding.duration,hit=binding.events.hit
 for(let lod=0;lod<3;lod++){
  const file=`${dir}/lod${lod}.glb`,raw=readGlb(file),doc=structuredClone(raw.document)
  const previous=doc.asset.extras?.banditFootAxe
  // Own append checkpoint makes repeated bakes byte deterministic.
  const base=previous?.preservedPayload??{bytes:raw.binary.length,accessors:doc.accessors.length,bufferViews:doc.bufferViews.length}
  doc.accessors.length=base.accessors;doc.bufferViews.length=base.bufferViews
  doc.animations=doc.animations.filter(a=>a.name!=='axeAttack1HFoot')
  const target=await loadRig({document:doc,binary:raw.binary.subarray(0,base.bytes)})
  target.scene.updateMatrixWorld(true)
  const node=n=>target.scene.getObjectByName(manifest.selectedSource.rig==='mixamo66'?'mixamorig'+mixMap[n]:n)
  const frame=manifest.swordGripFrames[`lod${lod}`]
  const targetGrip=gripBasis(new T.Vector3(...frame.gripAxisLocal),new T.Vector3(...frame.fingerDirection))
  const pairs=names.filter(n=>node(n)).map(name=>{
   const bone=node(name),targetRest=quat(bone),from=source.scene.getObjectByName(name)
   let conversion=sourceRest[name].q.clone().invert().multiply(targetRest)
   if(name==='hand_r')conversion=sourceGrip.clone().multiply(targetGrip.clone().invert())
   else if(name==='upper_arm_r'||name==='lower_arm_r'){
    const next=name==='upper_arm_r'?'lower_arm_r':'hand_r'
    conversion=sourceRest[name].q.clone().invert().multiply(basis(sourceRest[next].p.clone().sub(sourceRest[name].p),new T.Vector3(0,0,1)))
     .multiply(basis(pos(node(next)).sub(pos(bone)),new T.Vector3(0,0,1)).invert()).multiply(targetRest)
   }
   return {name,bone,from,conversion}
  })
  const sm=new T.AnimationMixer(source.scene),sa=sm.clipAction(sourceClip);sa.setLoop(T.LoopOnce,1);sa.clampWhenFinished=true;sa.play()
  const tm=new T.AnimationMixer(target.scene),idle=target.animations.find(a=>a.name==='idle'),ia=tm.clipAction(idle);ia.play()
  // Track all idle-owned properties so unrelated fingers/helpers stay authored.
  const records=new Map(idle.tracks.map(t=>[t.name,{node:target.scene.getObjectByName(t.name.slice(0,t.name.lastIndexOf('.'))),property:t.name.slice(t.name.lastIndexOf('.')+1),values:[]}]))
  for(const p of pairs)records.set(`${p.bone.name}.quaternion`,{node:p.bone,property:'quaternion',values:[]})
  const times=[],count=120
  for(let i=0;i<=count;i++){
   const t=i/count*duration,seconds=t/duration*.48
   const sourceTime=t<=hit?t/hit*.252:.252+(t-hit)/(duration-hit)*(.48-.252)
   sa.paused=false;sm.setTime(sourceTime);source.scene.updateMatrixWorld(true)
   tm.setTime(t/duration*Math.min(idle.duration,.8));target.scene.updateMatrixWorld(true)
   const weight=smooth(seconds/.08)*(1-smooth((seconds-.39)/.09))
   for(const p of pairs){
    const q=quat(p.bone.parent).invert().multiply(quat(p.from).multiply(p.conversion)).normalize()
    p.bone.quaternion.slerp(q,weight);p.bone.updateWorldMatrix(false,true)
   }
   for(const r of records.values()){
    const value=r.node[r.property].toArray()
    if(r.property==='quaternion'&&r.values.length&&new T.Quaternion(...value).dot(new T.Quaternion().fromArray(r.values,r.values.length-4))<0)for(let j=0;j<4;j++)value[j]*=-1
    if(value.some(v=>!Number.isFinite(v)))throw Error(`${id} invalid ${r.node.name}`)
    r.values.push(...value)
   }
   times.push(t)
  }
  sm.stopAllAction();tm.stopAllAction()
  const chunks=[raw.binary.subarray(0,base.bytes)];let offset=base.bytes
  const append=(v,type)=>{const a=new Float32Array(v),b=Buffer.from(a.buffer);doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});offset+=b.length;chunks.push(b);const accessor={bufferView:doc.bufferViews.length-1,componentType:5126,count:v.length/({SCALAR:1,VEC3:3,VEC4:4}[type]),type};if(type==='SCALAR'){accessor.min=[v[0]];accessor.max=[v.at(-1)]}doc.accessors.push(accessor);return doc.accessors.length-1}
  const input=append(times,'SCALAR'),samplers=[],channels=[]
  for(const r of records.values()){
   const nodeIndex=target.parser.associations.get(r.node)?.nodes??doc.nodes.findIndex(n=>n.name===r.node.name);if(nodeIndex<0)throw Error('Missing original node '+r.node.name)
   const path={quaternion:'rotation',position:'translation',scale:'scale'}[r.property];if(!path)throw Error(r.property)
   channels.push({sampler:samplers.length,target:{node:nodeIndex,path}});samplers.push({input,output:append(r.values,r.property==='quaternion'?'VEC4':'VEC3'),interpolation:'LINEAR'})
  }
  doc.animations.push({name:'axeAttack1HFoot',samplers,channels});doc.buffers[0].byteLength=offset
  doc.asset.extras??={};doc.asset.extras.banditFootAxe={version:1,preservedPayload:base,inputSha256:previous?.inputSha256??hash(fs.readFileSync(file)),sourceSha256:sourceHash,sourceCommit:FROZEN_BANDIT_COMMIT,sourceClip:'swordSlash',rootMotion:'Target idle hips and legs; no whole-body yaw correction',timing:{duration,hit,sourceHit:.252}}
  const output=encodeGlb(doc,Buffer.concat(chunks));fs.writeFileSync(file,output);manifest.fileSha256[`lod${lod}`]=hash(output)
  if(manifest.lodMeasurements?.[lod])Object.assign(manifest.lodMeasurements[lod],{sha256:hash(output),bytes:output.length})
 }
 const sourceBinding=sourceManifest.animations.embedded.find(a=>a.clip==='swordSlash')
 manifest.animations.embedded=manifest.animations.embedded.filter(a=>a.clip!=='axeAttack1HFoot')
 manifest.animations.embedded.push({...sourceBinding,clip:'axeAttack1HFoot',duration,meleeCycleSeconds:binding.meleeCycleSeconds,events:{...binding.events}})
 manifest.banditFootAxe={sourceAsset:FROZEN_BANDIT_ASSET,sourceSha256:sourceHash,sourceCommit:FROZEN_BANDIT_COMMIT,sourceClip:'swordSlash',source:sourceManifest.source,retarget:'Anatomical limb axes and thumb/finger grasp; target idle pelvis and legs; original 1H event clock retained',rebuild:'node tools/retarget-bandit-foot-axe.mjs'}
 const auditPath=`${dir}/lod-audit.json`
 if(fs.existsSync(auditPath)){const audit=JSON.parse(fs.readFileSync(auditPath));for(const entry of audit.lods??[]){entry.bytes=fs.statSync(`${dir}/lod${entry.level}.glb`).size;entry.banditFootAxeSha256=manifest.fileSha256[`lod${entry.level}`]}fs.writeFileSync(auditPath,JSON.stringify(audit,null,2)+'\n')}
 fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');console.log(id,'Bandit foot 1H appended in all LODs')
}
