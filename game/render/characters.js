// Figuren: Gegner (auch die Hagelwolke), Spieler Nimbus (mit Posen und Effekten), Wurfsterne und Partikel.
//
// Reihenfolge von hinten nach vorn: Gegner, Schatten und Auren des Spielers, Dash Spur (Basis weiß,
// Regenbogen bunt), Nimbus (normal, gleitend, im Sturzflug), Orbit Sterne, Federn, Schildblase,
// Wurfsterne, Partikel, Debug Rechtecke.
// Alles ist eine reine Funktion von s und view. Animation kommt aus view.time (Nimbus) und
// e.anim (Gegner). Es gibt keinen Zustand außerhalb von s und view.
//
// Kosten: Verläufe entstehen höchstens einmal pro Frame und Art (f.g), in lokalen Koordinaten
// und mit translate und scale wiederverwendet. Partikel nutzen für Wolken pro Farbe einen
// Verlauf. Die neuesten Partikel bekommen alle Details, ältere nur einfache Formen, das Leuchten
// (Mischung 'lighter') ist pro Frame begrenzt. Bei view.reduceMotion bleiben alle Formen
// erhalten, aber ohne Blinken, Funkeln und mit sanfterer Bewegung.

import { ABILITY, ENEMY, H as H0, W as W0 } from '../constants.js';

const TAU = Math.PI * 2;
const MARGIN = 120; // Figuren im Bereich minus MARGIN bis W plus MARGIN werden gezeichnet
const DEAD_TIME = 0.4; // so lange schrumpft ein besiegter Gegner (siehe enemies.js)
const SINK = 2; // Nimbus steht 2 px tiefer als die Hitbox, damit die Wolke auf der Plattform ruht
const HIT_PLAYER = 4; // Hitbox ist pro Seite so viel kleiner als die Zeichnung (siehe enemies.js)
const HIT_ENEMY = 3;
const DETAIL_PARTICLES = 100; // so viele (die neuesten) Partikel bekommen alle Details
const HALO_MAX = 32; // höchstens so viele Leuchtkränze pro Frame
const HALO_MAX_CALM = 12;
const INVULN_HZ = 10; // Blinken bei Unverwundbarkeit
const SHOT = ABILITY.SHOT;
const AMMO_MAX = ABILITY.AMMO.MAX;
const RECOIL_TIME = 0.18; // so lange federt Nimbus nach einem Wurf zurück
const MAX_SHOTS_DRAWN = 8;

// ---------- Zahlen ----------

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const smooth = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const frac = (v) => v - Math.floor(v);

// ---------- Farben ----------

function parseColor(c) {
  if (typeof c !== 'string') return [255, 255, 255, 1];
  if (c[0] === '#') {
    const n = c.length === 4 ? c.replace(/./g, (m, i) => (i ? m + m : m)) : c;
    return [parseInt(n.slice(1, 3), 16) || 0, parseInt(n.slice(3, 5), 16) || 0, parseInt(n.slice(5, 7), 16) || 0, 1];
  }
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return [255, 255, 255, 1];
  return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
}

const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${+clamp01(a).toFixed(3)})`;

function tint(c, k) {
  const p = parseColor(c);
  return rgba(p[0], p[1], p[2], p[3] * k);
}

const C = {
  eye: '#2b2150', cheek: 'rgba(255,140,175,0.5)', mouth: '#5b3a78',
  nimbusTop: '#ffffff', nimbusMid: '#f6f3ff', nimbusBot: '#cfc8f2', nimbusEdge: 'rgba(196,186,240,0.75)',
  bolt: '#ffd23f', boltEdge: '#a87400', warn: '#ffe14a', warnEdge: '#3a1500',
  shadow: 'rgba(14,8,44,0.26)',
};

const RAINBOW = ['#ff7a9c', '#ffb86b', '#ffe27a', '#9dffc8', '#8fe9ff', '#b69cff'];

// Aussehen der Gegner: Verlauf von oben nach unten, Rand, Augenfarbe
const LOOK = {
  walker: { top: '#8696bd', mid: '#5f6e96', bot: '#3c4769', edge: '#222942', y: 36 },
  jumper: { top: '#ad82ec', mid: '#7e52cb', bot: '#52309a', edge: '#2b1760', y: 38 },
  flyer: { top: '#c3cde8', mid: '#9ca9cd', bot: '#7480a6', edge: '#38415f', y: 34 },
  charger: { top: '#8e6672', mid: '#613f4e', bot: '#33222d', edge: '#1b0f16', y: 42 },
  hailcloud: { top: '#dbe8f6', mid: '#9db0cc', bot: '#5e6d8c', edge: '#243049', y: 34 },
};

// ---------- Wolkenform: Liste von (cx, cy, rx, ry), Ursprung ist die Mitte der Unterkante ----------

const NIMBUS = [0, -13, 24, 13, -14, -21, 11, 10.5, 13, -22, 12, 11, 0, -27, 12.5, 12, -20, -12, 7, 7, 20, -12, 7, 7];
const WALKER = [0, -12, 21, 11, -11, -19, 9, 8.5, 10, -20, 10, 9.5, 0, -23, 10.5, 10.5, -17, -11, 6, 6, 17, -11, 6, 6];
const JUMPER = [0, -19, 17, 12.5, -9, -24, 9, 8, 8, -25, 9.5, 8.5, 0, -27, 8.5, 7.5];
const FLYER = [0, -14, 19, 10, -9, -20, 9, 8, 9, -20, 9.5, 8.5, 0, -22, 9, 9];
const CHARGER = [0, -14, 25, 12.5, -13, -22, 11.5, 10.5, 12, -23, 12.5, 11, 0, -27, 13, 12, -19, -13, 7, 7, 19, -13, 7, 7];

// Alle Wolkenteile als eigene Teilpfade in den aktuellen Pfad. amp: Atmen in px, ph: Phase.
function lobes(ctx, L, t, amp, ph) {
  for (let i = 0; i < L.length; i += 4) {
    const w = amp ? Math.sin(t * 2.3 + ph + i * 0.9) * amp : 0;
    const rx = Math.max(0.5, L[i + 2] + w);
    const ry = Math.max(0.5, L[i + 3] + w * 0.8);
    ctx.moveTo(L[i] + rx, L[i + 1]);
    ctx.ellipse(L[i], L[i + 1], rx, ry, 0, 0, TAU);
  }
}

// ---------- Rahmen eines Frames ----------

// Ausgangsmatrix des Kontexts, damit weiche Flecken ohne save und restore gesetzt werden können
function readBase(ctx) {
  try {
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (m && Number.isFinite(m.a + m.b + m.c + m.d + m.e + m.f)) return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
  } catch {
    // ältere Browser: dann geht es über save und restore
  }
  return null;
}

function makeFrame(ctx, s, view) {
  return {
    ctx, s, base: readBase(ctx), dirty: false,
    W: num(view.W, W0), H: num(view.H, H0), cam: num(view.camX, 0), time: num(view.time, 0),
    calm: !!view.reduceMotion, debug: !!view.debug,
    g: {}, puff: {}, halo: {}, edge: true,
  };
}

// Verläufe einmal pro Frame und Art
function G(f, key, make) {
  return f.g[key] || (f.g[key] = make(f.ctx));
}

function unitRadial(ctx, stops) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
  return g;
}

function vertical(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
  return g;
}

const mkNimbusBody = (ctx) => vertical(ctx, -40, 0, [0, C.nimbusTop, 0.5, C.nimbusMid, 1, C.nimbusBot]);
const mkNimbusGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,255,255,0.34)', 0.55, 'rgba(236,228,255,0.13)', 1, 'rgba(236,228,255,0)']);
const mkShield = (ctx) => unitRadial(ctx, [0, 'rgba(143,233,255,0.03)', 0.62, 'rgba(143,233,255,0.12)', 0.9, 'rgba(180,244,255,0.5)', 1, 'rgba(180,244,255,0)']);
const mkGold = (ctx) => unitRadial(ctx, [0, 'rgba(255,214,90,0.5)', 0.5, 'rgba(255,200,70,0.2)', 1, 'rgba(255,200,70,0)']);
const mkRedGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,90,70,0.75)', 0.5, 'rgba(255,70,60,0.34)', 1, 'rgba(255,60,50,0)']);
const mkVioletGlow = (ctx) => unitRadial(ctx, [0, 'rgba(222,160,255,0.8)', 0.5, 'rgba(190,120,255,0.34)', 1, 'rgba(190,120,255,0)']);
const mkIceGlow = (ctx) => unitRadial(ctx, [0, 'rgba(206,246,255,0.9)', 0.5, 'rgba(150,218,255,0.36)', 1, 'rgba(150,218,255,0)']);
const mkSlamGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,246,214,0.62)', 0.5, 'rgba(255,226,150,0.24)', 1, 'rgba(255,226,150,0)']);
const mkWarmGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,170,110,0.55)', 0.5, 'rgba(255,140,170,0.22)', 1, 'rgba(255,140,170,0)']);
const mkDoubleGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,196,110,0.4)', 0.5, 'rgba(255,184,107,0.16)', 1, 'rgba(255,184,107,0)']);
const mkShotGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,240,170,0.85)', 0.45, 'rgba(255,214,90,0.34)', 1, 'rgba(255,214,90,0)']);

// Schweife: von links (0) nach rechts (1) ausblendend, werden mit scale auf die Länge gezogen
function tailGradient(ctx, rgb) {
  const g = ctx.createLinearGradient(0, 0, 1, 0);
  g.addColorStop(0, `rgba(${rgb},0.9)`);
  g.addColorStop(0.5, `rgba(${rgb},0.38)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  return g;
}
const mkShotTail = (ctx) => tailGradient(ctx, '255,214,96');
const mkShotCore = (ctx) => tailGradient(ctx, '255,252,232');
const mkWhiteTail = (ctx) => tailGradient(ctx, '255,255,255');
const mkWarmTail = (ctx) => tailGradient(ctx, '255,160,120');

