/** Re-measure the packaged GLBs with the same Three.js skin evaluator as runtime. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as T from 'three'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
const base='public/models/characters/v2/bandit'
const report=JSON.parse(fs.readFileSync(`${base}/audit.json`,'utf8'))
report.lods=[]
for(let lod=0;lod<3;lod++){
 const asset=readGlb(`${base}/lod${lod}.glb`),gltf=await loadRig(asset),scene=gltf.scene
 const mixer=new T.AnimationMixer(scene),clips={}
 for(const clip of gltf.animations){
  mixer.stopAllAction();const action=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play()
  let minGround=Infinity,maxGround=-Infinity,idleHeight=0,maxGripDeviation=0
  const hammer=scene.getObjectByName('Bandit_Hammer'),matrix=hammer.matrix.clone()
  for(let i=0;i<=60;i++){
   action.paused=false;mixer.setTime(clip.duration*i/60);scene.updateMatrixWorld(true)
   const box=new T.Box3()
   scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld))}})
   if(![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))throw Error('Non-finite skin bounds')
   minGround=Math.min(minGround,box.min.y);maxGround=Math.max(maxGround,box.min.y)
   if(i===0)idleHeight=box.max.y-box.min.y
   maxGripDeviation=Math.max(maxGripDeviation,...hammer.matrix.elements.map((v,j)=>Math.abs(v-matrix.elements[j])))
  }
  clips[clip.name]={duration:clip.duration,minGroundY:minGround,maxGroundY:maxGround,firstFrameHeightM:idleHeight,maxHammerLocalMatrixDeviation:maxGripDeviation}
 }
 report.lods.push({level:lod,sha256:createHash('sha256').update(fs.readFileSync(`${base}/lod${lod}.glb`)).digest('hex'),bytes:fs.statSync(`${base}/lod${lod}.glb`).size,triangles:asset.document.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+asset.document.accessors[p.indices].count/3,0),0),skins:asset.document.skins.length,bones:asset.document.skins[0].joints.length,materials:asset.document.materials.map(m=>({name:m.name,baseColor:!!m.pbrMetallicRoughness.baseColorTexture,normal:!!m.normalTexture,metallicRoughness:!!m.pbrMetallicRoughness.metallicRoughnessTexture,ao:!!m.occlusionTexture})),clips})
}
report.coordinateConvention={up:'+Y',forward:'+Z',runtimeScale:[1,1,1],rootMotion:'No armature object translation/scale tracks; original in-place locomotion and intentional local death fall retained'}
report.handGrip='Source RightHand rigid hammer; source run frame 8 right-finger rotations baked into all selected actions'
fs.writeFileSync(`${base}/audit.json`,JSON.stringify(report,null,2)+'\n')
console.log(report.lods.map(x=>({lod:x.level,triangles:x.triangles,bytes:x.bytes,idleHeight:x.clips.idle.firstFrameHeightM,ground:x.clips.idle.minGroundY})))
