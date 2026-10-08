// Spielerphysik, Schaden und Respawn. Die Sprungwerte stehen in PHYS, die Flugbahn ist
// exakt parabelförmig (trapezförmige Integration), damit game/reach.js mit der Wirklichkeit übereinstimmt.

import { createStaticPlatform } from './entities.js';
import { KILL_Y, PHYS, WIND, W, Y_MAX } from './constants.js';
import { clearEnemiesNear } from './enemies.js';
import { clearHazardsNear, rainAt, windAt } from './obstacles.js';
import { emit } from './particles.js';
import { isSolid, onPlayerLand, platformById } from './platforms.js';
import { flash, hitstop, popup, resetCombo, shake } from './scoring.js';

const MAX_DT = 1 / 20; // größere Schritte werden gekappt, damit nichts durch Plattformen fällt
const EPS = 1e-9;
const LAND_TOL = 2; // so tief unter der Oberkante zählt eine Landung noch
const LAND_MIN_IMPACT = 220; // ab dieser Aufprallgeschwindigkeit gibt es Staub
const STRETCH = { x: 0.85, y: 1.2 }; // Sprung
const SQUASH_MAX = { x: 1.25, y: 0.75 }; // Landung bei maximalem Aufprall
const SQUASH_TAU = 0.05; // Zeitkonstante: nach 0,15 s sind noch 5 Prozent der Verformung übrig
const RAIN_SMOOTH = 6; // Glättung von p.wet pro Sekunde
const TRAIL_FADE = 3; // Regenbogenspur blendet pro Sekunde so schnell aus
const BLINK = { EVERY: 3.7, DUR: 0.16 };
const SAFE = { MIN_W: 200, LEFT: 200, CLEAR_L: 260, CLEAR_R: 420, SCREEN_L: 100, SCREEN_R: 120 };
const HIT = { SHAKE: 7, SHAKE_DEAD: 11, HITSTOP: 0.06, FLASH: 0.5, COLOR: '#ff6688' };
const FALL_LABEL = 'In den Abgrund gefallen';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;
const approach = (v, target, delta) => (v < target ? Math.min(target, v + delta) : Math.max(target, v - delta));
const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- Hilfen ----------

function relaxSquash(p, dt) {
  const k = 1 - Math.exp(-dt / SQUASH_TAU);
  p.squashX += (1 - p.squashX) * k;
  p.squashY += (1 - p.squashY) * k;
}

const stretch = (p) => {
  p.squashX = STRETCH.x;
  p.squashY = STRETCH.y;
};

function feetEmit(s, p, preset) {
  emit(s, preset, p.x + p.w / 2, p.y + p.h);
}

function endDash(p) {
  p.dash.t = 0;
  p.dash.cd = PHYS.DASH_COOLDOWN;
  p.vx = p.dash.dir * PHYS.MOVE_SPEED;
}

