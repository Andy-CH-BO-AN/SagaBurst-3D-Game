/**
 * LAN co-op inside one Career mission.
 *
 * Host: the normal Game simulation stays authoritative. Every NPC/mount gets a
 * small wire ID; spawns carry the actor's construction descriptor and a 20 Hz
 * binary snapshot carries transforms, actions and HP. Each guest (one slot per
 * seat) is a friendly puppet NPC here, so enemy AI targets and damages it through
 * the ordinary NPC combat paths; every guest is sent the others' puppets too.
 *
 * Guest: builds the same mission scene, removes its local actors and shows the
 * host's world as puppets. Its own Player runs locally; hits on puppets are
 * forwarded to the host, and its HP comes back from the host.
 */
import * as THREE from 'three'
import { createNpcCombatActorRef, type CombatDamageContext, type CombatEventSink } from '../combat/CombatAttribution'
import { damageMount, damageNpc, damageObstacle, setDamageInterceptor, type DamageResult } from '../combat/DamageRouter'
import type { DamageableObstacle, DamageableObstacleHitResult } from '../world/DamageableObstacle'
import type { CharacterTier } from '../combat/CharacterIdentity'
import type { UnitTier } from '../battle/UnitPresetCatalog'
import { Faction } from '../combat/CombatFaction'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { npcCombatDisplayName } from '../ui/CombatTargetDisplayName'
import { ArrowProjectile, type ProjectileVisualKind } from '../world/ArrowProjectile'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { Mount, MountType, mountTypeFromSave } from '../world/Mount'
import { NPC, type NpcNetworkDescriptor } from '../world/NPC'
import { AIType } from '../world/NpcAIType'
import { PLAYER_FOOT_OFFSET } from '../player/PlayerFootBody'
import { resolveEntityCollision, type ObstacleData } from '../world/Terrain'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { prepareByzantineEquipment } from '../world/HighTierEquipment'
import { gameplayNpcSpawns, type NpcSpawnBatch } from '../world/NpcSpawnScheduler'
import { followLocalOffset } from '../battle/FollowOrder'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { parsePersonalSquad, type CareerPersonalSquadMember } from '../career/CareerPersonalSquad'
import { preloadPersonalSquadMember, spawnPersonalSquadActor } from '../career/PersonalSquadRuntime'
import { coopSession, type CoopMessage, type CoopSession } from './CoopLink'
import { coopGuestLaunchId, coopWaitReason, isCoopSeatAdmitted } from './CoopLaunch'
import { commitCoopMissionMerit, emptyCoopStats, parseCoopMissionMerit, recordCoopGuestEvent, type CoopMissionKind } from './CoopMissionMerit'
import { showCoopToast } from './CoopLobbyUI'
import { CoopSiegeMirror, coopSiegeStructures, coopSiegeWire, parseCoopSiegeWire, type CoopSiegeGate, type CoopSiegeWorld } from './CoopSiegeMirror'
import type { MobileSiegeRamp } from '../campaign/MobileSiegeRamp'
import type { MobileSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import type { PrisonBattleId } from '../career/CareerPrisonBreak'
import type { CombatEvent } from '../combat/CombatAttribution'
import {
  ACTOR_DEAD, ACTOR_HIDDEN, ACTOR_MELEE_STOWED, ACTOR_RANGED, ACTOR_SHIELD_STOWED, ACTOR_SHIELD, ACTOR_SPRINT, COOP_NO_ID, COOP_SNAPSHOT_HZ, CoopIdRegistry, MOUNT_AIRBORNE, MOUNT_DEAD, MOUNT_HIDDEN,
  angleDelta, decodeSnapshot, encodeSnapshot, type CoopActorFrame, type CoopMountFrame,
} from './CoopProtocol'
import type { CombatAction } from '../world/CharacterCombatAnimator'

/** What the co-op controllers may touch in a scene (Game, Town, arena); built with live getters. */
export interface CoopGamePort {
  readonly scene: THREE.Scene
  readonly camera: THREE.Camera
  readonly player: Player
  readonly npcs: NPC[]
  readonly mounts: Mount[]
  readonly arrows: ArrowProjectile[]
  readonly hpBar: HpBar
  readonly combatEmit: CombatEventSink
  /** The guest's own (local, non-mirrored) mount, if the mission gave it one. */
  readonly ownMount: Mount | null
  /** Guest: which of the scene's shared horses its own mount is (Town stable), so the host hides its copy. */
  readonly borrowedMountKey?: () => string | null
  readonly equippedWeapons: () => { melee: string | null; ranged: string | null; shield: string | null }
  /** Whether this player's melee weapon and shield are drawn (not put away). */
  readonly weaponsDrawn: () => { melee: boolean; shield: boolean }
  readonly registerNpc: (npc: NPC) => void
  readonly unregisterNpc: (npc: NPC) => void
  readonly registerMount: (mount: Mount) => void
  readonly unregisterMount: (mount: Mount) => void
  readonly markVisualArrow: (arrow: ArrowProjectile) => void
  /** Scenes whose own loop never updates co-op puppets (Town, arena) let the host bridge do it. */
  readonly selfUpdatesPuppets?: boolean
  /** False where the scene has no shared projectile loop: projectile visuals are not mirrored. */
  readonly projectiles?: boolean
  /** Which actors the guest may damage here (arena: the duel opponent). Default: any. */
  readonly acceptsGuestHit?: (target: NPC | Mount) => boolean
  /** Scenes with their own damage rules (Town hostility) apply the guest's hit themselves. */
  readonly applyGuestHit?: (target: NPC | Mount, damage: number, context: CombatDamageContext) => void
  /** Whether the guest's own HR squad joins this scene (battlefield missions only). */
  readonly guestSquad?: boolean
  /** Host: actors the guest's own melee/shots may target in scenes without a faction rule (arena opponent). */
  readonly guestTarget?: (npc: NPC) => boolean
  /**
   * Other breakable structures both pages built the same way (palisades, towers), by a key both agree
   * on. With the siege vehicles and gates, the guest's hits on them go to the host and HP comes back.
   */
  readonly structures?: () => ReadonlyMap<string, DamageableObstacle>
  /** Host: the live mobile siege vehicles (Town four-gate, Outpost assault). */
  readonly siegeRamps?: () => Iterable<MobileSiegeRamp<MobileSiegeRampId>>
  /** Both: the scene's gates by an id both pages share. */
  readonly siegeGates?: () => ReadonlyMap<string, CoopSiegeGate>
  /** Guest: how this scene builds and docks mirrored siege vehicles. */
  readonly siegeMirror?: Omit<CoopSiegeWorld, 'gates'>
  /** Host: scenes with their own structure rules (Town siege) apply the guest's structure hit themselves. */
  readonly applyGuestStructureHit?: (target: DamageableObstacle, damage: number, context: CombatDamageContext) => void
  /** Host: this scene's formal mission once its own claim is saved, so the guest earns its own merit. */
  readonly missionSettlement?: () => { missionId: string; kind: CoopMissionKind; victory: boolean; prison?: PrisonBattleId } | null
}

interface CoopLook {
  faction: CharacterFaction
  hero: HeroAssetId | null
  tier: CharacterTier
  melee: string | null
  ranged: string | null
  shield: string | null
}

interface CoopMountState { type: MountType; variant: number; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; airborne: boolean; dead: boolean }

interface CoopGuestState {
  x: number; y: number; z: number; yaw: number; speed: number
  action: CombatAction; flags: number; draw: number
  riding: boolean
  mount: CoopMountState | null
  look: CoopLook
  /** The guest player's own max HP (career rank, skills); its proxy uses it. */
  maxHp: number
  /** The scene horse the guest took as its own mount (Town stable), by the scene's key. */
  borrowed?: string
}

interface SpawnActor {
  id: number; d: NpcNetworkDescriptor; hp: number
  /** The guest's own personal squad member. */ own?: boolean
  /** A target for the guest's attacks. */ target?: boolean
  /** The host player's body. */ avatar?: boolean
  /** Another guest's body. */ partner?: boolean
}

/** A guest command for one of its own squad members, captured from its local command menu. */
interface SquadOrder {
  id: number
  order: TacticalOrder
  formation?: { commandId: number; x: number; y?: number; z: number; yaw: number; speedLimit?: number; arrivalOrder?: TacticalOrder }
}
const TACTICAL_ORDERS: ReadonlySet<string> = new Set(['attack', 'charge', 'defend', 'formation', 'follow'])
/** Guest formation command IDs live in their own range per seat so neither the host's nor another guest's formation bookkeeping matches them. */
const GUEST_FORMATION_ID_BASE = 1_000_000
function guestFormationId(seat: number, commandId: number): number { return GUEST_FORMATION_ID_BASE * (seat + 1) + commandId }
/** A guest puppet's name on the host and on the other guests' screens. */
function guestName(seat: number): string { return `隊友 ${seat}` }
interface SpawnMount { id: number; type: MountType; variant: number; x: number; y: number; z: number; yaw: number }

type FireEvent = [number, number, number, number, number, number, number, number]

const SNAPSHOT_INTERVAL = 1 / COOP_SNAPSHOT_HZ
const TELEPORT_DISTANCE = 8
const RANGED_ACTIONS: ReadonlySet<CombatAction> = new Set(['bowAim', 'bowRelease', 'pilumThrow'])

function smoothing(dt: number): number { return 1 - Math.exp(-dt * 14) }

function lookKey(look: CoopLook): string {
  return `${look.faction}|${look.hero ?? ''}|${look.tier}|${look.melee ?? ''}|${look.ranged ?? ''}|${look.shield ?? ''}`
}

function playerLook(port: CoopGamePort): CoopLook {
  const weapons = port.equippedWeapons()
  return { faction: port.player.characterFaction, hero: port.player.heroAssetId ?? null, tier: port.player.characterTier, ...weapons }
}

function lookDescriptor(look: CoopLook, name: string, x: number, z: number): NpcNetworkDescriptor {
  return {
    x, z, faction: Faction.PLAYER, characterFaction: look.faction, aiType: look.ranged && !look.melee ? AIType.RANGED : AIType.MELEE,
    name, tier: Math.min(look.tier, 5) as UnitTier,
    loadout: { meleeWeaponId: look.melee, rangedWeaponId: look.ranged, shieldId: look.shield, mountId: null },
    visualAssetId: look.hero ?? undefined, characterTier: look.tier,
  }
}

/** The Player root is its collision centre; NPC roots stand on their feet. */
function playerFeet(player: Player): { x: number; y: number; z: number } {
  const p = player.position
  return { x: p.x, y: p.y - PLAYER_FOOT_OFFSET, z: p.z }
}

function playerActionFlags(port: CoopGamePort, action: CombatAction): number {
  const player = port.player, drawn = port.weaponsDrawn()
  let flags = (drawn.melee ? 0 : ACTOR_MELEE_STOWED) | (drawn.shield ? 0 : ACTOR_SHIELD_STOWED)
  if (player.dead) flags |= ACTOR_DEAD
  if (player.isAiming || RANGED_ACTIONS.has(action)) flags |= ACTOR_RANGED
  if (player.shield.shieldRaised) flags |= ACTOR_SHIELD
  return flags
}

function mountState(mount: Mount): CoopMountState {
  return {
    type: mount.type, variant: mount.appearanceVariant, x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z,
    yaw: mount.group.rotation.y, pitch: mount.group.rotation.x, speed: mount.movementSpeed, airborne: mount.isAirborne, dead: mount.dead,
  }
}

/**
 * The players never overlap: each computer pushes only its own Player (or the mount it rides) out of
 * the other players' bodies, whose positions their own computers own.
 */
export function separateLocalPlayerFromPeers(player: Player, peers: readonly NPC[], obstacles: readonly ObstacleData[]): void {
  for (const peer of peers) separateLocalPlayerFromPeer(player, peer, obstacles)
}

export function separateLocalPlayerFromPeer(player: Player, peer: NPC | null | undefined, obstacles: readonly ObstacleData[]): void {
  if (!peer || peer.dead || !peer.group.parent || player.dead || player.isFalling) return
  const mount = player.isMounted ? player.currentMount : null
  if (mount?.isFlyingMount || peer.mount?.isFlyingMount) return
  const body = mount
    ? { position: mount.group.position, radius: 1, height: 2.6, bottomOffset: 0, mountedSurfaces: true }
    : { position: player.group.position, radius: .42, height: PLAYER_FOOT_OFFSET * 2, bottomOffset: PLAYER_FOOT_OFFSET, walkSurfaces: true }
  resolveEntityCollision(body, { position: peer.combatPosition, radius: peer.isMounted ? 1 : .42, height: peer.isMounted ? 2.6 : 1.8,
    bottomOffset: 0, anchored: true, walkSurfaces: !peer.isMounted }, obstacles as ObstacleData[])
  if (mount) player.syncMountTransform()
}

function removeFrom<T>(list: T[], item: T): void {
  const index = list.indexOf(item)
  if (index >= 0) list.splice(index, 1)
}

function syncMountRider(npc: NPC, mount: Mount | null): void {
  if (npc.dead) return
  if (mount && !mount.dead && npc.mount !== mount) npc.mountVehicle(mount)
  else if (!mount && npc.mount) npc.dismountFromMount()
}

// ─────────────────────────────────────────── Host ───────────────────────────

/**
 * One guest seat on the host: its puppet, its own HR squad, its own combat record and what it has
 * been sent. The record outlives a disconnect, so a guest that reconnects keeps its mission merit.
 */
class CoopGuestSlot {
  ready = false
  state: CoopGuestState | null = null
  lookKey = ''
  proxy: NPC | null = null
  proxyMount: Mount | null = null
  /** The guest's own HR squad, simulated here and commanded only by that guest. */
  readonly squad: NPC[] = []
  squadKey = ''
  /** Owns the queued spawn jobs of the current roster; a new generation retires every older async spawn. */
  squadBatch: NpcSpawnBatch | null = null
  squadGeneration = 0
  pendingSquad: CareerPersonalSquadMember[] | null = null
  /** The guest's own combat record (its body and its own squad), by the single-player stat rules. */
  readonly stats = emptyCoopStats()
  readonly actorIds = new Set<string>()
  meritSent = false
  /** World actors this guest has been sent, by wire id, with the equipment key they were sent with. */
  readonly sentNpcs = new Map<number, { npc: NPC; key: string }>()
  readonly sentMounts = new Map<number, Mount>()
  /** The other guests' puppets (by wire id, with their look key) and mounts this guest shows. */
  readonly sentPartners = new Map<number, string>()
  readonly sentPartnerMounts = new Set<number>()
  /** Structure HP last sent to this guest, by structure key. */
  readonly sentStructureHp = new Map<string, number>()
  hostAvatarKey = ''

  constructor(readonly seat: number) {}

  /** The guest (re)built its scene: everything is sent again. */
  resetSent(): void {
    this.sentNpcs.clear()
    this.sentMounts.clear()
    this.sentPartners.clear()
    this.sentPartnerMounts.clear()
    this.sentStructureHp.clear()
    this.hostAvatarKey = ''
  }
}

/** This tick's shared view of the host world, built once and sent to every ready guest. */
interface HostWorldView {
  npcs: Array<{ id: number; npc: NPC; key: string }>
  mounts: Array<{ id: number; mount: Mount }>
  actorFrames: CoopActorFrame[]
  mountFrames: CoopMountFrame[]
  partners: Array<{ slot: CoopGuestSlot; proxy: NPC; state: CoopGuestState; id: number; mountId: number | null }>
}

interface GuestFire { from: number | null; f: FireEvent }

/** Host-side mission bridge; created only when the host page has a connected co-op link. */
export class CoopHostMission {
  private readonly npcIds = new CoopIdRegistry<NPC>()
  private readonly mountIds = new CoopIdRegistry<Mount>()
  private readonly hostAvatar = {}
  /** Guest seats of this scene, created on their first message. */
  private readonly slots = new Map<number, CoopGuestSlot>()
  private snapshotTimer = 0
  private elapsed = 0
  private fire: GuestFire[] = []
  /** Guests' own hero bodies/gear may be new to this computer: load them before building a proxy. */
  private readonly lookAssets = new Map<string, 'loading' | 'ready' | 'failed'>()
  private settlementTimer = 0
  private siegeTimer = 0
  private readonly target = new THREE.Vector3()
  private readonly unsubscribe: Array<() => void> = []

  /** `admits`: whether a guest seat follows this scene (see `CoopAudience`); other seats are ignored. */
  constructor(private readonly port: CoopGamePort, private readonly link: CoopSession = coopSession(),
    private readonly admits: (seat: number) => boolean = isCoopSeatAdmitted) {
    this.unsubscribe.push(
      link.on('ready', (_message, from) => {
        const slot = this.slotFor(from)
        if (slot) { slot.ready = true; slot.resetSent() }
      }),
      link.on('guest', (message, from) => { const slot = this.slotFor(from); if (slot) slot.state = message.s as CoopGuestState }),
      link.on('hit', (message, from) => { const slot = this.slots.get(from); if (slot) this.applyGuestHit(slot, message) }),
      link.on('selfDamage', (message, from) => {
        const damage = Number(message.damage), proxy = this.slots.get(from)?.proxy
        if (proxy && Number.isFinite(damage) && damage > 0) proxy.takeFallDamage(damage)
      }),
      link.on('fire', (message, from) => { const slot = this.slots.get(from); if (slot) this.showGuestProjectile(slot, message.f as FireEvent) }),
      link.on('guestSquad', (message, from) => {
        const slot = port.guestSquad === false ? null : this.slotFor(from)
        if (slot) this.acceptGuestSquad(slot, message.members)
      }),
      link.on('order', (message, from) => { const slot = this.slots.get(from); if (slot) this.applySquadOrder(slot, message.o as SquadOrder) }),
      link.on('squadFollow', (_message, from) => { const slot = this.slots.get(from); if (slot) this.followGuest(slot) }),
      link.onChange(() => { for (const slot of this.slots.values()) if (!link.isPeer(slot.seat)) this.releaseSlot(slot) }),
    )
  }

  /** The partner of a one-guest scene (Town, arenas): the lowest seat with a puppet. */
  get guestProxy(): NPC | null { return this.primarySlot()?.proxy ?? null }

  /** Every connected guest's puppet. */
  get guestProxies(): NPC[] {
    const out: NPC[] = []
    for (const slot of this.slots.values()) if (slot.proxy) out.push(slot.proxy)
    return out
  }

  /** The scene horse the connected partner took as its own mount; its proxy shows that horse. */
  get guestBorrowedMount(): string | null {
    const slot = this.primarySlot()
    const key = slot?.state?.borrowed
    return slot && this.link.isPeer(slot.seat) && typeof key === 'string' ? key : null
  }

  private primarySlot(): CoopGuestSlot | null {
    let best: CoopGuestSlot | null = null
    for (const slot of this.slots.values()) if (slot.proxy && (!best || slot.seat < best.seat)) best = slot
    return best
  }

  /** A guest seat's slot, created for a connected seat of this scene's audience; null for any other seat. */
  private slotFor(seat: number): CoopGuestSlot | null {
    const existing = this.slots.get(seat)
    if (existing) return existing
    if (!this.link.isPeer(seat) || !this.admits(seat)) return null
    const slot = new CoopGuestSlot(seat)
    this.slots.set(seat, slot)
    return slot
  }

  /** Host scenes route every combat event here (Game's stream, the arena's emit). */
  recordCombatEvent(event: CombatEvent): void {
    for (const slot of this.slots.values()) recordCoopGuestEvent(slot.stats, event, slot.actorIds)
  }

  /** The host's result was just saved: send the guests' records now rather than on the next poll. */
  notifySettled(): void {
    this.settlementTimer = 1
    this.sendMissionMerit(0)
  }

  /** Once the host's own mission claim is saved, each guest gets its own record and earns by the same rules. */
  private sendMissionMerit(dt: number): void {
    if (!this.port.missionSettlement) return
    const waiting = [...this.slots.values()].filter(slot => slot.ready && !slot.meritSent && this.link.isPeer(slot.seat))
    if (!waiting.length) return
    this.settlementTimer += dt
    if (this.settlementTimer < 1) return
    this.settlementTimer = 0
    const settled = this.port.missionSettlement()
    if (!settled) return
    for (const slot of waiting) {
      slot.meritSent = true
      this.link.send({ t: 'missionMerit', record: { ...settled, stats: { ...slot.stats, survived: Boolean(slot.proxy && !slot.proxy.dead) } } }, slot.seat)
    }
  }

  /** `announceEnd` false when the host only moves to another co-op scene (its new launch follows). */
  dispose(announceEnd = true): void {
    if (announceEnd) this.link.send({ t: 'end' })
    for (const off of this.unsubscribe) off()
    for (const slot of this.slots.values()) this.releaseSlot(slot)
  }

  /** Game routes every projectile it creates here so the guests can draw it. */
  onProjectile(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, kind: ProjectileVisualKind, faction: Faction): void {
    if (this.port.projectiles === false || !this.anyReady()) return
    this.fire.push({ from: null, f: [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, speed, (kind === 'pilum' ? 1 : 0) | (faction === Faction.ENEMY ? 2 : 0)] })
  }

  private anyReady(): boolean {
    for (const slot of this.slots.values()) if (slot.ready) return true
    return false
  }

  /** Called from the Game NPC loop instead of AI for a guest's puppet. */
  updatePuppet(npc: NPC, dt: number, cameraDistance: number): void {
    let owner: CoopGuestSlot | null = null
    for (const slot of this.slots.values()) if (slot.proxy === npc) { owner = slot; break }
    const state = owner?.state
    if (!owner || !state) { npc.updateCoopPuppet(dt, cameraDistance, this.holdFrame(npc)); return }
    const k = smoothing(dt)
    const pos = npc.combatPosition
    this.target.set(state.x, state.y, state.z)
    const far = pos.distanceTo(this.target) > TELEPORT_DISTANCE
    const mount = owner.proxyMount
    if (mount && state.mount) {
      const m = state.mount
      const mp = mount.group.position
      const mountFar = mp.distanceTo(this.target.set(m.x, m.y, m.z)) > TELEPORT_DISTANCE
      mount.setCameraDistance(mp.distanceTo(this.port.camera.position))
      mount.updateCoopPuppet(dt,
        mountFar ? m.x : mp.x + (m.x - mp.x) * k, mountFar ? m.y : mp.y + (m.y - mp.y) * k, mountFar ? m.z : mp.z + (m.z - mp.z) * k,
        mount.group.rotation.y + angleDelta(mount.group.rotation.y, m.yaw) * k, m.pitch, m.speed, m.dead, m.airborne)
    }
    syncMountRider(npc, state.riding ? mount : null)
    const current = npc.group.position
    npc.updateCoopPuppet(dt, cameraDistance, {
      x: far ? state.x : current.x + (state.x - current.x) * k,
      y: far ? state.y : current.y + (state.y - current.y) * k,
      z: far ? state.z : current.z + (state.z - current.z) * k,
      yaw: npc.group.rotation.y + angleDelta(npc.group.rotation.y, state.yaw) * k,
      speed: state.speed, action: state.action, ranged: (state.flags & ACTOR_RANGED) !== 0,
      shieldRaised: (state.flags & ACTOR_SHIELD) !== 0, sprinting: (state.flags & ACTOR_SPRINT) !== 0,
      draw: state.draw, hp: npc.hp, dead: npc.dead,
      meleeStowed: (state.flags & ACTOR_MELEE_STOWED) !== 0, shieldStowed: (state.flags & ACTOR_SHIELD_STOWED) !== 0,
    })
  }

  /** Per-frame bookkeeping after the simulation step. */
  update(dt: number): void {
    this.elapsed += dt
    for (const slot of this.slots.values()) {
      this.syncProxy(slot)
      if (this.port.selfUpdatesPuppets && slot.proxy) {
        this.updatePuppet(slot.proxy, dt, slot.proxy.group.position.distanceTo(this.port.camera.position))
        slot.proxy.fitMountedSeat()
      }
      if (slot.pendingSquad && slot.proxy) {
        const members = slot.pendingSquad
        slot.pendingSquad = null
        void this.spawnGuestSquad(slot, members)
      }
    }
    this.sendMissionMerit(dt)
    const ready = [...this.slots.values()].filter(slot => slot.ready && this.link.isPeer(slot.seat))
    if (!ready.length) { this.fire = []; return }
    this.snapshotTimer += dt
    if (this.snapshotTimer < SNAPSHOT_INTERVAL) return
    this.snapshotTimer %= SNAPSHOT_INTERVAL
    const world = this.worldView()
    const structures = this.structures()
    const siege = this.siegeWire(SNAPSHOT_INTERVAL)
    const fire = this.fire
    this.fire = []
    for (const slot of ready) {
      this.sendSpawns(slot, world)
      this.sendSnapshot(slot, world)
      this.sendStructures(slot, structures)
      if (siege) this.link.send({ t: 'siege', siege }, slot.seat)
      // A guest's own shots are already on its screen.
      const shots = fire.filter(event => event.from !== slot.seat).map(event => event.f)
      if (shots.length) this.link.send({ t: 'ev', fire: shots }, slot.seat)
    }
  }

  private holdFrame(npc: NPC): Parameters<NPC['updateCoopPuppet']>[2] {
    const p = npc.group.position
    return { x: p.x, y: p.y, z: p.z, yaw: npc.group.rotation.y, speed: 0, action: 'idle', ranged: false, shieldRaised: false, sprinting: false, draw: 0, hp: npc.hp, dead: npc.dead }
  }

  private syncProxy(slot: CoopGuestSlot): void {
    const state = slot.state
    if (!state || !this.link.isPeer(slot.seat)) return
    const key = lookKey(state.look)
    if ((!slot.proxy || key !== slot.lookKey) && !this.lookReady(state.look, key)) return
    if (!slot.proxy || key !== slot.lookKey) {
      const hp = slot.proxy?.hp
      this.removeProxy(slot, false)
      const npc = NPC.fromNetworkDescriptor(this.port.scene, lookDescriptor(state.look, guestName(slot.seat), state.x, state.z), this.port.combatEmit)
      npc.coopPuppet = true
      npc.coopRemoteCommand = true
      npc.group.position.set(state.x, state.y, state.z)
      if (hp !== undefined && hp < npc.maxHp) npc.takeFallDamage(npc.maxHp - hp)
      slot.proxy = npc
      slot.actorIds.add(npc.combatantId)
      // Followers keep following their guest across a re-created proxy.
      slot.squad.forEach((member, index) => {
        if (member.tacticalOrder === 'follow') member.assignFollowTarget(npc, index, followLocalOffset(index, member.isMounted))
      })
      slot.lookKey = key
      this.port.npcs.push(npc)
      this.port.registerNpc(npc)
    }
    slot.proxy?.applyCoopMaxHp(Number(state.maxHp))
    const wanted = state.mount
    if (wanted && (!slot.proxyMount || slot.proxyMount.type !== wanted.type || slot.proxyMount.disposed)) {
      this.removeProxyMount(slot)
      const mount = new Mount(this.port.scene, wanted.type, wanted.x, wanted.z, wanted.y, wanted.variant as 0)
      mount.coopPuppet = true
      slot.proxyMount = mount
      this.port.mounts.push(mount)
      this.port.registerMount(mount)
    } else if (!wanted) this.removeProxyMount(slot)
  }

  private lookReady(look: CoopLook, key: string): boolean {
    const status = this.lookAssets.get(key)
    if (status) return status !== 'loading'
    this.lookAssets.set(key, 'loading')
    const hero = look.hero && look.hero in HERO_ASSETS ? HERO_ASSETS[look.hero] : undefined
    void Promise.all([HumanoidAssetRegistry.preload(), ...(hero ? [HumanoidAssetRegistry.preloadAsset(hero.descriptor)] : []),
      prepareByzantineEquipment([look.melee, look.shield])])
      .then(() => { this.lookAssets.set(key, 'ready') })
      .catch(error => { console.warn('[coop] guest character assets failed', error); this.lookAssets.set(key, 'failed') })
    return false
  }

  private removeProxyMount(slot: CoopGuestSlot): void {
    const mount = slot.proxyMount
    if (!mount) return
    slot.proxyMount = null
    if (slot.proxy?.mount === mount) slot.proxy.dismountFromMount()
    this.port.unregisterMount(mount)
    removeFrom(this.port.mounts, mount)
    mount.dispose()
  }

  private removeProxy(slot: CoopGuestSlot, withMount = true): void {
    if (withMount) this.removeProxyMount(slot)
    const npc = slot.proxy
    if (!npc) return
    slot.proxy = null
    slot.lookKey = ''
    this.port.unregisterNpc(npc)
    removeFrom(this.port.npcs, npc)
    npc.dispose()
  }

  /** A guest left: its body and squad leave the world; its combat record stays for a reconnect. */
  private releaseSlot(slot: CoopGuestSlot): void {
    slot.ready = false
    slot.state = null
    this.removeProxy(slot)
    this.removeGuestSquad(slot)
  }

  private hostAvatarDescriptor(): { d: NpcNetworkDescriptor; key: string } {
    const look = playerLook(this.port)
    const p = this.port.player.position
    return { d: lookDescriptor(look, '主機', p.x, p.z), key: lookKey(look) }
  }

  /** The world every guest sees this tick: host NPCs and mounts, the host's body and every guest puppet. */
  private worldView(): HostWorldView {
    const view: HostWorldView = { npcs: [], mounts: [], actorFrames: [], mountFrames: [], partners: [] }
    const mountId = (mount: Mount | null | undefined): number => mount && !mount.coopPuppet ? this.mountIds.idOf(mount) ?? COOP_NO_ID : COOP_NO_ID
    for (const mount of this.port.mounts) {
      if (mount.coopPuppet || mount.disposed) continue
      const { id } = this.mountIds.ensure(mount)
      view.mounts.push({ id, mount })
      const p = mount.group.position
      view.mountFrames.push({ id, x: p.x, y: p.y, z: p.z, yaw: mount.group.rotation.y, pitch: mount.group.rotation.x, speed: mount.movementSpeed,
        flags: (mount.dead ? MOUNT_DEAD : 0) | (mount.isAirborne ? MOUNT_AIRBORNE : 0) | (mount.group.visible || mount.dead ? 0 : MOUNT_HIDDEN), hp: mount.currentHp })
    }
    for (const npc of this.port.npcs) {
      if (npc.coopPuppet) continue
      const { id } = this.npcIds.ensure(npc)
      const eq = npc.networkEquipment
      view.npcs.push({ id, npc, key: `${eq.melee ?? ''}|${eq.ranged ?? ''}|${eq.shield ?? ''}` })
      const p = npc.group.position
      const action = npc.combatAnimationAction
      let flags = 0
      if (npc.dead) flags |= ACTOR_DEAD
      if (npc.hasActiveRangedWeapon) flags |= ACTOR_RANGED
      if (npc.shield.shieldRaised) flags |= ACTOR_SHIELD
      if (npc.sprinting) flags |= ACTOR_SPRINT
      if (!npc.group.visible) flags |= ACTOR_HIDDEN
      view.actorFrames.push({ id, x: p.x, y: p.y, z: p.z, yaw: npc.group.rotation.y, speed: npc.isMounted ? npc.mount!.movementSpeed : npc.networkMovementSpeed,
        action, flags, draw: action === 'bowAim' ? 1 : 0, hp: npc.hp, mountId: mountId(npc.mount) })
    }
    const player = this.port.player
    const avatarId = this.npcIds.ensure(this.hostAvatar as NPC).id
    const feet = playerFeet(player)
    const action = player.combatAnimationAction
    view.actorFrames.push({ id: avatarId, x: feet.x, y: feet.y, z: feet.z, yaw: player.facingYaw,
      speed: player.isMounted ? player.currentMount?.movementSpeed ?? 0 : this.playerSpeed(), action,
      flags: playerActionFlags(this.port, action), draw: player.bowDrawRatio, hp: player.hp, mountId: mountId(player.isMounted ? player.currentMount : null) })
    for (const slot of this.slots.values()) {
      const { proxy, state } = slot
      if (!proxy || !state || !this.link.isPeer(slot.seat)) continue
      const own = slot.proxyMount && !slot.proxyMount.disposed ? slot.proxyMount : null
      view.partners.push({ slot, proxy, state, id: this.npcIds.ensure(proxy).id, mountId: own ? this.mountIds.ensure(own).id : null })
    }
    return view
  }

  private sendSpawns(slot: CoopGuestSlot, world: HostWorldView): void {
    const actors: SpawnActor[] = [], mounts: SpawnMount[] = []
    const liveNpcs = new Set<number>(), liveMounts = new Set<number>(), livePartners = new Set<number>(), livePartnerMounts = new Set<number>()
    for (const { id, mount } of world.mounts) {
      liveMounts.add(id)
      if (slot.sentMounts.has(id)) continue
      slot.sentMounts.set(id, mount)
      const p = mount.group.position
      mounts.push({ id, type: mount.type, variant: mount.appearanceVariant, x: p.x, y: p.y, z: p.z, yaw: mount.group.rotation.y })
    }
    for (const { id, npc, key } of world.npcs) {
      liveNpcs.add(id)
      if (slot.sentNpcs.get(id)?.key === key) continue
      slot.sentNpcs.set(id, { npc, key })
      const d = npc.networkDescriptor, eq = npc.networkEquipment
      const p = npc.group.position
      actors.push({ id, hp: npc.hp, ...(slot.squad.includes(npc) ? { own: true } : {}), ...(this.port.guestTarget?.(npc) ? { target: true } : {}), d: { ...d, x: p.x, z: p.z, y: undefined,
        loadout: { ...d.loadout, meleeWeaponId: eq.melee, rangedWeaponId: eq.ranged, shieldId: eq.shield, mountId: null } } })
    }
    const avatar = this.hostAvatarDescriptor()
    const avatarId = this.npcIds.ensure(this.hostAvatar as NPC).id
    if (avatar.key !== slot.hostAvatarKey) {
      slot.hostAvatarKey = avatar.key
      actors.push({ id: avatarId, hp: this.port.player.hp, avatar: true, d: avatar.d })
    }
    // The other guests: shown like the host's body, never hittable through this guest's hits.
    for (const partner of world.partners) {
      if (partner.slot === slot) continue
      livePartners.add(partner.id)
      if (partner.mountId !== null) {
        livePartnerMounts.add(partner.mountId)
        const m = partner.state.mount
        if (m && !slot.sentPartnerMounts.has(partner.mountId)) {
          slot.sentPartnerMounts.add(partner.mountId)
          mounts.push({ id: partner.mountId, type: m.type, variant: m.variant, x: m.x, y: m.y, z: m.z, yaw: m.yaw })
        }
      }
      if (slot.sentPartners.get(partner.id) === partner.slot.lookKey) continue
      slot.sentPartners.set(partner.id, partner.slot.lookKey)
      actors.push({ id: partner.id, hp: partner.proxy.hp, partner: true,
        d: lookDescriptor(partner.state.look, guestName(partner.slot.seat), partner.state.x, partner.state.z) })
    }
    const goneNpcs = [...slot.sentNpcs.keys()].filter(id => !liveNpcs.has(id))
    const goneMounts = [...slot.sentMounts.keys()].filter(id => !liveMounts.has(id))
    for (const id of goneNpcs) slot.sentNpcs.delete(id)
    for (const id of goneMounts) slot.sentMounts.delete(id)
    for (const id of [...slot.sentPartners.keys()]) if (!livePartners.has(id)) { slot.sentPartners.delete(id); goneNpcs.push(id) }
    for (const id of [...slot.sentPartnerMounts]) if (!livePartnerMounts.has(id)) { slot.sentPartnerMounts.delete(id); goneMounts.push(id) }
    if (actors.length || mounts.length || goneNpcs.length || goneMounts.length) {
      this.link.send({ t: 'spawn', actors, mounts, goneNpcs, goneMounts }, slot.seat)
    }
  }

  private sendSnapshot(slot: CoopGuestSlot, world: HostWorldView): void {
    const actors = [...world.actorFrames], mounts = [...world.mountFrames]
    for (const { slot: other, proxy, state, id, mountId } of world.partners) {
      if (other === slot) continue
      actors.push({ id, x: state.x, y: state.y, z: state.z, yaw: state.yaw, speed: state.speed, action: state.action,
        flags: state.flags | (proxy.dead ? ACTOR_DEAD : 0), draw: state.draw, hp: proxy.hp,
        mountId: state.riding && mountId !== null ? mountId : COOP_NO_ID })
      const m = state.mount
      if (m && mountId !== null) {
        mounts.push({ id: mountId, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, speed: m.speed,
          flags: (m.dead ? MOUNT_DEAD : 0) | (m.airborne ? MOUNT_AIRBORNE : 0), hp: other.proxyMount?.currentHp ?? 0 })
      }
    }
    this.link.sendBinary(encodeSnapshot({ time: this.elapsed, guestHp: slot.proxy?.hp ?? -1, guestMaxHp: slot.proxy?.maxHp ?? 0, actors, mounts }), slot.seat)
  }

  /** Every structure a guest may hit, by key: scene structures, siege vehicles and gates. */
  structures(): Map<string, DamageableObstacle> {
    return coopSiegeStructures(this.port.siegeRamps?.() ?? [], this.port.siegeGates?.() ?? new Map(), new Map(this.port.structures?.() ?? []))
  }

  private siegeWire(dt: number): ReturnType<typeof coopSiegeWire> | null {
    if (!this.port.siegeRamps && !this.port.siegeGates) return null
    this.siegeTimer += dt
    if (this.siegeTimer < .4) return null
    this.siegeTimer = 0
    return coopSiegeWire(this.port.siegeRamps?.() ?? [], this.port.siegeGates?.() ?? new Map()) ?? null
  }

  private sendStructures(slot: CoopGuestSlot, structures: ReadonlyMap<string, DamageableObstacle>): void {
    const hp: Array<[string, number]> = []
    for (const [key, structure] of structures) {
      const current = structure.currentHp
      if (slot.sentStructureHp.get(key) === current) continue
      slot.sentStructureHp.set(key, current)
      hp.push([key, current])
    }
    if (hp.length) this.link.send({ t: 'structures', hp }, slot.seat)
  }

  private lastPlayerPos = new THREE.Vector3()
  private lastPlayerTime = 0
  private lastPlayerSpeed = 0
  private playerSpeed(): number {
    const p = this.port.player.position
    const dt = this.elapsed - this.lastPlayerTime
    if (dt > 0) this.lastPlayerSpeed = Math.hypot(p.x - this.lastPlayerPos.x, p.z - this.lastPlayerPos.z) / dt
    this.lastPlayerPos.copy(p)
    this.lastPlayerTime = this.elapsed
    return this.lastPlayerSpeed
  }

  private acceptGuestSquad(slot: CoopGuestSlot, value: unknown): void {
    let members: CareerPersonalSquadMember[]
    try { members = parsePersonalSquad({ members: value })?.members ?? [] } catch { return }
    // Only members with a resolved current loadout can deploy, matching HR deployment.
    members = members.filter(member => member.equipment)
    const key = members.map(member => member.id).join(',')
    if (key === slot.squadKey) return
    this.removeGuestSquad(slot)
    slot.squadKey = key
    slot.pendingSquad = members.length ? members : null
  }

  private async spawnGuestSquad(slot: CoopGuestSlot, members: CareerPersonalSquadMember[]): Promise<void> {
    const generation = slot.squadGeneration
    try { await Promise.all(members.map(member => preloadPersonalSquadMember(member, member.characterFaction))) }
    catch (error) { console.warn('[coop] guest squad assets failed', error); return }
    if (generation !== slot.squadGeneration || !this.link.isPeer(slot.seat)) return
    const batch = gameplayNpcSpawns.batch()
    slot.squadBatch = batch
    members.forEach((member, index) => batch.enqueue(`coop-guest:${slot.seat}:${member.id}`, () => {
      const anchor = slot.proxy?.combatPosition ?? this.port.player.position
      const yaw = slot.proxy?.group.rotation.y ?? 0
      const back = 3 + Math.floor(index / 6) * 2.2, side = (index % 6 - 2.5) * 2.2
      const placement = { x: anchor.x - Math.sin(yaw) * back + Math.cos(yaw) * side, z: anchor.z - Math.cos(yaw) * back - Math.sin(yaw) * side, yaw }
      const { npc, mount } = spawnPersonalSquadActor(this.port.scene, member, member.characterFaction, placement, this.port.combatEmit)
      // Not the host's 'player-personal' squad: host mission records and commands never claim it.
      npc.combatOwnership = undefined
      npc.coopRemoteCommand = true
      if (mount) { mount.combatOwner = undefined; this.port.mounts.push(mount); this.port.registerMount(mount) }
      this.port.npcs.push(npc)
      this.port.registerNpc(npc)
      slot.squad.push(npc)
      slot.actorIds.add(npc.combatantId)
      if (slot.proxy) npc.assignFollowTarget(slot.proxy, index, followLocalOffset(index, npc.isMounted))
    }))
    batch.seal()
  }

  private removeGuestSquad(slot: CoopGuestSlot): void {
    slot.squadGeneration++
    slot.squadBatch?.cancel()
    slot.squadBatch = null
    slot.pendingSquad = null
    slot.squadKey = ''
    for (const npc of slot.squad.splice(0)) {
      const mount = npc.mount
      if (mount) { npc.dismountFromMount(); this.port.unregisterMount(mount); removeFrom(this.port.mounts, mount); mount.dispose() }
      this.port.unregisterNpc(npc)
      removeFrom(this.port.npcs, npc)
      npc.dispose()
    }
  }

  private followGuest(slot: CoopGuestSlot): void {
    const proxy = slot.proxy
    if (!proxy) return
    slot.squad.forEach((npc, index) => { if (!npc.dead) npc.assignFollowTarget(proxy, index, followLocalOffset(index, npc.isMounted)) })
  }

  private applySquadOrder(slot: CoopGuestSlot, order: SquadOrder | undefined): void {
    if (!order || !TACTICAL_ORDERS.has(order.order)) return
    const npc = slot.sentNpcs.get(Number(order.id))?.npc
    const index = npc ? slot.squad.indexOf(npc) : -1
    if (!npc || index < 0 || npc.dead) return
    if (order.order === 'follow') {
      if (slot.proxy) npc.assignFollowTarget(slot.proxy, index, followLocalOffset(index, npc.isMounted))
      return
    }
    npc.setTacticalOrder(order.order)
    const f = order.formation
    if (f && [f.commandId, f.x, f.z, f.yaw].every(Number.isFinite)) {
      const arrival = f.arrivalOrder && TACTICAL_ORDERS.has(f.arrivalOrder) ? f.arrivalOrder : undefined
      npc.assignFormationTarget(guestFormationId(slot.seat, f.commandId), new THREE.Vector3(f.x, f.y ?? 0, f.z),
        new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), Number.isFinite(f.speedLimit) ? f.speedLimit : undefined, arrival)
    }
  }

  private applyGuestHit(slot: CoopGuestSlot, message: CoopMessage): void {
    const proxy = slot.proxy
    const damage = Number(message.damage)
    if (!proxy || proxy.dead || !Number.isFinite(damage) || damage <= 0 || damage > 5000) return
    const id = Number(message.id)
    const contactKind = message.contact === 'shield' || message.contact === 'mount' ? message.contact : 'body'
    const method = message.method === 'projectile' || message.method === 'mount-impact' ? message.method : 'melee'
    const context: CombatDamageContext = {
      source: createNpcCombatActorRef(proxy), method, emit: this.port.combatEmit,
      weaponId: typeof message.weaponId === 'string' ? message.weaponId : undefined,
      contact: { kind: contactKind, time: 0 },
      ...(message.attackSource === 'unarmed' ? { attackSource: 'unarmed' as const } : {}),
    }
    if (message.kind === 'structure') {
      const structure = typeof message.key === 'string' ? this.structures().get(message.key) : undefined
      if (!structure || structure.destroyed) return
      if (this.port.applyGuestStructureHit) this.port.applyGuestStructureHit(structure, damage, context)
      else if (structure.isDamageableBy(proxy.characterFaction)) damageObstacle(structure, damage, context)
      return
    }
    if (message.kind === 'mount') {
      const mount = slot.sentMounts.get(id)
      if (!mount || mount.dead || this.port.acceptsGuestHit?.(mount) === false) return
      if (this.port.applyGuestHit) this.port.applyGuestHit(mount, damage, context)
      else damageMount(mount, damage, context)
      return
    }
    const npc = slot.sentNpcs.get(id)?.npc
    if (!npc || npc.dead || this.port.acceptsGuestHit?.(npc) === false) return
    if (contactKind === 'mount' && npc.mount) context.contact = { kind: 'mount', time: 0, mount: npc.mount }
    if (this.port.applyGuestHit) this.port.applyGuestHit(npc, damage, context)
    else damageNpc(npc, damage, context)
  }

  private showGuestProjectile(slot: CoopGuestSlot, f: FireEvent | undefined): void {
    if (this.port.projectiles === false) return
    if (!Array.isArray(f) || f.length !== 8 || !f.every(Number.isFinite)) return
    const arrow = new ArrowProjectile(this.port.scene, new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(f[3], f[4], f[5]),
      f[6], 0, Faction.PLAYER, false, (f[7] & 1) ? 'pilum' : 'arrow')
    this.port.markVisualArrow(arrow)
    this.port.arrows.push(arrow)
    // The other guests draw it too (a player-side shot).
    this.fire.push({ from: slot.seat, f: [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7] & 1] })
  }
}

