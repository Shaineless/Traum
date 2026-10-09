// Gegner: Walker, Jumper, Flyer, Charger und Hagelwolke sowie das Besiegen durch Stomp, Dash, Stampfen oder Wurfstern.
// Jede Bedrohung kündigt sich an (state und telegraph 0..1 steigen linear mit der Vorwarnung)
// und folgt einem festen Muster. Bodengegner bleiben immer zwischen minX und maxX, also auf
// ihrer Host Plattform. Die Plattform wird dafür nie nachgeschlagen: Ist sie weg, patrouilliert
// der Gegner einfach weiter. Gegner hängen nur an statischen Plattformen (siehe validate.js).
//
// Tempo (e.pace, siehe paceAt in constants.js): macht Laufen, Fliegen und Warten schneller.
// Die Vorwarnzeiten (Walker turnTime, Jumper crouchTime, Charger windup, Hagelwolke windup) bleiben fest.

import { ENEMY, LIMITS, PHYS, STEP, W } from './constants.js';
import { createHail } from './entities.js';
import { emit } from './particles.js';
import { bouncePlayer, hurtPlayer } from './player.js';
import { range } from './rng.js';
import { registerKill, sfx } from './scoring.js';

// Aktiver Bereich: nur Gegner zwischen camX minus 200 und camX plus W plus 500 werden bewegt
const ACTIVE_BEHIND = 200;
const ACTIVE_AHEAD = 500;
// So lange schrumpft ein besiegter Gegner, danach wird er entfernt
export const DEAD_TIME = 0.4;
// Hitboxen sind pro Seite um diese Pixel kleiner als die Zeichnung
const HIT_ENEMY = 3;
const HIT_PLAYER = 4;
// Stomp: Die Füße waren im Vorschritt höchstens so weit unter der Oberkante des Gegners
const STOMP_TOLERANCE = 10;
// Untergrenzen der Vorwarnung, auch wenn ENEMY kürzere Werte hätte
const MIN_CROUCH = 0.45;
const MIN_WINDUP = 0.7;
const MIN_HAIL_WINDUP = 0.8;
// Zittern beim Aufladen (nur Darstellung, die Hitbox bleibt stehen)
const SHAKE_AMP = 2.5;
const SHAKE_RATE = 90;
// Sicherheitszuschlag auf die Flugzeit eines Hüpfers (ein Schritt Diskretisierung)
const HOP_MARGIN = 1 / 30;
// Hagelwolke: schießt nur, solange ihre Mitte im Bild liegt (mit diesem Rand links und rechts)
const SHOT_VIEW_MARGIN = 40;
// Nach vollem Telegraph hält die Hagelwolke noch eineinhalb Schritte, dann fällt der Schuss.
// So liegen zwischen dem ersten sichtbaren Telegraph und dem ersten Hagelkorn sicher mehr als 0,8 s.
const HAIL_HOLD = 1.5 * STEP;
const HAIL_PUFF_COLOR = '#dff3ff';
// Tempo Faktor wird auf diesen Bereich begrenzt (kaputte Werte zählen als 1)
const PACE_MIN = 0.25;
const PACE_MAX = 3;

