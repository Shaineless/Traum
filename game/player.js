// STUB: wird von einem Agenten umgesetzt.
import { H } from './constants.js';
export function updatePlayer(s, input, dt) {
  const p = s.player;
  p.vy = Math.min(900, p.vy + 1900 * dt);
  p.y += p.vy * dt;
  p.x += input.move * 300 * dt;
  p.onGround = false;
  for (const pl of s.platforms) {
    if (p.vy >= 0 && p.x + p.w > pl.x && p.x < pl.x + pl.w && p.y + p.h >= pl.y && p.y + p.h - p.vy * dt <= pl.y + 2) {
      p.y = pl.y - p.h; p.vy = 0; p.onGround = true;
    }
  }
  if (input.jumpPressed && p.onGround) p.vy = -680;
  if (p.y > H + 120) { p.y = 200; p.vy = 0; }
}
// src: { kind, label, x, y }. Rückgabe: 'ignored' | 'absorbed' | 'hurt' | 'dead'
export function hurtPlayer(s, src) { return 'ignored'; }
export function respawnPlayer(s) {}
export function bouncePlayer(s, speed) { s.player.vy = -speed; s.player.onGround = false; s.player.jumps = 1; }
