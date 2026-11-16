import { Euler, Quaternion, QuaternionKeyframeTrack } from 'three'
const FINGER = /^(thumb|index|middle|ring|pinky)_0[123]_[lr]$/
/** Optional measured target-local XYZ postrotations, never body or clock edits.
 * {rotations:{bone:[x,y,z]}, clips:{clip:{bone:[x,y,z]}}, releaseFadeSeconds:.12}
 * Optional relaxAfterRelease:{bowRelease:[bone]} also eases that right finger
 * to its supplied target-local bind rotation. Right fingers shed the added grip
 * after existing projectileRelease events; pre-event samples are unchanged.
 */
export function correctTieredFingerPoses(clips, bindings, specification, restRotations = {}) {
  if (!specification) return { correctedTracks: 0 }
  const fadeSeconds = specification.releaseFadeSeconds ?? .12
  if (!(fadeSeconds > 0 && Number.isFinite(fadeSeconds))) throw Error('Invalid finger release fade')
  for (const name of [...Object.keys(specification.clips ?? {}), ...Object.keys(specification.relaxAfterRelease ?? {})]) {
    if (!clips.some(clip => clip.name === name)) throw Error(`Unknown corrected action ${name}`)
  }
  let correctedTracks = 0
  for (const clip of clips) {
    const rotations = { ...specification.rotations, ...specification.clips?.[clip.name] }
    const relax = new Set(specification.relaxAfterRelease?.[clip.name] ?? [])
    for (const bone of relax) {
      if (!FINGER.test(bone) || !bone.endsWith('_r') || !['bowRelease','pilumThrow'].includes(clip.name) || !restRotations[bone]) throw Error(`Invalid released finger relaxation ${clip.name}:${bone}`)
      rotations[bone] ??= [0,0,0]
    }
    for (const [bone, angles] of Object.entries(rotations)) {
      if (!FINGER.test(bone) || !Array.isArray(angles) || angles.length !== 3 || !angles.every(Number.isFinite)) throw Error(`Invalid finger correction ${bone}`)
      const index = clip.tracks.findIndex(track => track.name === `${bone}.quaternion`)
      if (index < 0) throw Error(`Missing corrected finger ${bone}`)
      const track = clip.tracks[index], sample = track.createInterpolant()
      const release = ['bowRelease', 'pilumThrow'].includes(clip.name) && bone.endsWith('_r')
        ? bindings.find(binding => binding.clip === clip.name)?.events?.projectileRelease : undefined
      if (['bowRelease', 'pilumThrow'].includes(clip.name) && bone.endsWith('_r') && !Number.isFinite(release)) throw Error(`Missing release event ${clip.name}`)
      const end = release === undefined ? undefined : Math.min(clip.duration, release + fadeSeconds)
      const times = [...new Set([...track.times, ...(release === undefined ? [] : Array.from({length:5},(_,i)=>release+(end-release)*i/4))].map(Math.fround))].sort((a,b) => a-b)
      const correction = new Quaternion().setFromEuler(new Euler(...angles, 'XYZ'))
      const identity = new Quaternion(), q = new Quaternion(), offset = new Quaternion(), values = []
      for (const time of times) {
        let strength = 1
        if (release !== undefined && time > release) {
          const t = Math.min(1, Math.max(0,(time-release)/(end-release)))
          strength = 1-t*t*(3-2*t)
        }
        q.fromArray(sample.evaluate(time)).multiply(offset.slerpQuaternions(identity,correction,strength)).normalize()
        if (relax.has(bone)) q.slerp(new Quaternion().fromArray(restRotations[bone]),1-strength).normalize()
        if (values.length && q.dot(new Quaternion().fromArray(values,values.length-4)) < 0) q.set(-q.x,-q.y,-q.z,-q.w)
        values.push(...q.toArray())
      }
      clip.tracks[index] = new QuaternionKeyframeTrack(track.name,times,values)
      correctedTracks++
    }
  }
  return { correctedTracks, releaseFadeSeconds: fadeSeconds, specification }
}
