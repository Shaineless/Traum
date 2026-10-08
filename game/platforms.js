// Bewegliche und brüchige Plattformen. Die Bewegung ist analytisch (platformAt aus reach.js),
// dadurch driftet nichts und der Generator rechnet mit denselben Positionen.

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

const frac = (v) => v - Math.floor(v);

export function updatePlatforms(s, dt) {
  const list = s.platforms;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.kind === 'moving') moveOne(s, p);
    else if (p.kind === 'breakable') breakOne(s, p, dt);
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

// Der Spieler ist auf der Plattform gelandet (auch beim Hinübergehen von einer Nachbarplattform)
export function onPlayerLand(s, plat) {
  if (plat && plat.kind === 'breakable' && plat.state === 'idle') {
    plat.state = 'armed';
    plat.timer = 0;
  }
}

export const isSolid = (plat) => !!plat && (plat.kind !== 'breakable' || plat.state !== 'broken');

export function platformById(s, id) {
  if (!id) return null;
  const list = s.platforms;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
