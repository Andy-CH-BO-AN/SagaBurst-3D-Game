import * as T from 'three'
const digits=['thumb','index','middle','ring','pinky']
const position=o=>o.getWorldPosition(new T.Vector3())
const rotation=o=>o.getWorldQuaternion(new T.Quaternion())
export const fingerPattern=/^(thumb|index|middle|ring|pinky)_0[123]_[lr]$/

/** Offline absolute target-bind poses. Never multiply a grasp onto a donor's
 * already curled animation. The handle solver owns fingers, never the wrist. */
export function buildAnatomicalFingerPoses(rig, frames, tips={}) {
  const saved=[];rig.scene.traverse(o=>saved.push([o,o.quaternion.clone()]));rig.scene.updateMatrixWorld(true)
  const relaxed={},grip={},draw={},diagnostics=[]
  for(const side of ['l','r']) {
    const hand=rig.scene.getObjectByName(`hand_${side}`),frame=frames[side]
    const local=o=>hand.worldToLocal(position(o))
    const base=d=>local(rig.scene.getObjectByName(`${d}_01_${side}`))
    const across=base('index').sub(base('pinky')).normalize(),along=base('middle').normalize()
    const normal=across.clone().cross(along).normalize()
    if(local(rig.scene.getObjectByName(`thumb_02_${side}`)).dot(normal)<0)normal.negate()
    const center=new T.Vector3(...frame.gripCenterLocal),shaft=new T.Vector3(...frame.gripAxisLocal).normalize(),radius=frame.gripRadius??.022
    const handQ=rotation(hand)
    for(const digit of digits) {
      const chain=[1,2,3].map(j=>rig.scene.getObjectByName(`${digit}_0${j}_${side}`)),rest=chain.map(b=>b.quaternion.clone())
      const terminal=rig.scene.getObjectByName(`${digit}_04_${side}`)
      const tip=tips[chain[2].name]?new T.Vector3(...tips[chain[2].name]):terminal?terminal.position.clone():chain[2].position.clone().multiplyScalar(.75)
      const hinge=chain.map((b,i)=>{
        const next=i<2?position(chain[i+1]):chain[2].localToWorld(tip.clone())
        return next.sub(position(b)).normalize().cross(normal.clone().applyQuaternion(handQ)).normalize().applyQuaternion(rotation(b).invert())
      })
      const opposition=normal.clone().applyQuaternion(handQ).applyQuaternion(rotation(chain[0]).invert())
      const apply=angles=>{
        for(let i=0;i<3;i++)chain[i].quaternion.copy(rest[i]).multiply(new T.Quaternion().setFromAxisAngle(hinge[i],angles[i])).normalize()
        if(digit==='thumb')chain[0].quaternion.multiply(new T.Quaternion().setFromAxisAngle(opposition,angles[3]??0)).normalize()
        hand.updateWorldMatrix(true,true)
      }
      const record=(output,angles)=>{apply(angles);for(const b of chain)output[b.name]=b.quaternion.toArray()}
      const natural=digit==='thumb'?[.03,.06,.05]:[.08,.13,.08]
      record(relaxed,natural);record(draw,digit==='thumb'?natural:[.48,.9,.5])
      const station=base(digit).sub(center).dot(shaft)
      // The fingertip returns toward the palm AFTER passing the far side of
      // the shaft. Targeting its far side instead produces a straight MCP-only
      // hook, which is numerically close but visually not a power grip.
      const desired=center.clone().addScaledVector(shaft,station).addScaledVector(normal,-(radius+.007)*.7).addScaledVector(along,-(radius+.007)*.7)
      if(digit==='thumb')desired.copy(center).addScaledVector(shaft,base('index').sub(center).dot(shaft)).addScaledVector(normal,(radius+.008)*.8).addScaledVector(along,-(radius+.008)*.3)
      const maximum=digit==='thumb'?[1,1,1.25,.7]:[1.5,1.75,1.2]
      const score=angles=>{
        apply(angles);const points=chain.map(local);points.push(hand.worldToLocal(chain[2].localToWorld(tip.clone())))
        let cost=points[3].distanceToSquared(desired)*4
        for(let i=0;i<3;i++)for(let j=1;j<=4;j++){
          const d=points[i].clone().lerp(points[i+1],j/4).sub(center);d.addScaledVector(shaft,-d.dot(shaft))
          cost+=Math.max(0,radius+.004-d.length())**2*20
        }
        // Tendon coupling and a modest flexion preference prevent distal-only
        // hooks and keep PIP/DIP coordinated instead of reversed knuckles.
        cost+=(angles[2]-.65*angles[1])**2*.0003
        if(digit!=='thumb')cost+=Math.max(0,.5-angles[1])**2*.002
        cost+=angles.reduce((s,a)=>s+a*a*.00001,0)
        return cost
      }
      let best=Infinity,angles=natural
      for(const seed of (digit==='thumb'?[[.2,.4,.3,0],[.4,.6,.4,.5],[.4,.6,.4,-.5]]:[[.4,.8,.5],[1.2,1.1,.7],[.7,1.4,.8]])) {
        let a=seed.map((v,i)=>Math.min(v,maximum[i])),value=score(a)
        for(const step of [.3,.15,.075,.025])for(let pass=0;pass<5;pass++){
          let changed=false
          for(let i=0;i<a.length;i++)for(const direction of [-1,1]){
            const next=[...a];next[i]=T.MathUtils.clamp(next[i]+step*direction,i===3?-.7:0,maximum[i]);const candidate=score(next)
            if(candidate<value){a=next;value=candidate;changed=true}
          }
          if(!changed)break
        }
        if(value<best){best=value;angles=a}
      }
      record(grip,angles)
      diagnostics.push({side,digit,flexionRadians:angles,tipToTargetM:hand.worldToLocal(chain[2].localToWorld(tip.clone())).distanceTo(desired)})
      for(let i=0;i<3;i++)chain[i].quaternion.copy(rest[i]);hand.updateWorldMatrix(true,true)
    }
  }
  for(const [o,q]of saved)o.quaternion.copy(q);rig.scene.updateMatrixWorld(true)
  return {relaxed,grip,draw,diagnostics}
}

