// Punkte, Combo, Popups, Banner und Effekt-Trigger. Wird von allen Gameplay-Modulen benutzt.

import { ABILITY, COMBO, LIMITS, METER, START_X } from './constants.js';
import { emit } from './particles.js';

export const meters = (s) => Math.max(0, Math.floor((s.run.maxX - START_X) / METER));
export const totalScore = (s) => meters(s) + s.run.bonus;

export function popup(s, x, y, text, { color = '#ffffff', size = 18, dur = 0.9, vy = -46, screen = false } = {}) {
  if (s.popups.length >= LIMITS.MAX_POPUPS) s.popups.shift();
  s.popups.push({ x, y, vy, t: 0, dur, text, color, size, screen });
}

export function banner(s, text, sub = '', dur = 2.6) {
  s.banner = { text, sub, t: 0, dur };
}

// Tonereignis vormerken (nimbus-game.js spielt sie ab, Tests ignorieren sie).
// Namen: jump doublejump land star powerup stomp hurt shieldbreak dash throw slam glide spring comet hail
//        glow strike gate combo event break die charge ice blink
export function sfx(s, name, vol = 1) {
  if (!s.sfx) s.sfx = [];
  if (s.sfx.length >= LIMITS.MAX_SFX) s.sfx.shift();
  s.sfx.push({ n: name, v: vol });
}

export const shake = (s, amp) => { s.fx.shake = Math.max(s.fx.shake, amp); };
export const hitstop = (s, sec) => { s.fx.hitstop = Math.max(s.fx.hitstop, sec); };
export const flash = (s, color, amt = 0.5) => { s.fx.flash = Math.max(s.fx.flash, amt); s.fx.flashColor = color; };

export function addBonus(s, n) {
  s.run.bonus += s.player && s.player.power && s.player.power.double > 0 ? n * 2 : n; // Doppelpunkte Powerup
}

// Wurfstern aufladen: zehn Sterne ergeben einen, höchstens drei
export function chargeAmmo(s, stars = 1) {
  const p = s.player;
  p.starAcc += stars;
  while (p.starAcc >= ABILITY.AMMO.STARS_PER) {
    p.starAcc -= ABILITY.AMMO.STARS_PER;
    if (p.ammo < ABILITY.AMMO.MAX) {
      p.ammo += 1;
      sfx(s, 'charge');
      popup(s, p.x + p.w / 2, p.y - 20, 'Wurfstern bereit', { color: '#ffd966', size: 14, dur: 1.1 });
    }
  }
  if (p.ammo >= ABILITY.AMMO.MAX) p.starAcc = 0;
}

// Gegner besiegt. how: 'stomp' | 'dash'. Gibt die vergebenen Punkte zurück.
export function registerKill(s, enemy, how = 'stomp') {
  s.combo.count += 1;
  s.combo.timer = COMBO.WINDOW;
  const mult = Math.min(s.combo.count, COMBO.MAX_MULT);
  const pts = COMBO.BASE * mult;
  s.run.kills += 1;
  s.run.bestCombo = Math.max(s.run.bestCombo, s.combo.count);
  addBonus(s, pts);
  if (s.combo.count >= 3 && s.player.ammo < ABILITY.AMMO.MAX) { s.player.ammo += 1; sfx(s, 'charge'); } // Belohnung für Combos
  sfx(s, s.combo.count >= 2 ? 'combo' : 'stomp', Math.min(1, 0.7 + s.combo.count * 0.1));
  const cx = enemy.x + enemy.w / 2;
  const cy = enemy.y + enemy.h / 2;
  popup(s, cx, cy - 10, `+${pts}`, { color: '#ffe27a', size: 20 });
  if (s.combo.count >= 2) popup(s, cx, cy - 34, `x${mult} Combo`, { color: '#ff9ad5', size: 16, dur: 1.1 });
  emit(s, 'stomp', cx, cy);
  hitstop(s, 0.05);
  shake(s, how === 'dash' ? 5 : 3);
  return pts;
}

export function collectStar(s, star) {
  star.got = true;
  s.run.stars += 1;
  addBonus(s, star.value);
  chargeAmmo(s, 1);
  sfx(s, 'star', 0.6);
  emit(s, 'star', star.x, star.y);
  if (star.bonus === 'risk') popup(s, star.x, star.y - 14, `+${star.value}`, { color: '#ffd966', size: 17 });
  return star.value;
}

export function resetCombo(s) {
  s.combo.count = 0;
  s.combo.timer = 0;
}

export function updateCombo(s, dt) {
  if (s.combo.count > 0) {
    s.combo.timer -= dt;
    if (s.combo.timer <= 0) resetCombo(s);
  }
}

export function updatePopups(s, dt) {
  for (const p of s.popups) {
    p.t += dt;
    p.y += p.vy * dt;
  }
  s.popups = s.popups.filter((p) => p.t < p.dur);
  if (s.banner) {
    s.banner.t += dt;
    if (s.banner.t >= s.banner.dur) s.banner = null;
  }
}
