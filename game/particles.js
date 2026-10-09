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
//   cam die Kamera x beim Erzeugen (Bildschirm x eines sky Partikels ist x minus cam),
//   sq Höhenverhältnis eines Rings (kleiner als 1: flache Ellipse, so liegt eine Schockwelle am Boden).
//
// Optionen von emit: color (Grundfarbe), dir (Richtung, 1 oder minus 1), strength (0 bis 1, Stärke).
// Dauereffekte (Stimmung) erzeugen bei vollem Speicher nichts mehr (AMBIENT), Wirkungseffekte immer.
//
// Presets der zweiten Runde (x, y ist der Ort des Ereignisses, bei Bodeneffekten die Unterkante):
//   slam (Schockwelle am Boden), spring (Sprungwolke), glide (Puffer hinter Nimbus, dir = Flugrichtung),
//   throw (Abschuss, dir = Wurfrichtung), shotTrail (Schweif, dir = Flugrichtung), comet (Einschlag am Boden),
//   hail (Hagelkorn zerplatzt), ice (Glitzer), blink (dir 1 Auftauchen, dir minus 1 Verschwinden),
//   starcharge (Wurfstern bereit, an Nimbus), combo (Schweif, strength ab 0,66 dichter), crit (großer Treffer,
//   ab strength 0,5 drei Ringe), land mit strength 0 bis 1 (harte Landung) und ein kräftigeres stomp.

import { LIMITS } from './constants.js';

const MAX_DT = 0.1; // größere Schritte werden gekappt
const AMBIENT_FILL = 0.8; // ab diesem Füllstand erzeugen reine Stimmungseffekte nichts mehr
const THIN_FILL = 0.75; // ab diesem Füllstand entsteht nur noch etwa die Hälfte pro Effekt
const AMBIENT = { rain: true, windline: true, magnet: true, glide: true, shotTrail: true, ice: true, combo: true };

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
const SPRINGC = ['#ffffff', '#b8ffe0', '#9dffc8', '#fff0a8'];
const EMBER = ['#ffb347', '#ff8a4a', '#ffd966', '#ff6b5e'];
const SMOKE = ['#9a8796', '#b3a1ae', '#7f6f86'];
const ICEC = ['#ffffff', '#e4f6ff', '#bfe6ff', '#9dd5ff'];
const SPARKLE = ['#fff6c8', '#ffd966', '#ffffff'];
const DUSTC = ['#ffffff', '#e0d4ff', '#c9b6ff'];
const COMBOC = ['#ffd966', '#ff9ad5', '#fff0a8', '#ffffff', '#ffb86b'];
const CRITC = ['#ffd966', '#fff0a8', '#ff9ad5', '#ffffff'];

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

// Legt einen Partikel an. o: { g, drag, a, grow, glow, rot, vr, sky, sq, keep }
// keep: wird auch bei vollem Speicher nie ausgedünnt (die Hauptringe der großen Effekte)
function add(c, shape, x, y, vx, vy, life, size, color, o) {
  if (c.thin < 1 && !(o && o.keep) && rnd(c.s) >= c.thin) return null;
  const a0 = o && o.a !== undefined ? o.a : 0.9;
  const p = {
    x, y, vx, vy, life, max: life, size, color, shape,
    g: (o && o.g) || 0, drag: (o && o.drag) || 0, rot: (o && o.rot) || 0, vr: (o && o.vr) || 0,
    alpha: a0 * envelope(1), a0, grow: (o && o.grow) || 0, glow: o && o.glow ? 1 : 0,
    sky: o && o.sky ? 1 : 0, cam: c.cam,
  };
  if (o && o.sq > 0 && o.sq < 1) p.sq = o.sq;
  c.out.push(p);
  return p;
}

// ---------- Presets ----------

