// Hindernisse und Wetter: Stachelwolken, Blitze, Windzonen und Regenwolken.
//
// Blitze sind der heikle Teil und folgen einer festen Regel: Schaden gibt es nur in der Phase
// 'strike', und davor liegt immer sichtbare Vorwarnung aus glow plus flicker (mindestens 0,9 s,
// mit den Werten aus LIGHTNING sind es 1,0 s).
//  1. timer zählt in jeder Phase die Restzeit herunter. Pro Aufruf gibt es höchstens einen
//     Phasenwechsel, die Restzeit eines Schritts verfällt. Dadurch werden Phasen nie kürzer
//     als vorgesehen und kein Einschlag fällt aus der Beobachtung heraus, auch bei großem dt.
//  2. Ein Blitz außerhalb des Bildbereichs wartet in idle mit vollem timer. Eine begonnene
//     Vorwarnung, die aus dem Bild gerät, wird abgebrochen und beginnt später von vorn.
//  3. Die Trefferprüfung läuft nach dem Update desselben Schritts (siehe sim.js). Der Spieler
//     wird also nur in einem Bild getroffen, in dem der Blitz auch gezeichnet wird.
//
// Grenzen des Winds (Werte in WIND), damit er nie eine Lage unlösbar macht:
//  1. Drift höchstens 120 px/s bei 300 px/s Lauftempo. Gegen den Wind bleiben 180 px/s, und
//     player.js lässt die Eingabe gewinnen: der Wind schiebt den Spieler nie entgegen seiner Eingabe zurück.
//  2. Auftrieb höchstens 800 px/s² gegen 1900 Schwerkraft. Es bleibt immer eine Fallbeschleunigung
//     von mindestens 1100, der Spieler schwebt also nie dauerhaft und fällt nie ungebremst.
//  3. Abwind (positives ay) wird nur symmetrisch begrenzt. validate.js prüft Gegenwind (vx),
//     aber keinen Abwind, deshalb sollten Chunks nur Aufwind (negatives ay) einsetzen.

import { H, LIGHTNING, RAIN, SPIKE, W, WIND } from './constants.js';
import { eventWindVx } from './events.js';
import { emit } from './particles.js';
import { hurtPlayer } from './player.js';
import { platformById } from './platforms.js';
import { shake } from './scoring.js';

// Aktiver Bereich: nur Stachelwolken zwischen camX minus 200 und camX plus W plus 500 werden bewegt
const ACTIVE_BEHIND = 200;
const ACTIVE_AHEAD = 500;
// Bildbereich für Blitze und Regen: außerhalb davon bleiben sie ruhig
const VIEW_BEHIND = 100;
const VIEW_AHEAD = 200;
// Hitboxen sind kleiner als die Zeichnung: Spieler 4 px pro Seite, Stachelwolke 6 px seitlich und 8 px oben
const HIT_PLAYER = 4;
const SPIKE_INSET_X = 6;
const SPIKE_INSET_TOP = 8;
// Blitz: Mindestvorwarnung (glow plus flicker), falls die Konstanten einmal kürzer würden
const WARN_TOTAL = 0.9;
const MIN_PHASE = 0.05;
const DEFAULT_IDLE = 1.2;
// charge am Ende von glow, flicker führt von da bis 1
const CHARGE_GLOW = 0.8;
// Nach einem Respawn (clearHazardsNear) wartet ein Blitz so viel länger als sonst
const CLEAR_EXTRA = 2;
// Einschlag nahe der Kamera: Bildrand plus Rand lässt den Bildschirm wackeln
const NEAR_MARGIN = 60;
const STRIKE_SHAKE = 4;
const SPARK_BOTTOM = 10; // Funken am unteren Bildrand, wenn der Blitz keinen Boden trifft
// Regen: wenige leichte Tropfen pro Sekunde, nur im Bild und erst bei spürbarer Stärke
const DRIPS_PER_SEC = 3;
const DRIP_MIN_INTENSITY = 0.3;
const GOLDEN = 0.618034;

