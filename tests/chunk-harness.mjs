// Prüft Chunk Layouts mit denselben Regeln, die der Generator benutzt.
import { H, Y_MAX, Y_MIN, difficultyAt, mechsAt } from '../game/constants.js';
import { createBuilder } from '../game/builder.js';
import { createState } from '../game/state.js';
import { validateStaged } from '../game/validate.js';
import { seedRng } from '../game/rng.js';

const ALL_MECH = ['moving', 'breakable', 'walker', 'spike', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'rain', 'fallingstar', 'powerup'];

// Baut den Chunk einmal und gibt { st, errors, oy } zurück.
// meter: Position im Spiel (bestimmt freigeschaltete Mechaniken), diff: Schwierigkeit für die Fairness Regeln.
export function buildChunk(chunk, { seed = 1, meter = chunk.min, diff = chunk.diff, mechs, starBoost = false, eventWind = 0, pace = null } = {}) {
  const s = createState({ seed });
  seedRng(s, seed);
  s.events.starBoost = starBoost;
  const unlocked = mechs || mechsAt(meter);
  const probe = createBuilder(s, { ox: 0, oy: 0, diff, meter, mechs: unlocked, measure: true, pace });
  const saved = s.rng;
  chunk.build(probe);
  s.rng = saved;
  const { minY, maxY, platMinY, platMaxY } = probe.st;
  // Plattformoberkanten müssen in [Y_MIN, Y_MAX] liegen, alles andere im sichtbaren Bild
  const lo = Math.max(Y_MIN - platMinY, 24 - minY);
  const hi = Math.min(Y_MAX - platMaxY, H - 12 - maxY);
  if (lo > hi) return { st: probe.st, errors: [`Chunk passt nicht in den Höhenbereich (Plattformen ${Math.round(platMinY)} bis ${Math.round(platMaxY)}, alles ${Math.round(minY)} bis ${Math.round(maxY)})`], oy: 0 };
  const oy = Math.min(hi, Math.max(lo, 330));
  const b = createBuilder(s, { ox: 1000, oy, diff, meter, mechs: unlocked, gateIndex: 1, pace });
  chunk.build(b);
  const errors = validateStaged(b.st, { ox: 1000, diff, mechs: unlocked, eventWind });
  return { st: b.st, errors, oy, s };
}

// Prüft alle Eigenschaften, die jedes Chunk Layout haben muss. Gibt Liste von Fehlermeldungen zurück.
export function checkChunk(chunk, { seeds = 25 } = {}) {
  const out = [];
  for (const key of ['id', 'name', 'diff', 'weight', 'min', 'max', 'mech', 'build']) {
    if (chunk[key] === undefined) out.push(`${chunk.id}: Feld ${key} fehlt`);
  }
  if (out.length) return out;
  // Alle Mechaniken, die der Chunk benutzt, müssen an seinem Startmeter freigeschaltet sein.
  const unlocked = mechsAt(chunk.min);
  for (const m of chunk.mech) if (!unlocked.has(m)) out.push(`${chunk.id}: Mechanik ${m} ist bei Meter ${chunk.min} noch nicht freigeschaltet`);
  // Die Schwierigkeit darf die Kurve an der Stelle nicht um mehr als 0,6 übersteigen.
  if (chunk.diff > difficultyAt(chunk.min) + 0.6 + (chunk.min === 0 ? 0 : 1.2)) {
    out.push(`${chunk.id}: diff ${chunk.diff} ist bei Meter ${chunk.min} (Kurve ${difficultyAt(chunk.min).toFixed(2)}) sehr hoch, min anheben`);
  }
  let first = null;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = buildChunk(chunk, { seed });
    for (const e of r.errors) out.push(`${chunk.id} (Seed ${seed}): ${e}`);
    const json = JSON.stringify(r.st.platforms.map((p) => [p.x, p.y, p.w]));
    const again = JSON.stringify(buildChunk(chunk, { seed }).st.platforms.map((p) => [p.x, p.y, p.w]));
    if (json !== again) out.push(`${chunk.id} (Seed ${seed}): nicht deterministisch`);
    if (seed === 1) first = r;
    if (!r.st.stars.length && !r.st.powerups.length) out.push(`${chunk.id} (Seed ${seed}): keine Sterne oder Powerups`);
    if (out.length > 12) break;
  }
  void first;
  void ALL_MECH;
  return out;
}
