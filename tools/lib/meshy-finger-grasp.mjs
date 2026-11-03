import * as T from 'three'

/** Fit existing finger joints around the measured shaft without changing mesh,
 * topology, skin weights or the wrist. Returned local postrotations can be
 * applied after the established anatomical animation transfer.
 */
export function fitMeshyFingerGrasp(scene, frames) {
  const saved=[]
  scene.traverse(o=>saved.push([o,o.quaternion.clone()]))
  scene.updateMatrixWorld(true)
  const corrections={},diagnostics=[]
  for(const side of ['l','r']) {
    const hand=scene.getObjectByName(`hand_${side}`),frame=frames[side]
    const center=new T.Vector3(...frame.gripCenterLocal),axis=new T.Vector3(...frame.gripAxisLocal).normalize()
    const normal=new T.Vector3(...frame.palmNormalLocal).normalize(),finger=new T.Vector3(...frame.fingerDirection).normalize()
    const bend=new T.Vector3().crossVectors(finger,normal).normalize()
    const radius=.026
    for(const digit of ['index','middle','ring','pinky']) {
      const chain=[1,2,3,4].map(i=>scene.getObjectByName(`${digit}_0${i}_${side}`))
      if(chain.some(b=>!b))throw Error(`Missing articulated ${digit} ${side}`)
      const rest=chain.map(b=>b.quaternion.clone())
      const handRotation=hand.getWorldQuaternion(new T.Quaternion()),worldBend=bend.clone().applyQuaternion(handRotation)
      const point=bone=>hand.worldToLocal(bone.getWorldPosition(new T.Vector3()))
      const base=point(chain[0]),across=base.clone().sub(center).dot(axis)
      const desired=center.clone().addScaledVector(axis,across).addScaledVector(normal,radius).addScaledVector(finger,-.008)
      function apply(angles) {
        for(let i=0;i<3;i++)chain[i].quaternion.copy(rest[i])
        hand.updateWorldMatrix(true,true)
        for(let i=0;i<3;i++) {
          const local=worldBend.clone().applyQuaternion(chain[i].getWorldQuaternion(new T.Quaternion()).invert())
          chain[i].quaternion.multiply(new T.Quaternion().setFromAxisAngle(local,angles[i])).normalize()
          chain[i].updateWorldMatrix(false,true)
        }
      }
      function score(angles) {
        apply(angles)
        const points=chain.map(point),tip=points[3],delta=tip.clone().sub(desired)
        let cost=delta.lengthSq()*3
        for(let i=0;i<3;i++)for(let j=0;j<=4;j++) {
          const d=points[i].clone().lerp(points[i+1],j/4).sub(center)
          d.addScaledVector(axis,-d.dot(axis));const r=d.length()
          cost+=Math.max(0,radius-r)**2*18
        }
        // Keep a smooth C shape and avoid a reversed distal knuckle.
        cost+=angles.reduce((s,a)=>s+Math.max(0,a-1.65)**2*.001,0)
        return cost
      }
      let angles=[.7,1.1,.6],best=score(angles)
      for(const step of [.4,.2,.1,.05,.025])for(let pass=0;pass<5;pass++) {
        let changed=false
        for(let joint=0;joint<3;joint++)for(const direction of [-1,1]) {
          const next=[...angles];next[joint]=T.MathUtils.clamp(next[joint]+step*direction,0,1.8)
          const value=score(next)
          if(value<best){angles=next;best=value;changed=true}
        }
        if(!changed)break
      }
      apply(angles)
      for(let i=0;i<3;i++)corrections[chain[i].name]=rest[i].clone().invert().multiply(chain[i].quaternion).normalize()
      diagnostics.push({side,digit,flexionRadians:angles,tipToTargetM:point(chain[3]).distanceTo(desired),shaftBoneRadiusM:radius})
      for(let i=0;i<4;i++)chain[i].quaternion.copy(rest[i])
      hand.updateWorldMatrix(true,true)
    }
  }
  for(const[o,q]of saved)o.quaternion.copy(q)
  scene.updateMatrixWorld(true)
  return {corrections,diagnostics}
}
