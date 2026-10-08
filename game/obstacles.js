// STUB: wird von einem Agenten umgesetzt.
export function updateObstacles(s, dt) {}
export function playerVsHazards(s) {}
export function clearHazardsNear(s, x0, x1) {}
// Wirkung von Windzonen (und Sturm Ereignis) auf einen Punkt: { vx, ay }
export function windAt(s, x, y) { return { vx: 0, ay: 0 }; }
// Regenstärke 0..1 an einem Punkt
export function rainAt(s, x, y) { return 0; }
