/** Minimal Roman variant. Run from repo root; needs Python with Pillow/numpy.
 * Binary-preserving GLB editing avoids re-exporting/reweighting the source body.
 * ROMAN_HERO_PYTHON selects the image-processing interpreter.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as THREE from 'three'
import { readGlb, loadRig, readAccessor, encodeGlb } from './lib/humanoid-glb.mjs'

const base = 'public/models/characters/v2/roman', out = 'public/models/characters/v2/roman-hero-t4'
fs.mkdirSync(out, { recursive: true })
const sourceManifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`))
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const source = await loadRig(readGlb(`${base}/lod0.glb`))
source.scene.updateMatrixWorld(true)
const bounds = name => new THREE.Box3().setFromObject(source.scene.getObjectByName(name), true)
const scalp = bounds('New_head').max.y, barefoot = bounds('New_legs').min.y, sole = bounds('Boots').min.y
const scale = 1.95 / (scalp - barefoot), ground = -sole * scale
const headSurface = source.scene.getObjectByName('New_head')
headSurface.material.side = THREE.DoubleSide
headSurface.skeleton.update()
const headPositions=Array.from({length:headSurface.geometry.attributes.position.count},(_,i)=>headSurface.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(headSurface.matrixWorld))
const headIndices=headSurface.geometry.index.array,headTriangles=[]
for(let i=0;i<headIndices.length;i+=3){
  const [a,b,c]=[0,1,2].map(j=>headPositions[headIndices[i+j]])
  const determinant=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y)
  if(Math.abs(determinant)>1e-12)headTriangles.push({a,b,c,determinant,minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y)})
}
// Equivalent to an outside-to-inside +Z face ray, restricted to XY triangles.
// This avoids allocating thousands of Raycaster intersections for each LOD.
function facialDepth(x,y){
  let z=-Infinity
  for(const{a,b,c,determinant,minX,maxX,minY,maxY}of headTriangles){
    if(x<minX||x>maxX||y<minY||y>maxY)continue
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/determinant
    const v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/determinant
    if(u>=0&&v>=0&&u+v<=1)z=Math.max(z,u*a.z+v*b.z+(1-u-v)*c.z)
  }
  return Number.isFinite(z)?z:0
}
const ray = new THREE.Raycaster(), direction = new THREE.Vector3(0, 0, -1)
const facialRaySamples = [1.49,1.51,1.53,1.55,1.57,1.59,1.61,1.63].map(y=>({y, samples:[0,.02,.04,.06].map(x=>{
  ray.set(new THREE.Vector3(x,y,.3),direction);return {x,z:ray.intersectObject(headSurface)[0]?.point.z??null}
})}))
const sourceMeasurements = {
  posture: 'exported T-pose, +Y up; anatomical head surface and unshod New_legs foot surface; shoulder armour cross-section',
  facialLandmarks: [['brow',0,1.628],['noseTip',0,1.571],['cheekbone',.034,1.565],['upperLip',0,1.55],['chin',0,1.505],['jaw',.034,1.52]].map(([name,x,y])=>{
    ray.set(new THREE.Vector3(x,y,.3),direction);return {name,x,y,z:ray.intersectObject(headSurface)[0].point.z}
  }),
  facialRaySamples, scalpY: scalp, barefootY: barefoot, soleY: sole, anatomicalHeightM: scalp-barefoot,
  overallHeightM: new THREE.Box3().setFromObject(source.scene,true).getSize(new THREE.Vector3()).y,
  shoulderJointSpanM: source.scene.getObjectByName('upper_arm_l').getWorldPosition(new THREE.Vector3()).distanceTo(source.scene.getObjectByName('upper_arm_r').getWorldPosition(new THREE.Vector3())),
  outerShoulderWidthM: bounds('Armour_top').getSize(new THREE.Vector3()).x,
}

// A face-shaped shell with genuine elliptical eye apertures; all points are
// projected onto the original face, with a small sculpted brow/cheek clearance.
function makeMask(lod, headInverse) {
  const outline = [[0,1.486],[.022,1.493],[.042,1.513],[.053,1.54],[.066,1.573],[.070,1.6],[.066,1.623],[.04,1.626],[0,1.627],[-.04,1.626],[-.066,1.623],[-.070,1.6],[-.066,1.573],[-.053,1.54],[-.042,1.513],[-.022,1.493]].map(p=>new THREE.Vector2(...p))
  const segments = [24,20,12][lod]
  const eyes = [-1,1].map(side=>Array.from({length:segments},(_,i)=>{
    const a=i/segments*Math.PI*2
    return new THREE.Vector2(side*.034 + .0262*Math.cos(a), 1.612 + .0102*Math.sin(a) + side*.003*Math.cos(a))
  }))
  const topologyInput=`output/roman-hero-t4/mask-topology-${lod}.json`
  const topologyOutput=`output/roman-hero-t4/mask-topology-${lod}-result.json`
  fs.mkdirSync('output/roman-hero-t4',{recursive:true})
  fs.writeFileSync(topologyInput,JSON.stringify({outline:outline.map(p=>p.toArray()),holes:eyes.map(h=>h.map(p=>p.toArray())),lod}))
  execFileSync(process.env.ROMAN_HERO_BLENDER??'blender',['-b','--python','tools/roman-mask-topology.py','--',topologyInput,topologyOutput],{stdio:'pipe'})
  const topology=JSON.parse(fs.readFileSync(topologyOutput)),points=topology.points.map(p=>new THREE.Vector2(...p)),faces=topology.faces
  // Fit directly to the retained head, including its nose/cheek/chin shape.
  // A small spatial filter removes scan facets without changing facial scale.
  const project = p => {
    const samples=[]
    for(const[dx,dy]of[[0,0],[-.001,0],[.001,0],[0,-.001],[0,.001]]){
      let z=-Infinity
      for(const sign of [-1,1]){
        z=Math.max(z,facialDepth(sign*Math.abs(p.x+dx),p.y+dy))
      }
      samples.push(z)
    }
    let z=samples.reduce((a,b)=>a+b,0)/samples.length+.010
    const mouthWidth=Math.exp(-Math.pow(p.x/.027,6))
    // Small classical lip relief follows the measured mouth, not the chin.
    z+=mouthWidth*(.0018*Math.exp(-Math.pow((p.y-1.548)/.0035,2))+.002*Math.exp(-Math.pow((p.y-1.541)/.0035,2))-.001*Math.exp(-Math.pow((p.y-1.544)/.0015,2)))
    return new THREE.Vector3(p.x,p.y,z+(lod===2?.004:lod===1?.002:0))
  }
  const front=points.map(project), count=points.length,clearanceLift=new Float32Array(count)
  // Fit the INSIDE of each exported triangle too: vertices alone miss curved
  // forehead/nose peaks between them. Only locally deficient faces move out.
  for(let pass=0;pass<2;pass++){
    const lift=new Float32Array(count)
    for(const[a,b,c]of faces){
      let needed=0
      for(let u=0;u<=4;u++)for(let v=0;v<=4-u;v++){
        const p=front[a].clone().multiplyScalar(u/4).addScaledVector(front[b],v/4).addScaledVector(front[c],1-(u+v)/4)
        const skin=Math.max(facialDepth(p.x,p.y),facialDepth(-p.x,p.y))
        needed=Math.max(needed,skin+.0065-p.z)
      }
      for(const i of[a,b,c])lift[i]=Math.max(lift[i],needed)
    }
    for(let i=0;i<count;i++){front[i].z+=lift[i];clearanceLift[i]+=lift[i]}
  }
  const rimProject=p=>{
    let nearest=0,distance=Infinity
    for(let i=0;i<count;i++){const d=points[i].distanceToSquared(p);if(d<distance){nearest=i;distance=d}}
    return project(p).add(new THREE.Vector3(0,0,clearanceLift[nearest]))
  }
  const vertices=[...front,...front.map(p=>p.clone().add(new THREE.Vector3(0,0,-.0025)))].map(p=>p.multiplyScalar(scale).add(new THREE.Vector3(0,ground,0)).applyMatrix4(headInverse))
  const steel=[],gold=[],boundary=new Map(),key=(a,b)=>a<b?`${a},${b}`:`${b},${a}`
  for(const [a,b,c]of faces){
    // ShapeUtils produces front CCW faces. Keep the solid back and edge walls.
    steel.push(a,b,c)
    steel.push(c+count,b+count,a+count)
    for(const [u,v]of[[a,b],[b,c],[c,a]]){const k=key(u,v);if(boundary.has(k))boundary.delete(k);else boundary.set(k,[u,v])}
  }
  for(const [a,b]of boundary.values()){
    const inEye=i=>eyes.some(eye=>eye.some(p=>p.distanceTo(points[i])<1e-6))
    if(inEye(a)&&inEye(b))continue // Closed by the inset gold rim's inner wall below.
    gold.push(b,a,a+count,b,a+count,b+count)
  }
  // Continuous narrow eye rims, rather than assigning gold to coarse triangles.
  for(const side of [-1,1]) {
    const start=vertices.length
    for(let i=0;i<segments;i++)for(const layer of [0,1,2,3]){
      const ring=layer%2
      const a=i/segments*Math.PI*2
      const p=new THREE.Vector2(side*.034+(.024+ring*.0022)*Math.cos(a),1.612+(.008+ring*.0022)*Math.sin(a)+side*.003*Math.cos(a))
      vertices.push(rimProject(p).add(new THREE.Vector3(0,0,layer>=2?-.0025:0)).multiplyScalar(scale).add(new THREE.Vector3(0,ground,0)).applyMatrix4(headInverse))
    }
    for(let i=0;i<segments;i++){
      const a=start+i*4,b=start+(i+1)%segments*4
      gold.push(a,a+1,b,b,a+1,b+1, a+2,b+2,a+3,b+2,b+3,a+3, a,b,b+2,a,b+2,a+2)
    }
  }
  const geometry=new THREE.BufferGeometry()
  // User-requested dark eye rims and shell edge; no gold around the eyes.
  steel.push(...gold);gold.length=0
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flatMap(p=>p.toArray()),3))
  geometry.setIndex([...steel,...gold])
  // Normals follow the exported planes themselves. Averaged geometry normals
  // avoid the striped reflection caused by interpolating derivative normals
  // across widely separated anatomical break lines.
  geometry.computeVertexNormals()
  return {geometry,steel,gold,triangles:(steel.length+gold.length)/3,eyeApertures:2,thicknessM:.0025*scale}
}

const reports=[]
for(let lod=0;lod<3;lod++){
  const asset=readGlb(`${base}/lod${lod}.glb`),doc=asset.document
  const chunks=[Buffer.from(asset.binary)];let offset=asset.binary.length
  const appendBytes=bytes=>{
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
    const index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})
    chunks.push(bytes);offset+=bytes.length;return index
  }
  const append=(values,type)=>{
    const view=appendBytes(Buffer.from(values.buffer,values.byteOffset,values.byteLength)),n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type]
    const a={bufferView:view,componentType:values instanceof Float32Array?5126:values instanceof Uint16Array?5123:5125,count:values.length/n,type}
    if(type==='VEC3'){a.min=[0,1,2].map(j=>Math.min(...values.filter((_,i)=>i%3===j)));a.max=[0,1,2].map(j=>Math.max(...values.filter((_,i)=>i%3===j)))}
    if(type==='SCALAR'&&values instanceof Float32Array){a.min=[values[0]];a.max=[values.at(-1)]}
    doc.accessors.push(a);return doc.accessors.length-1
  }
  const positions=new Set(doc.meshes.flatMap(m=>m.primitives.flatMap(p=>[p.attributes.POSITION,...(p.targets??[]).map(t=>t.POSITION)].filter(i=>i!==undefined))))
  for(const anim of doc.animations)for(const channel of anim.channels)if(channel.target.path==='translation')positions.add(anim.samplers[channel.sampler].output)
  for(const index of positions){
    const values=readAccessor(asset,index)
    const isUpperArm=doc.meshes.find(m=>m.name==='New_arms').primitives.some(p=>p.attributes.POSITION===index)
    const isThigh=doc.meshes.find(m=>m.name==='New_legs').primitives.some(p=>p.attributes.POSITION===index)
    const isTunic=doc.meshes.find(m=>m.name==='Tunic_1').primitives.some(p=>p.attributes.POSITION===index)
    const isGuard=doc.meshes.find(m=>m.name==='Wrist_guard1').primitives.some(p=>p.attributes.POSITION===index)
    if(isUpperArm)for(let i=0;i<values.length;i+=3){
      const x=Math.abs(values[i]),smooth=(a,b,v)=>THREE.MathUtils.smoothstep(v,a,b)
      const hidden=smooth(.03,.10,x)*(1-smooth(lod===2?.37:.34,lod===2?.465:.425,x))
      // The source skin protrudes 8 mm above the sleeve in rest. Tuck only
      // covered deltoid skin underneath it, preserving the exposed upper arm.
      values[i+1]=1.40+(values[i+1]-1.40)*(1-(lod===2?.52:.35)*hidden)
      values[i+2]=-.025+(values[i+2]+.025)*(1-(lod===2?.45:.25)*hidden)
    }
    if(isThigh)for(let i=0;i<values.length;i+=3){
      const hidden=THREE.MathUtils.smoothstep(values[i+1],.57,.70),center=Math.sign(values[i])*.105
      values[i]=center+(values[i]-center)*(1-.23*hidden)
      values[i+2]=.025+(values[i+2]-.025)*(1-.23*hidden)
    }
    if(isTunic)for(let i=0;i<values.length;i+=3){
      const x=Math.abs(values[i]),underPlate=THREE.MathUtils.smoothstep(x,.08,.13)*(1-THREE.MathUtils.smoothstep(x,.23,.32))*THREE.MathUtils.smoothstep(values[i+1],1.30,1.38)
      values[i+1]=1.40+(values[i+1]-1.40)*(1-.12*underPlate)
      values[i+2]=-.025+(values[i+2]+.025)*(1-.10*underPlate)
    }
    if(isGuard)for(let i=0;i<values.length;i+=3){
      // Original bracer starts 67 mm above the elbow. Keep the wrist end and
      // shorten only the proximal reach so it can bend with the forearm.
      values[i]=Math.sign(values[i])*(.548+(Math.abs(values[i])-.453)/(.695-.453)*(.695-.548))
      values[i+1]=1.40+(values[i+1]-1.4105)*1.10
      values[i+2]=-.017+(values[i+2]+.017)*1.10
    }
    for(let i=0;i<values.length;i++)values[i]*=scale
    const replacement=append(values,'VEC3');doc.accessors[index]=doc.accessors.pop();if(replacement!==doc.accessors.length)throw Error('accessor append')
  }
  const sourceForWeights=readGlb(`${base}/lod${lod}.glb`)
  for(const name of ['Armour_top','Wrist_guard1'])for(const p of doc.meshes.find(m=>m.name===name).primitives){
    const original=readAccessor(sourceForWeights,p.attributes.POSITION),joints=[],weights=[]
    const joint=n=>doc.skins[0].joints.findIndex(i=>doc.nodes[i].name===n)
    for(let i=0;i<original.length;i+=3){
      const x=original[i],y=original[i+1],side=x>0?'l':'r'
      if(name==='Wrist_guard1'){joints.push(joint(`lower_arm_${side}`),0,0,0);weights.push(1,0,0,0)}
      else{
        const arm=THREE.MathUtils.smoothstep(Math.abs(x),.16,.32)*THREE.MathUtils.smoothstep(y,1.34,1.40)
        joints.push(joint('chest'),joint(`upper_arm_${side}`),0,0);weights.push(1-arm,arm,0,0)
      }
    }
    p.attributes.JOINTS_0=append(new Uint16Array(joints),'VEC4');p.attributes.WEIGHTS_0=append(new Float32Array(weights),'VEC4')
  }
  for(const skin of doc.skins){
    const index=skin.inverseBindMatrices,values=readAccessor(asset,index)
    for(let i=0;i<values.length;i+=16)for(const j of [12,13,14])values[i+j]*=scale
    doc.accessors[index]={...doc.accessors[index],bufferView:appendBytes(Buffer.from(values.buffer)),byteOffset:0}
  }
  for(const node of doc.nodes){if(node.translation)node.translation=node.translation.map(v=>v*scale);if(node.matrix)for(const j of [12,13,14])node.matrix[j]*=scale}
  for(const index of doc.scenes[doc.scene??0].nodes){const root=doc.nodes[index];root.translation??=[0,0,0];root.translation[1]+=ground}
  const temp=`output/roman-hero-t4/textures-lod${lod}`
  execFileSync(process.env.ROMAN_HERO_PYTHON??'python3',['tools/roman-hero-textures.py',`${base}/lod${lod}.glb`,temp])
  const textures=JSON.parse(fs.readFileSync(`${temp}/report.json`))
  for(const item of textures){const im=doc.images[item.index];im.bufferView=appendBytes(fs.readFileSync(item.file));im.mimeType='image/png'}
  doc.materials.find(m=>m.name==='RomanUndertunic').pbrMetallicRoughness.baseColorFactor=[.001,.0025,.006,1]
  for(const material of doc.materials)if(/^(Armour|Full_figure|Helmet|Wrist)/.test(material.name)){
    material.pbrMetallicRoughness.metallicFactor=.62;material.pbrMetallicRoughness.roughnessFactor=.48
  }
  doc.materials.find(m=>m.name==='Tunic_10').pbrMetallicRoughness.roughnessFactor=.92
  // The source thigh lining has only two rings, with a waist wider than the
  // armour and no intermediate deformation support. Repair these two small
  // hidden cloth pieces, retaining the original visible skirt/body topology.
  for(const side of ['l','r']){
    const mesh=doc.meshes.find(m=>m.name===`RomanUndertunic_${side}`),material=mesh.primitives[0].material
    const joint=name=>doc.skins[0].joints.findIndex(i=>doc.nodes[i].name===name)
    const sign=side==='l'?1:-1,segments=lod===2?12:16,positions=[],normals=[],uv=[],joints=[],weights=[],indices=[]
    const rings=[[.58,.072,.089,.025],[.72,.079,.099,.020],[.84,.070,.080,.015],[.92,.058,.078,.008],[1,.052,.074,0]]
    for(const[y,rx,rz,cz]of rings)for(let i=0;i<=segments;i++){
      const angle=i/segments*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),hip=THREE.MathUtils.smoothstep(y,.79,.99)
      positions.push((sign*.105+rx*c)*scale,y*scale,(cz+rz*s)*scale)
      normals.push(...new THREE.Vector3(c/rx,0,s/rz).normalize().toArray());uv.push(i/segments,(y-.58)/.42)
      joints.push(joint('hips'),joint(`upper_leg_${side}`),0,0);weights.push(hip,1-hip,0,0)
    }
    for(let r=0;r<rings.length-1;r++)for(let i=0;i<segments;i++){
      const a=r*(segments+1)+i,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1)
    }
    mesh.primitives=[{material,attributes:{POSITION:append(new Float32Array(positions),'VEC3'),NORMAL:append(new Float32Array(normals),'VEC3'),
      TEXCOORD_0:append(new Float32Array(uv),'VEC2'),JOINTS_0:append(new Uint16Array(joints),'VEC4'),WEIGHTS_0:append(new Float32Array(weights),'VEC4')},indices:append(new Uint32Array(indices),'SCALAR')}]
  }
  const previewAsset={document:doc,binary:Buffer.concat(chunks)},rig=await loadRig(previewAsset)
  rig.scene.updateMatrixWorld(true)
  const mask=makeMask(lod,rig.scene.getObjectByName('head').matrixWorld.clone().invert())
  const metal=doc.materials.length
  doc.materials.push({name:'Praetorian_black_steel',pbrMetallicRoughness:{baseColorFactor:[.055,.064,.078,1],metallicFactor:.7,roughnessFactor:.46}})
  const pos=append(mask.geometry.attributes.position.array,'VEC3'),normal=append(mask.geometry.attributes.normal.array,'VEC3')
  const meshIndex=doc.meshes.length
  doc.meshes.push({name:'Praetorian_face_mask',primitives:[mask.steel].map((indices,i)=>({attributes:{POSITION:pos,NORMAL:normal},indices:append(new Uint32Array(indices),'SCALAR'),material:metal+i}))})
  const head=doc.nodes.find(n=>n.name==='head');head.children??=[];head.children.push(doc.nodes.length)
  doc.nodes.push({name:'Praetorian_face_mask',mesh:meshIndex,extras:{rigidAttachment:'head',eyeApertures:2,thicknessM:mask.thicknessM}})
  // Pack only referenced buffer views, removing replaced texture/accessor bytes.
  const binary=Buffer.concat(chunks),used=new Set()
  for(const a of doc.accessors)if(a.bufferView!==undefined)used.add(a.bufferView)
  for(const image of doc.images)used.add(image.bufferView)
  const packed=[],views=[],map=new Map();let length=0
  for(const index of [...used].sort((a,b)=>a-b)){
    const padding=(4-length%4)%4;if(padding){packed.push(Buffer.alloc(padding));length+=padding}
    const v=doc.bufferViews[index];map.set(index,views.length);views.push({...v,byteOffset:length})
    packed.push(binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));length+=v.byteLength
  }
  for(const a of doc.accessors)if(a.bufferView!==undefined)a.bufferView=map.get(a.bufferView)
  for(const image of doc.images)image.bufferView=map.get(image.bufferView)
  doc.bufferViews=views;doc.buffers[0].byteLength=length
  delete doc.asset.extras.humanoidAnimationBuild
  doc.asset.extras.romanHeroBuild={sourceSha256:hash(`${base}/lod${lod}.glb`),scale,ground,bodyTopology:'visible body unchanged; two hidden undertunic pieces refined',localRepairs:['New_arms covered deltoid inset','New_legs covered thigh inset','RomanUndertunic_l','RomanUndertunic_r','Tunic_1 under-pauldron clearance','Armour_top shoulder weights matched to sleeve','Wrist_guard1 elbow clearance and forearm weights'],maskTriangles:mask.triangles,maskFit:'symmetric source-face ray projection, 1 mm spatial filter, 10 mm nominal outward offset, small lip relief; 2/4 mm extra LOD1/2 clearance'}
  fs.writeFileSync(`${out}/lod${lod}.glb`,encodeGlb(doc,Buffer.concat(packed)))
  const actual=await loadRig(readGlb(`${out}/lod${lod}.glb`));actual.scene.updateMatrixWorld(true)
  const box=new THREE.Box3().setFromObject(actual.scene,true)
  const triangles=doc.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+doc.accessors[p.indices??p.attributes.POSITION].count/3,0)
  reports.push({lod,triangles,maskTriangles:mask.triangles,materials:doc.materials.length,bytes:fs.statSync(`${out}/lod${lod}.glb`).size,
    textures:textures.map(({name,width,height})=>({name,width,height})),sourceSha256:hash(`${base}/lod${lod}.glb`),sha256:hash(`${out}/lod${lod}.glb`),
    anatomicalHeightM:new THREE.Box3().setFromObject(actual.scene.getObjectByName('New_head'),true).max.y-(barefoot*scale+ground),overallHeightM:box.max.y-box.min.y})
}
const scaleFrame=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,['gripCenterLocal','palmContactCenter','wristCenter','thumbBaseCenter'].includes(k)?v.map(x=>x*scale):['fingerBase','gripRadius'].includes(k)?v*scale:v]))
const manifest={schemaVersion:1,id:'roman-hero-t4',displayName:'羅馬禁衛軍 T4',status:'ready',source:sourceManifest.source,attribution:sourceManifest.attribution,
  modifications:['Original Roman face, neck, helmet and visible clothing topology retained; no anatomy reconstructed. User-requested local shoulder/thigh repair tucks covered skin beneath sleeves and skirt; two hidden thigh lining pieces have a narrower waist and intermediate weight-support rings',
    'Uniform offline scaling of mesh positions, rest translations, inverse binds, sockets, animation translations and grip frames; anatomical height measured from scalp to unshod foot surface',
    'Independent named atlas copies: charcoal steel, preserved antique gold detail, navy tunic and dark brown leather; skin/eye/normal image bytes preserved',
    'Head-parented facial shell projected from the measured retained face: brow, nose, cheek, lip and chin shape; two open eye apertures, inner wall and dark steel rims; no facial rig or gameplay tier'],
  metrics:{heightM:reports[0].anatomicalHeightM,overallHeightM:reports[0].overallHeightM,shoulderWidthM:sourceMeasurements.outerShoulderWidthM*scale,
    shoulderJointSpanM:sourceMeasurements.shoulderJointSpanM*scale,neckLengthM:.09*scale,barefootPlaneY:barefoot*scale+ground,scalpY:scalp*scale+ground,
    uniformScaleAppliedOffline:scale,runtimeScale:[1,1,1],sourceMeasurements,triangles:Object.fromEntries(reports.map(r=>[`lod${r.lod}`,r.triangles])),textures:{lod0:2048,lod1:1024,lod2:512}},
  files:sourceManifest.files,fileSha256:Object.fromEntries(reports.map(r=>[`lod${r.lod}`,r.sha256])),skeleton:'project-humanoid-v1',boneMap:'bone-map.json',audit:'audit.json',
  handGripFrames:{left:scaleFrame(sourceManifest.handGripFrames.left)},swordGripFrames:Object.fromEntries(Object.entries(sourceManifest.swordGripFrames).map(([k,v])=>[k,scaleFrame(v)])),
  animations:sourceManifest.animations,animationSources:sourceManifest.animationSources,attachmentOffsets:{corgiPelvis:[0,.17,0]},lodMeasurements:reports,
  visualAcceptance:'See the Roman T4 asset pull request description for validation and known limitations; exported GLB browser review required',
  inheritedLimitations:sourceManifest.remainingUncertainties}
fs.writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
const boneMap=JSON.parse(fs.readFileSync(`${base}/bone-map.json`));boneMap.rigidAttachments={Praetorian_face_mask:'head'}
fs.writeFileSync(`${out}/bone-map.json`,JSON.stringify(boneMap,null,2)+'\n')
fs.copyFileSync(`${base}/attribution-evidence.json`,`${out}/attribution-evidence.json`)
fs.writeFileSync(`${out}/ATTRIBUTION.md`,`# 羅馬禁衛軍 T4\n\n${sourceManifest.attribution}\n\nSource: ${sourceManifest.source.url}\nLicense: ${sourceManifest.source.licenseUrl}\n\nAll three repository Roman GLBs are the immutable input. Actual input hashes and original animation licensing/provenance are in manifest.json. Hero modifications: measured facial shell, independent texture recolouring, uniform anatomical scaling and local covered shoulder/thigh/lining clearance repairs. No reference-image pixels are embedded. Kevin Iglesias animation license: Unity Asset Store EULA; Quaternius: CC0. Original licensed FBX files are not redistributed. Rebuild with tools/build-roman-hero.mjs.\n`)
console.log(JSON.stringify({scale,anatomicalHeightM:reports[0].anatomicalHeightM,reports:reports.map(({textures,...r})=>r)},null,2))
