import fs from 'node:fs'
import { chromium } from 'playwright'
const output='output/playwright/sword-npc';fs.mkdirSync(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  const army=()=>({infantry:{1:0,2:1,3:0},archer:{1:0,2:0,3:0},cavalry:{1:0,2:0,3:0},horseArcher:{1:0,2:0,3:0}})
  sessionStorage.setItem('sagaburst_battle_config',JSON.stringify({viking:army(),roman:army(),rules:{respawnEnabled:false,includeCamps:false}}))
 })
 await page.goto('http://127.0.0.1:5173/?nolock');await page.waitForFunction(()=>!!window.game,undefined,{timeout:90000})
 await page.evaluate(()=>{window.game._loop=()=>{}});await page.waitForTimeout(100)
 const measurements=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),g=window.game,rows=[]
  for(const npc of g.npcs){
   const faction=npc.faction==='PLAYER'?'viking':'roman'
   const manifest=await(await fetch(`/models/characters/v2/${faction}/manifest.json`)).json()
   let levels;npc.group.traverse(o=>{if(o.isLOD)levels=o})
   const initial=npc.swordPivot.matrix.clone()
   for(const speed of [0,2,4,2,0]){
    npc.animator.setLocomotion(speed)
    for(let frame=0;frame<30;frame++){
     npc.animator.update(1/60);npc.group.updateMatrixWorld(true);npc.swordPivot.updateMatrix()
     if(!npc.swordPivot.matrix.equals(initial))throw Error('NPC attachment changed')
     for(const lod of [0,1,2]){
      const hand=levels.levels[lod].object.getObjectByName('hand_r'),palm=hand.localToWorld(new T.Vector3(...manifest.swordGripFrames[`lod${lod}`].gripCenterLocal))
      rows.push({faction,lod,speed,frame,error:npc.getWeaponGripPosition(new T.Vector3()).distanceTo(palm)})
     }
    }
   }
   npc.animator.cancel();npc.rig.animation.setSwordHandShape(true)
  }
  return rows
 })
 for(const faction of ['roman','viking'])for(const state of ['idle','walk','run','swordSlash'])for(const view of ['full','top']){
  const png=await page.evaluate(async({faction,state,view})=>{
   const T=await import('/node_modules/.vite/deps/three.js'),g=window.game,n=g.npcs.find(n=>(n.faction==='PLAYER'?'viking':'roman')===faction)
   for(const npc of g.npcs)npc.group.visible=npc===n
   g.player.group.visible=false
   n.rig.animation.stop();n.rig.animation.play(state,{fadeSeconds:0,loop:false});n.rig.animation.update(.000001);n.rig.animation.seek(state,state==='swordSlash'?.525:.25)
   const c=n.group.position.clone().add(new T.Vector3(0,1,0));g.camera.position.copy(c).add(view==='top'?new T.Vector3(0,5,3):new T.Vector3(2.8,1.2,4))
   g.camera.fov=view==='top'?58:32;g.camera.updateProjectionMatrix();g.camera.lookAt(c);g.renderer.render(g.scene,g.camera)
   return g.renderer.domElement.toDataURL('image/png').split(',')[1]
  },{faction,state,view})
  fs.writeFileSync(`${output}/${faction}-${state}-${view}.png`,Buffer.from(png,'base64'));console.log(faction,state,view)
 }
 const timing=await page.evaluate(()=>{
  const g=window.game,rows=[]
  for(const n of g.npcs)for(const step of [1/120,1/60,.252,.48,.8]){
   n.animator.cancel();n.state='ATTACK';n.attackTimer=0;n.arrows=0
   // Isolate the timeline from target AI/movement; use an in-range dummy.
   n._findTarget=()=>({position:n.combatPosition.clone().add({x:0,y:0,z:1}),isDead:false,isPlayer:true})
   let hits=0,elapsed=0
   while(elapsed<.48-1e-10){n.update(step,g.player,g.npcs,[],[],g.playerHpBar,()=>hits++,()=>{},true);elapsed+=step}
   rows.push({faction:n.faction,step,hits,completed:!n.animator.busy,gap:n.attackTimer})
   if(hits!==1||n.animator.busy||Math.abs(n.attackTimer-.35)>1e-8)throw Error('NPC hit/completion/gap failed')
  }
  return rows
 })
 fs.writeFileSync(`${output}/measurements.json`,JSON.stringify({errors,measurements,timing},null,2))
 if(errors.length||measurements.some(r=>r.error>.005))throw Error('NPC LOD/transition failed')
}finally{await browser.close()}