// ─────────────────────────────────────────── Guest ──────────────────────────

interface MirrorActor { npc: NPC; frame: CoopActorFrame | null }
interface MirrorMount { mount: Mount; frame: CoopMountFrame | null }

/** Guest-side mission bridge; owns every mirrored actor in the guest Game. */
export class CoopGuestMission {
  private readonly actors = new Map<number, MirrorActor>()
  private readonly mountsById = new Map<number, MirrorMount>()
  private readonly mountIdOf = new WeakMap<Mount, number>()
  private readonly actorIdOf = new WeakMap<NPC, number>()
  private sendTimer = 0
  private lastPos = new THREE.Vector3()
  private speed = 0
  private hostHp: number | null = null
  private ended = false
  /** Mirrors of the guest's own squad; the guest's command menu works on this live list. */
  readonly ownSquad: NPC[] = []
  /** Mirrors the host marked as targets for this guest's attacks (arena opponent). */
  readonly targets: NPC[] = []
  /** The host player's body on this screen; the guest's Player collides with it. */
  hostAvatar: NPC | null = null
  /** The other guests' bodies on this screen; the guest's Player collides with them too. */
  readonly partners: NPC[] = []
  private readonly orderKeys = new WeakMap<NPC, string>()
  private readonly unsubscribe: Array<() => void> = []
  private squadMembers: readonly CareerPersonalSquadMember[] = []
  /** The host's siege vehicles and gates on this screen, once the host sends them. */
  private siege: CoopSiegeMirror | null = null

