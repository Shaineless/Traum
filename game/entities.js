// Datenschema aller Spielobjekte. Alle Objekte sind reine Daten (keine Klassen,
// keine Funktionen), damit der komplette Spielzustand mit structuredClone
// kopiert werden kann. Verhalten steckt in den jeweiligen Modulen.

import { ABILITY, BLINK, COMET, ENEMY, HAIL, LIGHTNING, RAIN, SPIKE, SPRING, WIND } from './constants.js';
import { newId } from './state-id.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Plattformen ----------
// kind: 'static' | 'moving' | 'breakable' | 'spring' | 'blink'. ground: hohe, massive Plattform (nur Optik).
// slick: Eiswolke, der Boden ist sehr rutschig (ICE in constants.js).

export function createStaticPlatform(s, x, y, w, { ground = false, slick = false } = {}) {
  return { id: newId(s), kind: 'static', x, y, w, h: ground ? 200 : 16, ground, slick, vx: 0, vy: 0, dx: 0, dy: 0 };
}

// Sprungwolke: Landet der Spieler obenauf, wird er mit launch px/s nach oben geschleudert (platforms.js und player.js).
// press: 0..1, wie tief die Wolke gerade eingedrückt ist (nur für die Darstellung).
export function createSpringPlatform(s, x, y, w) {
  return { id: newId(s), kind: 'spring', x, y, w, h: 16, ground: false, slick: false, vx: 0, vy: 0, dx: 0, dy: 0, launch: SPRING.SPEED, press: 0 };
}

// Blinkwolke: sichtbar und fest, solange der Takt im Anteil 'on' liegt, davor warn Sekunden lang Flackern, dann weg.
// Takt: ph = (s.t / period + phase) modulo 1. fest, wenn ph < on. warn, wenn ph >= on minus BLINK.WARN / period.
export function createBlinkPlatform(s, x, y, w, { period = BLINK.PERIOD[0], on = BLINK.ON, phase = 0 } = {}) {
  return {
    id: newId(s), kind: 'blink', x, y, w, h: 16, ground: false, slick: false, vx: 0, vy: 0, dx: 0, dy: 0,
    period, on, phase, solid: true, warn: false, alpha: 1,
  };
}

// x,y = Mittelpunkt der Bewegung (linke obere Ecke bei Phase 0). Bewegung: Sinus.
export function createMovingPlatform(s, ox, oy, w, { ax = 0, ay = 0, period = 3.2, phase = 0, pace = 1 } = {}) {
  const omega = ((Math.PI * 2) / period) * pace; // pace verkürzt den Umlauf
  return {
    id: newId(s), kind: 'moving', x: ox + ax * Math.sin(phase), y: oy + ay * Math.sin(phase), w, h: 16, ground: false, slick: false,
    ox, oy, ax, ay, omega, phase, vx: ax * omega * Math.cos(phase), vy: ay * omega * Math.cos(phase), dx: 0, dy: 0,
  };
}

// state: 'idle' (normal) | 'armed' (Spieler stand drauf, 0 bis 0,4 s) | 'shaking' (0,4 bis 0,8 s) | 'broken'
export function createBreakablePlatform(s, x, y, w, { respawn = 0 } = {}) {
  return { id: newId(s), kind: 'breakable', x, y, w, h: 16, ground: false, slick: false, vx: 0, vy: 0, dx: 0, dy: 0, state: 'idle', timer: 0, alpha: 1, respawn, shakeX: 0 };
}

// ---------- Gegner ----------
// dir: 1 nach rechts, -1 nach links. minX/maxX: erlaubter Bereich der linken Kante (x).
// state je Typ: walker 'patrol'|'turn', jumper 'patrol'|'crouch'|'air', flyer 'fly',
// charger 'patrol'|'windup'|'dash'|'cooldown', alle: 'dead' (dead ist dann > 0)
// telegraph: 0..1, Stärke der Vorwarnung für die Darstellung.

