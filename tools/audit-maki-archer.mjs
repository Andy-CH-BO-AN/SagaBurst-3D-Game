/** Structural and sampled-deformation audit of final files, not builder estimates. */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as T from 'three'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/maki-archer-t4',manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`))
const required=['hips','spine','chest','neck','head',...['l','r'].flatMap(s=>['upper_arm_','lower_arm_','hand_','upper_leg_','lower_leg_','foot_','toe_'].map(n=>n+s))]
const sockets=['socket_hand_l','socket_hand_r','socket_back','socket_head','socket_pelvis','socket_foot_l','socket_foot_r','sole_l','sole_r','bow_string_contact','bow_arrow_rest']
const result={sourceSha256:manifest.source.sourceSha256,method:'Final GLB parsing; normalized skin weights; common bone hierarchy/rest transforms; identical sampled animation/socket transforms; texture dimensions read from encoded images. Bounds are not proof against visual intersections.',levels:[]}
let skeletonReference,animationReference
function imageSize(b){
 if(b.subarray(1,4).toString()==='PNG')return[b.readUInt32BE(16),b.readUInt32BE(20)]
 let offset=2
 while(offset<b.length){if(b[offset]!==255){offset++;continue}const marker=b[offset+1];if([0xc0,0xc1,0xc2].includes(marker))return[b.readUInt16BE(offset+7),b.readUInt16BE(offset+5)];if(marker===0xd8||marker===0xd9){offset+=2;continue}offset+=2+b.readUInt16BE(offset+2)}throw Error('Unknown image header')
}
for(let lod=0;lod<3;lod++){
 const path=`${dir}/lod${lod}.glb`,asset=readGlb(path),d=asset.document,g=await loadRig(asset)
 const sha=createHash('sha256').update(fs.readFileSync(path)).digest('hex');assert.equal(sha,manifest.fileSha256[`lod${lod}`])
 const parents=new Map();d.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)))
 const skin=g.scene.children;const bones=[];g.scene.traverse(o=>{if(o.isBone)bones.push(o)})
 const skeleton=bones.map(b=>({name:b.name,parent:b.parent.name,position:b.position.toArray(),rotation:b.quaternion.toArray(),scale:b.scale.toArray()})).sort((a,b)=>a.name.localeCompare(b.name))
 const restElbows=['l','r'].map(side=>g.scene.getObjectByName('lower_arm_'+side).getWorldPosition(new T.Vector3()).y)
 const restRightShoulderY=g.scene.getObjectByName('upper_arm_r').getWorldPosition(new T.Vector3()).y-g.scene.getObjectByName('clavicle_r').getWorldPosition(new T.Vector3()).y
 const neutralWrists=['l','r'].map(side=>({bone:g.scene.getObjectByName(`hand_${side}`),rest:g.scene.getObjectByName(`hand_${side}`).quaternion.clone()}))
 const neutralBones=bones.map(bone=>({bone,rest:bone.quaternion.clone().normalize()}))
 let maxIdleRestDeviationRadians=0,maxBowTwistDeviationRadians=0,minHoldThumbUp=1
 const earlyElbowRise=[]
 let minRightShoulderLift=Infinity,maxRightHoldElbowHeightError=0
 let maxBowWristDeviationRadians=0
 if(lod===0)skeletonReference=skeleton;else assert.deepEqual(skeleton,skeletonReference)
 for(const n of [...required,...sockets])assert(g.scene.getObjectByName(n),n)
 assert(!d.nodes.some(n=>/Spirit_Bow|Flaming_Arrow/.test(n.name??'')),'No duplicate held equipment in body')
 const triangles=d.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+d.accessors[p.indices??p.attributes.POSITION].count/3,0)
 assert(triangles<=[60500,20500,6500][lod],`LOD${lod} triangle budget`)
 const textures=d.images.map(i=>{const v=d.bufferViews[i.bufferView];const bytes=asset.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);return{name:i.name,mimeType:i.mimeType,size:imageSize(bytes)}})
 assert(textures.every(t=>Math.max(...t.size)<=[2048,1024,512][lod]))
 const meshes=[];g.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)})
 let vertices=0,maxWeightError=0
 for(const mesh of meshes){const w=mesh.geometry.attributes.skinWeight,idx=mesh.geometry.attributes.skinIndex;vertices+=w.count;for(let i=0;i<w.count;i++){let sum=0;for(let j=0;j<4;j++){const weight=w.getComponent(i,j);assert(Number.isFinite(weight)&&weight>=0);assert(mesh.skeleton.bones[idx.getComponent(i,j)]);sum+=weight}maxWeightError=Math.max(maxWeightError,Math.abs(sum-1))}}
 assert(maxWeightError<1e-5)
 const animation=g.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.map(t=>({name:t.name,times:[...t.times],values:[...t.values]}))}))
 if(lod===0)animationReference=animation;else assert.deepEqual(animation,animationReference)
 for(const binding of manifest.animations.embedded){const clip=g.animations.find(c=>c.name===binding.clip);assert(clip&&Math.abs(clip.duration-binding.duration)<1e-5)}
 // Transition endpoints and quaternion continuity catch arm flips that bounds
 // and neutral-wrist checks alone cannot detect.
 const load=g.animations.find(c=>c.name==='bowLoad'),hold=g.animations.find(c=>c.name==='bowHold'),idle=g.animations.find(c=>c.name==='idle')
 let maxBowLoadFrameStep=0
 for(const track of load.tracks.filter(t=>t.name.endsWith('.quaternion'))) {
  const first=new T.Quaternion().fromArray(track.values),last=new T.Quaternion().fromArray(track.values,track.values.length-4)
  assert(first.angleTo(new T.Quaternion().fromArray(idle.tracks.find(t=>t.name===track.name).values))<.001,'Bow load must start at source idle: '+track.name)
  assert(last.angleTo(new T.Quaternion().fromArray(hold.tracks.find(t=>t.name===track.name).values))<.001,'Bow load must end at hold: '+track.name)
  for(let i=4;i<track.values.length;i+=4)maxBowLoadFrameStep=Math.max(maxBowLoadFrameStep,new T.Quaternion().fromArray(track.values,i-4).normalize().angleTo(new T.Quaternion().fromArray(track.values,i).normalize()))
 }
 assert(maxBowLoadFrameStep<.35,'Bow load must not flip between samples')
 const mixer=new T.AnimationMixer(g.scene),samples=[]
 for(const name of ['idle','walk','run','bowLoad','bowHold','bowRelease','axeAttack2H','death']){
  const clip=g.animations.find(c=>c.name===name),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play()
  let minY=Infinity,maxY=-Infinity,maxExtent=0
  for(const fraction of [0,.25,.5,.75,1]){
   action.paused=false;mixer.setTime(clip.duration*fraction);g.scene.updateMatrixWorld(true);const box=new T.Box3(),v=new T.Vector3()
   for(const {bone,rest} of neutralBones) {
    const deviation=2*Math.acos(Math.min(1,Math.abs(bone.quaternion.clone().normalize().dot(rest))))
    if(name==='idle')maxIdleRestDeviationRadians=Math.max(maxIdleRestDeviationRadians,deviation)
    if(name.startsWith('bow')&&bone.name.startsWith('forearm_twist_'))maxBowTwistDeviationRadians=Math.max(maxBowTwistDeviationRadians,deviation)
   }
   if(name==='bowLoad'&&fraction===.25) {
    for(const [i,side] of ['l','r'].entries()) {
     const rise=g.scene.getObjectByName('lower_arm_'+side).getWorldPosition(new T.Vector3()).y-restElbows[i]
     assert(rise>.02,'Upper arm must lift during the early raise: '+side)
     earlyElbowRise.push(rise)
    }
   }
   if(name==='bowHold') {
    const shoulder=g.scene.getObjectByName('upper_arm_r').getWorldPosition(new T.Vector3())
    const clavicle=g.scene.getObjectByName('clavicle_r').getWorldPosition(new T.Vector3())
    const elbow=g.scene.getObjectByName('lower_arm_r').getWorldPosition(new T.Vector3())
    minRightShoulderLift=Math.min(minRightShoulderLift,shoulder.y-clavicle.y-restRightShoulderY)
    maxRightHoldElbowHeightError=Math.max(maxRightHoldElbowHeightError,Math.abs(elbow.y-shoulder.y))
    const hand=g.scene.getObjectByName('hand_l')
    const thumb=new T.Vector3(...manifest.handGripFrames.left.thumbDirection).applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()))
    minHoldThumbUp=Math.min(minHoldThumbUp,thumb.y)
   }
   if(name.startsWith('bow'))for(const {bone,rest} of neutralWrists)maxBowWristDeviationRadians=Math.max(maxBowWristDeviationRadians,2*Math.acos(Math.min(1,Math.abs(bone.quaternion.clone().normalize().dot(rest.clone().normalize())))))
   for(const mesh of meshes){mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);assert(v.toArray().every(Number.isFinite));box.expandByPoint(v)}}
   minY=Math.min(minY,box.min.y);maxY=Math.max(maxY,box.max.y);maxExtent=Math.max(maxExtent,box.getSize(new T.Vector3()).length())
  }
  mixer.stopAllAction();assert(maxExtent<3.5,`${name} exploded`);samples.push({name,minY,maxY,maxExtent})
 }
 manifest.metrics.triangles[`lod${lod}`]=triangles;manifest.metrics.textures[`lod${lod}`]=Math.max(...textures.flatMap(t=>t.size))
 assert(maxIdleRestDeviationRadians<1e-5,'Idle must preserve the original Maki pose')
 // Left forearm skin twist now distributes the requested thumb-web-up pose.
 assert(minRightShoulderLift>.015,'Drawing shoulder girdle must elevate from idle')
 assert(maxRightHoldElbowHeightError<.001,'Drawing elbow must be level with the shoulder')
 assert(minHoldThumbUp>.9,'Bow hold thumb web must face upward')
 assert(maxBowWristDeviationRadians<1e-5,'Bow must not bend the anatomical wrist to orient the weapon')
 result.levels.push({lod,sha256:sha,bytes:fs.statSync(path).size,triangles,vertices,skinnedMeshes:meshes.length,bones:bones.length,maxWeightError,maxBowWristDeviationRadians,maxBowLoadFrameStep,maxIdleRestDeviationRadians,maxBowTwistDeviationRadians,minHoldThumbUp,earlyElbowRise,minRightShoulderLift,maxRightHoldElbowHeightError,textures,animationNames:g.animations.map(c=>c.name),samples})
}
result.commonSkeletonAndAnimations=true;result.requiredSockets=sockets
const bow=readGlb('public/models/weapons/maki-ranger-bow/bow.glb');result.bow={triangles:bow.document.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+bow.document.accessors[p.indices].count/3,0),skins:bow.document.skins?.length??0,sha256:createHash('sha256').update(fs.readFileSync('public/models/weapons/maki-ranger-bow/bow.glb')).digest('hex')}
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(`${dir}/audit.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.levels.map(({lod,triangles,vertices,bones,bytes,maxWeightError})=>({lod,triangles,vertices,bones,bytes,maxWeightError}))))
