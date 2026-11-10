import * as THREE from 'three'
import { enlistmentMerit, type CareerProfile } from '../career/CareerProfile'
import { T5_CLASS_ROAD, classRoadOffer, type CareerClassId, type CareerClassOffer, type CareerClassRoad } from '../career/CareerElitePromotion'
import { isT4ClassId, T4_CLASS_ROAD, type T4ClassId } from '../career/CareerT4Promotion'
import { CAREER_CLASS_HERO, T4_CLASS_HERO } from '../career/CareerPlayerProfile'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../battle/HeroCombatProfile'
import { HERO_ASSETS, type HeroAssetId } from '../world/HeroAssetCatalog'
import { HumanoidAssetRegistry, disposeHumanoidInstanceSkeletons } from '../world/HumanoidAssetRegistry'

export type CareerRoadId = CareerClassId | T4ClassId
const CLASS_NAMES: Record<CareerRoadId, string> = { 'roman-commander': 'Roman Commander · T5', 'byzantine-cataphract': '拜占庭鐵甲重騎兵 · T5+',
  'viking-commander': '維京指揮官 Viking Commander · T5', 'ironblood-warlord': '鐵血戰帥 Ironblood Warlord · T5',
  paladin: '聖騎士 Paladin · T4', centurion: '百夫長 Centurion · T4',
  varangian: '瓦良格隊長 Varangian Captain · T4', 'dragon-oathguard': '龍誓重衛 Dragon Oathguard · T4' }
/** Card-only notes; every number on a card comes from the class's real combat profile. */
const CLASS_NOTES: Partial<Record<CareerRoadId, string>> = {
  'byzantine-cataphract': '軍旗槍與鷹盾另行購買。', centurion: '百夫長鷹盾可於商店另行購買。',
  'dragon-oathguard': '重甲：步行與騎乘移動較慢。雙龍鐵衛盾可於商店另行購買。', 'ironblood-warlord': '重甲：步行與騎乘移動較慢。',
}

/** One road per promotion stage: same cards and confirmation; the faction's classes and offers come from the road owner. */
interface RoadSpec<T extends CareerRoadId> { road: CareerClassRoad<T>; rank: string; hero: Readonly<Record<T, HeroAssetId>> }
const T5_ROAD: RoadSpec<CareerClassId> = { road: T5_CLASS_ROAD, rank: 'Commander', hero: CAREER_CLASS_HERO }
const T4_ROAD: RoadSpec<T4ClassId> = { road: T4_CLASS_ROAD, rank: 'Captain', hero: T4_CLASS_HERO }

const multiplier = (value: number) => `×${value.toFixed(2).replace(/0$/, '')}`
/** Stats exactly as the Player/NPC combat profile applies them (hero asset → profile). */
export function careerClassStats(heroId: HeroAssetId): string {
  const p = HERO_COMBAT_PROFILES[HERO_COMBAT_PROFILE_BY_ASSET[heroId]]
  return [`HP ${p.maxHp} · Damage ${multiplier(p.damageMultiplier)}${p.meleeDamageMultiplier ? ` · Melee ${multiplier(p.meleeDamageMultiplier)}` : ''}`,
    `Damage Taken ${multiplier(p.damageTakenMultiplier)}`,
    `Attack Speed ${multiplier(p.attackSpeedMultiplier)}${p.meleeAttackSpeedMultiplier ? ` · Melee ${multiplier(p.meleeAttackSpeedMultiplier)}` : ''} · Move Speed ${multiplier(p.moveSpeedMultiplier)}`].join('\n')
}

/** Confirmation copy for the live offer; the price always comes from the offer, never from the card. */
export function careerClassConfirmation(target: CareerRoadId, offer: CareerClassOffer): { title: string; body: string; accept: string } | null {
  const name = CLASS_NAMES[target], rank = isT4ClassId(target) ? T4_ROAD.rank : T5_ROAD.rank
  switch (offer.kind) {
    case 'appoint': return { title: `接受${name}任命？`, accept: '確認免費任命',
      body: `首次任命免費，不扣除軍功。\n將成為正式 ${rank}，保留指揮權與任務資格。\n之後可再購買另一職業。` }
    case 'purchase': return { title: `購買${name}？`, accept: `確認購買 · ${offer.cost.toLocaleString()}`,
      body: `本次扣除 ${offer.cost.toLocaleString()} 可用軍功（不影響累計軍功）。\n購買後永久解鎖，之後可免費切換兩種職業。\n保留現有裝備、坐騎、軍功與 ${rank} 權限；不會贈送額外裝備。` }
    case 'switch': return { title: `切換為${name}？`, accept: '確認切換',
      body: `此職業已永久解鎖，切換免費。\n保留現有裝備、坐騎、軍功與 ${rank} 權限。` }
    default: return null
  }
}

