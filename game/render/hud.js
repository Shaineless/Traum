// Oberfläche über dem Spiel: Punkte, Herzen, Combo, Powerups, Popups, Banner, Touch Tasten, Debug.
// ui: { state, time, debug, fps, touch, held, stats, ... }, view: { W, H, camX, time, reduceMotion }.
// Kleine Gedächtnisse (Herzverlust, Punkte Impuls) liegen in ui.hudMem und gelten für genau einen Zustand s.
// Bei view.reduceMotion bleiben Pulsieren, Blinken, Funkeln und Gleiten aus.

import { COMBO, H as H0, MAX_LIVES, POWERUPS, W as W0, difficultyAt } from '../constants.js';
import { meters, totalScore } from '../scoring.js';
import { TOUCH_LAYOUT } from '../input.js';
import { chunkAt } from '../generator.js';
import { activeEnemies } from '../sim.js';

const TAU = Math.PI * 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const INK = 'rgba(22,10,54,0.62)'; // Textkontur
const PILL = 'rgba(22,12,56,0.36)';
const PILL_EDGE = 'rgba(255,255,255,0.16)';
const SOFT = 'rgba(235,228,255,0.9)';
const GOLD = '#ffe08a';
const STAR = '#ffd966';
const MARGIN = 14;

// Farben der Combo Stufen x2, x3, x4
const COMBO_COLORS = { 2: '#ffc2ea', 3: '#ff9ad5', 4: '#ffe27a' };
const COMBO_RGB = { 2: '255,194,234', 3: '255,154,213', 4: '255,226,122' };

// Dauer der kleinen Effekte in Sekunden
const T_LOST = 0.75;
const T_GAIN = 0.6;
const T_BUMP = 0.35;
const T_COMBO_POP = 0.32;

