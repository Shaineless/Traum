// Spielzustand. Reine Daten, kopierbar mit structuredClone.

import { MAX_LIVES, START_X } from './constants.js';
import { seedRng } from './rng.js';
import { newId } from './state-id.js';

export { newId };

export function createPlayer() {
  return {
    x: START_X, y: 300, w: 44, h: 34, vx: 0, vy: 0, face: 1,
    onGround: false, groundId: 0, coyote: 0, buffer: 0, jumps: 0, jumpHeld: false,
    invuln: 0, stun: 0, squashX: 1, squashY: 1,
    dash: { t: 0, cd: 0, dir: 1, air: false, rainbow: false }, // air: in dieser Luftphase schon benutzt, rainbow: aktueller Dash ist der starke
    power: { shield: false, dashT: 0, magnetT: 0, feather: 0, double: 0 },
    windVx: 0, wet: 0, trail: 0, dead: false, blink: 0,
    ammo: 0, starAcc: 0, // Wurfsterne und Sterne auf dem Weg zum nächsten Wurfstern
    glide: false, glideT: 0, // gleitet gerade, verbrauchte Gleitzeit in dieser Luftphase
    slam: { active: false, t: 0 }, // Sturzflug
    throwCd: 0, slick: false, // Wurf Abklingzeit, steht auf Eis
  };
}

export function createState({ seed = 1, debug = false } = {}) {
  const s = {
    seed,
    rng: 1,
    nextId: 1,
    mode: 'playing', // 'playing' | 'dying' | 'over'
    t: 0,
    realT: 0, // Zeit, die auch im Hitstop weiterläuft (für Animationen)
    deathT: 0,
    deathCause: null, // { kind, label }
    lives: MAX_LIVES,
    camX: 0,
    player: createPlayer(),
    platforms: [],
    enemies: [],
    hazards: [],
    zones: [],
    stars: [],
    powerups: [],
    gates: [],
    shots: [], // Wurfsterne des Spielers
    sfx: [], // Tonereignisse dieses Bildes { n: Name, v: Lautstärke }, nimbus-game.js leert die Liste
    particles: [],
    popups: [],
    banner: null, // { text, sub, t, dur }
    hints: { shown: {}, queue: [] },
    gen: null,
    world: { index: 0, from: 0, to: 0, blend: 1, gatesPassed: 0 },
    events: { active: null, nextMeter: 0, count: 0, starBoost: false, enemyBoost: false },
    combo: { count: 0, timer: 0 },
    run: { score: 0, bonus: 0, stars: 0, kills: 0, bestCombo: 0, maxX: START_X, meters: 0, hits: 0 },
    respawn: { x: START_X, y: 300 },
    fx: { shake: 0, hitstop: 0, flash: 0, flashColor: '#ff6688', slow: 1 },
    debug,
  };
  seedRng(s, seed);
  s.events.nextMeter = 450;
  return s;
}
