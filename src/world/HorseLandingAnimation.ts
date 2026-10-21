/** Visual contact history only; never changes mount position or velocity. */
export class HorseLandingAnimation {
  private hasGrounded = false
  private airborneSeconds = 0
  private peakHeight = 0

  reset(): void {
    this.hasGrounded = false
    this.airborneSeconds = 0
    this.peakHeight = 0
  }

  update(dt: number, onGround: boolean, height: number, pendingJump: boolean): boolean {
    if (!onGround) {
      this.airborneSeconds += dt
      this.peakHeight = Math.max(this.peakHeight, height)
      return false
    }

    // Require both sustained airtime and a real descent for uncommanded falls.
    // Tiny terrain-following gaps must not continually restart locomotion.
    const landed = pendingJump || (this.hasGrounded
      && this.airborneSeconds >= 0.12
      && this.peakHeight - height >= 0.2)
    this.hasGrounded = true
    this.airborneSeconds = 0
    this.peakHeight = height
    return landed
  }
}
