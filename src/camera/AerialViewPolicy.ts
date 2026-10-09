import * as THREE from 'three'

/** Only viewing distance changes: model LODs, AI, contacts and HUD retain their own policies. */
export const AERIAL_VIEW = { cameraFar: 700, fogNear: 300, fogFar: 700, observerMinAGL: 15 } as const

export function usesAerialView(ridingEagle: boolean, observing: boolean, cameraAGL: number): boolean {
  return ridingEagle || observing && cameraAGL >= AERIAL_VIEW.observerMinAGL
}

/** Scene-local reversible policy. Capture each scene's actual ground settings after initialization. */
export class AerialViewPolicy {
  private groundFar: number | undefined
  private groundFog: { fog: THREE.Fog; near: number; far: number } | undefined

  update(camera: THREE.PerspectiveCamera, scene: THREE.Scene, active: boolean): void {
    this.groundFar ??= camera.far
    if (scene.fog instanceof THREE.Fog && this.groundFog?.fog !== scene.fog) {
      this.groundFog = { fog: scene.fog, near: scene.fog.near, far: scene.fog.far }
    }
    const far = active ? Math.max(this.groundFar, AERIAL_VIEW.cameraFar) : this.groundFar
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix() }
    if (this.groundFog?.fog === scene.fog) {
      scene.fog.near = active ? Math.max(this.groundFog.near, AERIAL_VIEW.fogNear) : this.groundFog.near
      scene.fog.far = active ? Math.max(this.groundFog.far, AERIAL_VIEW.fogFar) : this.groundFog.far
    }
  }
}
