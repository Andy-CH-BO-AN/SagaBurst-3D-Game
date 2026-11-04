/** Reproducible local hand/animation repair, run after the source hero builders.
 * node tools/repair-hero-fingers.mjs ORIGINAL_ASSET_ROOT REFERENCE_JSON [OUTPUT_ROOT]
 * Prepare REFERENCE_JSON using prepare-hand-reference.py and the licensed source.
 * ORIGINAL_ASSET_ROOT must be an unmodified checkout of the source manifests.
 */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import * as T from 'three'
import {readGlb,encodeGlb,loadRig} from './lib/humanoid-glb.mjs'
import {decodeMeshoptGlb} from './lib/meshopt-glb.mjs'
import {packGlbResources} from './lib/pack-glb-resources.mjs'
import {packFactionHumanoidBuffers} from './pack-faction-humanoid-buffers.mjs'
import {repairReferenceHands} from './lib/reference-hand-surface.mjs'
import {preserveHandLodSurface} from './lib/hand-lod-surface.mjs'
import {buildAnatomicalFingerPoses,bakeAnatomicalFingerClips,fingerPattern} from './lib/anatomical-finger-pose.mjs'
const [inputRoot,referencePath,outputRoot='public/models/characters/v2']=process.argv.slice(2)
if(!inputRoot||!referencePath)throw Error('Usage: node tools/repair-hero-fingers.mjs ORIGINAL_ASSET_ROOT REFERENCE_JSON [OUTPUT_ROOT]')
let preparedReference=referencePath
if(referencePath.toLowerCase().endsWith('.fbx')) {
 preparedReference='output/finger-anatomy/reference/hands.json'
 execFileSync(process.env.BLENDER??'blender',['-b','--python','tools/prepare-hand-reference.py','--',referencePath,preparedReference],{stdio:'inherit'})
}
const reference=JSON.parse(fs.readFileSync(preparedReference)),hash=b=>createHash('sha256').update(b).digest('hex')
const triangleCount=doc=>doc.meshes.reduce((s,m)=>s+m.primitives.reduce((s,p)=>s+doc.accessors[p.indices].count/3,0),0)
function accessorBytes(asset,index) {
 const a=asset.document.accessors[index],view=asset.document.bufferViews[a.bufferView],width=({5121:1,5123:2,5125:4,5126:4}[a.componentType])*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]),rows=[]
 if(!width||a.sparse)throw Error('Unsupported guarded accessor')
 for(let i=0;i<a.count;i++){const offset=(view.byteOffset??0)+(a.byteOffset??0)+i*(view.byteStride??width);rows.push(asset.binary.subarray(offset,offset+width))}
 return Buffer.concat(rows)
}
function bodyAnimationDigest(asset) {
 const digest=createHash('sha256'),doc=asset.document
 for(const animation of doc.animations){digest.update(animation.name)
  for(const channel of animation.channels){const name=doc.nodes[channel.target.node].name
   if(channel.target.path==='rotation'&&fingerPattern.test(name))continue
   const sampler=animation.samplers[channel.sampler];digest.update(JSON.stringify([name,channel.target.path,sampler.interpolation??'LINEAR']));digest.update(accessorBytes(asset,sampler.input));digest.update(accessorBytes(asset,sampler.output))
  }
 }
 return digest.digest('hex')
}
function preservedRestDigest(doc) {
 return hash(Buffer.from(JSON.stringify(doc.nodes.filter(n=>!fingerPattern.test(n.name)).map(n=>[n.name,n.translation,n.rotation,n.scale,n.matrix,(n.children??[]).map(i=>doc.nodes[i].name)]))))
}
for(const id of ['viking-hero-t4','viking-hero-t5','roman-hero-t4','maki-archer-t4']) {
 const sourceDir=path.join(inputRoot,id),destination=path.join(outputRoot,id),manifest=JSON.parse(fs.readFileSync(path.join(sourceDir,'manifest.json')))
 if(manifest.fingerAnatomyBuild)throw Error(`Use original inputs, not repaired ${id}`)
 fs.mkdirSync(destination,{recursive:true});const reports=[];let poses,boneMap
 const meshSource=['viking-hero-t5','roman-hero-t4'].includes(id)?await loadRig(await decodeMeshoptGlb(readGlb(path.join(sourceDir,manifest.files.lod0)))):null
 for(const lod of [0,1,2]) {
  const key=`lod${lod}`,filename=manifest.files[key],bytes=fs.readFileSync(path.join(sourceDir,filename))
  if(hash(bytes)!==manifest.fileSha256[key])throw Error(`Source hash mismatch ${id}/${key}`)
  const asset=await decodeMeshoptGlb(readGlb(path.join(sourceDir,filename))),doc=asset.document,rig=await loadRig(asset),before=triangleCount(doc)
  const animationBefore=bodyAnimationDigest(asset),restBefore=preservedRestDigest(doc)
  const surface=meshSource&&lod>0?preserveHandLodSurface(meshSource,rig):repairReferenceHands(rig,doc,id,lod,reference)
  if(lod===0&&surface?.boneRecords.length&&fs.existsSync(path.join(sourceDir,'bone-map.json'))){
   boneMap=JSON.parse(fs.readFileSync(path.join(sourceDir,'bone-map.json')))
   const conversion=new T.Matrix4().makeRotationX(Math.PI/2),fingers={}
   for(const {name}of surface.boneRecords){const b=rig.scene.getObjectByName(name),j=Number(name.split('_')[1]),next=rig.scene.getObjectByName(name.replace(`_0${j}_`,`_0${j+1}_`)),head=b.getWorldPosition(new T.Vector3()).applyMatrix4(conversion),tail=(next?next.getWorldPosition(new T.Vector3()):b.localToWorld(new T.Vector3(...surface.tips[name]))).applyMatrix4(conversion),matrix=conversion.clone().multiply(b.matrixWorld)
    const record={parent:b.parent.name,headBlenderM:head.toArray(),tailBlenderM:tail.toArray(),restMatrixBlender:matrix.clone().transpose().toArray(),lengthM:head.distanceTo(tail)}
    if(boneMap.bones)boneMap.bones[name]=record;else fingers[name]=record
   }
   if(!boneMap.bones)boneMap.fingers=fingers
   boneMap.fingerAnatomyRepair={tool:'tools/repair-hero-fingers.mjs',referenceSha256:reference.sourceSha256,scope:'Only finger rest transforms; body hierarchy, wrist and sockets retained'}
  }
  const left=manifest.handGripFrames.left,right=manifest.swordGripFrames[key]
  if(!poses)poses=buildAnatomicalFingerPoses(rig,{r:right,l:{gripCenterLocal:left.palmContactCenter.map((v,i)=>v+left.palmNormal[i]*(right.gripRadius??.022)),gripAxisLocal:left.thumbDirection,gripRadius:right.gripRadius}},surface?.tips)
  const clips=bakeAnatomicalFingerClips(rig,poses,manifest.animations.embedded),chunks=[asset.binary];let offset=asset.binary.length
  const append=(values,type,componentType=5126,target)=>{
   const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type],padding=(4-offset%4)%4
   if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
   const buffer=Buffer.from(values.buffer,values.byteOffset,values.byteLength),view=doc.bufferViews.length
   doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length,...(target?{target}:{})});chunks.push(buffer);offset+=buffer.length
   const a={bufferView:view,componentType,count:values.length/size,type}
   if(type==='SCALAR'&&componentType===5126){a.min=[Math.min(...values)];a.max=[Math.max(...values)]}
   if(type==='VEC3'&&target===34962){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++) {const c=i%3;a.min[c]=Math.min(a.min[c],values[i]);a.max[c]=Math.max(a.max[c],values[i])}}
   doc.accessors.push(a);return doc.accessors.length-1
  }
  if(surface) {
   for(const mesh of surface.meshes){const association=rig.parser.associations.get(mesh),primitive=doc.meshes[association.meshes].primitives[association.primitives],g=mesh.geometry
    primitive.attributes={}
    for(const [key,semantic,type]of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2'],['skinIndex','JOINTS_0','VEC4'],['skinWeight','WEIGHTS_0','VEC4']])primitive.attributes[semantic]=append(g.attributes[key].array,type,key==='skinIndex'?5123:5126,34962)
    primitive.indices=append(new Uint32Array(g.index.array),'SCALAR',5125,34963)
   }
   for(const entry of [...surface.removePrimitives].sort((a,b)=>b.primitives-a.primitives))doc.meshes[entry.meshes].primitives.splice(entry.primitives,1)
   for(const record of surface.boneRecords){const n=doc.nodes[record.node];n.translation=record.translation;n.rotation=record.rotation;delete n.matrix}
   for(const skin of doc.skins){const matrices=[]
    const mesh=(()=>{let found;rig.scene.traverse(o=>{if(o.isSkinnedMesh&&o.skeleton.bones.some(b=>rig.parser.associations.get(b)?.nodes===skin.joints[0]))found=o});return found})()
    for(const node of skin.joints){const i=mesh.skeleton.bones.findIndex(b=>rig.parser.associations.get(b)?.nodes===node);matrices.push(...mesh.skeleton.boneInverses[i].toArray())}
    skin.inverseBindMatrices=append(new Float32Array(matrices),'MAT4')
   }
  }
  let preservedChannels=0
  for(const animation of doc.animations){
   animation.channels=animation.channels.filter(c=>{const owned=c.target.path==='rotation'&&fingerPattern.test(doc.nodes[c.target.node].name);if(!owned)preservedChannels++;return !owned})
   const clip=clips.find(c=>c.name===animation.name)
   for(const track of clip.tracks.filter(t=>fingerPattern.test(t.name.split('.')[0]))){
    const node=doc.nodes.findIndex(n=>n.name===track.name.split('.')[0]);animation.channels.push({sampler:animation.samplers.length,target:{node,path:'rotation'}})
    animation.samplers.push({input:append(track.times,'SCALAR'),output:append(track.values,'VEC4'),interpolation:'LINEAR'})
   }
  }
  doc.buffers[0].byteLength=offset
  const binary=packGlbResources(doc,Buffer.concat(chunks)),packed=manifest.bufferCompression?await packFactionHumanoidBuffers({document:doc,binary}):{document:doc,binary}
  const output=encodeGlb(packed.document,packed.binary),after=triangleCount(packed.document)
  if(lod===0&&before!==after)throw Error(`LOD0 budget changed ${id}: ${before} -> ${after}`)
  const roundTrip=await decodeMeshoptGlb({document:packed.document,binary:packed.binary})
  const animationAfter=bodyAnimationDigest(roundTrip),restAfter=preservedRestDigest(roundTrip.document)
  if(animationBefore!==animationAfter||restBefore!==restAfter)throw Error(`Unrelated body animation/rest/socket data changed: ${id}/${key}`)
  await loadRig(roundTrip)
  fs.writeFileSync(path.join(destination,filename),output);manifest.fileSha256[key]=hash(output);manifest.metrics.triangles[key]=after
  reports.push({lod,before,after,originalSha256:hash(bytes),outputSha256:hash(output),preservedNonFingerChannels:preservedChannels,bodyAnimationSha256:animationAfter,bodyRestAndSocketsSha256:restAfter,localSurfaceRepair:surface?.report??null})
 }
 manifest.articulatedFingerPoses={relaxed:poses.relaxed,grip:poses.grip}
 if(manifest.animationRetarget?.fingerDonor){delete manifest.animationRetarget.fingerDonor;manifest.animationRetarget.method='Existing body retarget unchanged. Finger-only target-bind poses replace the former Roman donor plus additive grasp; source events and durations retained.'}
 manifest.knownLimitations=(manifest.knownLimitations??[]).map(item=>item.includes('Thirty anatomical finger tracks')?'Finger contact uses the measured asset handle radius; unusually thick replacement handles still require visual review.':item)
 manifest.fingerAnatomyBuild={tool:'tools/repair-hero-fingers.mjs',version:1,sourceManifestSha256:hash(fs.readFileSync(path.join(sourceDir,'manifest.json'))),handReference:{source:reference.source,sourceSha256:reference.sourceSha256,author:reference.author,license:reference.license},lods:reports}
 manifest.fingerAnatomyBuild.sourceStageAudit=manifest.audit??'lod-audit.json'
 manifest.audit='finger-anatomy-audit.json'
 manifest.modifications=[...(manifest.modifications??[]),'Local hand anatomy repair; target-bind absolute finger poses distinguish natural hand shape from equipment contact. Body animation samples, wrist/socket transforms and action/event clocks retained.']
 manifest.visualAcceptance='Pending current browser review; numeric/structural checks do not establish appearance.'
 if(id==='viking-hero-t4'||id==='maki-archer-t4'){
  manifest.attribution+=' Local hand surface derivative: Kevin Iglesias, Human Melee Animations FREE (Unity Asset Store EULA); complete source model excluded.'
  fs.writeFileSync(path.join(destination,'hand-source-attribution.txt'),`Local hand surface derivative: Kevin Iglesias, Human Melee Animations FREE.\nSource: https://kevdev.itch.io/human-melee-animatons-free\nLicense: Unity Asset Store EULA, https://unity.com/legal/as-terms\nReference FBX SHA-256: ${reference.sourceSha256}\nOnly the hand derivative is embedded in this character. The complete reference FBX and standalone extracted hand are not shipped. The original character body/material source terms remain unchanged; the body license does not replace the reference hand terms.\nRebuild: tools/prepare-hand-reference.py and tools/repair-hero-fingers.mjs; see docs/hero-hand-repair.md.\n`)
 }
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 if(boneMap)fs.writeFileSync(path.join(destination,'bone-map.json'),JSON.stringify(boneMap,null,2)+'\n')
 fs.writeFileSync(path.join(destination,'finger-anatomy-audit.json'),JSON.stringify({builder:'tools/repair-hero-fingers.mjs',lods:reports,poseFit:poses.diagnostics,visualAcceptance:manifest.visualAcceptance},null,2)+'\n')
 console.log(id,JSON.stringify(reports.map(r=>({lod:r.lod,before:r.before,after:r.after,local:r.localSurfaceRepair}))))
}