const PHASES = ['idle', 'glow', 'flicker', 'strike', 'cooldown'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const frac = (v) => v - Math.floor(v);

// ---------- Hitboxen ----------

// Rechtecke für Darstellung (Debug Hitboxen) und Tests. Die Trefferprüfung rechnet dasselbe ohne Allokation.
export function spikeHitbox(h) {
  return { x: h.x + SPIKE_INSET_X, y: h.y + SPIKE_INSET_TOP, w: h.w - 2 * SPIKE_INSET_X, h: h.h - SPIKE_INSET_TOP };
}

// Einschlagsäule: x plus minus w/2, von der Wolke bis zum unteren Bildrand
export function lightningColumn(h) {
  const y = num(h.cloudY, LIGHTNING.CLOUD_Y);
  return { x: h.x - h.w / 2, y, w: h.w, h: H - y };
}

// Überlappung mit der Spieler Hitbox (px0..px1, py0..py1), nur echte Überlappung zählt, Berühren nicht
function spikeTouches(h, px0, px1, py0, py1) {
  return px1 > h.x + SPIKE_INSET_X && px0 < h.x + h.w - SPIKE_INSET_X && py1 > h.y + SPIKE_INSET_TOP && py0 < h.y + h.h;
}

function columnTouches(h, px0, px1, py0, py1) {
  return px1 > h.x - h.w / 2 && px0 < h.x + h.w / 2 && py1 > num(h.cloudY, LIGHTNING.CLOUD_Y) && py0 < H;
}

// ---------- Blitze ----------

const glowTime = () => Math.max(MIN_PHASE, num(LIGHTNING.GLOW, 0.55));
const flickerTime = () => Math.max(MIN_PHASE, num(LIGHTNING.FLICKER, 0.45), WARN_TOTAL - glowTime());

// Zurück in die Ruhe: idle mit Wartezeit timer, ohne Aufladung
function restLightning(h, timer) {
  h.phase = 'idle';
  h.timer = timer;
  h.charge = 0;
  h.struck = false;
}

// charge für die Darstellung: glow 0 bis 0,8, flicker 0,8 bis 1, strike 1, sonst 0
function setCharge(h) {
  if (h.phase === 'glow') h.charge = CHARGE_GLOW * clamp(1 - h.timer / glowTime(), 0, 1);
  else if (h.phase === 'flicker') h.charge = CHARGE_GLOW + (1 - CHARGE_GLOW) * clamp(1 - h.timer / flickerTime(), 0, 1);
  else h.charge = h.phase === 'strike' ? 1 : 0;
}

// Oberkante des höchsten Bodens unter der Säule (Funken sollen dort sprühen, wo der Blitz auftrifft)
function impactY(s, h) {
  if (h.groundY > 0) return h.groundY;
  const x0 = h.x - h.w / 2;
  const x1 = h.x + h.w / 2;
  const top = num(h.cloudY, LIGHTNING.CLOUD_Y);
  let best = H - SPARK_BOTTOM;
  const list = s.platforms;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.x >= x1 || p.x + p.w <= x0) continue;
    if (p.y > top && p.y < best) best = p.y;
  }
  return best;
}

function strikeEffects(s, h, cam) {
  h.struck = true;
  if (h.x < cam - NEAR_MARGIN || h.x > cam + W + NEAR_MARGIN) return;
  shake(s, STRIKE_SHAKE);
  emit(s, 'spark', h.x, impactY(s, h));
  emit(s, 'spark', h.x, num(h.cloudY, LIGHTNING.CLOUD_Y) + SPARK_BOTTOM);
}

