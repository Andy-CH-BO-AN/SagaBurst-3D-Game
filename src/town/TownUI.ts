import * as THREE from 'three'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import { WEAPONS } from '../rpg/WeaponDatabase'

export function installTownStyles(): void {
  if (document.getElementById('town-styles')) return
  const style = document.createElement('style'); style.id = 'town-styles'
  style.textContent = `
    .town-panel { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(680px,calc(100vw - 48px)); box-sizing:border-box; max-height:85vh; overflow:auto; z-index:1000; padding:26px 30px; color:#f1e4cb; background:linear-gradient(125deg,#30291f,#181b1b); border:1px solid #95784f; border-top:4px solid #ba995e; border-radius:8px; box-shadow:0 24px 100px #000c; font:15px/1.65 system-ui }
    .town-mission-tabs { display:flex; gap:10px; margin:12px 0 18px; position:sticky; top:-26px; background:#25231f; padding:10px 0; z-index:1 }
    .town-mission-tabs .town-button { flex:1; margin:0 }
    .town-mission-tabs [aria-pressed="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-panel h2 { margin:5px 0 16px; font:700 27px/1.3 Georgia,serif; color:#ffe5af }
    .town-panel p { margin:12px 0; white-space:pre-line }
    .town-eyebrow { font:11px/1.5 Georgia,serif; letter-spacing:.2em; color:#bb9e71 }
    .town-button { color:#ecd8ad; background:#453723; border:1px solid #947448; border-radius:4px; padding:9px 15px; margin:8px 9px 0 0; font:600 14px system-ui; cursor:pointer }
    .town-button:hover,.town-button:focus-visible { background:#665033; border-color:#eac683; outline:2px solid #be9a58; outline-offset:2px }
    .town-button:disabled { opacity:.5; cursor:default }
    .town-products > h3 { grid-column:1 / -1; margin:12px 0 0; color:#ffe5af; font-size:17px }
    .town-summary { background:#0b101344; border-left:3px solid #b3945e; padding:10px 14px; color:#c4b69e; font-size:13px }
    .town-products { display:grid; grid-template-columns:repeat(auto-fit,minmax(235px,1fr)); gap:10px; margin-top:16px }
    .town-product { border:1px solid #77654866; border-radius:5px; padding:12px; background:#0002; display:flex; flex-direction:column; align-items:flex-start }
    .town-product strong { font-size:14px; color:#ead7b2 } .town-product small { color:#b7a78c; margin-top:4px }
    .town-ambient { position:fixed; transform:translate(-50%,-100%); max-width:280px; z-index:95; background:#201d18e8; color:#ffe6b5; padding:8px 12px; border:1px solid #967950; border-radius:5px; font:14px/1.4 system-ui; pointer-events:none }
    #career-mission-guide { position:fixed; left:50%; bottom:155px; transform:translateX(-50%); z-index:94; pointer-events:none; text-align:center; color:#fff1c6; text-shadow:0 2px 5px #000; font:600 15px/1.4 system-ui }
    .mission-guide-arrow { width:42px; height:42px; margin:0 auto 4px; color:#f4d287; font:40px/42px system-ui; opacity:.58; transform-origin:center; transition:transform .12s linear,opacity .2s }
    .mission-guide-label { padding:5px 10px; border-radius:4px; background:#15120ea8; border:1px solid #b6955e66 }
    #career-entry { position:fixed; inset:0; overflow:auto; z-index:1000; padding:clamp(20px,5vh,60px) clamp(20px,6vw,100px); box-sizing:border-box; background:radial-gradient(ellipse at 30% 0,#473a28,#171b1f 65%); color:#ead8b8; font:16px/1.6 system-ui }
    #career-entry h1 { margin:5px 0; font:700 34px Georgia,serif } #career-entry select { padding:10px 16px; color:#ead8b8; background:#332d24; border:1px solid #92754e; border-radius:4px; font-size:16px }
    .town-starters { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin:22px 0 }
    .town-starter { text-align:left; border:1px solid #796142; background:linear-gradient(#393328,#222526); color:#eee0c5; border-radius:8px; padding:16px; cursor:pointer; font:14px/1.5 system-ui; display:flex; flex-direction:column }
    .town-starter:hover,.town-starter:focus-visible { border-color:#f2cd8b; outline:2px solid #a9874f; transform:translateY(-2px) }
    .town-starter img { width:100%; height:150px; object-fit:contain; display:block; background:radial-gradient(#5a4b3377,transparent); margin-bottom:12px }
    .town-starter strong { display:block; font-size:17px; min-height:50px } .town-starter p { margin:8px 0; color:#c6b698 }
    .town-starter dl { width:100%; margin-top:auto; display:grid; grid-template-columns:1fr 1fr; margin:12px 0 0; padding-top:10px; border-top:1px solid #8f764455; gap:6px } .town-starter dd { margin:0; text-align:right; color:#f4d191 }
  `
  document.head.append(style)
}

/** Small previews of the same procedural models used in-game; no external art or guessed stats. */
export function starterThumbnails(ids: readonly string[]): Map<string, string> {
  const result = new Map<string, string>(), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(300, 220); renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc3bbaa, 4)); const light = new THREE.DirectionalLight(0xffe6bc, 3); light.position.set(3, 4, 5); scene.add(light)
  try {
    for (const id of ids) {
      const root = new THREE.Group()
      if (WEAPONS[id].combatKind === 'javelin') WeaponMeshFactory.buildNpcRanged('roman', WEAPONS[id].tier, root)
      else if (WEAPONS[id].type === 'ranged') WeaponMeshFactory.buildRanged(id, root, true)
      else WeaponMeshFactory.buildMelee(id, root)
      root.rotation.z = -.5; root.rotation.y = .3; scene.add(root); root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      const half = Math.max(size.y, size.x / (300 / 220)) * .6
      camera.left = -half * 300 / 220; camera.right = -camera.left; camera.top = half; camera.bottom = -half
      camera.position.copy(center).add(new THREE.Vector3(0, 0, 12)); camera.lookAt(center); camera.updateProjectionMatrix()
      renderer.render(scene, camera); result.set(id, renderer.domElement.toDataURL('image/png'))
      root.removeFromParent(); root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    }
  } finally { renderer.dispose(); renderer.forceContextLoss() }
  return result
}
