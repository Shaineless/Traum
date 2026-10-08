// Vorausschau Bot: spielt Nimbus ohne Browser, indem er vor jeder Entscheidung mehrere
// Eingabeskripte auf einer Kopie des Zustands durchrechnet. Findet er keinen schadenfreien
// Weg, ist die Stelle für Menschen sehr wahrscheinlich ebenfalls unfair.
import { H, STEP } from '../game/constants.js';
import { chunkAt } from '../game/generator.js';
import { meters } from '../game/scoring.js';
import { stepSim } from '../game/sim.js';
import { newGame } from './helpers.mjs';

const HORIZON = 66; // Schritte, die ein Kandidat vorausgerechnet wird
const DECIDE_EVERY = 6; // Schritte zwischen zwei Entscheidungen

const IDLE = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false };

function makeScripts() {
  const list = [{ id: 'run', f: () => ({ ...IDLE, move: 1 }) }];
  for (const move of [1, 0]) {
    for (const jf of [0, 4, 9, 15, 22, 30]) {
      for (const dbl of [-1, 20, 30, 40]) {
        list.push({
          id: `j${move}:${jf}:${dbl}`,
          f: (i) => ({
            move,
            jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1),
            jumpHeld: i >= jf && i < jf + 40,
            dashPressed: false,
          }),
        });
      }
    }
  }
  list.push({ id: 'wait', f: () => IDLE });
  list.push({ id: 'back', f: () => ({ ...IDLE, move: -1 }) });
  return list;
}
const SCRIPTS = makeScripts();

function slim(s) {
  // Für die Vorausschau brauchen wir weder Partikel noch Popups.
  const c = { ...s, particles: [], popups: [] };
  return structuredClone(c);
}

function evaluate(s, script) {
  const c = slim(s);
  const x0 = c.player.x;
  const lives0 = c.lives;
  const hits0 = c.run.hits;
  let t = 0;
  for (let i = 0; i < HORIZON; i++) {
    stepSim(c, script.f(i), STEP);
    t++;
    if (c.lives < lives0 || c.run.hits > hits0 || c.mode !== 'playing') break;
  }
  const damage = c.lives < lives0 || c.run.hits > hits0 || c.mode !== 'playing';
  const progress = c.player.x - x0;
  const fell = c.player.y > H;
  return { damage, score: progress - (damage ? 2000 - t * 10 : 0) - (fell ? 500 : 0) };
}

export function playBot(seed, { maxMeters = 600, maxFrames = 60 * 60 * 12, keepLog = false, trace = false } = {}) {
  const s = newGame(seed);
  if (keepLog) s.gen.keepLog = true;
  const hits = [];
  const rec = trace ? [] : null;
  const marks = [];
  let lastKills = 0;
  let lastGates = 0;
  let current = SCRIPTS[0];
  let k = 0;
  let lastLives = s.lives;
  let lastHits = s.run.hits;
  let frames = 0;
  let planned = 0;

  while (frames < maxFrames && s.mode === 'playing' && meters(s) < maxMeters) {
    if (k % DECIDE_EVERY === 0) {
      const first = evaluate(s, SCRIPTS[0]);
      if (!first.damage) current = SCRIPTS[0];
      else {
        let best = null;
        let bestScript = SCRIPTS[0];
        for (const sc of SCRIPTS) {
          const r = evaluate(s, sc);
          if (!best || r.score > best.score) { best = r; bestScript = sc; }
        }
        current = bestScript;
        planned++;
        if (best.damage) current = { ...bestScript, unavoidable: true };
      }
      current = { ...current, start: k };
    }
    const input = current.f(k - current.start);
    if (rec) rec.push((input.move + 1) | (input.jumpPressed ? 4 : 0) | (input.jumpHeld ? 8 : 0) | (input.dashPressed ? 16 : 0));
    stepSim(s, input, STEP);
    k++;
    frames++;
    if (s.run.kills > lastKills) { marks.push({ frame: frames, meter: meters(s), kind: 'kill', combo: s.combo.count }); lastKills = s.run.kills; }
    if (s.world.gatesPassed > lastGates) { marks.push({ frame: frames, meter: meters(s), kind: 'gate' }); lastGates = s.world.gatesPassed; }
    if (s.events.active && !marks.some((m) => m.kind === 'event:' + s.events.active.type && m.frame > frames - 60 * 20)) marks.push({ frame: frames, meter: meters(s), kind: 'event:' + s.events.active.type });
    if (s.run.hits > lastHits || s.lives < lastLives) {
      hits.push({ meter: meters(s), chunk: chunkAt(s, s.player.x), cause: s.deathCause ? s.deathCause.label : '?', unavoidable: !!current.unavoidable, t: +s.t.toFixed(1) });
      lastHits = s.run.hits;
      lastLives = s.lives;
    }
  }
  return {
    seed,
    reached: meters(s),
    seconds: +s.t.toFixed(1),
    died: s.mode !== 'playing',
    lives: s.lives,
    hits,
    stars: s.run.stars,
    kills: s.run.kills,
    planned,
    cause: s.deathCause,
    trace: rec,
    marks,
  };
}
