/** Structural audit, not a substitute for rendered or in-game acceptance. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readGlb, loadRig} from './lib/humanoid-glb.mjs'
import {decodeMeshoptGlb} from './lib/meshopt-glb.mjs'
const hash = x => createHash('sha256').update(x).digest('hex')
const read = p => JSON.parse(fs.readFileSync(p,'utf8'))
const fingers = /^(thumb|index|middle|ring|pinky)_0[123]_[lr]$/
const ids=['roman-t1','roman-t2','viking-t1','viking-t2']
function accessor(asset,index) {
 const a=asset.document.accessors[index], v=asset.document.bufferViews[a.bufferView]
 assert(!a.sparse,'Sparse accessor not supported by this audit')
 const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type]
 const [size,method,max]={5121:[1,'readUInt8',255],5123:[2,'readUInt16LE',65535],5125:[4,'readUInt32LE',4294967295],5126:[4,'readFloatLE',1]}[a.componentType]
 return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,j)=>asset.binary[method]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??size*components)+j*size)/(a.normalized?max:1)))
}
for(const id of ids) {
 const dir=path.join(process.argv[2]??'public/models/characters/v2',id), manifest=read(path.join(dir,'manifest.json'))
 const donor=read(path.join(process.argv[2]??'public/models/characters/v2',id.split('-')[0],'manifest.json'))
 for(const binding of manifest.animations.embedded){const original=donor.animations.embedded.find(a=>a.clip===binding.clip);assert(original,`Missing donor action ${binding.clip}`);assert.equal(binding.duration,original.duration);assert.deepEqual(binding.events,original.events)}
 const lods=[]; let handPreserved=true; let signature, baseHandSurface
 for(const lod of ['lod0','lod1','lod2']) {
  const file=path.join(dir,manifest.files[lod]), sha256=hash(fs.readFileSync(file))
  assert.equal(sha256,manifest.fileSha256[lod])
  const asset=await decodeMeshoptGlb(readGlb(file)), d=asset.document
  const rigSignature=JSON.stringify(d.nodes.filter(n=>n.name).map(n=>[n.name,n.children?.map(i=>d.nodes[i].name),n.translation,n.rotation,n.scale]).filter(n=>!d.nodes.find(x=>x.name===n[0])?.mesh))
  if(signature) assert.equal(rigSignature,signature,'LOD skeleton/socket rest transforms differ'); else signature=rigSignature
  const counts=new Map(), handSurface=new Set();let vertices=0,maxWeightSumError=0,maxInfluences=0,minFirstFourWeightSum=1,verticesWithAdditionalInfluences=0
  for(const node of d.nodes.filter(n=>n.skin!==undefined&&n.mesh!==undefined)) {
   const skin=d.skins[node.skin]
   for(const p of d.meshes[node.mesh].primitives) {
    const pos=accessor(asset,p.attributes.POSITION)
    const sets=Object.keys(p.attributes).filter(x=>x.startsWith('JOINTS_')).map(k=>({j:accessor(asset,p.attributes[k]),w:accessor(asset,p.attributes[k.replace('JOINTS_','WEIGHTS_')])}))
    assert.equal(sets.length,4,'Complete-skin runtime expects all four padded weight sets')
    for(let i=0;i<pos.length;i++) {
     assert(pos[i].every(Number.isFinite));let sum=0,n=0;const influences=[]
     for(const s of sets) for(let k=0;k<4;k++) {
      const w=s.w[i][k],j=s.j[i][k];assert(Number.isFinite(w)&&w>=0);assert(Number.isInteger(j)&&j<skin.joints.length)
      sum+=w;if(w>0){n++;const name=d.nodes[skin.joints[j]].name;counts.set(name,(counts.get(name)??0)+1);influences.push([name,w])}
     }
     if(influences.some(([name,w])=>fingers.test(name)&&w>1e-7)) handSurface.add(JSON.stringify([pos[i].map(v=>Math.round(v*1e6)),influences.filter(([,w])=>w>1e-7).sort(([a],[b])=>a.localeCompare(b)).map(([name,w])=>[name,Math.round(w*1e6)])]))
     const firstFour=sets[0].w[i].reduce((a,b)=>a+b,0);minFirstFourWeightSum=Math.min(minFirstFourWeightSum,firstFour);if(firstFour<.9999)verticesWithAdditionalInfluences++
     maxWeightSumError=Math.max(maxWeightSumError,Math.abs(1-sum));maxInfluences=Math.max(maxInfluences,n);vertices++
    }
   }
  }
  assert(maxInfluences<=16)
  assert(maxWeightSumError<1e-5,`Weights not normalized: ${maxWeightSumError}`)
  const fingerInfluences=Object.fromEntries([...counts].filter(([name])=>fingers.test(name)))
  assert.equal(Object.keys(fingerInfluences).length,30,'Every finger joint must influence geometry')
  const handRows=[...handSurface].map(JSON.parse)
  const handPositionKeys=new Set(handRows.map(([p])=>JSON.stringify(p)))
  const handSurfaceSha256=hash([...handPositionKeys].sort().join('\n'))
  let maxHandWeightDelta=0
  if(baseHandSurface) {
    const compare=(from,to)=>{
      const positions=new Map()
      for(const [p,w] of to){const key=p.join(',');if(!positions.has(key))positions.set(key,[]);positions.get(key).push(w)}
      for(const [p,w] of from){
        const candidates=positions.get(p.join(','))??to.filter(([q])=>q.every((v,i)=>Math.abs(v-p[i])<=1)).map(([,v])=>v)
        assert(candidates.length,`${id}/${lod} changed a finger-weighted rest position`)
        const original=new Map(w)
        const delta=Math.min(...candidates.map(v=>{const current=new Map(v);return Math.max(...[...new Set([...original.keys(),...current.keys()])].map(name=>Math.abs((original.get(name)??0)-(current.get(name)??0))))})) / 1e6
        maxHandWeightDelta=Math.max(maxHandWeightDelta,delta)
      }
    }
    compare(baseHandSurface,handRows);compare(handRows,baseHandSurface)
    handPreserved=maxHandWeightDelta<=1e-5
    assert(handPreserved,`${id}/${lod} changed hand weights by ${maxHandWeightDelta}`)
  } else {baseHandSurface=handRows}
  const rig=await loadRig(asset), clips=[]
  for(const clip of rig.animations) {
   const tracks=clip.tracks.filter(t=>fingers.test(t.name.replace('.quaternion','')))
   assert.equal(tracks.length,30)
   for(const t of clip.tracks) assert([...t.times,...t.values].every(Number.isFinite))
   const binding=manifest.animations.embedded.find(a=>a.clip===clip.name);assert(binding,clip.name)
   assert(Math.abs(clip.duration-binding.duration)<1e-5)
   clips.push({name:clip.name,duration:clip.duration,fingerTracks:tracks.length,animatedFingerTracks:tracks.filter(t=>Array.from(t.values).some((v,i)=>Math.abs(v-t.values[i%4])>1e-6)).length,fingerPoseSha256:hash(Buffer.concat(tracks.map(t=>Buffer.from(t.values.buffer,t.values.byteOffset,t.values.byteLength))))})
  }
  assert.equal(clips.length,12)
  assert(new Set(clips.map(c=>c.fingerPoseSha256)).size>=4,'Finger poses must differ across actions')
  lods.push({lod,sha256,vertices,fingerWeightedUniquePositions:handPositionKeys.size,handSurfaceSha256,maxHandWeightDelta,maxInfluences,minFirstFourWeightSum,verticesWithAdditionalInfluences,maxWeightSumError,fingerInfluences,clips})
 }
 const sourceFile=path.join('output/tiered-sources',id,'source-preservation-audit.json')
 const previous=fs.existsSync(path.join(dir,'audit.json'))?read(path.join(dir,'audit.json')):{}
 const audit={schemaVersion:1,id,structuralStatus:'passed',source:manifest.source,sourcePreservation:fs.existsSync(sourceFile)?read(sourceFile):previous.sourcePreservation??{status:'not-run'},sharedLodSkeletonAndSockets:true,handSurfacePreservation:{status:'passed',method:'Bidirectional finger-weighted rest position and named-weight correspondence, independent of indices or UV seam duplication.',positionToleranceM:1e-6,weightTolerance:1e-5},lods,visualValidation:previous.visualValidation??{status:'pending',note:'Offline source/grip renders are being reviewed separately. Structural checks do not establish visual acceptance.'},runtimeValidation:previous.runtimeValidation??{status:'not-run',note:'Actual game weapon contact, mounted/seat motion, LOD transitions and formation acceptance remain pending.'}}
 if(!process.argv.includes('--check-only')) fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(id,handPreserved?'structural pass':'FAILED hand LOD preservation',lods.map(l=>`${l.lod}: ${l.vertices} verts, ${l.maxInfluences} max influences, hand-weight delta ${l.maxHandWeightDelta}`).join('; '))
}