// Der Spieler ist ausgeschieden: er taumelt nach oben und fällt, ohne Steuerung und ohne Kollision
function tumble(p, dt) {
  p.vy = Math.min(PHYS.MAX_FALL, p.vy + PHYS.GRAVITY * dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.max(0, 1 - 1.5 * dt);
  p.onGround = false;
  p.groundId = 0;
  p.dash.t = 0;
  p.trail = Math.max(0, p.trail - TRAIL_FADE * dt);
}

// ---------- Schritt ----------

export function updatePlayer(s, input, dt) {
  const p = s.player;
  if (!(dt > 0)) return;
  dt = Math.min(dt, MAX_DT);

  relaxSquash(p, dt);
  const ph = s.realT % BLINK.EVERY;
  p.blink = ph < BLINK.DUR ? Math.sin((ph / BLINK.DUR) * Math.PI) : 0; // 0 offen bis 1 geschlossen
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.dead) {
    tumble(p, dt);
    return;
  }

  const mv = input.move > 0 ? 1 : input.move < 0 ? -1 : 0;
  const held = !!input.jumpHeld;
  p.jumpHeld = held;
  p.stun = Math.max(0, p.stun - dt);
  p.dash.cd = Math.max(0, p.dash.cd - dt);
  if (p.dash.t > 0) {
    p.dash.t -= dt;
    if (p.dash.t <= EPS) endDash(p);
  }
  p.trail = Math.max(0, p.trail - TRAIL_FADE * dt);

  // Bewegliche Plattform: ihre Verschiebung gilt vor allem anderen, so hebt der Spieler nie ab
  const preBottom = p.y + p.h;
  if (p.onGround && p.groundId) {
    const g = platformById(s, p.groundId);
    if (g && isSolid(g)) {
      p.x += num(g.dx);
      p.y += num(g.dy);
    }
  }

  // Dash: nur mit Regenbogen Dash Powerup und abgelaufener Abklingzeit
  if (input.dashPressed && p.stun <= 0 && p.dash.t <= 0 && p.dash.cd <= 0 && p.power.dashT > 0) {
    p.dash.dir = mv || p.face || 1;
    p.dash.t = PHYS.DASH_TIME;
    p.face = p.dash.dir;
    p.vy = 0;
  }
  const dashing = p.dash.t > 0;
  if (input.jumpPressed) p.buffer = PHYS.JUMP_BUFFER;
  p.coyote = p.onGround ? PHYS.COYOTE : Math.max(0, p.coyote - dt); // Coyote Time wie in der alten Version

  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const rain = clamp(num(rainAt(s, cx, cy)), 0, 1);
  p.wet += (rain - p.wet) * Math.min(1, RAIN_SMOOTH * dt);
  const wind = windAt(s, cx, cy) || { vx: 0, ay: 0 };
  const windTarget = clamp(num(wind.vx), -WIND.MAX_VX, WIND.MAX_VX);
  p.windVx += (windTarget - p.windVx) * Math.min(1, WIND.SMOOTH * dt);
  const lift = clamp(num(wind.ay), -WIND.MAX_LIFT, WIND.MAX_LIFT);

  if (dashing) {
    dashStep(s, p, dt);
  } else {
    walkStep(s, p, dt, mv, held, lift);
  }

  // Linker Rand: der Spieler wird nie aus dem Bild geschoben
  const minX = s.camX + PHYS.LEFT_MARGIN;
  if (p.x < minX) {
    p.x = minX;
    if (p.vx < 0) p.vx = 0;
  }

  resolveLanding(s, p, preBottom);

  if (p.y > KILL_Y) {
    const r = hurtPlayer(s, { kind: 'fall', label: FALL_LABEL, x: p.x + p.w / 2, y: p.y });
    // Im Dash oder bei Unverwundbarkeit zählt der Sturz nicht, der Spieler wird trotzdem gerettet
    if (r === 'ignored' && !p.dead) respawnPlayer(s);
  }
}

function dashStep(s, p, dt) {
  const use = Math.min(dt, p.dash.t);
  p.vx = p.dash.dir * PHYS.DASH_SPEED;
  p.vy = 0;
  p.x += p.vx * use;
  p.trail = 1;
  emit(s, 'dash', p.x + p.w / 2, p.y + p.h / 2);
}

function walkStep(s, p, dt, mv, held, lift) {
  // Der Sprungpuffer läuft im Dash nicht ab: ein Sprung davor wartet das Ende ab
  p.buffer = Math.max(0, p.buffer - dt);

  const control = p.stun > 0 ? 0 : mv;
  if (control) p.face = control;

  // Waagerecht: Beschleunigung statt Sofortgeschwindigkeit
  let rate;
  const speeding = control !== 0 && p.vx * control >= 0 && Math.abs(p.vx) < PHYS.MOVE_SPEED;
  const turning = control !== 0 && p.vx * control < 0;
  if (p.onGround) {
    const acc = PHYS.GROUND_ACCEL * lerp(1, PHYS.RAIN_ACCEL_MULT, p.wet);
    const dec = PHYS.GROUND_DECEL * lerp(1, PHYS.RAIN_DECEL_MULT, p.wet);
    rate = turning ? Math.max(acc, dec) : speeding ? acc : dec;
  } else {
    rate = turning || speeding ? PHYS.AIR_ACCEL : PHYS.AIR_DECEL;
  }
  p.vx = approach(p.vx, control * PHYS.MOVE_SPEED, rate * dt);

  // Springen: Boden oder Coyote Time, dann Doppelsprung, dann Traumfedern
  if (p.buffer > 0) {
    if (p.coyote > 0) {
      launch(p, PHYS.JUMP_SPEED);
      p.jumps = 1;
      feetEmit(s, p, 'jump');
    } else if (p.jumps < 2) {
      launch(p, PHYS.DOUBLE_JUMP_SPEED);
      p.jumps = 2;
      feetEmit(s, p, 'doublejump');
    } else if (p.power.feather > 0) {
      launch(p, PHYS.DOUBLE_JUMP_SPEED);
      p.power.feather -= 1;
      feetEmit(s, p, 'doublejump');
    }
  }

  // Senkrecht: Wind hebt (negatives ay), die Taste früh loszulassen kürzt den Sprung
  let ay = PHYS.GRAVITY + lift;
  if (!held && p.vy < -PHYS.CUT_THRESHOLD) ay += PHYS.GRAVITY * PHYS.CUT_GRAVITY_MULT;
  const vy2 = Math.min(PHYS.MAX_FALL, p.vy + ay * dt);
  p.y += (p.vy + vy2) * 0.5 * dt;
  p.vy = vy2;

  // Der Wind schiebt, aber gegen die Eingabe nie rückwärts: die Eingabe gewinnt
  let net = p.vx + p.windVx;
  if (control !== 0 && net * control < 0) net = 0;
  p.x += net * dt;
}

