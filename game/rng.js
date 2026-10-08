// Deterministischer Zufall (mulberry32). Der Zustand liegt in s.rng,
// damit ein Spielzustand kopiert und exakt weitergespielt werden kann.

export function seedRng(s, seed) {
  s.rng = (seed >>> 0) || 0x9e3779b9;
}

export function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (s, a, b) => a + rand(s) * (b - a);
export const int = (s, a, b) => Math.floor(range(s, a, b + 1)); // inklusive b
export const chance = (s, p) => rand(s) < p;
export const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
export const sign = (s) => (rand(s) < 0.5 ? -1 : 1);

export function pickWeighted(s, items, weightOf) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (total <= 0) return null;
  let r = rand(s) * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
