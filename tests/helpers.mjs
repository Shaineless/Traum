// Gemeinsame Hilfen für die Tests: Läufe ohne Browser, Invarianten Prüfung.
import { LIMITS, STEP } from '../game/constants.js';
import { createState } from '../game/state.js';
import { initGenerator } from '../game/generator.js';
import { activeEnemies, stepSim } from '../game/sim.js';

export function newGame(seed = 1) {
  const s = createState({ seed });
  initGenerator(s);
  return s;
}

export const input = (o = {}) => ({ move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, slamPressed: false, throwPressed: false, downHeld: false, ...o });

// Läuft frames Schritte; inputFn(s, i) liefert die Eingabe. Bricht bei mode 'over' ab.
export function run(s, frames, inputFn = () => input({ move: 1 })) {
  for (let i = 0; i < frames; i++) {
    stepSim(s, inputFn(s, i), STEP);
    if (s.mode === 'over') break;
  }
  return s;
}

function finiteDeep(v, path, errors, depth = 0) {
  if (depth > 4) return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) errors.push(`${path} ist ${v}`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => finiteDeep(x, `${path}[${i}]`, errors, depth + 1));
  } else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) finiteDeep(v[k], `${path}.${k}`, errors, depth + 1);
  }
}

// Gibt eine Liste von Verstößen zurück (leer = alles in Ordnung)
export function invariants(s) {
  const errors = [];
  for (const key of ['player', 'platforms', 'enemies', 'hazards', 'zones', 'stars', 'powerups', 'gates', 'run', 'combo', 'fx', 'camX']) {
    finiteDeep(s[key], key, errors);
  }
  if (s.platforms.length > LIMITS.MAX_PLATFORMS) errors.push(`zu viele Plattformen: ${s.platforms.length}`);
  if (s.particles.length > LIMITS.MAX_PARTICLES) errors.push(`zu viele Partikel: ${s.particles.length}`);
  if (s.popups.length > LIMITS.MAX_POPUPS) errors.push(`zu viele Popups: ${s.popups.length}`);
  if (s.stars.length > LIMITS.MAX_STARS) errors.push(`zu viele Sterne: ${s.stars.length}`);
  if (s.hazards.length > LIMITS.MAX_HAZARDS) errors.push(`zu viele Hindernisse: ${s.hazards.length}`);
  if (activeEnemies(s) > LIMITS.MAX_ENEMIES_ACTIVE) errors.push(`zu viele aktive Gegner: ${activeEnemies(s)}`);
  const ids = new Set();
  for (const list of [s.platforms, s.enemies, s.hazards, s.zones, s.stars, s.powerups, s.gates]) {
    for (const e of list) {
      if (ids.has(e.id)) errors.push(`doppelte id ${e.id}`);
      ids.add(e.id);
    }
  }
  try {
    structuredClone(s);
  } catch (err) {
    errors.push(`Zustand nicht kopierbar: ${err.message}`);
  }
  return errors;
}
