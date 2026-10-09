// Menschenähnlicher Bot: wie bot.mjs, aber mit Reaktionsverzögerung, kurzer Vorausschau und
// gelegentlichen Fehlern. Er misst, wie viele Treffer ein normaler Spieler pro Abschnitt zu erwarten hat.
// Der perfekte Bot aus bot.mjs sagt nur, dass etwas lösbar ist. Dieser sagt, wie schwer es ist.
import { H, STEP } from '../game/constants.js';
import { chunkAt } from '../game/generator.js';
import { meters } from '../game/scoring.js';
import { stepSim } from '../game/sim.js';
import { newGame } from './helpers.mjs';

export const SKILLS = {
  pro: { delay: 4, horizon: 54, every: 6, mistake: 0.01 },
  normal: { delay: 9, horizon: 40, every: 8, mistake: 0.035 },
  casual: { delay: 14, horizon: 30, every: 10, mistake: 0.07 },
};

const IDLE = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false };

function scripts() {
  const list = [{ id: 'run', f: () => ({ ...IDLE, move: 1 }) }];
  for (const move of [1, 0]) {
    for (const jf of [0, 4, 9, 15, 22]) {
      for (const dbl of [-1, 24, 36]) {
        list.push({
          id: `j${move}:${jf}:${dbl}`,
          f: (i) => ({ move, jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1), jumpHeld: (i >= jf && i < jf + 22) || (dbl >= 0 && i >= jf + dbl && i < jf + dbl + 18), dashPressed: false, downHeld: true }),
        });
      }
    }
  }
  list.push({ id: 'wait', f: () => IDLE });
  return list;
}
const SCRIPTS = scripts();

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function evaluate(s, script, horizon) {
  const c = structuredClone({ ...s, particles: [], popups: [] });
  const x0 = c.player.x;
  const lives0 = c.lives;
  let t = 0;
  for (let i = 0; i < horizon; i++) {
    stepSim(c, script.f(i), STEP);
    t++;
    if (c.lives < lives0 || c.mode !== 'playing') break;
  }
  const damage = c.lives < lives0 || c.mode !== 'playing';
  return { damage, score: c.player.x - x0 - (damage ? 2000 - t * 10 : 0) - (c.player.y > H ? 500 : 0) };
}

// Spielt, bis maxMeters erreicht sind. Stirbt der Bot, bekommt er neue Leben (so misst man den ganzen Weg).
export function playHuman(seed, { skill = 'normal', maxMeters = 1500 } = {}) {
  const k = SKILLS[skill];
  const rnd = mulberry(seed * 7919 + 13);
  const s = newGame(seed);
  const hits = [];
  const queue = Array.from({ length: k.delay }, () => IDLE);
  let current = SCRIPTS[0];
  let start = 0;
  let frame = 0;
  let lastLives = s.lives;
  while (meters(s) < maxMeters && frame < 60 * 60 * 20) {
    if (frame % k.every === 0) {
      const run = evaluate(s, SCRIPTS[0], k.horizon);
      if (!run.damage) current = SCRIPTS[0];
      else {
        let best = null;
        let bestScript = SCRIPTS[0];
        for (const sc of SCRIPTS) {
          const r = evaluate(s, sc, k.horizon);
          if (!best || r.score > best.score) { best = r; bestScript = sc; }
        }
        current = bestScript;
      }
      if (rnd() < k.mistake) current = SCRIPTS[0]; // ein Moment der Unaufmerksamkeit
      start = frame;
    }
    queue.push(current.f(frame - start));
    const input = queue.shift();
    stepSim(s, input, STEP);
    frame++;
    if (s.lives < lastLives || s.mode !== 'playing') {
      hits.push({ meter: meters(s), chunk: chunkAt(s, s.player.x), cause: s.deathCause ? s.deathCause.label : '?' });
      lastLives = s.lives;
      if (s.mode !== 'playing') {
        // neues Leben: Spiel läuft weiter, indem der Zustand wiederbelebt wird
        s.mode = 'playing'; s.lives = 3; s.player.dead = false; s.deathT = 0; s.fx.slow = 1; lastLives = 3;
        s.player.invuln = 2; s.player.vy = 0;
      }
    }
  }
  return { seed, skill, reached: meters(s), hits, seconds: +s.t.toFixed(1) };
}
