// Farbpalette der aktuellen Traumwelt, weich zwischen zwei Welten überblendet.

import { WORLDS } from './constants.js';

function parse(c) {
  if (c[0] === '#') {
    const n = c.length === 4 ? c.replace(/./g, (m, i) => (i ? m + m : m)) : c;
    return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16), 1];
  }
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m[3] === undefined ? 1 : m[3]];
}

function mix(a, b, k) {
  if (k <= 0 || a === b) return a;
  if (k >= 1) return b;
  const pa = parse(a);
  const pb = parse(b);
  const v = pa.map((x, i) => x + (pb[i] - x) * k);
  return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${+v[3].toFixed(3)})`;
}

const KEYS = ['ground', 'groundTop', 'float', 'cloud', 'star', 'moon', 'accent', 'mist'];

// Gibt { name, sky: [3 Farben], ground, groundTop, float, cloud, star, moon, accent, mist, index }
export function themeAt(world) {
  const a = WORLDS[world.from % WORLDS.length];
  const b = WORLDS[world.to % WORLDS.length];
  const k = world.blend >= 1 ? 1 : world.blend <= 0 ? 0 : world.blend * world.blend * (3 - 2 * world.blend);
  const out = { name: k < 0.5 ? a.name : b.name, index: k < 0.5 ? world.from : world.to, sky: a.sky.map((c, i) => mix(c, b.sky[i], k)) };
  for (const key of KEYS) out[key] = mix(a[key], b[key], k);
  return out;
}
