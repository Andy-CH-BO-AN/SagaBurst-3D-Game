import fs from 'node:fs'
import {createHash} from 'node:crypto'
import * as T from 'three'
import {readGlb,loadRig} from './humanoid-glb.mjs'
import {decodeMeshoptGlb} from './meshopt-glb.mjs'

function convexSection(points) {
 const sorted=[...new Map(points.map(p=>[`${p.x.toFixed(7)},${p.z.toFixed(7)}`,[p.x,p.z]])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1])
 const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[]
 for(const p of sorted){while(lower.length>1&&turn(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
 for(const p of [...sorted].reverse()){while(upper.length>1&&turn(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
 return [...lower.slice(0,-1),...upper.slice(0,-1)]
}

/** Distance to the real convex handle section; a round proxy misses the
 * corners of the Silver Oathblade's flattened, asymmetric grip. */
export function gripSurfaceDistance(point,surface,shaft) {
 const dx=point.x-surface.attachmentCenterLocal[0],dy=point.y-surface.attachmentCenterLocal[1],dz=point.z-surface.attachmentCenterLocal[2]
 const x=dx*surface.basisX[0]+dy*surface.basisX[1]+dz*surface.basisX[2],z=dx*surface.basisZ[0]+dy*surface.basisZ[1]+dz*surface.basisZ[2],y=surface.sectionY+dx*shaft.x+dy*shaft.y+dz*shaft.z
 const sections=surface.sections;let best=sections[0]
 for(const s of sections)if(Math.abs(s.y-y)<Math.abs(best.y-y))best=s
 let inside=true,distance=Infinity
 for(let i=0;i<best.outline.length;i++){const a=best.outline[i],b=best.outline[(i+1)%best.outline.length],ex=b[0]-a[0],ez=b[1]-a[1],px=x-a[0],pz=z-a[1],t=T.MathUtils.clamp((px*ex+pz*ez)/(ex*ex+ez*ez),0,1)
  if(ex*pz-ez*px<0)inside=false
  distance=Math.min(distance,Math.hypot(px-ex*t,pz-ez*t))
 }
 return inside?-distance:distance
}

/** Rebuilt hands use their measured MCP plane as the grasp station. This is
 * a hand-contact frame, not a replacement weapon attachment: runtime moves the
 * arm to it and counter-transforms the existing equipment socket. */
export function anatomicalSwordContact(rig,frame,measured) {
 rig.scene.updateMatrixWorld(true)
 const hand=rig.scene.getObjectByName('hand_r'),point=o=>hand.worldToLocal(o.getWorldPosition(new T.Vector3())),base=d=>point(rig.scene.getObjectByName(`${d}_01_r`))
 const across=base('index').sub(base('pinky')).normalize(),along=base('middle').normalize();along.addScaledVector(across,-along.dot(across)).normalize()
 const normal=across.clone().cross(along).normalize();if(point(rig.scene.getObjectByName('thumb_02_r')).dot(normal)<0)normal.negate()
 const mcp=['index','middle','ring','pinky'].reduce((p,d)=>p.addScaledVector(base(d),.25),new T.Vector3())
 const length=Math.max(...['index','middle','ring','pinky'].map(d=>{const b=rig.scene.getObjectByName(`${d}_03_r`);return point(b).length()+b.position.length()*.75}))
 const pad=length*.05,radius=measured.gripRadius,actual=new T.Vector3(...measured.gripCenterLocal)
 const offset=along.clone().multiplyScalar(mcp.dot(along)+radius*.6-actual.dot(along)).addScaledVector(normal,mcp.dot(normal)+radius+pad-actual.dot(normal))
 return {gripCenterLocal:new T.Vector3(...frame.gripCenterLocal).add(offset).toArray(),offsetM:offset.toArray(),skinPadM:pad,method:'MCP plane and measured handle surface; weapon world transform retained by runtime socket compensation'}
}

/** The palm/web is not a finger capsule. Check its actual posed surface before
 * accepting a grasp; otherwise a valid fingertip fit can slice the palm. */
export function swordPalmClearance(rig,frame) {
 rig.scene.updateMatrixWorld(true)
 const hand=rig.scene.getObjectByName('hand_r'),local=b=>hand.worldToLocal(b.getWorldPosition(new T.Vector3()))
 const across=local(rig.scene.getObjectByName('index_01_r')).sub(local(rig.scene.getObjectByName('pinky_01_r'))).normalize(),along=local(rig.scene.getObjectByName('middle_01_r')).normalize(),normal=across.clone().cross(along).normalize()
 if(local(rig.scene.getObjectByName('thumb_02_r')).dot(normal)<0)normal.negate()
 const points=[],shaft=new T.Vector3(...frame.gripAxisLocal).normalize(),surface=frame.sourceSurface
 rig.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh||!mesh.visible)return;mesh.skeleton.update();const g=mesh.geometry,used=new Set(g.index.array)
  for(const i of used){let palm=0;for(let k=0;k<4;k++)if(mesh.skeleton.bones[g.attributes.skinIndex.getComponent(i,k)].name==='hand_r')palm+=g.attributes.skinWeight.getComponent(i,k)
   if(palm<.35)continue;const p=hand.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i,new T.Vector3()))),station=surface.sectionY+p.clone().sub(new T.Vector3(...surface.attachmentCenterLocal)).dot(shaft)
   if(station>=surface.sections[0].y&&station<=surface.sections.at(-1).y)points.push(p)
  }
 })
 if(!points.length)throw Error('No palm/web skin samples at the measured sword grip')
 for(let distance=0;distance<=.0301;distance+=.0005){const offset=normal.clone().multiplyScalar(distance),shifted={...surface,attachmentCenterLocal:new T.Vector3(...surface.attachmentCenterLocal).add(offset).toArray()},clearance=Math.min(...points.map(p=>gripSurfaceDistance(p,shifted,shaft)))
  if(clearance>=.0005)return {offsetM:offset.toArray(),minimumClearanceM:clearance,vertices:points.length}
 }
 throw Error('Sword palm/web surface has no collision-free grasp station within 30 mm')
}