function enemyBase(s, kind, def, x, y, host) {
  return {
    id: newId(s), kind, x, y, w: def.w, h: def.h, vx: 0, vy: 0, dir: 1,
    hostId: host ? host.id : 0, minX: x, maxX: x, state: 'patrol', timer: 0, anim: 0,
    dead: 0, telegraph: 0, flash: 0, baseY: y, phase: 0, cooldown: 0, spawnX: x, pace: 1,
  };
}

function onPlatform(s, kind, def, plat, t, dir, pace = 1) {
  const minX = plat.x + 6;
  const maxX = Math.max(minX, plat.x + plat.w - 6 - def.w);
  const e = enemyBase(s, kind, def, minX + (maxX - minX) * clamp(t, 0, 1), plat.y - def.h, plat);
  e.minX = minX;
  e.maxX = maxX;
  e.dir = dir;
  e.pace = pace; // Tempo Faktor (paceAt in constants.js), die Vorwarnzeiten bleiben davon unberührt
  return e;
}

export const createWalker = (s, plat, t = 0.5, { dir = -1, pace = 1 } = {}) => onPlatform(s, 'walker', ENEMY.WALKER, plat, t, dir, pace);

export function createJumper(s, plat, t = 0.5, { dir = -1, pace = 1 } = {}) {
  const e = onPlatform(s, 'jumper', ENEMY.JUMPER, plat, t, dir, pace);
  e.cooldown = 1.2 + (plat.id % 5) * 0.2; // Wartezeit bis zum ersten Sprung
  return e;
}

export function createCharger(s, plat, t = 0.5, { dir = -1, pace = 1 } = {}) {
  const e = onPlatform(s, 'charger', ENEMY.CHARGER, plat, t, dir, pace);
  e.cooldown = 0.6;
  return e;
}

// x,y = Mittelpunkt der Schwebebahn, range = Gesamtbreite der Hin und Her Bewegung
export function createFlyer(s, x, y, { range = 160, amp = ENEMY.FLYER.amp, dir = -1, phase = 0, pace = 1 } = {}) {
  const def = ENEMY.FLYER;
  const e = enemyBase(s, 'flyer', def, x - def.w / 2, y - def.h / 2, null);
  e.minX = x - range / 2 - def.w / 2;
  e.maxX = x + range / 2 - def.w / 2;
  e.dir = dir;
  e.baseY = y - def.h / 2;
  e.amp = amp;
  e.phase = phase;
  e.state = 'fly';
  e.pace = pace;
  return e;
}

// Hagelwolke: schwebt wie der Flieger, kündigt den Schuss an (state 'windup', telegraph 0 bis 1) und verschießt dann
// einen Fächer aus Hagelkörnern nach unten (hazards mit kind 'hail'). state: 'fly' | 'windup' | 'dead'.
export function createHailcloud(s, x, y, { range = 120, amp = ENEMY.HAILCLOUD.amp, dir = -1, phase = 0, pace = 1 } = {}) {
  const def = ENEMY.HAILCLOUD;
  const e = enemyBase(s, 'hailcloud', def, x - def.w / 2, y - def.h / 2, null);
  e.minX = x - range / 2 - def.w / 2;
  e.maxX = x + range / 2 - def.w / 2;
  e.dir = dir;
  e.baseY = y - def.h / 2;
  e.amp = amp;
  e.phase = phase;
  e.state = 'fly';
  e.pace = pace;
  e.cooldown = 1.4 + (phase % 1); // Wartezeit bis zum ersten Schuss
  return e;
}

// ---------- Hindernisse ----------
// hazards: Stachelwolken und Blitze. Treffer nur über hurtPlayer.

export function createSpike(s, plat, t = 0.5) {
  const x = plat.x + clamp(t, 0, 1) * (plat.w - SPIKE.w);
  return { id: newId(s), kind: 'spike', x, y: plat.y - SPIKE.h, w: SPIKE.w, h: SPIKE.h, hostId: plat.id, hostDx: x - plat.x, anim: 0 };
}

