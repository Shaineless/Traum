// Spielerphysik, Fähigkeiten (Dash, Gleiten, Stampfen, Sternenwurf), Sprungwolken, Schaden und Respawn.
// Die Sprungwerte stehen in PHYS, die Flugbahn ist exakt parabelförmig (trapezförmige Integration),
// damit game/reach.js mit der Wirklichkeit übereinstimmt. Die Fähigkeiten stehen in ABILITY.

import { createStaticPlatform } from './entities.js';
import { ABILITY, ICE, KILL_Y, PHYS, SPRING, WIND, W, Y_MAX } from './constants.js';
import { clearEnemiesNear, damageEnemy } from './enemies.js';
import { clearHazardsNear, destroyHail, rainAt, windAt } from './obstacles.js';
import { emit } from './particles.js';
import { isSolid, onPlayerLand, platformById } from './platforms.js';
import { flash, hitstop, popup, resetCombo, sfx, shake } from './scoring.js';
import { fireShot } from './shots.js';

const { DASH_BASIC, DASH_RAINBOW, GLIDE, SLAM } = ABILITY;

const MAX_DT = 1 / 20; // größere Schritte werden gekappt, damit nichts durch Plattformen fällt
const EPS = 1e-9;
const LAND_TOL = 2; // so tief unter der Oberkante zählt eine Landung noch
const LAND_MIN_IMPACT = 220; // ab dieser Aufprallgeschwindigkeit gibt es Staub und einen Ton
const LAND_HARD = 600; // ab dieser Aufprallgeschwindigkeit kommen Landeringe (opts.strength 0..1 bis MAX_FALL)
const STRETCH = { x: 0.85, y: 1.2 }; // Sprung
const SLAM_STRETCH = { x: 0.8, y: 1.3 }; // Beginn des Sturzflugs
const SQUASH_MAX = { x: 1.25, y: 0.75 }; // Landung bei maximalem Aufprall
const SQUASH_TAU = 0.05; // Zeitkonstante: nach 0,15 s sind noch 5 Prozent der Verformung übrig
const RAIN_SMOOTH = 6; // Glättung von p.wet pro Sekunde
const TRAIL_FADE = 3; // Regenbogenspur blendet pro Sekunde so schnell aus
const BLINK = { EVERY: 3.7, DUR: 0.16 };
const SAFE = { MIN_W: 200, LEFT: 200, CLEAR_L: 260, CLEAR_R: 420, SCREEN_L: 100, SCREEN_R: 120 };
const HIT = { SHAKE: 7, SHAKE_DEAD: 11, HITSTOP: 0.06, FLASH: 0.5, COLOR: '#ff6688' };
const FALL_LABEL = 'In den Abgrund gefallen';
const SLAM_BRAKE = 12000; // waagerechtes Abbremsen im Sturzflug in px/s², nach etwa zwei Schritten steht er still
const SLAM_FX = { SHAKE: 6, HITSTOP: 0.06 };
const GLIDE_PUFF = 0.16; // Abstand der Gleitpartikel in Sekunden
const NO_INPUT = Object.freeze({});

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

function feetEmit(s, p, preset, opts) {
  emit(s, preset, p.x + p.w / 2, p.y + p.h, opts);
}

function endDash(p) {
  p.dash.t = 0;
  p.dash.cd = (p.dash.rainbow ? DASH_RAINBOW : DASH_BASIC).COOLDOWN;
  p.vx = p.dash.dir * PHYS.MOVE_SPEED;
}

function endSlam(p) {
  p.slam.active = false;
  p.slam.t = 0;
}

// Abstand von den Füßen bis zur Oberkante der nächsten festen Plattform darunter (Infinity: keine)
function groundBelow(s, p) {
  const feet = p.y + p.h;
  const right = p.x + p.w;
  const list = s.platforms;
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    const pl = list[i];
    if (right <= pl.x || p.x >= pl.x + pl.w || !isSolid(pl)) continue;
    const d = pl.y - feet;
    if (d >= -LAND_TOL && d < best) best = d;
  }
  return Math.max(0, best);
}

