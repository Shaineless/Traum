// Ein Simulationsschritt. Reine Logik ohne DOM, deterministisch (Zufall nur über s.rng),
// damit Tests und der Test Bot das Spiel ohne Browser laufen lassen können.

import { H, LIMITS, PHYS, STEP, W } from './constants.js';
import { updatePlatforms } from './platforms.js';
import { updatePlayer } from './player.js';
import { playerVsEnemies, updateEnemies } from './enemies.js';
import { playerVsHazards, updateObstacles } from './obstacles.js';
import { updateCollectibles } from './collectibles.js';
import { updateGates } from './gates.js';
import { updateEvents } from './events.js';
import { ensureAhead, updateHints } from './generator.js';
import { updateParticles } from './particles.js';
import { meters, updateCombo, updatePopups } from './scoring.js';

export const NULL_INPUT = Object.freeze({ move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false });

const DYING_SLOW = 0.3;
const DYING_TIME = 1.5; // echte Sekunden, danach Game Over

function decayFx(s, dt) {
  const fx = s.fx;
  fx.shake = Math.max(0, fx.shake - dt * 22);
  fx.flash = Math.max(0, fx.flash - dt * 2.4);
}

function updateCamera(s, dt) {
  const p = s.player;
  const look = Math.max(-40, Math.min(70, p.vx * 0.18));
  const target = p.x + p.w / 2 - W * 0.38 + look;
  const k = Math.min(1, dt * 5);
  if (target > s.camX) s.camX += (target - s.camX) * k;
}

// input: { move: -1|0|1, jumpPressed, jumpHeld, dashPressed } (Flanken gelten nur für diesen Schritt)
export function stepSim(s, input, dt = STEP) {
  s.realT += dt;
  decayFx(s, dt);

  if (s.mode === 'over') {
    updateParticles(s, dt);
    updatePopups(s, dt);
    return;
  }

  if (s.fx.hitstop > 0) {
    // Ein Sprung, der genau im Hitstop gedrückt wird, bleibt im Puffer und löst danach aus
    if (input.jumpPressed && !s.player.dead) s.player.buffer = PHYS.JUMP_BUFFER;
    s.fx.hitstop = Math.max(0, s.fx.hitstop - dt);
    updateParticles(s, dt * 0.25);
    return;
  }

  const dying = s.mode === 'dying';
  const sdt = dying ? dt * DYING_SLOW : dt;
  s.fx.slow = dying ? DYING_SLOW : 1;
  if (dying) {
    s.deathT += dt;
    if (s.deathT >= DYING_TIME) s.mode = 'over';
  }

  s.t += sdt;
  updatePlatforms(s, sdt);
  updateObstacles(s, sdt);
  updateEnemies(s, sdt);
  updatePlayer(s, dying ? NULL_INPUT : input, sdt);
  if (!dying) {
    playerVsEnemies(s);
    playerVsHazards(s);
  }
  updateCollectibles(s, sdt);
  updateGates(s, sdt);
  updateEvents(s, sdt);
  updateCamera(s, sdt);

  const p = s.player;
  if (!p.dead && p.x > s.run.maxX) s.run.maxX = p.x;
  s.run.meters = meters(s);
  updateHints(s);
  ensureAhead(s);
  updateCombo(s, sdt);
  updatePopups(s, sdt);
  updateParticles(s, sdt);
}

// Anzahl lebender Gegner im aktiven Bereich (für Limits und Debug)
export function activeEnemies(s) {
  const x0 = s.camX - 120;
  const x1 = s.camX + W + 400;
  let n = 0;
  for (const e of s.enemies) if (!e.dead && e.x > x0 && e.x < x1) n++;
  return n;
}

export const WORLD_BOUNDS = { H, ...LIMITS };
