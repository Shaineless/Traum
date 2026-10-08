// Partikel: Effekte erzeugen (emit) und bewegen (updateParticles).
//
// Partikel sind reine Daten in s.particles und wirken nie auf das Spielgeschehen. Damit die
// Simulation unverändert reproduzierbar bleibt, verbraucht emit niemals s.rng: der Zufall
// kommt aus einer Hashfunktion über den eigenen Zähler s.particleSeq (wird bei Bedarf angelegt).
//
// Felder laut Vertrag: x, y, vx, vy, life (Rest), max, size, color, shape, g, drag, rot, vr, alpha.
//   size: Radius, bei 'line' die Länge. g: Schwerkraft in px/s². drag: Dämpfung pro Sekunde.
//   alpha: aktuelle Deckkraft, wird in updateParticles aus der Lebensdauer berechnet.
// Zusätzliche Felder (alle optional beim Zeichnen):
//   a0 Grundalpha, grow Größenänderung in px/s, glow 1 für ein leichtes Leuchten,
//   sky 1 für Partikel, die am Bildschirm hängen statt an der Welt (Sternschnuppe, Windlinie),
//   cam die Kamera x beim Erzeugen (Bildschirm x eines sky Partikels ist x minus cam).

import { LIMITS } from './constants.js';

const MAX_DT = 0.1; // größere Schritte werden gekappt
const AMBIENT_FILL = 0.8; // ab diesem Füllstand erzeugen reine Stimmungseffekte nichts mehr
const THIN_FILL = 0.75; // ab diesem Füllstand entsteht nur noch etwa die Hälfte pro Effekt
const AMBIENT = { rain: true, windline: true, magnet: true };

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Farben der Presets
const WHITE = '#ffffff';
const SOFT = ['#ffffff', '#f1eaff', '#e2d9ff'];
const GOLD = ['#ffd966', '#fff0a8', '#ffe9b0'];
const STORM = ['#b4bbdc', '#8e97bf', '#d9ddf3'];
const PINK = ['#ff8fb4', '#ffc2d6', '#ff6f9c'];
const ELEC = ['#fff3a0', '#ffe14a', '#ffffff'];
const BUBBLE = ['#8fe9ff', '#d4f7ff', '#ffffff'];
const CHUNK = ['#d9ceff', '#c3b5f5', '#ffffff'];
const FEATHER = ['#ffffff', '#e7dcff', '#c9b6ff'];
const RAINBOW = ['#ff7a9c', '#ffb86b', '#ffe27a', '#9dffc8', '#8fe9ff', '#b69cff'];
const CONFETTI = ['#ff9ad5', '#ffd966', '#8fe9ff', '#c9b6ff', '#9dffc8', '#ffb48a'];
const TAIL = ['#fff6c8', '#ffeaa8', '#f3dcff', '#d8caff', '#bdb2ff'];
const TAIL_AT = [10, 21, 31, 40, 48]; // Abstand der Schweifstücke vom Kopf
const TAIL_LEN = [17, 15, 13, 11, 9];

// ---------- Zufall aus dem eigenen Zähler ----------

