import fs from 'node:fs'
import { chromium } from 'playwright'
const output = 'output/playwright/sword-bow-regression'
fs.mkdirSync(output, {recursive:true})
const browser = await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[],results=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock')
 await page.waitForFunction(()=>!!window.game,undefined,{timeout:90000})
 for(const faction of ['roman','viking']) for(const state of ['bowLoad','bowHold','bowRelease']) for(const lod of [0,1,2]) {
  results.push(await page.evaluate(async ({faction,state,lod})=>{
   const T=await import('/node_modules/.vite/deps/three.js'),g=window.game
   g.humanoidStudioPaused=true
   const [instance,p]=[...g.humanoidStudioPlayback].find(([,p])=>p.faction===faction&&p.state===state)
   for(const child of g.scene.children) if(!child.isLight) child.visible=child===instance.root
   p.sampleBowComparison(state==='bowRelease'?.1:.5,'gameplay','walk')
   const levels=instance.root.children.find(o=>o.isLOD);levels.autoUpdate=false;levels.levels.forEach(({object},i)=>object.visible=i===lod)
   const c=instance.root.position.clone().add(new T.Vector3(0,1.25,0));g.camera.position.copy(c).add(new T.Vector3(1.7,.5,3));g.camera.fov=40;g.camera.updateProjectionMatrix();g.studioControls.enableDamping=false;g.studioControls.target.copy(c);g.studioControls.update()
   for(const el of document.body.children)if(el.id!=='canvas-container'&&el.tagName!=='SCRIPT')el.style.display='none'
   const shapes=[];instance.root.traverse(o=>{if(o.isSkinnedMesh&&o.morphTargetDictionary?.swordHand!==undefined)shapes.push(o.morphTargetInfluences[o.morphTargetDictionary.swordHand])})
   g.renderer.render(g.scene,g.camera)
   return {faction,state,lod,swordShapes:shapes}
  },{faction,state,lod}))
  await page.screenshot({path:`${output}/${faction}-${state}-lod${lod}-full.png`});console.log(faction,state,lod)
 }
 fs.writeFileSync(`${output}/measurements.json`,JSON.stringify({errors,results},null,2))
 if(errors.length||results.some(r=>r.swordShapes.some(x=>x!==0)))throw Error('Bow 回歸失敗')
}finally{await browser.close()}