  constructor(private readonly port: CoopGamePort, private readonly onEnd: (reason: string) => void, private readonly link: CoopSession = coopSession()) {
    this.unsubscribe.push(
      // The host re-announced the scene this page already mirrors: it got there after this page (the Town
      // return loads on both sides at once), so its new host bridge has not heard this guest yet.
      link.on('launch', message => {
        const id = (message.payload as { id?: unknown } | null | undefined)?.id
        if (typeof id === 'string' && id === coopGuestLaunchId() && !this.ended) this.join()
      }),
      link.on('spawn', message => this.applySpawns(message)),
      link.on('ev', message => this.applyEvents(message)),
      link.on('end', () => this.end('主機已結束任務')),
      // The host moved on to a scene another guest follows alone.
      link.on('wait', message => this.end(coopWaitReason(message.scene))),
      link.on('missionMerit', message => {
        const record = parseCoopMissionMerit(message.record)
        if (!record) return
        // The guest's own award, by the same single-player rules, in its own save.
        const result = commitCoopMissionMerit(record)
        showCoopToast('merit' in result ? `任務${record.victory ? '勝利' : '結束'}：你獲得 ${result.merit} 軍功（已存入你自己的生涯存檔）` : result.error)
      }),
      link.on('structures', message => this.applyStructures(message.hp)),
      link.on('siege', message => this.applySiege(message.siege)),
      link.onBinary(bytes => this.applySnapshot(bytes)),
      link.onChange(() => { if (!link.peerConnected) this.end('與主機的連線已中斷') }),
    )
    setDamageInterceptor({
      npc: (npc, damage, context) => this.forwardNpcHit(npc, damage, context),
      mount: (mount, damage, context) => this.forwardMountHit(mount, damage, context),
      player: (_player, damage, context) => this.localPlayerDamage(damage, context),
      obstacle: (obstacle, damage, context) => this.forwardStructureHit(obstacle, damage, context),
    })
    this.lastPos.copy(port.player.position)
    this.join()
  }

