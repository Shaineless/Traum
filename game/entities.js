// Datenschema aller Spielobjekte. Alle Objekte sind reine Daten (keine Klassen,
// keine Funktionen), damit der komplette Spielzustand mit structuredClone
// kopiert werden kann. Verhalten steckt in den jeweiligen Modulen.

import { ENEMY, LIGHTNING, RAIN, SPIKE, WIND } from './constants.js';
import { newId } from './state-id.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Plattformen ----------
// kind: 'static' | 'moving' | 'breakable'. ground: hohe, massive Plattform (nur Optik).

export function createStaticPlatform(s, x, y, w, { ground = false } = {}) {
  return { id: newId(s), kind: 'static', x, y, w, h: ground ? 200 : 16, ground, vx: 0, vy: 0, dx: 0, dy: 0 };
}

// x,y = Mittelpunkt der Bewegung (linke obere Ecke bei Phase 0). Bewegung: Sinus.
export function createMovingPlatform(s, ox, oy, w, { ax = 0, ay = 0, period = 3.2, phase = 0 } = {}) {
  const omega = (Math.PI * 2) / period;
  return {
    id: newId(s), kind: 'moving', x: ox + ax * Math.sin(phase), y: oy + ay * Math.sin(phase), w, h: 16, ground: false,
    ox, oy, ax, ay, omega, phase, vx: ax * omega * Math.cos(phase), vy: ay * omega * Math.cos(phase), dx: 0, dy: 0,
  };
}

// state: 'idle' (normal) | 'armed' (Spieler stand drauf, 0 bis 0,4 s) | 'shaking' (0,4 bis 0,8 s) | 'broken'
export function createBreakablePlatform(s, x, y, w, { respawn = 0 } = {}) {
  return { id: newId(s), kind: 'breakable', x, y, w, h: 16, ground: false, vx: 0, vy: 0, dx: 0, dy: 0, state: 'idle', timer: 0, alpha: 1, respawn, shakeX: 0 };
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
    dead: 0, telegraph: 0, flash: 0, baseY: y, phase: 0, cooldown: 0, spawnX: x,
  };
}

function onPlatform(s, kind, def, plat, t, dir) {
  const minX = plat.x + 6;
  const maxX = Math.max(minX, plat.x + plat.w - 6 - def.w);
  const e = enemyBase(s, kind, def, minX + (maxX - minX) * clamp(t, 0, 1), plat.y - def.h, plat);
  e.minX = minX;
  e.maxX = maxX;
  e.dir = dir;
  return e;
}

export const createWalker = (s, plat, t = 0.5, { dir = -1 } = {}) => onPlatform(s, 'walker', ENEMY.WALKER, plat, t, dir);

export function createJumper(s, plat, t = 0.5, { dir = -1 } = {}) {
  const e = onPlatform(s, 'jumper', ENEMY.JUMPER, plat, t, dir);
  e.cooldown = 1.2 + (plat.id % 5) * 0.2; // Wartezeit bis zum ersten Sprung
  return e;
}

export function createCharger(s, plat, t = 0.5, { dir = -1 } = {}) {
  const e = onPlatform(s, 'charger', ENEMY.CHARGER, plat, t, dir);
  e.cooldown = 0.6;
  return e;
}

// x,y = Mittelpunkt der Schwebebahn, range = Gesamtbreite der Hin und Her Bewegung
export function createFlyer(s, x, y, { range = 160, amp = ENEMY.FLYER.amp, dir = -1, phase = 0 } = {}) {
  const def = ENEMY.FLYER;
  const e = enemyBase(s, 'flyer', def, x - def.w / 2, y - def.h / 2, null);
  e.minX = x - range / 2 - def.w / 2;
  e.maxX = x + range / 2 - def.w / 2;
  e.dir = dir;
  e.baseY = y - def.h / 2;
  e.amp = amp;
  e.phase = phase;
  e.state = 'fly';
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
export function createLightning(s, x, { idle = 1.2, groundY = 0 } = {}) {
  return {
    id: newId(s), kind: 'lightning', x, y: 0, w: LIGHTNING.WIDTH, h: 0, cloudY: LIGHTNING.CLOUD_Y,
    phase: 'idle', timer: idle, idleTime: idle, charge: 0, struck: false, groundY,
  };
}

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