function launch(p, speed) {
  p.vy = -speed;
  p.buffer = 0;
  p.coyote = 0;
  p.onGround = false;
  p.groundId = 0;
  stretch(p);
}

// Landung nur von oben auf feste Plattformen. Bei mehreren Kandidaten gewinnt die höchste,
// bei gleicher Höhe die, über der der Spieler mit dem größeren Teil seiner Breite steht.
function resolveLanding(s, p, preBottom) {
  const wasGround = p.onGround;
  const wasId = p.groundId;
  let best = null;
  let bestOverlap = 0;
  if (p.vy >= 0) {
    const bottom = p.y + p.h;
    const right = p.x + p.w;
    const list = s.platforms;
    for (let i = 0; i < list.length; i++) {
      const pl = list[i];
      if (right <= pl.x || p.x >= pl.x + pl.w) continue;
      if (bottom < pl.y || !isSolid(pl)) continue;
      if (preBottom > pl.y - num(pl.dy) + LAND_TOL) continue; // war schon darunter
      const overlap = Math.min(right, pl.x + pl.w) - Math.max(p.x, pl.x);
      if (!best || pl.y < best.y - 0.5 || (pl.y <= best.y + 0.5 && overlap > bestOverlap)) {
        best = pl;
        bestOverlap = overlap;
      }
    }
  }
  if (!best) {
    p.onGround = false;
    p.groundId = 0;
    return;
  }
  const impact = p.vy;
  p.y = best.y - p.h;
  p.vy = 0;
  p.onGround = true;
  p.groundId = best.id;
  p.jumps = 0;
  if (!wasGround) landEffects(s, p, impact);
  if (!wasGround || wasId !== best.id) onPlayerLand(s, best);
}

function landEffects(s, p, impact) {
  if (impact < LAND_MIN_IMPACT) return;
  const k = clamp((impact - LAND_MIN_IMPACT) / (PHYS.MAX_FALL - LAND_MIN_IMPACT), 0, 1);
  p.squashX = lerp(1.05, SQUASH_MAX.x, k);
  p.squashY = lerp(0.95, SQUASH_MAX.y, k);
  feetEmit(s, p, 'land');
}

// ---------- Schaden ----------

