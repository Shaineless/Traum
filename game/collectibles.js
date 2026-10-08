// Sterne, fallende Sterne, Sternmagnet und Powerups.
// Hier und nur hier laufen power.dashT und power.magnetT herunter. Den Schild verbraucht player.js.
// Es gibt keinen Zufall in diesem Modul. Die Listen werden an Ort und Stelle verdichtet,
// damit pro Schritt nichts allokiert wird.

import { H, POWERUPS } from './constants.js';
import { emit } from './particles.js';
import { collectStar, popup } from './scoring.js';

const COLLECT_X = 26; // Stern: Abstand zum Spielerzentrum
const COLLECT_Y = 30;
const POWERUP_RADIUS = 30; // Powerup: Abstand zum Spielerzentrum
const MAGNET_SPEED = 420; // px pro Sekunde, mit der Sterne zum Spieler fliegen
const FALL_GONE = H + 40; // darunter ist ein fallender Stern verschwunden
const MAGNET_FX_RATE = 5; // Magnet Funken pro Sekunde (sparsam)
const MAGNET_FX_STARS = 2; // höchstens so viele gezogene Sterne funkeln pro Funken Takt

const KINDS = ['shield', 'dash', 'magnet', 'feather'];
const BURST = { shield: 'shield', dash: 'dash', magnet: 'magnet', feather: 'doublejump' };

// Zählt einen Timer herunter, kaputte Werte werden zu 0
const tick = (v, dt) => (v > 0 ? Math.max(0, v - dt) : 0);

// Gibt dem Spieler die Wirkung eines Powerups. x, y: Ort der Partikel.
function applyPowerup(s, type, x, y) {
  if (!KINDS.includes(type)) return false;
  const p = s.player;
  const def = POWERUPS[type];
  if (type === 'shield') p.power.shield = true;
  else if (type === 'dash') p.power.dashT = def.duration;
  else if (type === 'magnet') p.power.magnetT = def.duration;
  else p.power.feather = Math.min(def.maxCharges, (p.power.feather > 0 ? p.power.feather : 0) + 1);
  popup(s, p.x + p.w / 2, p.y - 10, def.label, { color: def.color, size: 17, dur: 1.2 });
  emit(s, BURST[type], x, y, { color: def.color });
  emit(s, 'star', x, y, { color: def.color });
  return true;
}

export function givePowerup(s, type) {
  const p = s.player;
  return applyPowerup(s, type, p.x + p.w / 2, p.y + p.h / 2);
}

export function updateCollectibles(s, dt) {
  if (!(dt > 0)) return;
  const p = s.player;
  const pw = p.power;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const alive = !p.dead && Number.isFinite(cx) && Number.isFinite(cy);

  // Magnet wirkt in jedem Schritt, in dem er zu Beginn noch Zeit hatte
  const magnetOn = alive && pw.magnetT > 0;
  const magnetBefore = pw.magnetT;
  pw.dashT = tick(pw.dashT, dt);
  pw.magnetT = tick(pw.magnetT, dt);
  const fx = magnetOn && Math.floor(magnetBefore * MAGNET_FX_RATE) !== Math.floor(pw.magnetT * MAGNET_FX_RATE);
  const radius = POWERUPS.magnet.radius;
  const r2 = radius * radius;
  let sparks = 0;

  // ---------- Sterne ----------
  const stars = s.stars;
  let keep = 0;
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    if (st.got) continue;

    // Magnet: Sterne im Radius fliegen zum Spieler und fallen währenddessen nicht
    let pulled = false;
    if (magnetOn) {
      const dx = cx - st.x;
      const dy = cy - st.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        pulled = true;
        const d = Math.sqrt(d2);
        const step = MAGNET_SPEED * dt;
        if (d <= step) {
          st.x = cx;
          st.y = cy;
        } else {
          st.x += (dx / d) * step;
          st.y += (dy / d) * step;
        }
        if (fx && sparks < MAGNET_FX_STARS) {
          sparks++;
          emit(s, 'magnet', st.x, st.y);
        }
      }
    }

    // Fallende Sterne: starten erst, wenn der Spieler nah genug ist, dann fallen sie linear
    if (st.falling) {
      if (!st.started && Math.abs(st.x - cx) < st.triggerDist) {
        st.started = true;
        st.vy = st.fallSpeed;
      }
      if (st.started && !pulled) {
        if (!(st.vy > 0)) st.vy = st.fallSpeed;
        st.y += st.vy * dt;
        if (st.y > FALL_GONE) continue;
      }
    }

    if (alive && Math.abs(st.x - cx) < COLLECT_X && Math.abs(st.y - cy) < COLLECT_Y) {
      collectStar(s, st);
      continue;
    }
    stars[keep++] = st;
  }
  stars.length = keep;
  if (fx) emit(s, 'magnet', cx, cy);

  // ---------- Powerups ----------
  const ups = s.powerups;
  keep = 0;
  for (let i = 0; i < ups.length; i++) {
    const pu = ups[i];
    if (pu.got) continue;
    if (alive && Math.hypot(pu.x - cx, pu.y - cy) < POWERUP_RADIUS) {
      pu.got = true;
      applyPowerup(s, pu.type, pu.x, pu.y);
      continue;
    }
    ups[keep++] = pu;
  }
  ups.length = keep;
}