function hash32(n) {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

// Zahl in [0, 1). Zählt s.particleSeq hoch, fasst s.rng nicht an.
function rnd(s) {
  const prev = Number.isInteger(s.particleSeq) && s.particleSeq >= 0 ? s.particleSeq : 0;
  const seq = (prev + 1) >>> 0;
  s.particleSeq = seq;
  return hash32(Math.imul(seq, 0x9e3779b1) ^ 0x85ebca6b) / 4294967296;
}

const R = (c, a, b) => a + rnd(c.s) * (b - a);
const pick = (c, arr) => arr[Math.floor(rnd(c.s) * arr.length) % arr.length];
// Farbe: mit opts.color überwiegend diese Farbe, ab und zu ein weißes Glitzern
const tone = (c, arr) => (c.color ? (rnd(c.s) < 0.28 ? WHITE : c.color) : pick(c, arr));
const sgn = (c) => (rnd(c.s) < 0.5 ? -1 : 1);

// Deckkraft über das Leben: sanft ein, lange sanft aus. k = Restleben / Gesamtleben (1 bis 0).
function envelope(k) {
  const fadeIn = 0.35 + 0.65 * clamp01((1 - k) / 0.1);
  const o = clamp01(k / 0.55);
  return fadeIn * o * o * (3 - 2 * o);
}

// Legt einen Partikel an. o: { g, drag, a, grow, glow, rot, vr, sky }
function add(c, shape, x, y, vx, vy, life, size, color, o) {
  if (c.thin < 1 && rnd(c.s) >= c.thin) return null;
  const a0 = o && o.a !== undefined ? o.a : 0.9;
  const p = {
    x, y, vx, vy, life, max: life, size, color, shape,
    g: (o && o.g) || 0, drag: (o && o.drag) || 0, rot: (o && o.rot) || 0, vr: (o && o.vr) || 0,
    alpha: a0 * envelope(1), a0, grow: (o && o.grow) || 0, glow: o && o.glow ? 1 : 0,
    sky: o && o.sky ? 1 : 0, cam: c.cam,
  };
  c.out.push(p);
  return p;
}

// ---------- Presets ----------

const PRESETS = {
  // kleine Wolkenstaubwölkchen seitlich der Füße
  land(c, x, y) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      add(c, 'cloud', x + side * R(c, 3, 12), y - R(c, 1, 4), side * R(c, 40, 120), -R(c, 4, 30), R(c, 0.4, 0.65), R(c, 3, 5.5),
        tone(c, SOFT), { g: -14, drag: 3.2, a: 0.6, grow: R(c, 9, 16) });
    }
  },

  jump(c, x, y) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      add(c, 'cloud', x + side * R(c, 2, 9), y - R(c, 0, 3), side * R(c, 25, 80), -R(c, 2, 24), R(c, 0.3, 0.5), R(c, 2.5, 4),
        tone(c, SOFT), { g: -10, drag: 3, a: 0.5, grow: R(c, 6, 11) });
    }
  },

  // Ring plus Federn, die nach unten flattern
  doublejump(c, x, y) {
    add(c, 'ring', x, y, 0, 0, 0.42, 7, c.color || WHITE, { drag: 1, a: 0.85, grow: 95 });
    for (let i = 0; i < 5; i++) {
      const ang = Math.PI / 2 + (i - 2) * 0.6 + R(c, -0.15, 0.15);
      const sp = R(c, 50, 110);
      add(c, 'drop', x + Math.cos(ang) * 6, y + Math.sin(ang) * 3, Math.cos(ang) * sp, Math.sin(ang) * sp * 0.6, R(c, 0.6, 1), R(c, 3.2, 4.6),
        tone(c, FEATHER), { g: 55, drag: 2.2, a: 0.9, rot: ang + Math.PI, vr: R(c, 3, 6) * sgn(c) });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      add(c, 'star', x + Math.cos(ang) * 10, y + Math.sin(ang) * 6, Math.cos(ang) * 30, Math.sin(ang) * 30, R(c, 0.35, 0.6), R(c, 2.4, 3.6),
        tone(c, FEATHER), { drag: 2, a: 0.95, glow: 1, vr: R(c, -3, 3) });
    }
  },

  // goldene Funken und Sternchen
  star(c, x, y) {
    for (let i = 0; i < 4; i++) {
      const ang = ((i + R(c, 0, 1)) / 4) * TAU;
      const sp = R(c, 60, 150);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.45, 0.75), R(c, 3, 5.5), tone(c, GOLD),
        { g: 90, drag: 2.5, a: 0.95, glow: 1, vr: R(c, -4, 4) });
    }
    for (let i = 0; i < 4; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 40, 120);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.35, 0.65), R(c, 1.6, 2.6), tone(c, GOLD), { g: 110, drag: 2.6, a: 0.9 });
    }
  },

  // Wolkenfetzen und Funken, kräftig
  stomp(c, x, y) {
    for (let i = 0; i < 6; i++) {
      const ang = -Math.PI / 2 + R(c, -1.5, 1.5);
      const sp = R(c, 90, 230);
      add(c, 'cloud', x + R(c, -6, 6), y + R(c, -4, 4), Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.5, 0.8), R(c, 5, 8),
        tone(c, STORM), { g: 220, drag: 2.4, a: 0.75, grow: R(c, 8, 14) });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 120, 260);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.35, 0.6), R(c, 3.5, 6), tone(c, ELEC),
        { g: 120, drag: 2.8, a: 0.95, glow: 1, vr: R(c, -6, 6) });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 80, 200);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.3, 0.55), R(c, 2, 3), c.color || '#ffe27a', { g: 160, drag: 2.6, a: 0.95 });
    }
  },

  // Wolkenbröckchen der brüchigen Plattform
  break(c, x, y) {
    for (let i = 0; i < 6; i++) {
      add(c, 'cloud', x + R(c, -14, 14), y + R(c, -3, 3), R(c, -110, 110), -R(c, 40, 150), R(c, 0.6, 0.95), R(c, 3, 5.5),
        tone(c, CHUNK), { g: 760, drag: 0.4, a: 0.85, grow: -2, vr: R(c, -6, 6) });
    }
    for (let i = 0; i < 2; i++) {
      add(c, 'dot', x + R(c, -10, 10), y, R(c, -70, 70), -R(c, 30, 100), R(c, 0.5, 0.8), R(c, 1.4, 2.2), tone(c, CHUNK), { g: 700, drag: 0.4, a: 0.9 });
    }
  },

  // rosa Funken und Wölkchen
  hurt(c, x, y) {
    for (let i = 0; i < 4; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 70, 190);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.4, 0.7), R(c, 3, 5.5), tone(c, PINK),
        { g: 120, drag: 2.6, a: 0.95, glow: 1, vr: R(c, -5, 5) });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 50, 150);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.35, 0.6), R(c, 1.8, 2.8), tone(c, PINK), { g: 140, drag: 2.4, a: 0.9 });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 20, 60);
      add(c, 'cloud', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - 10, R(c, 0.45, 0.7), R(c, 6, 9), c.color || '#ffdce8',
        { g: -12, drag: 2.2, a: 0.5, grow: R(c, 10, 16) });
    }
  },

  // elektrische gelbe Funken
  spark(c, x, y) {
    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI / 2 + R(c, -2.2, 2.2);
      const sp = R(c, 140, 320);
      add(c, 'line', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.2, 0.38), R(c, 6, 13), tone(c, ELEC),
        { g: 120, drag: 5, a: 0.95, glow: i < 3, rot: ang });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 60, 180);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.25, 0.45), R(c, 1.5, 2.5), tone(c, ELEC), { g: 160, drag: 4, a: 0.95, glow: 1 });
    }
  },

  // Glitzern der Schildblase
  shield(c, x, y) {
    add(c, 'ring', x, y, 0, 0, 0.5, 16, c.color || BUBBLE[0], { drag: 1, a: 0.5, grow: 60 });
    for (let i = 0; i < 5; i++) {
      const ang = R(c, 0, TAU);
      const r = R(c, 18, 30);
      add(c, 'star', x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.85, Math.cos(ang) * R(c, 10, 28), Math.sin(ang) * R(c, 10, 28) - 8, R(c, 0.5, 0.9), R(c, 2.2, 4),
        tone(c, BUBBLE), { drag: 1.2, a: 0.9, glow: 1, vr: R(c, -3, 3) });
    }
  },

  // Splitter der Blase
  shieldbreak(c, x, y) {
    add(c, 'ring', x, y, 0, 0, 0.35, 20, c.color || BUBBLE[0], { drag: 1, a: 0.8, grow: 150 });
    for (let i = 0; i < 8; i++) {
      const ang = ((i + R(c, 0, 1)) / 8) * TAU;
      const sp = R(c, 120, 260);
      add(c, 'line', x + Math.cos(ang) * 22, y + Math.sin(ang) * 20, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.45, 0.8), R(c, 8, 14), tone(c, BUBBLE),
        { g: 260, drag: 2.2, a: 0.9, rot: ang, vr: R(c, 4, 9) * sgn(c) });
    }
    for (let i = 0; i < 5; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 60, 190);
      add(c, 'dot', x + Math.cos(ang) * 20, y + Math.sin(ang) * 18, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.4, 0.7), R(c, 2, 3.2), tone(c, BUBBLE),
        { g: 200, drag: 2, a: 0.9, glow: 1 });
    }
  },

  // goldene Ringe und Sterne
  gate(c, x, y) {
    for (let i = 0; i < 3; i++) {
      add(c, 'ring', x, y, 0, 0, 0.7 + i * 0.2, 12 + i * 10, tone(c, GOLD), { drag: 0.8, a: 0.85, grow: 120 + i * 30 });
    }
    for (let i = 0; i < 8; i++) {
      add(c, 'star', x + R(c, -30, 30), y - R(c, 0, 40), R(c, -100, 100), -R(c, 80, 220), R(c, 0.9, 1.5), R(c, 4, 8), tone(c, GOLD),
        { g: 90, drag: 1.3, a: 0.95, glow: 1, vr: R(c, -3, 3) });
    }
    for (let i = 0; i < 3; i++) {
      add(c, 'dot', x + R(c, -40, 40), y - R(c, 0, 60), R(c, -60, 60), -R(c, 30, 130), R(c, 0.7, 1.2), R(c, 2, 3), tone(c, GOLD), { g: 60, drag: 1.2, a: 0.9 });
    }
  },

  // kleine goldene Punkte, sparsam
  magnet(c, x, y) {
    for (let i = 0; i < 2; i++) {
      add(c, 'dot', x + R(c, -6, 6), y + R(c, -6, 6), R(c, -14, 14), -R(c, 6, 26), R(c, 0.35, 0.6), R(c, 1.6, 2.6), tone(c, GOLD), { g: -10, drag: 1, a: 0.9, glow: 1 });
    }
  },

  // bunte Sterne und Punkte, weich
  confetti(c, x, y) {
    for (let i = 0; i < 14; i++) {
      const ang = -Math.PI / 2 + R(c, -1.1, 1.1);
      const sp = R(c, 160, 380);
      const star = i < 6;
      add(c, star ? 'star' : 'dot', x + R(c, -8, 8), y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 1.1, 1.9), star ? R(c, 3.5, 6) : R(c, 2, 3.5),
        c.color || pick(c, CONFETTI), { g: 300, drag: 1.1, a: 0.85, vr: R(c, -8, 8) });
    }
  },

  // weißer Rauch beim Verschwinden
  poof(c, x, y) {
    for (let i = 0; i < 8; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 20, 80);
      add(c, 'cloud', x + R(c, -5, 5), y + R(c, -5, 5), Math.cos(ang) * sp, Math.sin(ang) * sp * 0.8 - 10, R(c, 0.5, 0.9), R(c, 7, 11),
        c.color || pick(c, ['#ffffff', '#eeeaff', '#d3d6f0']), { g: -18, drag: 2.2, a: 0.7, grow: R(c, 18, 30) });
    }
  },

  // Regenbogenfunken (wird in jedem Dash Schritt aufgerufen, darum nur zwei)
  dash(c, x, y) {
    for (let i = 0; i < 2; i++) {
      const star = rnd(c.s) < 0.4;
      add(c, star ? 'star' : 'dot', x + R(c, -8, 8), y + R(c, -10, 10), R(c, -35, 35), R(c, -25, 25), R(c, 0.3, 0.55), star ? R(c, 2.5, 4) : R(c, 2, 3.4),
        c.color || pick(c, RAINBOW), { drag: 3, a: 0.9, glow: 1, vr: R(c, -4, 4) });
    }
  },

  // einzelner Tropfen, fällt schräg wie der Regen der Welt
  rain(c, x, y) {
    const vy = R(c, 300, 380);
    add(c, 'drop', x, y, vy * 0.22, vy, R(c, 0.8, 1.1), R(c, 2.2, 3.2), c.color || '#cfe4ff', { a: 0.55, rot: -0.217 });
  },

  // dünne Linien, die waagerecht durchs Bild ziehen (am Bildschirm fest)
  windline(c, x, y) {
    for (let i = 0; i < 2; i++) {
      add(c, 'line', x + R(c, -20, 20), y + (i ? R(c, 6, 14) : 0), c.dir * R(c, 420, 560), R(c, -6, 6), R(c, 0.6, 0.95), i ? R(c, 20, 36) : R(c, 36, 70),
        c.color || WHITE, { a: i ? 0.22 : 0.32, sky: 1 });
    }
  },

  // Streifen mit Schweif, fällt schräg von rechts oben nach links unten (am Bildschirm fest)
  meteor(c, x, y) {
    const vx = -R(c, 190, 270);
    const vy = R(c, 150, 210);
    const len = Math.hypot(vx, vy);
    const ux = vx / len;
    const uy = vy / len;
    const rot = Math.atan2(vy, vx);
    const life = R(c, 0.9, 1.2);
    add(c, 'star', x, y, vx, vy, life, R(c, 4.5, 6), c.color || '#fff8d8', { a: 1, glow: 1, vr: 2, sky: 1 });
    // Schweifstücke liegen hintereinander, überlappen sich und werden kürzer
    for (let i = 1; i <= 5; i++) {
      add(c, 'line', x - ux * TAIL_AT[i - 1], y - uy * TAIL_AT[i - 1], vx, vy, life * (1 - i * 0.1), TAIL_LEN[i - 1], c.color || TAIL[i - 1],
        { a: 0.9 - i * 0.1, rot, sky: 1, glow: i < 3 });
    }
    add(c, 'dot', x - ux * 30 + R(c, -3, 3), y - uy * 30 + R(c, -3, 3), vx * 0.9, vy * 0.9, life * 0.6, 1.6, c.color || WHITE, { a: 0.8, sky: 1 });
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

// ---------- API ----------

// Erzeugt die Partikel eines Presets. opts: { color, dir }. Gibt die Anzahl neuer Partikel zurück.
// Das Limit LIMITS.MAX_PARTICLES gilt hart: Reicht der Platz nicht, fliegen die ältesten raus.
export function emit(s, preset, x, y, opts) {
  if (!s || !Object.hasOwn(PRESETS, preset) || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (!Array.isArray(s.particles)) s.particles = [];
  const list = s.particles;
  const max = LIMITS.MAX_PARTICLES;
  const fill = list.length / max;
  if (fill >= AMBIENT_FILL && AMBIENT[preset]) return 0;
  const o = opts || {};
  const c = {
    s,
    out: [],
    color: typeof o.color === 'string' && o.color ? o.color : null,
    dir: o.dir < 0 ? -1 : 1,
    cam: Number.isFinite(s.camX) ? s.camX : 0,
    thin: fill >= THIN_FILL ? 0.5 : 1,
  };
  PRESETS[preset](c, x, y);
  const out = c.out;
  if (out.length > max) out.length = max;
  const over = list.length + out.length - max;
  if (over > 0) list.splice(0, Math.min(over, list.length));
  for (let i = 0; i < out.length; i++) list.push(out[i]);
  return out.length;
}

const finite = (v) => Number.isFinite(v);

// Bewegt alle Partikel und entfernt abgelaufene (und kaputte) ohne neue Liste anzulegen.
export function updateParticles(s, dt) {
  const list = s && s.particles;
  if (!Array.isArray(list) || list.length === 0 || !(dt > 0)) return;
  if (dt > MAX_DT) dt = MAX_DT;
  let keep = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p !== 'object') continue;
    if (!(p.max > 0)) p.max = p.life;
    if (!finite(p.a0)) p.a0 = finite(p.alpha) ? p.alpha : 1;
    p.life -= dt;
    if (!(p.life > 0)) continue;
    const damp = p.drag > 0 ? Math.exp(-p.drag * dt) : 1;
    p.vx *= damp;
    p.vy = (p.vy + (p.g || 0) * dt) * damp;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.vr) p.rot = (p.rot || 0) + p.vr * dt;
    if (p.grow) p.size = Math.max(0, p.size + p.grow * dt);
    p.alpha = p.a0 * envelope(p.life / p.max);
    if (!(finite(p.x) && finite(p.y) && finite(p.vx) && finite(p.vy) && finite(p.size) && finite(p.alpha))) continue;
    list[keep++] = p;
  }
  list.length = keep;
}
