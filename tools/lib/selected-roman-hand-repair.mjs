/** The selected mesh already contains a cupped hand. The two Meshy takes
 * rotate its finger chains again, crushing that authored shape. Preserve the
 * same cupped finger pose used by Core9; leave wrists, arms and body tracks
 * untouched. This local source correction was explicitly approved by the user.
 * Append independent outputs so shared accessors can never rewrite other clips.
 * Geometry, all four weight sets, inverse binds, UVs and textures remain exact.
 */
export function repairSelectedRomanHands(asset) {
  const document = structuredClone(asset.document)
  const chunks = [asset.binary]
  let offset = asset.binary.length
  const correctedChannels = []
  for (const clip of document.animations) {
    if (!['axeAttack1H', 'axeAttack2H'].includes(clip.name)) continue
    for (const channel of clip.channels) {
      const bone = document.nodes[channel.target.node]
      if (channel.target.path !== 'rotation' || !/^mixamorig:(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[1-4]$/.test(bone.name)) continue
      const original = clip.samplers[channel.sampler]
      const accessor = document.accessors[original.output]
      if (accessor.type !== 'VEC4' || original.interpolation === 'CUBICSPLINE') throw new Error('Unsupported selected finger interpolation')
      const bytes = Buffer.alloc(accessor.count * 16)
      for (let frame = 0; frame < accessor.count; frame++) for (let axis = 0; axis < 4; axis++) {
        bytes.writeFloatLE(bone.rotation[axis], frame * 16 + axis * 4)
      }
      channel.sampler = clip.samplers.length
      clip.samplers.push({ ...original, output: document.accessors.length })
      document.accessors.push({ bufferView: document.bufferViews.length, componentType: 5126, count: accessor.count, type: 'VEC4' })
      document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
      chunks.push(bytes); offset += bytes.length
      correctedChannels.push(`${clip.name}:${bone.name}`)
    }
  }
  if (correctedChannels.length !== 80) throw new Error(`Expected 80 selected Roman finger channels, got ${correctedChannels.length}`)
  document.buffers[0].byteLength = offset
  return { document, binary: Buffer.concat(chunks), audit: {
    kind: 'retain-authored-cupped-fingers', correctedChannels,
    preserved: 'Source mesh, indices, UVs, textures, four weight sets, inverse binds, 66 joints, all body/wrist channels and original clip timing',
  } }
}