/** One portrait/context for the selected card. Registry resources remain shared. */
function portrait(parent: HTMLElement): { select(heroId: HeroAssetId): void; dispose(): void } {
  let stopped = false, request = 0, raf = 0, renderer: THREE.WebGLRenderer | undefined
  let scene: THREE.Scene | undefined, camera: THREE.PerspectiveCamera | undefined
  let root: THREE.Group | undefined, pointerX: number | undefined
  let animation: ReturnType<typeof HumanoidAssetRegistry.createCharacterVisual>['rig']['animation']
  const status = document.createElement('p'); parent.append(status)
  const clearModel = () => {
    cancelAnimationFrame(raf); pointerX = undefined
    animation?.stop(); animation = undefined
    if (root) { disposeHumanoidInstanceSkeletons(root); root.removeFromParent(); root = undefined }
    renderer?.renderLists.dispose()
  }
  const clearRenderer = () => {
    renderer?.dispose(); renderer?.domElement.remove(); renderer = undefined
    scene = undefined; camera = undefined
  }
  const fail = () => {
    clearModel(); clearRenderer()
    status.textContent = '模型預覽載入失敗；仍可閱讀職業資料及操作任命。'
  }
  const initialize = () => {
    if (renderer) return
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(360, 200)
    const canvas = renderer.domElement
    canvas.style.cssText = 'width:100%;height:200px;object-fit:contain;touch-action:none;cursor:grab'
    canvas.setAttribute('aria-label', '拖曳旋轉目前選取職業，查看正面與背面')
    canvas.onpointerdown = event => { pointerX = event.clientX; canvas.setPointerCapture(event.pointerId) }
    canvas.onpointermove = event => {
      if (pointerX !== undefined && root) { root.rotation.y += (event.clientX - pointerX) * .015; pointerX = event.clientX }
    }
    canvas.onpointerup = canvas.onpointercancel = () => { pointerX = undefined }
    parent.append(canvas)
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(32, 1.8, .1, 20)
    camera.position.set(0, 1, 4); camera.lookAt(0, 1, 0)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2))
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 4, 3); scene.add(light)
  }
  return {
    select(heroId) {
      if (stopped) return
      const token = ++request
      clearModel()
      if (renderer) renderer.domElement.hidden = true
      status.textContent = `正在準備 ${HERO_ASSETS[heroId].nameEn} 模型預覽…`
      void HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[heroId].descriptor).then(() => {
        if (stopped || token !== request) return
        try {
          initialize()
          root = new THREE.Group(); scene!.add(root)
          // The preview body's faction is the hero asset's own (Viking classes must not be built as Roman).
          animation = HumanoidAssetRegistry.createCharacterVisual(root, { faction: HERO_ASSETS[heroId].descriptor.faction, tier: 3, isPlayer: true }, heroId).rig.animation
          animation?.play('idle', { loop: true })
          renderer!.domElement.hidden = false
          status.textContent = `${HERO_ASSETS[heroId].nameEn} · 拖曳旋轉`
          let previous = performance.now()
          const frame = (now: number) => {
            if (stopped || token !== request) return
            try {
              animation?.update(Math.min(.05, (now - previous) / 1000)); previous = now
              renderer!.render(scene!, camera!); raf = requestAnimationFrame(frame)
            } catch { fail() }
          }
          raf = requestAnimationFrame(frame)
        } catch { fail() }
      }).catch(() => { if (!stopped && token === request) fail() })
    },
    dispose() { stopped = true; request++; clearModel(); clearRenderer() },
  }
}