// src: { kind, label, x, y }. Rückgabe: 'ignored' | 'absorbed' | 'hurt' | 'dead'
export function hurtPlayer(s, src) {
  const p = s.player;
  if (p.dead || p.invuln > 0 || p.dash.t > 0) return 'ignored';
  const kind = (src && src.kind) || 'unknown';
  const label = (src && src.label) || '';
  const fall = kind === 'fall';

  if (p.power.shield) {
    p.power.shield = false;
    p.invuln = PHYS.INVULN_SHIELD;
    if (fall) respawnPlayer(s);
    emit(s, 'shieldbreak', p.x + p.w / 2, p.y + p.h / 2);
    shake(s, 3);
    return 'absorbed';
  }

  s.lives = Math.max(0, s.lives - 1);
  resetCombo(s);
  s.run.hits += 1;
  s.deathCause = { kind, label };
  p.invuln = PHYS.INVULN_HURT;
  const dead = s.lives <= 0;

  if (fall && !dead) respawnPlayer(s);
  const cx = p.x + p.w / 2;
  const away = Number.isFinite(src && src.x) && Math.abs(cx - src.x) > 1 ? Math.sign(cx - src.x) : -(p.face || 1);
  if (!fall && !dead) {
    p.vx = away * PHYS.KNOCKBACK_VX;
    p.vy = -PHYS.KNOCKBACK_VY;
    p.onGround = false;
    p.groundId = 0;
    p.coyote = 0;
    p.stun = PHYS.STUN;
  }

  flash(s, HIT.COLOR, HIT.FLASH);
  shake(s, dead ? HIT.SHAKE_DEAD : HIT.SHAKE);
  hitstop(s, HIT.HITSTOP);
  emit(s, 'hurt', cx, p.y + p.h / 2);
  popup(s, cx, p.y - 8, 'Aua!', { color: '#ff9ab4' });

  if (dead) {
    s.mode = 'dying';
    s.deathT = 0;
    p.dead = true;
    p.onGround = false;
    p.groundId = 0;
    p.stun = 0;
    p.dash.t = 0;
    p.vx = fall ? 0 : away * PHYS.KNOCKBACK_VX * 0.4;
    p.vy = fall ? 0 : -PHYS.STOMP_BOUNCE;
    return 'dead';
  }
  return 'hurt';
}

// ---------- Respawn ----------

// Kleinste Plattform (nach x) der Art static, die breit genug ist und weit genug rechts endet
function pickStatic(s, minW, minRight) {
  let best = null;
  for (const pl of s.platforms) {
    if (pl.kind !== 'static' || pl.w < minW || pl.x + pl.w <= minRight) continue;
    if (!best || pl.x < best.x) best = pl;
  }
  return best;
}

export function respawnPlayer(s) {
  const p = s.player;
  if (p.dead) return; // wer ausgeschieden ist, wird nicht wiederbelebt
  const cam = s.camX;
  let plat = pickStatic(s, SAFE.MIN_W, cam + SAFE.LEFT) || pickStatic(s, p.w + 40, cam + PHYS.LEFT_MARGIN + p.w) || pickStatic(s, p.w + 8, -Infinity);
  if (!plat) {
    // Notlösung: es gibt gar keine feste Plattform, also entsteht eine
    plat = createStaticPlatform(s, cam + SAFE.LEFT / 2, Y_MAX - 40, 320);
    s.platforms.push(plat);
  }

  // Mittig auf der Plattform, bei sehr breiten oder weit entfernten Plattformen im sichtbaren Bereich
  const half = p.w / 2 + 6;
  let cx = plat.x + plat.w / 2;
  const lo = Math.max(plat.x + half, cam + SAFE.SCREEN_L);
  const hi = Math.min(plat.x + plat.w - half, cam + W - SAFE.SCREEN_R);
  if (lo <= hi) cx = clamp(cx, lo, hi);
  p.x = Math.max(cx - p.w / 2, cam + PHYS.LEFT_MARGIN);
  p.y = plat.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.windVx = 0;
  p.onGround = true;
  p.groundId = plat.id;
  p.jumps = 0;
  p.coyote = PHYS.COYOTE;
  p.buffer = 0;
  p.stun = 0;
  p.dash.t = 0;
  p.squashX = 1;
  p.squashY = 1;
  p.invuln = Math.max(p.invuln, PHYS.INVULN_RESPAWN);
  s.respawn = { x: p.x, y: p.y };

  const x0 = p.x - SAFE.CLEAR_L;
  const x1 = p.x + p.w + SAFE.CLEAR_R;
  clearEnemiesNear(s, x0, x1);
  clearHazardsNear(s, x0, x1);
  emit(s, 'poof', p.x + p.w / 2, p.y + p.h);
}

// ---------- Abprallen ----------

export function bouncePlayer(s, speed) {
  const p = s.player;
  if (p.dead) return;
  p.vy = -(Number.isFinite(speed) ? Math.abs(speed) : PHYS.STOMP_BOUNCE);
  p.onGround = false;
  p.groundId = 0;
  p.coyote = 0;
  p.jumps = Math.min(p.jumps, 1);
  stretch(p);
}
