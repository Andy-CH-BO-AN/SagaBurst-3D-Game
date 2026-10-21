import * as THREE from 'three'
import type { Player } from '../../src/player/Player'

/** Data-only Player boundary for Game's Career settlement + checkpoint callers; zero actors/GLBs. */
export function careerCheckpointPlayer(dead = false): Pick<Player,
  'group' | 'combatPosition' | 'dead' | 'hp' | 'staminaValue' | 'arrowCount' | 'isFalling' | 'currentMount'>
  & { shield: Pick<Player['shield'], 'shieldImpactRemaining'> } {
  const position = new THREE.Vector3()
  // Settlement reads transform data only and must not allocate a render object.
  const group = { position, rotation: { y: 0 } } as unknown as Player['group']
  return { group, combatPosition: position, dead, hp: dead ? 0 : 100, staminaValue: 100,
    arrowCount: 20, isFalling: false, currentMount: null, shield: { shieldImpactRemaining: 0 } }
}
