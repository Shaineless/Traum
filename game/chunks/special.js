// STUB: wird von einem Agenten umgesetzt. Spezial Chunks: Fallback 'flat' und das Traumtor 'gate'.
export const FLAT = {
  id: 'flat', name: 'Flach', diff: 1, weight: 0, min: 0, max: Infinity, mech: [], rest: true,
  build(b) { const g = b.ground(0, 0, 520); b.starsOver(g, 4, 55); b.route(g); },
};
export const GATE = {
  id: 'gate', name: 'Traumtor', diff: 1, weight: 0, min: 0, max: Infinity, mech: [], rest: true, special: 'gate',
  build(b) { const g = b.ground(0, 0, 640); b.gate(g, 0.5); b.starsOver(g, 6, 55); b.route(g); },
};