function updateLightning(s, h, dt, cam) {
  if (!Number.isFinite(h.x)) return;
  if (!Number.isFinite(h.idleTime) || h.idleTime < 0) h.idleTime = DEFAULT_IDLE;
  if (!PHASES.includes(h.phase) || !Number.isFinite(h.timer)) restLightning(h, h.idleTime);

  const inView = h.x >= cam - VIEW_BEHIND && h.x <= cam + W + VIEW_AHEAD;
  if (!inView && (h.phase === 'idle' || h.phase === 'glow' || h.phase === 'flicker')) {
    // Draußen wartet der Blitz mit vollem timer. Ein höherer timer (nach clearHazardsNear) bleibt.
    if (h.phase === 'idle') {
      if (h.timer < h.idleTime) h.timer = h.idleTime;
      h.charge = 0;
    } else {
      restLightning(h, h.idleTime);
    }
    return;
  }

  h.timer -= dt;
  if (h.timer <= 0) {
    switch (h.phase) {
      case 'idle':
        h.phase = 'glow';
        h.timer = glowTime();
        h.struck = false;
        break;
      case 'glow':
        h.phase = 'flicker';
        h.timer = flickerTime();
        break;
      case 'flicker':
        h.phase = 'strike';
        h.timer = Math.max(MIN_PHASE, num(LIGHTNING.STRIKE, 0.22));
        strikeEffects(s, h, cam);
        break;
      case 'strike':
        h.phase = 'cooldown';
        h.timer = Math.max(0, num(LIGHTNING.COOLDOWN, 1.1));
        break;
      default:
        restLightning(h, h.idleTime);
    }
  }
  setCharge(h);
}

// ---------- Stachelwolken ----------

// Folgt der Host Plattform, auch wenn sie sich bewegt. Ist sie weg, bleibt die Wolke stehen.
function updateSpike(s, h, dt) {
  h.anim = num(h.anim) + dt;
  const plat = platformById(s, h.hostId);
  if (!plat || !Number.isFinite(plat.x) || !Number.isFinite(plat.y) || !Number.isFinite(h.hostDx)) return;
  h.x = plat.x + h.hostDx;
  h.y = plat.y - num(h.h, SPIKE.h);
}

// ---------- Regen ----------

// Zyklus aus aus (offTime) und an (onTime). timer zählt die vergangene Zeit im aktuellen Zustand,
// ein Start timer (offset) größer als offTime beginnt mitten im Regen.
function cycleRain(z, dt) {
  const on = Math.max(0, num(z.onTime, RAIN.ON));
  const off = Math.max(0, num(z.offTime, RAIN.OFF));
  if (on <= 0) {
    z.active = false;
    z.timer = 0;
  } else if (off <= 0) {
    z.active = true;
    z.timer = (num(z.timer) + dt) % on;
  } else {
    const pos = (z.active ? off + num(z.timer) : num(z.timer)) + dt;
    const wrapped = pos % (on + off);
    z.active = wrapped >= off;
    z.timer = z.active ? wrapped - off : wrapped;
  }
}

// Leichte Tropfen: ein Zähler pro Zone, Ort aus der Zeit abgeleitet (kein Zufall, kein Einfluss auf s.rng)
function dripRain(s, z, dt, cam) {
  if (!z.active || z.intensity < DRIP_MIN_INTENSITY) return;
  const id = num(z.id);
  z.drip = (Number.isFinite(z.drip) ? z.drip : frac(id * 0.37)) + dt * DRIPS_PER_SEC;
  if (z.drip < 1) return;
  z.drip = 0;
  const x0 = Math.max(z.x, cam);
  const x1 = Math.min(z.x + z.w, cam + W);
  if (x1 <= x0) return;
  emit(s, 'rain', x0 + (x1 - x0) * frac(num(s.t) * GOLDEN * 7 + id * 0.31), z.y);
}

function updateRain(s, z, dt, cam) {
  // Außerhalb des Bildbereichs ruht die Zone, der Regen setzt erst im Bild ein
  if (!(z.x + z.w >= cam - VIEW_BEHIND && z.x <= cam + W + VIEW_AHEAD)) return;
  cycleRain(z, dt);
  const step = RAIN.FADE > 0 ? dt / RAIN.FADE : 1;
  const now = clamp(num(z.intensity), 0, 1);
  z.intensity = z.active ? Math.min(1, now + step) : Math.max(0, now - step);
  dripRain(s, z, dt, cam);
}

