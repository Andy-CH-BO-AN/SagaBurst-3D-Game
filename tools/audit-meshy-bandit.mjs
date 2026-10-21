/** Standalone shipped-asset audit, deliberately not a unit test or gameplay verdict. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import * as T from 'three'
import { readGlb, loadRig, readAccessor } from './lib/humanoid-glb.mjs'
const base='public/models/characters/v2/bandit', report={kind:'Standalone final GLB structural and sampled deformation audit; not visual/combat acceptance',lods:[]}
const required=['hips','spine','chest','neck','head',...['l','r'].flatMap(s=>['upper_arm','lower_arm','hand','upper_leg','lower_leg','foot','toe'].map(n=>`${n}_${s}`)),'socket_hand_l','socket_hand_r','socket_back','socket_head','socket_pelvis','socket_foot_l','socket_foot_r','sole_l','sole_r','Bandit_Hammer','hammer_grip','hammer_tip']
const manifest=JSON.parse(fs.readFileSync(`${base}/manifest.json`));assert.equal(manifest.animations.embedded.find(a=>a.clip==='swordSlash').events.hit,.252)
const hashes=new Set();let referenceSkeleton
for(let lod=0;lod<3;lod++){
 const path=`${base}/lod${lod}.glb`,bytes=fs.readFileSync(path),raw=readGlb(path),{document:d}=raw,g=await loadRig(raw),scene=g.scene
 assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.fileSha256[`lod${lod}`],'Published hash mismatch')
 for(const animation of d.animations)for(const channel of animation.channels){assert(channel.target.path!=='scale','Unexpected animated scale');if(channel.target.path==='translation')assert.equal(d.nodes[channel.target.node].name,'hips','Unexpected root motion');const values=readAccessor(raw,animation.samplers[channel.sampler].output);assert([...values].every(Number.isFinite));if(channel.target.path==='rotation')for(let i=0;i<values.length;i+=4)assert(Math.abs(Math.hypot(...values.slice(i,i+4))-1)<1e-5,'Unnormalized quaternion')}
 for(const name of required)assert(scene.getObjectByName(name),`LOD${lod}: missing ${name}`)
 assert.equal(scene.getObjectByName('Bandit_Hammer').parent.name,'hand_r');assert.equal(d.skins.length,1)
 const skeleton=d.skins[0].joints.map(i=>{const n=d.nodes[i];return {name:n.name,translation:n.translation,rotation:n.rotation,scale:n.scale,parent:d.nodes.find(p=>p.children?.includes(i))?.name}});if(referenceSkeleton)assert.deepEqual(skeleton,referenceSkeleton,'LOD skeleton/rest contract drift');else referenceSkeleton=skeleton
 for(const index of d.scenes[d.scene??0].nodes)assert((d.nodes[index].scale??[1,1,1]).every(v=>Math.abs(v-1)<1e-5),'Non-unit root scale')
 assert.deepEqual(g.animations.map(c=>c.name).sort(),['death','hit','idle','run','swordSlash','walk'])
 assert(Math.abs(g.animations.find(c=>c.name==='swordSlash').duration-.48)<1e-6)
 const weights=[];scene.traverse(o=>{if(!o.isSkinnedMesh)return;const a=o.geometry.attributes.skinWeight;let maxError=0;for(let i=0;i<a.count;i++){const w=[a.getX(i),a.getY(i),a.getZ(i),a.getW(i)];assert(w.every(v=>Number.isFinite(v)&&v>=0));maxError=Math.max(maxError,Math.abs(w.reduce((a,b)=>a+b,0)-1))}assert(maxError<1e-5);weights.push({mesh:o.name,vertices:a.count,maxWeightSumError:maxError})})
 for(const m of d.materials){assert(!(m.emissiveFactor??[0,0,0]).some(v=>v!==0),'Unexpected emissive');assert(!m.emissiveTexture,'Unexpected emissive texture')}
 const mixer=new T.AnimationMixer(scene),clips={}
 for(const clip of g.animations){const digest=createHash('sha256');for(const t of clip.tracks)digest.update(Buffer.from(t.values.buffer));const h=digest.digest('hex');assert(!hashes.has(`${lod}:${h}`),'Duplicate clip content');hashes.add(`${lod}:${h}`)
  mixer.stopAllAction();const action=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();let minGround=Infinity,maxGround=-Infinity,height=0,maxGripError=0,rotationMotion=0;const hammer=scene.getObjectByName('Bandit_Hammer'),fixed=hammer.matrix.clone(),poses=[]
  for(let i=0;i<=60;i++){const time=clip.duration*i/60;action.paused=false;mixer.setTime(time);scene.updateMatrixWorld(true);const box=new T.Box3();scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld))}});assert([...box.min.toArray(),...box.max.toArray()].every(Number.isFinite));minGround=Math.min(minGround,box.min.y);maxGround=Math.max(maxGround,box.min.y);if(i===0)height=box.max.y-box.min.y;maxGripError=Math.max(maxGripError,...hammer.matrix.elements.map((v,j)=>Math.abs(v-fixed.elements[j])));if(i%15===0)poses.push({time,hand:scene.getObjectByName('hand_r').getWorldPosition(new T.Vector3()).toArray(),hammerTip:scene.getObjectByName('hammer_tip').getWorldPosition(new T.Vector3()).toArray()})}
  for(const track of clip.tracks.filter(t=>t.name.endsWith('.quaternion')))for(let i=4;i<track.values.length;i++)rotationMotion=Math.max(rotationMotion,Math.abs(track.values[i]-track.values[i%4]));assert(rotationMotion>1e-4,`${clip.name} has no real movement`);assert(maxGripError<1e-6)
  clips[clip.name]={duration:clip.duration,minGroundY:minGround,maxGroundY:maxGround,firstFrameHeightM:height,maxHammerLocalMatrixDeviation:maxGripError,maxQuaternionComponentMotion:rotationMotion,poses}
 }
 const triangles=d.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+d.accessors[p.indices].count/3,0),0)
 report.lods.push({level:lod,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,triangles,drawCalls:d.meshes.reduce((n,m)=>n+m.primitives.length,0),skinJoints:d.skins[0].joints.length,materials:d.materials.map(m=>({name:m.name,metallicFactor:m.pbrMetallicRoughness?.metallicFactor,roughnessFactor:m.pbrMetallicRoughness?.roughnessFactor,normal:!!m.normalTexture,emissive:!!m.emissiveTexture})),weights,clips})
}
report.coordinateConvention={up:'+Y',forward:'+Z',runtimeScale:[1,1,1],rootMotion:'Offline authored hips translation only; no actor/gameplay/root-object motion'}
report.handGrip='Right-hand palm-local rigid original hammer; no fabricated finger joint or donor body'
report.browserAcceptance='Not run: Chromium process socket denied by execution sandbox; offline Blender evidence is separate'
fs.writeFileSync(`${base}/audit.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.lods.map(l=>({lod:l.level,triangles:l.triangles,bytes:l.bytes,height:l.clips.idle.firstFrameHeightM,ground:l.clips.idle.minGroundY})),null,2))