function bodyGradient(f, kind) {
  const L = LOOK[kind];
  return G(f, `body:${kind}`, (ctx) => vertical(ctx, -L.y, 0, [0, L.top, 0.5, L.mid, 1, L.bot]));
}

// Ein Regenbogenband, das nach rechts hin ausblendet (Einheitskoordinaten 0 bis 1)
function bandGradient(f, i) {
  return G(f, `band${i}`, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 1, 0);
    g.addColorStop(0, tint(RAINBOW[i], 0.95));
    g.addColorStop(0.55, tint(RAINBOW[i], 0.55));
    g.addColorStop(1, tint(RAINBOW[i], 0));
    return g;
  });
}

// Weicher Fleck in der Farbe c (Einheitskreis, Mitte deckend, Rand durchsichtig)
function puffGradient(f, color) {
  return f.puff[color] || (f.puff[color] = unitRadial(f.ctx, [0, tint(color, 0.95), 0.5, tint(color, 0.55), 1, tint(color, 0)]));
}

// Wie glow, aber über die Ausgangsmatrix: zwei Aufrufe statt fünf. Danach cleanBase aufrufen,
// bevor etwas anderes gezeichnet wird.
function glowAbs(f, grad, x, y, rx, ry, alpha) {
  const b = f.base;
  if (!b) {
    glow(f.ctx, grad, x, y, rx, ry, alpha);
    return;
  }
  const ctx = f.ctx;
  ctx.setTransform(b.a * rx, b.b * rx, b.c * ry, b.d * ry, b.e + b.a * x + b.c * y, b.f + b.b * x + b.d * y);
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  f.dirty = true;
}

function cleanBase(f) {
  if (!f.dirty) return;
  const b = f.base;
  f.ctx.setTransform(b.a, b.b, b.c, b.d, b.e, b.f);
  f.dirty = false;
}

// Weicher Leuchtkranz in der Farbe c: stärker im Kern, lange weich auslaufend
function haloGradient(f, color) {
  return f.halo[color] || (f.halo[color] = unitRadial(f.ctx, [0, tint(color, 0.85), 0.3, tint(color, 0.35), 0.65, tint(color, 0.1), 1, tint(color, 0)]));
}

// Füllt einen Einheitskreis, der mit translate und scale an die gewünschte Stelle gelegt wurde
function glow(ctx, grad, x, y, rx, ry, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

// ---------- Pfade ----------

function disc(ctx, x, y, r) {
  const a = Math.max(0.1, r);
  ctx.moveTo(x + a, y);
  ctx.arc(x, y, a, 0, TAU);
}

// Tropfen mit der Spitze in Richtung (sin rot, minus cos rot), also bei rot 0 nach oben
function tear(ctx, x, y, r, rot) {
  const ux = Math.sin(rot);
  const uy = -Math.cos(rot);
  const px = Math.cos(rot);
  const py = Math.sin(rot);
  ctx.moveTo(x + ux * r * 2.1, y + uy * r * 2.1);
  ctx.quadraticCurveTo(x + px * r * 0.95 + ux * r * 0.9, y + py * r * 0.95 + uy * r * 0.9, x + px * r, y + py * r);
  ctx.arc(x, y, r, rot, rot + Math.PI);
  ctx.quadraticCurveTo(x - px * r * 0.95 + ux * r * 0.9, y - py * r * 0.95 + uy * r * 0.9, x + ux * r * 2.1, y + uy * r * 2.1);
}

// Funkelstern mit vier Spitzen, gedreht um rot
function sparkle(ctx, x, y, r, rot) {
  const a = rot;
  ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  for (let k = 1; k <= 4; k++) {
    const b = a + k * (Math.PI / 2);
    ctx.quadraticCurveTo(x, y, x + Math.cos(b) * r, y + Math.sin(b) * r);
  }
}

// Fünfzackiger Stern (Wurfstern, Orbit Sterne), gedreht um rot
function star5(ctx, x, y, R, r, rot) {
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + i * (Math.PI / 5);
    const d = i % 2 ? r : R;
    if (i) ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

// Blitz als Zickzack Fläche, Ursprung oben links, Größe etwa 7 mal 13
function bolt(ctx, x, y, k) {
  ctx.moveTo(x + 4 * k, y);
  ctx.lineTo(x - 1 * k, y + 6.5 * k);
  ctx.lineTo(x + 2.4 * k, y + 6.5 * k);
  ctx.lineTo(x - 2.2 * k, y + 13.5 * k);
  ctx.lineTo(x + 6 * k, y + 5 * k);
  ctx.lineTo(x + 2.6 * k, y + 5 * k);
  ctx.lineTo(x + 6.2 * k, y);
  ctx.closePath();
}

// ============================================================
// Gesichter (lokale Koordinaten, +x ist die Blickrichtung)
// ============================================================

// Zwei Augen als weiße Flächen mit Pupillen und schrägen Brauen.
// ex: Abstand der Augen von der Mitte, gaze: Blick -1 bis 1, tilt: Neigung der Brauen, open: 0 bis 1
function angryEyes(f, ex, ey, rx, ry, gaze, tilt, open, pupil) {
  const ctx = f.ctx;
  const h = Math.max(0.6, ry * open);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const x = k ? ex : -ex;
    ctx.moveTo(x + rx, ey);
    ctx.ellipse(x, ey, rx, h, 0, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = pupil;
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const x = (k ? ex : -ex) + gaze * rx * 0.45;
    disc(ctx, x, ey + 0.3, Math.min(rx * 0.62, h * 0.9));
  }
  ctx.fill();
  if (tilt > 0) {
    ctx.strokeStyle = '#161226';
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(-ex - rx - 1.2, ey - h - 2.2 - tilt * 1.6);
    ctx.lineTo(-ex + rx + 0.4, ey - h + 0.4 + tilt * 1.4);
    ctx.moveTo(ex + rx + 1.2, ey - h - 2.2 - tilt * 1.6);
    ctx.lineTo(ex - rx - 0.4, ey - h + 0.4 + tilt * 1.4);
    ctx.stroke();
  }
}

// Kreuze statt Augen
function crossEyes(ctx, ex, ey, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const x = k ? ex : -ex;
    ctx.moveTo(x - r, ey - r);
    ctx.lineTo(x + r, ey + r);
    ctx.moveTo(x + r, ey - r);
    ctx.lineTo(x - r, ey + r);
  }
  ctx.stroke();
}

// ============================================================
// Nimbus
// ============================================================

function blinkAt(time) {
  // Alle 3,9 Sekunden ein kurzes Blinzeln, rein aus der Zeit abgeleitet
  const ph = (time + 1.3) % 3.9;
  return ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
}

// pose: '' | 'slam' (Sturzflug: entschlossen, Mund offen) | 'glide' (Gleiten: breites Lächeln)
function nimbusFace(f, p, off, dead, pose) {
  const ctx = f.ctx;
  const blink = f.calm ? blinkAt(f.time) * 0.8 : blinkAt(f.time);
  const stun = num(p.stun) > 0;
  const slam = pose === 'slam';
  const dashing = num(p.dash && p.dash.t) > 0 || slam;
  const rising = !p.onGround && num(p.vy) < -140;
  const ex = 8.2;
  const ey = -19.5;
  const fx = off;

  // Wangen
  ctx.fillStyle = C.cheek;
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const x = (k ? 14.5 : -14.5) + fx * 1.3;
    ctx.moveTo(x + 4, -12.5);
    ctx.ellipse(x, -12.5, 4, 2.6, 0, 0, TAU);
  }
  ctx.fill();

  ctx.strokeStyle = C.eye;
  ctx.lineCap = 'round';
  if (dead) {
    crossEyes(ctx, ex, ey, 2.4, C.eye, 1.7);
  } else if (stun) {
    // Zugekniffene Augen: > <
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-ex - fx * 0.2 - 3, ey - 3);
    ctx.lineTo(-ex - fx * 0.2 + 2.2, ey);
    ctx.lineTo(-ex - fx * 0.2 - 3, ey + 3);
    ctx.moveTo(ex + fx * 0.2 + 3, ey - 3);
    ctx.lineTo(ex + fx * 0.2 - 2.2, ey);
    ctx.lineTo(ex + fx * 0.2 + 3, ey + 3);
    ctx.stroke();
  } else if (blink > 0.55) {
    // Geschlossene Augen als kleine Bögen
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      const x = (k ? ex : -ex) + fx;
      ctx.moveTo(x - 3.2, ey + 0.4);
      ctx.quadraticCurveTo(x, ey + 3.2, x + 3.2, ey + 0.4);
    }
    ctx.stroke();
  } else {
    const open = 1 - blink * 1.5;
    const ry = (dashing ? 3 : 3.7) * clamp01(open);
    ctx.fillStyle = C.eye;
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      const x = (k ? ex : -ex) + fx;
      ctx.moveTo(x + 2.9, ey);
      ctx.ellipse(x, ey, 2.9, Math.max(0.5, ry), 0, 0, TAU);
    }
    ctx.fill();
    if (open > 0.6) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      for (let k = 0; k < 2; k++) disc(ctx, (k ? ex : -ex) + fx + 0.9, ey - 1.3, 1.05);
      ctx.fill();
    }
    if (slam) {
      // entschlossene Brauen, nach innen geneigt
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(-ex - fx * 0.3 - 4, ey - 6.6);
      ctx.lineTo(-ex - fx * 0.3 + 3.4, ey - 4.4);
      ctx.moveTo(ex + fx * 0.3 + 4, ey - 6.6);
      ctx.lineTo(ex + fx * 0.3 - 3.4, ey - 4.4);
      ctx.stroke();
    }
  }

  // Mund
  const mx = fx * 1.1;
  if (dead) {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(mx - 2.6, -11.4);
    ctx.quadraticCurveTo(mx, -13.6, mx + 2.6, -11.4);
    ctx.stroke();
  } else if (stun || rising || slam) {
    ctx.fillStyle = C.mouth;
    ctx.beginPath();
    ctx.moveTo(mx + 1.9, -12.2);
    ctx.ellipse(mx, -12.2, slam ? 2.4 : 1.9, stun ? 2.6 : slam ? 3 : 2.2, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const w = pose === 'glide' ? 3.8 : dashing ? 3.6 : 2.8;
    ctx.moveTo(mx - w, -13.4);
    ctx.quadraticCurveTo(mx, -10.3, mx + w, -13.4);
    ctx.stroke();
  }
}

