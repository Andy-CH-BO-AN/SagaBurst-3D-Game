import { prisonExitPlan, prisonGateObstacle } from './PrisonBreakLayout'
import * as THREE from 'three'
import type { DuelArenaEnvironment } from './DuelArena'
import { PRISON_SWORD_COUNT, PRISON_SWORD_ID, type PrisonBreakState } from '../career/CareerPrisonBreak'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import type { ObstacleData } from '../world/Terrain'

/** Encounter-owned iron gate and six existing T1 sword meshes. Shared weapon resources are not disposed. */
export class PrisonBreakProps {
  private readonly gate = new THREE.Group()
  private readonly exit = new THREE.Group()
  private readonly iron = new THREE.MeshStandardMaterial({ color: 0x42484b, metalness: .8, roughness: .45 })
  private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffdb75, transparent: true, opacity: .7, depthTest: false })
  private readonly ownedGeometry: THREE.BufferGeometry[] = []
  private readonly blocker: ObstacleData
  readonly swords: THREE.Group[] = []
  private open = false
  private lift = 0
  private readonly height: number
  constructor(private readonly arena: DuelArenaEnvironment, state: PrisonBreakState) {
    const plan = prisonExitPlan(arena.id), z = plan.gateZ
    this.height = plan.height
    const bar = (w: number, h: number, x: number, y: number) => {
      const g = new THREE.BoxGeometry(w, h, .12); this.ownedGeometry.push(g)
      const mesh = new THREE.Mesh(g, this.iron); mesh.position.set(x, y, 0); this.gate.add(mesh)
    }
    for (let i = -4; i <= 4; i++) bar(.07, this.height, i * .31, this.height / 2)
    for (const y of [.4, 1.3, 2]) bar(2.8, .09, 0, y)
    this.gate.position.set(0, 0, z); this.gate.name = 'prison-iron-gate'; arena.root.add(this.gate)
    this.blocker = prisonGateObstacle(arena.id)
    arena.obstacles.push(this.blocker)
    const ring = new THREE.TorusGeometry(.65, .07, 6, 24); this.ownedGeometry.push(ring)
    this.exit.add(new THREE.Mesh(ring, this.markerMaterial)); this.exit.position.set(0, 1.5, z + .4)
    this.exit.name = 'prison-exit-marker'; arena.root.add(this.exit)
    // Spread weapons over the clear central floor, with one directly beside the player's spawn.
    for (let i = 0; i < PRISON_SWORD_COUNT; i++) {
      const sword = new THREE.Group(); sword.name = `prison-sword-${i}`
      WeaponMeshFactory.buildPickupMesh(PRISON_SWORD_ID, false, 0xf0cf72, sword)
      sword.position.set([-1.3, -5, 5, -6, 6, 0][i], .22, [4, -1, -2, -8, -10, 10][i])
      sword.rotation.z = Math.PI / 2; sword.visible = state.swords[i] === undefined
      arena.root.add(sword); this.swords.push(sword)
    }
    this.setOpen(state.gateOpen, false)
  }
  setOpen(open: boolean, animate: boolean): void {
    this.open = open; this.exit.visible = open
    const index = this.arena.obstacles.indexOf(this.blocker)
    if (open && index >= 0) this.arena.obstacles.splice(index, 1)
    if (!animate) this.lift = open ? this.height + .2 : 0
    this.gate.position.y = this.lift
  }
  update(dt: number): void {
    if (this.open) this.lift = Math.min(this.height + .2, this.lift + dt * 2.5)
    this.gate.position.y = this.lift
  }
  syncSwords(state: PrisonBreakState): void { this.swords.forEach((mesh, i) => { mesh.visible = state.swords[i] === undefined }) }
  dispose(): void {
    this.gate.removeFromParent(); this.exit.removeFromParent()
    for (const sword of this.swords) {
      sword.removeFromParent()
      // T1 gladius construction creates instance geometry; its procedural materials remain shared.
      sword.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose() })
    }
    const index = this.arena.obstacles.indexOf(this.blocker)
    if (index >= 0) this.arena.obstacles.splice(index, 1)
    this.ownedGeometry.forEach(g => g.dispose()); this.iron.dispose(); this.markerMaterial.dispose()
  }
}
