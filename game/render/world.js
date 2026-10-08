// Welt: Plattformen, Regen und Windzonen, Stachelwolken, Blitze, Sterne, Powerups und Traumtore.
//
// Reihenfolge von hinten nach vorn: Zonen (Regen, Wind), Plattformen, Tor (Rückseite),
// Stachelwolken, Blitze, Sterne, Powerups, Tor (Vorderseite).
// Alles hier ist eine reine Funktion von s und view. Bewegung kommt aus view.time, der Zufall
// der Dekoration aus hash() mit der Objekt id. Es gibt keinen Zustand außerhalb von s und view.
//
// Kosten: Verläufe entstehen höchstens einmal pro Frame und Art (G), meist in lokalen
// Koordinaten und mit translate wiederverwendet. Große Mengen (Sterne, Tropfen, Windlinien)
// laufen in einem Pfad und werden mit wenigen Aufrufen gezeichnet. Bei sehr vielen sichtbaren
// Objekten werden Details weggelassen (COST und LOD), damit ein Frame in der Zeichenanzahl begrenzt bleibt.
// Bei view.reduceMotion bleiben alle Formen und Warnungen erhalten, aber ohne Blinken,
// Funkeln, Wackeln und Schweben. Nur Wetter und Tor bewegen sich langsamer weiter.

import { H as H0, LIGHTNING, POWERUPS, SPIKE, W as W0, WIND } from '../constants.js';
import { themeAt } from '../theme.js';

const TAU = Math.PI * 2;
const MARGIN = 150; // Objekte im Bereich minus MARGIN bis W plus MARGIN werden gezeichnet
// Geschätzte Kosten (Zeichenaufrufe) pro sichtbarem Objekt. Übersteigt die Summe LOD[0], entfallen
// kleine Details, übersteigt sie LOD[1], bleiben nur noch die Grundformen. Im normalen Spiel
// liegt die Summe weit darunter, die Stufen fangen nur ungewöhnlich volle Bilder ab.
const COST = { plat: 50, star: 14, spike: 55, bolt: 75, zone: 100, power: 32, gate: 105 };
const LOD = [1700, 3000];
const STAR_RADIUS = { normal: 10, risk: 14, event: 7 };
const SLANT = 0.22; // Regen fällt schräg: Verschiebung in x pro Pixel Fall
const RAIN_SPEED = 400;
const FAR = 100000;

// ---------- Zahlen ----------

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const frac = (v) => v - Math.floor(v);
const hash = (n) => frac(Math.sin((Number.isFinite(n) ? n : 0) * 12.9898 + 78.233) * 43758.5453);

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

// Gleiche Farbe, Alpha mit k multipliziert
function tint(c, k) {
  const p = parseColor(c);
  return rgba(p[0], p[1], p[2], p[3] * k);
}

// Mischung zweier Farben (opak)
function mixc(a, b, k) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return rgba(pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k, 1);
}

const lighten = (c, k) => mixc(c, '#ffffff', k);
const darken = (c, k) => mixc(c, '#0b0620', k);

// Farben, die nicht von der Welt abhängen
const C = {
  star: '#ffd966', starHi: '#fff6c4', risk: '#ffbe2e', riskEdge: '#ff9a1f', event: '#fffbe6', eventHalo: '#bff4ff',
  spike: '#ffe94a', spikeEdge: '#e7a400', spikeBody: '#2b2a3c', spikeBodyHi: '#46435d',
  stormTop: '#6a7198', stormBot: '#262a46', bolt: '#fff3a0', boltCore: '#ffffff', warn: '#ffe14a', warnDark: '#2a1a00',
  rainCloudOn: '#343958', rainCloudOff: '#6c7399', rain: '#cfe4ff',
};

function makePalette(t) {
  const ground = t.ground;
  const top = t.groundTop;
  const fl = t.float;
  return {
    ground, groundTop: top,
    bodyTop: mixc(ground, top, 0.2), bodyBot: darken(ground, 0.5),
    puff: lighten(ground, 0.4), rimHi: lighten(top, 0.6), mist: lighten(top, 0.6),
    fl, flTop: lighten(fl, 0.4), flBot: darken(fl, 0.34), flPuff: darken(fl, 0.2),
    accent: t.accent, accentHi: lighten(t.accent, 0.55),
    mvTop: lighten(mixc(fl, '#27375f', 0.38), 0.12), mv: mixc(fl, '#27375f', 0.38), mvBot: darken(mixc(fl, '#27375f', 0.38), 0.35),
    brTop: lighten(mixc(fl, '#f1dccb', 0.62), 0.12), br: mixc(fl, '#f1dccb', 0.62), brBot: mixc(fl, '#b49f9a', 0.5),
    crack: darken(fl, 0.62),
  };
}

// ---------- Verläufe (einmal pro Frame und Art) ----------

