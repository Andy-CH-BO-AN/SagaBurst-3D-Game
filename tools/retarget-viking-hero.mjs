/** Offline world-rest delta retarget; never edits source clips or gameplay timing. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/viking-hero-t4', sourceDir='public/models/characters/v2/viking'
const original=JSON.parse(fs.readFileSync(`${sourceDir}/manifest.json`)), measured=JSON.parse(fs.readFileSync(`${dir}/blender-measurements.json`))
const sourceAsset=readGlb(`${sourceDir}/lod0.glb`), source=await loadRig(sourceAsset)
source.scene.updateMatrixWorld(true)
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const scale=measured.uniformScaleAppliedInBlender
function retarget(target, clip) {
  target.scene.updateMatrixWorld(true)
  const pairs=[]
  target.scene.traverse(bone=>{
    const from=source.scene.getObjectByName(bone.name)
    if (!bone.isBone || !from?.isBone) return
    pairs.push({bone,from,srcRest:from.getWorldQuaternion(new THREE.Quaternion()).invert(),dstRest:bone.getWorldQuaternion(new THREE.Quaternion()),values:[]})
  })
  const times=[...new Set(clip.tracks.flatMap(t=>Array.from(t.times)))].sort((a,b)=>a-b)
  const mixer=new THREE.AnimationMixer(source.scene),action=mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()
  for(const time of times){
    action.paused=false;mixer.setTime(time);source.scene.updateMatrixWorld(true)
    for(const p of pairs){
      const q=p.from.getWorldQuaternion(new THREE.Quaternion()).multiply(p.srcRest).multiply(p.dstRest)
      p.bone.quaternion.copy(p.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q).normalize())
      p.bone.updateWorldMatrix(false,false)
      const out=p.bone.quaternion.clone()
      if(p.values.length&&out.dot(new THREE.Quaternion().fromArray(p.values,p.values.length-4))<0)out.set(-out.x,-out.y,-out.z,-out.w)
      p.values.push(...out.toArray())
    }
  }
  mixer.stopAllAction()
  return new THREE.AnimationClip(clip.name,clip.duration,pairs.map(p=>new THREE.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`,times,p.values)))
}
for(let lod=0;lod<3;lod++){
  const path=`${dir}/lod${lod}.glb`,asset=readGlb(path),target=await loadRig(asset)
  const rest=new Map();target.scene.traverse(o=>rest.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()}))
  const reset=()=>{for(const[o,t]of rest){o.position.copy(t.p);o.quaternion.copy(t.q);o.scale.copy(t.s)}target.scene.updateMatrixWorld(true)}
  const clips=source.animations.map(clip=>{reset();return retarget(target,clip)})
  reset()
  const idle=clips.find(c=>c.name==='idle')
  const mounted=new THREE.AnimationClip('mounted',idle.duration,idle.tracks.filter(t=>/^(spine|chest|upper_chest|clavicle_|upper_arm_|lower_arm_|hand_|neck|head)/.test(t.name)))
  clips.push(mounted)
  // Existing deterministic death profile baked to hero size and rest basis.
  const death=new THREE.AnimationClip('death',1,[])
  for(const[name,angles]of[['hips',[0,.15,1.35]],['spine',[0,.1,.25]]]){
    const b=target.scene.getObjectByName(name),q=rest.get(b).q
    death.tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0,.25,1],angles.flatMap(a=>q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a,0,0))).toArray())))
  }
  const hip=rest.get(target.scene.getObjectByName('hips')).p
  death.tracks.push(new THREE.VectorKeyframeTrack('hips.position',[0,.25,1],[0,-.24,-.62].flatMap(y=>hip.clone().add(new THREE.Vector3(0,y*scale,0)).toArray())))
  // Preserve the death body's profile while allowing the ankles to settle flat,
  // otherwise rigid vertical boot toes hold the whole prone body above ground.
  reset()
  const footRest=Object.fromEntries(['foot_l','foot_r'].map(name=>[name,target.scene.getObjectByName(name).getWorldQuaternion(new THREE.Quaternion())]))
  const deathMixer=new THREE.AnimationMixer(target.scene),deathAction=deathMixer.clipAction(death)
  deathAction.setLoop(THREE.LoopOnce,1);deathAction.clampWhenFinished=true;deathAction.play()
  const footTimes=[0,.25,.5,.75,1],footValues={foot_l:[],foot_r:[]}
  for(const time of footTimes){
    deathAction.paused=false;deathMixer.setTime(time);target.scene.updateMatrixWorld(true)
    for(const name of ['foot_l','foot_r']){
      const bone=target.scene.getObjectByName(name),world=bone.getWorldQuaternion(new THREE.Quaternion())
      const weight=Math.min(1,time/.85);world.slerp(footRest[name],weight*weight*(3-2*weight))
      footValues[name].push(...bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).toArray())
    }
  }
  deathMixer.stopAllAction()
  for(const name of ['foot_l','foot_r'])death.tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,footTimes,footValues[name]))
  clips.push(death);reset()
  // Hero-only cloth motion: no physics and no modification of shared source clips.
  // The riding pose lifts the hem behind the saddle; upper folds follow the torso.
  for(const clip of clips){
    reset()
    const names=['cape_upper','cape_mid','cape_lower']
    const bases=Object.fromEntries(names.map(n=>[n,target.scene.getObjectByName(n).getWorldQuaternion(new THREE.Quaternion())]))
    const chestRestInverse=target.scene.getObjectByName('chest').getWorldQuaternion(new THREE.Quaternion()).invert()
    const times=Array.from({length:25},(_,i)=>i*clip.duration/24),values=Object.fromEntries(names.map(n=>[n,[]]))
    const clothMixer=new THREE.AnimationMixer(target.scene),clothAction=clothMixer.clipAction(clip)
    clothAction.setLoop(THREE.LoopOnce,1);clothAction.clampWhenFinished=true;clothAction.play()
    for(const time of times){
      reset();clothAction.paused=false;clothMixer.setTime(time);target.scene.updateMatrixWorld(true)
      for(const [i,name]of names.entries()){
        const bone=target.scene.getObjectByName(name),phase=time/clip.duration*Math.PI*2
        const lift=clip.name==='mounted'?[.40,.65,.30][i]:clip.name==='death'?(-.18-i*.04)*Math.min(1,time/.85):[0,-.08,-.02][i]
        const swing=(clip.name==='run'?.09:clip.name==='walk'?.065:.025)*Math.sin(phase-i*.6)
        const world=new THREE.Quaternion().setFromEuler(new THREE.Euler(lift+swing,0,.012*Math.sin(phase+i))).multiply(bases[name])
        world.premultiply(target.scene.getObjectByName('chest').getWorldQuaternion(new THREE.Quaternion()).multiply(chestRestInverse))
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world))
        bone.updateWorldMatrix(false,false);values[name].push(...bone.quaternion.toArray())
      }
    }
    clothMixer.stopAllAction()
    for(const name of names)clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,times,values[name]))
  }
  reset()
  // Offline contact bake: preserve rotation/time samples and move only hero pelvis.
  // Contact is measured from the exported weighted boot vertices, never a manifest guess.
  const skinMeshes=[];target.scene.traverse(o=>{if(o.isSkinnedMesh)skinMeshes.push(o)})
  const soles=skinMeshes.flatMap(mesh=>{
    const idx=mesh.geometry.attributes.skinIndex,w=mesh.geometry.attributes.skinWeight,indices=[]
    for(let i=0;i<idx.count;i++) {
      let weight=0;for(let j=0;j<4;j++)if(/^(foot_|toe_)/.test(mesh.skeleton.bones[idx.getComponent(i,j)]?.name??''))weight+=w.getComponent(i,j)
      if(weight>.7)indices.push(i)
    }
    return indices.length?[{mesh,indices}]:[]
  })
  for(const clip of clips) {
    if(clip.name==='mounted')continue
    reset()
    const mixer=new THREE.AnimationMixer(target.scene),action=mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()
    const times=[...new Set([0,clip.duration,...clip.tracks.flatMap(t=>Array.from(t.times))])].sort((a,b)=>a-b)
    const values=[],hips=target.scene.getObjectByName('hips'),p=new THREE.Vector3()
    for(const time of times) {
      hips.position.copy(rest.get(hips).p)
      action.paused=false;mixer.setTime(time);target.scene.updateMatrixWorld(true)
      for(const mesh of skinMeshes)mesh.skeleton.update()
      let min=Infinity
      const candidates=clip.name==='death'?skinMeshes.map(mesh=>({mesh,indices:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i)})):soles
      for(const{mesh,indices}of candidates)for(const i of indices){
        p.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,p);p.applyMatrix4(mesh.matrixWorld);min=Math.min(min,p.y)
      }
      if(!Number.isFinite(min))throw Error('No finite hero ground contact')
      values.push(hips.position.x,hips.position.y-min+.003,hips.position.z)
    }
    mixer.stopAllAction()
    clip.tracks=clip.tracks.filter(t=>t.name!=='hips.position')
    clip.tracks.push(new THREE.VectorKeyframeTrack('hips.position',times,values))
  }
  reset()
  const doc=asset.document,chunks=[asset.binary];let offset=asset.binary.length
  function append(values,type){
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
    const buffer=Buffer.from(values.buffer,values.byteOffset,values.byteLength),view=doc.bufferViews.length
    doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});chunks.push(buffer);offset+=buffer.length
    const accessor={bufferView:view,componentType:5126,count:values.length/(type==='SCALAR'?1:type==='VEC3'?3:4),type}
    if(type==='SCALAR'){accessor.min=[values[0]];accessor.max=[values.at(-1)]}
    doc.accessors.push(accessor);return doc.accessors.length-1
  }
  doc.animations=clips.map(clip=>{
    const samplers=[],channels=[]
    for(const t of clip.tracks){const [name,prop]=t.name.split('.');const node=doc.nodes.findIndex(n=>n.name===name);if(node<0)throw Error(name)
      channels.push({sampler:samplers.length,target:{node,path:prop==='position'?'translation':'rotation'}})
      samplers.push({input:append(t.times,'SCALAR'),output:append(t.values,prop==='position'?'VEC3':'VEC4'),interpolation:'LINEAR'})
    }return{name:clip.name,samplers,channels}
  })
  doc.buffers[0].byteLength=offset;fs.writeFileSync(path,encodeGlb(doc,Buffer.concat(chunks)))
}
// All LODs use the LOD0 hand basis. No faction calibration data is changed.
const scaleFrame=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k, ['gripCenterLocal','palmContactCenter','wristCenter','thumbBaseCenter'].includes(k)?v.map(x=>x*scale):['fingerBase','gripRadius'].includes(k)?v*scale:v]))
measured.authoringTriangles=measured.triangles
measured.triangles=Object.fromEntries([0,1,2].map(lod=>{const doc=readGlb(`${dir}/lod${lod}.glb`).document;return [`lod${lod}`,doc.meshes.flatMap(mesh=>mesh.primitives).reduce((sum,p)=>sum+doc.accessors[p.indices??p.attributes.POSITION].count/3,0)]}))
const manifest={schemaVersion:1,id:'viking-hero-t4',status:'ready',source:original.source,attribution:original.attribution,modifications:['Retained original face/neck, hands, continuous undershirt and boot shapes; reconstructed missing scalp; original overlapping vest, helmet dome, liner and cheek plates removed; source fitted spectacle/nasal guard retained and refinished; new skirt, continuous legs, cloak and conical helmet authored by the reproducible Blender builder','Metre-space body/shoulder rest adjustment and world-rest delta offline animation retarget','Boot shaft and original shoe fused with rounded ankle transition and shared ankle weights; chainmail and helmet share metal base color/metalness/roughness; thigh-envelope panels use matching leg deformation weights','Split thigh-weighted hauberk; blue-violet skinned cloak restored by user request; original short facial hair, no long beard'],metrics:measured,files:{lod0:'lod0.glb',lod1:'lod1.glb',lod2:'lod2.glb'},skeleton:'project-humanoid-v1',boneMap:'bone-map.json',audit:'audit.json',handGripFrames:{left:scaleFrame(original.handGripFrames.left)},swordGripFrames:Object.fromEntries([0,1,2].map(i=>[`lod${i}`,scaleFrame(original.swordGripFrames.lod0)])),animations:{embedded:[...original.animations.embedded,{clip:'mounted',source:'Kevin Iglesias',sourceClip:'idle upper body for existing mounted pose',loop:true,duration:2.7},{clip:'death',source:'SagaBurst',sourceClip:'existing procedural death baked to hero',loop:false,duration:1}],runtimeGenerated:original.animations.runtimeGenerated.filter(x=>!['mounted','death'].includes(x))},animationSources:original.animationSources,axeAttackBuild:original.axeAttackBuild,attachmentOffsets:{blackCatPelvis:[0,.09,0]},visualAcceptance:'pending browser inspection',fileSha256:Object.fromEntries([0,1,2].map(i=>[`lod${i}`,hash(`${dir}/lod${i}.glb`)]))}
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
const map=JSON.parse(fs.readFileSync(`${sourceDir}/bone-map.json`));map.additionalBones=["cape_upper","cape_mid","cape_lower"];fs.writeFileSync(`${dir}/bone-map.json`,JSON.stringify(map,null,2)+'\n')
fs.copyFileSync(`${sourceDir}/attribution-evidence.json`,`${dir}/attribution-evidence.json`)
fs.writeFileSync(`${dir}/ATTRIBUTION.md`,`# Viking hero T4\n\n${original.attribution}\n\nSource and permission evidence: attribution-evidence.json. Base input: ../viking/lod0.glb (SHA-256 ${hash(`${sourceDir}/lod0.glb`)}). Original face/neck, hands, continuous undershirt and boots retained; closed anatomical scalp authored beneath the helmet. Newly authored helmet, mail and clothing follow the user-provided reference; no reference-image pixels are embedded. Mathematical chainmail/weave/normal textures are generated by tools/build-viking-hero.py.\n\nAnimation provenance and source hashes remain in manifest.json; original licensed FBX files are not redistributed. Kevin Iglesias / Unity Asset Store EULA; Quaternius / CC0.\n`)
console.log(JSON.stringify({metrics:measured,fileSha256:manifest.fileSha256},null,2))
