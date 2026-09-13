import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
export async function loadCharacter(faction, lod = 0){
 const b=fs.readFileSync(`public/models/characters/v2/${faction}/lod${lod}.glb`), l=b.readUInt32LE(12), j=JSON.parse(b.toString('utf8',20,20+l));
 delete j.images; delete j.textures; delete j.materials;
 for(const m of j.meshes) for(const p of m.primitives) delete p.material;
 const jb=Buffer.from(JSON.stringify(j).padEnd(Math.ceil(Buffer.byteLength(JSON.stringify(j))/4)*4,' '));
 const bin=b.subarray(20+l), h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+jb.length+bin.length,8);h.writeUInt32LE(jb.length,12);h.write('JSON',16);
 const data=Buffer.concat([h,jb,bin]); return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) for(const faction of ['viking','roman']) {
 const gltf=await loadCharacter(faction); gltf.scene.updateMatrixWorld(true);
 const hand=gltf.scene.getObjectByName('hand_l'), inv=hand.matrixWorld.clone().invert();
 const points=[];
 gltf.scene.traverse(o=> {if(!o.isSkinnedMesh)return; const a=o.geometry.attributes, k=o.skeleton.bones.indexOf(hand);if(k<0)return;
 for(let i=0;i<a.position.count;i++){let w=0;for(let n=0;n<4;n++)if(a.skinIndex.getComponent(i,n)===k)w+=a.skinWeight.getComponent(i,n);if(w<.7)continue;
 const p=new T.Vector3().fromBufferAttribute(a.position,i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);points.push({mesh:o.name,id:i,p:p.toArray()});}
 });
 fs.mkdirSync('output/playwright/bow_shared_20260908',{recursive:true});fs.writeFileSync(`output/playwright/bow_shared_20260908/${faction}-hand-points.json`,JSON.stringify(points));
 console.log(faction,'hand',hand.position.toArray(),hand.quaternion.toArray());
 for(const [a,b] of [[0,.03],[.03,.06],[.06,.09],[.09,.12],[.12,.16],[.16,.22]]){const ps=points.filter(v=>v.p[1]>=a&&v.p[1]<b);console.log(a,b,ps.length,ps.length?new T.Box3().setFromPoints(ps.map(v=>new T.Vector3(...v.p))).min.toArray():[],ps.length?new T.Box3().setFromPoints(ps.map(v=>new T.Vector3(...v.p))).max.toArray():[])}
 const ray=new T.Raycaster();
 for(const along of faction==='viking'?[.055,.07,.085]:[.025,.04,.055]) {
  for(const across of [-.025,0,.025]) {
   const o=faction==='viking'?new T.Vector3(-1,along,across):new T.Vector3(across,along,-1);
   const d=faction==='viking'?new T.Vector3(1,0,0):new T.Vector3(0,0,1);
   ray.set(o.applyMatrix4(hand.matrixWorld),d.transformDirection(hand.matrixWorld));
   const hit=ray.intersectObject(gltf.scene,true).find(h=>['Legs_Hands','New_arms'].includes(h.object.name));
   if(hit)console.log('palm sample',along,across,hit.point.applyMatrix4(inv).toArray());
  }
 }
 const mixer=new T.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations.find(c=>c.name==='bowHold')).play();mixer.setTime(.65);gltf.scene.updateMatrixWorld(true);
 for(const name of ['upper_arm_l','lower_arm_l','hand_l']){const o=gltf.scene.getObjectByName(name);console.log(name,'q',o.quaternion.toArray(),'world axes',...[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)].map(v=>v.transformDirection(o.matrixWorld).toArray()))}
}
