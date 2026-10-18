/** Existing projectile owners return void on success; only explicit rejection retains ammo. */
export type ProjectileLaunchResult = boolean | void

export function projectileAmmoAfterLaunch(ammo: number, result: ProjectileLaunchResult): number {
  return result === false ? ammo : Math.max(0, ammo - 1)
}

/** Admission owns capacity, not projectile physics, lifetime, or actor firing cadence. */
export class ProjectileAdmission {
  private acceptedShots = 0
  private rejectedShots = 0
  private capacityRejectedShots = 0
  private peakActiveShots = 0

  constructor(private readonly maximumActive: number, private readonly maximumTraining: number) {}

  reject(): false { this.rejectedShots++; return false }

  launch(activeCount: number, trainingCount: number, training: boolean, spawn: () => void): boolean {
    if (activeCount >= this.maximumActive || training && trainingCount >= this.maximumTraining) {
      this.capacityRejectedShots++
      return this.reject()
    }
    spawn()
    this.acceptedShots++
    this.peakActiveShots = Math.max(this.peakActiveShots, activeCount + 1)
    return true
  }

  snapshot() {
    return { acceptedShots: this.acceptedShots, rejectedShots: this.rejectedShots,
      capacityRejectedShots: this.capacityRejectedShots, peakActiveShots: this.peakActiveShots }
  }
}