const LABELS = {
  walker: 'Gewitterwolke',
  jumper: 'Hüpfer',
  flyer: 'Fliegende Wolke',
  charger: 'Sturmwolke',
  hailcloud: 'Hagelwolke',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Fortschritt 0..1 einer Wartezeit, auch bei Dauer 0 ohne NaN
const progress = (t, dur) => (dur > 0 ? Math.min(1, t / dur) : 1);
const paceOf = (e) => (e.pace > 0 ? clamp(e.pace, PACE_MIN, PACE_MAX) : 1);

// ---------- Hitboxen ----------

export function enemyHitbox(e) {
  return { x: e.x + HIT_ENEMY, y: e.y + HIT_ENEMY, w: e.w - 2 * HIT_ENEMY, h: e.h - 2 * HIT_ENEMY };
}

export function playerHitbox(p) {
  return { x: p.x + HIT_PLAYER, y: p.y + HIT_PLAYER, w: p.w - 2 * HIT_PLAYER, h: p.h - 2 * HIT_PLAYER };
}

// ---------- Bodengegner ----------

// Gemeinsamer Streifzug: läuft in Blickrichtung und dreht sofort am Rand um.
function strollStep(e, speed, dt) {
  if ((e.dir > 0 && e.x >= e.maxX) || (e.dir < 0 && e.x <= e.minX)) e.dir = -e.dir;
  e.x = clamp(e.x + e.dir * speed * dt, e.minX, e.maxX);
  e.vx = e.dir * speed;
}

function updateWalker(e, dt) {
  const def = ENEMY.WALKER;
  if (e.state === 'turn') {
    // Die Vorwarnung am Rand ist fest, das Tempo ändert sie nicht
    e.timer += dt;
    e.vx = 0;
    e.telegraph = progress(e.timer, def.turnTime);
    if (e.timer >= def.turnTime) {
      e.dir = -e.dir;
      e.state = 'patrol';
      e.timer = 0;
      e.telegraph = 0;
    }
    return;
  }
  const speed = def.speed * paceOf(e);
  e.state = 'patrol';
  e.telegraph = 0;
  e.x = clamp(e.x + e.dir * speed * dt, e.minX, e.maxX);
  e.vx = e.dir * speed;
  // Am Rand erst stehen bleiben, dann drehen. Die Vorwarnung beginnt im nächsten Schritt.
  if ((e.dir > 0 && e.x >= e.maxX) || (e.dir < 0 && e.x <= e.minX)) {
    e.state = 'turn';
    e.timer = 0;
    e.vx = 0;
  }
}

// Der Jumper liest den Spieler nie. Sein Muster hängt nur von sich selbst und s.rng ab.
function updateJumper(s, e, dt) {
  const def = ENEMY.JUMPER;
  if (e.state === 'crouch') {
    const crouch = Math.max(MIN_CROUCH, def.crouchTime);
    e.timer += dt;
    e.vx = 0;
    e.telegraph = progress(e.timer, crouch);
    if (e.timer >= crouch) {
      e.state = 'air';
      e.timer = 0;
      e.telegraph = 0;
      e.vx = e.dir * def.hopVx;
      e.vy = -def.hopVy;
    }
    return;
  }
  if (e.state === 'air') {
    e.vy += PHYS.GRAVITY * dt;
    e.y += e.vy * dt;
    e.x = clamp(e.x + e.vx * dt, e.minX, e.maxX);
    if (e.vy > 0 && e.y >= e.baseY) {
      e.y = e.baseY;
      e.vx = 0;
      e.vy = 0;
      e.state = 'patrol';
      e.timer = 0;
      // Zufall zuerst, dann das Tempo: so verbraucht s.rng bei jedem Tempo gleich viel
      e.cooldown = range(s, def.minWait, def.maxWait) / paceOf(e);
    }
    return;
  }
  e.state = 'patrol';
  e.telegraph = 0;
  strollStep(e, def.speed, dt);
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.cooldown > 0) return;
  // Zusammenziehen beginnt. Die Sprungrichtung steht ab jetzt fest und ist sichtbar.
  // Passt der Sprung in Blickrichtung nicht mehr auf die Plattform, wird umgedreht.
  const reach = def.hopVx * ((2 * def.hopVy) / PHYS.GRAVITY + HOP_MARGIN);
  const roomRight = e.maxX - e.x;
  const roomLeft = e.x - e.minX;
  if ((e.dir > 0 ? roomRight : roomLeft) < reach) {
    // Gegenrichtung nehmen, wenn dort Platz ist, sonst die mit mehr Platz (sehr schmale Plattform)
    if ((e.dir > 0 ? roomLeft : roomRight) >= reach) e.dir = -e.dir;
    else e.dir = roomRight >= roomLeft ? 1 : -1;
  }
  e.state = 'crouch';
  e.timer = 0;
  e.telegraph = 0;
  e.vx = 0;
}