// ---------- Hilfen ----------

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(num(v), 0, 1);
const ease = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const fmt = (n) => String(Math.max(0, Math.round(num(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const list = (v) => (Array.isArray(v) ? v : []);

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
    const rr = i % 2 ? r * 0.46 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// Herz mit Mittelpunkt (0, 0), r ist die halbe Breite
function heartPath(ctx, r) {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.95);
  ctx.bezierCurveTo(-r * 1.25, r * 0.12, -r * 1.12, -r * 0.98, -r * 0.5, -r * 0.98);
  ctx.bezierCurveTo(-r * 0.2, -r * 0.98, 0, -r * 0.76, 0, -r * 0.46);
  ctx.bezierCurveTo(0, -r * 0.76, r * 0.2, -r * 0.98, r * 0.5, -r * 0.98);
  ctx.bezierCurveTo(r * 1.12, -r * 0.98, r * 1.25, r * 0.12, 0, r * 0.95);
  ctx.closePath();
}

function sparkle(ctx, x, y, L) {
  ctx.beginPath();
  ctx.moveTo(x, y - L);
  ctx.quadraticCurveTo(x, y, x + L, y);
  ctx.quadraticCurveTo(x, y, x, y + L);
  ctx.quadraticCurveTo(x, y, x - L, y);
  ctx.quadraticCurveTo(x, y, x, y - L);
  ctx.closePath();
}

function measure(f, str, size, weight = 700, font = FONT) {
  f.ctx.font = `${weight} ${size}px ${font}`;
  return num(f.ctx.measureText(str).width);
}

// Text mit dezenter Kontur, optional mit weichem Leuchten
function text(f, str, x, y, o = {}) {
  const { size = 16, weight = 700, color = '#fff', align = 'left', alpha = 1, outline = 3, font = FONT, glow = 0, glowColor = 'rgba(190,160,255,.85)' } = o;
  if (!(alpha > 0.004)) return;
  const ctx = f.ctx;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = alpha;
  if (outline > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = outline;
    ctx.strokeStyle = INK;
    ctx.strokeText(str, x, y);
  }
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
  ctx.globalAlpha = 1;
}

// Weicher Schein: Farbverlauf von der Mitte nach außen, kostet nur einen Verlauf
function softGlow(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function pill(f, x, y, w, h, r = h / 2.4) {
  const ctx = f.ctx;
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = PILL;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = PILL_EDGE;
  ctx.stroke();
}

// Gedächtnis für Effekte, die einen Vorher Nachher Vergleich brauchen. Neuer Zustand s, neues Gedächtnis.
function memoryOf(ui, s) {
  let m = ui.hudMem;
  if (!m || m.ref !== s) {
    const lives = clamp(Math.round(num(s.lives)), 0, MAX_LIVES);
    m = { ref: s, lives, lostAt: -99, lostFrom: lives, lostTo: lives, gainAt: -99, gainFrom: lives, gainTo: lives, bonus: num(s.run && s.run.bonus), bonusAt: -99 };
    try {
      ui.hudMem = m;
    } catch {
      /* ui ist schreibgeschützt, dann gibt es eben keine Effekte über mehrere Bilder */
    }
  }
  return m;
}

// Wie weit ein Effekt ist (0 bis 1), 2 wenn er nicht läuft. Springt die Uhr zurück, ist er vorbei.
const progress = (t, at, dur) => (t >= at && t - at < dur ? (t - at) / dur : 2);

// ---------- Punkte, Distanz, Rekord ----------

function drawScore(f) {
  const { ctx, s, ui, t, mem } = f;
  const score = s.run ? Math.floor(num(totalScore(s))) : 0;
  const dist = s.run ? Math.floor(num(meters(s))) : 0;
  const bonus = num(s.run && s.run.bonus);
  if (bonus > mem.bonus) mem.bonusAt = t;
  mem.bonus = bonus;
  const bumpK = f.calm ? 2 : progress(t, mem.bonusAt, T_BUMP);
  const bump = bumpK < 1 ? (1 - bumpK) * (1 - bumpK) : 0;

  const best = Math.floor(num(ui.stats && ui.stats.bestScore));
  let rec = '';
  let recNew = false;
  if (best > 0) {
    recNew = score > best;
    rec = recNew ? 'Neuer Rekord' : `Rekord ${fmt(best)}`;
  }
  const scoreStr = fmt(score);
  const distStr = `${fmt(dist)} m`;
  const w1 = measure(f, scoreStr, 26, 800);
  const w2 = measure(f, distStr, 14, 600);
  const w3 = rec ? measure(f, rec, 11, 600) : 0;
  const px = MARGIN;
  const py = 12;
  const pw = Math.ceil(Math.max(124, 46 + w1 + 14, 32 + w2 + (rec ? 12 + w3 : 0)));
  pill(f, px, py, pw, 62, 20);

  // Stern mit weichem Schein, bei Punktgewinn kurz größer
  const sx = px + 26;
  const sy = py + 25;
  softGlow(ctx, sx, sy, 19 + 5 * bump, '255,217,102', 0.5 + 0.35 * bump);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1 + 0.28 * bump, 1 + 0.28 * bump);
  starPath(ctx, 0, 0, 11.5);
  ctx.fillStyle = STAR;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#f0a93c';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(-3.2, -3.6, 2.2, 1.4, -0.7, 0, TAU);
  ctx.fill();
  ctx.restore();

  text(f, scoreStr, px + 46, py + 34, { size: 26, weight: 800 });
  text(f, distStr, px + 16, py + 54, { size: 14, weight: 600, color: SOFT, outline: 2.5 });
  if (rec) text(f, rec, px + 16 + w2 + 12, py + 54, { size: 11, weight: 600, color: recNew ? GOLD : 'rgba(235,228,255,0.62)', outline: 2 });
}

// ---------- Herzen ----------

function drawHeart(ctx, cx, cy, r, scale, full, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  heartPath(ctx, r);
  if (full) {
    ctx.fillStyle = '#ff7aa6';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#ffd3e4';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.5, -r * 0.5, r * 0.26, r * 0.15, -0.6, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.stroke();
  }
  ctx.restore();
}

function drawHearts(f) {
  const { ctx, s, t, mem, W } = f;
  const lives = clamp(Math.round(num(s.lives)), 0, MAX_LIVES);
  if (lives < mem.lives) {
    mem.lostAt = t;
    mem.lostFrom = mem.lives;
    mem.lostTo = lives;
  } else if (lives > mem.lives) {
    mem.gainAt = t;
    mem.gainFrom = mem.lives;
    mem.gainTo = lives;
  }
  mem.lives = lives;

  const slot = 26;
  const gap = 6;
  const padX = 14;
  const pw = padX * 2 + MAX_LIVES * slot + (MAX_LIVES - 1) * gap;
  const px = W - MARGIN - pw;
  const py = 12;
  pill(f, px, py, pw, 40, 20);
  const lostK = progress(t, mem.lostAt, T_LOST);
  const gainK = progress(t, mem.gainAt, T_GAIN);
  for (let i = 0; i < MAX_LIVES; i++) {
    const cx = px + padX + slot / 2 + i * (slot + gap);
    const cy = py + 21;
    const full = i < lives;
    const lost = lostK < 1 && i >= mem.lostTo && i < mem.lostFrom;
    const gained = gainK < 1 && i >= mem.gainFrom && i < mem.gainTo;
    if (!full) drawHeart(ctx, cx, cy, 11.5, 1, false, 1);
    if (full) {
      let sc = 1;
      if (gained && !f.calm) sc = 1 + 0.5 * (1 - ease(gainK));
      else if (lives === 1 && !f.calm) sc = 1 + 0.07 * Math.pow(Math.max(0, Math.sin(t * 6)), 2); // leiser Herzschlag
      if (gained) softGlow(ctx, cx, cy, 24, '255,150,190', 0.7 * (1 - ease(gainK)));
      drawHeart(ctx, cx, cy, 11.5, sc, true, 1);
    }
    if (lost) {
      // Das verlorene Herz wächst noch einmal und löst sich auf
      drawHeart(ctx, cx, cy, 11.5, f.calm ? 1 : 1 + 0.7 * lostK, true, (1 - lostK) * 0.9);
    }
  }
}

// ---------- Combo ----------

function drawCombo(f) {
  const { ctx, s, t } = f;
  const count = Math.floor(num(s.combo && s.combo.count));
  if (count < 2) return;
  const mult = Math.min(count, COMBO.MAX_MULT);
  const color = COMBO_COLORS[clamp(mult, 2, 4)];
  const rem = clamp01(num(s.combo.timer) / COMBO.WINDOW);
  const since = COMBO.WINDOW - num(s.combo.timer); // Zeit seit dem letzten Treffer, der Timer startet dort neu
  const pop = !f.calm && since >= 0 && since < T_COMBO_POP ? 1 - since / T_COMBO_POP : 0;
  const px = MARGIN;
  const py = 84;
  const pw = 108;
  pill(f, px, py, pw, 56, 18);

  // Schein hinter der Zahl
  softGlow(ctx, px + 34, py + 24, 26 + 8 * pop, COMBO_RGB[clamp(mult, 2, 4)], 0.28 + 0.4 * pop);

  ctx.save();
  ctx.translate(px + 34, py + 24);
  const k = 1 + 0.38 * pop * pop + 0.12 * pop;
  ctx.scale(k, k);
  text(f, `x${mult}`, 0, 10, { size: 30, weight: 800, color, align: 'center', glow: mult >= COMBO.MAX_MULT ? 12 : 0, glowColor: 'rgba(255,220,120,0.8)' });
  ctx.restore();
  text(f, 'Combo', px + 62, py + 29, { size: 12, weight: 600, color: SOFT, outline: 2.5 });

  // Zeitbalken: läuft leer, blinkt kurz vor dem Ende
  const bx = px + 14;
  const bw = pw - 28;
  const by = py + 42;
  rrect(ctx, bx, by, bw, 6, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.17)';
  ctx.fill();
  if (rem > 0.01) {
    const blink = !f.calm && rem < 0.25 ? 0.6 + 0.4 * Math.sin(t * 16) : 1;
    ctx.globalAlpha = blink;
    rrect(ctx, bx, by, Math.max(6, bw * rem), 6, 3);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- Powerups ----------

// Symbole um (0, 0), etwa 11 Pixel Radius
const ICONS = {
  shield(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -10.5);
    ctx.quadraticCurveTo(5.5, -8.4, 9, -8);
    ctx.quadraticCurveTo(9.5, 3, 0, 10.5);
    ctx.quadraticCurveTo(-9.5, 3, -9, -8);
    ctx.quadraticCurveTo(-5.5, -8.4, 0, -10.5);
    ctx.closePath();
    ctx.fillStyle = '#c9f6ff';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#2aa7c9';
    ctx.stroke();
    ctx.fillStyle = '#6fd6f0';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6.6, -5.8);
    ctx.quadraticCurveTo(6.8, 2.2, 0, 8);
    ctx.closePath();
    ctx.fill();
  },
  dash(ctx) {
    const cols = ['#ff6b8f', '#ffd15e', '#6fe3b0', '#78a8ff'];
    ctx.lineCap = 'butt';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < cols.length; i++) {
      ctx.strokeStyle = cols[i];
      ctx.beginPath();
      ctx.arc(0, 5, 11 - i * 2.4, Math.PI, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-9, 6, 4.6, 3, 0, 0, TAU);
    ctx.ellipse(9, 6, 4.6, 3, 0, 0, TAU);
    ctx.fill();
  },
  magnet(ctx) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#ffc928';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(-7, -7);
    ctx.lineTo(-7, 1);
    ctx.arc(0, 1, 7, Math.PI, 0, true);
    ctx.lineTo(7, -7);
    ctx.stroke();
    ctx.fillStyle = '#eef2ff';
    ctx.fillRect(-9.7, -10.5, 5.4, 4.4);
    ctx.fillRect(4.3, -10.5, 5.4, 4.4);
  },
  feather(ctx) {
    ctx.beginPath();
    ctx.moveTo(-7, 10);
    ctx.quadraticCurveTo(-11, -4, 6, -11);
    ctx.quadraticCurveTo(11, 0, -7, 10);
    ctx.closePath();
    ctx.fillStyle = '#e1d6ff';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#8c74e0';
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 11.5);
    ctx.lineTo(4, -7);
    ctx.stroke();
  },
};

// Runde Anzeige mit Symbol. frac: Restzeit 0 bis 1 als Ring, null ohne Zeit.
function drawBubble(f, cx, cy, type, frac, alpha, blink) {
  const { ctx } = f;
  const color = POWERUPS[type].color;
  const a = alpha * blink;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(22,12,56,0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, 17, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a * 0.28;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(cx, cy, 15.5, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (frac === null) ctx.arc(cx, cy, 15.5, 0, TAU);
  else ctx.arc(cx, cy, 15.5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(frac));
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.82, 0.82);
  ICONS[type](ctx);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBuffs(f) {
  const { ctx, s, ui, t, W } = f;
  const pl = s.player || {};
  const power = pl.power || {};
  const dashT = num(power.dashT);
  const magnetT = num(power.magnetT);
  const feather = Math.floor(num(power.feather));
  const items = [];
  if (dashT > 0) items.push('dash');
  if (magnetT > 0) items.push('magnet');
  if (power.shield) items.push('shield');
  if (feather > 0) items.push('feather');
  const step = 42;
  let cx = W - MARGIN - 17;
  const cy = 77;
  for (const type of items) {
    let frac = null;
    let blink = 1;
    let alpha = 1;
    if (type === 'dash' || type === 'magnet') {
      const left = type === 'dash' ? dashT : magnetT;
      frac = left / POWERUPS[type].duration;
      if (left < 2 && !f.calm) blink = 0.65 + 0.35 * Math.sin(t * 11);
    }
    if (type === 'dash' && num(pl.dash && pl.dash.cd) > 0) alpha = 0.55; // Dash lädt noch
    drawBubble(f, cx, cy, type, frac, alpha, blink);
    if (type === 'feather') {
      // Zähler als kleine Marke unten rechts
      ctx.fillStyle = 'rgba(22,12,56,0.85)';
      ctx.beginPath();
      ctx.arc(cx + 11, cy + 11, 7.5, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = POWERUPS.feather.color;
      ctx.stroke();
      text(f, String(feather), cx + 11, cy + 15, { size: 11, weight: 800, align: 'center', outline: 0 });
    }
    if (type === 'dash' && !ui.touch) {
      // Tastenhinweis, solange der Dash zur Verfügung steht
      const kw = measure(f, 'Shift', 10, 700) + 12;
      rrect(ctx, cx - kw / 2, cy + 21, kw, 15, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.stroke();
      text(f, 'Shift', cx, cy + 32, { size: 10, weight: 700, color: SOFT, align: 'center', outline: 0 });
    }
    cx -= step;
  }
}

// ---------- Popups ----------

function drawPopups(f) {
  const { ctx, s, W, H, cam } = f;
  const popups = list(s.popups);
  for (let i = 0; i < popups.length; i++) {
    const p = popups[i];
    if (!p || typeof p.text !== 'string') continue;
    const x = num(p.x) - (p.screen ? 0 : cam);
    const y = num(p.y);
    if (x < -90 || x > W + 90 || y < -30 || y > H + 30) continue;
    const dur = Math.max(0.05, num(p.dur, 0.9));
    const age = clamp(num(p.t), 0, dur);
    const k = age / dur;
    const alpha = Math.min(1, age / 0.08) * (k < 0.55 ? 1 : 1 - ease((k - 0.55) / 0.45));
    if (alpha < 0.01) continue;
    const size = clamp(num(p.size, 18), 8, 64);
    const pop = f.calm ? 0 : Math.pow(1 - clamp01(age / 0.14), 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + 0.35 * pop, 1 + 0.35 * pop);
    text(f, p.text, 0, 0, { size, weight: 800, color: typeof p.color === 'string' ? p.color : '#fff', align: 'center', alpha, outline: Math.max(3, size * 0.17) });
    ctx.restore();
  }
}

// ---------- Banner ----------

// Teilt einen langen Text in eine oder zwei Zeilen, die in maxW passen
function bannerLines(f, str, maxW) {
  const base = 38;
  const w = measure(f, str, base, 800);
  if (w <= maxW) return { lines: [str], size: base };
  const one = (base * maxW) / w;
  const words = str.split(' ');
  if (one >= 24 || words.length < 2) return { lines: [str], size: Math.max(13, one) };
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const m = Math.max(measure(f, a, 28, 800), measure(f, b, 28, 800));
    if (!best || m < best.m) best = { a, b, m };
  }
  return { lines: [best.a, best.b], size: Math.max(13, Math.min(28, (28 * maxW) / best.m)) };
}

function drawBanner(f) {
  const { ctx, s, t, W } = f;
  const b = s.banner;
  if (!b || typeof b.text !== 'string' || !b.text) return;
  const dur = Math.max(0.2, num(b.dur, 2.6));
  const age = Math.max(0, num(b.t));
  const inK = ease(age / 0.5);
  const outK = ease((dur - age) / 0.7);
  const alpha = Math.min(inK, outK);
  if (alpha < 0.01) return;
  const dy = f.calm ? 0 : -10 * (1 - inK) - 6 * (1 - outK);
  const cx = W / 2;
  const { lines, size } = bannerLines(f, b.text, 450);
  const y0 = 66 + size * 0.85 + dy;
  let widest = 0;
  for (let i = 0; i < lines.length; i++) {
    widest = Math.max(widest, measure(f, lines[i], size, 800));
    text(f, lines[i], cx, y0 + i * size * 1.15, { size, weight: 800, align: 'center', alpha, outline: 4.5, glow: 14, glowColor: 'rgba(190,150,255,0.85)' });
  }
  const lastY = y0 + (lines.length - 1) * size * 1.15;
  if (typeof b.sub === 'string' && b.sub) {
    text(f, b.sub, cx, lastY + 27, { size: 17, weight: 600, color: '#efe6ff', align: 'center', alpha: alpha * 0.95, outline: 3.5 });
  }
  // Zwei kleine Funkelsterne links und rechts, nur wenn Platz ist
  const sx = widest / 2 + 26;
  if (sx < 220) {
    const tw = f.calm ? 1 : 0.65 + 0.35 * Math.sin(t * 3.2);
    ctx.fillStyle = GOLD;
    ctx.globalAlpha = alpha * 0.85 * tw;
    const sy = y0 - size * 0.3;
    sparkle(ctx, cx - sx, sy, 6 * tw + 2);
    ctx.fill();
    sparkle(ctx, cx + sx, sy, 6 * tw + 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- Touch Tasten ----------

// Weiche Taste. Gedrückt wird sie heller, etwas kleiner und bekommt einen Schein.
function drawPad(f, r, pressed, alpha = 1) {
  const { ctx } = f;
  const x = r.x + 3;
  const y = r.y + 3;
  const w = r.w - 6;
  const h = r.h - 6;
  const rad = Math.min(30, h / 2.4);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (pressed) {
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  rrect(ctx, x, y, w, h, rad);
  ctx.fillStyle = 'rgba(24,14,62,0.34)';
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, pressed ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)');
  g.addColorStop(1, pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)');
  ctx.fillStyle = g;
  if (pressed) {
    ctx.shadowColor = 'rgba(205,180,255,0.75)';
    ctx.shadowBlur = 14;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.lineWidth = 2;
  ctx.strokeStyle = pressed ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.32)';
  ctx.stroke();
  ctx.restore();
}

function strokeIcon(f, pressed) {
  const { ctx } = f;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = pressed ? '#ffffff' : 'rgba(255,255,255,0.88)';
}

function drawTouch(f) {
  const { ctx, ui, s } = f;
  if (!ui.touch || ui.state !== 'playing') return;
  const held = ui.held || {};
  const L = TOUCH_LAYOUT;
  const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];

  // Pfeile links und rechts
  for (const side of ['left', 'right']) {
    const r = L[side];
    const pressed = !!held[side];
    const [cx, cy] = center(r);
    const d = side === 'left' ? -1 : 1;
    drawPad(f, r, pressed);
    ctx.save();
    ctx.globalAlpha = pressed ? 1 : 0.95;
    strokeIcon(f, pressed);
    ctx.beginPath();
    ctx.moveTo(cx - d * 9, cy - 19);
    ctx.lineTo(cx + d * 10, cy);
    ctx.lineTo(cx - d * 9, cy + 19);
    ctx.stroke();
    ctx.restore();
  }

  // Sprung: Pfeil nach oben über einem kleinen Wolkenpolster
  {
    const r = L.jump;
    const pressed = !!held.jump;
    const [cx, cy] = center(r);
    drawPad(f, r, pressed);
    ctx.save();
    ctx.translate(cx, cy + (pressed ? 2 : 0));
    strokeIcon(f, pressed);
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(0, -16);
    ctx.moveTo(-19, -2);
    ctx.lineTo(0, -21);
    ctx.lineTo(19, -2);
    ctx.stroke();
    ctx.restore();
  }

  // Dash: nur solange die Kraft da ist, Restzeit als Ring um das Regenbogen Symbol
  const power = (s.player && s.player.power) || {};
  const dashT = num(power.dashT);
  if (dashT > 0) {
    const r = L.dash;
    const pressed = !!held.dash;
    const [cx, cy] = center(r);
    const cooling = num(s.player.dash && s.player.dash.cd) > 0;
    const a = cooling ? 0.55 : 1;
    drawPad(f, r, pressed, a);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy);
    const rr = Math.min(r.h / 2 - 9, 31);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = POWERUPS.dash.color;
    ctx.beginPath();
    ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(dashT / POWERUPS.dash.duration));
    ctx.stroke();
    // Tempolinien links vom Regenbogen
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-rr + 3, -5);
    ctx.lineTo(-rr - 8, -5);
    ctx.moveTo(-rr + 1, 3);
    ctx.lineTo(-rr - 10, 3);
    ctx.stroke();
    ctx.scale(1.35, 1.35);
    ctx.translate(0, -2);
    ICONS.dash(ctx);
    ctx.restore();
  }

  // Pause: zwei Balken
  {
    const r = L.pause;
    const [cx, cy] = center(r);
    drawPad(f, r, false, 0.85);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    rrect(ctx, cx - 10, cy - 12, 7, 24, 3);
    ctx.fill();
    rrect(ctx, cx + 3, cy - 12, 7, 24, 3);
    ctx.fill();
  }
}

// ---------- Debug ----------

function drawDebug(f) {
  const { ctx, s, ui, H } = f;
  if (!ui.debug) return;
  const p = s.player || {};
  const dist = s.run ? Math.floor(num(meters(s))) : 0;
  const x0 = f.cam;
  const x1 = x0 + f.W + 400;
  let plats = 0;
  for (const pl of list(s.platforms)) if (pl && pl.x + pl.w > x0 - 120 && pl.x < x1) plats++;
  const gen = s.gen && s.gen.stats ? s.gen.stats : null;
  const ev = s.events && s.events.active ? s.events.active : null;
  const lines = [
    `FPS ${Math.round(num(ui.fps))}   Distanz ${dist} m`,
    `Schwierigkeit ${difficultyAt(dist).toFixed(2)}`,
    `Chunk ${chunkAt(s, num(p.x)) || 'keiner'}`,
    `Gegner ${activeEnemies(s)}   Partikel ${list(s.particles).length}`,
    `Plattformen ${plats} von ${list(s.platforms).length}`,
    `vx ${Math.round(num(p.vx))}   vy ${Math.round(num(p.vy))}`,
    `Ereignis ${ev ? `${ev.type} ${Math.max(0, num(ev.dur) - num(ev.t)).toFixed(1)} s` : 'keins'}`,
    `Welt ${num(s.world && s.world.index)}   Tore ${num(s.world && s.world.gatesPassed)}`,
    gen ? `Chunks ${num(gen.chunks)} abgelehnt ${num(gen.rejects)} Ersatz ${num(gen.fallbacks)}` : 'Generator aus',
  ];
  const lh = 14;
  const pad = 8;
  let w = 0;
  for (const l of lines) w = Math.max(w, measure(f, l, 11, 500, MONO));
  const bw = Math.ceil(w) + pad * 2;
  const bh = lines.length * lh + pad * 2 - 3;
  // Mit Touch Tasten sitzt der Block über den Tasten, sonst unten links im Bild
  const bottom = ui.touch && ui.state === 'playing' ? TOUCH_LAYOUT.left.y - 8 : H - 10;
  const bx = 10;
  const by = bottom - bh;
  rrect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = 'rgba(8,4,26,0.66)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();
  for (let i = 0; i < lines.length; i++) {
    text(f, lines[i], bx + pad, by + pad + 10 + i * lh, { size: 11, weight: 500, color: '#e6e0ff', outline: 0, font: MONO });
  }
}

// ---------- Einstieg ----------

export function drawHud(ctx, s, ui, view) {
  if (!ctx || !s) return;
  const u = ui || {};
  const v = view || {};
  const f = {
    ctx,
    s,
    ui: u,
    W: num(v.W, W0),
    H: num(v.H, H0),
    t: num(v.time),
    cam: num(v.camX),
    calm: !!v.reduceMotion,
    mem: memoryOf(u, s),
  };
  ctx.save();
  drawPopups(f);
  drawScore(f);
  drawHearts(f);
  drawCombo(f);
  drawBuffs(f);
  drawBanner(f);
  drawTouch(f);
  drawDebug(f);
  ctx.restore();
}
