// Bewegliche, brüchige, blinkende und federnde Plattformen. Die Bewegung ist analytisch (platformAt aus reach.js),
// dadurch driftet nichts und der Generator rechnet mit denselben Positionen.
//
// Blinkwolken laufen rein nach der Uhr s.t (kein Zufall, kein eigener Zähler): ph = (s.t / period + phase) modulo 1,
// fest solange ph < on. Die letzten BLINK.WARN Sekunden davor flackern sie (warn). Das Verschwinden hat also immer
// Vorwarnung, das Wiedererscheinen nicht. Dabei passiert dem Spieler nichts Unfaires: Plattformen sind einseitig,
// wer beim Erscheinen schon in oder unter ihr ist, wird weder hochgeschoben noch festgehalten.

import { BLINK, W } from './constants.js';
import { emit } from './particles.js';
import { platformAt } from './reach.js';

// Zeitplan einer brüchigen Plattform, Angaben in Sekunden
const BREAK = {
  ARM: 0.4, // nach der Landung normal
  SHAKE: 0.4, // danach wackelt sie, dann bricht sie
  ALPHA_MIN: 0.55, // Durchsichtigkeit kurz vor dem Bruch
  FADE_IN: 0.4, // Wiederkehr: so lange blendet sie ein
  POOF_EVERY: 0.12, // Abstand der Staubwölkchen beim Wackeln
  AMP: [1, 4], // Auslenkung in px, steigt während des Wackelns
  FREQ: 70, // Schwingung in rad pro Sekunde
};
const EPS = 1e-9; // Rundungstoleranz beim Aufsummieren von dt

// Sprungwolke: so lange klingt das Eindrücken (press) nach dem Abprall von 1 auf 0 ab
const SPRING_PRESS_TIME = 0.25;

// Blinkwolke: Durchsichtigkeit, Flackern in der Vorwarnung und Staubwölkchen beim Wechsel
const BLINK_FX = {
  ALPHA_OFF: 0.15, // unsichtbarer Zustand: nur ein schwacher Umriss
  ALPHA_FLICKER: [0.4, 1], // Spanne des Flackerns
  FLICKER_CYCLES: [3, 3], // Schwingungen in der Vorwarnung: 3 k + 3 k², k = 0..1 (zuerst etwa 4 Hz, am Ende etwa 13 Hz)
  POOF_COLOR: '#d6ecff',
  VIEW_MARGIN: 80, // Staub nur, wenn die Wolke im oder knapp neben dem Bild liegt
  VIEW_AHEAD: 120,
};

const frac = (v) => v - Math.floor(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v, d) => (Number.isFinite(v) ? v : d);

export function updatePlatforms(s, dt) {
  const list = s.platforms;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.kind === 'moving') moveOne(s, p);
    else if (p.kind === 'breakable') breakOne(s, p, dt);
    else if (p.kind === 'blink') blinkOne(s, p);
    else if (p.kind === 'spring') pressOne(p, dt);
  }
}

function moveOne(s, p) {
  const pos = platformAt(p, s.t);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
  const a = p.omega * s.t + p.phase;
  // Beim ersten Schritt springt die Plattform an ihren Platz, ohne den Spieler mitzureißen
  const fresh = p.live !== true;
  p.dx = fresh ? 0 : pos.x - p.x;
  p.dy = fresh ? 0 : pos.y - p.y;
  p.live = true;
  p.x = pos.x;
  p.y = pos.y;
  p.vx = p.ax * p.omega * Math.cos(a);
  p.vy = p.ay * p.omega * Math.cos(a);
}