// Der Spieler ist ausgeschieden: er taumelt nach oben und fällt, ohne Steuerung und ohne Kollision
function tumble(p, dt) {
  p.vy = Math.min(PHYS.MAX_FALL, p.vy + PHYS.GRAVITY * dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.max(0, 1 - 1.5 * dt);
  p.onGround = false;
  p.groundId = 0;
  p.slick = false;
  p.glide = false;
  p.dash.t = 0;
  endSlam(p);
  p.trail = Math.max(0, p.trail - TRAIL_FADE * dt);
}

// ---------- Schritt ----------

export function updatePlayer(s, input, dt) {
  const p = s.player;
  if (!(dt > 0)) return;
  dt = Math.min(dt, MAX_DT);
  const inp = input || NO_INPUT;

  relaxSquash(p, dt);
  const ph = s.realT % BLINK.EVERY;
  p.blink = ph < BLINK.DUR ? Math.sin((ph / BLINK.DUR) * Math.PI) : 0; // 0 offen bis 1 geschlossen
  p.invuln = Math.max(0, p.invuln - dt);
  p.throwCd = Math.max(0, num(p.throwCd) - dt);
  if (p.dead) {
    tumble(p, dt);
    return;
  }

  const mv = inp.move > 0 ? 1 : inp.move < 0 ? -1 : 0;
  const held = !!inp.jumpHeld;
  p.jumpHeld = held;
  p.stun = Math.max(0, p.stun - dt);
  p.dash.cd = Math.max(0, p.dash.cd - dt);
  // Wer den Regenbogen Dash aufsammelt, wartet höchstens dessen kurze Abklingzeit
  if (p.power.dashT > 0 && p.dash.cd > DASH_RAINBOW.COOLDOWN) p.dash.cd = DASH_RAINBOW.COOLDOWN;
  if (p.dash.t > 0) {
    p.dash.t -= dt;
    if (p.dash.t <= EPS) endDash(p);
  }
  if (p.slam.active && p.stun > 0) endSlam(p); // gestunnt, also kein Sturzflug mehr
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

  tryDash(s, p, inp, mv);
  trySlam(s, p, inp);
  const dashing = p.dash.t > 0;
  if (inp.jumpPressed) p.buffer = PHYS.JUMP_BUFFER;
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
    walkStep(s, p, dt, mv, held, lift, !!inp.downHeld);
  }

  // Linker Rand: der Spieler wird nie aus dem Bild geschoben
  const minX = s.camX + PHYS.LEFT_MARGIN;
  if (p.x < minX) {
    p.x = minX;
    if (p.vx < 0) p.vx = 0;
  }

  resolveLanding(s, p, preBottom);

  // Sternenwurf: nicht im Dash und nicht gestunnt (fireShot prüft Vorrat und Abklingzeit)
  if (inp.throwPressed && p.stun <= 0 && p.dash.t <= 0) fireShot(s);

  if (p.y > KILL_Y) {
    const r = hurtPlayer(s, { kind: 'fall', label: FALL_LABEL, x: p.x + p.w / 2, y: p.y });
    // Im Dash oder bei Unverwundbarkeit zählt der Sturz nicht, der Spieler wird trotzdem gerettet
    if (r === 'ignored' && !p.dead) respawnPlayer(s);
  }
}

// Wolkenstoß: immer da. Ohne Powerup einmal pro Luftphase und mit langer Abklingzeit,
// mit dem Regenbogen Powerup kürzer, ohne Luftlimit.
function tryDash(s, p, inp, mv) {
  if (!inp.dashPressed || p.stun > 0 || p.dash.t > 0 || p.dash.cd > 0 || p.slam.active) return;
  const rainbow = p.power.dashT > 0;
  if (!rainbow && !p.onGround && p.dash.air) return;
  p.dash.dir = mv || p.face || 1;
  p.dash.t = (rainbow ? DASH_RAINBOW : DASH_BASIC).TIME;
  p.dash.rainbow = rainbow;
  if (!p.onGround) p.dash.air = true;
  p.face = p.dash.dir;
  p.vy = 0;
  sfx(s, 'dash');
}