// Wassertropfen auf der Wolke: gleiten langsam nach unten
function nimbusWet(f, wet) {
  const ctx = f.ctx;
  const n = wet > 0.75 ? 4 : 3;
  const speed = f.calm ? 0.25 : 0.5;
  ctx.fillStyle = `rgba(176,218,255,${(0.55 + 0.3 * wet).toFixed(3)})`;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ph = frac(f.time * speed + i * 0.29);
    const x = (i - (n - 1) / 2) * 12 + Math.sin(i * 2.1) * 3;
    const y = -36 + ph * 34;
    tear(ctx, x, y, 1.7 + (i % 2) * 0.4, 0);
  }
  ctx.fill();
}

// Federn über dem Kopf
function nimbusFeathers(f, n, cx, topY) {
  const ctx = f.ctx;
  const t = f.time;
  const bob = f.calm ? 0 : 1;
  for (let i = 0; i < n; i++) {
    const side = n === 1 ? 0 : i ? 1 : -1;
    const x = cx + side * 13;
    const y = topY - 13 + Math.sin(t * 2.6 + i * 1.9) * 1.6 * bob;
    const rot = side * 0.75 + Math.sin(t * 2 + i) * 0.1 * bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(246,240,255,0.97)';
    ctx.strokeStyle = 'rgba(176,152,236,0.95)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.quadraticCurveTo(5.6, -1.5, 0.4, 6);
    ctx.quadraticCurveTo(-5.6, -1.5, 0, -8.5);
    ctx.fill();
    ctx.stroke();
    // Kiel und zwei Fahnen
    ctx.strokeStyle = 'rgba(150,126,226,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.2, 9.5);
    ctx.lineTo(0, -4.5);
    ctx.moveTo(0, 1.5);
    ctx.lineTo(3.2, -2.4);
    ctx.moveTo(0, 1.5);
    ctx.lineTo(-3.2, -2.4);
    ctx.stroke();
    ctx.restore();
  }
}

// Schildblase: leuchtend, sanft pulsierend
function nimbusShield(f, cx, cy, pulse, fade) {
  const ctx = f.ctx;
  const rx = 35 * pulse;
  const ry = 31 * pulse;
  glow(ctx, G(f, 'shield', mkShield), cx, cy, rx + 3, ry + 3, 0.95 * fade);
  ctx.globalAlpha = fade;
  ctx.strokeStyle = 'rgba(204,248,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  // Glanzlicht links oben und ein kleines Funkeln
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 5, ry - 5, 0, Math.PI * 1.12, Math.PI * 1.45);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  disc(ctx, cx - rx * 0.62, cy - ry * 0.52, 1.7);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Regenbogen Dash: Bänder hinter Nimbus. back ist die Richtung nach hinten (-1 oder 1).
function dashTrail(f, cx, feet, back, trail, tail) {
  const ctx = f.ctx;
  const len = 40 + 110 * trail;
  const bandH = 4.4;
  const top = feet - 17 - (RAINBOW.length * bandH) / 2;
  const skew = f.calm ? 0 : Math.sin(f.time * 26) * 0.05;
  ctx.save();
  ctx.translate(cx + back * 12, top);
  ctx.transform(1, skew, 0, 1, 0, 0);
  ctx.scale(back * len, 1);
  ctx.globalAlpha = clamp01(trail * 1.1) * tail;
  for (let i = 0; i < RAINBOW.length; i++) {
    ctx.fillStyle = bandGradient(f, i);
    ctx.fillRect(0, i * bandH, 1, bandH + 0.7);
  }
  ctx.restore();
}

