/** Audit exported runtime GLBs, including rigid mask and all embedded clips. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig, readAccessor } from './lib/humanoid-glb.mjs'
const dir='public/models/characters/v2/roman-hero-t4',base='public/models/characters/v2/roman'
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`)),source=JSON.parse(fs.readFileSync(`${base}/manifest.json`))
const required=JSON.parse(fs.readFileSync(`${dir}/bone-map.json`)),failures=[],rows=[]
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
function dimensions(b){
  if(b.toString('ascii',1,4)==='PNG')return[b.readUInt32BE(16),b.readUInt32BE(20)]
  let i=2
  while(i<b.length){if(b[i++]!==255)continue;const marker=b[i++];if(marker===216||marker===217)continue
    const length=b.readUInt16BE(i)
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return[b.readUInt16BE(i+5),b.readUInt16BE(i+3)]
    i+=length
  }throw Error('Unknown image dimensions')
}
const accessorBytes=(a,index)=>{const x=a.document.accessors[index],v=a.document.bufferViews[x.bufferView];return a.binary.subarray((v.byteOffset??0)+(x.byteOffset??0),(v.byteOffset??0)+v.byteLength)}
const imageBytes=(a,image)=>{const v=a.document.bufferViews[image.bufferView];return a.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)}
for(let lod=0;lod<3;lod++){
  const file=`${dir}/lod${lod}.glb`,a=readGlb(file),s=readGlb(`${base}/lod${lod}.glb`),g=await loadRig(a)
  g.scene.updateMatrixWorld(true)
  const meshes=[],rest=new Map();g.scene.traverse(o=>{rest.set(o,{p:o.position.clone(),q:o.quaternion.clone()});if(o.isMesh)meshes.push(o)})
  const reset=()=>{for(const[o,t]of rest){o.position.copy(t.p);o.quaternion.copy(t.q)}g.scene.updateMatrixWorld(true)}
  const missing=[...required.generatedBones,...required.generatedSockets,'Praetorian_face_mask'].filter(n=>!g.scene.getObjectByName(n))
  const triangles=a.document.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+a.document.accessors[p.indices??p.attributes.POSITION].count/3,0)
  let badWeights=0,changedTopology=0,changedUVorWeights=0,positionScaleMaxError=0
  const localRepairs=[]
  for(const mesh of meshes.filter(m=>m.isSkinnedMesh)){
    const w=mesh.geometry.attributes.skinWeight
    for(let i=0;i<w.count;i++){let sum=0;for(let j=0;j<4;j++)sum+=w.getComponent(i,j);if(!Number.isFinite(sum)||Math.abs(sum-1)>.001)badWeights++}
  }
  for(let mi=0;mi<s.document.meshes.length;mi++)for(let pi=0;pi<s.document.meshes[mi].primitives.length;pi++){
    const p=s.document.meshes[mi].primitives[pi],q=a.document.meshes[mi].primitives[pi]
    const name=s.document.meshes[mi].name
    if(/^RomanUndertunic_[lr]$/.test(name)){
      localRepairs.push({name,sourceVertices:s.document.accessors[p.attributes.POSITION].count,heroVertices:a.document.accessors[q.attributes.POSITION].count,reason:'narrow waist and intermediate thigh weight-support rings'})
      if(p.material!==q.material)failures.push(`LOD${lod}: changed lining material`)
      continue
    }
    if(!accessorBytes(s,p.indices).equals(accessorBytes(a,q.indices)))changedTopology++
    const repairedWeights=['Armour_top','Wrist_guard1'].includes(name)
    for(const key of ['TEXCOORD_0','JOINTS_0','WEIGHTS_0','NORMAL'])if(!(repairedWeights&&['JOINTS_0','WEIGHTS_0'].includes(key))&&p.attributes[key]!==undefined&&!accessorBytes(s,p.attributes[key]).equals(accessorBytes(a,q.attributes[key])))changedUVorWeights++
    const sp=readAccessor(s,p.attributes.POSITION),hp=readAccessor(a,q.attributes.POSITION)
    if(repairedWeights){
      localRepairs.push({name,reason:name==='Armour_top'?'shoulder weights match sleeve transition':'bracer ends below elbow and follows forearm'})
      const current=g.scene.getObjectByName(name),mesh=current.isMesh?current:current.children[pi]
      const j=mesh.geometry.attributes.skinIndex,w=mesh.geometry.attributes.skinWeight
      for(let i=0;i<w.count;i++){
        const x=sp[i*3],y=sp[i*3+1],side=x>0?'l':'r'
        const amount=name==='Wrist_guard1'?0:THREE.MathUtils.smoothstep(Math.abs(x),.16,.32)*THREE.MathUtils.smoothstep(y,1.34,1.40)
        if(mesh.skeleton.bones[j.getX(i)].name!==(name==='Wrist_guard1'?`lower_arm_${side}`:'chest')||Math.abs(w.getX(i)-(1-amount))>1e-6||Math.abs(w.getY(i)-amount)>1e-6||w.getZ(i)!==0||w.getW(i)!==0)failures.push(`LOD${lod}: unexpected ${name} repair weight ${i}`)
        if(amount>0&&mesh.skeleton.bones[j.getY(i)].name!==`upper_arm_${side}`)failures.push(`LOD${lod}: shoulder repair target`)
      }
    }
    if(name==='Tunic_1')localRepairs.push({name,reason:'small under-pauldron cloth clearance'})
    if(name==='Tunic_1'||name==='Wrist_guard1')for(let i=0;i<sp.length;i+=3){
      if(name==='Tunic_1'){
        const x=Math.abs(sp[i]),f=THREE.MathUtils.smoothstep(x,.08,.13)*(1-THREE.MathUtils.smoothstep(x,.23,.32))*THREE.MathUtils.smoothstep(sp[i+1],1.30,1.38)
        sp[i+1]=1.40+(sp[i+1]-1.40)*(1-.12*f);sp[i+2]=-.025+(sp[i+2]+.025)*(1-.10*f)
      }else{
        sp[i]=Math.sign(sp[i])*(.548+(Math.abs(sp[i])-.453)/(.695-.453)*(.695-.548))
        sp[i+1]=1.40+(sp[i+1]-1.4105)*1.10;sp[i+2]=-.017+(sp[i+2]+.017)*1.10
      }
    }
    // Only skin concealed by the original sleeve/skirt is inset. Verify the
    // exact bounded edit, and still compare all exposed vertices and topology.
    if(name==='New_arms'||name==='New_legs'){
      localRepairs.push({name,reason:'covered skin inset; original topology, weights and exposed joints retained'})
      for(let i=0;i<sp.length;i+=3){
        if(name==='New_arms'){
          const hidden=THREE.MathUtils.smoothstep(Math.abs(sp[i]),.03,.10)*(1-THREE.MathUtils.smoothstep(Math.abs(sp[i]),lod===2?.37:.34,lod===2?.465:.425))
          sp[i+1]=1.40+(sp[i+1]-1.40)*(1-(lod===2?.52:.35)*hidden)
          sp[i+2]=-.025+(sp[i+2]+.025)*(1-(lod===2?.45:.25)*hidden)
        }else{
          const hidden=THREE.MathUtils.smoothstep(sp[i+1],.57,.70),center=Math.sign(sp[i])*.105
          sp[i]=center+(sp[i]-center)*(1-.23*hidden)
          sp[i+2]=.025+(sp[i+2]-.025)*(1-.23*hidden)
        }
      }
    }
    for(let i=0;i<sp.length;i++)positionScaleMaxError=Math.max(positionScaleMaxError,Math.abs(hp[i]-sp[i]*manifest.metrics.uniformScaleAppliedOffline))
  }
  const images=a.document.images.map((im,i)=>({name:im.name,dimensions:dimensions(imageBytes(a,im)),preserved:!/(New_|_NM$)/.test(im.name)||imageBytes(a,im).equals(imageBytes(s,s.document.images[i]))}))
  const box=new THREE.Box3().setFromObject(g.scene,true),headBox=new THREE.Box3().setFromObject(g.scene.getObjectByName('New_head'),true)
  const bodyHeightM=headBox.max.y-manifest.metrics.barefootPlaneY,clips=[]
  const mask=g.scene.getObjectByName('Praetorian_face_mask'),head=g.scene.getObjectByName('New_head'),ray=new THREE.Raycaster()
  mask.traverse(o=>{if(o.isMesh)o.material.side=THREE.DoubleSide});head.material.side=THREE.DoubleSide
  const scale=manifest.metrics.uniformScaleAppliedOffline,ground=a.document.asset.extras.romanHeroBuild.ground
  let faceClearanceM=Infinity,faceSamples=0,closestFaceSample=null
  for(let y=1.488;y<1.635;y+=.004)for(let x=-.06;x<=.06;x+=.004){
    ray.set(new THREE.Vector3(x*scale,y*scale+ground,.4),new THREE.Vector3(0,0,-1))
    const shell=ray.intersectObject(mask,true)[0],skin=ray.intersectObject(head)[0]
    if(shell&&skin){faceSamples++;const clearance=shell.point.z-skin.point.z;if(clearance<faceClearanceM){faceClearanceM=clearance;closestFaceSample={sourceX:x,sourceY:y,shellZ:shell.point.z,skinZ:skin.point.z}}}
  }
  const innerFaceClearanceM=faceClearanceM-.0025*scale
  if(innerFaceClearanceM<.001||!faceSamples)failures.push(`LOD${lod}: sampled INNER mask/face clearance ${innerFaceClearanceM} at ${JSON.stringify(closestFaceSample)}`)
  for(const clip of g.animations){
    reset();const mixer=new THREE.AnimationMixer(g.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()
    const samples=[],p=new THREE.Vector3()
    for(const fraction of [0,.125,.25,.5,.75,.875,1]){
      action.paused=false;mixer.setTime(fraction*clip.duration);g.scene.updateMatrixWorld(true)
      for(const mesh of meshes)if(mesh.isSkinnedMesh)mesh.skeleton.update()
      const b=new THREE.Box3()
      for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,p);p.applyMatrix4(mesh.matrixWorld);b.expandByPoint(p)}
      const finite=[...b.min.toArray(),...b.max.toArray()].every(Number.isFinite)
      if(!finite||b.getSize(new THREE.Vector3()).length()>4.5)failures.push(`LOD${lod} ${clip.name}: invalid/exploded bounds`)
      if(['idle','walk','run','swordSlash','death'].includes(clip.name)&&Math.abs(b.min.y-.003)>.008)failures.push(`LOD${lod} ${clip.name}@${fraction}: floor contact ${b.min.y}`)
      samples.push({time:fraction*clip.duration,min:b.min.toArray(),max:b.max.toArray()})
    }
    mixer.stopAllAction()
    const binding=manifest.animations.embedded.find(b=>b.clip===clip.name)
    if(!binding||Math.abs(binding.duration-clip.duration)>.0001)failures.push(`LOD${lod}: duration ${clip.name}`)
    const original=s.document.animations.find(c=>c.name===clip.name)
    if(original){const current=a.document.animations.find(c=>c.name===clip.name)
      for(const ch of original.channels.filter(c=>c.target.path==='rotation')){
        const target=current.channels.find(c=>c.target.path==='rotation'&&a.document.nodes[c.target.node].name===s.document.nodes[ch.target.node].name)
        for(const part of ['input','output']){
          const x=readAccessor(s,original.samplers[ch.sampler][part]),y=readAccessor(a,current.samplers[target.sampler][part])
          if(x.length!==y.length||x.some((v,i)=>v!==y[i]))failures.push(`LOD${lod}: altered source rotation/time ${clip.name}`)
        }
      }
    }
    clips.push({name:clip.name,duration:clip.duration,samples})
  }
  for(const binding of source.animations.embedded)if(JSON.stringify(binding.events)!==JSON.stringify(manifest.animations.embedded.find(b=>b.clip===binding.clip)?.events))failures.push(`LOD${lod}: changed events ${binding.clip}`)
  if(missing.length||badWeights||changedTopology||changedUVorWeights||positionScaleMaxError>1e-6||images.some(im=>!im.preserved||Math.max(...im.dimensions)>[2048,1024,512][lod])||Math.abs(bodyHeightM-1.95)>.002||triangles>[64000,22000,7000][lod]||hash(file)!==manifest.fileSha256[`lod${lod}`]||hash(`${base}/lod${lod}.glb`)!==manifest.lodMeasurements[lod].sourceSha256)failures.push(`LOD${lod}: structural/source preservation/budget check`)
  const node=a.document.nodes.find(n=>n.name==='head'),maskIndex=a.document.nodes.findIndex(n=>n.name==='Praetorian_face_mask')
  if(!node.children.includes(maskIndex))failures.push(`LOD${lod}: mask not head-attached`)
  rows.push({lod,triangles,maskTriangles:a.document.asset.extras.romanHeroBuild.maskTriangles,materials:a.document.materials.length,bytes:fs.statSync(file).size,bodyHeightM,overallHeightM:box.max.y-box.min.y,faceClearanceM,innerFaceClearanceM,faceSamples,missing,badWeights,changedTopology,changedUVorWeights,positionScaleMaxError,localRepairs:[...new Map(localRepairs.map(r=>[r.name,r])).values()],sha256:hash(file),images,clips})
}
const result={schemaVersion:1,assetId:manifest.id,method:'Actual GLTFLoader CPU vertex skinning plus rigid head attachment; seven samples/clip. Source topology/UV/normals preserved except two explicitly recorded hidden lining meshes; bounded covered-arm/thigh/cloth/bracer positions and local pauldron/forearm weights independently checked. All other weights preserved. Skin/eye images and source rotations preserved. Does not establish absence of intersections.',failures,rows}
fs.writeFileSync(`${dir}/audit.json`,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({failures,rows:rows.map(({lod,triangles,bodyHeightM,badWeights,changedTopology})=>({lod,triangles,bodyHeightM,badWeights,changedTopology}))},null,2))
if(failures.length)process.exitCode=1