// Stampfen: nur in der Luft und nur, wenn unter den Füßen weit genug Boden liegt
function trySlam(s, p, inp) {
  if (!inp.slamPressed || p.slam.active || p.onGround || p.stun > 0 || p.dash.t > 0) return;
  const d = groundBelow(s, p);
  if (!Number.isFinite(d) || d <= SLAM.MIN_HEIGHT) return;
  p.slam.active = true;
  p.slam.t = 0;
  p.vy = SLAM.SPEED;
  p.squashX = SLAM_STRETCH.x;
  p.squashY = SLAM_STRETCH.y;
}

function dashStep(s, p, dt) {
  const use = Math.min(dt, p.dash.t);
  p.vx = p.dash.dir * PHYS.DASH_SPEED;
  p.vy = 0;
  p.x += p.vx * use;
  p.trail = 1;
  p.glide = false;
  emit(s, 'dash', p.x + p.w / 2, p.y + p.h / 2);
}

// Gleiten ein oder aus. Der Ton kommt nur beim Beginn, Partikel in Abständen.
function setGlide(s, p, on, dt) {
  if (on) {
    const prev = num(p.glideT);
    p.glideT = Math.min(GLIDE.MAX, prev + dt);
    if (!p.glide) sfx(s, 'glide', 0.7);
    if (!p.glide || Math.floor(p.glideT / GLIDE_PUFF) > Math.floor(prev / GLIDE_PUFF)) feetEmit(s, p, 'glide');
  }
  p.glide = on;
}

function walkStep(s, p, dt, mv, held, lift, down) {
  // Der Sprungpuffer läuft im Dash nicht ab: ein Sprung davor wartet das Ende ab
  p.buffer = Math.max(0, p.buffer - dt);
  const slamming = p.slam.active;

  const control = p.stun > 0 || slamming ? 0 : mv;
  if (control) p.face = control;

  // Waagerecht: Beschleunigung statt Sofortgeschwindigkeit
  let rate;
  if (slamming) {
    rate = SLAM_BRAKE;
  } else {
    const speeding = control !== 0 && p.vx * control >= 0 && Math.abs(p.vx) < PHYS.MOVE_SPEED;
    const turning = control !== 0 && p.vx * control < 0;
    if (p.onGround) {
      // Regen und Eis bremsen den Boden, zusammen gilt der kleinere Faktor
      let accMult = lerp(1, PHYS.RAIN_ACCEL_MULT, p.wet);
      let decMult = lerp(1, PHYS.RAIN_DECEL_MULT, p.wet);
      if (p.slick) {
        accMult = Math.min(accMult, ICE.ACCEL_MULT);
        decMult = Math.min(decMult, ICE.DECEL_MULT);
      }
      const acc = PHYS.GROUND_ACCEL * accMult;
      const dec = PHYS.GROUND_DECEL * decMult;
      rate = turning ? Math.max(acc, dec) : speeding ? acc : dec;
    } else {
      rate = turning || speeding ? PHYS.AIR_ACCEL : PHYS.AIR_DECEL;
    }
  }
  p.vx = approach(p.vx, control * PHYS.MOVE_SPEED, rate * dt);

  // Springen: Boden oder Coyote Time, dann Doppelsprung, dann Traumfedern (nicht im Sturzflug)
  if (!slamming && p.buffer > 0) {
    if (p.coyote > 0) {
      launch(p, PHYS.JUMP_SPEED);
      p.jumps = 1;
      feetEmit(s, p, 'jump');
      sfx(s, 'jump');
    } else if (p.jumps < 2) {
      launch(p, PHYS.DOUBLE_JUMP_SPEED);
      p.jumps = 2;
      feetEmit(s, p, 'doublejump');
      sfx(s, 'doublejump');
    } else if (p.power.feather > 0) {
      launch(p, PHYS.DOUBLE_JUMP_SPEED);
      p.power.feather -= 1;
      feetEmit(s, p, 'doublejump');
      sfx(s, 'doublejump');
    }
  }

  // Senkrecht
  if (slamming) {
    // Sturzflug: feste Geschwindigkeit, MAX_FALL gilt hier nicht
    p.vy = SLAM.SPEED;
    p.y += p.vy * dt;
    p.slam.t += dt;
    setGlide(s, p, false, dt);
  } else {
    // Wind hebt (negatives ay), die Taste früh loszulassen kürzt den Sprung (nicht bei der Sprungwolke)
    let ay = PHYS.GRAVITY + lift;
    if (!held && p.vy < -PHYS.CUT_THRESHOLD && !p.noCut) ay += PHYS.GRAVITY * PHYS.CUT_GRAVITY_MULT;
    // Gleiten: Taste halten, in der Luft fallen, nicht gestunnt, Gleitzeit nicht aufgebraucht.
    // Ein frischer Sprungdruck hat oben schon einen Luftsprung ausgelöst, dann steigt vy < 0.
    const gliding = held && !down && !p.onGround && p.stun <= 0 && p.vy > GLIDE.MIN_VY && num(p.glideT) < GLIDE.MAX;
    const v0 = gliding ? Math.min(p.vy, GLIDE.FALL) : p.vy;
    let vy2 = Math.min(PHYS.MAX_FALL, v0 + ay * dt);
    if (gliding) vy2 = Math.min(vy2, GLIDE.FALL);
    p.y += (v0 + vy2) * 0.5 * dt;
    p.vy = vy2;
    setGlide(s, p, gliding, dt);
  }

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
  p.noCut = false;
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
    p.slick = false;
    // Verschwindet der Boden im Sturzflug (Blinkwolke, Bruch), endet er, damit sich der Spieler noch retten kann
    if (p.slam.active && !Number.isFinite(groundBelow(s, p))) {
      endSlam(p);
      p.vy = Math.min(p.vy, PHYS.MAX_FALL);
    }
    return;
  }
  const impact = p.vy;
  const slamming = p.slam.active;
  const arrived = !wasGround || wasId !== best.id;
  p.y = best.y - p.h;
  p.vy = 0;
  p.onGround = true;
  p.groundId = best.id;
  p.jumps = 0;
  p.glide = false;
  p.glideT = 0;
  p.dash.air = false;
  p.noCut = false;
  p.slick = !!best.slick;
  const spring = best.kind === 'spring';
  if (slamming) slamImpact(s, p);
  else if (!wasGround && !spring) landEffects(s, p, impact);
  if (arrived) onPlayerLand(s, best);
  // Die Sprungwolke wirft jeden hoch, der oben auf ihr steht (im Dash erst nach dem Dash)
  if (spring && p.dash.t <= 0) springLaunch(s, p, best);
}