/** Actual handle cut at the unchanged production grip station (+Y=.15 m).
 * Includes source child transforms and preserves the weapon attachment. */
export async function measureSwordGripTarget(file,frame) {
 const rig=await loadRig(await decodeMeshoptGlb(readGlb(file))),points=[],cut=.15,triangles=[]
 rig.scene.updateMatrixWorld(true)
 rig.scene.traverse(mesh=>{if(!mesh.isMesh)return;const g=mesh.geometry,index=g.index,count=index?.count??g.attributes.position.count
  for(let i=0;i<count;i+=3){const f=[0,1,2].map(j=>mesh.localToWorld(new T.Vector3().fromBufferAttribute(g.attributes.position,index?index.getX(i+j):i+j)));triangles.push(f)
   for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3],da=a.y-cut,db=b.y-cut;if(Math.abs(da)<1e-7)points.push(a.clone());if(da*db<0)points.push(a.clone().lerp(b,da/(da-db)))}
  }
 })
 if(points.length<8)throw Error(`No actual handle section: ${file}`)
 const box=new T.Box3().setFromPoints(points),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3())
 if(size.x>.12||size.z>.12||size.x<.004||size.z<.004)throw Error(`Invalid handle section: ${file}`)
 const y=new T.Vector3(...frame.gripAxisLocal).normalize(),z=new T.Vector3(...frame.palmNormalLocal).normalize().negate(),x=y.clone().cross(z).normalize();z.crossVectors(x,y).normalize()
 const measured=new T.Vector3(...frame.gripCenterLocal).addScaledVector(x,center.x).addScaledVector(z,center.z)
 const sections=[]
 for(let station=.05;station<=.2501;station+=.005){const samples=[]
  for(const f of triangles)for(let i=0;i<3;i++){const a=f[i],b=f[(i+1)%3],da=a.y-station,db=b.y-station;if(Math.abs(da)<1e-7)samples.push(a);if(da*db<0)samples.push(a.clone().lerp(b,da/(da-db)))}
  if(samples.length<8)continue;const bounds=new T.Box3().setFromPoints(samples),c=bounds.getCenter(new T.Vector3()),d=bounds.getSize(new T.Vector3());if(d.x>.12||d.z>.12||d.x<.004||d.z<.004)continue
  sections.push({y:station,x:c.x,z:c.z,radius:Math.max(d.x,d.z)/2,outline:convexSection(samples)})
 }
 return {...frame,gripCenterLocal:measured.toArray(),gripRadius:Math.max(size.x,size.z)/2,sourceSurface:{file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sectionY:cut,bounds:[box.min.toArray(),box.max.toArray()],attachmentCenterLocal:frame.gripCenterLocal,basisX:x.toArray(),basisZ:z.toArray(),sections,attachmentUnchanged:true}}
}