// Dezenter Regenbogen Schimmer um die Wolke, solange der Dash Vorrat läuft
function dashShimmer(f, x, y, alpha) {
  const ctx = f.ctx;
  const make = ctx.createConicGradient && ((c) => {
    const g = c.createConicGradient(0, 0, 0);
    const n = RAINBOW.length;
    for (let i = 0; i <= n; i++) g.addColorStop(i / n, RAINBOW[i % n]);
    return g;
  });
  if (!make) return;
  // Der Verlauf dreht sich, indem das Koordinatensystem gedreht wird
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(f.calm ? 0 : f.time * 0.9);
  ctx.strokeStyle = G(f, 'conic', make);
  ctx.globalAlpha = 0.14 * alpha;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(0, 0, 31, 26, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.5 * alpha;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, 31, 26, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// Goldene Aura des Sternmagneten: weicher Schein und drei kreisende Funken
function magnetAura(f, x, y, alpha) {
  const ctx = f.ctx;
  const pulse = f.calm ? 1 : 1 + Math.sin(f.time * 2.6) * 0.06;
  glow(ctx, G(f, 'gold', mkGold), x, y, 56 * pulse, 50 * pulse, 0.55 * alpha);
  const spin = f.time * (f.calm ? 0.35 : 1.5);
  ctx.globalAlpha = 0.85 * alpha;
  ctx.fillStyle = '#ffeaa6';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * TAU) / 3;
    sparkle(ctx, x + Math.cos(a) * 42, y + Math.sin(a) * 36, 3.4, a);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Hinweis: Rest Zeit eines Vorrats, kurz vor dem Ende blinkt die Aura (nicht bei reduceMotion)
function powerAlpha(f, t) {
  if (!(t > 0)) return 0;
  if (t > 1.5) return 1;
  return f.calm ? 0.6 + 0.4 * (t / 1.5) : 0.35 + 0.65 * (Math.sin(f.time * 16) * 0.5 + 0.5) * Math.min(1, t / 0.4);
}

// Basis Dash: kurzer weißer Schweif hinter Nimbus (back ist die Richtung nach hinten)
const WHITE_LAYERS = [[12, 0.32], [7, 0.55], [3, 0.9]];
function whiteTrail(f, cx, feet, back, trail, tail) {
  const ctx = f.ctx;
  const len = 26 + 54 * trail;
  const a = clamp01(trail * 1.1) * tail;
  ctx.save();
  ctx.translate(cx + back * 12, feet - 17);
  ctx.scale(back * len, 1);
  ctx.fillStyle = G(f, 'whiteTail', mkWhiteTail);
  for (let i = 0; i < WHITE_LAYERS.length; i++) {
    ctx.globalAlpha = a * WHITE_LAYERS[i][1];
    ctx.beginPath();
    ctx.moveTo(0, -WHITE_LAYERS[i][0]);
    ctx.lineTo(1, 0);
    ctx.lineTo(0, WHITE_LAYERS[i][0]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Doppelpunkte: warmer Schein und goldene Sternchen, die um Nimbus aufsteigen
function doubleAura(f, cx, feet, midY, alpha) {
  const ctx = f.ctx;
  glow(ctx, G(f, 'dbl', mkDoubleGlow), cx, midY, 52, 46, 0.85 * alpha);
  const rate = f.calm ? 0.25 : 0.65;
  ctx.fillStyle = '#ffd24a';
  for (let i = 0; i < 7; i++) {
    const ph = frac(f.time * rate + i / 7);
    const k = Math.sin(ph * Math.PI);
    ctx.globalAlpha = clamp01(k * 1.4 * alpha);
    ctx.beginPath();
    sparkle(ctx, cx + Math.sin(i * 2.4 + ph * 3) * (19 + 10 * (i % 2)), feet - 4 - ph * 58, 3.4 + 3.4 * k, ph * 3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Combo ab x3: warmer Schein, ein Funkenschweif und ein kurzer glühender Schwanz, alles wächst mit der Combo
function comboAura(f, cx, midY, back, count, alpha) {
  const ctx = f.ctx;
  const ci = clamp01((count - 2) / 4);
  glow(ctx, G(f, 'warm', mkWarmGlow), cx, midY, 54 + 10 * ci, 46 + 8 * ci, (0.4 + 0.5 * ci) * alpha);
  // glühender Schwanz hinter der Wolke
  ctx.save();
  ctx.translate(cx + back * 16, midY + 2);
  ctx.scale(back * (30 + 46 * ci), 7 + 5 * ci);
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(1, 0);
  ctx.lineTo(0, 1);
  ctx.closePath();
  ctx.globalAlpha = (0.3 + 0.35 * ci) * alpha;
  ctx.fillStyle = G(f, 'warmTail', mkWarmTail);
  ctx.fill();
  ctx.restore();
  const n = 4 + Math.floor(ci * 4);
  const rate = f.calm ? 0.5 : 1.7;
  ctx.globalAlpha = alpha;
  for (let g = 0; g < 2; g++) {
    ctx.fillStyle = g ? '#ff9ad5' : '#ffd24a';
    ctx.beginPath();
    for (let i = g; i < n; i += 2) {
      const ph = frac(f.time * rate + i * 0.173);
      const wob = f.calm ? 0 : Math.sin(f.time * 7 + i * 2.7) * 6 * (0.4 + ph);
      sparkle(ctx, cx + back * (14 + ph * (36 + 26 * ci)), midY - 10 + frac(i * 0.37) * 22 + wob, (1 - ph) * 5.2 + 1.4, ph * 4);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Wurfsterne als Orbit: die Sterne hinter der Wolke sind kleiner und blasser (front false), die davor größer
function ammoStars(f, cx, midY, ammo, front, alpha) {
  const ctx = f.ctx;
  const spin = f.time * (f.calm ? 0.5 : 1.8);
  let any = false;
  ctx.fillStyle = '#ffd966';
  ctx.strokeStyle = '#d99a1c';
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = (front ? 1 : 0.85) * alpha;
  ctx.beginPath();
  for (let i = 0; i < ammo; i++) {
    const a = spin + (i * TAU) / ammo;
    const sn = Math.sin(a);
    if ((sn >= 0) !== front) continue;
    star5(ctx, cx + Math.cos(a) * 38, midY - 4 + sn * 21, front ? 5.6 : 4.4, front ? 2.4 : 1.9, a * 0.7);
    any = true;
  }
  if (any) {
    ctx.stroke();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Gleiten: drei weiche Wolkenpuffer, die hinter Nimbus zurückbleiben und verblassen
function glidePuffs(f, cx, feet, face, k, alpha) {
  const grad = puffGradient(f, '#ffffff');
  const rate = f.calm ? 0.45 : 1.3;
  const n = f.calm ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const ph = frac(f.time * rate + i / n);
    const r = 5 + ph * 8;
    glow(f.ctx, grad, cx - face * (24 + ph * 44), feet - 13 - (i % 2) * 5 - ph * 5, r, r * 0.8, (1 - ph) * 0.85 * k * alpha);
  }
}

// Sturzflug: Geschwindigkeitslinien über dem Kopf und ein heller Schein
function slamEffect(f, cx, midY, topY, k, alpha) {
  const ctx = f.ctx;
  glow(ctx, G(f, 'slamGlow', mkSlamGlow), cx, midY - 6, 50, 58, 0.85 * k * alpha);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.75 * k * alpha;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const flick = f.calm ? 0.8 : 0.65 + 0.35 * frac(f.time * 11 + i * 0.37);
    const len = (i === 2 ? 58 : i % 2 ? 30 : 44) * flick * k;
    const y0 = topY - (i === 2 ? 4 : 9);
    ctx.moveTo(cx + (i - 2) * 9.5, y0);
    ctx.lineTo(cx + (i - 2) * 9.5, y0 - len);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Armpuffer beim Gleiten: zwei flache Wolkenzipfel links und rechts, flattern leicht
function glideArms(ctx, k, t, calm) {
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const flap = calm ? 0 : Math.sin(t * 7 + i * 1.7) * 1.6;
    const cx = side * (25 + 7 * k);
    const cy = -16 - flap;
    const rx = 5 + 5 * k;
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, 3 + 2.4 * k, side * -0.12, 0, TAU);
  }
}

function drawPlayer(f) {
  const { ctx, s } = f;
  const p = s.player;
  if (!p) return;
  const w = clamp(num(p.w, 44), 4, 200);
  const h = clamp(num(p.h, 34), 4, 200);
  const cx = num(p.x) + w / 2 - f.cam;
  const feet = num(p.y) + h + SINK;
  if (cx < -MARGIN - 40 || cx > f.W + MARGIN + 40 || feet < -160 || feet > f.H + 260) return;
  const dead = !!p.dead;
  const power = p.power && typeof p.power === 'object' ? p.power : {};
  const dashObj = p.dash && typeof p.dash === 'object' ? p.dash : {};
  const dashing = num(dashObj.t) > 0;
  const face = p.face < 0 ? -1 : 1;
  const wet = clamp01(num(p.wet));
  const deathT = clamp(num(s.deathT), 0, 60);

  // Posen: Sturzflug, Gleiten und der Rückstoß nach einem Wurf
  const slamK = !dead && p.slam && p.slam.active ? smooth(0.35 + num(p.slam.t) / 0.08) : 0;
  const glideK = !dead && !slamK && !dashing && p.glide ? smooth(0.15 + num(p.glideT) / 0.1) : 0;
  const since = SHOT.COOLDOWN - num(p.throwCd);
  const recoil = !dead && num(p.throwCd) > 0 && since >= 0 && since < RECOIL_TIME ? (1 - since / RECOIL_TIME) ** 2 * (f.calm ? 0.5 : 1) : 0;
  const pose = slamK ? 'slam' : glideK ? 'glide' : '';
  const ammo = clamp(Math.floor(num(p.ammo)), 0, AMMO_MAX);
  const comboN = s.combo && typeof s.combo === 'object' ? num(s.combo.count) : 0;

  // Gesamte Deckkraft: Sterben blendet aus, Unverwundbarkeit blinkt
  let alpha = 1;
  if (dead) alpha = Math.max(0.15, 1 - deathT * 0.7);
  else if (num(p.invuln) > 0) alpha = f.calm ? 0.78 : Math.floor(f.time * INVULN_HZ) % 2 ? 0.4 : 1;

  // Squash und Stretch, Anker ist der Boden
  let sx = clamp(num(p.squashX, 1), 0.5, 1.7);
  let sy = clamp(num(p.squashY, 1), 0.5, 1.7);
  if (p.onGround && !dead && !f.calm) sy *= 1 + Math.sin(f.time * 2.4) * 0.012; // ruhiges Atmen
  if (dashing) { sx *= 1.16; sy *= 0.9; }
  if (glideK) { sx *= 1 + 0.17 * glideK; sy *= 1 - 0.15 * glideK; }
  if (slamK) { sx *= 1 - 0.14 * slamK; sy *= 1 + 0.14 * slamK; }
  if (recoil) { sx *= 1 - 0.1 * recoil; sy *= 1 + 0.05 * recoil; }
  let lean = dead ? 0 : clamp(num(p.vx) / 300, -1, 1) * 0.07 * (f.calm ? 0.5 : 1);
  if (slamK) lean *= 1 - slamK;
  lean += face * (0.1 * glideK - 0.13 * recoil);
  const off = face * 2.6;

  const midY = feet - 20; // Mitte der Wolke
  const topY = feet - 40 * sy;

  ctx.save();
  // Kontaktschatten auf der Plattform
  if (p.onGround && !dead) {
    ctx.globalAlpha = 0.9 * alpha;
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, feet - SINK + 1, 21 * sx, 3.6, 0, 0, TAU);
    ctx.fill();
  }

  if (!dead) {
    const dAlpha = powerAlpha(f, num(power.dashT));
    if (dAlpha > 0 && !dashing) dashShimmer(f, cx, midY, dAlpha * alpha);
    const mAlpha = powerAlpha(f, num(power.magnetT));
    if (mAlpha > 0) magnetAura(f, cx, midY, mAlpha * alpha);
    const xAlpha = powerAlpha(f, num(power.double));
    if (xAlpha > 0) doubleAura(f, cx, feet, midY, xAlpha * alpha);
    const vx = num(p.vx);
    const back = Math.abs(vx) > 20 ? -Math.sign(vx) : -face;
    if (comboN >= 3) comboAura(f, cx, midY, back, comboN, alpha);
    if (ammo > 0) ammoStars(f, cx, midY, ammo, false, alpha);
    const trail = clamp01(num(p.trail));
    if (trail > 0.02 || dashing) {
      const behind = -(num(dashObj.dir) < 0 ? -1 : 1);
      const amount = dashing ? Math.max(trail, 0.5) : trail;
      if (dashObj.rainbow) dashTrail(f, cx, feet, behind, amount, alpha);
      else whiteTrail(f, cx, feet, behind, amount, alpha);
    }
    if (slamK) slamEffect(f, cx, midY, topY, slamK, alpha);
    if (glideK) glidePuffs(f, cx, feet, face, glideK, alpha);
  }

  // Weicher Schein hinter der Wolke
  glow(ctx, G(f, 'nGlow', mkNimbusGlow), cx, midY, 46 * sx, 38 * sy, 0.8 * alpha);

  // Körper
  ctx.translate(cx - face * 3.5 * recoil, feet);
  if (dead) {
    const spin = Math.min(deathT, 3) * 5.2 * -face + lean;
    ctx.translate(0, -18);
    ctx.rotate(spin);
    ctx.translate(0, 18);
  } else if (lean) {
    ctx.rotate(lean);
  }
  ctx.scale(sx, sy);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = G(f, 'nBody', mkNimbusBody);
  ctx.strokeStyle = C.nimbusEdge;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  lobes(ctx, NIMBUS, f.time, f.calm ? 0.25 : 0.8, 0);
  if (glideK) glideArms(ctx, glideK, f.time, f.calm);
  if (alpha >= 0.98) ctx.stroke(); // bei Durchsicht würden sich die Teilränder abzeichnen
  ctx.fill();
  nimbusFace(f, p, off, dead, pose);
  if (wet > 0.3 && !dead) nimbusWet(f, wet);
  ctx.restore();

  if (!dead) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (ammo > 0) ammoStars(f, cx, midY, ammo, true, alpha);
    if (recoil > 0.15) throwFlash(f, cx + face * 30, midY - 5, recoil, alpha);
    const feathers = Math.min(2, Math.floor(num(power.feather)));
    if (feathers > 0) nimbusFeathers(f, feathers, cx, topY);
    if (power.shield) {
      const pulse = f.calm ? 1 : 1 + Math.sin(f.time * 3.1) * 0.03;
      nimbusShield(f, cx, feet - 20 * sy, pulse, alpha > 0.5 ? 1 : 0.7);
    }
    ctx.restore();
  }
}

// Kurzes Aufblitzen an der Hand beim Wurf
function throwFlash(f, x, y, k, alpha) {
  const ctx = f.ctx;
  glow(ctx, G(f, 'shotGlow', mkShotGlow), x, y, 9 + 12 * k, 9 + 12 * k, clamp01(k * 1.6) * alpha);
  ctx.globalAlpha = clamp01(k * 2.2) * alpha;
  ctx.fillStyle = '#fffbe6';
  ctx.beginPath();
  sparkle(ctx, x, y, 4 + 7 * k, k * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
}

// ============================================================
// Gegner
// ============================================================

// Grundkörper einer Gewitterwolke: Rand, Verlauf, Weiches Licht oben
function enemyBody(f, kind, L, t, amp, ph) {
  const ctx = f.ctx;
  const look = LOOK[kind];
  ctx.fillStyle = bodyGradient(f, kind);
  ctx.strokeStyle = look.edge;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  lobes(ctx, L, t, amp, ph);
  if (f.edge) ctx.stroke();
  ctx.fill();
}

// Weißes Aufblitzen über dem Körper
function enemyFlash(f, L, amount) {
  if (!(amount > 0)) return;
  const ctx = f.ctx;
  ctx.fillStyle = `rgba(255,255,255,${clamp01(amount).toFixed(3)})`;
  ctx.beginPath();
  lobes(ctx, L, 0, 0, 0);
  ctx.fill();
}

function boltBelly(ctx, x, y, k) {
  ctx.fillStyle = C.bolt;
  ctx.strokeStyle = C.boltEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  bolt(ctx, x, y, k);
  ctx.stroke();
  ctx.fill();
}

function shadow(f, w) {
  const ctx = f.ctx;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(0, 0.5, w, 3.3, 0, 0, TAU);
  ctx.fill();
}

// Walker: graublaue Gewitterwolke mit Füßchen und Blitz auf dem Bauch
function drawWalker(f, e, a, dead, flash) {
  const ctx = f.ctx;
  const k = f.calm ? 0.4 : 1;
  const tele = clamp01(num(e.telegraph));
  const moving = e.state === 'patrol' && Math.abs(num(e.vx)) > 1;
  const step = Math.sin(a * 9);
  const bob = moving ? Math.abs(step) * 1.4 * k : Math.sin(a * 2.2) * 0.5 * k;
  ctx.save();
  // Füßchen
  ctx.fillStyle = LOOK.walker.edge;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const lift = moving ? Math.max(0, i ? step : -step) * 2.2 * k : 0;
    ctx.moveTo(-10 + i * 20 + 5, -2.5 - lift);
    ctx.ellipse(-10 + i * 20, -2.5 - lift, 5, 3.2, 0, 0, TAU);
  }
  ctx.fill();
  ctx.translate(0, -bob);
  ctx.rotate(moving ? Math.sin(a * 9) * 0.035 * k : 0);
  enemyBody(f, 'walker', WALKER, a, 0.5 * k, 0);
  boltBelly(ctx, -1.8, -11.5, 0.78);
  if (dead > 0) crossEyes(ctx, 7.5, -17, 2.8, '#ffffff', 1.9);
  else angryEyes(f, 7.5, -17, 4.6, 5, 1.35 - tele * 2.7, 1, 1, '#14101f');
  enemyFlash(f, WALKER, flash);
  ctx.restore();
}

// Jumper: violette runde Wolke mit Federbeinen, zieht sich vor dem Sprung zusammen und glüht
function drawJumper(f, e, a, dead, flash) {
  const ctx = f.ctx;
  const k = f.calm ? 0.4 : 1;
  const air = e.state === 'air';
  const tele = air ? 0 : smooth(num(e.telegraph));
  const legH = air ? 8.5 : 7 * (1 - 0.55 * tele);
  const amp = air ? 2.2 : 3 + 2.2 * tele;
  const breathe = air || tele > 0 ? 0 : Math.sin(a * 4.4) * 0.025 * k;
  const bx = 1 + tele * 0.14 - (air ? 0.06 : 0);
  const by = 1 - tele * 0.2 + (air ? 0.1 : 0) + breathe;
  ctx.save();
  if (tele > 0) glow(ctx, G(f, 'violet', mkVioletGlow), 0, -18, 36 + tele * 6, 30 + tele * 6, 0.25 + 0.75 * tele);
  // Federbeine
  ctx.strokeStyle = '#d4c8ff';
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const x = i ? 8.5 : -8.5;
    ctx.moveTo(x, -legH - 1);
    for (let j = 1; j <= 4; j++) ctx.lineTo(x + (j % 2 ? amp : -amp), -legH - 1 + (legH * j) / 4 + (j === 4 ? 1 : 0));
  }
  ctx.stroke();
  ctx.translate(0, -legH + 7);
  ctx.scale(bx, by);
  enemyBody(f, 'jumper', JUMPER, a, 0.4 * k, 1.3);
  if (dead > 0) crossEyes(ctx, 6.5, -20, 2.6, '#ffffff', 1.8);
  else angryEyes(f, 6.5, -20, 4.1, 4.6 + tele * 0.8, 0.8, 0.7 - tele * 0.4, 1, '#1a0f33');
  // kleiner Blitz auf der Stirn
  ctx.fillStyle = C.bolt;
  ctx.beginPath();
  bolt(ctx, -1.8, -33.6, 0.5);
  ctx.fill();
  enemyFlash(f, JUMPER, flash);
  ctx.restore();
}

// Flyer: hellere Wolke mit Flügelchen und Blitzschweif, schwebt
function drawFlyer(f, e, a, dead, flash) {
  const ctx = f.ctx;
  const k = f.calm ? 0.4 : 1;
  const flap = Math.sin(a * (f.calm ? 7 : 13));
  ctx.save();
  // Flügel hinter dem Körper
  ctx.fillStyle = 'rgba(240,243,253,0.92)';
  ctx.strokeStyle = LOOK.flyer.edge;
  ctx.lineWidth = 1.7;
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const tipY = -18 - 15 * flap * (dead > 0 ? 0 : 1);
    ctx.beginPath();
    ctx.moveTo(side * 10, -16);
    ctx.quadraticCurveTo(side * 22, tipY - 10, side * 35, tipY);
    ctx.quadraticCurveTo(side * 27, tipY + 10, side * 11, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Blitzschweif hinten (links, unter dem Flügel), flackert
  const fl = f.calm ? 1 : 0.75 + 0.25 * Math.sin(a * 21);
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = `rgba(255,196,40,${(0.9 * fl).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(-15, -9);
  ctx.lineTo(-23, -5.5);
  ctx.lineTo(-20, -3);
  ctx.lineTo(-30, 2);
  ctx.stroke();
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = `rgba(255,250,200,${fl.toFixed(3)})`;
  ctx.stroke();
  ctx.translate(0, Math.sin(a * 3) * 0.8 * k);
  enemyBody(f, 'flyer', FLYER, a, 0.5 * k, 2.1);
  if (dead > 0) crossEyes(ctx, 6, -19, 2.5, '#ffffff', 1.8);
  else angryEyes(f, 6, -19, 3.9, 4.2, 1, 0.8, 1, '#141a2e');
  // kleiner Blitz auf dem Bauch
  ctx.fillStyle = C.bolt;
  ctx.beginPath();
  bolt(ctx, -1.5, -11.5, 0.5);
  ctx.fill();
  enemyFlash(f, FLYER, flash);
  ctx.restore();
}

// Charger: große dunkelrote Sturmwolke mit Blitzhörnern
function drawCharger(f, e, a, dead, flash) {
  const ctx = f.ctx;
  const k = f.calm ? 0.4 : 1;
  const dash = e.state === 'dash';
  const tele = dash ? 0 : clamp01(num(e.telegraph));
  ctx.save();
  if (tele > 0) glow(ctx, G(f, 'red', mkRedGlow), 0, -20, 44 + tele * 8, 36 + tele * 8, 0.3 + 0.7 * tele);
  if (dash) {
    // Speedlinien hinter der Wolke (links, weil die Figur nach rechts gespiegelt wird)
    ctx.strokeStyle = 'rgba(255,242,224,0.85)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const y = -8 - i * 8.5;
      const len = 22 + ((i * 7 + Math.floor(a * 18)) % 3) * 10;
      ctx.moveTo(-27, y);
      ctx.lineTo(-27 - len, y);
    }
    ctx.stroke();
  }
  if (dash) {
    ctx.rotate(0.07);
    ctx.scale(1.1, 0.95);
  }
  enemyBody(f, 'charger', CHARGER, a, 0.5 * k, 0.4);
  // Blitzhörner
  ctx.fillStyle = C.bolt;
  ctx.strokeStyle = C.boltEdge;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    ctx.moveTo(side * 9, -34);
    ctx.lineTo(side * 11.5, -41);
    ctx.lineTo(side * 9.2, -41.4);
    ctx.lineTo(side * 13.6, -49);
    ctx.lineTo(side * 16.6, -39.6);
    ctx.lineTo(side * 14, -39.8);
    ctx.lineTo(side * 15.6, -34.2);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
  if (tele > 0) {
    // Rot glühende Wolke beim Aufladen
    ctx.fillStyle = `rgba(255,60,50,${(0.45 * tele).toFixed(3)})`;
    ctx.beginPath();
    lobes(ctx, CHARGER, 0, 0, 0);
    ctx.fill();
  }
  if (dead > 0) crossEyes(ctx, 8, -19, 3, '#ffffff', 2);
  else angryEyes(f, 8, -19, 4.7, dash ? 3.2 : 4.8, 1, 1.5, 1, tele > 0.2 || dash ? '#ff2a1a' : '#e0453a');
  enemyFlash(f, CHARGER, flash);
  ctx.restore();
}

// Eisbrocken der Hagelwolke ohne Mündung (lokale Koordinaten, Ursprung Mitte der Unterkante)
function hailBody(ctx) {
  ctx.moveTo(-21.5, -11);
  ctx.lineTo(-24, -19.5);
  ctx.lineTo(-17, -28);
  ctx.lineTo(-6, -31);
  ctx.lineTo(8, -30.5);
  ctx.lineTo(18, -27.5);
  ctx.lineTo(24, -19);
  ctx.lineTo(21, -10.5);
  ctx.lineTo(12, -5);
  ctx.lineTo(-11, -5);
  ctx.closePath();
}

// Schneehaube als Reihe weicher Kuppen mit drei Tropfkanten
const SNOW_CAP = [-14, -27, 8.5, 5.2, -3, -30.5, 9.5, 5.8, 9, -29.5, 9, 5.4, 17, -25.5, 6.6, 4.6, -19, -22.5, 3.4, 3.4, 15.5, -21.5, 2.8, 3.2];

// Hagelwolke: grauer Eisbrocken mit Schneehaube und Mündung nach unten. Vor dem Schuss zittert sie (e.shakeX),
// die Mündung glüht eisblau und die drei Hagelkörner des Fächers zeigen ihre Richtung.
function drawHailcloud(f, e, a, dead, flash) {
  const ctx = f.ctx;
  const k = f.calm ? 0.4 : 1;
  const def = ENEMY.HAILCLOUD;
  const tele = dead > 0 ? 0 : clamp01(num(e.telegraph));
  const eased = smooth(tele);
  ctx.save();
  if (tele > 0) glow(ctx, G(f, 'iceGlow', mkIceGlow), 0, -16, 38 + eased * 12, 32 + eased * 12, 0.22 + 0.7 * eased);
  ctx.translate(0, Math.sin(a * 3) * 0.8 * k);
  if (tele > 0 && !f.calm) ctx.rotate(Math.sin(a * 43) * 0.035 * tele);

  // Mündung (ragt unten aus dem Brocken)
  ctx.fillStyle = '#394561';
  ctx.strokeStyle = LOOK.hailcloud.edge;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-8, -9);
  ctx.lineTo(8, -9);
  ctx.lineTo(6.8, -0.4);
  ctx.lineTo(-6.8, -0.4);
  ctx.closePath();
  if (f.edge) ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#10162a';
  ctx.beginPath();
  ctx.ellipse(0, -0.4, 6.4, 2 + eased * 1.2, 0, 0, TAU);
  ctx.fill();
  if (tele > 0) {
    ctx.fillStyle = `rgba(214,246,255,${(0.35 + 0.6 * eased).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, -0.4, 4.6, 1.2 + eased * 0.9, 0, 0, TAU);
    ctx.fill();
  }

  // Körper
  ctx.fillStyle = bodyGradient(f, 'hailcloud');
  ctx.strokeStyle = LOOK.hailcloud.edge;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  hailBody(ctx);
  if (f.edge) ctx.stroke();
  ctx.fill();
  // Facetten: helle links oben, dunkle rechts unten, ein Riss
  ctx.fillStyle = 'rgba(246,251,255,0.3)'; // nicht reinweiß: reines Weiß ist dem Aufblitzen (flash) vorbehalten
  ctx.beginPath();
  ctx.moveTo(-21.5, -11);
  ctx.lineTo(-24, -19.5);
  ctx.lineTo(-17, -28);
  ctx.lineTo(-9, -21);
  ctx.lineTo(-13, -11.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(28,42,80,0.26)';
  ctx.beginPath();
  ctx.moveTo(24, -19);
  ctx.lineTo(21, -10.5);
  ctx.lineTo(12, -5);
  ctx.lineTo(3, -6.5);
  ctx.lineTo(13, -15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(36,48,73,0.38)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(17, -22);
  ctx.lineTo(13.5, -17.5);
  ctx.lineTo(16, -14);
  ctx.moveTo(-6, -7);
  ctx.lineTo(-3.5, -10);
  ctx.stroke();

  // Schneehaube
  ctx.fillStyle = '#f6fbff';
  ctx.strokeStyle = 'rgba(104,132,176,0.95)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i < SNOW_CAP.length; i += 4) {
    ctx.moveTo(SNOW_CAP[i] + SNOW_CAP[i + 2], SNOW_CAP[i + 1]);
    ctx.ellipse(SNOW_CAP[i], SNOW_CAP[i + 1], SNOW_CAP[i + 2], SNOW_CAP[i + 3], 0, 0, TAU);
  }
  if (f.edge) ctx.stroke();
  ctx.fill();

  if (dead > 0) crossEyes(ctx, 6.6, -15, 2.7, '#ffffff', 1.9);
  else angryEyes(f, 6.6, -15, 4.2, 4.6, 0.9 - tele * 1.4, 0.9, 1, '#0c1a33');

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${clamp01(flash).toFixed(3)})`;
    ctx.beginPath();
    hailBody(ctx);
    ctx.fill();
  }

  if (tele > 0.02) {
    // Vorschau des Fächers: Strahlen mit den Hagelkörnern an den Spitzen
    const n = Math.max(1, Math.floor(def.balls) || 1);
    const reach = 11 + 24 * eased;
    ctx.strokeStyle = `rgba(214,244,255,${(0.2 + 0.5 * eased).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = n > 1 ? -def.spread + (2 * def.spread * i) / (n - 1) : 0;
      ctx.moveTo(Math.sin(ang) * 6, -0.4 + Math.cos(ang) * 2);
      ctx.lineTo(Math.sin(ang) * reach, -0.4 + Math.cos(ang) * reach);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(240,251,255,${(0.45 + 0.5 * eased).toFixed(3)})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = n > 1 ? -def.spread + (2 * def.spread * i) / (n - 1) : 0;
      disc(ctx, Math.sin(ang) * reach, -0.4 + Math.cos(ang) * reach, 2 + eased * 1.3);
    }
    ctx.fill();
  } else if (!f.calm && dead <= 0) {
    // dezent: zwei Schneeflocken fallen unter dem Brocken
    ctx.fillStyle = 'rgba(244,250,255,0.8)';
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const ph = frac(a * 0.5 + i * 0.5);
      disc(ctx, (i ? 14 : -14) + Math.sin(a * 2 + i * 3) * 2, -4 + ph * 22, 1.5 * (1 - ph * 0.5));
    }
    ctx.fill();
  }
  ctx.restore();
}

// Gelbes Ausrufezeichen über dem Charger beim Aufladen (nicht gespiegelt)
function drawWarning(f, cx, topY, tele) {
  const ctx = f.ctx;
  const pulse = f.calm ? 1 : 1 + Math.sin(f.time * 18) * 0.12;
  const k = (0.55 + 0.65 * smooth(tele)) * pulse;
  ctx.save();
  ctx.translate(cx, topY - 16 - tele * 3);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.warnEdge;
  ctx.fillStyle = C.warn;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-4, -9);
  ctx.lineTo(4, -9);
  ctx.lineTo(2, 4.5);
  ctx.lineTo(-2, 4.5);
  ctx.closePath();
  ctx.moveTo(2.9, 9.4);
  ctx.arc(0, 9.4, 2.9, 0, TAU);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawEnemy(f, e) {
  const ctx = f.ctx;
  const w = clamp(num(e.w, 40), 4, 200);
  const h = clamp(num(e.h, 30), 4, 200);
  const shaky = e.kind === 'charger' || e.kind === 'hailcloud';
  const sx = num(e.x) + w / 2 - f.cam + (shaky ? num(e.shakeX) * (f.calm ? 0.35 : 1) : 0);
  const by = num(e.y) + h;
  if (sx < -MARGIN - 30 || sx > f.W + MARGIN + 30 || by < -80 || by > f.H + 160) return;
  const a = Number.isFinite(e.anim) ? e.anim : f.time;
  const deadK = num(e.dead) > 0 ? clamp01(e.dead / DEAD_TIME) : 0;
  const ease = 1 - (1 - deadK) * (1 - deadK);
  const dir = e.dir < 0 ? -1 : 1;
  // Treffer: weißes Aufblitzen (e.flash) und beim Besiegen ein kurzes Aufleuchten, bevor die Wolke schrumpft
  const hitFlash = deadK > 0 && deadK < 0.5 ? (1 - deadK * 2) * 0.9 : 0;
  const flash = Math.max(clamp01(num(e.flash) * 4) * 0.85, hitFlash);
  if (e.kind !== 'walker' && e.kind !== 'jumper' && e.kind !== 'flyer' && e.kind !== 'charger' && e.kind !== 'hailcloud') return;
  if (deadK >= 1) return; // schon ganz durchsichtig

  ctx.save();
  ctx.translate(sx, by);
  ctx.globalAlpha = 1 - deadK * deadK;
  f.edge = deadK < 0.15;
  if (e.kind !== 'flyer' && e.kind !== 'hailcloud') shadow(f, w * 0.48);
  ctx.scale(dir * (1 + 0.4 * ease), Math.max(0.1, 1 - 0.88 * ease));
  if (e.kind === 'walker') drawWalker(f, e, a, deadK, flash);
  else if (e.kind === 'jumper') drawJumper(f, e, a, deadK, flash);
  else if (e.kind === 'flyer') drawFlyer(f, e, a, deadK, flash);
  else if (e.kind === 'hailcloud') drawHailcloud(f, e, a, deadK, flash);
  else drawCharger(f, e, a, deadK, flash);
  ctx.restore();

  if (e.kind === 'charger' && e.state !== 'dash' && !deadK && num(e.telegraph) > 0.02) drawWarning(f, sx, by - 50, clamp01(num(e.telegraph)));
}

// ============================================================
// Wurfsterne
// ============================================================

// Leuchtender fünfzackiger Stern mit Schweif. Der Schweif liegt entgegen der Flugrichtung.
function drawShot(f, sh) {
  const ctx = f.ctx;
  const w = clamp(num(sh.w, SHOT.W), 4, 80);
  const h = clamp(num(sh.h, SHOT.H), 4, 80);
  const cx = num(sh.x) + w / 2 - f.cam;
  const cy = num(sh.y) + h / 2;
  if (cx < -MARGIN - 60 || cx > f.W + MARGIN + 60 || cy < -60 || cy > f.H + 60) return;
  const dir = num(sh.vx) < 0 ? -1 : 1;
  const r = Math.min(w, h) / 2;
  const anim = num(sh.anim);
  const spin = anim * (f.calm ? 7 : 15) * dir;
  const fade = Number.isFinite(sh.life) ? clamp01(sh.life / 0.1) : 1; // kurz vor dem Ende blendet er aus
  const len = f.calm ? 40 : 58;

  // Schweif: zwei übereinander liegende Spitzen, außen goldgelb, innen fast weiß
  ctx.save();
  ctx.translate(cx - dir * r * 0.4, cy);
  ctx.scale(-dir * len, r * 0.95);
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(1, 0);
  ctx.lineTo(0, 1);
  ctx.closePath();
  ctx.globalAlpha = 0.85 * fade;
  ctx.fillStyle = G(f, 'shotTail', mkShotTail);
  ctx.fill();
  ctx.scale(1, 0.42);
  ctx.globalAlpha = 0.9 * fade;
  ctx.fillStyle = G(f, 'shotCore', mkShotCore);
  ctx.fill();
  ctx.restore();

  glow(ctx, G(f, 'shotGlow', mkShotGlow), cx, cy, r * 2.3, r * 2.3, 0.85 * fade);

  // Zwei blasse Nachbilder hinter dem Stern geben Tempo
  ctx.fillStyle = '#ffd966';
  for (let i = 1; i <= 2; i++) {
    ctx.globalAlpha = (0.42 / i) * fade;
    ctx.beginPath();
    star5(ctx, cx - dir * i * r * 1.15, cy, r * (1 - 0.2 * i), r * (1 - 0.2 * i) * 0.45, spin - i * 0.6);
    ctx.fill();
  }

  ctx.globalAlpha = fade;
  ctx.fillStyle = '#ffe27a';
  ctx.strokeStyle = '#e39a14';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  star5(ctx, cx, cy, r, r * 0.46, spin);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#fffbe6';
  ctx.beginPath();
  star5(ctx, cx, cy, r * 0.52, r * 0.24, spin);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawShots(f) {
  const list = f.s.shots;
  if (!Array.isArray(list) || list.length === 0) return;
  const n = Math.min(list.length, MAX_SHOTS_DRAWN);
  for (let i = 0; i < n; i++) if (list[i] && typeof list[i] === 'object') drawShot(f, list[i]);
}

// ============================================================
// Partikel
// ============================================================

// Farbe eines Partikels, kaputte Angaben werden weiß
const colorOf = (p) => (typeof p.color === 'string' && p.color ? p.color : '#ffffff');

function drawParticle(f, p, sx, sy, a, color, detail, index) {
  const ctx = f.ctx;
  const size = p.size;
  if (p.shape === 'cloud' && detail && size > 2.5) {
    glowAbs(f, puffGradient(f, color), sx, sy, size * 1.35, size * 1.1, a);
    return;
  }
  cleanBase(f);
  ctx.globalAlpha = a;
  switch (p.shape) {
    case 'cloud': {
      // Einfache Wolke (alte oder sehr kleine Partikel): flache Scheibe
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, TAU);
      ctx.fill();
      break;
    }
    case 'star': {
      ctx.fillStyle = color;
      ctx.beginPath();
      if (detail) {
        const tw = f.calm ? 1 : 0.8 + 0.2 * Math.sin(f.time * 17 + index * 1.7);
        sparkle(ctx, sx, sy, size * 1.25 * tw, num(p.rot));
      } else {
        ctx.arc(sx, sy, size * 0.7, 0, TAU);
      }
      ctx.fill();
      break;
    }
    case 'line': {
      const r = num(p.rot);
      const hx = Math.cos(r) * size * 0.5;
      const hy = Math.sin(r) * size * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = clamp(size * 0.12, 1, 2.2);
      ctx.beginPath();
      ctx.moveTo(sx - hx, sy - hy);
      ctx.lineTo(sx + hx, sy + hy);
      ctx.stroke();
      break;
    }
    case 'drop': {
      ctx.fillStyle = color;
      ctx.beginPath();
      if (detail) tear(ctx, sx, sy, size, num(p.rot));
      else ctx.arc(sx, sy, size, 0, TAU);
      ctx.fill();
      break;
    }
    case 'ring': {
      // Erst ein breiter, blasser Schein, dann die dünne Linie
      const lw = clamp(size * 0.07, 1, 2.2);
      ctx.strokeStyle = color;
      ctx.beginPath();
      if (p.sq > 0 && p.sq < 1) ctx.ellipse(sx, sy, size, size * p.sq, 0, 0, TAU); // flacher Ring (Schockwelle am Boden)
      else ctx.arc(sx, sy, size, 0, TAU);
      if (detail) {
        ctx.globalAlpha = a * 0.22;
        ctx.lineWidth = lw * 3.6;
        ctx.stroke();
        ctx.globalAlpha = a;
      }
      ctx.lineWidth = lw;
      ctx.stroke();
      break;
    }
    default: {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, TAU);
      ctx.fill();
    }
  }
}

function drawParticles(f) {
  const { ctx, s } = f;
  const list = s.particles;
  if (!Array.isArray(list) || list.length === 0) return;
  const n = list.length;
  const firstDetail = Math.max(0, n - DETAIL_PARTICLES);
  const haloMax = f.calm ? HALO_MAX_CALM : HALO_MAX;
  ctx.save();
  ctx.lineCap = 'round';
  // Erst alles in normaler Mischung, Leuchtkränze danach gesammelt
  let glowing = 0;
  for (let i = 0; i < n; i++) {
    const p = list[i];
    if (!p) continue;
    const a = clamp01(num(p.alpha, 1));
    const size = num(p.size);
    if (a < 0.02 || size < 0.3) continue;
    const sx = (p.sky ? num(p.x) - num(p.cam) : num(p.x) - f.cam);
    const sy = num(p.y);
    const reach = size + (p.shape === 'line' ? size : 0) + 6;
    if (sx < -reach || sx > f.W + reach || sy < -reach || sy > f.H + reach) continue;
    drawParticle(f, p, sx, sy, a, colorOf(p), i >= firstDetail, i);
    if (p.glow && size >= 1.5) glowing++;
  }
  cleanBase(f);
  if (glowing > 0) {
    ctx.globalCompositeOperation = 'lighter';
    let used = 0;
    for (let i = n - 1; i >= 0 && used < haloMax; i--) {
      const p = list[i];
      if (!p || !p.glow) continue;
      const a = clamp01(num(p.alpha, 1));
      const size = num(p.size);
      if (a < 0.05 || size < 1.5) continue;
      const sx = (p.sky ? num(p.x) - num(p.cam) : num(p.x) - f.cam);
      const sy = num(p.y);
      if (sx < -30 || sx > f.W + 30 || sy < -30 || sy > f.H + 30) continue;
      const hr = p.shape === 'line' ? clamp(size * 0.3, 3, 8) : size * 3;
      glowAbs(f, haloGradient(f, colorOf(p)), sx, sy, hr, hr, a * 0.75);
      used++;
    }
    cleanBase(f);
    ctx.globalCompositeOperation = 'source-over';
  }
  cleanBase(f);
  ctx.restore();
}

// ============================================================
// Debug
// ============================================================

function drawDebug(f) {
  const { ctx, s } = f;
  ctx.save();
  ctx.lineWidth = 1;
  const box = (o, inset, color) => {
    ctx.strokeStyle = color;
    ctx.strokeRect(num(o.x) - f.cam + inset + 0.5, num(o.y) + inset + 0.5, num(o.w) - 2 * inset, num(o.h) - 2 * inset);
  };
  const p = s.player;
  if (p) {
    box(p, 0, 'rgba(120,255,200,0.35)');
    box(p, HIT_PLAYER, 'rgba(120,255,200,0.95)');
  }
  for (const e of s.enemies || []) {
    if (!e || num(e.x) - f.cam < -MARGIN - 60 || num(e.x) - f.cam > f.W + MARGIN + 60) continue;
    box(e, 0, 'rgba(255,140,140,0.35)');
    box(e, HIT_ENEMY, e.dead > 0 ? 'rgba(180,180,180,0.7)' : 'rgba(255,120,120,0.95)');
  }
  ctx.restore();
}

// ============================================================
// Einstieg
// ============================================================

export function drawCharacters(ctx, s, view) {
  if (!ctx || !s || !view) return;
  const f = makeFrame(ctx, s, view);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const list = s.enemies || [];
  for (let i = 0; i < list.length; i++) if (list[i]) drawEnemy(f, list[i]);
  drawPlayer(f);
  drawShots(f);
  drawParticles(f);
  if (f.debug) drawDebug(f);
  ctx.restore();
}
