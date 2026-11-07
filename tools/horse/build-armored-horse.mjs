/** Rebuild the user-generated Meshy barding on the existing horse's 70 joints/clips.
 * Usage: node tools/horse/build-armored-horse.mjs /path/source.glb /path/toktx
 * Stages in output/armored-warhorse; inspect roundtrip.glb before promoting package/.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { readGlb, decodeGlb, encodeGlb } from '../blender/animal_glb.mjs';
import { packGlbResources } from '../lib/pack-glb-resources.mjs';
const sourcePath = process.argv[2], toktx = process.argv[3];
const work = 'output/armored-warhorse', out = work + '/package';
fs.mkdirSync(out + '/textures', { recursive: true });
const raw = fs.readFileSync(sourcePath);
const hash = crypto.createHash('sha256').update(raw).digest('hex');
if (hash !== 'cd3e443eec8d404c4cc4b1b8f800ade5c6679533de1847a78ac1d7a3e4b36ad2') throw Error('Unexpected source GLB');
const source = readGlb(raw), donor = await decodeGlb(readGlb('public/models/mounts/v1/horse/horse_runtime.glb'));
const preview = structuredClone(donor.doc);
preview.materials = preview.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [.4,.3,.2,1] } }));
delete preview.images; delete preview.textures; delete preview.extensionsUsed; delete preview.extensionsRequired;
const bytes = encodeGlb(preview, donor.bin);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
const mixer = new T.AnimationMixer(gltf.scene);
mixer.clipAction(gltf.animations.find(c => c.name === 'idle')).play(); mixer.update(0);
gltf.scene.updateMatrixWorld(true);
const body = gltf.scene.getObjectByName('horse_body_lod0'); body.skeleton.update();
const skin = donor.doc.skins[0], bones = body.skeleton.bones;
const joint = name => { const i = bones.findIndex(b => b.name === name); if(i < 0) throw Error(name); return i; };
function data(a,index) {
 const ac=a.doc.accessors[index],v=a.doc.bufferViews[ac.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[ac.type],size={5123:2,5125:4,5126:4}[ac.componentType],fn={5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[ac.componentType];
 return Array.from({length:ac.count*width},(_,i)=>a.bin[fn]((v.byteOffset??0)+(ac.byteOffset??0)+Math.floor(i/width)*(v.byteStride??width*size)+(i%width)*size));
}
const primitive=source.doc.meshes[0].primitives[0], original=data(source,primitive.attributes.POSITION), normals=data(source,primitive.attributes.NORMAL), uv=data(source,primitive.attributes.TEXCOORD_0);
let indices=new Uint32Array(data(source,primitive.indices));
const regions=JSON.parse(fs.readFileSync(new URL('./armored-horse-regions.json',import.meta.url)));
if(regions.sourceSha256!==hash || regions.triangleCount!==indices.length/3) throw Error('Source surface map mismatch');
// The scan welds fur into the hem. Cut only the hidden collar below the
// lowest barding fringe, preserving the original triangle surface and UVs.
const originalTriangleCount=indices.length/3,cutY=.70/1.27-.9605550169944763,intersections=new Map(),cutIndices=[],cutRegions=[];
function intersection(a,b) {
 const key=[a,b].sort((a,b)=>a-b).join(',');if(intersections.has(key))return intersections.get(key);
 const t=(cutY-original[a*3+1])/(original[b*3+1]-original[a*3+1]),id=original.length/3;
 for(let k=0;k<3;k++){original.push(original[a*3+k]+(original[b*3+k]-original[a*3+k])*t);normals.push(normals[a*3+k]+(normals[b*3+k]-normals[a*3+k])*t);}
 for(let k=0;k<2;k++)uv.push(uv[a*2+k]+(uv[b*2+k]-uv[a*2+k])*t);
 intersections.set(key,id);return id;
}
function clip(ids,lower) {
 const result=[];
 for(let k=0;k<ids.length;k++){
  const a=ids[k],b=ids[(k+1)%ids.length],inside=lower?original[a*3+1]<=cutY:original[a*3+1]>=cutY,next=lower?original[b*3+1]<=cutY:original[b*3+1]>=cutY;
  if(inside)result.push(a);if(inside!==next)result.push(intersection(a,b));
 }
 return result;
}
for(let f=0;f<indices.length/3;f++){
 const ids=[0,1,2].map(k=>indices[f*3+k]);
 if(regions.faceRegions[f]===1 || regions.faceRegions[f]===6){cutIndices.push(...ids);cutRegions.push(regions.faceRegions[f]===1?1:0);continue;}
 for(const lower of [false,true]){
  const polygon=clip(ids,lower);if(polygon.length<3)continue;
  const x=polygon.reduce((n,id)=>n+original[id*3+2],0),z=polygon.reduce((n,id)=>n-original[id*3],0);
  const region=lower?(z>0?(x>=0?2:3):(x>=0?4:5)):0;
  for(let k=1;k<polygon.length-1;k++){cutIndices.push(polygon[0],polygon[k],polygon[k+1]);cutRegions.push(region);}
 }
}
indices=new Uint32Array(cutIndices);regions.faceRegions=cutRegions;
const positions=[],normalValues=[],joints=[],weights=[],runtimeUv=[],runtimeIndices=[],owned=new Map();
const scale=1.27,zOffset=.05;
const sourcePoint=id=>new T.Vector3(original[id*3+2]*scale,(original[id*3+1]+.9605550169944763)*scale,-original[id*3]*scale+zOffset);
function weightFor(p,region) {
 let w;
 if(region===1)w=new Map([[joint('horse_043'),1]]);
 else if(region>=2) {
  const chain={2:['horse_020','horse_019','horse_018','horse_017'],3:['horse_025','horse_024','horse_023','horse_022'],4:['horse_041','horse_040','horse_039','horse_038'],5:['horse_036','horse_035','horse_034','horse_033']}[region];
  const boundaries=region<4?[.32,.67,.99]:[.35,.83,1.11];let k=0;
  while(k<3 && p.y>boundaries[k]+.07)k++;
  if(k<3 && p.y>boundaries[k]-.07){const u=(p.y-boundaries[k]+.07)/.14;w=new Map([[joint(chain[k]),1-u],[joint(chain[k+1]),u]]);}
  else w=new Map([[joint(chain[k]),1]]);
 } else if(p.y>1.52 && p.z>.38) {
  const u=T.MathUtils.clamp(((p.y-1.52)+.6*(p.z-.48))/.18,0,1);w=new Map([[joint('horse_01'),1-u],[joint('horse_02'),u]]);
 } else w=new Map([[joint('horse_01'),1]]);
 return w;
}
function vertex(p,n,tex,region,key) {
 if(owned.has(key))return owned.get(key);const out=positions.length/3;owned.set(key,out);
 positions.push(...p.toArray());normalValues.push(...n);runtimeUv.push(...tex);
 const entries=[...weightFor(p,region)].filter(([,w])=>w>1e-7).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((n,e)=>n+e[1],0);
 for(let k=0;k<4;k++){joints.push(entries[k]?.[0]??0);weights.push((entries[k]?.[1]??0)/sum);}return out;
}
const sourceVertex=(id,region)=>vertex(sourcePoint(id),[normals[id*3+2],normals[id*3+1],-normals[id*3]],[uv[id*2],uv[id*2+1]],region,id+':'+region);
const canonical=new Map(),pointIds=[];
for(let id=0;id<original.length/3;id++){const key=sourcePoint(id).toArray().map(x=>Math.round(x*1e5)).join(',');if(!canonical.has(key))canonical.set(key,id);pointIds.push(canonical.get(key));}
const edges=new Map();
for(let f=0;f<indices.length/3;f++) {
 const region=regions.faceRegions[f],ids=[0,1,2].map(c=>indices[f*3+c]);
 runtimeIndices.push(...ids.map(id=>sourceVertex(id,region)));
 for(let k=0;k<3;k++){
  const a=ids[k],b=ids[(k+1)%3],ca=pointIds[a],cb=pointIds[b],key=[ca,cb].sort((a,b)=>a-b).join(',');
  if(!edges.has(key))edges.set(key,[]);edges.get(key).push({a,b,ca,cb,region});
 }
}
// The scan contains open hair cards; its tail also touches a hind leg and the
// cloth/skin collars are welded. Separate only these reviewed natural surfaces,
// retain every source triangle, then close each new boundary inside its overlap.
console.log({edgeValences:[...edges.values()].reduce((o,v)=>(o[v.length]=(o[v.length]??0)+1,o),{})});
const boundaries=new Map();
for(const list of edges.values())if(new Set(list.map(e=>e.region)).size>1)for(const e of list){if(!boundaries.has(e.region))boundaries.set(e.region,[]);boundaries.get(e.region).push(e);}
let capTriangles=0,openHairContours=0,limbCollars=0;
for(const [region,allEdges]of boundaries) {
 const onCollar=e=>Math.abs(sourcePoint(e.a).y-.70)<1e-5 && Math.abs(sourcePoint(e.b).y-.70)<1e-5;
 for(const list of region>=2?[allEdges.filter(onCollar),allEdges.filter(e=>!onCollar(e))]:[allEdges]) {
 const pending=new Set(list),incident=new Map();
 for(const e of list)for(const id of [e.ca,e.cb]){if(!incident.has(id))incident.set(id,[]);incident.get(id).push(e);}
 while(pending.size) {
  const first=pending.values().next().value;
  let current=[first.ca,first.cb].find(id=>(incident.get(id)??[]).filter(e=>pending.has(e)).length===1)??first.ca;
  const start=current,chain=[];
  for(let step=0;step<=list.length;step++) {
   const e=(incident.get(current)??[]).find(e=>pending.has(e));if(!e)break;pending.delete(e);
   const directed=e.ca===current?e:{...e,a:e.b,b:e.a,ca:e.cb,cb:e.ca};chain.push(directed);current=directed.cb;if(current===start)break;
  }
  if(chain.length<2)continue;
  if(current!==start)openHairContours++;
  const center=new T.Vector3();for(const e of chain)center.add(sourcePoint(e.a));center.add(sourcePoint(chain.at(-1).b)).divideScalar(chain.length+1);
  let texId=first.a;
  if(region>=2){let best=Infinity;for(let id=0;id<original.length/3;id++){const p=sourcePoint(id),wanted=p.z>0?(p.x>=0?2:3):(p.x>=0?4:5);if(wanted===region){const d=Math.abs(p.y-.45);if(d<best){best=d;texId=id;}}}}
  const tex=region>=2?[.318,.44]:[uv[texId*2],uv[texId*2+1]];
  if(region>=2 && chain.every(onCollar) && chain.length>=3) {
   // Complete the scanned leg under the rigid barding, up to the real shoulder/
   // hip pivot. The scanned lower leg and all its texture corners stay exact.
   const hipName={2:'horse_017',3:'horse_022',4:'horse_038',5:'horse_033'}[region],hip=bones[joint(hipName)].getWorldPosition(new T.Vector3());
   const ring=chain.map(e=>e.a);if(current!==start)ring.push(chain.at(-1).b);
   let previous=ring.map((id,k)=>vertex(sourcePoint(id),[normals[id*3+2],normals[id*3+1],-normals[id*3]],[.308+.020*k/ring.length,.425],region,'collar-root:'+region+':'+limbCollars+':'+k));
   for(let row=1;row<=5;row++){
    const t=row/5,c=center.clone().lerp(hip,t),next=ring.map((id,k)=>{
     const source=sourcePoint(id),radial=new T.Vector3(source.x-center.x,0,source.z-center.z),p=c.clone().addScaledVector(radial,1-.20*t);
     return vertex(p,radial.clone().normalize().toArray(),[.308+.020*k/ring.length,.425+.030*t],region,'collar:'+region+':'+limbCollars+':'+row+':'+k);
    });
    for(let k=0;k<ring.length;k++){const n=(k+1)%ring.length;runtimeIndices.push(previous[n],previous[k],next[k],previous[n],next[k],next[n]);capTriangles+=2;}
    previous=next;
   }
   const top=vertex(hip,[0,1,0],tex,region,'collar-top:'+region+':'+limbCollars);
   for(let k=0;k<ring.length;k++){runtimeIndices.push(previous[(k+1)%ring.length],previous[k],top);capTriangles++;}
   limbCollars++;continue;
  }
  const ci=vertex(center,[0,1,0],tex,region,'cap:'+region+':'+capTriangles);
  for(const e of chain){runtimeIndices.push(sourceVertex(e.b,region),sourceVertex(e.a,region),ci);capTriangles++;}
 }
}
}
console.log({capTriangles,openHairContours,limbCollars});
const runtimeIndexArray=new Uint32Array(runtimeIndices);
uv.splice(0,uv.length,...runtimeUv);
console.log({sourceTriangles:originalTriangleCount,cutTriangles:indices.length/3,capTriangles,sourceCornersPreserved:true});

const d=structuredClone(donor.doc);
for(const n of d.nodes){delete n.mesh;delete n.skin;}
// Donor geometry never enters this asset. Keep only its rig hierarchy, sockets and clips.
d.meshes=[];d.materials=structuredClone(source.doc.materials);d.textures=structuredClone(source.doc.textures);d.samplers=structuredClone(source.doc.samplers??[]);
const imageNames=['base-color','metallic-roughness','normal'];
d.images=source.doc.images.map((img,i)=>{
 const v=source.doc.bufferViews[img.bufferView],file=`${work}/${imageNames[i]}.${img.mimeType==='image/jpeg'?'jpg':'png'}`;
 fs.writeFileSync(file,source.bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));
 // Source textures are kept; resize uniformly only to meet the runtime's 2048 texture budget.
 if(!fs.existsSync(`${out}/textures/${imageNames[i]}.ktx2`)) execFileSync(toktx,['--t2','--encode','etc1s','--qlevel','220','--clevel','4','--genmipmap','--resize','2048x2048','--assign_oetf',i===0?'srgb':'linear',`${out}/textures/${imageNames[i]}.ktx2`,file],{stdio:'inherit'});
 return {uri:`textures/${imageNames[i]}.ktx2`,mimeType:'image/ktx2'};
});
const chunks=[donor.bin];let offset=donor.bin.length;
function append(array,type,componentType,target) {
 const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
 const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),vi=d.bufferViews.length;
 d.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length,...(target?{target}: {})});chunks.push(b);offset+=b.length;
 const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type],ac={bufferView:vi,componentType,count:array.length/width,type};
 if(type==='VEC3'){ac.min=[0,1,2].map(k=>Math.min(...Array.from(array).filter((_,i)=>i%3===k)));ac.max=[0,1,2].map(k=>Math.max(...Array.from(array).filter((_,i)=>i%3===k)));}
 d.accessors.push(ac);return d.accessors.length-1;
}
const attrs={POSITION:append(new Float32Array(positions),'VEC3',5126,34962),NORMAL:append(new Float32Array(normalValues),'VEC3',5126,34962),TEXCOORD_0:append(new Float32Array(uv),'VEC2',5126,34962),JOINTS_0:append(new Uint16Array(joints),'VEC4',5123,34962),WEIGHTS_0:append(new Float32Array(weights),'VEC4',5126,34962)};
const inverse=bones.flatMap(b=>b.matrixWorld.clone().invert().elements);
d.skins=[{...skin,inverseBindMatrices:append(new Float32Array(inverse),'MAT4',5126)}];
const lodNodes={},bodyMeshNames=[],counts=[];
const lodPath=work+'/simplified-lods.json', lodData=fs.existsSync(lodPath)?JSON.parse(fs.readFileSync(lodPath)):null;
if(lodData && (lodData.sourceSha256!==hash || lodData.skinRevision!=='reviewed-baked-lods-v14')) throw Error('Stale Blender LOD data; rebuild through simplify-armored-horse.py');
await MeshoptSimplifier.ready;
for(let lod=0;lod<3;lod++) {
 // Weld only identical position/UV corners for distant simplification. LOD0 remains exact.
 const canonical=new Map(), remap=[];
 for(let v=0;v<positions.length/3;v++) {
   const key=[...positions.slice(v*3,v*3+3),...uv.slice(v*2,v*2+2)].map(x=>Math.round(x*1e5)).join(',');
   if(!canonical.has(key))canonical.set(key,v);remap.push(canonical.get(key));
 }
 const welded=new Uint32Array(Array.from(runtimeIndexArray,i=>remap[i]));
 const simplified=lodData?.lods[String(lod)];
 const ii=simplified?new Uint32Array(simplified.indices):lod===0?runtimeIndexArray:MeshoptSimplifier.simplify(welded,new Float32Array(positions),3,Math.floor(runtimeIndexArray.length*[1,.38,.13][lod]/3)*3,lod===1?.035:.10,[])[0];
 if(simplified && simplified.positions.some(x=>!Number.isFinite(x)||Math.abs(x)>5)) throw Error('Blender LOD escaped the metre-scale source bind space');
 const attributes=simplified?{
   POSITION:append(new Float32Array(simplified.positions),'VEC3',5126,34962),
   NORMAL:append(new Float32Array(simplified.normals),'VEC3',5126,34962),
   TEXCOORD_0:append(new Float32Array(simplified.uv),'VEC2',5126,34962),
   JOINTS_0:append(new Uint16Array(simplified.jointNames.map(joint)),'VEC4',5123,34962),
   WEIGHTS_0:append(new Float32Array(simplified.weights),'VEC4',5126,34962),
 }:attrs;
 let materialIndex=0;
 if(simplified) {
  const baked=structuredClone(source.doc.materials[0]);
  const textureIndices={};
  for(const name of imageNames){
   const file=`lod${lod}-${name}`,path=`${out}/textures/${file}.ktx2`;
   execFileSync(toktx,['--t2','--encode','etc1s','--qlevel','220','--clevel','4','--genmipmap','--assign_oetf',name==='base-color'?'srgb':'linear',path,`${work}/${file}.png`],{stdio:'inherit'});
   const image=d.images.length; d.images.push({uri:`textures/${file}.ktx2`,mimeType:'image/ktx2'});
   textureIndices[name]=d.textures.length; d.textures.push({source:image,sampler:0});
  }
  baked.pbrMetallicRoughness.baseColorTexture.index=textureIndices['base-color'];baked.pbrMetallicRoughness.metallicRoughnessTexture.index=textureIndices['metallic-roughness'];baked.normalTexture.index=textureIndices.normal;
  materialIndex=d.materials.length;d.materials.push(baked);
 }
 counts.push(ii.length/3);const mesh=d.meshes.length;d.meshes.push({name:`armored_horse_lod${lod}`,primitives:[{attributes,indices:append(new Uint32Array(ii),'SCALAR',5125,34963),material:materialIndex}]});
 const name=`armored_horse_body_lod${lod}`;bodyMeshNames.push(name);const child=d.nodes.length;d.nodes.push({name,mesh,skin:0});const parent=d.nodes.length;d.nodes.push({name:`armored_horse_lod${lod}`,children:[child]});d.scenes[d.scene??0].nodes.push(parent);lodNodes[`lod${lod}`]=`armored_horse_lod${lod}`;
}
// Author sockets in the idle bind frame, attached to the same supporting chest bone.
const chest=bones[joint('horse_01')],chestNode=d.nodes.findIndex(n=>n.name==='horse_01');
const sockets={socket_saddle_seat:[0,1.91,.12],socket_stirrup_l:[-.48,1.06,.12],socket_stirrup_r:[.48,1.06,.12],socket_camera:[0,2.2,-.45]};
for(const [name,p]of Object.entries(sockets)) {
 const index=d.nodes.findIndex(n=>n.name===name),node=d.nodes[index];
 for(const n of d.nodes)if(n.children)n.children=n.children.filter(i=>i!==index);
 delete node.matrix;node.translation=new T.Vector3(...p).applyMatrix4(chest.matrixWorld.clone().invert()).toArray();node.rotation=[0,0,0,1];node.scale=[1,1,1];
 (d.nodes[chestNode].children??=[]).push(index);
}
let bin=Buffer.concat(chunks);d.buffers=[{byteLength:bin.length}];d.extensionsUsed=[];d.extensionsRequired=[];
// Roundtrip uses original image data; final package below switches to external KTX2.
const round=structuredClone(d),roundChunks=[bin];let roundOffset=bin.length;
round.images=d.images.map((img,i)=>{const original=source.doc.images[i],v=original&&source.doc.bufferViews[original.bufferView],b=original?source.bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength):fs.readFileSync(`${work}/${img.uri.split('/').at(-1).replace('.ktx2','.png')}`),pad=(4-roundOffset%4)%4;if(pad){roundChunks.push(Buffer.alloc(pad));roundOffset+=pad;}const vi=round.bufferViews.length;round.bufferViews.push({buffer:0,byteOffset:roundOffset,byteLength:b.length});roundChunks.push(b);roundOffset+=b.length;return {bufferView:vi,mimeType:original?.mimeType??'image/png'};});round.buffers=[{byteLength:roundOffset}];
fs.writeFileSync(work+'/roundtrip.glb',encodeGlb(round,Buffer.concat(roundChunks)));
bin=packGlbResources(d,bin);
for(const t of d.textures){t.extensions={KHR_texture_basisu:{source:t.source}};delete t.source;}
d.extensionsUsed=['EXT_meshopt_compression','KHR_texture_basisu'];d.extensionsRequired=[...d.extensionsUsed];
await MeshoptEncoder.ready;const packed=[];let packedOffset=0,fallback=0;
for(const v of d.bufferViews) {
 const b=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),stride=v.byteStride??4,mode=v.target===34963?'TRIANGLES':'ATTRIBUTES',compressed=MeshoptEncoder.encodeGltfBuffer(b,b.length/stride,stride,mode),pad=(4-packedOffset%4)%4;
 if(pad){packed.push(Buffer.alloc(pad));packedOffset+=pad;}
 v.buffer=1;v.byteOffset=fallback;v.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:packedOffset,byteLength:compressed.length,byteStride:stride,count:b.length/stride,mode}};
 packed.push(compressed);packedOffset+=compressed.length;fallback+=b.length;
}
d.buffers=[{byteLength:packedOffset},{byteLength:fallback}];
const final=encodeGlb(d,Buffer.concat(packed));fs.writeFileSync(out+'/armored-horse.glb',final);
const horseManifest=JSON.parse(fs.readFileSync('public/models/mounts/v1/horse/manifest.json'));
const manifest={...horseManifest,id:'armored-warhorse',status:counts[2]<=7000?'ready':'blocked',reason:counts[2]<=7000?undefined:'Run simplify-armored-horse.py through Blender MCP, then rebuild',file:'armored-horse.glb',revision:'meshy-armored-horse-v1',lodNodes,bodyMeshNames,variants:[0,1,2].map(i=>({id:`source-${i}`,label:'Original armored warhorse',baseColor:'textures/base-color.ktx2'})),sharedBodyMaps:{normal:'textures/normal.ktx2',roughness:'textures/metallic-roughness.ktx2'},sharedElements:['source horse and barding'],attribution:'Meshy armored warhorse generated and provided by repository owner; animation rig and nine clips reused from the credited SagaBurst horse.',sources:[{author:'Repository owner (Meshy generation)',url:'https://www.meshy.ai/',license:'User-generated asset provided by owner for SagaBurst; plan-specific Meshy terms apply',sha256:hash},...horseManifest.sources],metrics:{shoulderHeightM:1.65,overallHeightM:Math.max(...positions.filter((_,i)=>i%3===1)),saddleHeightM:1.91,widthM:1.007,lengthM:2.54,triangles:{lod0:counts[0],lod1:counts[1],lod2:counts[2]},joints:70,materials:d.materials.length,textureMaxSize:2048,packageBytes:final.length},sha256:crypto.createHash('sha256').update(final).digest('hex')};
for(const f of fs.readdirSync(out+'/textures'))manifest.metrics.packageBytes+=fs.statSync(out+'/textures/'+f).size;
fs.writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(out+'/CREDITS.md',`# Armored warhorse\n\nThe repository owner generated and supplied the Meshy asset (SHA-256 ${hash}) for this feature. Meshy account plan / public asset page were not supplied; no third-party license is asserted. Preserve the applicable generation terms.\n\nAll original source surfaces and texture content are retained with a uniform 1.27 scale and -X → +Z rotation. Fused fur/barding contacts are separated, concealed leg collars and seam caps are added, and new collar UVs sample a reviewed fur patch in the original atlas. Original visible surface UVs remain intact. New skin weights, three LODs and saddle/stirrup/camera sockets were authored for the existing 70-joint horse rig; all nine horse clips are reused unchanged. Textures are resized to 2048 and Basis-compressed.\n\nRig and animation attribution:\n\n`+fs.readFileSync('public/models/mounts/v1/horse/CREDITS.md','utf8'));
console.log({counts,bytes:manifest.metrics.packageBytes,sha256:manifest.sha256});
