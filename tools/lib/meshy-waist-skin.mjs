/** Keep the belt/abdomen on the pelvis while the thighs spread in a saddle.
 * Only existing leg influences above the proximal hip region move to hips;
 * geometry, inverse binds, other influences and lower garment skin stay intact.
 */
export function createMeshyWaistSkinRepair(jointNames, hipHeight) {
  const hips = jointNames.findIndex(name => /^(hips|mixamorig:?Hips)$/.test(name))
  if (hips < 0 || !Number.isFinite(hipHeight)) throw Error('Missing measured pelvis for waist skin')
  const legs = new Set(jointNames.flatMap((name, i) => /^(upper_leg_|lower_leg_|mixamorig:?(Left|Right)(UpLeg|Leg)$)/.test(name) ? [i] : []))
  const lower = hipHeight - .15, upper = hipHeight - .02
  let changedVertices = 0, maximumTransferredWeight = 0
  return {
    repair(entries, y) {
      const t = Math.min(1, Math.max(0, (y - lower) / (upper - lower)))
      const factor = t * t * (3 - 2 * t)
      if (!factor) return entries
      const weights = new Map()
      let moved = 0
      for (const [joint, weight] of entries) {
        const take = legs.has(joint) ? weight * factor : 0
        moved += take
        weights.set(joint, (weights.get(joint) ?? 0) + weight - take)
      }
      if (moved < 1e-6) return entries
      changedVertices++
      maximumTransferredWeight = Math.max(maximumTransferredWeight, moved)
      weights.set(hips, (weights.get(hips) ?? 0) + moved)
      return [...weights].filter(([, weight]) => weight > 1e-8).sort((a, b) => b[1] - a[1])
    },
    report() {
      return { method: 'Smoothly transfer misplaced thigh/calf influences to the existing pelvis above the proximal hip region.',
        sourceHipHeightM: hipHeight, blendHeightM: [lower, upper], changedVertices, maximumTransferredWeight,
        unchanged: ['positions', 'indices', 'normals', 'UVs', 'inverse binds', 'non-leg influences', 'lower garment skin'] }
    },
  }
}
