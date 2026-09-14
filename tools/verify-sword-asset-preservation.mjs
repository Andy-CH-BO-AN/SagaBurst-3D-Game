import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readGlb, readAccessor } from './lib/humanoid-glb.mjs'
const output = 'output/sword/preservation.json'
const rows = []
for (const faction of ['roman', 'viking']) for (let lod = 0; lod < 3; lod++) {
  const path = `public/models/characters/v2/${faction}/lod${lod}.glb`
  const { sourceCommit } = JSON.parse(fs.readFileSync(`artifacts/animation_sources/sword_baselines/${faction}-locomotion.json`))
  const bytes = execFileSync('git', ['show', `${sourceCommit}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  const length = bytes.readUInt32LE(12)
  const original = { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) }
  const current = readGlb(path), base = original.document.asset.extras.humanoidAnimationBuild
  const skeleton = ['nodes', 'skins', 'meshes', 'materials', 'images'].every(key => JSON.stringify(original.document[key]) === JSON.stringify(current.document[key]))
  const geometry = original.binary.subarray(0, base.baseBufferByteLength).equals(current.binary.subarray(0, base.baseBufferByteLength))
  const preserved = original.document.animations.filter(a => !['idle', 'walk', 'run', ...(process.argv.includes('--attack') ? ['swordSlash'] : [])].includes(a.name)).every(a => {
    const b = current.document.animations.find(b => a.name === b.name)
    return JSON.stringify(a.channels) === JSON.stringify(b.channels) && a.samplers.every((s, i) => {
      const t = b.samplers[i]
      return ['input', 'output'].every(key => Buffer.from(readAccessor(original, s[key]).buffer).equals(Buffer.from(readAccessor(current, t[key]).buffer)))
    })
  })
  const manifest = JSON.parse(fs.readFileSync(`public/models/characters/v2/${faction}/manifest.json`))
  const hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex') === manifest.fileSha256[`lod${lod}`]
  rows.push({ faction, lod, sourceCommit, skeleton, geometry, unselectedAnimations: preserved, manifestHash: hash })
  if (!skeleton || !geometry || !preserved || !hash) process.exitCode = 1
}
fs.mkdirSync('output/sword', { recursive: true })
fs.writeFileSync(output, JSON.stringify(rows, null, 2))
console.log(JSON.stringify(rows))