// ---------- Schritt ----------

export function updateObstacles(s, dt) {
  if (!(dt > 0)) return;
  const cam = num(s.camX);
  const x0 = cam - ACTIVE_BEHIND;
  const x1 = cam + W + ACTIVE_AHEAD;

  const hazards = s.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.kind === 'lightning') {
      updateLightning(s, h, dt, cam);
    } else if (h.kind === 'spike') {
      if (h.x + h.w < x0 || h.x > x1) continue;
      updateSpike(s, h, dt);
    }
  }

  const zones = s.zones;
  for (let i = 0; i < zones.length; i++) {
    if (zones[i].kind === 'rain') updateRain(s, zones[i], dt, cam);
  }
}

// ---------- Spieler gegen Hindernisse ----------

export function playerVsHazards(s) {
  const p = s.player;
  const list = s.hazards;
  if (!list.length || p.dead) return;
  const px0 = p.x + HIT_PLAYER;
  const px1 = p.x + p.w - HIT_PLAYER;
  const py0 = p.y + HIT_PLAYER;
  const py1 = p.y + p.h - HIT_PLAYER;
  for (let i = 0; i < list.length; i++) {
    if (p.invuln > 0) return; // ein Treffer pro Schritt genügt, danach schützt die Unverwundbarkeit
    const h = list[i];
    if (h.kind === 'spike') {
      if (spikeTouches(h, px0, px1, py0, py1)) {
        hurtPlayer(s, { kind: 'spike', label: 'Stachelwolke', x: h.x + h.w / 2, y: h.y + h.h / 2 });
      }
    } else if (h.kind === 'lightning' && h.phase === 'strike') {
      // Nur in der Phase strike, nie in idle, glow, flicker oder cooldown
      if (columnTouches(h, px0, px1, py0, py1)) {
        hurtPlayer(s, { kind: 'lightning', label: 'Blitz', x: h.x, y: p.y + p.h / 2 });
      }
    }
  }
}

// ---------- Aufräumen ----------

// Stachelwolken im x Bereich verschwinden, Blitze im Bereich beginnen von vorn mit längerer Wartezeit.
export function clearHazardsNear(s, x0, x1) {
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
  if (x0 > x1) [x0, x1] = [x1, x0];
  const list = s.hazards;
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.kind === 'spike' && h.x + h.w >= x0 && h.x <= x1) {
      emit(s, 'poof', h.x + h.w / 2, h.y + h.h / 2);
      continue;
    }
    if (h.kind === 'lightning' && h.x + h.w / 2 >= x0 && h.x - h.w / 2 <= x1) {
      if (!Number.isFinite(h.idleTime) || h.idleTime < 0) h.idleTime = DEFAULT_IDLE;
      restLightning(h, h.idleTime + CLEAR_EXTRA);
    }
    list[j++] = h;
  }
  list.length = j;
}

// ---------- Wind und Regen abfragen ----------

const inRect = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

// Wirkung von Windzonen (und Sturm Ereignis) auf einen Punkt: { vx, ay }. Grenzen siehe Kopf der Datei.
export function windAt(s, x, y) {
  let vx = 0;
  let ay = 0;
  const zones = s.zones;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.kind !== 'wind' || !inRect(z, x, y)) continue;
    vx += num(z.vx);
    ay += num(z.ay);
  }
  vx += num(eventWindVx(s));
  return { vx: clamp(vx, -WIND.MAX_VX, WIND.MAX_VX), ay: clamp(ay, -WIND.MAX_LIFT, WIND.MAX_LIFT) };
}

// Regenstärke 0..1: die größte intensity aller Regenzonen, die den Punkt enthalten.
// Eine Zone reicht von ihrer Wolke (y) bis zum unteren Bildrand.
export function rainAt(s, x, y) {
  let best = 0;
  const zones = s.zones;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.kind !== 'rain' || !(z.intensity > best)) continue;
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= H) best = z.intensity;
  }
  return Math.min(1, best);
}
