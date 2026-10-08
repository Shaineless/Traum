// Titelbild, Pause und Game Over. Alles aus Canvas Formen und system-ui Text.
// view: { W, H, camX, time, reduceMotion }, ui: { stats, records, result, overT, ... }.
// Bei view.reduceMotion bleiben Schweben, Pulsieren, Blinken und Einzählen aus.

import { H as H0, W as W0 } from '../constants.js';
import { meters, totalScore } from '../scoring.js';

const TAU = Math.PI * 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const GOLD = '#ffe08a';
const INK = '#2b2150'; // Augenfarbe von Nimbus

// Zeitplan des Game Over Bildschirms in Sekunden seit ui.overT = 0
const OVER = { TITLE: 0.05, ROWS: 0.2, ROW_STEP: 0.1, FADE: 0.3, COUNT: 0.6, BUTTON: 0.7 };

// ---------- Hilfen ----------

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));
const ease = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const mod = (a, n) => ((a % n) + n) % n;

// Ganze Zahl mit Punkt als Tausendertrenner
const fmt = (n) => String(Math.max(0, Math.round(num(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtTime = (sec) => {
  const t = Math.max(0, Math.floor(num(sec)));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function setFont(ctx, size, weight = 600) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function put(ctx, str, x, y, { size = 16, weight = 600, color = '#fff', align = 'center', alpha = 1, glow = 0, glowColor = 'rgba(190,160,255,.9)', spacing = 0 } = {}) {
  if (!(alpha > 0.004)) return; // unsichtbar, nichts zu zeichnen
  setFont(ctx, size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${spacing}px`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  if (glow > 0) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glow;
  }
  ctx.fillText(str, x, y);
  if (glow > 0) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
  }
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

function rrect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// Vierzackiger Funkelstern
function sparkle(ctx, x, y, L) {
  ctx.beginPath();
  ctx.moveTo(x, y - L);
  ctx.quadraticCurveTo(x, y, x + L, y);
  ctx.quadraticCurveTo(x, y, x, y + L);
  ctx.quadraticCurveTo(x, y, x - L, y);
  ctx.quadraticCurveTo(x, y, x, y - L);
  ctx.fill();
}

// Weicher Abdunkelschleier mit dunklerer Mitte, damit Text auf jedem Hintergrund lesbar bleibt
function veil(ctx, W, H, base, center, amount = 1) {
  ctx.fillStyle = `rgba(10,6,30,${(base * amount).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.48, 40, W / 2, H * 0.48, W * 0.62);
  g.addColorStop(0, `rgba(12,6,34,${(center * amount).toFixed(3)})`);
  g.addColorStop(1, 'rgba(12,6,34,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------- Nimbus ----------

// Weiße Wolke mit Augen und Wangen, gleicher Stil wie die Spielfigur.
// eyes: 0 (geschlossen, schläfrig) bis 1 (offen). Breite etwa 100 mal scale.
function drawNimbus(ctx, x, y, scale, { eyes = 1, glow = true, tilt = 0, squash = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(scale * (1 + squash), scale * (1 - squash));

  const g = ctx.createLinearGradient(0, -38, 0, 34);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#f6f1ff');
  g.addColorStop(1, '#d9ccff');
  ctx.fillStyle = g;
  if (glow) {
    ctx.shadowColor = 'rgba(205,185,255,.85)';
    ctx.shadowBlur = 26;
  }
  ctx.beginPath();
  const blobs = [[0, 12, 46, 22], [-27, 2, 20, 20], [29, 4, 18, 18], [-9, -14, 24, 24], [15, -10, 20, 20]];
  for (const [cx, cy, rx, ry] of blobs) {
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';

  // Wangen
  ctx.fillStyle = 'rgba(255,140,170,.55)';
  ctx.beginPath();
  ctx.ellipse(-28, 17, 7, 4.4, 0, 0, TAU);
  ctx.moveTo(35, 17);
  ctx.ellipse(28, 17, 7, 4.4, 0, 0, TAU);
  ctx.fill();

  // Augen: offen als Ovale mit Glanzpunkt, geschlossen als sanfte Bögen
  if (eyes > 0.2) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(-14, 8, 4.2, 5.4 * eyes, 0, 0, TAU);
    ctx.moveTo(18.2, 8);
    ctx.ellipse(14, 8, 4.2, 5.4 * eyes, 0, 0, TAU);
    ctx.fill();
    if (eyes > 0.6) {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.arc(-12.8, 6, 1.4, 0, TAU);
      ctx.moveTo(16.6, 6);
      ctx.arc(15.2, 6, 1.4, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-14, 7, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(14, 7, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // Mund
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 15, 5, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// Blinzeln: kurz alle 3,9 Sekunden. Ohne Bewegung bleiben die Augen offen.
function blinkEyes(time, reduce) {
  if (reduce) return 1;
  const k = mod(time, 3.9);
  if (k < 3.72 || k > 3.86) return 1;
  return Math.min(1, Math.max(0.3, Math.abs(k - 3.79) / 0.07));
}

// ---------- Tastenkappen ----------

const CAP_H = 26;

function capBase(ctx, x, y, w) {
  rrect(ctx, x, y + 2, w, CAP_H, 7);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fill();
  rrect(ctx, x, y, w, CAP_H, 7);
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.38)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function capText(ctx, x, y, w, label, size = 14) {
  put(ctx, label, x + w / 2, y + 18, { size, weight: 700, color: '#fff' });
}

function capArrow(ctx, x, y, w, dir) {
  capBase(ctx, x, y, w);
  const cx = x + w / 2;
  const cy = y + CAP_H / 2;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx + dir * 5.5, cy);
  ctx.lineTo(cx - dir * 4.5, cy - 6);
  ctx.lineTo(cx - dir * 4.5, cy + 6);
  ctx.closePath();
  ctx.fill();
}

// Zeichnet die Steuerungsübersicht, zentriert um cx, Oberkante der Kappen bei y.
function drawControls(ctx, cx, y) {
  const KEY = 30;
  const GAP = 4;
  const SEP = 18;
  const groups = [
    { w: KEY * 4 + GAP * 2 + SEP, label: 'Laufen' },
    { w: 100, label: 'Springen' },
    { w: 58, label: 'Dash' },
    { w: KEY, label: 'Pause' },
  ];
  const space = 26;
  const total = groups.reduce((a, gr) => a + gr.w, 0) + space * (groups.length - 1);
  let x = cx - total / 2;

  // Gruppe 1: Pfeile oder A und D
  capArrow(ctx, x, y, KEY, -1);
  capArrow(ctx, x + KEY + GAP, y, KEY, 1);
  const sx = x + KEY * 2 + GAP;
  put(ctx, '/', sx + SEP / 2 + GAP / 2, y + 19, { size: 15, weight: 500, color: 'rgba(255,255,255,.55)' });
  const ax = sx + SEP + GAP;
  capBase(ctx, ax, y, KEY);
  capText(ctx, ax, y, KEY, 'A');
  capBase(ctx, ax + KEY + GAP, y, KEY);
  capText(ctx, ax + KEY + GAP, y, KEY, 'D');
  const centers = [x + groups[0].w / 2];
  x += groups[0].w + space;

  // Gruppe 2: Leertaste
  capBase(ctx, x, y, groups[1].w);
  capText(ctx, x, y, groups[1].w, 'Leertaste', 13);
  centers.push(x + groups[1].w / 2);
  x += groups[1].w + space;

  // Gruppe 3: Shift
  capBase(ctx, x, y, groups[2].w);
  capText(ctx, x, y, groups[2].w, 'Shift', 13);
  centers.push(x + groups[2].w / 2);
  x += groups[2].w + space;

  // Gruppe 4: P
  capBase(ctx, x, y, groups[3].w);
  capText(ctx, x, y, groups[3].w, 'P');
  centers.push(x + groups[3].w / 2);

  groups.forEach((gr, i) => put(ctx, gr.label, centers[i], y + CAP_H + 22, { size: 13, weight: 500, color: 'rgba(235,228,255,.82)' }));
}

// Kleines Symbol für Berührung: Punkt mit zwei Wellen
function touchIcon(ctx, x, y) {
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, TAU);
  ctx.stroke();
}

// ---------- Titel ----------

export function drawTitle(ctx, ui, view) {
  const W = num(view.W, W0) > 0 ? view.W : W0;
  const H = num(view.H, H0) > 0 ? view.H : H0;
  const time = num(view.time);
  const reduce = !!view.reduceMotion;
  const cx = W / 2;
  const best = Math.floor(num(ui && ui.stats ? ui.stats.bestScore : 0));

  ctx.save();
  veil(ctx, W, H, 0.46, 0.3);

  // funkelnde Sterne um die Figur
  const sparks = [[-150, -2, 5, 0.3], [-96, -38, 3.5, 1.7], [112, -20, 4.5, 2.6], [158, 18, 3.2, 4.1], [-190, 40, 3, 5.2], [196, -48, 3, 0.9]];
  ctx.fillStyle = '#fff';
  for (const [dx, dy, L, ph] of sparks) {
    ctx.globalAlpha = reduce ? 0.55 : 0.35 + 0.35 * Math.sin(time * 1.9 + ph);
    sparkle(ctx, cx + dx, 84 + dy, L);
  }
  ctx.globalAlpha = 1;

  // Nimbus schwebt sanft
  const bob = reduce ? 0 : Math.sin(time * 1.7) * 6;
  const breathe = reduce ? 0 : 0.025 * Math.sin(time * 1.7 + 1.2);
  drawNimbus(ctx, cx, 86 + bob, 1, { eyes: blinkEyes(time, reduce), tilt: reduce ? 0 : Math.sin(time * 1.1) * 0.04, squash: breathe });

  // Name, weich leuchtend
  const pulse = reduce ? 0 : Math.sin(time * 1.4) * 5;
  const ty = 196;
  const tg = ctx.createLinearGradient(0, ty - 62, 0, ty + 8);
  tg.addColorStop(0, '#ffffff');
  tg.addColorStop(1, '#dccfff');
  put(ctx, 'Nimbus', cx, ty, { size: 84, weight: 800, color: tg, glow: 30 + pulse, glowColor: 'rgba(185,150,255,.95)', spacing: 3 });

  put(ctx, 'Ein Traum aus Wolken', cx, ty + 36, { size: 22, weight: 500, color: 'rgba(238,230,255,.92)', spacing: 3 });

  // Steuerung
  const py = 262;
  rrect(ctx, cx - 226, py, 452, 84, 18);
  ctx.fillStyle = 'rgba(22,12,56,.64)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(205,185,255,.24)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  drawControls(ctx, cx, py + 12);

  // Touch
  setFont(ctx, 14, 500);
  const tw = ctx.measureText('Touch: Tasten unten im Bild').width;
  touchIcon(ctx, cx - tw / 2 - 16, py + 106);
  put(ctx, 'Touch: Tasten unten im Bild', cx + 10, py + 111, { size: 14, weight: 500, color: 'rgba(235,228,255,.75)' });

  // blinkender Hinweis, weich ein und ausgeblendet
  const blink = reduce ? 0.95 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * 3.4));
  put(ctx, 'Tippe oder drücke eine Taste', cx, 407, { size: 24, weight: 700, color: GOLD, alpha: blink, glow: reduce ? 0 : 14, glowColor: 'rgba(255,200,100,.7)' });

  // persönlicher Rekord
  if (best > 0) {
    const label = `Rekord: ${fmt(best)}`;
    setFont(ctx, 16, 600);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = GOLD;
    starPath(ctx, cx - w / 2 - 14, 435, 7);
    ctx.fill();
    put(ctx, label, cx + 6, 440, { size: 16, weight: 600, color: 'rgba(255,238,180,.95)' });
  }
  ctx.restore();
}

// ---------- Pause ----------

export function drawPause(ctx, ui, view) {
  const W = num(view.W, W0) > 0 ? view.W : W0;
  const H = num(view.H, H0) > 0 ? view.H : H0;
  const time = num(view.time);
  const reduce = !!view.reduceMotion;
  const cx = W / 2;

  ctx.save();
  veil(ctx, W, H, 0.5, 0.3);

  // Nimbus schläft kurz, die z steigen auf
  const bob = reduce ? 0 : Math.sin(time * 1.1) * 4;
  drawNimbus(ctx, cx, 132 + bob, 0.8, { eyes: 0, tilt: reduce ? 0 : Math.sin(time * 0.8) * 0.03 });
  for (let i = 0; i < 3; i++) {
    const k = reduce ? 0.5 : mod(time * 0.35 + i / 3, 1);
    const size = 16 + i * 6 + k * 6;
    const a = reduce ? 0.7 : Math.sin(Math.PI * k) * 0.85;
    put(ctx, 'z', cx + 58 + i * 20 + k * 14, 112 - i * 4 - k * 38, { size, weight: 700, color: '#e8dcff', alpha: a, align: 'left' });
  }

  put(ctx, 'Pause', cx, 252, { size: 62, weight: 800, color: '#fff', glow: 24, spacing: 2 });
  put(ctx, 'Drücke P oder tippe, um weiterzuträumen', cx, 296, { size: 19, weight: 500, color: 'rgba(238,230,255,.9)' });
  ctx.restore();
}

// ---------- Game Over ----------

function resultOf(s, ui) {
  const r = ui && ui.result;
  if (r && typeof r === 'object') {
    return {
      score: num(r.score), distance: num(r.distance), stars: num(r.stars), kills: num(r.kills),
      bestCombo: num(r.bestCombo), time: num(r.time), cause: r.cause && typeof r.cause === 'object' ? r.cause : null,
    };
  }
  // Ohne Ergebnis aus dem Zustand ableiten
  const run = (s && s.run) || {};
  return {
    score: s && s.run ? totalScore(s) : 0, distance: s && s.run ? meters(s) : 0, stars: num(run.stars), kills: num(run.kills),
    bestCombo: num(run.bestCombo), time: num(s && s.t), cause: s && s.deathCause ? s.deathCause : null,
  };
}

function causeText(cause) {
  if (!cause) return '';
  if (cause.kind === 'fall') return 'In den Abgrund gefallen';
  return cause.label ? `Getroffen von: ${cause.label}` : 'Getroffen';
}

// Kleine Markierung "Rekord" mit Stern, rechts in der Zeile
function recordTag(ctx, x, y, alpha, reduce, time) {
  rrect(ctx, x, y - 10, 62, 20, 10);
  ctx.globalAlpha = alpha * 0.2;
  ctx.fillStyle = '#ffd24a';
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffd966';
  const k = reduce ? 1 : 1 + 0.12 * Math.sin(time * 3);
  starPath(ctx, x + 12, y, 5.2 * k);
  ctx.fill();
  put(ctx, 'Rekord', x + 20, y + 4, { size: 11, weight: 700, color: '#ffe08a', align: 'left', alpha });
  ctx.globalAlpha = 1;
}

export function drawGameOver(ctx, s, ui, view) {
  const W = num(view.W, W0) > 0 ? view.W : W0;
  const H = num(view.H, H0) > 0 ? view.H : H0;
  const time = num(view.time);
  const reduce = !!view.reduceMotion;
  const T = Math.max(0, num(ui && ui.overT));
  const r = resultOf(s, ui);
  const rec = (ui && ui.records) || {};
  const best = Math.max(Math.floor(num(ui && ui.stats ? ui.stats.bestScore : 0)), Math.round(r.score));
  const cx = W / 2;

  ctx.save();
  veil(ctx, W, H, 0.18, 0.22, ease(T / 0.5));

  // Überschrift
  const a0 = ease((T - OVER.TITLE) / 0.45);
  put(ctx, 'Du bist aufgewacht.', cx, 62 + (reduce ? 0 : (1 - a0) * 10), { size: 40, weight: 800, color: '#fff', alpha: a0, glow: 22, spacing: 1 });

  // Rekord und Ursache. Die Zeilen darunter rutschen nach oben, wenn etwas fehlt.
  let y = 96;
  if (rec.score) {
    const pulse = reduce ? 1 : 1 + 0.045 * Math.sin(time * 3.2);
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(pulse, pulse);
    put(ctx, '✨ Neuer Traumrekord!', 0, 0, { size: 23, weight: 800, color: '#ffd24a', alpha: ease((T - 0.15) / 0.4), glow: 14, glowColor: 'rgba(255,190,60,.75)' });
    ctx.restore();
    y += 28;
  }
  const cause = causeText(r.cause);
  if (cause) {
    put(ctx, cause, cx, y, { size: 16, weight: 500, color: 'rgba(238,230,255,.85)', alpha: ease((T - 0.12) / 0.4) });
    y += 22;
  }

  // Werte
  const rows = [
    { label: 'Punkte', value: r.score, hero: true, rec: rec.score },
    { label: 'Distanz', value: r.distance, suffix: ' m', rec: rec.distance },
    { label: 'Zeit', value: r.time, time: true, rec: rec.time },
    { label: 'Sterne', value: r.stars, rec: rec.stars },
    { label: 'Gegner', value: r.kills },
    { label: 'Beste Combo', value: r.bestCombo, rec: rec.combo },
    { label: 'Rekord', value: best, gold: true },
  ];
  const ROW = 23;
  const HERO = 36;
  const PAD = 10;
  const pw = 340;
  const px = cx - pw / 2;
  const py = y + 4;
  const ph = PAD * 2 + HERO + (rows.length - 1) * ROW;

  const pa = ease(T / 0.4);
  rrect(ctx, px, py, pw, ph, 18);
  ctx.globalAlpha = pa;
  ctx.fillStyle = 'rgba(22,12,56,.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(205,185,255,.24)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  let ry = py + PAD;
  rows.forEach((row, i) => {
    const h = row.hero ? HERO : ROW;
    const start = OVER.ROWS + i * OVER.ROW_STEP;
    const a = ease((T - start) / OVER.FADE);
    const mid = ry + h / 2;
    const shown = reduce ? row.value : row.value * easeOut((T - start - 0.05) / OVER.COUNT);
    const text = row.time ? fmtTime(shown) : fmt(shown) + (row.suffix || '');
    const slide = reduce ? 0 : (1 - a) * 8;
    const labelColor = row.gold ? 'rgba(255,226,140,.9)' : 'rgba(228,218,255,.8)';
    const valueColor = row.gold ? GOLD : '#fff';
    if (a > 0) {
      if (i > 0) {
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = 'rgba(205,185,255,.14)';
        ctx.fillRect(px + 20, ry, pw - 40, 1);
        ctx.globalAlpha = 1;
      }
      put(ctx, row.label, px + 22, mid + 5 + slide, { size: row.hero ? 18 : 16, weight: 500, color: labelColor, align: 'left', alpha: a });
      put(ctx, text, px + pw - 88, mid + (row.hero ? 11 : 6) + slide, {
        size: row.hero ? 36 : 20, weight: 800, color: valueColor, align: 'right', alpha: a, glow: row.hero ? 10 : 0, glowColor: 'rgba(190,160,255,.8)',
      });
      if (row.rec) recordTag(ctx, px + pw - 78, mid + slide, a, reduce, time);
    }
    ry += h;
  });

  // Knopf
  const ba = ease((T - OVER.BUTTON) / 0.3);
  if (ba > 0) {
    const bw = 264;
    const bh = 46;
    const bx = cx - bw / 2;
    const by = Math.min(py + ph + 16, H - bh - 36);
    const pulse = reduce ? 0 : Math.sin((T - OVER.BUTTON) * 3.2);
    const sc = 1 + 0.03 * pulse;
    ctx.save();
    ctx.globalAlpha = ba;
    ctx.translate(cx, by + bh / 2);
    ctx.scale(sc, sc);
    const g = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
    g.addColorStop(0, '#7f6cff');
    g.addColorStop(1, '#c77dff');
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(190,140,255,.75)';
    ctx.shadowBlur = reduce ? 14 : 16 + 6 * pulse;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    sparkle(ctx, -bw / 2 + 26, 0, 6);
    sparkle(ctx, bw / 2 - 26, 0, 6);
    put(ctx, 'Nochmal träumen', 0, 7, { size: 21, weight: 800, color: '#fff' });
    ctx.restore();
    put(ctx, 'Drücke eine Taste oder tippe', cx, by + bh + 22, { size: 13, weight: 500, color: 'rgba(235,228,255,.6)', alpha: ba });
  }
  ctx.restore();
}