function updateCharger(s, e, dt) {
  const def = ENEMY.CHARGER;
  if (e.state === 'windup') {
    const windup = Math.max(MIN_WINDUP, def.windup);
    e.timer += dt;
    e.vx = 0;
    e.telegraph = progress(e.timer, windup);
    e.shakeX = Math.sin(e.anim * SHAKE_RATE) * SHAKE_AMP * e.telegraph;
    if (e.timer >= windup) {
      e.state = 'dash';
      e.timer = 0;
      e.telegraph = 0;
      e.shakeX = 0;
    }
    return;
  }
  if (e.state === 'dash') {
    e.timer += dt;
    e.vx = e.dir * def.dashSpeed;
    e.x = clamp(e.x + e.vx * dt, e.minX, e.maxX);
    // Stoppt an der Plattformkante oder nach dashTime, die Richtung ändert sich nie
    if (e.x <= e.minX || e.x >= e.maxX || e.timer >= def.dashTime) {
      e.state = 'cooldown';
      e.timer = 0;
      e.vx = 0;
    }
    return;
  }
  if (e.state === 'cooldown') {
    e.timer += dt;
    e.vx = 0;
    // Die Pause nach dem Sturm wird mit dem Tempo kürzer, das Aufladen davor nicht
    if (e.timer >= def.cooldown / paceOf(e)) {
      e.state = 'patrol';
      e.timer = 0;
    }
    return;
  }
  e.state = 'patrol';
  e.telegraph = 0;
  strollStep(e, def.speed * paceOf(e), dt);
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.cooldown > 0) return;
  const p = s.player;
  if (p.dead) return;
  const dx = p.x + p.w / 2 - (e.x + e.w / 2);
  const dFeet = p.y + p.h - (e.y + e.h);
  if (Math.abs(dx) > def.detectX || Math.abs(dFeet) > def.detectY) return;
  // Aufladen: Richtung wird jetzt festgelegt und bleibt bis zum Ende des Dashs
  if (dx !== 0) e.dir = dx > 0 ? 1 : -1;
  e.state = 'windup';
  e.timer = 0;
  e.telegraph = 0;
  e.vx = 0;
}

// ---------- Flyer und Hagelwolke ----------

// Schwebt sinusförmig und wendet an den Enden seiner Bahn. moveX false: bleibt in x stehen, nur der Sinus läuft.
function floatStep(s, e, def, dt, moveX) {
  const amp = Number.isFinite(e.amp) ? e.amp : def.amp;
  if (moveX) {
    const speed = def.speed * paceOf(e);
    let x = (Number.isFinite(e.x) ? e.x : e.minX) + e.dir * speed * dt;
    if (x >= e.maxX) {
      x = e.maxX;
      e.dir = -1;
    } else if (x <= e.minX) {
      x = e.minX;
      e.dir = 1;
    }
    e.x = x;
    e.vx = e.dir * speed;
  } else {
    e.vx = 0;
  }
  const a = def.omega * s.t + e.phase;
  e.y = e.baseY + amp * Math.sin(a);
  e.vy = amp * def.omega * Math.cos(a);
}

function updateFlyer(s, e, dt) {
  e.state = 'fly';
  e.telegraph = 0;
  floatStep(s, e, ENEMY.FLYER, dt, true);
}

const hailBalls = (def) => Math.max(1, Math.floor(def.balls) || 1);

// Schuss erlaubt: Mitte der Wolke im Bild und Platz in s.hazards für den ganzen Fächer
function mayShoot(s, e, def) {
  const cam = Number.isFinite(s.camX) ? s.camX : 0;
  const cx = e.x + e.w / 2;
  if (!(cx >= cam - SHOT_VIEW_MARGIN && cx <= cam + W + SHOT_VIEW_MARGIN)) return false;
  return Array.isArray(s.hazards) && s.hazards.length + hailBalls(def) <= LIMITS.MAX_HAZARDS;
}

