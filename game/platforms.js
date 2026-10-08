// STUB: wird von einem Agenten umgesetzt.
export function updatePlatforms(s, dt) {}
export function onPlayerLand(s, plat) {}
export const isSolid = (plat) => plat.kind !== 'breakable' || plat.state !== 'broken';
export const platformById = (s, id) => s.platforms.find((p) => p.id === id) || null;
