/** Run immediately after a clean build-roman-hero.mjs. Existing rotations,
 * names, durations and events are preserved. Contact is baked to hero hips.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/roman-hero-t4'
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`))
for(let lod=0;lod<3;lod++){
  const path=`${dir}/lod${lod}.glb`,asset=readGlb(path),doc=asset.document
  if(doc.asset.extras.romanHeroContactBake)throw Error('Rebuild clean hero GLBs before contact bake')
  const gltf=await loadRig(asset),rest=new Map(),meshes=[]
  gltf.scene.traverse(o=>{rest.set(o,{p:o.position.clone(),q:o.quaternion.clone()});if(o.isMesh)meshes.push(o)})
  const reset=()=>{for(const[o,t]of rest){o.position.copy(t.p);o.quaternion.copy(t.q)}gltf.scene.updateMatrixWorld(true)}
  reset()
  const clips=gltf.animations.map(c=>c.clone()),idle=clips.find(c=>c.name==='idle')
  clips.push(new THREE.AnimationClip('mounted',idle.duration,idle.tracks.filter(t=>/^(spine|chest|upper_chest|clavicle_|upper_arm_|lower_arm_|hand_|neck|head)/.test(t.name)).map(t=>t.clone())))
  const death=new THREE.AnimationClip('death',1,[]),hip=gltf.scene.getObjectByName('hips')
  // Existing project death pitch/drop, applied to this rig's actual rest basis.
  // Hold the original idle arms, avoiding a new T-pose as the action starts.
  for(const t of idle.tracks)if(/^(upper_arm_|lower_arm_|hand_|clavicle_|neck|head)/.test(t.name))
    death.tracks.push(new THREE.QuaternionKeyframeTrack(t.name,[0,1],[...t.values.slice(0,4),...t.values.slice(0,4)]))
  for(const[name,angles]of[['hips',[0,.15,1.35]],['spine',[0,.1,.25]]]){
    const q=rest.get(gltf.scene.getObjectByName(name)).q
    death.tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0,.25,1],angles.flatMap(a=>q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a,0,0))).toArray())))
  }
  death.tracks.push(new THREE.VectorKeyframeTrack('hips.position',[0,.25,1],[0,-.24,-.62].flatMap(y=>rest.get(hip).p.clone().add(new THREE.Vector3(0,y*manifest.metrics.uniformScaleAppliedOffline,0)).toArray())))
  // The source profile leaves toes vertical at the end of the fall. Settle
  // hero ankles gradually towards their world-rest orientation, as in Viking.
  const feet=['foot_l','foot_r'],footRest=Object.fromEntries(feet.map(n=>[n,gltf.scene.getObjectByName(n).getWorldQuaternion(new THREE.Quaternion())]))
  const fm=new THREE.AnimationMixer(gltf.scene),fa=fm.clipAction(death);fa.setLoop(THREE.LoopOnce,1);fa.clampWhenFinished=true;fa.play()
  const ft=Array.from({length:31},(_,i)=>i/30),fv=Object.fromEntries(feet.map(n=>[n,[]]))
  for(const t of ft){fa.paused=false;fm.setTime(t);gltf.scene.updateMatrixWorld(true)
    for(const n of feet){const b=gltf.scene.getObjectByName(n),f=Math.min(1,t/.85),q=b.getWorldQuaternion(new THREE.Quaternion()).slerp(footRest[n],f*f*(3-2*f));fv[n].push(...b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q).toArray())}
  }
  fm.stopAllAction();reset()
  for(const n of feet)death.tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`,ft,fv[n]))
  clips.push(death)
  const soles=meshes.filter(m=>m.isSkinnedMesh).flatMap(mesh=>{
    const indices=[],idx=mesh.geometry.attributes.skinIndex,w=mesh.geometry.attributes.skinWeight
    for(let i=0;i<idx.count;i++){let sum=0;for(let j=0;j<4;j++)if(/^(foot_|toe_)/.test(mesh.skeleton.bones[idx.getComponent(i,j)]?.name??''))sum+=w.getComponent(i,j);if(sum>.7||/^(Boots|New_legs)$/.test(mesh.name))indices.push(i)}
    return indices.length?[{mesh,indices}]:[]
  })
  for(const clip of clips){
    if(!['idle','walk','run','swordSlash','death'].includes(clip.name))continue
    reset()
    const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()
    const count=Math.round(clip.duration*120),times=Array.from({length:count+1},(_,i)=>i/count*clip.duration),values=[],p=new THREE.Vector3()
    const candidates=clip.name==='death'?meshes.map(mesh=>({mesh,indices:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i)})):soles
    for(const t of times){
      action.paused=false;mixer.setTime(t);gltf.scene.updateMatrixWorld(true)
      for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update()
      let min=Infinity
      for(const{mesh,indices}of candidates)for(const i of indices){mesh.getVertexPosition(i,p);p.applyMatrix4(mesh.matrixWorld);min=Math.min(min,p.y)}
      if(!Number.isFinite(min))throw Error('Missing contact vertices')
      values.push(hip.position.x,hip.position.y-min+.003,hip.position.z)
    }
    mixer.stopAllAction()
    clip.tracks=clip.tracks.filter(t=>t.name!=='hips.position')
    clip.tracks.push(new THREE.VectorKeyframeTrack('hips.position',times,values))
  }
  const chunks=[asset.binary];let offset=asset.binary.length
  function append(values,type){
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
    const bytes=Buffer.from(values.buffer,values.byteOffset,values.byteLength),view=doc.bufferViews.length
    doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(bytes);offset+=bytes.length
    const a={bufferView:view,componentType:5126,count:values.length/(type==='SCALAR'?1:type==='VEC3'?3:4),type}
    if(type==='SCALAR'){a.min=[values[0]];a.max=[values.at(-1)]}
    doc.accessors.push(a);return doc.accessors.length-1
  }
  doc.animations=clips.map(clip=>{
    const samplers=[],channels=[]
    for(const t of clip.tracks){const[name,prop]=t.name.split('.'),node=doc.nodes.findIndex(n=>n.name===name);if(node<0)throw Error(name)
      channels.push({sampler:samplers.length,target:{node,path:prop==='position'?'translation':'rotation'}})
      samplers.push({input:append(t.times,'SCALAR'),output:append(t.values,prop==='position'?'VEC3':'VEC4'),interpolation:'LINEAR'})
    }return{name:clip.name,samplers,channels}
  })
  doc.buffers[0].byteLength=offset;doc.asset.extras.romanHeroContactBake={fps:120,contactM:.003,sourceRotationsPreserved:true}
  fs.writeFileSync(path,encodeGlb(doc,Buffer.concat(chunks)))
  const sha=createHash('sha256').update(fs.readFileSync(path)).digest('hex')
  manifest.fileSha256[`lod${lod}`]=sha
  Object.assign(manifest.lodMeasurements[lod],{sha256:sha,bytes:fs.statSync(path).size})
}
manifest.animations.embedded.push({clip:'mounted',source:'Kevin Iglesias',sourceClip:'Original idle upper body, existing runtime mounted legs',loop:true,duration:2.7},
  {clip:'death',source:'SagaBurst',sourceClip:'Existing project death pitch/drop baked to hero rest frame and floor',loop:false,duration:1})
manifest.animations.runtimeGenerated=manifest.animations.runtimeGenerated.filter(n=>!['mounted','death'].includes(n))
manifest.modifications.push('Hero-only offline pelvis floor contact for idle/walk/run/swordSlash/death; existing mounted upper-body binding and project death profile baked without changing source clips or event times')
manifest.modifications.push('Review refinements: dark eye rims; clean UV-bounded gold bosses and continuous trim; dark navy front/back; shoulder cloth clearance with matching pauldron weights; bracers shortened below elbows and bound to forearms. All repairs confined to this hero.')
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({fileSha256:manifest.fileSha256}))
