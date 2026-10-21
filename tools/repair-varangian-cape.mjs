/** Geometry-only repair of the existing T4 package. Usage:
 * node tools/repair-varangian-cape.mjs <original-package-directory> <output-directory>
 * Original animation/bind buffers are verified before writing. Re-running an
 * already repaired package is idempotent. Source provenance remains unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { readGlb, encodeGlb } from './lib/humanoid-glb.mjs'
import { repairVarangianCape } from './lib/varangian-cape-clearance.mjs'
const [input, output] = process.argv.slice(2)
if (!input || !output) throw Error('Provide original T4 package directory and output directory')
const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json')))
const audit=JSON.parse(fs.readFileSync(path.join(input,'lod-audit.json')))
if(manifest.id!=='viking-hero-t4'||manifest.selectedSource?.rig!=='varangian63')throw Error('Expected the selected Varangian package')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
fs.mkdirSync(output,{recursive:true})
for(const level of [0,1,2]){
  const file=`lod${level}.glb`,sourceBytes=fs.readFileSync(path.join(input,file))
  assert.equal(hash(sourceBytes),manifest.fileSha256[`lod${level}`],'Input package hash mismatch')
  const original=readGlb(path.join(input,file)),repaired=repairVarangianCape(original)
  assert.deepEqual(repaired.document.animations,original.document.animations)
  assert.deepEqual(repaired.document.skins,original.document.skins)
  assert.deepEqual(repaired.document.nodes,original.document.nodes)
  assert.ok(repaired.binary.subarray(0,original.binary.length).equals(original.binary),'Source animation/skin/image payload changed')
  const bytes=encodeGlb(repaired.document,repaired.binary)
  const repeated=repairVarangianCape(repaired)
  assert.ok(encodeGlb(repeated.document,repeated.binary).equals(bytes),'Repair is not idempotent')
  fs.writeFileSync(path.join(output,file),bytes)
  const triangles=repaired.document.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+repaired.document.accessors[p.indices].count/3,0),0)
  manifest.fileSha256[`lod${level}`]=hash(bytes);manifest.metrics.triangles[`lod${level}`]=triangles
  const previous=audit.lods[level]
  Object.assign(previous,{strategy:'Existing source package with documented local posterior cape backing, rear clearance and LOD2 fold UV repair; original animation and bind payload retained.',triangles,bytes:bytes.length,derivedFromSha256:previous.derivedFromSha256??hash(sourceBytes),capeRepair:repaired.audit})
  console.log(file,manifest.fileSha256[`lod${level}`],JSON.stringify(repaired.audit))
}
manifest.modifications=['Posterior cape backing and tapered 10 cm rear clearance; three LOD2 central-fold UV triangles reprojected; source joints, weights and eleven clips preserved.']
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
fs.writeFileSync(path.join(output,'lod-audit.json'),JSON.stringify(audit,null,2)+'\n')