function breakOne(s, p, dt) {
  const prev = p.timer;
  switch (p.state) {
    case 'armed':
      p.timer += dt;
      if (p.timer >= BREAK.ARM - EPS) p.state = 'shaking';
      break;
    case 'broken':
      if (p.respawn > 0) {
        p.timer += dt;
        if (p.timer >= p.respawn - EPS) {
          p.state = 'idle';
          p.timer = 0;
        }
      }
      return;
    case 'shaking':
      p.timer += dt;
      break;
    default: // idle: nur das Einblenden nach einer Wiederkehr
      if (p.alpha < 1) p.alpha = Math.min(1, p.alpha + dt / BREAK.FADE_IN);
      return;
  }
  if (p.state !== 'shaking') return;

  const k = Math.min(1, Math.max(0, (p.timer - BREAK.ARM) / BREAK.SHAKE));
  const amp = BREAK.AMP[0] + (BREAK.AMP[1] - BREAK.AMP[0]) * k;
  p.shakeX = Math.sin(p.timer * BREAK.FREQ) * amp;
  p.alpha = 1 - (1 - BREAK.ALPHA_MIN) * k;
  const n = Math.floor(p.timer / BREAK.POOF_EVERY);
  if (n > Math.floor(prev / BREAK.POOF_EVERY)) emit(s, 'poof', p.x + p.w * frac(n * 0.618 + 0.2), p.y + p.h);
  if (p.timer >= BREAK.ARM + BREAK.SHAKE - EPS) {
    p.state = 'broken';
    p.alpha = 0;
    p.shakeX = 0;
    p.timer = 0;
    emit(s, 'break', p.x + p.w / 2, p.y + p.h / 2);
  }
}

// Blinkwolke: solid, warn und alpha stammen allein aus s.t und den Feldern period, on, phase
function blinkOne(s, p) {
  const period = fin(p.period, 0) > 0 ? p.period : BLINK.PERIOD[0];
  const on = clamp(fin(p.on, BLINK.ON), 0, 1);
  const ph = frac(fin(s.t, 0) / period + fin(p.phase, 0));
  const solid = ph < on;
  const warnSpan = BLINK.WARN / period; // Anteil des Takts, der vor dem Verschwinden flackert
  // Eine Wolke, die nie verschwindet (on 1), braucht keine Vorwarnung
  const warn = solid && on < 1 && ph >= on - warnSpan;

  // Staubwölkchen beim Wechsel, nur im Bild und nicht beim allerersten Schritt (Erzeugung mitten im Takt)
  if (p.live === true && solid !== p.solid) {
    const cam = fin(s.camX, 0);
    if (p.x + p.w > cam - BLINK_FX.VIEW_MARGIN && p.x < cam + W + BLINK_FX.VIEW_AHEAD) {
      emit(s, 'poof', p.x + p.w / 2, p.y + p.h / 2, { color: BLINK_FX.POOF_COLOR });
    }
  }
  p.live = true;
  p.solid = solid;
  p.warn = warn;

  if (!solid) {
    p.alpha = BLINK_FX.ALPHA_OFF;
  } else if (warn) {
    // Flackern wird zum Ende hin schneller (k 0 bis 1 über die Vorwarnung)
    const k = clamp((ph - (on - warnSpan)) / warnSpan, 0, 1);
    const [c1, c2] = BLINK_FX.FLICKER_CYCLES;
    const wave = Math.cos(Math.PI * 2 * (c1 * k + c2 * k * k));
    const [lo, hi] = BLINK_FX.ALPHA_FLICKER;
    p.alpha = lo + (hi - lo) * (0.5 + 0.5 * wave);
  } else {
    p.alpha = 1;
  }
}

// Sprungwolke: das Eindrücken (press, gesetzt von player.js) klingt linear ab
function pressOne(p, dt) {
  if (!(p.press > EPS)) {
    if (p.press !== 0) p.press = 0;
    return;
  }
  p.press = Math.max(0, Math.min(1, p.press) - dt / SPRING_PRESS_TIME);
  if (p.press <= EPS) p.press = 0;
}

// Der Spieler ist auf der Plattform gelandet (auch beim Hinübergehen von einer Nachbarplattform)
export function onPlayerLand(s, plat) {
  if (plat && plat.kind === 'breakable' && plat.state === 'idle') {
    plat.state = 'armed';
    plat.timer = 0;
  }
}

// Brüchige Plattformen sind nach dem Bruch nicht fest, Blinkwolken nur in ihrem festen Teil des Takts
export function isSolid(plat) {
  if (!plat) return false;
  if (plat.kind === 'breakable') return plat.state !== 'broken';
  if (plat.kind === 'blink') return !!plat.solid;
  return true;
}

export function platformById(s, id) {
  if (!id) return null;
  const list = s.platforms;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