/** Only finger rotation samples change; original action/event clocks survive. */
export function bakeAnatomicalFingerClips(rig, poses, bindings) {
  return rig.animations.map(clip=>{
    const tracks=clip.tracks.filter(t=>!fingerPattern.test(t.name.split('.')[0]))
    const binding=bindings.find(b=>b.clip===clip.name),bow=/^bow/.test(clip.name)
    const times=[...new Set([0,clip.duration,...Object.values(binding?.events??{}),...Array.from({length:Math.ceil(clip.duration*30)+1},(_,i)=>Math.min(i/30,clip.duration))].map(Math.fround))].sort((a,b)=>a-b)
    for(const name of Object.keys(poses.relaxed)){
      const side=name.at(-1),values=[]
      for(const time of times){
        let contact=bow?(side==='l'?'grip':'draw'):/axe|swordSlash|daggerSlash|greatswordSlash|lance|pilum/i.test(clip.name)&&(side==='r'||/2H/.test(clip.name))?'grip':'relaxed'
        const q=new T.Quaternion().fromArray(poses[contact][name])
        if(side==='r'&&/bowRelease|pilumThrow/.test(clip.name)){
          const release=binding?.events?.projectileRelease??clip.duration*.4,weight=T.MathUtils.smoothstep(time,release,Math.min(clip.duration,release+.12))
          q.slerp(new T.Quaternion().fromArray(poses.relaxed[name]),weight)
        }
        values.push(...q.toArray())
      }
      tracks.push(new T.QuaternionKeyframeTrack(`${name}.quaternion`,times,values).optimize())
    }
    return new T.AnimationClip(clip.name,clip.duration,tracks)
  })
}
