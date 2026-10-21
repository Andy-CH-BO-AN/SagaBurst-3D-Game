/** Offline index-only simplification: retain source positions/UVs and lock borders. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=path.resolve(process.env.MESHY_SIMPLIFIER_PATH ?? 'output/meshy-tools/node_modules/meshoptimizer/meshopt_simplifier.js');
const {MeshoptSimplifier}=await import(pathToFileURL(modulePath));
const packageInfo=JSON.parse(fs.readFileSync(path.join(path.dirname(modulePath),'package.json')));
if(packageInfo.version!=='1.3.0')throw new Error('Rebuild requires pinned meshoptimizer@1.3.0');
await MeshoptSimplifier.ready;
const [input,output,ratioText]=process.argv.slice(2);
const data=JSON.parse(fs.readFileSync(input));
const unique=[],keys=new Map(),remap=[];
for(let i=0;i<data.positions.length;i++) {
  const key=[...data.positions[i],...data.uvs[i]].map(v=>Math.round(v*1e5)).join(',');
  if(!keys.has(key)){keys.set(key,unique.length);unique.push(i)}
  remap.push(keys.get(key));
}
const positions=Float32Array.from(unique.flatMap(i=>data.positions[i]));
const indices=Uint32Array.from(remap);
const attributes=Float32Array.from(unique.flatMap(i=>[...data.uvs[i],...data.normals[i]]));
const [reduced,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributes,5,[4,4,.3,.3,.3],null,Math.floor(indices.length*Number(ratioText)/3)*3,.012,['LockBorder','PreserveFolds']);
fs.writeFileSync(output,JSON.stringify({indices:Array.from(reduced,i=>unique[i]),relativeError:error}));
