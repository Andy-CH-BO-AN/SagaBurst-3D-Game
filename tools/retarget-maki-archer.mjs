/** Bake existing project clips to the newly fitted, posed-source Maki rig. */
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import * as T from 'three'
import {readGlb,loadRig,encodeGlb} from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/maki-archer-t4',srcDir='public/models/characters/v2/viking'
const measured=JSON.parse(fs.readFileSync(`${dir}/blender-measurements.json`)),original=JSON.parse(fs.readFileSync(`${srcDir}/manifest.json`))
const source=await loadRig(readGlb(`${srcDir}/lod0.glb`))
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
function gripRotation(f,bow=false){
 const y=new T.Vector3(...(bow?f.thumbDirection:f.gripAxisLocal)).normalize(),z=new T.Vector3(...(bow?f.palmNormal:f.palmNormalLocal)).normalize().negate(),x=new T.Vector3().crossVectors(y,z).normalize();z.crossVectors(x,y).normalize()
 return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z))
}
const srcGrip={hand_l:gripRotation(original.handGripFrames.left,true),hand_r:gripRotation(original.swordGripFrames.lod0)}
const dstGrip={hand_l:gripRotation(measured.handGripFrames.left,true).invert(),hand_r:gripRotation(measured.swordGripFrames.lod0).invert()}
// Repair only this asset's static source load by sampling the same source hold
// endpoint, preserving durations and event provenance.
const hold=source.animations.find(c=>c.name==='bowHold')
const inputClips=source.animations.map(c=>c.name!=='bowLoad'?c:new T.AnimationClip(c.name,c.duration,c.tracks.map(t=>{
 const end=hold.tracks.find(h=>h.name===t.name)
 return end&&t instanceof T.QuaternionKeyframeTrack&&!/^(hips|upper_leg_|lower_leg_|foot_|toe_|socket_|sole_)/.test(t.name)?new T.QuaternionKeyframeTrack(t.name,[0,c.duration],[...t.values.slice(0,4),...end.values.slice(0,4)]):t
})))
// Offline two-bone calibration: original elbow plane and hand orientation are
// retained; only this asset's baked bow samples acquire its shorter arm reach.
function solveArm(root,side,wristTarget,thumbUp=0,levelElbow=true) {
 const upper=root.getObjectByName('upper_arm_'+side),lower=root.getObjectByName('lower_arm_'+side),hand=root.getObjectByName('hand_'+side)
 root.updateMatrixWorld(true)
 const a=upper.getWorldPosition(new T.Vector3()),b=lower.getWorldPosition(new T.Vector3()),c=hand.getWorldPosition(new T.Vector3())
 const neutralWrist=hand.userData.makiRestQuaternion;
 const l1=a.distanceTo(b),l2=b.distanceTo(c),axis=wristTarget.clone().sub(a),d=T.MathUtils.clamp(axis.length(),Math.abs(l1-l2)+.001,l1+l2-.002);axis.normalize()
 const bend=lower.userData.makiRestWorldPosition.clone().sub(upper.userData.makiRestWorldPosition)
 bend.addScaledVector(axis,-bend.dot(axis)).normalize()
 const along=(l1*l1-l2*l2+d*d)/(2*d),centre=a.clone().addScaledVector(axis,along)
 const radius=Math.sqrt(Math.max(0,l1*l1-along*along))
 if(side==='r'&&levelElbow) {
  // Keep the drawing upper arm level: elbow and shoulder share a height.
  // Intersect the valid two-bone elbow circle with that horizontal plane;
  // choose its outward branch. This preserves both original bone lengths.
  const vertical=new T.Vector3(0,1,0).addScaledVector(axis,-axis.y).normalize()
  const outward=new T.Vector3().crossVectors(axis,vertical).normalize()
  if(outward.x>0)outward.negate()
  const height=T.MathUtils.clamp((a.y-centre.y)/Math.max(1e-6,radius*vertical.y),-1,1)
  bend.copy(vertical).multiplyScalar(height).addScaledVector(outward,Math.sqrt(1-height*height))
 }
 const elbow=centre.addScaledVector(bend,radius),wrist=a.clone().addScaledVector(axis,d)
 const aimFromSource=(bone,child,direction)=>{
  const restWorld=bone.userData.makiRestWorldQuaternion
  const restDirection=child.position.clone().normalize().applyQuaternion(restWorld)
  const q=new T.Quaternion().setFromUnitVectors(restDirection,direction.normalize()).multiply(restWorld)
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q))
  bone.updateWorldMatrix(false,true)
 }
 aimFromSource(upper,lower,elbow.clone().sub(a))
 const b2=lower.getWorldPosition(new T.Vector3())
 aimFromSource(lower,hand,wrist.clone().sub(b2))
 // Keep the wrist neutral. Left forearm pronation is an anatomical pose
 // constraint (thumb web up), independent of the bow asset/attachment frame.
 const twistFrames=[['forearm_twist_'+side,0],['forearm_twist_mid_'+side,1/3],['forearm_twist_distal_'+side,2/3]]
 for(const [name] of twistFrames) {
  const bone=root.getObjectByName(name)
  bone.quaternion.copy(bone.userData.makiRestQuaternion)
 }
 hand.quaternion.copy(neutralWrist);root.updateMatrixWorld(true)
 if(side==='l'&&thumbUp>0) {
  const axis=wrist.clone().sub(b2).normalize()
  const thumb=new T.Vector3(...measured.handGripFrames.left.thumbDirection).applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()))
  thumb.addScaledVector(axis,-thumb.dot(axis)).normalize()
  const up=new T.Vector3(0,1,0).addScaledVector(axis,-axis.y).normalize()
  const roll=Math.atan2(axis.dot(new T.Vector3().crossVectors(thumb,up)),thumb.dot(up))*thumbUp
  const q=lower.getWorldQuaternion(new T.Quaternion()).premultiply(new T.Quaternion().setFromAxisAngle(axis,roll))
  lower.quaternion.copy(lower.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q))
  // The proximal forearm stays aligned with the elbow; existing skin weights
  // distribute pronation along the forearm instead of rotating the sleeve.
  for(const [name,fraction] of twistFrames) {
   const bone=root.getObjectByName(name)
   bone.quaternion.setFromAxisAngle(hand.position.clone().normalize(),-roll*(1-fraction)).multiply(bone.userData.makiRestQuaternion)
  }
  root.updateMatrixWorld(true)
 }

}
let canonicalClips
for(let lod=0;lod<3;lod++){
 const path=`${dir}/lod${lod}.glb`,asset=readGlb(path)
 if(asset.document.animations?.length)throw Error('Run clean Blender builder before retargeting')
 const target=await loadRig(asset);target.scene.updateMatrixWorld(true)
 const rest=new Map();target.scene.traverse(o=>{rest.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});o.userData.makiRestQuaternion=o.quaternion.clone();o.userData.makiRestWorldQuaternion=o.getWorldQuaternion(new T.Quaternion());o.userData.makiRestWorldPosition=o.getWorldPosition(new T.Vector3())})
 const reset=()=>{for(const[o,t]of rest){o.position.copy(t.p);o.quaternion.copy(t.q);o.scale.copy(t.s)}target.scene.updateMatrixWorld(true)}
 if(lod===0){
 canonicalClips=inputClips.map(clip=>{
  reset();const pairs=[]
  target.scene.traverse(bone=>{const from=source.scene.getObjectByName(bone.name);if(bone.isBone&&(from?.isBone||bone.name.startsWith('forearm_twist_')||bone.name==='deltoid_l')&&!/^(socket_|sole_)/.test(bone.name))pairs.push({bone,from,values:[]})})
  const mixer=new T.AnimationMixer(source.scene),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play()
  const count=Math.max(2,Math.ceil(clip.duration*60)),times=Array.from({length:count+1},(_,i)=>i/count*clip.duration)
  for(const time of times){action.paused=false;mixer.setTime(time);source.scene.updateMatrixWorld(true)
   for(const p of pairs){
    if(clip.name==='idle'||clip.name.startsWith('bow')||!p.from){p.bone.quaternion.copy(rest.get(p.bone).q);p.bone.updateWorldMatrix(false,false);continue}
    // The fitted bind bones have local +Y along the measured limb, with roll
    // transported from the source frame. Bake physical source world axes into
    // that new hierarchy; a world-rest delta would retain the bent source pose.
    const q=p.from.getWorldQuaternion(new T.Quaternion())
    if(/^(upper_arm_|lower_arm_)/.test(p.bone.name)) {
     // Transfer limb direction without importing the unrelated source rig's
     // axial roll. Start from Maki's own parent-relative anatomical rest frame.
     const direction=new T.Vector3(0,1,0).applyQuaternion(q)
     q.copy(p.bone.parent.getWorldQuaternion(new T.Quaternion())).multiply(rest.get(p.bone).q)
     const axis=new T.Vector3(0,1,0).applyQuaternion(q)
     q.premultiply(new T.Quaternion().setFromUnitVectors(axis,direction))
    }
    if(srcGrip[p.bone.name])q.multiply(srcGrip[p.bone.name]).multiply(dstGrip[p.bone.name])
    if(p.bone.name.startsWith('hand_')&&['idle','walk','run'].includes(clip.name))q.copy(p.bone.parent.getWorldQuaternion(new T.Quaternion())).multiply(rest.get(p.bone).q)
    p.bone.quaternion.copy(p.bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q).normalize());p.bone.updateWorldMatrix(false,false)
   }
   if(clip.name.startsWith('bow')) {
    const root=target.scene,right=root.getObjectByName('hand_r')
    const shoulder=root.getObjectByName('upper_arm_l').getWorldPosition(new T.Vector3())
    const phase=clip.name==='bowLoad'?time/clip.duration:1
    const ease=t=>{t=T.MathUtils.clamp(t,0,1);return t*t*(3-2*t)}
    const raise=ease(phase/.55)
    // Side-on archery: the shot runs toward the character's anatomical left
    // (+X), along the shoulder line. Turn the gaze toward that same target,
    // distributing the source-to-target yaw between neck and head.
    const gazeYaw=(Math.PI/2-.65)*raise
    for(const [name,amount] of [['neck',.3],['head',1]]) {
     const bone=root.getObjectByName(name)
     const world=bone.userData.makiRestWorldQuaternion.clone().premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),gazeYaw*amount))
     bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world))
     root.updateMatrixWorld(true)
    }
    const head=root.getObjectByName('head').getWorldPosition(new T.Vector3())
    // Shoulder-girdle elevation accompanies the drawing upper arm. Leaving
    // the clavicle at idle pins the shoulder cap even when the elbow rises.
    const clavicle=root.getObjectByName('clavicle_r'),upperRight=root.getObjectByName('upper_arm_r')
    const clavicleWorld=clavicle.userData.makiRestWorldQuaternion.clone()
    const outward=upperRight.position.clone().applyQuaternion(clavicleWorld).normalize()
    const elevationAxis=new T.Vector3().crossVectors(outward,new T.Vector3(0,1,0)).normalize()
    clavicleWorld.premultiply(new T.Quaternion().setFromAxisAngle(elevationAxis,T.MathUtils.degToRad(12)*raise))
    clavicle.quaternion.copy(clavicle.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(clavicleWorld))
    root.updateMatrixWorld(true)
    const leftTarget=new T.Vector3(shoulder.x+.394,head.y-.105,shoulder.z+.045)
    // Author the raised endpoint, then raise through shoulder/elbow FK.
    // A straight wrist-position interpolation folds the elbow first and leaves
    // the upper arm hanging; interpolating joint rotations lifts it immediately.
    const blendArmFromIdle=(side,amount)=>{
     for(const name of ['upper_arm_','lower_arm_','forearm_twist_','forearm_twist_mid_','forearm_twist_distal_']) {
      const bone=root.getObjectByName(name+side),end=bone.quaternion.clone()
      bone.quaternion.copy(rest.get(bone).q).slerp(end,amount)
     }
     root.updateMatrixWorld(true)
    }
    solveArm(root,'l',leftTarget,1)
    blendArmFromIdle('l',raise)
    const contact=root.getObjectByName('bow_string_contact')
    const anchor=head.clone().add(new T.Vector3(-.055,-.05,.07))
    // Keep the initial string contact inside the drawing arm's reach. Starting
    // at the extended bow grip drives IK through its straight-arm singularity.
    const start=root.getObjectByName('bow_arrow_rest').getWorldPosition(new T.Vector3()).add(new T.Vector3(-.28,0,0))
    const nock=start.lerp(anchor,ease((phase-.35)/.65))
    if(clip.name==='bowRelease')nock.add(new T.Vector3(-.035,0,-.01).multiplyScalar(time/clip.duration))
    for(let iteration=0;phase>0&&iteration<4;iteration++) {
     const offset=contact.getWorldPosition(new T.Vector3()).sub(right.getWorldPosition(new T.Vector3()))
     solveArm(root,'r',nock.clone().sub(offset))
    }
    blendArmFromIdle('r',raise)
   }
   if(clip.name==='axeAttack2H') {
    const root=target.scene,ease=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x)}
    const weight=ease(time/.08)*(1-ease((time-.38)/.10))
    const attachment=JSON.parse(fs.readFileSync('public/models/weapons/maki-ranger-bow/attachment.json'))
    const y=new T.Vector3(...attachment.longitudinalAxis),z=new T.Vector3(...attachment.contactNormal)
    const weaponFrame=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(y,z).normalize(),y,z))
    const handFrame=gripRotation(measured.handGripFrames.left,true)
    const bowInHand=handFrame.clone().multiply(weaponFrame.clone().invert())
    const leftGrip=new T.Vector3(...measured.handGripFrames.left.palmContactCenter).addScaledVector(new T.Vector3(...measured.handGripFrames.left.palmNormal),attachment.gripRadius)
    // Preserve the source upper-arm/forearm swing, transporting its axes from
    // Maki's bind frame. Keep the original neutral bow wrist and attachment.
    for(const side of ['l','r']) {
     const hand=root.getObjectByName('hand_'+side)
     hand.quaternion.copy(rest.get(hand).q)
    }
    root.updateMatrixWorld(true)
    const leftHand=root.getObjectByName('hand_l'),rightHand=root.getObjectByName('hand_r')
    // The axe take brings its short grip behind the torso in follow-through.
    // Maki's bow has a limb on BOTH sides of the grip. Fit that swing to a
    // forward carry plane before acquiring the support hand, using whole-arm
    // reach rather than changing the wrist or the bow attachment.
    const chest=root.getObjectByName('upper_chest').getWorldPosition(new T.Vector3())
    const leftWrist=leftHand.getWorldPosition(new T.Vector3())
    leftWrist.z=Math.max(leftWrist.z,chest.z+.28)
    solveArm(root,'l',leftWrist,0,false)
    const weaponQ=leftHand.getWorldQuaternion(new T.Quaternion()).multiply(bowInHand)
    const grip=leftGrip.clone().applyMatrix4(leftHand.matrixWorld)
    const support=grip.clone().add(new T.Vector3(0,-.055,0).applyQuaternion(weaponQ))
    const rightCentre=new T.Vector3(...measured.swordGripFrames.lod0.gripCenterLocal).addScaledVector(new T.Vector3(...measured.swordGripFrames.lod0.palmNormalLocal),attachment.gripRadius-.022)
    for(let i=0;i<8;i++) {
     const offset=rightCentre.clone().applyQuaternion(rightHand.getWorldQuaternion(new T.Quaternion()))
     solveArm(root,'r',support.clone().sub(offset),0,false)
    }
    // Acquisition/recovery return to the user's original bow idle, including
    // the unoccupied right hand. Full contact owns the complete strike window.
    for(const p of pairs)p.bone.quaternion.copy(rest.get(p.bone).q.clone().slerp(p.bone.quaternion,weight))
   }
   const deltoid=target.scene.getObjectByName('deltoid_l')
   deltoid.quaternion.copy(rest.get(deltoid).q).slerp(target.scene.getObjectByName('upper_arm_l').quaternion,.5)
   target.scene.updateMatrixWorld(true)
   if(clip.name==='bowHold'&&time===0) {
    // Calibrate the independent bow against the completed natural arm pose.
    // No equipment frame is fed back into the bone solve.
    const hand=target.scene.getObjectByName('hand_l')
    const bowWorld=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-Math.PI/2)
    const weaponGrip=bowWorld.invert().multiply(hand.getWorldQuaternion(new T.Quaternion())).multiply(gripRotation(measured.handGripFrames.left,true))
    const path='public/models/weapons/maki-ranger-bow/attachment.json'
    const attachment=JSON.parse(fs.readFileSync(path))
    attachment.longitudinalAxis=new T.Vector3(0,1,0).applyQuaternion(weaponGrip).toArray()
    attachment.contactNormal=new T.Vector3(0,0,1).applyQuaternion(weaponGrip).toArray()
    attachment.calibration='Static weapon grip frame fitted to Maki source-based bowHold. Rotates only the bow; never changes bone poses.'
    fs.writeFileSync(path,JSON.stringify(attachment,null,2)+'\n')
   }
   if(clip.name.startsWith('bow')) {
    // Turn the entire original standing pose, including both feet, into +Z.
    // Walking/mounted locomotion transfers this heading above the pelvis at
    // runtime; the source arm, wrist, head and leg poses remain untouched.
    const phase=clip.name==='bowLoad'?Math.min(1,time/clip.duration/.55):1
    const turn=-Math.PI/2*phase*phase*(3-2*phase)
    const hips=target.scene.getObjectByName('hips')
    const world=hips.getWorldQuaternion(new T.Quaternion()).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),turn))
    hips.quaternion.copy(hips.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world))
    target.scene.updateMatrixWorld(true)
   }
   for(const p of pairs) {
    const out=p.bone.quaternion.clone();if(p.values.length&&out.dot(new T.Quaternion().fromArray(p.values,p.values.length-4))<0)out.set(-out.x,-out.y,-out.z,-out.w);p.values.push(...out.toArray())
   }
  }
  mixer.stopAllAction();return new T.AnimationClip(clip.name,clip.duration,pairs.map(p=>new T.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`,times,p.values)))
 })
 // Reuse the project's existing death profile, scaled to the measured Maki body.
 reset();const idle=canonicalClips.find(c=>c.name==='idle'),deathTracks=idle.tracks.map(t=>new T.QuaternionKeyframeTrack(t.name,[0,1],[...t.values.slice(0,4),...t.values.slice(0,4)]))
 for(const[name,angles]of[['hips',[0,.15,1.35]],['spine',[0,.1,.25]]]){
  const track=deathTracks.find(t=>t.name===name+'.quaternion'),base=new T.Quaternion().fromArray(track.values)
  deathTracks.splice(deathTracks.indexOf(track),1,new T.QuaternionKeyframeTrack(name+'.quaternion',[0,.25,1],angles.flatMap(a=>base.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(a,0,0))).toArray())))
 }
 canonicalClips.push(new T.AnimationClip('death',1,deathTracks))
 // Single LOD0 skin-derived floor correction shared by every LOD: identical
 // bone transforms and socket trajectories, including during LOD switches.
 const meshes=[];target.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)})
 const feet=meshes.flatMap(mesh=>{const idx=mesh.geometry.attributes.skinIndex,w=mesh.geometry.attributes.skinWeight,ids=[];for(let i=0;i<idx.count;i++){let sum=0;for(let j=0;j<4;j++)if(/^(foot_|toe_)/.test(mesh.skeleton.bones[idx.getComponent(i,j)]?.name??''))sum+=w.getComponent(i,j);if(sum>.7)ids.push(i)}return ids.length?[{mesh,ids}]:[]})
 for(const clip of canonicalClips){
  reset();const mixer=new T.AnimationMixer(target.scene),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play()
  const times=clip.tracks[0].times,values=[],hips=target.scene.getObjectByName('hips'),v=new T.Vector3()
  const candidates=clip.name==='death'?meshes.map(mesh=>({mesh,ids:Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i)})):feet
  for(const time of times){hips.position.copy(rest.get(hips).p);action.paused=false;mixer.setTime(time);target.scene.updateMatrixWorld(true);for(const m of meshes)m.skeleton.update();let min=Infinity
   for(const{mesh,ids}of candidates)for(const i of ids){v.fromBufferAttribute(mesh.geometry.attributes.position,i);mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);min=Math.min(min,v.y)}
   if(!Number.isFinite(min))throw Error('No finite Maki ground sample');values.push(hips.position.x,hips.position.y-min+.003,hips.position.z)
  }
  mixer.stopAllAction();clip.tracks.push(new T.VectorKeyframeTrack('hips.position',times,values))
 }
 }
 const doc=asset.document,chunks=[asset.binary];let offset=asset.binary.length
 const append=(values,type)=>{const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad}const b=Buffer.from(values.buffer,values.byteOffset,values.byteLength),view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});chunks.push(b);offset+=b.length;const a={bufferView:view,componentType:5126,count:values.length/(type==='SCALAR'?1:type==='VEC3'?3:4),type};if(type==='SCALAR'){a.min=[values[0]];a.max=[values.at(-1)]}doc.accessors.push(a);return doc.accessors.length-1}
 doc.animations=canonicalClips.map(c=>{const samplers=[],channels=[];for(const t of c.tracks){const[name,prop]=t.name.split('.'),node=doc.nodes.findIndex(n=>n.name===name);if(node<0)throw Error(name);channels.push({sampler:samplers.length,target:{node,path:prop==='position'?'translation':'rotation'}});samplers.push({input:append(t.times,'SCALAR'),output:append(t.values,prop==='position'?'VEC3':'VEC4'),interpolation:'LINEAR'})}return{name:c.name,samplers,channels}})
 doc.buffers[0].byteLength=offset;fs.writeFileSync(path,encodeGlb(doc,Buffer.concat(chunks)))
}
const sourceInfo={title:'Maki (Archer)',author:'Blue Spirit',url:'https://sketchfab.com/3d-models/maki-archer-f8fe68c9b6b14ded84172a06c9bd9b20',license:'CC-BY-4.0 (model; animation licenses separate)',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',sourceSha256:measured.sourceSha256}
const modifications=['Idle preserves the original Maki bind pose without importing another character posture','Melee uses the same T4 bow in the left hand; the existing two-handed axe take supplies the strike timing/arc, with baked bow-handle support contact and acquisition/recovery to source bow idle; no axe equipment or axe idle','Assigned sleeve weights along garment topology; separated both sleeve/body branches below the measured axillary junction, diffused shoulder weights between fixed body and sleeve regions, and transferred the same field to the overlapping hood shoulder flap; kept torso ornaments separate and smoothed skirt centre weights','Bow poses start from the original Maki body pose and raise the arms with a two-bone solve and drawing-side clavicle elevation; the original side-on draw is retained in the chest frame and the complete standing pose turns at the hips to aim along gameplay +Z; walking and mounted locomotion transfer that heading above the pelvis, the head and neck follow the same sight line, and the drawing hand anchors beside the jaw; other locomotion retargets arm direction using Maki rest frames; constrained both bow wrists to their anatomical rest orientation relative to the forearm; solved arm reach from source frames; left thumb web rises through gradual forearm pronation with a neutral wrist and distributed skin twist; weapon facing never drives limb rotation','Baked complete source transforms and grounded shoe outsole; preserved source dimensions and original character surfaces/materials','Built fitted project-humanoid-v1 skeleton with six forearm twist deformation bones and a local left deltoid support bone; subdivided bow-hand pronation into three adjacent skinning intervals to preserve forearm cross-section; limited deltoid support to the shoulder joint so it cannot drag the axillary body panel; measured elbow centres from original skin cross-sections; normalized region-aware skin weights because source has no rig','Baked existing project animations to fitted bone and hand frames; shared identical animation samples across all LODs','Generated three runtime LODs; resized original textures and encoded opaque maps as JPEG95 while preserving masked alpha maps as PNG','Extracted original Spirit Bow, normalized its grip pivot, removed original static string for existing dynamic bow-string rendering','Removed the independent held arrow; preserved quiver and back arrow stack as visual accessories','Added equipment sockets, bow contact landmarks and Maki-specific hand grip metadata; corrected left thumb direction for forehand bow grasp']
const manifest={schemaVersion:1,id:'maki-archer-t4',status:'ready',source:sourceInfo,attribution:'Maki (Archer) by Blue Spirit, CC BY 4.0; remodel/redesign of Mixamo Akai. Adapted for SagaBurst. Animation licenses are separate.',modifications,metrics:measured,files:{lod0:'lod0.glb',lod1:'lod1.glb',lod2:'lod2.glb'},skeleton:'project-humanoid-v1',boneMap:'bone-map.json',audit:'audit.json',handShapeMode:'authored',bowFullBodyStance:true,bakedEquipmentActions:['axeAttack2H'],handGripFrames:{left:{...measured.handGripFrames.left,bowCalibration:'maki-archer-t4'}},swordGripFrames:measured.swordGripFrames,animations:{embedded:[...original.animations.embedded,{clip:'death',source:'SagaBurst',sourceClip:'existing deterministic death profile',loop:false,duration:1}],runtimeGenerated:original.animations.runtimeGenerated.filter(s=>s!=='death')},animationSources:original.animationSources,axeAttackBuild:original.axeAttackBuild,animationInputSha256:hash(`${srcDir}/lod0.glb`),equipment:{primary:'maki-ranger-bow',fallback:'maki-ranger-bow',meleeSupportGripLocal:[0,-.055,0],fallbackAction:'axeAttack2H',shield:false,transitionReason:'arrow-ammo-exhausted',returnToRanged:'arrow-ammo-positive',proximityTriggersFallback:false},bowStance:{shotAxisCharacterLocal:[0,0,1],description:'Original side-on draw preserved relative to the chest; whole-body standing turn maps authored +X into gameplay +Z; walking and mounted legs keep locomotion heading; neutral wrists, unchanged bow grip, level drawing elbow.'},visualAcceptance:'Original side-on draw and feet preserved by a whole-body standing turn into gameplay +Z; walking/stopping and mounted leg ownership verified through production controller; unchanged bow grip, arm tracks, source idle and bow melee; LOD1/2 retain known clothing and hood intersections; full visual acceptance pending',fileSha256:Object.fromEntries([0,1,2].map(i=>[`lod${i}`,hash(`${dir}/lod${i}.glb`)]))}
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
fs.writeFileSync(`${dir}/attribution-evidence.json`,JSON.stringify({model:sourceInfo,checkedDate:'2026-09-27',sourcePage:{url:sourceInfo.url,status:'Web fetch returned HTTP 403; embedded GLB asset.extras independently identifies author, title, source URL and CC-BY-4.0. Upstream disclosure supplied in user request; retain uncertainty until live page verified.'},embeddedSourceMetadata:JSON.parse(fs.readFileSync(`${dir}/source-audit.json`)).asset.extras,upstreamDisclosure:'The Model is a Remodel and Redesign of Mixamo Character (Akai)',adobeOfficialFaq:{url:'https://helpx.adobe.com/tw/creative-cloud/faq/mixamo-faq.html',checkedDate:'2026-09-27',finding:'Official FAQ permits royalty-free characters and animations for personal, commercial and nonprofit projects, including video games. This is game-use information, not a CC license for Adobe materials.'},ccLicense:{url:'https://creativecommons.org/licenses/by/4.0/',checkedDate:'2026-09-27',finding:'Attribution, license link, indication of changes and no implied endorsement required.'},animationProvenance:{sources:original.animationSources,axeAttackBuild:original.axeAttackBuild,inputGlb:`${srcDir}/lod0.glb`,inputSha256:manifest.animationInputSha256,sourceMakiEmbeddedAnimations:0},actualModifications:modifications,knownUncertainty:['Live Sketchfab page blocked by 403; source license corroborated by metadata in the user-provided GLB.','Mixamo Akai upstream authorship is retained; Adobe FAQ does not relicense embedded project animations or all derivative materials as CC BY.']},null,2)+'\n')
fs.writeFileSync(`${dir}/ATTRIBUTION.md`,`# Maki T4 Ranger\n\nMaki (Archer) by Blue Spirit.\n\nSource: ${sourceInfo.url}\n\nThe source GLB labels the model Creative Commons Attribution (CC BY 4.0):\nhttps://creativecommons.org/licenses/by/4.0/\n\nThe original author states that Maki is a remodel and redesign of the Mixamo character Akai (disclosure supplied with the request; live page fetch returned 403 on 2026-09-27).\n\nAdapted for SagaBurst.\n\nModifications:\n${modifications.map(s=>'- '+s).join('\n')}\n\nMixamo game-use information:\nhttps://helpx.adobe.com/tw/creative-cloud/faq/mixamo-faq.html\n\nAnimation sources and their licenses remain separately documented in manifest.json and attribution-evidence.json: Kevin Iglesias / Unity Asset Store EULA; Quaternius / CC0; existing SagaBurst death profile. The final GLBs are not declared wholly CC BY.\n\nSource SHA-256: ${measured.sourceSha256}\n\nNo endorsement by Blue Spirit, Adobe, Mixamo, or other original creators is implied.\n`)
fs.copyFileSync(`${dir}/ATTRIBUTION.md`,'public/models/weapons/maki-ranger-bow/ATTRIBUTION.md')
console.log(JSON.stringify({heightM:measured.heightM,sha256:manifest.fileSha256}))
