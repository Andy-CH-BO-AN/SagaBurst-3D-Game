/** Shared bottom-screen interaction prompt and short completion feedback. */
export class PickupPrompt {
  private readonly prompt = document.getElementById('pickup-prompt')!
  private readonly feedback = document.getElementById('pickup-feedback')!
  private timer: number | null = null

  show(text: string | null): void {
    this.prompt.textContent = text ?? ''
    this.prompt.classList.toggle('visible', Boolean(text))
  }
  notify(text: string): void {
    this.feedback.textContent = text
    this.feedback.classList.add('visible')
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = window.setTimeout(() => { this.feedback.classList.remove('visible'); this.timer = null }, 1800)
  }
  dispose(): void {
    this.show(null)
    this.feedback.classList.remove('visible')
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