// Fächer nach unten: Winkel gleichmäßig von minus spread bis plus spread um die Senkrechte.
// Nie auf den Spieler gezielt, der Fächer hängt nur von der Wolke ab.
function fireHail(s, e, def) {
  const n = hailBalls(def);
  const ox = e.x + e.w / 2;
  const oy = e.y + e.h;
  for (let i = 0; i < n; i++) {
    const a = n > 1 ? -def.spread + (2 * def.spread * i) / (n - 1) : 0;
    s.hazards.push(createHail(s, ox, oy, Math.sin(a) * def.ballSpeed, Math.cos(a) * def.ballSpeed));
  }
  sfx(s, 'hail');
  emit(s, 'poof', ox, oy, { color: HAIL_PUFF_COLOR });
}

// Telegraph und Zittern aus der Zeit im Windup
function hailPose(e, windup) {
  e.telegraph = progress(e.timer, windup);
  e.shakeX = Math.sin(e.anim * SHAKE_RATE) * SHAKE_AMP * e.telegraph;
}

function updateHailcloud(s, e, dt) {
  const def = ENEMY.HAILCLOUD;
  const windup = Math.max(MIN_HAIL_WINDUP, def.windup);
  const rest = def.cooldown / paceOf(e);
  if (e.state === 'windup') {
    // Während der Vorwarnung bleibt die Wolke in x stehen und zittert, damit der Fächer lesbar ist
    e.timer += dt;
    floatStep(s, e, def, dt, false);
    hailPose(e, windup);
    if (e.timer >= windup + HAIL_HOLD) {
      e.state = 'fly';
      e.timer = 0;
      e.telegraph = 0;
      e.shakeX = 0;
      e.cooldown = rest;
      if (mayShoot(s, e, def)) fireHail(s, e, def);
    }
    return;
  }
  e.state = 'fly';
  e.telegraph = 0;
  if (e.shakeX) e.shakeX = 0;
  floatStep(s, e, def, dt, true);
  e.cooldown = Number.isFinite(e.cooldown) ? Math.max(0, e.cooldown - dt) : 0;
  if (e.cooldown > 0) return;
  if (!mayShoot(s, e, def)) {
    // Außerhalb des Bildes oder bei vollen Hindernissen entfällt der Schuss
    e.cooldown = rest;
    return;
  }
  // Das Telegraph ist schon in diesem Schritt sichtbar (größer als 0), die Zeit läuft ab jetzt
  e.state = 'windup';
  e.timer = dt;
  e.vx = 0;
  hailPose(e, windup);
}

// ---------- Schritt ----------

export function updateEnemies(s, dt) {
  const list = s.enemies;
  if (!list.length || !(dt > 0)) return;
  const x0 = s.camX - ACTIVE_BEHIND;
  const x1 = s.camX + W + ACTIVE_AHEAD;
  let expired = false;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead > 0) {
      // Tote Gegner laufen immer weiter, damit sie auch außerhalb des Bildes verschwinden
      e.dead += dt;
      if (e.dead >= DEAD_TIME) expired = true;
      continue;
    }
    if (e.x + e.w < x0 || e.x > x1) continue;
    e.anim += dt;
    if (e.dir !== 1 && e.dir !== -1) e.dir = e.dir < 0 ? -1 : 1;
    if (e.kind === 'flyer') {
      updateFlyer(s, e, dt);
      continue;
    }
    if (e.kind === 'hailcloud') {
      updateHailcloud(s, e, dt);
      continue;
    }
    // Bodengegner dürfen die Plattform nie verlassen
    e.x = clamp(e.x, e.minX, e.maxX);
    if (e.kind === 'walker') updateWalker(e, dt);
    else if (e.kind === 'jumper') updateJumper(s, e, dt);
    else if (e.kind === 'charger') updateCharger(s, e, dt);
  }
  if (expired) {
    let j = 0;
    for (let i = 0; i < list.length; i++) if (!(list[i].dead >= DEAD_TIME)) list[j++] = list[i];
    list.length = j;
  }
}