const PRESETS = {
  // kleine Wolkenstaubwölkchen seitlich der Füße. strength 0 bis 1: harte Landungen werfen mehr Staub und einen flachen Ring
  land(c, x, y) {
    const k = c.strength === undefined ? 0 : c.strength;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      add(c, 'cloud', x + side * R(c, 3, 12), y - R(c, 1, 4), side * R(c, 40, 120), -R(c, 4, 30), R(c, 0.4, 0.65), R(c, 3, 5.5),
        tone(c, SOFT), { g: -14, drag: 3.2, a: 0.6, grow: R(c, 9, 16) });
    }
    if (k > 0) {
      const extra = 2 + Math.round(4 * k);
      for (let i = 0; i < extra; i++) {
        const side = i % 2 ? 1 : -1;
        add(c, 'cloud', x + side * R(c, 4, 14), y - R(c, 1, 5), side * R(c, 90, 170 + 110 * k), -R(c, 6, 40), R(c, 0.45, 0.75), R(c, 4, 6 + 3 * k),
          tone(c, SOFT), { g: -12, drag: 3, a: 0.65, grow: R(c, 12, 20) });
      }
      add(c, 'ring', x, y - 1, 0, 0, 0.3 + 0.12 * k, 6, c.color || WHITE, { drag: 1, a: 0.5 + 0.3 * k, grow: 90 + 110 * k, sq: 0.28, keep: 1 });
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

  // Wolkenfetzen, Stoßring und Funken, kräftig
  stomp(c, x, y) {
    add(c, 'ring', x, y + 4, 0, 0, 0.3, 5, c.color || WHITE, { drag: 1, a: 0.75, grow: 250, sq: 0.55, keep: 1 });
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + R(c, -1.6, 1.6);
      const sp = R(c, 100, 260);
      add(c, 'cloud', x + R(c, -6, 6), y + R(c, -4, 4), Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.5, 0.85), R(c, 5, 9),
        tone(c, STORM), { g: 220, drag: 2.4, a: 0.78, grow: R(c, 8, 15) });
    }
    for (let i = 0; i < 4; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 130, 290);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.35, 0.65), R(c, 3.5, 6.5), tone(c, ELEC),
        { g: 120, drag: 2.8, a: 0.95, glow: 1, vr: R(c, -6, 6) });
    }
    for (let i = 0; i < 4; i++) {
      const ang = ((i + R(c, 0, 1)) / 4) * TAU;
      const sp = R(c, 200, 340);
      add(c, 'line', x + Math.cos(ang) * 8, y + Math.sin(ang) * 6, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.16, 0.28), R(c, 8, 14), tone(c, ELEC),
        { drag: 5, a: 0.9, rot: ang });
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

  // ---------- Fähigkeiten und Wetter ----------

  // Stampfen: Schockwelle als flache Ringe am Boden, Staub in zwei Richtungen, Funken nach oben
  slam(c, x, y) {
    add(c, 'ring', x, y - 2, 0, 0, 0.42, 10, c.color || WHITE, { drag: 1, a: 0.95, grow: 270, sq: 0.26, keep: 1 });
    add(c, 'ring', x, y - 2, 0, 0, 0.56, 6, c.color || SOFT[2], { drag: 1, a: 0.55, grow: 215, sq: 0.2, keep: 1 });
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      add(c, 'cloud', x + side * R(c, 4, 16), y - R(c, 2, 6), side * R(c, 150, 340), -R(c, 10, 60), R(c, 0.5, 0.85), R(c, 8, 13),
        tone(c, SOFT), { g: -8, drag: 3, a: 0.7, grow: R(c, 26, 40) });
    }
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + R(c, -1.1, 1.1);
      const sp = R(c, 170, 370);
      add(c, 'line', x + R(c, -10, 10), y - 4, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.2, 0.36), R(c, 9, 16), tone(c, ELEC),
        { g: 420, drag: 3.4, a: 0.95, glow: i < 2, rot: ang });
    }
    for (let i = 0; i < 2; i++) {
      const ang = -Math.PI / 2 + R(c, -0.8, 0.8);
      const sp = R(c, 120, 260);
      add(c, 'star', x, y - 6, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.4, 0.65), R(c, 4, 6.5), tone(c, GOLD),
        { g: 240, drag: 2.4, a: 0.95, glow: 1, vr: R(c, -6, 6) });
    }
    for (let i = 0; i < 3; i++) {
      add(c, 'dot', x + R(c, -14, 14), y - 3, R(c, -150, 150), -R(c, 80, 220), R(c, 0.4, 0.7), R(c, 2, 3.2), tone(c, CHUNK), { g: 760, drag: 0.5, a: 0.9 });
    }
  },

  // Sprungwolke: federnde flache Ringe und Funken, die nach oben schießen
  spring(c, x, y) {
    for (let i = 0; i < 3; i++) {
      add(c, 'ring', x, y - 2 - i * 3, 0, -i * R(c, 18, 34), 0.34 + i * 0.1, 8 + i * 3, tone(c, SPRINGC),
        { drag: 1, a: 0.85 - i * 0.15, grow: 130 + i * 40, sq: 0.38 + i * 0.12, keep: i === 0 });
    }
    for (let i = 0; i < 4; i++) {
      add(c, 'star', x + R(c, -12, 12), y - 6, R(c, -60, 60), -R(c, 260, 480), R(c, 0.35, 0.6), R(c, 3, 5.5), tone(c, SPRINGC),
        { g: 420, drag: 1.4, a: 0.95, glow: 1, vr: R(c, -7, 7) });
    }
    for (let i = 0; i < 2; i++) {
      const vx = R(c, -40, 40);
      add(c, 'line', x + R(c, -8, 8), y - 8, vx, -R(c, 380, 520), R(c, 0.16, 0.26), R(c, 10, 16), tone(c, SPRINGC), { g: 300, drag: 2, a: 0.85, rot: -Math.PI / 2 });
    }
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      add(c, 'cloud', x + side * R(c, 4, 12), y - 3, side * R(c, 50, 110), -R(c, 4, 22), R(c, 0.35, 0.55), R(c, 3.5, 5.5), tone(c, SOFT),
        { g: -10, drag: 3, a: 0.6, grow: R(c, 10, 16) });
    }
  },

  // Gleiten: weiche kleine Wolkenpuffer hinter Nimbus, sparsam (zwei pro Aufruf)
  glide(c, x, y) {
    const d = c.dir0;
    for (let i = 0; i < 2; i++) {
      add(c, 'cloud', x + R(c, -12, 12), y - R(c, 2, 9), -d * R(c, 20, 60) + R(c, -14, 14), R(c, -16, 8), R(c, 0.55, 0.85), R(c, 4, 6.5),
        tone(c, SOFT), { g: -8, drag: 2.5, a: 0.5, grow: R(c, 10, 17) });
    }
  },

  // Sternenwurf: Sternchen im Fächer in Wurfrichtung (dir), kleiner Rückstoß dahinter
  throw(c, x, y) {
    const d = c.dir;
    const base = d > 0 ? 0 : Math.PI;
    for (let i = 0; i < 5; i++) {
      const ang = base + R(c, -0.55, 0.55);
      const sp = R(c, 140, 340);
      add(c, 'star', x, y + R(c, -3, 3), Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.3, 0.55), R(c, 3, 5.5), tone(c, GOLD),
        { drag: 3.2, a: 0.95, glow: i < 2, vr: R(c, -8, 8) });
    }
    for (let i = 0; i < 2; i++) {
      const ang = base + R(c, -0.2, 0.2);
      const sp = R(c, 380, 520);
      add(c, 'line', x, y + R(c, -4, 4), Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.12, 0.2), R(c, 9, 15), tone(c, ELEC), { drag: 6, a: 0.9, rot: ang });
    }
    add(c, 'cloud', x - d * R(c, 2, 8), y + R(c, -4, 4), -d * R(c, 30, 70), R(c, -12, 6), R(c, 0.35, 0.5), R(c, 4, 6), tone(c, SOFT), { drag: 3, a: 0.6, grow: 12 });
    for (let i = 0; i < 2; i++) {
      const ang = base + R(c, -1, 1);
      const sp = R(c, 60, 160);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.25, 0.45), R(c, 1.6, 2.6), tone(c, GOLD), { g: 120, drag: 2.6, a: 0.9 });
    }
  },

  // Schweif eines Wurfsterns (dir: Flugrichtung), wird alle paar Hundertstel aufgerufen, darum nur zwei
  shotTrail(c, x, y) {
    const d = c.dir0;
    add(c, 'dot', x - d * R(c, 2, 6), y + R(c, -3, 3), -d * R(c, 10, 40) + R(c, -8, 8), R(c, -14, 14), R(c, 0.22, 0.36), R(c, 2.2, 3.4), tone(c, SPARKLE),
      { drag: 3, a: 0.85, glow: 1, grow: -4 });
    add(c, 'star', x + R(c, -3, 3), y + R(c, -4, 4), -d * R(c, 0, 30), R(c, -24, -4), R(c, 0.3, 0.5), R(c, 2, 3.6), tone(c, SPARKLE),
      { g: 20, drag: 2.5, a: 0.9, vr: R(c, -6, 6) });
  },

  // Kometeneinschlag: flache Glutringe, Glut und Funken, dunkler Rauch
  comet(c, x, y) {
    add(c, 'ring', x, y - 2, 0, 0, 0.45, 8, c.color || EMBER[0], { drag: 1, a: 0.9, grow: 300, sq: 0.3, keep: 1 });
    add(c, 'ring', x, y - 2, 0, 0, 0.3, 5, WHITE, { drag: 1, a: 0.8, grow: 210, sq: 0.4, keep: 1 });
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + R(c, -1.35, 1.35);
      const sp = R(c, 120, 400);
      add(c, 'dot', x + R(c, -8, 8), y - 4, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.6, 1.1), R(c, 2.2, 4.2), tone(c, EMBER),
        { g: 520, drag: 0.9, a: 0.95, glow: i < 4 });
    }
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + R(c, -1.2, 1.2);
      const sp = R(c, 150, 330);
      add(c, 'star', x, y - 6, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.45, 0.8), R(c, 3.5, 6), tone(c, EMBER),
        { g: 200, drag: 2, a: 0.95, glow: 1, vr: R(c, -6, 6) });
    }
    for (let i = 0; i < 4; i++) {
      add(c, 'cloud', x + R(c, -16, 16), y - R(c, 4, 10), R(c, -40, 40), -R(c, 20, 70), R(c, 0.8, 1.3), R(c, 8, 12), tone(c, SMOKE),
        { g: -20, drag: 1.5, a: 0.55, grow: R(c, 14, 24) });
    }
  },

  // Hagelkorn zerplatzt: Eissplitter, Glitzer und ein Schneepuff
  hail(c, x, y) {
    add(c, 'ring', x, y, 0, 0, 0.22, 4, c.color || ICEC[2], { drag: 1, a: 0.7, grow: 150 });
    for (let i = 0; i < 6; i++) {
      const ang = ((i + R(c, 0, 1)) / 6) * TAU;
      const sp = R(c, 110, 260);
      add(c, 'line', x + Math.cos(ang) * 4, y + Math.sin(ang) * 4, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.4, 0.7), R(c, 7, 13), tone(c, ICEC),
        { g: 340, drag: 1.6, a: 0.95, rot: ang, vr: R(c, 5, 10) * sgn(c) });
    }
    for (let i = 0; i < 3; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 50, 170);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.3, 0.55), R(c, 1.6, 2.6), tone(c, ICEC), { g: 260, drag: 2, a: 0.95, glow: 1 });
    }
    add(c, 'cloud', x, y, R(c, -20, 20), -R(c, 4, 22), 0.45, R(c, 6, 9), '#f0f9ff', { g: -10, drag: 2.4, a: 0.55, grow: 18 });
  },

  // Eiskristall Glitzer, sparsam und leise
  ice(c, x, y) {
    for (let i = 0; i < 3; i++) {
      add(c, 'star', x + R(c, -10, 10), y + R(c, -8, 4), R(c, -14, 14), -R(c, 6, 30), R(c, 0.5, 0.9), R(c, 2.2, 4), tone(c, ICEC),
        { g: 18, drag: 1.4, a: 0.95, glow: 1, vr: R(c, -4, 4) });
    }
    add(c, 'dot', x + R(c, -12, 12), y + R(c, -6, 4), R(c, -10, 10), -R(c, 4, 18), R(c, 0.4, 0.7), R(c, 1.4, 2.2), tone(c, ICEC), { g: 14, drag: 1.2, a: 0.9 });
  },

  // Blinkwolke: Staub beim Auftauchen (dir 1, dehnt sich aus) oder Verschwinden (dir minus 1, zieht sich zusammen)
  blink(c, x, y) {
    const vanish = c.dir0 < 0;
    add(c, 'ring', x, y, 0, 0, 0.4, vanish ? 44 : 6, c.color || DUSTC[1], { drag: 1, a: 0.5, grow: vanish ? -90 : 200, sq: 0.3, keep: 1 });
    for (let i = 0; i < 6; i++) {
      const off = R(c, -16, 16);
      const out = Math.sign(off) || 1;
      const sx = vanish ? out * R(c, 16, 30) : off;
      const vx = vanish ? -out * R(c, 40, 80) : R(c, -60, 60);
      add(c, 'cloud', x + sx, y + R(c, -3, 3), vx, -R(c, 6, 30), R(c, 0.45, 0.75), R(c, 5, 8), tone(c, DUSTC),
        { g: -12, drag: 2.6, a: 0.6, grow: R(c, 14, 24) });
    }
    for (let i = 0; i < 3; i++) {
      add(c, 'star', x + R(c, -18, 18), y - R(c, 0, 8), R(c, -20, 20), -R(c, 14, 50), R(c, 0.4, 0.7), R(c, 2.2, 3.6), tone(c, DUSTC),
        { drag: 1.6, a: 0.9, glow: 1, vr: R(c, -4, 4) });
    }
  },

  // Ein Wurfstern ist bereit: Ringe ziehen sich zusammen, goldenes Aufleuchten und Sternchen
  starcharge(c, x, y) {
    add(c, 'ring', x, y, 0, 0, 0.36, 36, c.color || GOLD[0], { drag: 1, a: 0.75, grow: -96, keep: 1 });
    add(c, 'ring', x, y, 0, 0, 0.3, 26, c.color || GOLD[1], { drag: 1, a: 0.6, grow: -70, keep: 1 });
    add(c, 'star', x, y, 0, 0, 0.45, 6.5, c.color || SPARKLE[0], { a: 1, glow: 1, vr: 3 });
    for (let i = 0; i < 5; i++) {
      const ang = ((i + R(c, 0, 1)) / 5) * TAU;
      const sp = R(c, 40, 110);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.5, 0.8), R(c, 2.4, 4), tone(c, GOLD),
        { drag: 2, a: 0.95, glow: 1, vr: R(c, -5, 5) });
    }
    for (let i = 0; i < 2; i++) {
      add(c, 'dot', x + R(c, -10, 10), y + R(c, -6, 6), R(c, -10, 10), -R(c, 14, 40), R(c, 0.5, 0.8), R(c, 1.6, 2.4), tone(c, GOLD), { g: -10, drag: 1.2, a: 0.9, glow: 1 });
    }
  },

  // Sternenschweif bei hoher Combo (dir: Laufrichtung), sparsam. strength ab 0,66 gibt einen dritten Stern
  combo(c, x, y) {
    const d = c.dir0;
    const n = c.strength !== undefined && c.strength > 0.66 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      add(c, 'star', x - d * R(c, 4, 16) + R(c, -6, 6), y + R(c, -14, 10), -d * R(c, 30, 90) + R(c, -18, 18), R(c, -30, 10), R(c, 0.4, 0.75), R(c, 2.6, 4.6),
        tone(c, COMBOC), { g: 40, drag: 2, a: 0.95, glow: 1, vr: R(c, -6, 6) });
    }
  },

  // Großer Treffer: Ringe, Sterne und Strichfunken. strength 0 bis 1 (Standard 1), ab 0,5 drei Ringe statt zwei
  crit(c, x, y) {
    const k = c.strength === undefined ? 1 : c.strength;
    const rings = k > 0.5 ? 3 : 2;
    for (let i = 0; i < rings; i++) {
      add(c, 'ring', x, y, 0, 0, 0.4 + i * 0.12, 8 + i * 4, tone(c, CRITC), { drag: 1, a: 0.85 - i * 0.15, grow: 150 + i * 80, keep: i === 0 });
    }
    for (let i = 0; i < 10; i++) {
      const ang = ((i + R(c, -0.25, 0.25)) / 10) * TAU;
      const sp = R(c, 170, 400);
      add(c, 'star', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.5, 0.9), R(c, 4, 7.5), tone(c, CRITC),
        { g: 120, drag: 2.4, a: 0.95, glow: i % 2 === 0, vr: R(c, -7, 7) });
    }
    for (let i = 0; i < 6; i++) {
      const ang = ((i + R(c, 0, 1)) / 6) * TAU;
      const sp = R(c, 260, 520);
      add(c, 'line', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.18, 0.32), R(c, 10, 18), tone(c, CRITC), { drag: 4.5, a: 0.9, rot: ang });
    }
    for (let i = 0; i < 4; i++) {
      const ang = R(c, 0, TAU);
      const sp = R(c, 80, 240);
      add(c, 'dot', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, R(c, 0.35, 0.65), R(c, 2, 3.2), tone(c, CRITC), { g: 160, drag: 2.4, a: 0.95, glow: 1 });
    }
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

// ---------- API ----------

// Erzeugt die Partikel eines Presets. opts: { color, dir, strength }. Gibt die Anzahl neuer Partikel zurück.
// Unbekannte Presets und ungültige Koordinaten werden still ignoriert (Rückgabe 0).
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
    dir0: Number.isFinite(o.dir) && o.dir !== 0 ? (o.dir < 0 ? -1 : 1) : 0, // 0: keine Richtung angegeben
    strength: Number.isFinite(o.strength) ? clamp01(o.strength) : undefined,
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