  private join(): void {
    this.link.send({ t: 'ready' })
    if (this.squadMembers.length) this.link.send({ t: 'guestSquad', members: this.squadMembers })
  }

  /** Brings the guest's own HR squad into the host's mission. */
  deploySquad(members: readonly CareerPersonalSquadMember[]): void {
    this.squadMembers = members
    if (members.length) this.link.send({ t: 'guestSquad', members })
  }

  /** Follow from the guest's command menu: every own member follows the guest. */
  requestFollow(): boolean {
    if (!this.ownSquad.some(npc => !npc.dead)) return false
    this.ownSquad.forEach((npc, index) => {
      if (npc.dead) return
      npc.assignFollowTarget(this.port.player, index, followLocalOffset(index, npc.isMounted))
      this.orderKeys.set(npc, this.orderKey(npc))
    })
    this.link.send({ t: 'squadFollow' })
    return true
  }

  private orderKey(npc: NPC): string {
    const f = npc.combatFormationCheckpoint
    return `${npc.tacticalOrder}|${f ? `${f.commandId}:${f.position.x.toFixed(1)}:${f.position.z.toFixed(1)}` : ''}`
  }

  /** The local command menu edits mirror orders; forward each change to the real actor on the host. */
  private sendSquadOrders(): void {
    for (const npc of this.ownSquad) {
      const key = this.orderKey(npc)
      if (this.orderKeys.get(npc) === key) continue
      this.orderKeys.set(npc, key)
      const id = this.actorIdOf.get(npc)
      if (id === undefined || npc.dead) continue
      const f = npc.combatFormationCheckpoint
      const order: SquadOrder = { id, order: npc.tacticalOrder,
        ...(f ? { formation: { commandId: f.commandId, x: f.position.x, y: f.position.y, z: f.position.z, yaw: f.position.yaw, speedLimit: f.speedLimit, arrivalOrder: f.arrivalOrder } } : {}) }
      this.link.send({ t: 'order', o: order })
    }
  }