function landEffects(s, p, impact) {
  if (impact < LAND_MIN_IMPACT) return;
  const k = clamp((impact - LAND_MIN_IMPACT) / (PHYS.MAX_FALL - LAND_MIN_IMPACT), 0, 1);
  p.squashX = lerp(1.05, SQUASH_MAX.x, k);
  p.squashY = lerp(0.95, SQUASH_MAX.y, k);
  sfx(s, 'land', lerp(0.35, 1, k));
  if (impact > LAND_HARD) {
    // Harte Landung: Ringe und mehr Staub, falls das Preset opts.strength kennt
    feetEmit(s, p, 'land', { strength: clamp((impact - LAND_HARD) / (PHYS.MAX_FALL - LAND_HARD), 0, 1) });
  } else {
    feetEmit(s, p, 'land');
  }
}

// Sprungwolke: sofort mit launch px/s nach oben, die waagerechte Geschwindigkeit bleibt
function springLaunch(s, p, plat) {
  p.vy = -(plat.launch > 0 ? plat.launch : SPRING.SPEED);
  p.onGround = false;
  p.groundId = 0;
  p.slick = false;
  p.coyote = 0;
  p.buffer = 0; // ein Sprungdruck kurz davor würde sonst den stärkeren Start durch einen Luftsprung ersetzen
  p.jumps = 1;
  p.glideT = 0;
  p.dash.air = false;
  p.noCut = true; // volle Höhe, auch wenn die Sprungtaste nicht gehalten wird
  stretch(p);
  plat.press = 1;
  emit(s, 'spring', p.x + p.w / 2, plat.y);
  sfx(s, 'spring');
}

