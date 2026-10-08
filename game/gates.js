// Traumtore: Bonus, Heilung und Weltwechsel. Das Tor selbst baut der Generator (b.gate).
// Der Weltwechsel steckt in s.world, themeAt() in theme.js überblendet danach die Farben.

import { GATE, MAX_LIVES, SCORE, W, WORLDS } from './constants.js';
import { emit } from './particles.js';
import { addBonus, banner, flash, popup, shake } from './scoring.js';

const BLEND_TIME = 3; // so lange blendet eine Welt in die nächste
const ANIM_BEHIND = 200; // nur Tore im Bild (mit Rand) bekommen ihre Animationszeit
const ANIM_AHEAD = 300;
const BANNER_TIME = 3.4;
const FLASH = { COLOR: '#ffffff', AMOUNT: 0.55 };
const SHAKE = 3;
const BONUS_COLOR = '#ffe27a';
const HEAL_COLOR = '#ff9ab4';

function passGate(s, g) {
  const p = s.player;
  const w = s.world;
  const cx = p.x + p.w / 2;
  g.passed = true;

  // Bonus wächst mit der Nummer des Tors
  const index = g.index > 0 ? g.index : 1;
  const bonus = SCORE.GATE * index;
  addBonus(s, bonus);
  popup(s, cx, p.y - 14, `+${bonus}`, { color: BONUS_COLOR, size: 20, dur: 1.3 });

  // Ein Leben dazu, aber nie über das Maximum
  if (s.lives < MAX_LIVES) {
    s.lives = Math.min(MAX_LIVES, s.lives + GATE.HEAL);
    popup(s, cx, p.y - 40, '+1 Leben', { color: HEAL_COLOR, size: 18, dur: 1.5 });
  }

  // Weltwechsel: die bisherige Welt blendet über world.blend in die neue
  w.from = w.to;
  w.index = (w.index + 1) % WORLDS.length;
  w.to = w.index;
  w.blend = 0;
  w.gatesPassed += 1;
  banner(s, `Traumwelt ${w.gatesPassed + 1}`, WORLDS[w.index].name, BANNER_TIME);

  const gy = g.y - g.h / 2;
  emit(s, 'gate', g.x, gy);
  emit(s, 'confetti', g.x, gy);
  flash(s, FLASH.COLOR, FLASH.AMOUNT);
  shake(s, SHAKE);

  // Wer ab hier stürzt, beginnt wieder am Tor
  s.respawn = { x: g.x - p.w / 2, y: g.y - p.h };
}

export function updateGates(s, dt) {
  if (!(dt > 0)) return;
  const w = s.world;
  if (w.blend < 1) w.blend = Math.min(1, w.blend + dt / BLEND_TIME);

  const p = s.player;
  const cx = p.x + p.w / 2;
  const alive = !p.dead && Number.isFinite(cx);
  const x0 = s.camX - ANIM_BEHIND;
  const x1 = s.camX + W + ANIM_AHEAD;
  for (let i = 0; i < s.gates.length; i++) {
    const g = s.gates[i];
    if (g.x > x0 && g.x < x1) g.anim += dt;
    // Mitte des Spielers hat die Tor Mitte erreicht, die Höhe spielt keine Rolle
    if (!g.passed && alive && cx >= g.x) passGate(s, g);
  }
}
