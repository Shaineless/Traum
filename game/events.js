// STUB: wird von einem Agenten umgesetzt.
export function updateEvents(s, dt) {}
export function startEvent(s, type) {}
// Zusätzlicher Wind durch das Ereignis Traumsturm, px/s
export function eventWindVx(s) { return 0; }
// Hüllkurve des aktiven Ereignisses für die Darstellung: { type, env 0..1, t, dur } oder null
export function eventEnvelope(s) { return null; }
