// Usage: node tools/build-high-tier-weapons.mjs /path/to/source-directory
// Preserve mesh, skin, image and animation bytes; normalize only the scene root.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readGlb, encodeGlb } from './lib/humanoid-glb.mjs'

const source = process.argv[2]
if (!source) throw new Error('Provide the directory containing bow.glb and spear.glb')
const destination = 'public/models/weapons/high-tier'
fs.mkdirSync(destination, { recursive: true })
for (const name of ['bow', 'spear']) {
  const input = path.join(source, `${name}.glb`)
  const { document, binary } = readGlb(input)
  const scene = document.scenes[document.scene ?? 0]
  const scale = name === 'spear' ? 3.1 / (718.034423828125 - 3.960691452026367) : .85 / .962883365720857
  const wrapper = { name: `${name}-attachment-space`, children: scene.nodes,
    scale: [scale, scale, scale],
    ...(name === 'spear' ? { translation: [0, -.5 - 3.960691452026367 * scale, 0] }
      : { rotation: [.5, .5, .5, .5] }),
  }
  scene.nodes = [document.nodes.length]
  document.nodes.push(wrapper)
  document.asset.extras = { ...document.asset.extras,
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
    build: 'tools/build-high-tier-weapons.mjs',
  }
  fs.writeFileSync(path.join(destination, `${name}.glb`), encodeGlb(document, binary))
}