  dispose(): void {
    setDamageInterceptor(null)
    for (const off of this.unsubscribe) off()
    this.siege?.dispose()
    this.siege = null
  }

  /** Every structure this guest may hit, by the host's keys. */
  structures(): Map<string, DamageableObstacle> {
    return coopSiegeStructures(this.siege?.ramps ?? [], this.port.siegeGates?.() ?? new Map(), new Map(this.port.structures?.() ?? []))
  }

  private applySiege(value: unknown): void {
    const wire = parseCoopSiegeWire(value)
    if (!wire || !this.port.siegeMirror || this.ended) return
    this.siege ??= new CoopSiegeMirror({ ...this.port.siegeMirror, gates: this.port.siegeGates?.() ?? new Map() })
    this.siege.apply(wire)
  }

  isMirrorMount(mount: Mount): boolean { return this.mountIdOf.has(mount) }

  /** The other players' bodies here: the host's and every other guest's. */
  get peerBodies(): NPC[] { return this.hostAvatar ? [this.hostAvatar, ...this.partners] : [...this.partners] }

  /** Guest replaces the NPC AI loop with this presentation pass. */
  updateWorld(dt: number): void {
    const k = smoothing(dt)
    const camera = this.port.camera.position
    for (const { mount, frame } of this.mountsById.values()) {
      if (!frame) continue
      const p = mount.group.position
      const far = Math.abs(p.x - frame.x) + Math.abs(p.z - frame.z) > TELEPORT_DISTANCE
      mount.setCameraDistance(p.distanceTo(camera))
      if (!mount.dead) mount.group.visible = (frame.flags & MOUNT_HIDDEN) === 0
      mount.updateCoopPuppet(dt,
        far ? frame.x : p.x + (frame.x - p.x) * k, far ? frame.y : p.y + (frame.y - p.y) * k, far ? frame.z : p.z + (frame.z - p.z) * k,
        mount.group.rotation.y + angleDelta(mount.group.rotation.y, frame.yaw) * k, frame.pitch, frame.speed,
        (frame.flags & MOUNT_DEAD) !== 0, (frame.flags & MOUNT_AIRBORNE) !== 0)
    }
    for (const { npc, frame } of this.actors.values()) {
      const distance = npc.group.position.distanceTo(camera)
      if (!frame) { npc.updateCoopPuppet(dt, distance, this.idle(npc)); continue }
      const mount = frame.mountId !== COOP_NO_ID ? this.mountsById.get(frame.mountId)?.mount ?? null : null
      syncMountRider(npc, mount)
      const p = npc.group.position
      const far = Math.abs(p.x - frame.x) + Math.abs(p.z - frame.z) > TELEPORT_DISTANCE
      if (!npc.dead) npc.group.visible = (frame.flags & ACTOR_HIDDEN) === 0
      npc.updateCoopPuppet(dt, distance, {
        x: far ? frame.x : p.x + (frame.x - p.x) * k, y: far ? frame.y : p.y + (frame.y - p.y) * k, z: far ? frame.z : p.z + (frame.z - p.z) * k,
        yaw: npc.group.rotation.y + angleDelta(npc.group.rotation.y, frame.yaw) * k,
        speed: frame.speed, action: frame.action, ranged: (frame.flags & ACTOR_RANGED) !== 0, shieldRaised: (frame.flags & ACTOR_SHIELD) !== 0,
        sprinting: (frame.flags & ACTOR_SPRINT) !== 0, draw: frame.draw, hp: frame.hp, dead: (frame.flags & ACTOR_DEAD) !== 0,
        ...((frame.flags & (ACTOR_MELEE_STOWED | ACTOR_SHIELD_STOWED)) !== 0
          ? { meleeStowed: (frame.flags & ACTOR_MELEE_STOWED) !== 0, shieldStowed: (frame.flags & ACTOR_SHIELD_STOWED) !== 0 } : {}),
      })
    }
    this.siege?.update(dt)
    this.applyHostHp()
    this.sendSquadOrders()
    this.sendState(dt)
  }