// x = Mitte der Einschlagzone. phase: 'idle' | 'glow' | 'flicker' | 'strike' | 'cooldown'.
// Zwischen 'glow' und Einschlag vergehen mindestens GLOW + FLICKER Sekunden (0,9 s) Vorwarnung.
export function createLightning(s, x, { idle = 1.2, groundY = 0, pace = 1 } = {}) {
  if (pace > 1) idle = Math.max(0.6, idle / pace); // höheres Tempo verkürzt nur die Ruhephase, nie die Vorwarnung
  return {
    id: newId(s), kind: 'lightning', x, y: 0, w: LIGHTNING.WIDTH, h: 0, cloudY: LIGHTNING.CLOUD_Y,
    phase: 'idle', timer: idle, idleTime: idle, charge: 0, struck: false, groundY,
  };
}

// Komet: Der Einschlagpunkt (x, y = Oberkante des Bodens) wird zuerst markiert. Phasen 'idle' | 'warn' | 'strike' | 'cooldown'.
// Zwischen Beginn von 'warn' und Einschlag vergehen mindestens COMET.WARN Sekunden. dir: aus welcher Richtung er anfliegt.
export function createComet(s, x, y, { idle = 1.6, dir = 1, pace = 1 } = {}) {
  if (pace > 1) idle = Math.max(0.8, idle / pace);
  return { id: newId(s), kind: 'comet', x, y, w: COMET.W, h: COMET.W, dir, phase: 'idle', timer: idle, idleTime: idle, charge: 0, progress: 0 };
}

// Hagelkorn der Hagelwolke. Fliegt geradlinig mit Schwerkraft 0, verschwindet unter dem Bild oder nach HAIL.LIFE Sekunden.
export const createHail = (s, x, y, vx, vy) => ({ id: newId(s), kind: 'hail', x, y, w: HAIL.R * 2, h: HAIL.R * 2, vx, vy, life: HAIL.LIFE, anim: 0 });

// zones: Wind und Regen (Flächen, die auf den Spieler wirken, aber nie direkt Schaden machen)
// vx: Zieldrift in px/s (wird auf WIND.MAX_VX begrenzt), ay: Beschleunigung in px/s², negativ = nach oben
export function createWind(s, x, y, w, h, { vx = 0, ay = 0 } = {}) {
  return {
    id: newId(s), kind: 'wind', x, y, w, h,
    vx: clamp(vx, -WIND.MAX_VX, WIND.MAX_VX), ay: clamp(ay, -WIND.MAX_LIFT, WIND.MAX_LIFT),
  };
}

// x = linke Kante, w = Breite. y = Unterkante der Wolke, Regen fällt bis zum unteren Bildrand.
export function createRain(s, x, w = RAIN.W, { y = 90, offset = 0 } = {}) {
  return {
    id: newId(s), kind: 'rain', x, y, w, h: 360, active: false, timer: offset, onTime: RAIN.ON, offTime: RAIN.OFF, intensity: 0,
  };
}

// ---------- Sammelobjekte ----------
// bonus: 'normal' | 'risk' | 'event'. falling: Stern fällt langsam, sobald der Spieler näher als triggerDist kommt.

export function createStar(s, x, y, { value = 10, falling = false, bonus = 'normal', triggerDist = 420, fallSpeed = 70 } = {}) {
  return { id: newId(s), kind: 'star', x, y, got: false, value, falling, started: !falling, vy: 0, fallSpeed, triggerDist, bonus, phase: (x * 0.013) % 6.28 };
}

export const createPowerup = (s, type, x, y) => ({ id: newId(s), kind: 'powerup', type, x, y, got: false, phase: (x * 0.011) % 6.28 });

// Traumtor: Mondring. x = Mitte, y = Boden (Oberkante der Plattform). Der Ring reicht 190 px nach oben.
export const createGate = (s, x, y, index) => ({ id: newId(s), kind: 'gate', x, y, w: 120, h: 190, index, passed: false, anim: 0 });

// Wurfstern des Spielers (Fähigkeit Sternenwurf), liegt in s.shots. Besiegt Gegner und zerstört Hagelkörner.
export const createShot = (s, x, y, vx, vy = 0) => ({ id: newId(s), kind: 'shot', x: x - ABILITY.SHOT.W / 2, y: y - ABILITY.SHOT.H / 2, w: ABILITY.SHOT.W, h: ABILITY.SHOT.H, vx, vy, life: ABILITY.SHOT.LIFE, anim: 0 });
