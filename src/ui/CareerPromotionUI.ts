import * as THREE from 'three'
import { enlistmentMerit, type CareerProfile } from '../career/CareerProfile'
import { canAppointByzantine } from '../career/CareerElitePromotion'
import { canAppointCareerRank } from '../career/CareerPromotionAuthority'
import { HERO_ASSETS, type HeroAssetId } from '../world/HeroAssetCatalog'
import { HumanoidAssetRegistry, disposeHumanoidInstanceSkeletons } from '../world/HumanoidAssetRegistry'

export const ROMAN_PROMOTION_WARNING = `你目前符合 T5 羅馬指揮官的任命資格。

請注意：未來如果想改轉「拜占庭鐵甲重騎兵」，仍需要本次入伍累積達到 30,000 軍功。

例如現在擁有 20,000 累積軍功，之後再累積 10,000 即可申請拜占庭轉職。

你也可以暫不晉升，等累積達到 30,000 軍功後直接選擇拜占庭。

轉職不會扣除軍功。`

/** Small, independent portrait; borrows registry resources and owns only its instance skeletons. */
function portrait(parent: HTMLElement, heroId: HeroAssetId): () => void {
  let stopped = false, raf = 0, renderer: THREE.WebGLRenderer | undefined
  let root: THREE.Group | undefined
  let animation: ReturnType<typeof HumanoidAssetRegistry.createCharacterVisual>['rig']['animation']
  const status = document.createElement('p'); status.textContent = '正在準備模型預覽…'; parent.append(status)
  void HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[heroId].descriptor).then(() => {
    if (stopped) return
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(240, 200)
      renderer.domElement.style.cssText = 'width:100%;height:200px;object-fit:contain;touch-action:none;cursor:grab'
      renderer.domElement.setAttribute('aria-label', '拖曳旋轉角色，查看正面與背面')
      parent.append(renderer.domElement)
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1.2, .1, 20)
      camera.position.set(0, 1, 4); camera.lookAt(0, 1, 0)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2))
      const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 4, 3); scene.add(light)
      root = new THREE.Group(); scene.add(root)
      animation = HumanoidAssetRegistry.createCharacterVisual(root, { faction: 'roman', tier: 3, isPlayer: true }, heroId).rig.animation
      animation?.play('idle', { loop: true })
      let x: number | undefined
      renderer.domElement.onpointerdown = event => { x = event.clientX; renderer!.domElement.setPointerCapture(event.pointerId) }
      renderer.domElement.onpointermove = event => { if (x !== undefined && root) { root.rotation.y += (event.clientX - x) * .015; x = event.clientX } }
      renderer.domElement.onpointerup = renderer.domElement.onpointercancel = () => { x = undefined }
      status.textContent = heroId === 'byzantine-cataphract-t5' ? '專屬外觀待加入 · 暫用羅馬 T5 外觀 · 拖曳旋轉' : '拖曳旋轉角色'
      let previous = performance.now()
      const frame = (now: number) => {
        if (stopped) return
        animation?.update(Math.min(.05, (now - previous) / 1000)); previous = now
        renderer!.render(scene, camera); raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    } catch {
      status.textContent = '模型預覽載入失敗；仍可閱讀職業資料及操作任命。'
      renderer?.dispose(); renderer?.domElement.remove()
    }
  }).catch(() => { if (!stopped) status.textContent = '模型預覽載入失敗；仍可閱讀職業資料及操作任命。' })
  return () => { stopped = true; cancelAnimationFrame(raf); animation?.stop(); if (root) disposeHumanoidInstanceSkeletons(root); renderer?.dispose(); renderer?.domElement.remove() }
}

export function appendCareerPromotionCards(parent: HTMLElement, read: () => CareerProfile, choose: (elite: boolean) => void): () => void {
  const p = read(), merit = enlistmentMerit(p)
  const container = document.createElement('div')
  container.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;max-width:760px'
  parent.append(container)
  const cleanups: Array<() => void> = []
  for (const elite of [false, true]) {
    const required = elite ? 30000 : 20000
    const card = document.createElement('article'); card.style.cssText = 'border:1px solid #b69557;border-radius:12px;padding:14px;min-width:0;background:#171d28'
    container.append(card)
    const title = document.createElement('h3'); title.textContent = elite ? '拜占庭鐵甲重騎兵 · T5+' : 'Roman Commander · T5'; card.append(title)
    cleanups.push(portrait(card, elite ? 'byzantine-cataphract-t5' : 'roman-hero-t5'))
    const progress = document.createElement('progress'); progress.max = required; progress.value = merit; progress.style.width = '100%'; card.append(progress)
    const text = document.createElement('p'); text.style.whiteSpace = 'pre-line'
    text.textContent = `${merit.toLocaleString()} / ${required.toLocaleString()} 軍功\n${merit >= required ? '已達軍功門檻' : `尚差 ${(required - merit).toLocaleString()} 軍功`}\n` + (elite
      ? 'HP 1000 · Damage ×3.0\nDamage Taken ×0.40\nAttack Speed ×1.30 · Move Speed ×1.00\n軍旗槍與鷹盾另行購買。'
      : 'HP 850 · Damage ×2.2\nDamage Taken ×0.50\nAttack Speed ×1.15')
    card.append(text)
    const button = document.createElement('button'); button.className = 'town-button'
    button.textContent = elite ? p.eliteClass ? '已接受帝國精英任命' : '接受帝國精英任命' : p.rank === 'commander' ? '已任命 Commander' : '接受指揮官任命'
    button.disabled = elite ? !canAppointByzantine(p) : !canAppointCareerRank(p, 'commander')
    button.onclick = () => choose(elite); card.append(button)
  }
  return () => { for (const cleanup of cleanups) cleanup() }
}
