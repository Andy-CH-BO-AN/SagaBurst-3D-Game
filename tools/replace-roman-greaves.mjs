/** Fit only the supplied centurion shoes/greaves to T4; preserve skeleton and clips. */
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import * as T from 'three'
import {MeshoptSimplifier} from 'meshoptimizer'
import {readGlb,loadRig,encodeGlb} from './lib/humanoid-glb.mjs'
import {packGlbResources} from './lib/pack-glb-resources.mjs'
const dir='public/models/characters/v2/roman-hero-t4', source='artifacts/character_sources/roman-centurion/source.glb',out='output/roman-greaves/prepared'
const attribution=JSON.parse(fs.readFileSync('artifacts/character_sources/roman-centurion/attribution.json')),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
if(sha(source)!==attribution.sourceSha256)throw Error('Unexpected centurion source')
execFileSync(process.env.ROMAN_HERO_PYTHON??'python3',['tools/roman-greaves-textures.py',source,`${dir}/lod0.glb`,out],{stdio:'inherit'})
await MeshoptSimplifier.ready
const src=await loadRig(readGlb(source));src.scene.updateMatrixWorld(true)
const manifest=JSON.parse(fs.readFileSync(`${dir}/manifest.json`)),palette=JSON.parse(fs.readFileSync(`${out}/palette.json`))
const smooth=T.MathUtils.smoothstep
function fittedGeometry(mesh,lod){
  const g=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),p=Array.from(g.attributes.position.array),uv=Array.from(g.attributes.uv.array),idx=[]
  // Subdivide the existing surface so ankle fitting follows its curvature; no new ornament.
  const midpoint=new Map(),mid=(a,b)=>{const key=[Math.min(a,b),Math.max(a,b)].join(':');if(midpoint.has(key))return midpoint.get(key);const n=p.length/3;for(let c=0;c<3;c++)p.push((p[a*3+c]+p[b*3+c])/2);for(let c=0;c<2;c++)uv.push((uv[a*2+c]+uv[b*2+c])/2);midpoint.set(key,n);return n}
  const sourceIndices=g.index.array
  for(let i=0;i<sourceIndices.length;i+=3){const a=sourceIndices[i],b=sourceIndices[i+1],c=sourceIndices[i+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);idx.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca)}
  for(let i=0;i<p.length;i+=3){const x=p[i],y=p[i+1],z=p[i+2],sign=Math.sign(x)
    p[i]=sign*(.10+.01*smooth(y,-.85,-.46))+(x-sign*(.207-.047*smooth(y,-.90,-.46)))*(1.5-.4*smooth(y,-.87,-.75))
    p[i+1]=(y+1)*1.08;p[i+2]=z*1.30-.073+.03*smooth(y,-.89,-.76)
  }
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.deleteAttribute('normal');g.deleteAttribute('tangent')
  const target=Math.floor(idx.length*[.70,.23,.085][lod]/3)*3
  const [indices]=MeshoptSimplifier.simplify(new Uint32Array(idx),g.attributes.position.array,3,target,.006)
  g.setIndex(new T.BufferAttribute(indices,1));return g
}
for(let lod=0;lod<3;lod++){
  const path=`${dir}/lod${lod}.glb`,asset=readGlb(path),doc=asset.document,rig=await loadRig(asset);rig.scene.updateMatrixWorld(true)
  const node=doc.nodes.find(n=>['Boots','Praetorian_centurion_footwear'].includes(n.name)),oldRoot=rig.scene.getObjectByName(node.name),old=oldRoot.isSkinnedMesh?oldRoot:oldRoot.children.find(m=>m.isSkinnedMesh),leg=rig.scene.getObjectByName('New_legs')
  const inv=old.matrixWorld.clone().invert(),worldSkin=leg.geometry.clone().applyMatrix4(leg.matrixWorld)
  const skin=new T.Mesh(worldSkin,new T.MeshBasicMaterial({side:T.DoubleSide}));skin.updateMatrixWorld(true)
  const ray=new T.Raycaster(),v=new T.Vector3(),center=new T.Vector3(),direction=new T.Vector3(),closest=new T.Vector3(),bary=new T.Vector3(),tri=new T.Triangle()
  const lp=worldSkin.attributes.position,li=worldSkin.index.array,weights=leg.geometry.attributes.skinWeight,joints=leg.geometry.attributes.skinIndex
  const triangles=[];for(let i=0;i<li.length;i+=3){const a=li[i],b=li[i+1],c=li[i+2];if(Math.min(lp.getY(a),lp.getY(b),lp.getY(c))<.66)triangles.push([a,b,c])}
  const chunks=[asset.binary];let offset=asset.binary.length
  const bytes=b=>{const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad}doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length});chunks.push(b);offset+=b.length;return doc.bufferViews.length-1}
  const append=(array,type)=>{const a={bufferView:bytes(Buffer.from(array.buffer,array.byteOffset,array.byteLength)),componentType:array instanceof Float32Array?5126:array instanceof Uint16Array?5123:5125,count:array.length/({SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type]),type};if(type==='VEC3'){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];array.forEach((n,i)=>{a.min[i%3]=Math.min(a.min[i%3],n);a.max[i%3]=Math.max(a.max[i%3],n)})}doc.accessors.push(a);return doc.accessors.length-1}
  const textures={};for(const name of ['albedo','metalrough','normal']){const image=doc.images.length;doc.images.push({name:`Praetorian_greaves_${name}`,mimeType:'image/png',bufferView:bytes(fs.readFileSync(`${out}/${name}${lod}.png`))});textures[name]=doc.textures.length;doc.textures.push({source:image})}
  const material=doc.materials.length;doc.materials.push({name:'Praetorian_centurion_leather_steel',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:textures.albedo},metallicRoughnessTexture:{index:textures.metalrough},metallicFactor:1,roughnessFactor:1},normalTexture:{index:textures.normal,scale:.45}})
  const primitives=[];let projectionCount=0,maxExpansion=0
  for(const name of attribution.selectedSourceMeshes){
    const g=fittedGeometry(src.scene.getObjectByName(name),lod),p=g.attributes.position,w=new Float32Array(p.count*4),j=new Uint16Array(p.count*4)
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);const sign=Math.sign(v.x)
      center.set(sign*(.10+.01*smooth(v.y,.16,.58)),v.y,.055*(1-smooth(v.y,.07,.17)))
      direction.copy(v).sub(center);direction.y=0;const radius=direction.length();direction.normalize()
      ray.set(center.clone().addScaledVector(direction,.45),direction.clone().negate())
      const hit=ray.intersectObject(skin).find(h=>Math.sign(h.point.x)===sign)
      if(hit&&v.y>.027){const required=hit.point.clone().sub(center).dot(direction)+.014+(.005+.008*lod)*smooth(v.y,.04,.08)*(1-smooth(v.y,.23,.30))+.006*lod
        if(required>radius){const expand=Math.min(required-radius,.065);v.addScaledVector(direction,expand);projectionCount++;maxExpansion=Math.max(maxExpansion,expand)}}
      // Roll the original sole rim into the existing contact envelope.
      const sole=1-smooth(v.y,.018,.055)
      v.y+=.0005*sole
      if(v.z>.245)v.y+=(v.z-.245)*.72*sole
      if(v.z<-.076)v.z-=(v.z+.076)*.85*sole
      p.setXYZ(i,v.x,v.y,v.z)
      // Barycentric transfer from the actual foot surface preserves toe/ankle deformation.
      let best=Infinity,bestIds,bestBary
      for(const ids of triangles){if(Math.sign(lp.getX(ids[0]))!==sign)continue
        tri.a.fromBufferAttribute(lp,ids[0]);tri.b.fromBufferAttribute(lp,ids[1]);tri.c.fromBufferAttribute(lp,ids[2]);tri.closestPointToPoint(v,closest);const d=v.distanceToSquared(closest)
        if(d<best){best=d;bestIds=ids;tri.getBarycoord(closest,bary);bestBary=bary.toArray()}}
      const sums=new Map();for(let k=0;k<3;k++)for(let c=0;c<4;c++){const joint=joints.getComponent(bestIds[k],c),amount=weights.getComponent(bestIds[k],c)*bestBary[k];sums.set(joint,(sums.get(joint)??0)+amount)}
      const ranked=[...sums].filter(([,a])=>a>1e-7).sort((a,b)=>b[1]-a[1]).slice(0,4),total=ranked.reduce((sum,[,a])=>sum+a,0)
      ranked.forEach(([joint,amount],c)=>{const target=old.skeleton.bones.findIndex(b=>b.name===leg.skeleton.bones[joint].name);if(target<0)throw Error('Missing target bone');j[i*4+c]=target;w[i*4+c]=amount/total})
    }
    g.applyMatrix4(inv);g.computeVertexNormals()
    primitives.push({attributes:{POSITION:append(p.array,'VEC3'),NORMAL:append(g.attributes.normal.array,'VEC3'),TEXCOORD_0:append(g.attributes.uv.array,'VEC2'),JOINTS_0:append(j,'VEC4'),WEIGHTS_0:append(w,'VEC4')},indices:append(new Uint32Array(g.index.array),'SCALAR'),material})
  }
  const count=primitives.reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0)
  node.name='Praetorian_centurion_footwear';doc.meshes[node.mesh]={name:node.name,primitives}
  doc.asset.extras.romanGreavesReplacement={sourceSha256:attribution.sourceSha256,selectedSourceMeshes:attribution.selectedSourceMeshes,triangles:count,skinTransfer:'nearest triangle barycentric weights from unchanged New_legs',projectionCount,maxExpansionM:maxExpansion,palette}
  fs.writeFileSync(path,encodeGlb(doc,packGlbResources(doc,Buffer.concat(chunks))))
  const total=doc.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0)
  manifest.fileSha256[`lod${lod}`]=sha(path);manifest.metrics.triangles[`lod${lod}`]=total
  const row=manifest.lodMeasurements[lod];Object.assign(row,{triangles:total,footwearTriangles:count,materials:doc.materials.length,sha256:sha(path),bytes:fs.statSync(path).size})
  row.textures=row.textures.filter(t=>!t.name.startsWith('Boots')&&!t.name.startsWith('Praetorian_greaves_'));for(const name of Object.keys(textures))row.textures.push({name:`Praetorian_greaves_${name}`,width:[2048,1024,512][lod],height:[2048,1024,512][lod]})
  console.log({lod,total,footwearTriangles:count,projectionCount,maxExpansion})
}
manifest.footwearSource=attribution;manifest.footwearFit={bodyLegsUnchanged:true,palette,method:'Separate bilateral stance fitting, surface clearance, original UVs and foot-surface skin weights.'}
manifest.modifications=manifest.modifications.filter(s=>!s.startsWith('Replacement footwear:'))
manifest.modifications.push('Replacement footwear: source centurion shoes, greaves and their four existing buckles only. Old Boots entirely removed. Fitted to unchanged T4 feet/calves, torso steel and existing dark leather palette, barycentric skin transfer, three source-derived LODs. Skeleton and animation payloads unchanged.')
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
const evidence=JSON.parse(fs.readFileSync(`${dir}/attribution-evidence.json`));evidence.footwear=attribution;fs.writeFileSync(`${dir}/attribution-evidence.json`,JSON.stringify(evidence,null,2)+'\n')
const credits=fs.readFileSync(`${dir}/ATTRIBUTION.md`,'utf8').split('\n## Replacement footwear')[0]
fs.writeFileSync(`${dir}/ATTRIBUTION.md`,`${credits}\n## Replacement footwear\n\n${attribution.title} by ${attribution.author}. ${attribution.url}\n\nLicense: ${attribution.license} (${attribution.licenseUrl}). Source SHA-256: ${attribution.sourceSha256}.\n\nChanges: extract original lower-leg components, subdivide/simplify original surface, fit feet and calves, transfer skin weights, recolor steel/leather and resize original normal atlas. No source upper-body armor is used. Rebuild using tools/replace-roman-greaves.mjs after the helmet replacement.\n`)