  /** Game routes the guest player's own projectiles here so the host can draw them. */
  onProjectile(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, kind: ProjectileVisualKind): void {
    this.link.send({ t: 'fire', f: [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, speed, kind === 'pilum' ? 1 : 0] })
  }

  private end(reason: string): void {
    if (this.ended) return
    this.ended = true
    this.onEnd(reason)
  }

  private idle(npc: NPC): Parameters<NPC['updateCoopPuppet']>[2] {
    const p = npc.group.position
    return { x: p.x, y: p.y, z: p.z, yaw: npc.group.rotation.y, speed: 0, action: 'idle', ranged: false, shieldRaised: false, sprinting: false, draw: 0, hp: npc.hp, dead: npc.dead }
  }

  private applySpawns(message: CoopMessage): void {
    for (const id of (message.goneNpcs as number[] | undefined) ?? []) this.removeActor(id)
    for (const id of (message.goneMounts as number[] | undefined) ?? []) this.removeMount(id)
    for (const spawn of (message.mounts as SpawnMount[] | undefined) ?? []) {
      if (this.mountsById.has(spawn.id)) continue
      let type: MountType
      try { type = mountTypeFromSave(spawn.type) } catch { continue }
      const mount = new Mount(this.port.scene, type, spawn.x, spawn.z, spawn.y, spawn.variant as 0)
      mount.coopPuppet = true
      mount.group.rotation.y = spawn.yaw
      this.mountsById.set(spawn.id, { mount, frame: null })
      this.mountIdOf.set(mount, spawn.id)
      this.port.mounts.push(mount)
      this.port.registerMount(mount)
    }
    for (const spawn of (message.actors as SpawnActor[] | undefined) ?? []) {
      const previous = this.actors.get(spawn.id)
      this.removeActor(spawn.id)
      let npc: NPC
      try { npc = NPC.fromNetworkDescriptor(this.port.scene, spawn.d) } catch (error) { console.warn('[coop] could not mirror actor', error); continue }
      npc.coopPuppet = true
      if (spawn.hp < npc.maxHp) npc.takeFallDamage(Math.max(0, npc.maxHp - Math.max(1, spawn.hp)))
      if (previous?.frame) npc.group.position.set(previous.frame.x, previous.frame.y, previous.frame.z)
      this.actors.set(spawn.id, { npc, frame: previous?.frame ?? null })
      this.actorIdOf.set(npc, spawn.id)
      if (spawn.target) this.targets.push(npc)
      if (spawn.avatar) this.hostAvatar = npc
      if (spawn.partner) this.partners.push(npc)
      if (spawn.own) {
        // Mirrors start following the guest, like the real members on the host.
        npc.assignFollowTarget(this.port.player, this.ownSquad.length, followLocalOffset(this.ownSquad.length, npc.isMounted))
        this.orderKeys.set(npc, this.orderKey(npc))
        this.ownSquad.push(npc)
      }
      this.port.npcs.push(npc)
      this.port.registerNpc(npc)
    }
  }