// ---------- Besiegen ----------

function defeat(s, e, how) {
  e.dead = 0.001;
  e.state = 'dead';
  e.telegraph = 0;
  e.vx = 0;
  e.vy = 0;
  if (e.shakeX) e.shakeX = 0;
  registerKill(s, e, how);
}

// Besiegt einen lebenden Gegner genau wie ein Stomp (Punkte, Combo, dead, Partikel).
// how: 'dash' | 'slam' | 'shot' (alles außer 'dash' zählt in registerKill wie ein Stomp).
// Gibt true zurück, wenn er besiegt wurde, false wenn er schon tot war.
export function damageEnemy(s, e, how) {
  if (!e || e.dead > 0 || e.state === 'dead') return false;
  defeat(s, e, how === 'dash' || how === 'slam' || how === 'shot' ? how : 'stomp');
  emit(s, 'poof', e.x + e.w / 2, e.y + e.h / 2);
  return true;
}

// ---------- Spieler gegen Gegner ----------

export function playerVsEnemies(s) {
  const p = s.player;
  const list = s.enemies;
  if (!list.length || p.dead) return;
  const px0 = p.x + HIT_PLAYER;
  const px1 = p.x + p.w - HIT_PLAYER;
  const py0 = p.y + HIT_PLAYER;
  const py1 = p.y + p.h - HIT_PLAYER;
  const dashing = !!p.dash && p.dash.t > 0;
  // Im Sturzflug zählt jede Berührung als Stomp: der Spieler kommt von oben und die Schockwelle
  // träfe den Gegner ohnehin. Ein Gegner trifft den Spieler im Sturzflug also nie.
  const slamming = !!p.slam && p.slam.active && p.vy > 0;
  // Alles, was den Stomp entscheidet, wird vor den ersten Änderungen festgehalten,
  // damit zwei Gegner im selben Schritt gleich behandelt werden.
  const falling = p.vy > 0;
  const prevFoot = p.y + p.h - p.vy * STEP;
  let stomped = false;
  let culprit = null;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead > 0) continue;
    if (e.x + HIT_ENEMY >= px1 || e.x + e.w - HIT_ENEMY <= px0) continue;
    if (e.y + HIT_ENEMY >= py1 || e.y + e.h - HIT_ENEMY <= py0) continue;
    if (dashing) {
      damageEnemy(s, e, 'dash');
      continue;
    }
    // Der Gegner kann sich selbst bewegen (Hüpfer, Flieger), darum zählt seine Oberkante im Vorschritt
    const prevTop = e.y - (e.vy || 0) * STEP;
    if (slamming || (falling && prevFoot <= prevTop + STOMP_TOLERANCE)) {
      defeat(s, e, 'stomp');
      stomped = true;
      continue;
    }
    if (!culprit) culprit = e;
  }
  if (stomped) bouncePlayer(s, p.jumpHeld ? PHYS.STOMP_BOUNCE_HELD : PHYS.STOMP_BOUNCE);
  if (culprit && !(p.invuln > 0)) {
    hurtPlayer(s, {
      kind: 'enemy',
      label: LABELS[culprit.kind] || 'Gegner',
      x: culprit.x + culprit.w / 2,
      y: culprit.y + culprit.h / 2,
    });
  }
}

// ---------- Aufräumen ----------

// Entfernt alle Gegner, die den x Bereich berühren. Lebende verschwinden mit einer Wolke aus Partikeln.
export function clearEnemiesNear(s, x0, x1) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  const list = s.enemies;
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.x + e.w >= x0 && e.x <= x1) {
      if (!(e.dead > 0)) emit(s, 'poof', e.x + e.w / 2, e.y + e.h / 2);
    } else {
      list[j++] = e;
    }
  }
  list.length = j;
}
