import fs from 'node:fs'
import { chromium } from 'playwright'
const output='output/playwright/equipment-scenes';fs.mkdirSync(output,{recursive:true})
const browser=await chromium.launch({headless:true}),reports=[]
try {
 for(const mode of ['mounts','release','stress']){
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[],warnings=[]
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text())})
  if(mode==='release')await page.addInitScript(()=>{
   const army=(melee,ranged)=>({infantry:{1:0,2:melee,3:0},archer:{1:0,2:ranged,3:0},cavalry:{1:0,2:0,3:0},horseArcher:{1:0,2:0,3:0}})
   sessionStorage.setItem('sagaburst_battle_config',JSON.stringify({viking:army(5,4),roman:army(3,2),rules:{respawnEnabled:false,includeCamps:false}}))
  })
  const url=`http://127.0.0.1:5173/?${mode==='mounts'?'devmodels=mounts&':mode==='stress'?'devcombat&':''}nolock`
  await page.goto(url);await page.waitForFunction(()=>!!window.game,undefined,{timeout:180000})
  const samples=[]
  for(let i=0;i<3;i++)samples.push(await page.evaluate(async()=>{
   const start=performance.now();let frames=0
   await new Promise(resolve=>{function sample(){frames++;if(performance.now()-start>=3000)resolve();else requestAnimationFrame(sample)}requestAnimationFrame(sample)})
   const g=window.game,info=g.renderer.info
   return {fps:frames*1000/(performance.now()-start),calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,npcs:g.npcs.length,shields:g.npcs.filter(n=>n.shieldId).length,mounts:g.mounts.length}
  }))
  await page.screenshot({path:`${output}/${mode}-scene.png`})
  let actions=[]
  if(mode==='mounts'){
   await page.evaluate(()=>{window.game._loop=()=>{}});await page.waitForTimeout(100)
   for(const shield of [false,true])for(const clip of ['idle','walk','gallop'])for(const attack of [false,true])for(const phase of [0,.25,.75]){
    const result=await page.evaluate(async({shield,clip,attack,phase})=>{
     const T=await import('/node_modules/.vite/deps/three.js'),g=window.game,m=g.mountStudioHorse,r=g.mountStudioRider,p=g.humanoidStudioPlayback.get(r)
     m.playStudioClip(clip);m.horseVisual.update(phase,0);g._updateMountStudioStatus();p.setEquipmentLoadout('lance',shield);p.sampleEquipment(attack?.38/.7:0,true,'idle',attack)
     const seat=m.getSaddleSeatWorld(new T.Vector3()),pelvis=r.rig.pelvis.getWorldPosition(new T.Vector3())
     const c=m.group.position.clone().add(new T.Vector3(0,1.5,.3));g.studioControls.target.copy(c);g.studioControls.enableDamping=false;g.camera.position.copy(c).add(new T.Vector3(-4,.8,4));g.studioControls.update();g.renderer.render(g.scene,g.camera)
     return {shield,clip,attack,phase,seatGap:pelvis.distanceTo(seat),horse:m.getHorseDebugState(),png:g.renderer.domElement.toDataURL('image/png').split(',')[1]}
    },{shield,clip,attack,phase})
    fs.writeFileSync(`${output}/horse-${clip}-${shield?'shield':'support'}-${attack?'peak':'ready'}-${phase}.png`,Buffer.from(result.png,'base64'));delete result.png;actions.push(result)
   }
  }
  if(mode==='release'){
   await page.evaluate(()=>{const g=window.game;g.equipmentUI.open(g.skillManager,g.inventoryManager)})
   await page.getByRole('button',{name:'卸下盾牌',exact:true}).click()
   const unloaded=await page.evaluate(()=>window.game.inventoryManager.equippedShield===null)
   if(!unloaded)throw Error('卸盾按鈕未更新 inventory')
   await page.screenshot({path:`${output}/unequip-shield-ui.png`})
   actions.push({unloaded})
  }
  reports.push({mode,url,samples,actions,errors,warnings});fs.writeFileSync(`${output}/measurements.json`,JSON.stringify(reports,null,2))
  console.log(mode,JSON.stringify(samples),errors)
  await page.close()
 }
 if(reports.some(r=>r.errors.some(e=>!e.includes('favicon'))))process.exitCode=1
}finally{await browser.close()}
