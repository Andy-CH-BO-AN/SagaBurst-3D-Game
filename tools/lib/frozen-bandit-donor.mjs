/** The old tokeshi body is an offline animation/hammer donor only.
 * Never use public/bandit here: it now contains a different Meshy visual rig.
 * Original redistribution terms and source hashes remain in its pinned manifest.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export const FROZEN_BANDIT_COMMIT = 'bb517258398423039a7a0dfa983681322c92a51d'
export const FROZEN_BANDIT_ASSET = `${FROZEN_BANDIT_COMMIT}:public/models/characters/v2/bandit/lod0.glb`
export const FROZEN_BANDIT_SHA256 = '76244820ef8c5e1304ef2ac2e3f246958c8d2f47b50ef0f7bcab72249e5f575c'
const hashes = {
  'lod0.glb': FROZEN_BANDIT_SHA256,
  'manifest.json': '71d2cc3a3c6a281c09d9031406f44aeba47202ca5896ea349b1fc9e0dcd8c637',
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** Recover verified donor inputs into ignored output; never ship the old body. */
export function frozenBanditDirectory() {
  const directory = path.resolve('output/frozen-bandit-donor')
  fs.mkdirSync(directory, { recursive: true })
  for (const [name, expected] of Object.entries(hashes)) {
    const file = path.join(directory, name)
    if (fs.existsSync(file) && hash(fs.readFileSync(file)) === expected) continue
    const bytes = execFileSync('git', ['show', `${FROZEN_BANDIT_COMMIT}:public/models/characters/v2/bandit/${name}`], { maxBuffer: 32 * 1024 * 1024 })
    if (hash(bytes) !== expected) throw Error(`Frozen Bandit donor SHA-256 mismatch: ${name}`)
    fs.writeFileSync(file, bytes)
  }
  return directory
}
