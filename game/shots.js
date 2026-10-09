// Wurfsterne des Spielers (s.shots). fireShot erzeugt sie, updateShots bewegt sie geradlinig,
// besiegt Gegner (damageEnemy) und zerstört Hagelkörner. Wurfsterne treffen nie den Spieler.

import { ABILITY, H, W } from './constants.js';
import { damageEnemy } from './enemies.js';
import { createShot } from './entities.js';
import { destroyHail } from './obstacles.js';
import { emit } from './particles.js';
import { sfx } from './scoring.js';

const { SHOT } = ABILITY;

const MAX_SHOTS = 4; // höchstens so viele Wurfsterne gleichzeitig
const MAX_DT = 1 / 20; // größere Schritte werden gekappt
const OUTSIDE = 120; // so weit außerhalb des Bildes verschwindet ein Wurfstern
const TRAIL_EVERY = 0.05; // Abstand der Funken hinter dem Wurfstern in Sekunden
const SHOT_R = SHOT.W / 2; // destroyHail addiert den Radius des Hagelkorns selbst

// Wirft einen Stern in Blickrichtung. Gibt true zurück, wenn geworfen wurde.
export function fireShot(s) {
  const p = s && s.player;
  if (!p || p.dead || !(p.ammo > 0) || p.throwCd > 0) return false;
  if (!Array.isArray(s.shots)) s.shots = [];
  if (s.shots.length >= MAX_SHOTS) return false; // dann bleibt der Vorrat unberührt
  const dir = p.face < 0 ? -1 : 1;
  const x = p.x + p.w / 2 + dir * (p.w / 2);
  const y = p.y + p.h / 2;
  s.shots.push(createShot(s, x, y, dir * SHOT.SPEED, 0));
  p.ammo -= 1;
  p.throwCd = SHOT.COOLDOWN;
  sfx(s, 'throw');
  emit(s, 'throw', x, y, { dir });
  return true;
}

// Der lebende Gegner, den der Wurfstern auf seinem Weg von (px, py) zur neuen Position als Erstes berührt
function firstEnemyHit(s, sh, px, py) {
  const list = s.enemies;
  if (!Array.isArray(list) || list.length === 0) return null;
  const x0 = Math.min(px, sh.x);
  const x1 = Math.max(px, sh.x) + sh.w;
  const y0 = Math.min(py, sh.y);
  const y1 = Math.max(py, sh.y) + sh.h;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.dead > 0 || e.state === 'dead') continue;
    if (e.x + e.w <= x0 || e.x >= x1 || e.y + e.h <= y0 || e.y >= y1) continue;
    const dx = e.x + e.w / 2 - (px + sh.w / 2);
    const dy = e.y + e.h / 2 - (py + sh.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// Ein Schritt für einen Wurfstern. Gibt false zurück, wenn er verschwindet.
function stepShot(s, sh, dt, x0, x1) {
  const px = sh.x;
  const py = sh.y;
  const nx = px + sh.vx * dt;
  const ny = py + sh.vy * dt;
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(sh.life)) return false;
  sh.x = nx;
  sh.y = ny;
  sh.anim += dt;
  if (nx + sh.w < x0 || nx > x1 || ny + sh.h < -OUTSIDE || ny > H + OUTSIDE) return false;

  const cx = nx + sh.w / 2;
  const cy = ny + sh.h / 2;
  if (Math.floor(sh.anim / TRAIL_EVERY) > Math.floor((sh.anim - dt) / TRAIL_EVERY)) emit(s, 'magnet', cx, cy);

  // Treffer: der Wurfstern verschwindet, auch wenn der Gegner den Schaden nicht annimmt
  const hit = firstEnemyHit(s, sh, px, py);
  if (hit) {
    damageEnemy(s, hit, 'shot');
    return false;
  }
  if (destroyHail(s, cx, cy, SHOT_R) > 0) return false;

  sh.life -= dt;
  return sh.life > 0;
}

export function updateShots(s, dt) {
  const list = s && s.shots;
  if (!Array.isArray(list) || list.length === 0 || !(dt > 0)) return;
  if (dt > MAX_DT) dt = MAX_DT;
  const cam = Number.isFinite(s.camX) ? s.camX : 0;
  const x0 = cam - OUTSIDE;
  const x1 = cam + W + OUTSIDE;
  let keep = 0;
  for (let i = 0; i < list.length; i++) {
    const sh = list[i];
    if (!sh || typeof sh !== 'object') continue;
    if (stepShot(s, sh, dt, x0, x1)) list[keep++] = sh;
  }
  list.length = keep;
}
