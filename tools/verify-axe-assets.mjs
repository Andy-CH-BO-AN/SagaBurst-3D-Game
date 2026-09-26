import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readGlb, readAccessor } from './lib/humanoid-glb.mjs'

const baseRef = process.argv[2] ?? 'origin/main'
const rows = []
for (const faction of ['roman', 'viking']) for (let lod = 0; lod < 3; lod++) {
  const path = `public/models/characters/v2/${faction}/lod${lod}.glb`
  const bytes = execFileSync('rtk', ['proxy', 'git', 'show', `${baseRef}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  const length = bytes.readUInt32LE(12)
  const original = { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) }
  const current = readGlb(path), base = original.document.asset.extras.humanoidAnimationBuild
  const skeleton = ['nodes', 'skins', 'meshes', 'materials', 'images'].every(key => JSON.stringify(original.document[key]) === JSON.stringify(current.document[key]))
  const geometry = original.binary.subarray(0, base.baseBufferByteLength).equals(current.binary.subarray(0, base.baseBufferByteLength))
  const existingClips = original.document.animations.every(a => {
    const b = current.document.animations.find(b => a.name === b.name)
    return JSON.stringify(a.channels) === JSON.stringify(b.channels) && a.samplers.every((s, i) => {
      const t = b.samplers[i]
      return ['input', 'output'].every(key => Buffer.from(readAccessor(original, s[key]).buffer).equals(Buffer.from(readAccessor(current, t[key]).buffer)))
    })
  })
  const manifest = JSON.parse(fs.readFileSync(`public/models/characters/v2/${faction}/manifest.json`))
  const hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex') === manifest.fileSha256[`lod${lod}`]
  const axes = faction === 'roman' || ['axeAttack1H', 'axeAttack2H'].every(name => {
    const clip = current.document.animations.find(c => c.name === name)
    return clip && clip.channels.every(c => c.target.path === 'rotation')
      && clip.samplers.every(s => [...readAccessor(current, s.output)].every(Number.isFinite))
  })
  rows.push({ faction, lod, skeleton, geometry, existingClips, manifestHash: hash, rotationOnlyAxeClips: axes })
  if (!skeleton || !geometry || !existingClips || !hash || !axes) process.exitCode = 1
}
fs.mkdirSync('output/axe', { recursive: true })
fs.writeFileSync('output/axe/asset-preservation.json', JSON.stringify({ baseRef, rows }, null, 2))
console.log(JSON.stringify(rows, null, 2))
