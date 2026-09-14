import fs from 'node:fs'
import {chromium} from 'playwright'
const output='output/playwright/sword-attack-timeline';fs.mkdirSync(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:900,height:750}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5173/?devmodels=humans&nolock');await page.waitForFunction(()=>!!window.game,undefined,{timeout:90000})
 const probe=fs.readFileSync('tools/sword-browser-probe.js','utf8');await page.evaluate(`(${probe.slice(probe.indexOf('async ()'))})()`)
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),g=window.game,images=[],rows=[]
  for(const faction of ['roman','viking'])for(const view of ['full','top']){
   window.swordProbe(faction,'swordSlash',0,0,view)
   const [instance,p]=[...g.humanoidStudioPlayback].find(([,p])=>p.faction===faction&&p.state==='swordSlash')
   p.reset();p.animator.setLocomotion(2);for(let i=0;i<30;i++)p.animator.update(1/60)
   p.animator.start('swordSlash');let elapsed=0,hits=0,completed=0
   const matrix=p.sword.matrix.clone(),hand=instance.rig.right.wrist
   for(const time of [0,.1,.2,.252,.32,.4,.48,.54,.60,.70]){
    while(elapsed<time-1e-10){const dt=Math.min(1/120,time-elapsed);p.animator.setLocomotion(elapsed>=.3?4:2);const e=p.animator.update(dt);hits+=Number(e.hitActiveStarted);completed+=Number(e.actionCompleted);elapsed+=dt}
    instance.root.updateMatrixWorld(true);p.sword.updateMatrix();if(!p.sword.matrix.equals(matrix))throw Error('Attack changed attachment')
    const model=p.sword.children[0],grip=model.localToWorld(new T.Vector3(...model.userData.gripCenterLocal)),palm=hand.localToWorld(new T.Vector3(...instance.rig.swordGripFrame.gripCenterLocal))
    const tip=instance.root.worldToLocal(model.localToWorld(new T.Vector3(0,faction==='roman'?.88:1.42,0)))
    g.renderer.render(g.scene,g.camera)
    const name=`${faction}-${time.toFixed(3)}-${view}.png`
    images.push({name,data:g.renderer.domElement.toDataURL('image/png').split(',')[1]})
    rows.push({faction,view,time,hits,completed,clip:instance.rig.animation.current,gripErrorM:grip.distanceTo(palm),tip:tip.toArray()})
   }
   if(hits!==1||completed!==1||instance.rig.animation.current!=='run')throw Error('Attack timeline/return state failed')
  }
  return {images,rows}
 })
 for(const {name,data}of result.images)fs.writeFileSync(`${output}/${name}`,Buffer.from(data,'base64'))
 fs.writeFileSync(`${output}/measurements.json`,JSON.stringify({errors,rows:result.rows},null,2))
 if(errors.length)throw Error(errors.join('\n'))
 console.log(JSON.stringify({frames:result.images.length,maxGripError:Math.max(...result.rows.map(r=>r.gripErrorM)),errors}))
}finally{await browser.close()}
