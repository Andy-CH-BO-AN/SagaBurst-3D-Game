/** Final animation-only stage after humanoid/LOD builders. Source hashes fail closed
 * when upstream delivery changes: remeasure before updating the calibration. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readGlb, encodeGlb } from './lib/humanoid-glb.mjs'
import { trimAxeClip } from './lib/axe-clip-trim.mjs'
const calibration = JSON.parse(fs.readFileSync(new URL('./assets/axe-2h-trim.json', import.meta.url)))
const root = process.argv[2] ?? 'public/models/characters/v2'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
for (const [id, recipe] of Object.entries(calibration.assets)) {
  const directory = path.join(root, id), manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath)), previous = manifest.axeAttack2HTrim
  const recipeSha256 = hash(Buffer.from(JSON.stringify({ version: calibration.version, duration: calibration.duration, ...recipe })))
  if (previous?.version === calibration.version) {
    if (previous.recipeSha256 !== recipeSha256) throw Error(`${id}: changed recipe; restore the recorded input before rebuilding`)
    for (const [lod, file] of Object.entries(manifest.files)) {
      if (hash(fs.readFileSync(path.join(directory, file))) !== manifest.fileSha256[lod]) throw Error(`${id}/${lod}: changed after trim`)
    }
    console.log(`${id}: already trimmed`)
    continue
  }
  const binding = manifest.animations?.embedded?.find(entry => entry.clip === calibration.clip)
  if (!binding || Math.abs(binding.duration - recipe.sourceDuration) > .001) throw Error(`${id}: unmeasured manifest binding`)
  const results = new Map()
  // Validate every input before replacing any file in this asset.
  for (const file of new Set(Object.values(manifest.files))) {
    const sourcePath = path.join(directory, file), bytes = fs.readFileSync(sourcePath)
    if (hash(bytes) !== recipe.inputSha256[file]) throw Error(`${id}/${file}: unmeasured source; recalibrate rather than guessing`)
    const result = await trimAxeClip(readGlb(sourcePath), { start: recipe.sourceRange[0], end: recipe.sourceRange[1], duration: calibration.duration })
    results.set(file, { bytes: encodeGlb(result.document, result.binary), report: result.report })
  }
  for (const [file, result] of results) fs.writeFileSync(path.join(directory, file), result.bytes)
  binding.duration = calibration.duration
  binding.meleeCycleSeconds = .48
  binding.events = recipe.events
  binding.attackFadeInSeconds = recipe.attackFadeInSeconds
  if (recipe.attackTransition) binding.attackTransition = recipe.attackTransition
  for (const [lod, file] of Object.entries(manifest.files)) manifest.fileSha256[lod] = hash(results.get(file).bytes)
  manifest.axeAttack2HTrim = {
    version: calibration.version, recipe: 'tools/assets/axe-2h-trim.json', recipeSha256,
    sourceDuration: recipe.sourceDuration, sourceRange: recipe.sourceRange,
    sourceEvents: recipe.sourceEvents, inputSha256: recipe.inputSha256,
    duration: calibration.duration, events: recipe.events, attackFadeInSeconds: recipe.attackFadeInSeconds,
    ...(recipe.attackTransition ? { attackTransition: recipe.attackTransition } : {}),
    ...(recipe.knownLimitations ? { knownLimitations: recipe.knownLimitations } : {}),
    preservation: 'Only axeAttack2H channels and their referenced samples are replaced. Geometry, skin, textures, other animation payloads and runtime attack cycles are unchanged.',
    validation: 'Animation/asset and production-controller trajectory checks; live browser gameplay, visual contact/clearance and mounted aesthetic acceptance remain unverified.',
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${id}: ${recipe.sourceRange.join('..')} → ${calibration.duration}s`)
}
