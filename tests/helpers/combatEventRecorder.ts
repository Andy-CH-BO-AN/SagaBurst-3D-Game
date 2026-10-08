import { CombatEventStream, type CombatEvent } from '../../src/combat/CombatAttribution'

/** The consumer owns the subscription; importing this helper changes no lifecycle. */
export function createCombatEventRecorder(own: (unsubscribe: () => void) => void) {
  const events: CombatEvent[] = []
  const stream = new CombatEventStream()
  own(stream.subscribe(event => events.push(event)))
  return { events, stream }
}
