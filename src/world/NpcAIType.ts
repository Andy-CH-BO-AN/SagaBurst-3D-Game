// Lightweight owner of the NPC AI classification so domain modules that only need
// the enum do not load the NPC runtime (scene, rig, navigation) through NPC.ts.
export enum AIType {
  MELEE = 'MELEE',
  RANGED = 'RANGED',
}
