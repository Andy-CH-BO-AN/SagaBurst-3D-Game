/** What a visit to the Sergeant's deployment service may open, in the order it is decided. */
export interface DeploymentVisitPorts {
  /** False while the player is dead or the service is out of reach. */
  available(): boolean
  /** An unclaimed finished mission is shown instead of any other page. */
  showPendingResult(): boolean
  story?: { hasDialogue(id: 'deployment'): boolean }
  tutorial?: { hasDialogue(id: 'deployment'): boolean }
  showStory(): void
  showTutorial(): void
  /** The regular service panel; `reopen` is how its tabs re-render the same visit. */
  showServices(reopen: () => void): void
}

/**
 * Opens the deployment service. `bypassIntro` is set when the player explicitly asked for the regular
 * service (talk()'s one-shot bypass); the visit keeps it for every re-render, because the board's later
 * tab clicks outlive that bypass and must stay in the service panel, while a fresh visit shows the intro.
 */
export function openDeploymentVisit(bypassIntro: boolean, ports: DeploymentVisitPorts): void {
  if (!ports.available()) return
  if (ports.showPendingResult()) return
  if (!bypassIntro && ports.story?.hasDialogue('deployment')) { ports.showStory(); return }
  if (!bypassIntro && ports.tutorial?.hasDialogue('deployment')) { ports.showTutorial(); return }
  ports.showServices(() => openDeploymentVisit(bypassIntro, ports))
}