function offerView(p: CareerProfile, first: number, offer: CareerClassOffer): { status: string; label: string; enabled: boolean } {
  const merit = enlistmentMerit(p)
  switch (offer.kind) {
    case 'current': return { status: '目前使用中', label: '目前職業', enabled: false }
    case 'switch': return { status: '已永久解鎖 · 切換免費', label: '切換職業', enabled: true }
    case 'purchase': return { status: `購買價 ${offer.cost.toLocaleString()} 可用軍功 · 目前 ${p.availableMerit.toLocaleString()}`, label: `購買職業 · ${offer.cost.toLocaleString()}`, enabled: true }
    case 'insufficient-merit': return { status: `購買價 ${offer.cost.toLocaleString()} 可用軍功 · 目前 ${p.availableMerit.toLocaleString()}\n尚差 ${offer.shortfall.toLocaleString()} 可用軍功`, label: `購買職業 · ${offer.cost.toLocaleString()}`, enabled: false }
    case 'appoint': return { status: `首次任命免費 · 本次入伍累計 ${merit.toLocaleString()} / ${first.toLocaleString()} 軍功\n已達首次任命門檻`, label: '免費接受任命', enabled: true }
    case 'merit-locked': return { status: `首次任命門檻 ${first.toLocaleString()} · 本次入伍累計 ${merit.toLocaleString()}\n距離首次任命尚差 ${offer.shortfall.toLocaleString()} 軍功`, label: '免費接受任命', enabled: false }
    default: return { status: '目前無法服務', label: '暫不可用', enabled: false }
  }
}

function appendRoadCards<T extends CareerRoadId>(spec: RoadSpec<T>, parent: HTMLElement, read: () => CareerProfile, choose: (target: T) => void): () => void {
  const p = read(), merit = enlistmentMerit(p), road = spec.road, targets = road.classes[p.faction]
  const previewPanel = document.createElement('section'); previewPanel.setAttribute('aria-label', '目前選取職業的模型預覽'); parent.append(previewPanel)
  const preview = portrait(previewPanel)
  const current = road.current(p) ?? targets[0]
  preview.select(spec.hero[current])
  const previewButtons: HTMLButtonElement[] = []
  const container = document.createElement('div')
  container.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;max-width:760px'
  parent.append(container)
  for (const target of targets) {
    const offer = classRoadOffer(road, p, target), view = offerView(p, road.firstMerit[target], offer)
    const card = document.createElement('article'); card.style.cssText = 'border:1px solid #b69557;border-radius:12px;padding:14px;min-width:0;background:#171d28'
    card.dataset.careerClass = target
    container.append(card)
    const title = document.createElement('h3'); title.textContent = CLASS_NAMES[target]; card.append(title)
    const show = document.createElement('button'); show.className = 'town-button'; show.textContent = '預覽此職業'
    show.setAttribute('aria-pressed', String(current === target))
    show.onclick = () => {
      for (const button of previewButtons) button.setAttribute('aria-pressed', String(button === show))
      preview.select(spec.hero[target])
    }
    previewButtons.push(show); card.append(show)
    if (offer.kind === 'appoint' || offer.kind === 'merit-locked') {
      const required = road.firstMerit[target]
      const progress = document.createElement('progress'); progress.max = required; progress.value = Math.min(merit, required); progress.style.width = '100%'; card.append(progress)
    }
    const text = document.createElement('p'); text.style.whiteSpace = 'pre-line'
    text.textContent = `${view.status}\n${careerClassStats(spec.hero[target])}${CLASS_NOTES[target] ? `\n${CLASS_NOTES[target]}` : ''}`
    card.append(text)
    const button = document.createElement('button'); button.className = 'town-button'
    button.textContent = view.label; button.disabled = !view.enabled
    button.onclick = () => choose(target); card.append(button)
  }
  return () => preview.dispose()
}

/** T5 road (Commander NPC): Roman Commander / Byzantine Cataphract, Viking Commander / Ironblood Warlord. */
export function appendCareerPromotionCards(parent: HTMLElement, read: () => CareerProfile, choose: (target: CareerClassId) => void): () => void {
  return appendRoadCards(T5_ROAD, parent, read, choose)
}

/** T4 road (Captain NPC): Paladin / Centurion, Varangian Captain / Dragon Oathguard. */
export function appendT4PromotionCards(parent: HTMLElement, read: () => CareerProfile, choose: (target: T4ClassId) => void): () => void {
  return appendRoadCards(T4_ROAD, parent, read, choose)
}