function G(f, key, make) {
  return f.g[key] || (f.g[key] = make(f.ctx, f.pal));
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

const mkGroundBody = (ctx, p) => vertical(ctx, 0, 240, [0, p.bodyTop, 0.16, p.ground, 1, p.bodyBot]);
const mkRimV = (ctx, p) => vertical(ctx, -1, 0, [0, tint(p.groundTop, 0), 1, tint(p.groundTop, 1)]);
const mkRimCap = (ctx, p) => unitRadial(ctx, [0, tint(p.groundTop, 1), 1, tint(p.groundTop, 0)]);
const mkFlBody = (ctx, p) => vertical(ctx, 0, 16, [0, p.flTop, 0.45, p.fl, 1, p.flBot]);
const mkMvBody = (ctx, p) => vertical(ctx, 0, 16, [0, p.mvTop, 0.45, p.mv, 1, p.mvBot]);
const mkBrBody = (ctx, p) => vertical(ctx, 0, 16, [0, p.brTop, 0.5, p.br, 1, p.brBot]);
const mkRainVeil = (ctx) => unitRadial(ctx, [0, 'rgba(80,100,190,0.26)', 0.7, 'rgba(80,100,190,0.14)', 1, 'rgba(80,100,190,0)']);
const mkWindSoft = (ctx, p) => unitRadial(ctx, [0, tint(p.mist, 0.2), 0.65, tint(p.mist, 0.1), 1, tint(p.mist, 0)]);
const mkGateIn = (ctx) => unitRadial(ctx, [0, 'rgba(255,250,226,0.62)', 0.5, 'rgba(255,222,170,0.26)', 0.85, 'rgba(190,170,255,0.12)', 1, 'rgba(190,170,255,0)']);
const mkGateAura = (ctx) => unitRadial(ctx, [0, 'rgba(255,236,180,0.34)', 0.55, 'rgba(255,214,150,0.14)', 1, 'rgba(255,214,150,0)']);
const mkGateBase = (ctx) => unitRadial(ctx, [0, 'rgba(255,240,190,0.7)', 1, 'rgba(255,240,190,0)']);
const mkTrail = (ctx) => vertical(ctx, -1, 0, [0, 'rgba(255,225,120,0)', 1, 'rgba(255,225,120,0.5)']);
const mkColumn = (ctx) => vertical(ctx, 0, 1, [0, 'rgba(255,244,170,0.05)', 0.7, 'rgba(255,240,150,0.85)', 1, 'rgba(255,240,150,1)']);
const mkSteam = (ctx) => unitRadial(ctx, [0, 'rgba(236,240,255,0.8)', 0.5, 'rgba(236,240,255,0.35)', 1, 'rgba(236,240,255,0)']);
const mkFlash = (ctx) => unitRadial(ctx, [0, 'rgba(255,255,236,0.95)', 0.35, 'rgba(255,240,150,0.5)', 1, 'rgba(255,230,120,0)']);
const mkGold = (ctx) => unitRadial(ctx, [0, 'rgba(255,214,80,0.55)', 0.5, 'rgba(255,190,60,0.22)', 1, 'rgba(255,190,60,0)']);
const mkCloudGlow = (ctx) => unitRadial(ctx, [0, 'rgba(255,248,200,1)', 0.45, 'rgba(255,226,120,0.6)', 1, 'rgba(255,210,90,0)']);

// ---------- Pfade ----------

// Weicher Fleck als eigener Teilpfad (ellipse allein würde eine Linie vom letzten Punkt ziehen)
function blob(ctx, cx, cy, rx, ry) {
  const a = Math.max(0.1, rx);
  ctx.moveTo(cx + a, cy);
  ctx.ellipse(cx, cy, a, Math.max(0.1, ry), 0, 0, TAU);
}

function disc(ctx, cx, cy, r) {
  const a = Math.max(0.1, r);
  ctx.moveTo(cx + a, cy);
  ctx.arc(cx, cy, a, 0, TAU);
}

function pill(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// Rechteck mit abgerundeten oberen Ecken
function roundedTop(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h);
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Funkelstern mit vier Spitzen
function sparkle(ctx, x, y, r) {
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
}

// Fünfzackiger Stern als Pentagramm. Mit der Füllregel nonzero entsteht der volle Stern in nur sechs Aufrufen.
function pentagram(ctx, cx, cy, r, rot) {
  for (let k = 0; k < 5; k++) {
    const a = rot - Math.PI / 2 + k * (TAU * 2 / 5);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function dash(ctx, pattern, offset = 0) {
  if (ctx.setLineDash) ctx.setLineDash(pattern);
  ctx.lineDashOffset = offset;
}

// Weicher Schein über einer Oberkante (Ursprung auf der Kante): Mittelstück als senkrechter
// Verlauf, an beiden Enden Viertelellipsen mit Radius r, damit nirgends eine harte Kante steht.
function rimGlow(f, w, hg, alpha, r) {
  const { ctx } = f;
  const k = Math.min(r, w / 2);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.scale(1, hg);
  ctx.fillStyle = G(f, 'rimV', mkRimV);
  ctx.fillRect(k, -1, w - 2 * k, 1);
  ctx.scale(k, 1);
  ctx.fillStyle = G(f, 'rimCap', mkRimCap);
  ctx.translate(1, 0);
  ctx.fillRect(-1, -1, 1, 1);
  ctx.translate((w - 2 * k) / k, 0);
  ctx.fillRect(0, -1, 1, 1);
  ctx.restore();
}

// ---------- Rahmen eines Frames ----------

const visX = (f, x0, x1) => x1 - f.cam >= -MARGIN && x0 - f.cam <= f.W + MARGIN;

function platExtent(p) {
  let x0 = p.x;
  let x1 = p.x + p.w;
  if (p.kind === 'moving') {
    const ax = Math.abs(num(p.ax));
    const ox = num(p.ox, p.x);
    x0 = Math.min(x0, ox - ax);
    x1 = Math.max(x1, ox + ax + p.w);
  }
  return [x0, x1];
}

function platOk(p) {
  return !!p && p.w > 0 && Number.isFinite(p.x) && Number.isFinite(p.y) && p.w < FAR;
}

// Schätzt die Kosten des Bildes (siehe COST). Liegt nichts im Bild, ist das Ergebnis 0 und es wird nichts gezeichnet.
function scan(s, cam, W) {
  const lo = cam - MARGIN;
  const hi = cam + W + MARGIN;
  let cost = 0;
  for (const p of s.platforms || []) {
    if (!platOk(p)) continue;
    const e = platExtent(p);
    if (e[1] >= lo && e[0] <= hi) cost += COST.plat;
  }
  for (const h of s.hazards || []) {
    if (h && Number.isFinite(h.x) && h.x >= lo - 80 && h.x <= hi + 80) cost += h.kind === 'lightning' ? COST.bolt : COST.spike;
  }
  for (const z of s.zones || []) {
    if (z && Number.isFinite(z.x) && z.w > 0 && z.x + z.w >= lo && z.x <= hi) cost += COST.zone;
  }
  for (const st of s.stars || []) {
    if (st && !st.got && Number.isFinite(st.x) && st.x >= lo - 30 && st.x <= hi + 30) cost += COST.star;
  }
  for (const u of s.powerups || []) {
    if (u && !u.got && Number.isFinite(u.x) && u.x >= lo - 30 && u.x <= hi + 30) cost += COST.power;
  }
  for (const g of s.gates || []) {
    if (g && Number.isFinite(g.x) && g.x >= lo - 100 && g.x <= hi + 100) cost += COST.gate;
  }
  return cost;
}

function makeFrame(ctx, s, view, W, H, cost) {
  const calm = !!view.reduceMotion;
  const time = num(view.time, num(s.realT, 0));
  const t = themeAt(s.world || { from: 0, to: 0, blend: 1 });
  return {
    ctx, s, view, W, H, cam: num(view.camX, 0), time, calm,
    t: time * (calm ? 0.35 : 1), // Takt für alle Bewegungen
    pal: makePalette(t), g: {},
    lodSmall: cost > LOD[0], lodMin: cost > LOD[1], // kleine Details weglassen, nur Grundformen
  };
}

// ---------- Hauptfunktion ----------

export function drawWorld(ctx, s, view) {
  if (!ctx || !s || !view) return;
  const W = num(view.W, W0);
  const H = num(view.H, H0);
  const cost = scan(s, num(view.camX, 0), W);
  if (!cost) return;
  const f = makeFrame(ctx, s, view, W, H, cost);
  ctx.save();
  drawRainZones(f);
  drawWindZones(f);
  drawPlatforms(f);
  drawGates(f, false);
  drawSpikes(f);
  drawLightning(f);
  drawStars(f);
  drawPowerups(f);
  drawGates(f, true);
  if (view.debug) drawDebug(f);
  ctx.restore();
}

// ============================================================
// Plattformen
// ============================================================

function drawPlatforms(f) {
  const list = f.s.platforms || [];
  const vis = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!platOk(p) || p.y > f.H + 30 || p.y + num(p.h, 16) < -30) continue;
    const e = platExtent(p);
    if (!visX(f, e[0], e[1])) continue;
    vis.push(p);
  }
  // Gleisspuren zuerst, damit keine Plattform von einer fremden Spur überdeckt wird
  if (!f.lodMin) for (let i = 0; i < vis.length; i++) if (vis[i].kind === 'moving') drawTrack(f, vis[i]);
  for (let i = 0; i < vis.length; i++) {
    const p = vis[i];
    if (p.kind === 'moving') drawMoving(f, p);
    else if (p.kind === 'breakable') drawBreakable(f, p);
    else if (p.ground || num(p.h, 16) > 60) drawGround(f, p);
    else drawFloater(f, p);
  }
}

// ---------- hohe Bodenstücke ----------

function drawGround(f, p) {
  const { ctx, pal } = f;
  const w = p.w;
  const x = p.x - f.cam;
  const hh = Math.min(num(p.h, 200), f.H + 14 - p.y);
  if (!(hh > 4)) return;
  const a = Math.max(0, -x - 40); // sichtbarer Teil in lokalen Koordinaten
  const b = Math.min(w, f.W - x + 40);
  ctx.save();
  ctx.translate(x, p.y);

  ctx.fillStyle = G(f, 'gBody', mkGroundBody);
  ctx.beginPath();
  roundedTop(ctx, 0, 0, w, hh, 11);
  ctx.fill();

  ctx.save();
  ctx.clip();
  // weiche Wolkenflecken im Inneren
  if (!f.lodMin) {
    ctx.fillStyle = pal.puff;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    for (let k = Math.floor(a / 110); k <= Math.ceil(b / 110); k++) {
      const hx = hash(p.id * 3.7 + k);
      const hy = hash(p.id * 1.3 + k * 2.9);
      blob(ctx, k * 110 + 20 + hx * 70, 26 + hy * 60, 34 + hx * 22, 9 + hy * 8);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // leuchtender Rand und Kanten
  ctx.fillStyle = pal.groundTop;
  ctx.fillRect(0, 0, w, 5);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = pal.rimHi;
  ctx.fillRect(0, 0, w, 1.8);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 5, w, 4);
  ctx.fillRect(w - 3, 0, 3, hh);
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.1;
  ctx.fillRect(0, 0, 2, hh);
  ctx.globalAlpha = 1;
  ctx.restore();

  rimGlow(f, w, 16, 0.5, 14);

  if (!f.lodSmall) groundDecor(f, p, a, b);
  ctx.restore();
}

// Lichtgräser und kleine Wolken auf dem Rand
function groundDecor(f, p, a, b) {
  const { ctx, pal } = f;
  const cell = 58;
  const sway = f.calm ? 0 : 1;
  ctx.fillStyle = pal.rimHi;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  let any = false;
  const k0 = Math.floor(a / cell);
  const k1 = Math.ceil(b / cell);
  for (let k = k0; k <= k1; k++) {
    const lx = k * cell + 12 + hash(p.id * 2.3 + k) * (cell - 24);
    if (lx < 10 || lx > p.w - 10) continue;
    if (hash(p.id * 5.1 + k * 1.7) < 0.42) continue;
    const sw = Math.sin(f.t * 1.3 + lx * 0.05) * 1.3 * sway;
    const tall = 1 + hash(p.id + k * 4.1) * 0.5;
    ctx.moveTo(lx - 6, 1);
    ctx.lineTo(lx - 4 + sw, -7 * tall);
    ctx.lineTo(lx - 2, 1);
    ctx.lineTo(lx + sw * 1.4, -10.5 * tall);
    ctx.lineTo(lx + 2, 1);
    ctx.lineTo(lx + 4 + sw, -6 * tall);
    ctx.lineTo(lx + 6, 1);
    any = true;
  }
  if (any) ctx.fill();
  ctx.fillStyle = pal.mist;
  ctx.globalAlpha = 0.42;
  ctx.beginPath();
  any = false;
  for (let k = k0; k <= k1; k++) {
    const lx = k * cell + 12 + hash(p.id * 2.3 + k) * (cell - 24);
    if (lx < 14 || lx > p.w - 14) continue;
    if (hash(p.id * 5.1 + k * 1.7) >= 0.2) continue; // nur dort, wo kein Gras steht
    blob(ctx, lx, -2.5, 9, 4.5);
    blob(ctx, lx - 9, -1.3, 6, 3.6);
    blob(ctx, lx + 9, -1.3, 7, 3.8);
    any = true;
  }
  if (any) ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------- schwebende Wolkenplattform ----------

function drawFloater(f, p) {
  const { ctx, pal } = f;
  const w = p.w;
  const h = num(p.h, 16);
  const x = p.x - f.cam;
  ctx.save();
  ctx.translate(x, p.y);

  if (!f.lodSmall) {
    // Wolkenbäuche unter dem Körper
    const n = clamp(Math.round(w / 34), 2, 6);
    ctx.fillStyle = pal.flPuff;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const hx = hash(p.id * 2.9 + i * 1.7);
      blob(ctx, (w * (i + 0.5)) / n + (hx - 0.5) * 8, h - 3 + hx * 2, (w / n) * 0.52, 6.5 + hx * 3);
    }
    ctx.fill();
  }

  ctx.fillStyle = G(f, 'flBody', mkFlBody);
  ctx.beginPath();
  pill(ctx, 0, 0, w, h, h / 2);
  ctx.fill();

  rimGlow(f, w, 10, 0.42, h / 2);
  ctx.strokeStyle = pal.groundTop;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(h / 2, 1.3);
  ctx.lineTo(w - h / 2, 1.3);
  ctx.stroke();
  ctx.restore();
}

// ---------- bewegliche Plattform ----------

// Bahn der Plattform: breites weiches Band, gestrichelte Linie und Endmarken
function drawTrack(f, p) {
  const ax = num(p.ax);
  const ay = num(p.ay);
  if (Math.abs(ax) + Math.abs(ay) < 2) return;
  const { ctx, pal } = f;
  const h = num(p.h, 16);
  const ox = num(p.ox, p.x);
  const oy = num(p.oy, p.y);
  const x0 = ox - ax + p.w / 2 - f.cam;
  const y0 = oy - ay + h / 2;
  const x1 = ox + ax + p.w / 2 - f.cam;
  const y1 = oy + ay + h / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.accent;
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.6;
  dash(ctx, [3, 7], f.calm ? 0 : -f.t * 8);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  dash(ctx, []);
  // Endmarken
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  disc(ctx, x0, y0, 4);
  disc(ctx, x1, y1, 4);
  ctx.stroke();
  ctx.restore();
}

function drawMoving(f, p) {
  const { ctx, pal } = f;
  const w = p.w;
  const h = num(p.h, 16);
  const x = p.x - f.cam;
  const horizontal = Math.abs(num(p.ax)) >= Math.abs(num(p.ay));
  const dir = horizontal ? Math.sign(num(p.vx)) : Math.sign(num(p.vy));
  ctx.save();
  ctx.translate(x, p.y);

  // Antrieb unter dem Körper: leuchtende Düsen mit kleiner Flamme
  const flick = f.calm ? 0.5 : 0.5 + 0.5 * Math.sin(f.t * 9 + p.id);
  for (let i = 0; i < (f.lodMin ? 0 : 2); i++) {
    const nx = w * (i === 0 ? 0.24 : 0.76);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = 0.22 + 0.1 * flick;
    ctx.beginPath();
    disc(ctx, nx, h + 2, 8);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(nx - 3, h - 1);
    ctx.lineTo(nx, h + 5 + 5 * flick);
    ctx.lineTo(nx + 3, h - 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Körper mit Rahmen in der Akzentfarbe
  ctx.fillStyle = G(f, 'mvBody', mkMvBody);
  ctx.beginPath();
  pill(ctx, 0, 0, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = pal.accentHi;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 1.2);
  ctx.lineTo(w - 8, 1.2);
  ctx.stroke();

  // Doppelpfeil in Bewegungsrichtung, die aktuelle Richtung leuchtet stärker
  const cx = w / 2;
  const cy = h / 2;
  const gap = Math.min(10, w / 5);
  ctx.fillStyle = pal.accentHi;
  for (let side = -1; side <= 1; side += 2) {
    ctx.globalAlpha = dir === side ? 1 : 0.42;
    ctx.beginPath();
    if (horizontal) {
      const bx = cx + side * gap;
      ctx.moveTo(bx + side * 4, cy);
      ctx.lineTo(bx - side * 2.5, cy - 4.2);
      ctx.lineTo(bx - side * 2.5, cy + 4.2);
    } else {
      const bx = cx + side * gap;
      const up = side < 0;
      ctx.moveTo(bx, cy + (up ? -4.4 : 4.4));
      ctx.lineTo(bx - 4.2, cy + (up ? 2.2 : -2.2));
      ctx.lineTo(bx + 4.2, cy + (up ? 2.2 : -2.2));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Lämpchen entlang der Kante
  if (!f.lodSmall) {
    const lights = clamp(Math.floor((w - 40) / 22), 0, 5);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < lights; i++) {
      const lx = w / 2 + (i - (lights - 1) / 2) * 22;
      if (Math.abs(lx - cx) < gap + 8) continue;
      disc(ctx, lx, h - 4.5, 1.5);
    }
    ctx.fill();
  }
  ctx.restore();
}

// ---------- brüchige Plattform ----------

function drawBreakable(f, p) {
  const state = p.state;
  if (state === 'broken') return;
  const alpha = clamp01(num(p.alpha, 1));
  if (alpha <= 0.01) return;
  const { ctx, pal } = f;
  const w = p.w;
  const h = num(p.h, 16);
  const shaking = state === 'shaking';
  const sh = shaking ? num(p.shakeX) * (f.calm ? 0.35 : 1) : 0;
  const x = p.x - f.cam + sh;
  const timer = num(p.timer);
  // Wie weit die Risse schon leuchten: armed schwach, shaking bis voll
  const glow = state === 'armed' ? 0.35 : shaking ? clamp01(0.6 + (timer - 0.4) * 1.2) : 0;

  ctx.save();
  ctx.translate(x, p.y);
  ctx.globalAlpha = alpha;

  // bröckelnde Unterkante
  ctx.fillStyle = pal.brBot;
  ctx.beginPath();
  const teeth = f.lodMin ? 2 : clamp(Math.round(w / 15), 2, 12);
  const seg = (w - 8) / teeth;
  ctx.moveTo(4, h - 3);
  for (let i = 0; i < teeth; i++) {
    const depth = 3 + hash(p.id * 1.9 + i * 2.3) * 5;
    ctx.lineTo(4 + seg * (i + 0.5), h - 1 + depth);
    ctx.lineTo(4 + seg * (i + 1), h - 3);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = G(f, 'brBody', mkBrBody);
  ctx.beginPath();
  pill(ctx, 0, 0, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = pal.rimHi;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(7, 1.3);
  ctx.lineTo(w - 7, 1.3);
  ctx.stroke();

  // Risse, bei armed und shaking von innen leuchtend
  const cracks = f.lodMin ? 1 : clamp(Math.round(w / 38), 2, 6);
  ctx.beginPath();
  for (let i = 0; i < cracks; i++) {
    const cx = (w * (i + 0.5)) / cracks + (hash(p.id * 3.1 + i) - 0.5) * 12;
    const j = hash(p.id * 0.9 + i * 5.3) * 6 - 3;
    ctx.moveTo(cx, 1.5);
    ctx.lineTo(cx + j * 0.4, 5);
    ctx.lineTo(cx - j * 0.5, 9);
    ctx.lineTo(cx + j * 0.3, 12.5);
    ctx.lineTo(cx - j * 0.2, h);
  }
  if (glow > 0) {
    ctx.strokeStyle = pal.accent;
    ctx.globalAlpha = alpha * glow * 0.7;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.strokeStyle = pal.crack;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // Krümel fallen beim Wackeln
  if (shaking && !f.lodMin) {
    ctx.fillStyle = pal.brBot;
    for (let i = 0; i < 3; i++) {
      const k = frac(timer * 2.4 + i * 0.37);
      ctx.fillRect(w * (i + 0.5) / 3 + (hash(p.id + i) - 0.5) * 12, h + 1 + k * 20, 2.6, 2.6);
    }
  }
  // Wiederkehr: heller Schimmer, solange sie einblendet
  if (state === 'idle' && alpha < 0.999) {
    ctx.globalAlpha = (1 - alpha) * 0.7;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    pill(ctx, -1, -1, w + 2, h + 2, 7);
    ctx.fill();
  }
  ctx.restore();
}

// ============================================================
// Zonen
// ============================================================

function drawRainZones(f) {
  const list = f.s.zones || [];
  for (let i = 0; i < list.length; i++) {
    const z = list[i];
    if (!z || z.kind !== 'rain' || !(z.w > 0) || !Number.isFinite(z.x) || !Number.isFinite(z.y)) continue;
    if (!visX(f, z.x, z.x + z.w)) continue;
    drawRain(f, z);
  }
}

function drawRain(f, z) {
  const { ctx } = f;
  const x = z.x - f.cam;
  const y = z.y;
  const w = z.w;
  const inten = clamp01(num(z.intensity));
  const wet = !!z.active || inten > 0;
  const bottom = f.H;
  const cw = clamp(w * 0.86, 110, 270);
  const cx = x + w / 2;

  if (inten > 0.02 && bottom > y) {
    // kaum sichtbarer Schleier mit weichen Rändern: zeigt, wo es rutschig ist
    const hh = (bottom - y) / 2;
    const ry = hh * 1.3;
    ctx.save();
    ctx.translate(cx, y + hh);
    ctx.scale(w * 0.6, ry);
    ctx.globalAlpha = inten;
    ctx.fillStyle = G(f, 'rainVeil', mkRainVeil);
    ctx.fillRect(-1, -hh / ry, 2, (2 * hh) / ry);
    ctx.restore();
  }

  if (wet && bottom > y) {
    const n = Math.round((f.lodMin ? 6 : 10) + (f.lodMin ? 14 : 40) * inten);
    const span = bottom - y + 10;
    const lane = cw - 24;
    ctx.save();
    ctx.strokeStyle = C.rain;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.7;
    ctx.globalAlpha = 0.28 + 0.5 * inten;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const lat = hash(z.id * 1.9 + i * 5.31);
      const spd = RAIN_SPEED * (0.85 + 0.3 * hash(z.id * 0.7 + i * 9.1));
      const v = frac(f.t * spd / span + hash(z.id * 0.37 + i * 2.17));
      const yy = y + 4 + v * span;
      const xx = cx - lane / 2 + frac(lat + ((yy - y) * SLANT) / lane) * lane;
      const len = 7 + 6 * hash(z.id + i * 3.3);
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx - SLANT * len, yy - len);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Die Wolke selbst: ruhend hell und klein, im Regen dunkel und schwer
  const body = mixc(C.rainCloudOff, C.rainCloudOn, wet ? Math.max(0.5, inten) : 0);
  const fall = f.calm ? 0 : Math.sin(f.t * 1.1 + z.id) * 1.2;
  ctx.fillStyle = body;
  ctx.beginPath();
  blob(ctx, cx, y - 9 + fall, cw * 0.46, 9.5);
  blob(ctx, cx - cw * 0.27, y - 14 + fall, cw * 0.2, 12);
  blob(ctx, cx + cw * 0.05, y - 21 + fall, cw * 0.23, 15);
  blob(ctx, cx + cw * 0.28, y - 15 + fall, cw * 0.19, 11.5);
  blob(ctx, cx - cw * 0.42, y - 8 + fall, cw * 0.1, 7);
  blob(ctx, cx + cw * 0.43, y - 7 + fall, cw * 0.1, 6.5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = wet ? 0.1 : 0.2;
  ctx.beginPath();
  blob(ctx, cx - cw * 0.05, y - 26 + fall, cw * 0.16, 7);
  blob(ctx, cx + cw * 0.28, y - 20 + fall, cw * 0.1, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Strecke, die eine Linie mit Richtung (ux, uy) und Seitenversatz side durch ein Feld der Größe w mal h
// (Mitte im Ursprung) läuft, als Bereich [a0, a1] entlang der Richtung. null, wenn sie das Feld verfehlt.
function lineSpan(ux, uy, side, w, h) {
  let a0 = -Infinity;
  let a1 = Infinity;
  const axes = [[ux, -uy * side, w / 2 - 3], [uy, ux * side, h / 2 - 3]]; // Richtung, Versatz, Halbmaß
  for (const [d, off, half] of axes) {
    if (Math.abs(d) < 1e-6) {
      if (Math.abs(off) > half) return null;
      continue;
    }
    const lo = (-half - off) / d;
    const hi = (half - off) / d;
    a0 = Math.max(a0, Math.min(lo, hi));
    a1 = Math.min(a1, Math.max(lo, hi));
  }
  return a1 - a0 > 10 ? [a0, a1] : null;
}

function drawWindZones(f) {
  const list = f.s.zones || [];
  for (let i = 0; i < list.length; i++) {
    const z = list[i];
    if (!z || z.kind !== 'wind' || !(z.w > 0) || !(z.h > 0) || !Number.isFinite(z.x) || !Number.isFinite(z.y)) continue;
    if (!visX(f, z.x, z.x + z.w)) continue;
    drawWind(f, z);
  }
}

function drawWind(f, z) {
  const { ctx, pal } = f;
  const x = z.x - f.cam;
  const w = z.w;
  const h = z.h;
  const dx = num(z.vx) / WIND.MAX_VX;
  const dy = num(z.ay) / WIND.MAX_LIFT;
  const len = Math.hypot(dx, dy);
  const st = clamp01(Math.max(Math.abs(dx), Math.abs(dy)));

  // weiche Fläche
  ctx.save();
  ctx.translate(x + w / 2, z.y + h / 2);
  ctx.scale(w / 2, h / 2);
  ctx.globalAlpha = 0.55 + 0.45 * st;
  ctx.fillStyle = G(f, 'windSoft', mkWindSoft);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (len < 0.02) return;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const lPerp = Math.abs(uy) * w + Math.abs(ux) * h;
  const cx = x + w / 2;
  const cy = z.y + h / 2;
  const count = clamp(Math.round(((w * h) / 7500) * (0.6 + st)), 3, f.lodMin ? 4 : 11);

  // Schlieren: schlanke Windfähnchen, vorn dick und hinten spitz, so ist die Richtung ablesbar.
  // Der Schweif bleibt immer im Feld, die Schliere blendet am Anfang und Ende nur aus.
  ctx.save();
  ctx.fillStyle = pal.mist;
  const bendOn = f.calm ? 0 : 1;
  const wd = 1.3 + 1.2 * st;
  for (let i = 0; i < count; i++) {
    const sd = z.id * 1.31 + i * 7.7;
    const side = (hash(sd) - 0.5) * lPerp * 0.86;
    const span = lineSpan(ux, uy, side, w, h);
    if (!span) continue;
    const room = span[1] - span[0];
    const streak = Math.min(room * 0.55, 24 + 40 * st * (0.6 + 0.8 * hash(sd + 1)));
    const travel = room - streak;
    const speed = (40 + 220 * st) * (0.8 + 0.4 * hash(sd + 2));
    const u = frac((f.t * speed) / travel + hash(sd + 3));
    const along = span[0] + streak + u * travel; // Position des Kopfes
    const hx = cx + ux * along + nx * side;
    const hy = cy + uy * along + ny * side;
    const tx = hx - ux * streak;
    const ty = hy - uy * streak;
    const bend = Math.sin(f.t * 1.7 + i * 2) * 4 * bendOn;
    const mx = (hx + tx) / 2 + nx * bend;
    const my = (hy + ty) / 2 + ny * bend;
    ctx.globalAlpha = Math.pow(Math.sin(Math.PI * u), 0.7) * (0.35 + 0.45 * st);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(mx + nx * wd, my + ny * wd, hx + nx * wd, hy + ny * wd);
    ctx.quadraticCurveTo(hx + ux * wd * 1.4, hy + uy * wd * 1.4, hx - nx * wd, hy - ny * wd);
    ctx.quadraticCurveTo(mx - nx * wd, my - ny * wd, tx, ty);
    ctx.fill();
  }
  // Schwebeteilchen im Wind
  ctx.fillStyle = pal.mist;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 0; i < (f.lodMin ? 0 : 4); i++) {
    const sd = z.id * 0.61 + i * 4.3;
    const side = (hash(sd + 2) - 0.5) * lPerp * 0.9;
    const span = lineSpan(ux, uy, side, w, h);
    if (!span) continue;
    const u = frac((f.t * (30 + 120 * st) * (0.8 + 0.4 * hash(sd))) / (span[1] - span[0]) + hash(sd + 1));
    const along = span[0] + u * (span[1] - span[0]);
    disc(ctx, cx + ux * along + nx * side, cy + uy * along + ny * side, 1.5);
  }
  ctx.fill();
  ctx.restore();
}

// ============================================================
// Stachelwolken
// ============================================================

function drawSpikes(f) {
  const list = f.s.hazards || [];
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (!h || h.kind !== 'spike' || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
    const w = num(h.w, SPIKE.w);
    if (!visX(f, h.x - 10, h.x + w + 10)) continue;
    drawSpike(f, h, w, num(h.h, SPIKE.h));
  }
}

function drawSpike(f, haz, w, h) {
  const { ctx } = f;
  const cx = w / 2;
  const cy = h - 9; // Mitte des Stachelkranzes
  const N = 7;
  const step = Math.PI / N;
  ctx.save();
  ctx.translate(haz.x - f.cam, haz.y);

  // Kranz aus elektrisch gelben Stacheln, fächert nach oben und zu den Seiten
  const tipX = [];
  const tipY = [];
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = Math.PI + (i + 0.5) * step;
    const r = i === 3 ? 20 : i % 2 === 0 ? 17 : 14.5;
    const tx = cx + Math.cos(a) * r * (w / 36);
    const ty = cy + Math.sin(a) * r;
    tipX.push(tx);
    tipY.push(ty);
    const v = a - step / 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(v) * 8, cy + Math.sin(v) * 8);
    else ctx.lineTo(cx + Math.cos(v) * 8, cy + Math.sin(v) * 8);
    ctx.lineTo(tx, ty);
  }
  ctx.lineTo(cx + Math.cos(2 * Math.PI) * 8, cy);
  ctx.closePath();
  ctx.lineJoin = 'round';
  if (!f.lodMin) {
    ctx.strokeStyle = 'rgba(255,233,74,0.28)';
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.fillStyle = C.spike;
  ctx.fill();
  ctx.strokeStyle = C.spikeEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // dunkler Wolkenkörper
  ctx.fillStyle = C.spikeBody;
  ctx.beginPath();
  blob(ctx, cx, h - 6.5, w * 0.5 - 3, 6.5);
  blob(ctx, cx - 8, h - 10, 8, 6.5);
  blob(ctx, cx + 7, h - 11, 9, 7.5);
  blob(ctx, cx, h - 13.5, 8, 6.5);
  ctx.fill();
  ctx.fillStyle = C.spikeBodyHi;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  blob(ctx, cx - 4, h - 17, 5, 2.2);
  blob(ctx, cx + 9, h - 15, 3, 1.8);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Blitzzeichen auf dem Körper: auch ohne Farbe als Gefahr lesbar
  ctx.fillStyle = C.spike;
  ctx.beginPath();
  ctx.moveTo(cx + 2.2, h - 15.5);
  ctx.lineTo(cx - 3.2, h - 8);
  ctx.lineTo(cx - 0.2, h - 8);
  ctx.lineTo(cx - 2.2, h - 2.5);
  ctx.lineTo(cx + 3.6, h - 10);
  ctx.lineTo(cx + 0.6, h - 10);
  ctx.closePath();
  ctx.fill();

  // Knistern: ein kurzer Funkenbogen zwischen zwei Spitzen, dazu ein Funke darüber
  if (!f.calm && !f.lodMin) {
    const beat = Math.floor(f.time * 9 + haz.id * 1.7);
    if (hash(beat * 3.1 + haz.id) > 0.38) {
      const k = Math.floor(hash(beat + haz.id * 0.3) * (N - 1));
      const mx = (tipX[k] + tipX[k + 1]) / 2 + (hash(beat * 1.3) - 0.5) * 4;
      const my = Math.min(tipY[k], tipY[k + 1]) - 3 - hash(beat * 2.7) * 3;
      ctx.strokeStyle = '#fffbe0';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipX[k], tipY[k]);
      ctx.lineTo(mx, my);
      ctx.lineTo(tipX[k + 1], tipY[k + 1]);
      ctx.stroke();
    }
    const j = Math.floor(hash(beat * 0.7 + haz.id) * N);
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    disc(ctx, tipX[j] + (hash(beat) - 0.5) * 4, tipY[j] - 4 - 3 * hash(beat * 1.9), 1.2);
    ctx.fill();
  }
  ctx.restore();
}

// ============================================================
// Blitze
// ============================================================

// Oberkante des höchsten Bodens unter der Säule, dort schlägt der Blitz auf
function impactY(f, h) {
  if (h.groundY > 0) return h.groundY;
  const x0 = h.x - num(h.w, 56) / 2;
  const x1 = h.x + num(h.w, 56) / 2;
  const top = num(h.cloudY, LIGHTNING.CLOUD_Y);
  let best = f.H - 10;
  const list = f.s.platforms || [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!platOk(p)) continue;
    if (p.x >= x1 || p.x + p.w <= x0) continue;
    if (p.y > top && p.y < best) best = p.y;
  }
  return best;
}

function drawLightning(f) {
  const list = f.s.hazards || [];
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (!h || h.kind !== 'lightning' || !Number.isFinite(h.x)) continue;
    if (!visX(f, h.x - 80, h.x + 80)) continue;
    drawBolt(f, h);
  }
}

function drawBolt(f, h) {
  const { ctx } = f;
  const x = h.x - f.cam;
  const cy = num(h.cloudY, LIGHTNING.CLOUD_Y);
  const w = num(h.w, LIGHTNING.WIDTH);
  const phase = h.phase;
  const charge = clamp01(num(h.charge));
  const warn = phase === 'glow' || phase === 'flicker';
  const strike = phase === 'strike';
  const cool = phase === 'cooldown';
  const iy = impactY(f, h);
  // Einschalten im Flackern: schneller, unregelmäßiger Wechsel (bei reduceMotion dauerhaft an)
  const on = f.calm || hash(Math.floor(f.time * 22) + h.id * 3.7) > 0.32;
  const flick = phase === 'flicker' ? (on ? 1 : 0.3) : 1;
  // Stärke der Markierung am Boden: leise bei glow, kräftig bei flicker und strike
  const mark = strike ? 1 : phase === 'flicker' ? 0.85 + 0.15 * flick : phase === 'glow' ? 0.3 + 0.35 * clamp01(charge / 0.8) : 0;

  if (warn || strike) drawColumn(f, h, x, cy, w, iy, mark, strike, flick);
  if (strike) drawStrikeBolt(f, h, x, cy, iy);

  // Wolke
  ctx.save();
  ctx.translate(x + (phase === 'flicker' && !f.calm ? (hash(Math.floor(f.time * 30) + h.id) - 0.5) * 2.4 : 0), cy);
  drawThunderCloud(f, h, charge, strike, cool, flick);
  ctx.restore();
}

// Einschlagsäule: gestrichelte Ränder, Schein, Warnmarke am Boden
function drawColumn(f, h, x, cy, w, iy, mark, strike, flick) {
  const { ctx } = f;
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const bottom = f.H;
  const top = cy + 8;
  ctx.save();

  // Schein der Säule
  const body = strike ? 0.34 : h.phase === 'flicker' ? 0.1 + 0.08 * flick : 0;
  if (body > 0) {
    ctx.save();
    ctx.translate(x0, top);
    ctx.scale(w, bottom - top);
    ctx.globalAlpha = body;
    ctx.fillStyle = G(f, 'column', mkColumn);
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
  }

  // gestrichelte Ränder, laufen nach unten (bei reduceMotion still)
  ctx.globalAlpha = strike ? 0.9 : 0.14 + 0.5 * mark;
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'butt';
  dash(ctx, [7, 6], f.calm ? 0 : -f.time * 40);
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x0, bottom);
  ctx.moveTo(x1, top);
  ctx.lineTo(x1, bottom);
  ctx.stroke();
  dash(ctx, []);

  // Warnmarke am Boden: flacher Zielring und Zacken
  ctx.globalAlpha = Math.min(1, mark);
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2;
  dash(ctx, [6, 4], f.calm ? 0 : f.time * 24);
  ctx.beginPath();
  ctx.ellipse(x, iy, w / 2, 6, 0, 0, TAU);
  ctx.stroke();
  dash(ctx, []);
  ctx.fillStyle = C.warn;
  ctx.beginPath();
  const teeth = 4;
  const tw = (w - 8) / teeth;
  for (let i = 0; i < teeth; i++) {
    const bx = x0 + 4 + i * tw;
    ctx.moveTo(bx, iy - 1);
    ctx.lineTo(bx + tw / 2, iy - 9 - (strike ? 3 : 0));
    ctx.lineTo(bx + tw, iy - 1);
  }
  ctx.fill();

  // Warndreieck mit Ausrufezeichen über dem Ziel
  if (mark > 0.4 && !strike) {
    const bob = f.calm ? 0 : Math.sin(f.time * 7) * 2;
    const ty = iy - 36 + bob;
    const s = h.phase === 'glow' ? 0.8 : 1;
    ctx.globalAlpha = Math.min(1, (mark - 0.3) * 1.6);
    ctx.lineJoin = 'round';
    ctx.fillStyle = C.warn;
    ctx.strokeStyle = C.warnDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, ty - 10 * s);
    ctx.lineTo(x + 11 * s, ty + 8 * s);
    ctx.lineTo(x - 11 * s, ty + 8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(x, ty - 3.5 * s);
    ctx.lineTo(x, ty + 1.8 * s);
    ctx.moveTo(x, ty + 5 * s);
    ctx.lineTo(x, ty + 5.1 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStrikeBolt(f, h, x, cy, iy) {
  const { ctx } = f;
  const top = cy + 6;
  const bottom = Math.max(top + 20, iy);
  const n = Math.max(3, Math.ceil((bottom - top) / 26));
  const seed = h.id * 11.3 + (f.calm ? 0 : Math.floor(f.time * 24));
  const px = [];
  const py = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const off = i === 0 || i === n ? 0 : (hash(seed + i * 5.7) - 0.5) * 22;
    px.push(x + off);
    py.push(top + (bottom - top) * k);
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px[0], py[0]);
  for (let i = 1; i <= n; i++) ctx.lineTo(px[i], py[i]);
  // zwei kurze Seitenäste
  for (let b = 0; b < 2; b++) {
    const i = Math.max(1, Math.round(n * (b === 0 ? 0.35 : 0.68)));
    const dir = hash(seed + b * 3.3) > 0.5 ? 1 : -1;
    ctx.moveTo(px[i], py[i]);
    ctx.lineTo(px[i] + dir * 11, py[i] + 12);
    ctx.lineTo(px[i] + dir * 17, py[i] + 26);
  }
  ctx.strokeStyle = 'rgba(255,236,120,0.22)';
  ctx.lineWidth = 17;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,246,170,0.8)';
  ctx.lineWidth = 7;
  ctx.shadowColor = 'rgba(255,240,140,0.95)';
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C.boltCore;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // Einschlag: heller Fleck und Funken
  ctx.translate(x, iy);
  ctx.scale(44, 28);
  ctx.fillStyle = G(f, 'flash', mkFlash);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.save();
  ctx.translate(x, iy);
  ctx.strokeStyle = C.boltCore;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = -Math.PI * (0.1 + 0.8 * (j / 5));
    const r0 = 6;
    const r1 = 15 + 10 * hash(seed + j * 2.1);
    ctx.moveTo(Math.cos(a) * r0 * 1.4, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1 * 1.4, Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

// Gewitterwolke im Ursprung (Unterkante bei y = 10). charge 0..1 leuchtet von innen.
function drawThunderCloud(f, h, charge, strike, cool, flick) {
  const { ctx } = f;
  const timer = num(h.timer);
  const coolK = cool ? clamp01(timer / Math.max(0.1, LIGHTNING.COOLDOWN)) : 0;

  // Dampf beim Abkühlen: weiche blasse Wölkchen steigen auf
  if (cool && coolK > 0.02) {
    ctx.fillStyle = G(f, 'steam', mkSteam);
    for (let i = 0; i < 4; i++) {
      const k = 1 - coolK;
      ctx.save();
      ctx.translate((i - 1.5) * 24 + Math.sin(f.t * 2 + i) * 3, -34 - k * 20 - i * 3);
      ctx.scale(14 + k * 6, 9 + k * 4);
      ctx.globalAlpha = coolK * 0.5;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  const lit = strike ? 1 : cool ? coolK * 0.35 : charge * flick;
  // Körper
  ctx.beginPath();
  blob(ctx, 0, -4, 52, 14);
  blob(ctx, -32, -10, 22, 15);
  blob(ctx, -12, -22, 24, 19);
  blob(ctx, 14, -20, 26, 20);
  blob(ctx, 36, -9, 21, 14);
  blob(ctx, -53, -2, 12, 9);
  blob(ctx, 55, -1, 11, 8);
  ctx.fillStyle = G(f, 'stormBody', (c) => vertical(c, -42, 12, [0, C.stormTop, 0.55, mixc(C.stormTop, C.stormBot, 0.55), 1, C.stormBot]));
  ctx.fill();
  if (lit > 0.01) {
    // Licht von innen: die Wolke wird auf ihrer eigenen Form heller
    ctx.save();
    ctx.clip();
    ctx.translate(0, -2);
    ctx.scale(70, 34);
    ctx.globalAlpha = clamp01(lit * 0.95);
    ctx.fillStyle = G(f, 'cloudGlow', mkCloudGlow);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  // Glanz oben und dunkle Unterkante für Volumen
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  blob(ctx, -12, -30, 16, 6);
  blob(ctx, 16, -28, 17, 6);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Kleiner Blitz im Bauch der Wolke: Form statt Farbe als Vorwarnung
  if (h.phase === 'flicker' || strike) {
    ctx.fillStyle = C.bolt;
    ctx.globalAlpha = strike ? 1 : flick;
    ctx.beginPath();
    ctx.moveTo(4, -22);
    ctx.lineTo(-7, -6);
    ctx.lineTo(-1, -6);
    ctx.lineTo(-5, 9);
    ctx.lineTo(8, -10);
    ctx.lineTo(2, -10);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (h.phase === 'glow') {
    // schwaches Pulsieren der Kontur
    ctx.strokeStyle = C.warn;
    ctx.globalAlpha = 0.25 + 0.4 * clamp01(charge / 0.8);
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(3, -20);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-1, -6);
    ctx.lineTo(-4, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// Sterne
// ============================================================

function starGroup(st) {
  return st.bonus === 'risk' ? 'risk' : st.bonus === 'event' ? 'event' : 'normal';
}

// Mitte, Größe und Drehung eines Sterns in Bildkoordinaten
function starPose(f, st, group, out) {
  const ph = num(st.phase);
  const calm = f.calm;
  const r0 = STAR_RADIUS[group];
  out.x = st.x - f.cam;
  out.y = st.y + (calm ? 0 : Math.sin(f.t * 2.2 + ph) * 2.5);
  out.r = r0 * (calm ? 1 : 1 + 0.1 * Math.sin(f.t * 3.2 + ph * 1.7));
  out.rot = calm ? 0 : Math.sin(f.t * 1.4 + ph) * 0.12;
}

function drawStars(f) {
  const list = f.s.stars || [];
  if (!list.length) return;
  // Sichtbare Sterne einmal nach Art einsammeln
  const groups = { normal: [], risk: [], event: [] };
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    if (!st || st.got || !Number.isFinite(st.x) || !Number.isFinite(st.y) || !visX(f, st.x - 20, st.x + 20)) continue;
    groups[starGroup(st)].push(st);
  }
  const pose = { x: 0, y: 0, r: 0, rot: 0 };
  // Spuren fallender Sterne unter allen Körpern
  if (!f.lodMin) {
    for (const group of GROUPS) {
      for (const st of groups[group]) {
        if (!st.falling) continue;
        starPose(f, st, group, pose);
        drawTrail(f, st, pose);
      }
    }
  }
  for (const group of GROUPS) if (groups[group].length) drawStarGroup(f, groups[group], group, pose);
}

function drawTrail(f, st, pose) {
  const { ctx } = f;
  const started = !!st.started;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(pose.r * 0.55, started ? 24 + clamp(num(st.vy), 0, 400) * 0.16 : 9);
  ctx.globalAlpha = started ? 1 : 0.6;
  ctx.fillStyle = G(f, 'trail', mkTrail);
  ctx.beginPath();
  ctx.moveTo(-1, 0);
  ctx.lineTo(0, -1);
  ctx.lineTo(1, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const GROUPS = ['normal', 'risk', 'event'];
const STAR_STYLE = {
  normal: { fill: C.star, halo: 'rgba(255,217,102,', hi: C.starHi, glint: '#fffbe0', wide: 10 },
  risk: { fill: C.risk, halo: 'rgba(255,170,40,', hi: '#fff2c4', glint: '#fffbe0', wide: 13 },
  event: { fill: C.event, halo: 'rgba(170,240,255,', hi: '#ffffff', glint: '#e9fbff', wide: 10 },
};

// Alle Sterne einer Art in wenigen Pfaden: Körper, Glanzpunkte, Funkeln, Aura
function drawStarGroup(f, stars, group, pose) {
  const { ctx } = f;
  const style = STAR_STYLE[group];
  ctx.beginPath();
  for (const st of stars) {
    starPose(f, st, group, pose);
    pentagram(ctx, pose.x, pose.y, pose.r, pose.rot);
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `${style.halo}0.1)`;
  ctx.lineWidth = style.wide;
  ctx.stroke();
  ctx.strokeStyle = `${style.halo}0.22)`;
  ctx.lineWidth = style.wide * 0.6;
  ctx.stroke();
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.fill;
  ctx.lineWidth = group === 'risk' ? 3.6 : 2.6;
  ctx.fill();
  ctx.stroke();
  if (f.lodSmall) return;

  // Glanzpunkt in der Mitte
  ctx.fillStyle = style.hi;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (const st of stars) {
    starPose(f, st, group, pose);
    disc(ctx, pose.x - pose.r * 0.12, pose.y - pose.r * 0.08, pose.r * 0.2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  // Funkeln: ein kleines Kreuz, das bei jedem Stern zu seiner eigenen Zeit aufblitzt.
  // Eventsterne und Risikosterne funkeln immer ein wenig, auch bei reduceMotion (dann ohne Wechsel).
  ctx.strokeStyle = style.glint;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let sp = 0;
  for (const st of stars) {
    const ph = num(st.phase);
    let k;
    if (f.calm) k = group === 'normal' ? 0 : 0.6;
    else k = clamp01((Math.sin(f.t * 3.6 + ph * 3.1) - 0.5) * 2) + (group === 'normal' ? 0 : 0.25);
    if (k < 0.05) continue;
    starPose(f, st, group, pose);
    const L = (pose.r * 0.7 + 2.5) * Math.min(1, k);
    const cx = pose.x + pose.r * 0.55;
    const cy = pose.y - pose.r * 0.62;
    ctx.moveTo(cx - L, cy);
    ctx.lineTo(cx + L, cy);
    ctx.moveTo(cx, cy - L);
    ctx.lineTo(cx, cy + L);
    sp++;
  }
  if (sp) ctx.stroke();

  // Aura der Risikosterne
  if (group === 'risk') {
    ctx.fillStyle = G(f, 'gold', mkGold);
    for (const st of stars) {
      starPose(f, st, group, pose);
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.scale(pose.r * 2.6, pose.r * 2.6);
      ctx.globalAlpha = f.calm ? 0.8 : 0.65 + 0.35 * Math.sin(f.t * 2.6 + num(st.phase));
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }
}

// ============================================================
// Powerups
// ============================================================

function drawPowerups(f) {
  const list = f.s.powerups || [];
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u || u.got || !Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
    if (!visX(f, u.x - 30, u.x + 30)) continue;
    drawPowerup(f, u);
  }
}

function drawPowerup(f, u) {
  const { ctx } = f;
  const def = POWERUPS[u.type];
  const color = def ? def.color : '#ffffff';
  const ph = num(u.phase);
  const bob = f.calm ? 0 : Math.sin(f.t * 2.4 + ph) * 3.2;
  const glow = f.calm ? 0.75 : 0.7 + 0.3 * Math.sin(f.t * 3 + ph);
  const R = 18;
  ctx.save();
  ctx.translate(u.x - f.cam, u.y + bob);

  // Glühen
  ctx.save();
  ctx.scale(R * 2.3, R * 2.3);
  ctx.globalAlpha = 0.55 * glow;
  ctx.fillStyle = G(f, `pu${u.type}`, (c) => unitRadial(c, [0, tint(color, 0.8), 0.5, tint(color, 0.28), 1, tint(color, 0)]));
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();

  // Blase
  ctx.fillStyle = tint(color, 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R - 4, Math.PI * 1.08, Math.PI * 1.45);
  ctx.stroke();

  if (u.type === 'shield') shieldSymbol(ctx);
  else if (u.type === 'dash') rainbowSymbol(ctx);
  else if (u.type === 'magnet') magnetSymbol(ctx);
  else if (u.type === 'feather') featherSymbol(ctx);
  ctx.restore();
}

function shieldSymbol(ctx) {
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
  ctx.strokeStyle = '#2aa7c9';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.fillStyle = '#6fd6f0';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6.6, -5.8);
  ctx.quadraticCurveTo(6.8, 2.2, 0, 8);
  ctx.closePath();
  ctx.fill();
}

function rainbowSymbol(ctx) {
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
  blob(ctx, -9, 6, 4.6, 3);
  blob(ctx, 9, 6, 4.6, 3);
  ctx.fill();
}

function magnetSymbol(ctx) {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#ffc928';
  ctx.lineWidth = 5.4;
  ctx.beginPath();
  ctx.moveTo(-7, -7);
  ctx.lineTo(-7, 1);
  ctx.arc(0, 1, 7, Math.PI, 0, true);
  ctx.lineTo(7, -7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-8.4, -5);
  ctx.lineTo(-8.4, 1.5);
  ctx.stroke();
  ctx.fillStyle = '#eef2ff';
  ctx.fillRect(-9.7, -10.5, 5.4, 4.4);
  ctx.fillRect(4.3, -10.5, 5.4, 4.4);
  ctx.strokeStyle = '#fff3b0';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2.4, -9);
  ctx.lineTo(-2.4, -12.6);
  ctx.moveTo(2.4, -9);
  ctx.lineTo(2.4, -12.6);
  ctx.stroke();
}

function featherSymbol(ctx) {
  ctx.beginPath();
  ctx.moveTo(-7, 10);
  ctx.quadraticCurveTo(-11, -4, 6, -11);
  ctx.quadraticCurveTo(11, 0, -7, 10);
  ctx.closePath();
  ctx.fillStyle = '#e1d6ff';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#8c74e0';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, 11.5);
  ctx.lineTo(4, -7);
  ctx.moveTo(-2, 3.4);
  ctx.lineTo(-6.5, -2.6);
  ctx.moveTo(1, -1.6);
  ctx.lineTo(-2.6, -7.2);
  ctx.moveTo(-3.6, 6.2);
  ctx.lineTo(3.8, 5.6);
  ctx.moveTo(0, 0.2);
  ctx.lineTo(6.6, -0.4);
  ctx.stroke();
}

// ============================================================
// Traumtore
// ============================================================

// Wie sehr das Tor noch leuchtet. Nach dem Durchlaufen verblasst es mit dem Abstand des Spielers.
function gateFade(f, g) {
  if (!g.passed) return 1;
  const p = f.s.player;
  const d = p ? p.x + p.w / 2 - g.x : 0;
  return 1 - 0.84 * smooth(num(d) / 320);
}

function drawGates(f, front) {
  const list = f.s.gates || [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const w = num(g.w, 120);
    if (!visX(f, g.x - w / 2 - 50, g.x + w / 2 + 50)) continue;
    drawGate(f, g, front);
  }
}

function drawGate(f, g, front) {
  const { ctx } = f;
  const fade = gateFade(f, g);
  const gw = num(g.w, 120);
  const gh = num(g.h, 190);
  const cx = g.x - f.cam;
  const cy = g.y - gh / 2;
  const rx = gw / 2 - 6;
  const ry = gh / 2 - 6;
  const ph = num(g.index);
  const pulse = f.calm ? 0.5 : 0.5 + 0.5 * Math.sin(f.time * 1.7 + ph * 1.3);
  const ring = fade * (0.85 + 0.15 * pulse);

  ctx.save();
  if (!front) {
    // Boden: Lichtfleck unter dem Tor
    ctx.save();
    ctx.translate(cx, g.y);
    ctx.scale(rx * 1.15, 10);
    ctx.globalAlpha = fade * (0.6 + 0.3 * pulse);
    ctx.fillStyle = G(f, 'gateBase', mkGateBase);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    // Schein um den Ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx + 40 + 6 * pulse, ry + 40 + 6 * pulse);
    ctx.globalAlpha = fade;
    ctx.fillStyle = G(f, 'gateAura', mkGateAura);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    // Inneres: sanfter Verlauf und langsame Wirbel
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    ctx.globalAlpha = fade;
    ctx.fillStyle = G(f, 'gateIn', mkGateIn);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#fff6d6';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const k = 0.42 + i * 0.17;
      const a = f.t * (0.5 + i * 0.22) + i * 2.1;
      ctx.globalAlpha = fade * (0.34 - i * 0.07);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * k, ry * k, 0, a, a + 1.5);
      ctx.stroke();
    }

    // Ring aus mehreren Schichten: weicher Hof, Körper und heller Kern
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.strokeStyle = '#ffd98a';
    ctx.globalAlpha = 0.12 * ring;
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.globalAlpha = 0.3 * ring;
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = '#fff1c4';
    ctx.globalAlpha = 0.85 * ring;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = ring;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.strokeStyle = '#fff1c4';
    ctx.globalAlpha = 0.5 * ring;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 8, ry + 8, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 8, ry - 8, 0, 0, TAU);
    ctx.stroke();
  } else {
    // Lichtkante auf der Vorderseite und kreisende Sterne vor dem Ring
    ctx.globalAlpha = 0.6 * ring;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.62, Math.PI * 0.98);
    ctx.stroke();
  }

  // Sterne und Funken, die den Ring umkreisen: ein Teil hinten, ein Teil vorn
  if (fade > 0.25) {
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath();
    let any = false;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const th = f.t * 0.7 + (i * TAU) / n + ph;
      const isFront = Math.sin(th) > 0;
      if (isFront !== front) continue;
      const sx = cx + (rx + 12) * Math.cos(th);
      const sy = cy + ry * 0.82 * Math.sin(i * 2.4 + f.t * 0.5 + ph);
      const r = 3.4 + 2.6 * hash(i * 3.7 + ph);
      sparkle(ctx, sx, sy, r * (f.calm ? 1 : 0.8 + 0.4 * Math.sin(f.t * 5 + i)));
      any = true;
    }
    ctx.globalAlpha = fade * (front ? 1 : 0.7);
    if (any) ctx.fill();
  }
  if (front && fade > 0.25) {
    // aufsteigende Lichtfunken im Inneren
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const u = frac(f.t * (0.12 + 0.05 * hash(i * 2.3 + ph)) + hash(i * 5.9 + ph));
      const sx = cx + (hash(i * 1.7 + ph) - 0.5) * rx * 1.3;
      const sy = g.y - 6 - u * (gh - 14);
      disc(ctx, sx, sy, 1.1 + hash(i * 4.4) * 1.1);
    }
    ctx.globalAlpha = fade * 0.8;
    ctx.fill();
  }
  ctx.restore();
}

// ============================================================
// Debug: Hitboxen und IDs
// ============================================================

function drawDebug(f) {
  const { ctx } = f;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.strokeStyle = '#7dff9b';
  ctx.fillStyle = '#7dff9b';
  for (const p of f.s.platforms || []) {
    if (!platOk(p)) continue;
    if (!visX(f, p.x, p.x + p.w)) continue;
    if (p.kind === 'breakable' && p.state === 'broken') continue;
    const x = p.x - f.cam;
    ctx.strokeRect(x + 0.5, p.y + 0.5, p.w - 1, Math.min(num(p.h, 16), f.H - p.y) - 1);
    ctx.fillText(`#${p.id}`, x + 3, p.y - 3);
  }

  ctx.strokeStyle = '#ff6b6b';
  ctx.fillStyle = '#ff6b6b';
  for (const h of f.s.hazards || []) {
    if (!h || !Number.isFinite(h.x)) continue;
    if (h.kind === 'spike') {
      if (!visX(f, h.x, h.x + h.w)) continue;
      ctx.strokeRect(h.x - f.cam + 6.5, h.y + 8.5, h.w - 13, h.h - 9);
    } else if (h.kind === 'lightning') {
      if (!visX(f, h.x - 40, h.x + 40)) continue;
      const cy = num(h.cloudY, LIGHTNING.CLOUD_Y);
      const w = num(h.w, LIGHTNING.WIDTH);
      ctx.strokeRect(h.x - f.cam - w / 2 + 0.5, cy + 0.5, w - 1, f.H - cy - 1);
      ctx.fillText(`#${h.id} ${h.phase}`, h.x - f.cam - w / 2 + 3, cy + 22);
    }
  }

  ctx.strokeStyle = '#7dc8ff';
  ctx.fillStyle = '#7dc8ff';
  for (const z of f.s.zones || []) {
    if (!z || !(z.w > 0) || !Number.isFinite(z.x)) continue;
    if (!visX(f, z.x, z.x + z.w)) continue;
    const bottom = z.kind === 'rain' ? f.H : z.y + z.h;
    ctx.strokeRect(z.x - f.cam + 0.5, z.y + 0.5, z.w - 1, bottom - z.y - 1);
    ctx.fillText(`#${z.id} ${z.kind}`, z.x - f.cam + 3, z.y + 12);
  }
  ctx.restore();
}
