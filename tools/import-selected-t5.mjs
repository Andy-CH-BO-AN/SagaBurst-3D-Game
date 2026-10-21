/** Import the selected delivery without re-exporting mesh, skin or animations.
 * LOD0-only staging is intentional: generate lower LODs only after visual QA. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as T from 'three'
import { repairSelectedRomanHands } from './lib/selected-roman-hand-repair.mjs'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
const sourceRoot=process.argv[2]??'output/t5-selected-source'
const destination=process.argv[3]??'output/t5-selected-candidate'
const definitions={
 roman:{folder:'Roman',file:'Masked_Roman_Selected_11Clips.glb',sha:'9bc9dc10a52df00a5caaabe600d48e6164b0a1a619a05dfc5aeec27116652ca8',rig:'mixamo66',title:'Masked Roman'},
 viking:{folder:'Steppe',file:'Steppe_Selected_11Clips_Candidate.glb',sha:'59cfd8bebeb1b87a4e97c99b6e476dd920a32fff3b6941669fc749fc37b3a931',rig:'steppe37',title:'Steppe Iron Guard'},
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
for(const[faction,def]of Object.entries(definitions)){
 const source=path.join(sourceRoot,def.folder,def.file),bytes=fs.readFileSync(source)
 if(hash(bytes)!==def.sha)throw Error(`Wrong selected source: ${source}`)
 const raw=readGlb(source),repair=faction==='roman'?repairSelectedRomanHands(raw):null,delivery=repair?encodeGlb(repair.document,repair.binary):bytes,g=await loadRig(raw),ref=await loadRig(readGlb(`public/models/characters/v2/${faction}-hero-t4/lod0.glb`))
 g.scene.updateMatrixWorld(true);ref.scene.updateMatrixWorld(true)
 const alias=name=>faction==='roman'?({hips:'mixamorigHips',upper_arm_l:'mixamorigLeftArm',upper_arm_r:'mixamorigRightArm',neck:'mixamorigNeck',head:'mixamorigHead',hand_l:'mixamorigLeftHand',hand_r:'mixamorigRightHand'})[name]??name:name
 const node=name=>g.scene.getObjectByName(alias(name))
 const pos=n=>n.getWorldPosition(new T.Vector3())
 const keys=['hips','upper_arm_l','upper_arm_r'];const landmarks=keys.map(name=>({name,source:pos(node(name)).y,reference:pos(ref.scene.getObjectByName(name)).y}))
 const scale=landmarks.reduce((s,p)=>s+p.source*p.reference,0)/landmarks.reduce((s,p)=>s+p.source*p.source,0)
 const bounds=new T.Box3().setFromObject(g.scene),height=bounds.max.y-bounds.min.y
 function frame(side){
  const hand=node('hand_'+side),q=hand.getWorldQuaternion(new T.Quaternion()).invert()
  let finger=new T.Vector3(0,1,0),thumb=new T.Vector3(0,0,1).applyQuaternion(q),center=new T.Vector3(0,.055,0),base=new T.Vector3(0,.085,0),thumbBase=new T.Vector3(0,.025,0)
  if(faction==='roman'){
   const prefix='mixamorig'+(side==='l'?'Left':'Right')+'Hand'
   const local=name=>hand.worldToLocal(pos(g.scene.getObjectByName(prefix+name)))
   const index=local('Index1'),pinky=local('Pinky1'),middle=local('Middle1')
   thumb.subVectors(index,pinky).normalize();finger.copy(middle).normalize();base.copy(index).add(pinky).multiplyScalar(.5);center.copy(base).multiplyScalar(.65);thumbBase.copy(local('Thumb1'))
  }
  thumb.addScaledVector(finger,-thumb.dot(finger)).normalize()
  const normal=new T.Vector3().crossVectors(thumb,finger).normalize(),inward=new T.Vector3(side==='l'?-1:1,0,0).applyQuaternion(q)
  if(normal.dot(inward)<0)normal.negate()
  // Initial anatomical frame only; actual weapon contact remains a visual gate.
  const surface=center.clone().addScaledVector(normal,.012)
  // Steppe's wrist joint is inside the cuff; the source palm cavity lies
  // 10 cm distally, not at the provisional 5.5 cm wrist-side point.
  if(faction==='viking')surface.set(side==='l'?.025:-.025,.1,-.04).addScaledVector(normal,-.019)
  return{gripCenterLocal:surface.clone().addScaledVector(normal,.019).toArray(),gripAxisLocal:thumb.toArray(),palmNormalLocal:normal.toArray(),fingerDirection:finger.toArray(),wristCenter:[0,0,0],thumbBaseCenter:thumbBase.toArray(),fingerBase:base.dot(finger),gripRadius:.019,palmContactCenter:surface.toArray()}
 }
 const right=frame('r'),left=frame('l');delete right.palmContactCenter
 // Measured source cupped-hand cavity, distal to the wrist under the cuff.
 if(faction==='roman'){right.gripCenterLocal=[-.032,.09,-.047];left.palmContactCenter=[.0185,.0904,-.0296]}
 const count=raw.document.meshes.flatMap(m=>m.primitives).reduce((s,p)=>s+raw.document.accessors[p.indices].count/3,0)
 const bindings=raw.document.animations.map(a=>{
  const duration=Math.max(...a.samplers.map(s=>raw.document.accessors[s.input].max[0]));const clip=a.name
  const axeEvents = clip==='axeAttack1H'?{activeStart:43/30,hit:47/30,activeEnd:51/30,actionComplete:duration}:clip==='axeAttack2H'?{activeStart:29/30,hit:32/30,activeEnd:36/30,actionComplete:duration}:undefined
  return {clip,...(axeEvents?{meleeCycleSeconds:.48,events:axeEvents}:{}),source:clip.startsWith('axeAttack')?'Meshy':clip==='swordSlash'||clip==='pilumThrow'?'Quaternius':'Kevin Iglesias',sourceClip:clip,loop:['idle','walk','run','bowHold','axeMountedIdle'].includes(clip),duration,...(['walk','run'].includes(clip)?{nominalSpeed:clip==='walk'?2:4}:{}),...({swordSlash:{hit:.252,actionComplete:duration},bowRelease:{projectileRelease:.04,actionComplete:duration},pilumThrow:{projectileRelease:17/30,actionComplete:duration}}[clip]?{events:({swordSlash:{hit:.252,actionComplete:duration},bowRelease:{projectileRelease:.04,actionComplete:duration},pilumThrow:{projectileRelease:17/30,actionComplete:duration}})[clip]}:{})}
 })
 const manifest={schemaVersion:1,id:`${faction}-hero-t5`,status:'ready',skeleton:'project-humanoid-v1',source:{title:def.title,sourceArchive:'Roman_Steppe_Selected_Complete.zip',sourceEntry:`${def.folder}/${def.file}`,sourceSha256:def.sha,license:'Meshy account/service/input terms; project animation sources retain their original terms',licenseEvidence:'source-readme.txt'},attribution:`${def.title}: user-supplied Meshy model, textures and selected axe animations. Core clips: project-licensed Kevin Iglesias and Quaternius; see source-readme.txt.`,selectedSource:{rig:def.rig,uniformScale:scale},handShapeMode:'authored',preserveLodHandTopology:true,
 files:{lod0:'lod0.glb',lod1:'lod0.glb',lod2:'lod0.glb'},metrics:{heightM:height*scale,shoulderWidthM:pos(node('upper_arm_l')).distanceTo(pos(node('upper_arm_r')))*scale+.15,neckLengthM:pos(node('neck')).distanceTo(pos(node('head')))*scale,triangles:{lod0:count,lod1:count,lod2:count},textures:{lod0:2048,lod1:2048,lod2:2048},uniformScale:scale,bodyLandmarks:landmarks},animations:{embedded:bindings,runtimeGenerated:['mounted','death','daggerSlash','greatswordSlash','lanceThrust','mountedLance']},
 handGripFrames:{left:{palmContactCenter:left.palmContactCenter,palmNormal:left.palmNormalLocal,thumbDir:-1,thumbDirection:left.gripAxisLocal,fingerDirection:left.fingerDirection,wristCenter:left.wristCenter,fingerBase:left.fingerBase,thumbBaseCenter:left.thumbBaseCenter}},swordGripFrames:{lod0:right,lod1:right,lod2:right},fileSha256:{lod0:hash(delivery),lod1:hash(delivery),lod2:hash(delivery)},...(repair?{sourceRepairs:repair.audit}:{}),visualAcceptance:'LOD0 staging only; equipment, mounts, lower LODs and performance NOT accepted.',knownLimitations:['LOD1/2 temporarily reference LOD0 during full fidelity validation.','Axe hit timing and grip contacts await runtime measurement.',...(faction==='roman'?['Source swordSlash 0.1231° and bowRelease 1.8778° exceed source strict 0.1° threshold.']:[])]}
 const dir=path.join(destination,manifest.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'lod0.glb'),delivery);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.copyFileSync(path.join(sourceRoot,def.folder,'README_繁中.txt'),path.join(dir,'source-readme.txt'));fs.copyFileSync(path.join(sourceRoot,def.folder,'Verification.json'),path.join(dir,'source-verification.json'))
 console.log(faction,{scale,height:manifest.metrics.heightM,shoulder:manifest.metrics.shoulderWidthM,neck:manifest.metrics.neckLengthM,triangles:count})
}
