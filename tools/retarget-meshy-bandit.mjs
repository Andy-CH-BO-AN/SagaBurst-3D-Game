/** Offline anatomical retarget; source body is never shipped or loaded at runtime.
 * Run build-meshy-bandit.py first. Immutable donor is recovered from Git below.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as T from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
const root='public/models/characters/v2/bandit', work='output/meshy-bandit', donorDir='output/meshy-bandit-donor'
const donorCommit='bb517258398423039a7a0dfa983681322c92a51d', donorHash='76244820ef8c5e1304ef2ac2e3f246958c8d2f47b50ef0f7bcab72249e5f575c'
const hash=b=>createHash('sha256').update(b).digest('hex')
fs.mkdirSync(donorDir,{recursive:true})
for(const name of ['lod0.glb','lod1.glb','lod2.glb','manifest.json']) if(!fs.existsSync(`${donorDir}/${name}`))fs.writeFileSync(`${donorDir}/${name}`,execFileSync('git',['show',`${donorCommit}:${root}/${name}`],{maxBuffer:100*1024*1024}))
if(hash(fs.readFileSync(`${donorDir}/lod0.glb`))!==donorHash)throw Error('Immutable Bandit donor mismatch')
const sourceRaw=readGlb(`${donorDir}/lod0.glb`), source=await loadRig(sourceRaw)
if(hash(fs.readFileSync(`${donorDir}/manifest.json`))!=='71d2cc3a3c6a281c09d9031406f44aeba47202ca5896ea349b1fc9e0dcd8c637')throw Error('Immutable donor manifest mismatch')
const oldManifest=JSON.parse(fs.readFileSync(`${donorDir}/manifest.json`))
const pos=n=>n.getWorldPosition(new T.Vector3()), rot=n=>n.getWorldQuaternion(new T.Quaternion())
const node=(s,n)=>{const o=s.getObjectByName(n);if(!o)throw Error(`Missing ${n}`);return o}
const basis=(along,front=new T.Vector3(0,0,1))=>{const y=along.clone().normalize(),z=front.clone().addScaledVector(y,-front.dot(y)).normalize(),x=new T.Vector3().crossVectors(y,z).normalize();return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,new T.Vector3().crossVectors(x,y)))}
const names=['hips','spine','chest','upper_chest','neck','head',...['l','r'].flatMap(s=>['clavicle','upper_arm','lower_arm','hand','upper_leg','lower_leg','foot','toe'].map(n=>`${n}_${s}`))]
const next={};for(const s of ['l','r']){for(const [a,b]of [['clavicle','upper_arm'],['upper_arm','lower_arm'],['lower_arm','hand'],['upper_leg','lower_leg'],['lower_leg','foot'],['foot','toe']])next[`${a}_${s}`]=`${b}_${s}`}
source.scene.updateMatrixWorld(true)
const srcRest=Object.fromEntries(names.map(n=>[n,{p:pos(node(source.scene,n)),q:rot(node(source.scene,n))}]))
const srcHipLocal=node(source.scene,'hips').position.clone()
function skinBounds(scene){const box=new T.Box3();scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld))}});return box}
const results=[]
for(let lod=0;lod<3;lod++){
 const hammerRaw=readGlb(`${donorDir}/lod${lod}.glb`)
 if(hash(fs.readFileSync(`${donorDir}/lod${lod}.glb`))!==oldManifest.fileSha256[`lod${lod}`])throw Error('Hammer donor hash mismatch')
 const raw=readGlb(`${work}/body-lod${lod}.glb`),doc=structuredClone(raw.document),target=await loadRig(raw)
 target.scene.updateMatrixWorld(true)
 const targetRest=Object.fromEntries(names.map(n=>[n,{p:pos(node(target.scene,n)),q:rot(node(target.scene,n))}]))
 const pairs=[];target.scene.traverse(bone=>{if(!names.includes(bone.name))return;const n=bone.name,from=node(source.scene,n);let conversion=srcRest[n].q.clone().invert().multiply(targetRest[n].q)
  if(next[n])conversion=srcRest[n].q.clone().invert().multiply(basis(srcRest[next[n]].p.clone().sub(srcRest[n].p))).multiply(basis(targetRest[next[n]].p.clone().sub(targetRest[n].p)).invert()).multiply(targetRest[n].q)
  if(n.startsWith('hand_')){const side=n.endsWith('r')?'Right':'Left';const sourceAlong=pos(node(source.scene,`${side}HandMiddle1`)).sub(srcRest[n].p);const targetAlong=new T.Vector3(0,1,0).applyQuaternion(targetRest[n].q);conversion=srcRest[n].q.clone().invert().multiply(basis(sourceAlong)).multiply(basis(targetAlong).invert()).multiply(targetRest[n].q)}
  pairs.push({bone,from,conversion})
 })
 const chunks=[raw.binary];let offset=raw.binary.length
 function bytes(b){const padding=(-offset)&3;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}const idx=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});chunks.push(b);offset+=b.length;return idx}
 function append(values,type){const array=new Float32Array(values),index=doc.accessors.length;const a={bufferView:bytes(Buffer.from(array.buffer)),componentType:5126,count:values.length/({SCALAR:1,VEC3:3,VEC4:4}[type]),type};if(type==='SCALAR'){a.min=[values[0]];a.max=[values.at(-1)]}doc.accessors.push(a);return index}
 // Copy only original hammer dependencies. Do not retain the donor body's bytes.
 const maps={};function copy(kind,index){if(index===undefined)return undefined;const map=maps[kind]??=new Map();if(map.has(index))return map.get(index);const v=structuredClone(hammerRaw.document[kind][index]);doc[kind]??=[];const dest=doc[kind].length;map.set(index,dest);doc[kind].push(v)
  if(kind==='bufferViews'){const start=v.byteOffset??0;const data=hammerRaw.binary.subarray(start,start+v.byteLength);const padding=(-offset)&3;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}v.buffer=0;v.byteOffset=offset;chunks.push(data);offset+=data.length}
  if(kind==='accessors')v.bufferView=copy('bufferViews',v.bufferView)
  if(kind==='images')v.bufferView=copy('bufferViews',v.bufferView)
  if(kind==='textures'){v.source=copy('images',v.source);v.sampler=copy('samplers',v.sampler)}
  if(kind==='materials'){for(const k of ['normalTexture','occlusionTexture','emissiveTexture'])if(v[k])v[k].index=copy('textures',v[k].index);for(const k of ['baseColorTexture','metallicRoughnessTexture'])if(v.pbrMetallicRoughness?.[k])v.pbrMetallicRoughness[k].index=copy('textures',v.pbrMetallicRoughness[k].index)}
  if(kind==='meshes')for(const p of v.primitives){for(const k of Object.keys(p.attributes))p.attributes[k]=copy('accessors',p.attributes[k]);p.indices=copy('accessors',p.indices);p.material=copy('materials',p.material)}
  return dest
 }
 const handPair=pairs.find(p=>p.bone.name==='hand_r'), handIndex=doc.nodes.findIndex(n=>n.name==='hand_r')
 const oldHand=node(source.scene,'hand_r'), oldGrip=oldHand.worldToLocal(pos(node(source.scene,'hammer_grip')))
 // Palm midpoint follows the authored hand's longitudinal +Y axis; no invented finger bone.
 const grip=new T.Vector3(.015,.09,0), inverse=handPair.conversion.clone().invert()
 for(const name of ['Bandit_Hammer','hammer_grip','hammer_tip']){const obj=node(source.scene,name),p=oldHand.worldToLocal(pos(obj)).sub(oldGrip).applyQuaternion(inverse).add(grip),q=inverse.clone().multiply(rot(oldHand).invert().multiply(rot(obj)));const n={name,translation:p.toArray(),rotation:q.toArray(),scale:obj.scale.toArray()};if(obj.isMesh){const oldNode=hammerRaw.document.nodes.find(n=>n.name===name);n.mesh=copy('meshes',oldNode.mesh)}(doc.nodes[handIndex].children??=[]).push(doc.nodes.length);doc.nodes.push(n)}
 const hip=node(target.scene,'hips'),hipRest=hip.position.clone(),heightRatio=targetRest.hips.p.y/srcRest.hips.p.y
 const clips=[],details={}
 for(const clip of source.animations){if(!['idle','walk','run','swordSlash','hit','death'].includes(clip.name))continue
  const mixer=new T.AnimationMixer(source.scene),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play()
  const times=[...new Set([...Array.from({length:Math.ceil(clip.duration*60)+1},(_,i)=>Math.min(clip.duration,i/60)),clip.duration,...(clip.name==='swordSlash'?[.252]:[])])].sort((a,b)=>a-b)
  const records=pairs.map(p=>({...p,values:[]})),positions=[];let maxGroundCorrection=0
  for(const t of times){action.paused=false;mixer.setTime(t);source.scene.updateMatrixWorld(true)
   hip.position.copy(hipRest).add(node(source.scene,'hips').position.clone().sub(srcHipLocal).multiplyScalar(heightRatio));target.scene.updateMatrixWorld(true)
   for(const p of records){const world=rot(p.from).multiply(p.conversion)
    // The new face/arm proportions bring the inherited raised run hammer into
    // the face. Open only the complete carrying arm from the shoulder; retain
    // its elbow/wrist relationship and the rigid palm grip. Torso/left arm and
    // all combat clips remain the donor motion, with no runtime correction.
    if(clip.name==='run'&&['upper_arm_r','lower_arm_r','hand_r'].includes(p.bone.name))world.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.7))
    const q=rot(p.bone.parent).invert().multiply(world).normalize();p.bone.quaternion.copy(q);p.bone.updateWorldMatrix(false,true);if(p.values.length&&q.dot(new T.Quaternion().fromArray(p.values,p.values.length-4))<0)q.set(-q.x,-q.y,-q.z,-q.w);p.values.push(...q.toArray())}
   let oldGround=Math.max(0,skinBounds(source.scene).min.y*heightRatio)
   // Retain airborne/falling motion, but settle the final death on the ground
   // instead of preserving the old armoured body's 6 cm resting clearance.
   if(clip.name==='death'){const phase=T.MathUtils.clamp((t/clip.duration-.6)/.25,0,1);oldGround*=1-phase*phase*(3-2*phase)}
   const ground=skinBounds(target.scene).min.y;const correction=oldGround-ground;hip.position.y+=correction;maxGroundCorrection=Math.max(maxGroundCorrection,Math.abs(correction));positions.push(...hip.position.toArray());target.scene.updateMatrixWorld(true)
  }
  mixer.stopAllAction();mixer.uncacheRoot(source.scene)
  const input=append(times,'SCALAR'),samplers=[],channels=[];for(const p of records){channels.push({sampler:samplers.length,target:{node:doc.nodes.findIndex(n=>n.name===p.bone.name),path:'rotation'}});samplers.push({input,output:append(p.values,'VEC4'),interpolation:'LINEAR'})}
  channels.push({sampler:samplers.length,target:{node:doc.nodes.findIndex(n=>n.name==='hips'),path:'translation'}});samplers.push({input,output:append(positions,'VEC3'),interpolation:'LINEAR'});clips.push({name:clip.name,samplers,channels});details[clip.name]={duration:clip.duration,samples:times.length,maxGroundCorrection}
 }
 doc.animations=clips;doc.buffers[0].byteLength=offset;doc.asset.extras??={};doc.asset.extras.meshyBandit={normalizedBodySha256:hash(fs.readFileSync(`${work}/body-lod${lod}.glb`)),sourceSha256:'fcc975506d11b7ecd2e3eaadee55f0b28ae280e05bb814bafa5e75e8588cef64',donorCommit,donorSha256:donorHash,method:'Offline world anatomical limb-axis mapping; both arms, calibrated palm, authored source root displacement; per-frame ground bake',hammer:'Original tokeshi rigid hammer, no donor body copied',runCarryCorrection:{axis:'+Y',radians:-.7,bones:['upper_arm_r','lower_arm_r','hand_r'],reason:'Keep raised hammer outside new face silhouette; coherent shoulder-chain rotation, no wrist/torso twist'}}
 const out=encodeGlb(doc,Buffer.concat(chunks));fs.writeFileSync(`${root}/lod${lod}.glb`,out);results.push({level:lod,bytes:out.length,sha256:hash(out),triangles:doc.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+doc.accessors[p.indices].count/3,0),0),details});console.log(results.at(-1))
}
// Uniformly calibrate the actual retargeted idle, not the source bind-pose height.
const measure=await loadRig(readGlb(`${root}/lod0.glb`)),mixer=new T.AnimationMixer(measure.scene)
mixer.clipAction(measure.animations.find(c=>c.name==='idle')).play();mixer.setTime(0);measure.scene.updateMatrixWorld(true)
const measured=skinBounds(measure.scene),uniformScale=1.75/(measured.max.y-measured.min.y)
for(const result of results){const file=`${root}/lod${result.level}.glb`,asset=readGlb(file),d=asset.document,b=Buffer.from(asset.binary),scaled=new Set()
 const scaleAccessor=(index,matrix=false)=>{if(scaled.has(index))return;scaled.add(index);const a=d.accessors[index],v=d.bufferViews[a.bufferView];if(a.componentType!==5126)throw Error('Expected float scale accessor');const components=matrix?16:3;for(let row=0;row<a.count;row++)for(const c of (matrix?[12,13,14]:[0,1,2])){const off=(v.byteOffset??0)+(a.byteOffset??0)+row*(v.byteStride??components*4)+c*4;b.writeFloatLE(b.readFloatLE(off)*uniformScale,off)}if(!matrix){if(a.min)a.min=a.min.map(v=>v*uniformScale);if(a.max)a.max=a.max.map(v=>v*uniformScale)}}
 for(const mesh of d.meshes)for(const p of mesh.primitives)scaleAccessor(p.attributes.POSITION)
 for(const skin of d.skins)scaleAccessor(skin.inverseBindMatrices,true)
 for(const animation of d.animations)for(const c of animation.channels)if(c.target.path==='translation')scaleAccessor(animation.samplers[c.sampler].output)
 for(const n of d.nodes){if(n.translation)n.translation=n.translation.map(v=>v*uniformScale);if(n.matrix)for(const i of [12,13,14])n.matrix[i]*=uniformScale}
 d.asset.extras.meshyBandit.idleHeightCalibration={measuredBefore:measured.max.y-measured.min.y,target:1.75,uniformScale}
 const out=encodeGlb(d,b);fs.writeFileSync(file,out);result.sha256=hash(out);result.bytes=out.length;result.uniformScale=uniformScale
}
fs.writeFileSync(`${work}/retarget-report.json`,JSON.stringify(results,null,2)+'\n')