  private removeActor(id: number): void {
    const actor = this.actors.get(id)
    if (!actor) return
    this.actors.delete(id)
    removeFrom(this.ownSquad, actor.npc)
    removeFrom(this.targets, actor.npc)
    removeFrom(this.partners, actor.npc)
    if (this.hostAvatar === actor.npc) this.hostAvatar = null
    this.port.unregisterNpc(actor.npc)
    removeFrom(this.port.npcs, actor.npc)
    actor.npc.dispose()
  }

  private removeMount(id: number): void {
    const entry = this.mountsById.get(id)
    if (!entry) return
    this.mountsById.delete(id)
    for (const actor of this.actors.values()) if (actor.npc.mount === entry.mount) actor.npc.dismountFromMount()
    this.port.unregisterMount(entry.mount)
    removeFrom(this.port.mounts, entry.mount)
    entry.mount.dispose()
  }

  private applySnapshot(bytes: Uint8Array): void {
    const snapshot = decodeSnapshot(bytes)
    if (!snapshot) return
    for (const frame of snapshot.actors) { const actor = this.actors.get(frame.id); if (actor) actor.frame = frame }
    for (const frame of snapshot.mounts) { const entry = this.mountsById.get(frame.id); if (entry) entry.frame = frame }
    this.hostHp = snapshot.guestHp >= 0 ? snapshot.guestHp : null
  }

