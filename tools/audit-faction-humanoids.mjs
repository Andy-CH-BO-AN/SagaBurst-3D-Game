/** Standalone structural asset audit; intentionally outside the logic test runner.
 * node tools/audit-faction-humanoids.mjs ROOT [comma-separated IDs]
 */
import * as THREE from 'three';import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';import{readGlb,loadRig}from'./lib/humanoid-glb.mjs';
import {decodeMeshoptGlb}from'./lib/meshopt-glb.mjs';
const root=process.argv[2]??'public/models/characters/v2',ids=(process.argv[3]??'viking-civilian,roman-civilian,maki-archer-t4').split(',');
const required=['root','hips','spine','chest','upper_chest','neck','head',...['l','r'].flatMap(s=>['clavicle','upper_arm','lower_arm','hand','upper_leg','lower_leg','foot','toe'].map(n=>`${n}_${s}`))];
const sockets=['socket_hand_l','socket_hand_r','socket_back','socket_head','socket_pelvis','socket_foot_l','socket_foot_r','sole_l','sole_r','bow_string_contact','bow_arrow_rest'];
const hash=x=>createHash('sha256').update(x).digest('hex');
function imageDimensions(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 if(bytes[0]===255&&bytes[1]===216){for(let offset=2;offset+4<bytes.length;){if(bytes[offset++]!==255)throw Error('Invalid JPEG marker');while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw Error('Invalid JPEG segment');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return[bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];offset+=length;}}
 throw Error('Unsupported or invalid embedded image');
}
function values(asset,index){const a=asset.document.accessors[index],v=asset.document.bufferViews[a.bufferView],count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5126:4,5125:4,5123:2,5121:1}[a.componentType],read={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType];if(!size)throw Error(`Unsupported ${a.componentType}`);return Array.from({length:a.count},(_,i)=>Array.from({length:count},(_,j)=>asset.binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??count*size)+j*size)));}
for(const id of ids){const dir=path.join(root,id),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),lods=[];let canonical;
 const localAudit=reference=>{if(!reference||path.basename(reference)!==reference)throw Error(`${id} invalid local packaging audit`);return JSON.parse(fs.readFileSync(path.join(dir,reference)));};
 if(manifest.bufferCompression&&manifest.bufferCompression!=='EXT_meshopt_compression')throw Error(`${id} unsupported buffer compression`);
 const compressionAudit=manifest.bufferCompression?localAudit(manifest.bufferCompressionAudit):null;
 const textureAudit=manifest.losslessTexturePacking?localAudit(manifest.losslessTexturePacking.equalityAudit):null;
 const publicationAudit=manifest.losslessPublicationPacking?.equalityAudit?localAudit(manifest.losslessPublicationPacking.equalityAudit):null;
 if(manifest.selectedSource||manifest.sharedLodPose!==true)throw Error(`${id} must use the explicit canonical shared-LOD contract`);
 if(manifest.diagnosticOnly||manifest.repeatedLod0||manifest.shippingBlocked||manifest.diagnostic?.shippingBlocked||manifest.diagnostic?.repeatedLod0)throw Error(`${id} is a diagnostic-only candidate`);
 const attributionReferences=['ATTRIBUTION.md',manifest.source?.licenseEvidence,manifest.animationRetarget?.attributionFile];
 for(const reference of attributionReferences){if(!reference||path.basename(reference)!==reference||!fs.existsSync(path.join(dir,reference)))throw Error(`${id} missing local attribution evidence: ${reference}`);}
 const animationAttribution=fs.readFileSync(path.join(dir,manifest.animationRetarget.attributionFile));
 if(hash(animationAttribution)!==manifest.animationRetarget.attributionSha256)throw Error(`${id} animation attribution hash mismatch`);
 const modelEvidence=JSON.parse(fs.readFileSync(path.join(dir,manifest.source.licenseEvidence)));
 if(modelEvidence.sourceSha256!==manifest.source.sourceSha256||modelEvidence.licenseUrl!==manifest.source.licenseUrl)throw Error(`${id} model attribution provenance mismatch`);
 const measured=JSON.parse(fs.readFileSync(path.join(dir,'blender-measurements.json'))),sourceAudit=JSON.parse(fs.readFileSync(path.join(dir,'source-audit.json')));
 if(sourceAudit.sha256!==manifest.source.sourceSha256||measured.sourceSha256!==manifest.source.sourceSha256)throw Error(`${id} source measurement hash mismatch`);
 const maskPath=path.join(dir,'surface-mask.json'),surfaceMask=fs.existsSync(maskPath)?JSON.parse(fs.readFileSync(maskPath)):null;
 if(surfaceMask&&surfaceMask.sourceSha256!==manifest.source.sourceSha256)throw Error('Surface mask source mismatch');
 const refinement=measured.surfaceSplit?.innerCapeRefinement;
 if(refinement?.addedTriangles){
  const reviewed=surfaceMask?.innerCapeRefinement;
  if(!reviewed||reviewed.sourceSha256!==manifest.source.sourceSha256||JSON.stringify(reviewed.faceIndices)!==JSON.stringify(refinement.sourceFaceIndices))throw Error(`${id} inner-shell refinement mask mismatch`);
  if(refinement.existingCornerPreservation?.missingOrChangedCorners!==0||!refinement.existingCornerPreservation?.beforeSha256)throw Error(`${id} inner-shell corner preservation is unverified`);
  if(refinement.sourceFaceIndices.some(i=>!surfaceMask.capeFaceIndices.includes(i)))throw Error(`${id} refinement targets non-cape source faces`);
 }
 for(let level=0;level<3;level++){const file=path.join(dir,`lod${level}.glb`),bytes=fs.readFileSync(file),encodedAsset=readGlb(file);
 const hasMeshopt=encodedAsset.document.bufferViews.some(v=>v.extensions?.EXT_meshopt_compression);
 if(hasMeshopt!==(manifest.bufferCompression==='EXT_meshopt_compression'))throw Error(`${id}/LOD${level} compression manifest mismatch`);
 const asset=hasMeshopt?await decodeMeshoptGlb(encodedAsset):encodedAsset,d=asset.document;
 if(hash(bytes)!==manifest.fileSha256[`lod${level}`])throw Error(`${id}/LOD${level} hash mismatch`);
 let losslessPublicationVerification;
 if(hasMeshopt){
  const packed=compressionAudit.lods.find(l=>l.level===level),texture=textureAudit?.lods.find(l=>l.level===level);
  if(!packed||!texture||packed.sha256!==hash(bytes)||packed.beforeSha256!==texture.outputSha256||!packed.allBufferViewsByteExact||packed.viewCount!==d.bufferViews.length)throw Error(`${id}/LOD${level} broken texture/buffer equality chain`);
  const viewDigests=d.bufferViews.map(view=>hash(asset.binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength))),viewsDigest=hash(Buffer.from(viewDigests.join('')));
  if([packed.originalViewsSha256,packed.npmDecodedViewsSha256,packed.threeDecodedViewsSha256].some(digest=>digest!==viewsDigest))throw Error(`${id}/LOD${level} decoded bufferViews differ from exact input`);
  const encodedImagesDigest=hash(Buffer.from(d.images.map(image=>viewDigests[image.bufferView]).join('')));
  if(texture.imageCount!==d.images.length||texture.outputEncodedSha256!==encodedImagesDigest||!texture.decodedRgbaIdentical||!texture.decodedRgbaSha256||!texture.jpegBytesUnchanged)throw Error(`${id}/LOD${level} image equality evidence differs`);
  const baseline=publicationAudit?.lods.find(l=>l.level===level);
  if(baseline){
   if(baseline.sha256!==hash(bytes)||baseline.baselineSha256!==texture.inputSha256||!baseline.allNonStorageDocumentSemanticsIdentical||baseline.accessorDefinitionsIdentical!==d.accessors.length||baseline.nonImageBufferViewsByteIdentical!==d.bufferViews.length-d.images.length)throw Error(`${id}/LOD${level} independent baseline proof differs`);
   if(baseline.imageCount!==d.images.length||!baseline.decodedRgbaByteIdentical||baseline.encodedImagesSha256!==encodedImagesDigest||baseline.decodedRgbaImagesSha256!==texture.decodedRgbaSha256||!baseline.jpegPayloadUnchanged)throw Error(`${id}/LOD${level} independent pixel proof differs`);
  }
  losslessPublicationVerification={baselineGlbSha256:texture.inputSha256,decodedBufferViewsByteExact:d.bufferViews.length,imagesDecodedRgbaIdentical:d.images.length,jpegPayloadUnchanged:true};
 }
 const textures=d.images.map(im=>{if(im.uri||im.bufferView===undefined)throw Error('Expected embedded image');const view=d.bufferViews[im.bufferView],payload=asset.binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),[width,height]=imageDimensions(payload),expected=[2048,1024,512][level];if(width!==expected||height!==expected)throw Error(`${id}/LOD${level} unexpected image size ${width}x${height}`);return{name:im.name,width,height,bytes:payload.length,mimeType:im.mimeType};});
 const names=new Set(d.nodes.map(n=>n.name));for(const name of[...required,...sockets])if(!names.has(name))throw Error(`${id} missing ${name}`);
 for(const side of['l','r'])for(const finger of['thumb','index','middle','ring','pinky'])for(const joint of['01','02','03'])if(!names.has(`${finger}_${joint}_${side}`))throw Error(`${id} missing phalange`);
 let maxWeightError=0,minWeight=1,vertices=0,triangles=0;const surfaceVertices=new Map(),positionKey=p=>p.map(x=>x.toFixed(5)).join(',');
 const capeRegion={definition:'All vertices with any fitted cape-helper influence. This tests the separated deformation ownership; it does not claim to identify every textured upper-cloak vertex.',sourceMaskSha256:surfaceMask?hash(fs.readFileSync(maskPath)):null,sourceCapeFaceCount:surfaceMask?.capeFaceIndices.length??0,vertices:0,maxArmOrHandWeight:0};
 const shoulderY=manifest.metrics.heightM===1.9?1.493:1.415;const hasCape=!!manifest.clothRig?.cape?.length;
 for(const mesh of d.meshes)for(const p of mesh.primitives){const pos=values(asset,p.attributes.POSITION),weights=values(asset,p.attributes.WEIGHTS_0),joints=values(asset,p.attributes.JOINTS_0);vertices+=pos.length;triangles+=d.accessors[p.indices].count/3;
 for(let i=0;i<pos.length;i++){if(!pos[i].every(Number.isFinite)||!weights[i].every(Number.isFinite))throw Error('Nonfinite geometry or weights');const sum=weights[i].reduce((a,b)=>a+b,0);maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));minWeight=Math.min(minWeight,...weights[i]);if(joints[i].some(j=>!Number.isInteger(j)||j<0||j>=d.skins[0].joints.length))throw Error('Joint index out of bounds');
 const key=positionKey(pos[i]),named=Object.fromEntries(weights[i].flatMap((w,k)=>w>1e-8?[[d.nodes[d.skins[0].joints[joints[i][k]]].name,w]]:[]));if(!surfaceVertices.has(key))surfaceVertices.set(key,[]);surfaceVertices.get(key).push(named);
 if(hasCape&&weights[i].some((w,k)=>w>1e-8&&d.nodes[d.skins[0].joints[joints[i][k]]].name.startsWith('cape_'))){capeRegion.vertices++;const weight=weights[i].reduce((sum,w,k)=>sum+(/^(upper_arm|lower_arm|hand|thumb|index|middle|ring|pinky)_/.test(d.nodes[d.skins[0].joints[joints[i][k]]].name)?w:0),0);capeRegion.maxArmOrHandWeight=Math.max(capeRegion.maxArmOrHandWeight,weight);}}}
 if(maxWeightError>1e-5||minWeight<0)throw Error('Non-normalized weights');
 const shell=measured.lodSurfaceRepairs?.[`lod${level}`];let verifiedShellPairs=0;
 if(shell?.pairs){
  if(!surfaceMask?.lodPairedShell||surfaceMask.lodPairedShell.sourceSha256!==manifest.source.sourceSha256)throw Error(`${id} missing paired-shell provenance`);
  for(const pair of shell.pairs)for(const side of['outer','inner']){const candidates=surfaceVertices.get(positionKey(pair[side]))??[];if(!candidates.some(w=>Object.keys({...w,...pair.weights}).every(n=>Math.abs((w[n]??0)-(pair.weights[n]??0))<1e-4)))throw Error(`${id}/LOD${level} paired ${side} vertex weights differ`);}
  verifiedShellPairs=shell.pairs.length;
 }
 for(const skin of d.skins)if(!values(asset,skin.inverseBindMatrices).flat().every(Number.isFinite))throw Error('Nonfinite inverse bind');
 const clips=(d.animations??[]).map(a=>({name:a.name,channels:a.channels.map(c=>({bone:d.nodes[c.target.node].name,path:c.target.path})),streams:a.samplers.map(s=>({time:hash(Buffer.from(new Float32Array(values(asset,s.input).flat()).buffer)),values:hash(Buffer.from(new Float32Array(values(asset,s.output).flat()).buffer))}))}));
 const hierarchy=d.nodes.filter(n=>n.mesh===undefined).map(n=>({name:n.name,translation:n.translation,rotation:n.rotation,scale:n.scale,children:(n.children??[]).map(i=>d.nodes[i].name)}));
 const inverseBindMatrices=d.skins.map(s=>values(asset,s.inverseBindMatrices));
 const signature=JSON.stringify({clips,hierarchy,inverseBindMatrices});if(canonical&&signature!==canonical)throw Error(`${id} LOD animation or bind/rest transform differs`);canonical??=signature;
 if(!manifest.animations?.embedded?.length||clips.length<12)throw Error(`${id} is not a complete animated candidate`);
 for(const binding of manifest.animations?.embedded??[])if(!clips.some(c=>c.name===binding.clip))throw Error(`${id} missing clip ${binding.clip}`);
 const rig=await loadRig(asset);rig.scene.updateMatrixWorld(true);
 const hipsX=new THREE.Vector3(1,0,0).applyQuaternion(rig.scene.getObjectByName('hips').getWorldQuaternion(new THREE.Quaternion()));
 if(hipsX.x<.999)throw Error(`${id} hips +X is not canonical actor +X`);
 if(capeRegion.maxArmOrHandWeight>1e-5)throw Error(`${id}/LOD${level} lower cape still contains arm weights ${capeRegion.maxArmOrHandWeight}`);
 lods.push({level,sha256:hash(bytes),bytes:bytes.length,triangles,vertices,verifiedShellPairs,skinJointCount:d.skins[0].joints.length,hipsAxisX:hipsX.toArray(),capeRegion,meshes:d.meshes.length,materials:d.materials.length,images:d.images.length,textures,maxWeightError,minWeight,clips:clips.map(c=>c.name),losslessPublicationVerification});
 }
 if(new Set(lods.map(l=>l.sha256)).size!==3)throw Error(`${id} repeats LOD asset hashes`);
 if(!(lods[0].triangles>lods[1].triangles&&lods[1].triangles>lods[2].triangles))throw Error(`${id} LOD triangle counts do not descend`);
 if(lods[1].triangles<3000||lods[1].triangles>5000||lods[2].triangles<1000||lods[2].triangles>2000)throw Error(`${id} reduced LOD triangle budget exceeded`);
 const repair=measured.surfaceSplit??{},expectedLod0=sourceAudit.originalTriangles-(repair.removedBridgeFaces?.length??0)+(repair.bodyBackingTriangles??0)+(repair.innerCapeRefinement?.addedTriangles??0);
 if(lods[0].triangles!==expectedLod0)throw Error(`${id} LOD0 differs from source plus documented repair allowance`);
 const audit={id,distinctRealLods:true,triangleBudgets:'LOD1 3000–5000; LOD2 1000–2000; strictly descending',lod0SourceRepairAccounting:{originalTriangles:sourceAudit.originalTriangles,removedBridgeTriangles:repair.removedBridgeFaces?.length??0,addedLiningTriangles:repair.bodyBackingTriangles??0,addedInnerCapeRefinementTriangles:repair.innerCapeRefinement?.addedTriangles??0,expectedTriangles:expectedLod0},sourceSha256:manifest.source.sourceSha256,structuralStatus:'pass',sameLodRigAndAnimation:true,lods,visualStatus:'Not established by this structural audit',limitations:'No claim of collision-free cloth, correct grip or GPU performance from structural checks.'};fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));}