// ---------- Stampfen ----------

// Schockwelle um die Füße: besiegt alle lebenden Gegner im Radius und zerstört Hagel
function shockwave(s, p) {
  const cx = p.x + p.w / 2;
  const fy = p.y + p.h;
  const r2 = SLAM.RADIUS * SLAM.RADIUS;
  const list = s.enemies;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e || e.dead > 0) continue;
    const dx = e.x + e.w / 2 - cx;
    const dy = e.y + e.h / 2 - fy;
    if (dx * dx + dy * dy <= r2) damageEnemy(s, e, 'slam');
  }
  destroyHail(s, cx, fy, SLAM.RADIUS);
  shake(s, SLAM_FX.SHAKE);
  hitstop(s, SLAM_FX.HITSTOP);
  emit(s, 'slam', cx, fy);
  sfx(s, 'slam');
}

// Landung im Sturzflug: Schockwelle, kräftig gestaucht, kleiner Rückprall. Ein Sprung kurz danach zählt noch als Bodensprung.
function slamImpact(s, p) {
  endSlam(p);
  shockwave(s, p);
  p.squashX = SQUASH_MAX.x;
  p.squashY = SQUASH_MAX.y;
  p.vy = -SLAM.BOUNCE;
  p.onGround = false;
  p.groundId = 0;
  p.slick = false;
  p.coyote = PHYS.COYOTE;
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
    sfx(s, 'shieldbreak');
    shake(s, 3);
    return 'absorbed';
  }

  s.lives = Math.max(0, s.lives - 1);
  resetCombo(s);
  s.run.hits += 1;
  s.deathCause = { kind, label };
  p.invuln = PHYS.INVULN_HURT;
  endSlam(p); // ein Treffer beendet den Sturzflug und das Gleiten
  p.glide = false;
  const dead = s.lives <= 0;

  if (fall && !dead) respawnPlayer(s);
  const cx = p.x + p.w / 2;
  const away = Number.isFinite(src && src.x) && Math.abs(cx - src.x) > 1 ? Math.sign(cx - src.x) : -(p.face || 1);
  if (!fall && !dead) {
    p.vx = away * PHYS.KNOCKBACK_VX;
    p.vy = -PHYS.KNOCKBACK_VY;
    p.onGround = false;
    p.groundId = 0;
    p.slick = false;
    p.coyote = 0;
    p.stun = PHYS.STUN;
    p.noCut = false;
  }

  flash(s, HIT.COLOR, HIT.FLASH);
  shake(s, dead ? HIT.SHAKE_DEAD : HIT.SHAKE);
  hitstop(s, HIT.HITSTOP);
  emit(s, 'hurt', cx, p.y + p.h / 2);
  popup(s, cx, p.y - 8, 'Aua!', { color: '#ff9ab4' });
  sfx(s, dead ? 'die' : 'hurt');

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

// Kleinste Plattform (nach x) der Art static ohne Eis, die breit genug ist und weit genug rechts endet
function pickStatic(s, minW, minRight) {
  let best = null;
  for (const pl of s.platforms) {
    if (pl.kind !== 'static' || pl.slick || pl.w < minW || pl.x + pl.w <= minRight) continue;
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
  p.dash.air = false;
  p.glide = false;
  p.glideT = 0;
  p.noCut = false;
  p.slick = !!plat.slick;
  endSlam(p);
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

// Abprall von einem Gegner. Im Sturzflug löst er die Schockwelle aus und beendet den Sturzflug.
export function bouncePlayer(s, speed) {
  const p = s.player;
  if (p.dead) return;
  const slamming = p.slam.active;
  p.vy = -(Number.isFinite(speed) ? Math.abs(speed) : PHYS.STOMP_BOUNCE);
  p.onGround = false;
  p.groundId = 0;
  p.slick = false;
  p.coyote = 0;
  p.jumps = Math.min(p.jumps, 1);
  p.glide = false;
  p.glideT = 0; // ein Abprall beginnt eine neue Luftphase
  p.dash.air = false;
  p.noCut = false;
  stretch(p);
  if (slamming) {
    endSlam(p);
    shockwave(s, p);
  }
}