  private applyEvents(message: CoopMessage): void {
    if (this.port.projectiles === false) return
    for (const f of (message.fire as FireEvent[] | undefined) ?? []) {
      if (!Array.isArray(f) || f.length !== 8 || !f.every(Number.isFinite)) continue
      const arrow = new ArrowProjectile(this.port.scene, new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(f[3], f[4], f[5]),
        f[6], 0, (f[7] & 2) ? Faction.ENEMY : Faction.PLAYER, false, (f[7] & 1) ? 'pilum' : 'arrow')
      this.port.markVisualArrow(arrow)
      this.port.arrows.push(arrow)
    }
  }

  private applyHostHp(): void {
    const player = this.port.player
    if (this.hostHp === null || player.dead) return
    const hp = Math.min(player.maxHp, this.hostHp)
    if (hp < player.hp - 0.05) {
      // Exact host HP: fall damage skips local hero reductions, the host already applied them.
      player.takeFallDamage(player.hp - Math.max(0, hp), this.port.hpBar)
    } else if (hp > player.hp + 0.05) {
      player.setHp(hp)
      this.port.hpBar.setFill(player.hpRatio)
    }
  }

  private sendState(dt: number): void {
    const player = this.port.player
    const p = playerFeet(player)
    if (dt > 0) this.speed = this.speed + (Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / dt - this.speed) * Math.min(1, dt * 10)
    this.lastPos.set(p.x, p.y, p.z)
    this.sendTimer += dt
    if (this.sendTimer < SNAPSHOT_INTERVAL) return
    this.sendTimer %= SNAPSHOT_INTERVAL
    const action = player.combatAnimationAction
    const ownMount = player.isMounted ? player.currentMount : this.port.ownMount
    const state: CoopGuestState = {
      x: p.x, y: p.y, z: p.z, yaw: player.facingYaw, speed: player.isMounted ? player.currentMount?.movementSpeed ?? 0 : this.speed,
      action, flags: playerActionFlags(this.port, action), draw: player.bowDrawRatio, riding: player.isMounted,
      mount: ownMount && !ownMount.disposed && !this.isMirrorMount(ownMount) ? mountState(ownMount) : null,
      look: playerLook(this.port),
      maxHp: player.maxHp,
      ...(this.port.borrowedMountKey?.() ? { borrowed: this.port.borrowedMountKey()! } : {}),
    }
    this.link.send({ t: 'guest', s: state })
  }

  private forwardNpcHit(npc: NPC, damage: number, context?: CombatDamageContext): DamageResult | undefined {
    const id = this.actorIdOf.get(npc)
    if (id === undefined) return undefined
    // Only the guest's own attacks count; local puppet-vs-puppet contacts are the host's to judge.
    if (context?.source.actorType !== 'player') return this.ignored(npc.combatantId, npcCombatDisplayName(npc), npc.hpRatio, false, damage)
    const contact = context?.contact?.kind ?? 'body'
    if (contact === 'mount') {
      const mount = context?.contact?.mount ?? npc.mount
      if (mount) return this.forwardMountHit(mount, damage, context) ?? undefined
    }
    if (npc.dead) return { hitSuccess: false, requestedDamage: damage, appliedDamage: 0, blockedImpact: 0, targetId: npc.combatantId, targetName: npcCombatDisplayName(npc), killed: false, hpRatio: 0, isMountHit: false, mountDied: false }
    this.link.send({ t: 'hit', kind: 'npc', id, damage, method: context?.method ?? 'melee', contact, weaponId: context?.weaponId,
      attackSource: context?.attackSource ?? context?.contact?.attackSource })
    const blocked = contact === 'shield'
    const applied = blocked ? 0 : Math.min(npc.hp, damage)
    return {
      hitSuccess: true, requestedDamage: damage, appliedDamage: applied, blockedImpact: blocked ? damage : 0, targetId: npc.combatantId,
      targetName: npcCombatDisplayName(npc), killed: false, hpRatio: Math.max(0, (npc.hp - applied) / npc.maxHp), isMountHit: false, mountDied: false,
    }
  }

  private forwardMountHit(mount: Mount, damage: number, context?: CombatDamageContext): DamageResult | undefined {
    const id = this.mountIdOf.get(mount)
    if (id === undefined) return undefined
    if (context?.source.actorType !== 'player') return this.ignored(`mount:${id}`, mount.mountDisplayName, mount.currentHp / mount.maxHp, true, damage)
    if (!mount.dead) this.link.send({ t: 'hit', kind: 'mount', id, damage, method: context?.method ?? 'melee', contact: 'mount', weaponId: context?.weaponId })
    return {
      hitSuccess: !mount.dead, requestedDamage: damage, appliedDamage: mount.dead ? 0 : Math.min(mount.currentHp, damage), blockedImpact: 0,
      targetId: `mount:${id}`, targetName: mount.mountDisplayName, killed: false,
      hpRatio: Math.max(0, (mount.currentHp - damage) / mount.maxHp), isMountHit: true, mountDied: false,
    }
  }

  /** Structures break only on the host; the guest's own hit is a request, its HP comes back from the host. */
  private forwardStructureHit(structure: DamageableObstacle, damage: number, context?: CombatDamageContext): DamageableObstacleHitResult {
    const unchanged = { appliedDamage: 0, remainingHp: structure.currentHp, hpRatio: structure.hpRatio, destroyed: structure.destroyed }
    if (structure.destroyed || context?.source.actorType !== 'player' || !Number.isFinite(damage) || damage <= 0) return unchanged
    let key: string | undefined
    for (const [candidate, value] of this.structures()) if (value === structure) { key = candidate; break }
    if (!key) return unchanged
    this.link.send({ t: 'hit', kind: 'structure', key, damage, method: context.method, weaponId: context.weaponId })
    const applied = Math.min(structure.currentHp, damage)
    return { appliedDamage: applied, remainingHp: structure.currentHp - applied, hpRatio: (structure.currentHp - applied) / structure.maxHp, destroyed: false }
  }

  private applyStructures(value: unknown): void {
    if (!Array.isArray(value)) return
    const structures = this.structures()
    for (const entry of value) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isFinite(entry[1])) continue
      const structure = structures.get(entry[0]), hp = Number(entry[1])
      if (!structure || structure.destroyed) continue
      if (hp <= 0) structure.destroy()
      else if (hp < structure.currentHp) structure.takeDamage(structure.currentHp - hp)
    }
  }

  private ignored(targetId: string, targetName: string, hpRatio: number, isMountHit: boolean, damage: number): DamageResult {
    return { hitSuccess: false, requestedDamage: damage, appliedDamage: 0, blockedImpact: 0, targetId, targetName, killed: false, hpRatio, isMountHit, mountDied: false }
  }

  /** Only the guest's own environment hurts it locally; everything else comes from host HP. */
  private localPlayerDamage(damage: number, context?: CombatDamageContext): DamageResult | undefined {
    if (context?.method === 'fall') {
      this.link.send({ t: 'selfDamage', damage })
      return undefined
    }
    return { hitSuccess: false, requestedDamage: damage, appliedDamage: 0, blockedImpact: 0, targetId: 'player', targetName: 'Player', killed: false, hpRatio: this.port.player.hpRatio, isMountHit: false, mountDied: false }
  }
}
