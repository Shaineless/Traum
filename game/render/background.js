// Hintergrund: Himmelsverlauf und vier Parallax Ebenen aus Canvas Formen.
//
// Ebene 1: Sterne (Faktor 0,03), Ebene 2: Wolkenbänder (0,12),
// Ebene 3: Mond, Wolkenberge (0,25) und Nebel (0,18), Ebene 4: Glühwürmchen (0,5).
// Alle Elemente stammen aus festen Tabellen (Seed in game/rng.js, beim Laden gebaut)
// oder sind reine Funktionen von view.time und view.camX. Es gibt keinen Zustand
// außerhalb von s und view. Der Hintergrund bleibt bewusst kontrastarm.

import { H as H0, W as W0 } from '../constants.js';
import { eventEnvelope } from '../events.js';
import { rand, seedRng } from '../rng.js';
import { themeAt } from '../theme.js';

const TAU = Math.PI * 2;

const PAR = { STARS: 0.03, CLOUDS: 0.12, MOON: 0.015, MOUNTAINS: 0.25, MIST: 0.18, FIREFLY: 0.5, SHOWER: 0.06 };
const MOON = { X: 0.74, Y: 0.21, R: 40, SWAY: 70, GROW: 0.7 }; // Supermond wächst bis Faktor 1,7
const STORM = { DIM: 0.26, SLANT: -0.45, VEILS: 6 };

// ---------- Farbhilfen ----------

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

// Gleiche Farbe, Alpha mit k multipliziert (auch über 1 hinaus, begrenzt auf 1)
function tint(c, k) {
  const p = parseColor(c);
  return `rgba(${p[0] | 0},${p[1] | 0},${p[2] | 0},${+Math.min(1, Math.max(0, p[3] * k)).toFixed(3)})`;
}

// Mischung zweier Farben ohne Alpha
function mixc(a, b, k) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  const v = pa.map((x, i) => x + (pb[i] - x) * k);
  return `rgb(${v[0] | 0},${v[1] | 0},${v[2] | 0})`;
}

// Weicher Fleck mit Radius 1 im Ursprung. Mit setLocal wird er auf jede Größe gezogen,
// so braucht eine ganze Ebene nur einen Verlauf.
function softBlob(ctx, color, k, mid = 0.5) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, tint(color, k));
  g.addColorStop(0.45, tint(color, k * mid));
  g.addColorStop(1, tint(color, 0));
  return g;
}

// Setzt die Matrix base mal local (beides [a, b, c, d, e, f]). So kostet jeder Fleck nur
// zwei Aufrufe (setTransform und fillRect) statt vier mit save und restore.
function setLocal(ctx, m, la, lb, lc, ld, le, lf) {
  ctx.setTransform(
    m.a * la + m.c * lb, m.b * la + m.d * lb,
    m.a * lc + m.c * ld, m.b * lc + m.d * ld,
    m.a * le + m.c * lf + m.e, m.b * le + m.d * lf + m.f,
  );
}

function resetMatrix(ctx, m) {
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}

function baseMatrix(ctx) {
  const m = ctx.getTransform ? ctx.getTransform() : null;
  return m && Number.isFinite(m.a + m.b + m.c + m.d + m.e + m.f) ? m : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

// Zeichnet den weichen Einheitsfleck als Ellipse mit den Radien rx, ry um (x, y)
function stamp(ctx, m, x, y, rx, ry) {
  setLocal(ctx, m, rx, 0, 0, ry, x, y);
  ctx.fillRect(-1, -1, 2, 2);
}

// ---------- Zahlenhilfen ----------

const mod = (a, n) => ((a % n) + n) % n;
// Bildschirmposition eines Elements mit halber Breite m auf einer Spur der Länge p (p = W + 2 m)
const wrapX = (x, m, p) => mod(x + m, p) - m;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const hash = (n) => { const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };

// ---------- feste Tabellen ----------

const dec = { rng: 0 };
seedRng(dec, 7741);
const rnd = (a = 0, b = 1) => a + rand(dec) * (b - a);

// Ebene 1: Sterne. kind 0 winzig, 1 klein, 2 mittel, 3 funkelnd mit Strahlen
const STAR_M = 12;
const STAR_P = W0 + STAR_M * 2;
const STARS = [];
function addStars(n, kind, a0, a1) {
  for (let i = 0; i < n; i++) {
    STARS.push({ x: rnd(0, STAR_P), y: 4 + H0 * 0.68 * Math.pow(rnd(), 1.3), kind, a: rnd(a0, a1), ph: rnd(0, TAU), sp: rnd(0.8, 2.6), r: rnd(4, 7) });
  }
}
addStars(38, 0, 0.3, 0.7);
addStars(18, 1, 0.4, 0.8);
addStars(7, 2, 0.5, 0.9);
addStars(4, 3, 0.75, 1);

// Sternschauer: zusätzliche Sterne, die mit der Hüllkurve nach und nach erscheinen
const SHOWER_P = W0 + 20;
const SHOWER_STARS = [];
for (let i = 0; i < 44; i++) {
  SHOWER_STARS.push({ x: rnd(0, SHOWER_P), y: 6 + H0 * 0.62 * Math.pow(rnd(), 1.1), r: rnd(1, 2), a: rnd(0.55, 1), ph: rnd(0, TAU), sp: rnd(2.2, 5), spark: i % 4 === 0 });
}

// Ebene 2: Wolkenbänder aus flachen weichen Flecken
const CLOUD_M = 190;
const CLOUD_P = W0 + CLOUD_M * 2;
const BANDS = [
  { y: 84, a: 1.3, v: 5, n: 3 },
  { y: 168, a: 1.5, v: 8, n: 4 },
  { y: 238, a: 1.4, v: 12, n: 3 },
].map((b) => ({
  ...b,
  clouds: Array.from({ length: b.n }, (_, i) => {
    const s = rnd(0.85, 1.35);
    return {
      x: (i + rnd(0.1, 0.9)) * (CLOUD_P / b.n),
      s,
      ph: rnd(0, TAU),
      blobs: [
        { dx: 0, dy: 0, rx: 105 * s, ry: 24 * s },
        { dx: -68 * s, dy: 5 * s, rx: 70 * s, ry: 17 * s },
        { dx: 58 * s, dy: -7 * s, rx: 78 * s, ry: 21 * s },
      ],
    };
  }),
}));

// Ebene 3: Wolkenberge aus Kreisen, zwei Schichten. base ist die Linie, auf der die Kreise sitzen.
const MTN_M = 230;
const MTN_P = W0 + MTN_M * 2;
function makeMountains(n, base, rMin, rMax, spread) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const circles = [];
    const cnt = 4 + Math.floor(rnd(0, 3));
    for (let k = 0; k < cnt; k++) {
      const dx = (k / (cnt - 1) - 0.5) * 2 * spread * rnd(0.8, 1);
      const mid = 1 - Math.abs(dx) / (spread * 1.1);
      const r = rnd(rMin, rMax) * (0.7 + 0.45 * mid);
      circles.push({ dx, dy: -r * 0.3 - mid * rnd(8, 26), r });
    }
    out.push({ x: (i + rnd(0.1, 0.9)) * (MTN_P / n), circles, hw: spread + rMax });
  }
  return out;
}
const MOUNTAINS = [
  { base: 318, factor: PAR.MOUNTAINS * 0.7, top: 0.24, clusters: makeMountains(7, 318, 28, 52, 100) },
  { base: 356, factor: PAR.MOUNTAINS, top: 0.34, clusters: makeMountains(8, 356, 22, 42, 90) },
];

// Nebelbänder
const MIST_M = 330;
const MIST_P = W0 + MIST_M * 2;
const MIST = Array.from({ length: 6 }, (_, i) => ({
  x: (i + rnd(0.1, 0.9)) * (MIST_P / 6), y: H0 * rnd(0.6, 0.9), rx: rnd(210, 330), ry: rnd(26, 46), v: rnd(-7, 9), ph: rnd(0, TAU),
}));

// Ebene 4: Glühwürmchen
const FLY_M = 24;
const FLY_P = W0 + FLY_M * 2;
const FIREFLIES = Array.from({ length: 15 }, () => ({
  x: rnd(0, FLY_P), y: H0 * rnd(0.34, 0.86), r: rnd(3.5, 7), ph: rnd(0, TAU), sp: rnd(0.5, 1.2), amp: rnd(6, 16), a: rnd(0.5, 1), tw: rnd(0.7, 1.7), dr: rnd(-6, 8),
}));

// Mondkrater (Anteile des Radius)
const CRATERS = [
  { x: -0.3, y: -0.12, r: 0.17 },
  { x: 0.24, y: 0.2, r: 0.13 },
  { x: 0.08, y: -0.42, r: 0.1 },
  { x: -0.14, y: 0.38, r: 0.09 },
];

// Sternschnuppen: drei Spuren mit festem Takt (per Sekunden). Wann im Takt der Streifen
// erscheint, wo er startet und wohin er fliegt, kommt aus dem Takt selbst (hash). life ist die Flugzeit.
const METEORS = [
  { per: 3.0, life: 1.1 },
  { per: 3.4, life: 1.25 },
  { per: 4.7, life: 1.0 },
];

// Schleier des Traumsturms
const VEIL_M = 300;
const VEIL_P = W0 + VEIL_M * 2;
const VEILS = Array.from({ length: STORM.VEILS }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (VEIL_P / STORM.VEILS), w: rnd(90, 190), a: rnd(0.55, 1), v: rnd(26, 50) }));

// ---------- Ebenen ----------

function drawSky(ctx, f) {
  const { W, H, th } = f;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, th.sky[0]);
  g.addColorStop(0.58, th.sky[1]);
  g.addColorStop(1, th.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // heller Dunst am unteren Horizont
  const h = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, W * 0.8);
  h.addColorStop(0, tint(th.sky[2], 0.4));
  h.addColorStop(1, tint(th.sky[2], 0));
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, W, H);
}

function drawStars(ctx, f) {
  const { W, time, th } = f;
  const off = f.cam * PAR.STARS;
  const amp = f.reduce ? 0 : 0.6; // Tiefe des Funkelns
  ctx.fillStyle = th.star;
  for (const st of STARS) {
    const x = wrapX(st.x - off, STAR_M, STAR_P);
    if (x < -8 || x > W + 8) continue;
    const tw = f.reduce ? 1 : 0.5 + 0.5 * Math.sin(time * st.sp + st.ph);
    ctx.globalAlpha = st.a * (1 - amp * (1 - tw)) * (f.reduce ? 0.85 : 1);
    if (st.kind === 0) {
      ctx.fillRect(x, st.y, 1.2, 1.2);
    } else if (st.kind === 1) {
      ctx.beginPath();
      ctx.arc(x, st.y, 1.1, 0, TAU);
      ctx.fill();
    } else if (st.kind === 2) {
      ctx.beginPath();
      ctx.arc(x, st.y, 1.7, 0, TAU);
      ctx.fill();
    } else {
      sparkle(ctx, x, st.y, st.r * (f.reduce ? 0.85 : 0.65 + 0.35 * tw));
    }
  }
  ctx.globalAlpha = 1;
}

// Vierzackiger Stern aus einem Pfad, mit kleinem Kern
function sparkle(ctx, x, y, L) {
  ctx.beginPath();
  ctx.moveTo(x, y - L);
  ctx.quadraticCurveTo(x, y, x + L, y);
  ctx.quadraticCurveTo(x, y, x, y + L);
  ctx.quadraticCurveTo(x, y, x - L, y);
  ctx.quadraticCurveTo(x, y, x, y - L);
  ctx.fill();
}

function drawMoon(ctx, f, ev) {
  const { W, H, th, time } = f;
  const boost = ev && ev.type === 'supermoon' ? ev.env : 0;
  // Der Mond schwankt begrenzt hin und her, statt aus dem Bild zu wandern
  const mx = W * MOON.X + MOON.SWAY * Math.sin((f.cam * PAR.MOON) / MOON.SWAY);
  const my = H * MOON.Y + boost * 14;
  const r = MOON.R * (1 + MOON.GROW * boost);

  const breath = f.reduce ? 0 : 0.07 * Math.sin(time * 0.7);
  const haloR = r * (4.4 + boost * 1.2);
  const ha = (0.3 + 0.28 * boost) * (1 + breath);
  const halo = ctx.createRadialGradient(mx, my, r * 0.8, mx, my, haloR);
  halo.addColorStop(0, tint(th.moon, ha));
  halo.addColorStop(0.3, tint(th.moon, ha * 0.3));
  halo.addColorStop(1, tint(th.moon, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(mx - haloR, my - haloR, haloR * 2, haloR * 2);

  // Scheibe mit Licht oben links und dunklerem Rand
  const disc = ctx.createRadialGradient(mx - r * 0.35, my - r * 0.35, r * 0.05, mx, my, r);
  disc.addColorStop(0, mixc(th.moon, '#ffffff', 0.4 + 0.3 * boost));
  disc.addColorStop(0.55, mixc(th.moon, '#ffffff', 0.1 * boost));
  disc.addColorStop(1, mixc(th.moon, th.sky[1], 0.4 - 0.2 * boost));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, TAU);
  ctx.fill();

  // Krater, kaum sichtbar
  ctx.fillStyle = tint(th.sky[1], 0.08);
  for (const c of CRATERS) {
    ctx.beginPath();
    ctx.arc(mx + c.x * r, my + c.y * r, c.r * r, 0, TAU);
    ctx.fill();
  }
}

// Gewichtung der Welt 4 (Gewittertraum) beim Überblenden: 0 bis 1
function stormWorldWeight(world) {
  const b = clamp01(num(world.blend, 1));
  const k = smooth(b);
  return ((world.from % 4 === 3 ? 1 - k : 0) + (world.to % 4 === 3 ? k : 0));
}

// Wetterleuchten: alle 6,5 Sekunden ein Fenster, in dem mit etwa 60 Prozent ein weiches Doppelaufleuchten kommt
const FLASH_SLOT = 6.5;
const pulse = (x) => (x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 2) : 0);
function flashAt(time, reduce) {
  const slot = Math.floor(time / FLASH_SLOT);
  if (hash(slot + 0.5) < 0.4) return { k: 0, x: 0 };
  const start = hash(slot * 3.7 + 1.1) * (FLASH_SLOT - 2);
  const u = time - slot * FLASH_SLOT - start;
  const x = hash(slot * 5.3 + 2.9);
  if (reduce) return { k: 0.4 * pulse(u / 1.6), x };
  return { k: Math.max(pulse(u / 0.55), 0.65 * pulse((u - 0.42) / 0.8)), x };
}

function drawFlash(ctx, f) {
  const w = stormWorldWeight(f.world);
  if (w <= 0.01) return;
  const fl = flashAt(f.time, f.reduce);
  const a = fl.k * w;
  if (a <= 0.004) return;
  const { W, H } = f;
  const cx = W * (0.15 + 0.7 * fl.x);
  const cy = H * 0.4;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.62);
  g.addColorStop(0, `rgba(205,220,255,${(0.4 * a).toFixed(3)})`);
  g.addColorStop(0.5, `rgba(180,200,255,${(0.14 * a).toFixed(3)})`);
  g.addColorStop(1, 'rgba(170,190,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgba(170,190,255,${(0.05 * a).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
}

function drawClouds(ctx, f) {
  const { W, time, th } = f;
  const off = f.cam * PAR.CLOUDS;
  const m = baseMatrix(ctx);
  for (const band of BANDS) {
    ctx.fillStyle = softBlob(ctx, th.cloud, band.a, 0.55);
    const drift = f.reduce ? 0 : time * band.v;
    for (const c of band.clouds) {
      const x = wrapX(c.x - off + drift, CLOUD_M, CLOUD_P);
      if (x < -150 * c.s || x > W + 150 * c.s) continue;
      const y = band.y + (f.reduce ? 0 : Math.sin(time * 0.25 + c.ph) * 3);
      for (const b of c.blobs) {
        if (x + b.dx + b.rx < 0 || x + b.dx - b.rx > W) continue;
        stamp(ctx, m, x + b.dx, y + b.dy, b.rx, b.ry);
      }
    }
  }
  resetMatrix(ctx, m);
}

function drawMountains(ctx, f) {
  const { W, H, th } = f;
  for (const layer of MOUNTAINS) {
    const off = f.cam * layer.factor;
    const g = ctx.createLinearGradient(0, layer.base - 80, 0, H);
    g.addColorStop(0, tint(mixc(th.sky[2], th.moon, 0.12), layer.top));
    g.addColorStop(0.5, tint(th.sky[2], layer.top * 0.5));
    g.addColorStop(1, tint(th.sky[2], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    for (const m of layer.clusters) {
      const x = wrapX(m.x - off, MTN_M, MTN_P);
      if (x < -m.hw || x > W + m.hw) continue;
      for (const c of m.circles) {
        if (x + c.dx + c.r < 0 || x + c.dx - c.r > W) continue;
        ctx.moveTo(x + c.dx + c.r, layer.base + c.dy);
        ctx.arc(x + c.dx, layer.base + c.dy, c.r, 0, TAU);
      }
    }
    ctx.rect(-4, layer.base, W + 8, H - layer.base + 4);
    ctx.fill();
  }
}

function drawMist(ctx, f) {
  const { W, time, th } = f;
  const off = f.cam * PAR.MIST;
  const base = baseMatrix(ctx);
  ctx.fillStyle = softBlob(ctx, th.mist, 2.6, 0.55);
  for (const m of MIST) {
    const x = wrapX(m.x - off + (f.reduce ? 0 : time * m.v), MIST_M, MIST_P);
    if (x < -m.rx || x > W + m.rx) continue;
    const y = m.y + (f.reduce ? 0 : Math.sin(time * 0.2 + m.ph) * 4);
    stamp(ctx, base, x, y, m.rx, m.ry);
  }
  resetMatrix(ctx, base);
}

function drawFireflies(ctx, f) {
  const { W, time, th } = f;
  const off = f.cam * PAR.FIREFLY;
  const base = baseMatrix(ctx);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, tint(th.accent, 0.95));
  g.addColorStop(0.2, tint(th.accent, 0.5));
  g.addColorStop(1, tint(th.accent, 0));
  ctx.fillStyle = g;
  for (const ff of FIREFLIES) {
    const x = wrapX(ff.x - off + (f.reduce ? 0 : time * ff.dr), FLY_M, FLY_P);
    if (x < -10 || x > W + 10) continue;
    const bob = Math.sin(time * ff.sp + ff.ph) * ff.amp * (f.reduce ? 0.3 : 1);
    ctx.globalAlpha = f.reduce ? ff.a * 0.55 : ff.a * (0.35 + 0.35 * Math.sin(time * ff.tw + ff.ph * 2));
    stamp(ctx, base, x, ff.y + bob, ff.r, ff.r);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  resetMatrix(ctx, base);
}

// ---------- Dream Events ----------

function drawMeteors(ctx, f, env) {
  const { W, H, time } = f;
  const n = f.reduce ? 2 : METEORS.length;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const m = METEORS[i];
    const slow = f.reduce ? 1.8 : 1; // ruhigere Bewegung
    const per = m.per * slow;
    const life = m.life * slow;
    const u = time / per + i * 0.37;
    const slot = Math.floor(u);
    const h1 = hash(slot * 7.1 + i * 31.7);
    const h2 = hash(slot * 13.3 + i * 57.9 + 3);
    const ph = (u - slot) * per - h1 * (per - life); // Sekunden seit dem Start im Takt
    if (ph < 0 || ph > life) continue;
    const p = ph / life;
    const ang = 0.4 + 0.3 * h2; // Richtung von oben rechts nach unten links
    const dx = -Math.cos(ang);
    const dy = Math.sin(ang);
    const dist = 300 + 140 * h2;
    const x0 = W * (0.4 + 0.65 * hash(slot * 3.3 + i * 9.1));
    const y0 = H * (0.02 + 0.26 * h1);
    const hx = x0 + dx * dist * p;
    const hy = y0 + dy * dist * p;
    const tail = 40 + 90 * Math.min(1, p * 2.5);
    const tx = hx - dx * tail;
    const ty = hy - dy * tail;
    const a = env * Math.pow(Math.sin(Math.PI * p), 0.6) * (f.reduce ? 0.6 : 1);
    if (a <= 0.01) continue;
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${(0.95 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(hx, hy, 2, 0, TAU);
    ctx.fill();
  }
}

function drawShower(ctx, f, env) {
  const { W, time, th } = f;
  const off = f.cam * PAR.SHOWER;
  const show = Math.ceil(SHOWER_STARS.length * env * (f.reduce ? 0.5 : 1));
  ctx.fillStyle = mixc(th.star, th.accent, 0.35);
  for (let i = 0; i < show; i++) {
    const st = SHOWER_STARS[i];
    const x = wrapX(st.x - off, 10, SHOWER_P);
    if (x < -8 || x > W + 8) continue;
    const tw = f.reduce ? 1 : 0.5 + 0.5 * Math.sin(time * st.sp + st.ph);
    ctx.globalAlpha = env * st.a * (0.35 + 0.65 * tw) * (f.reduce ? 0.8 : 1);
    if (st.spark) {
      // kleiner Kreuzglanz aus zwei Strichen
      const L = 3 + st.r * 2 * (f.reduce ? 0.8 : 0.6 + 0.4 * tw);
      ctx.fillRect(x - L, st.y - 0.6, L * 2, 1.2);
      ctx.fillRect(x - 0.6, st.y - L, 1.2, L * 2);
    } else {
      ctx.fillRect(x - st.r / 2, st.y - st.r / 2, st.r, st.r);
    }
  }
  ctx.globalAlpha = 1;
}

// Abdunkeln und schräge Wolkenschleier des Traumsturms
function drawStorm(ctx, f, env) {
  const { W, H, time } = f;
  ctx.fillStyle = `rgba(6,8,24,${(STORM.DIM * env).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  top.addColorStop(0, `rgba(8,10,30,${(0.4 * env).toFixed(3)})`);
  top.addColorStop(1, 'rgba(8,10,30,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.5);

  // Einheitsverlauf (x von 0 bis 1), jeder Schleier zieht ihn auf Breite und Schräge
  const g = ctx.createLinearGradient(0, 0, 1, 0);
  g.addColorStop(0, 'rgba(150,165,210,0)');
  g.addColorStop(0.5, `rgba(150,165,210,${(0.2 * env).toFixed(3)})`);
  g.addColorStop(1, 'rgba(150,165,210,0)');
  ctx.fillStyle = g;
  const speed = f.reduce ? 0.2 : 1;
  const base = baseMatrix(ctx);
  for (const v of VEILS) {
    const x = wrapX(v.x - f.cam * 0.3 + time * v.v * speed, VEIL_M, VEIL_P);
    if (x < -v.w - H * 0.5 || x > W + v.w + H * 0.5) continue;
    ctx.globalAlpha = v.a;
    setLocal(ctx, base, v.w, 0, STORM.SLANT * H, H, x, 0);
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Einstieg ----------

// view: { W, H, camX, time, reduceMotion }. Zeichnet nur in den Bildbereich.
export function drawBackground(ctx, s, view) {
  // Welt säubern: ganze Zahlen von 0 bis 3 und ein endlicher Übergang
  const w0 = (s && s.world) || {};
  const world = { from: mod(Math.floor(num(w0.from)), 4), to: mod(Math.floor(num(w0.to)), 4), blend: clamp01(num(w0.blend, 1)) };
  const f = {
    W: num(view.W, W0) > 0 ? view.W : W0,
    H: num(view.H, H0) > 0 ? view.H : H0,
    cam: num(view.camX),
    time: num(view.time),
    reduce: !!view.reduceMotion,
    th: themeAt({ ...world, index: world.to }),
    world,
  };
  const e = s && s.events ? eventEnvelope(s) : null;
  const ev = e && e.env > 0.002 ? e : null;
  const type = ev ? ev.type : '';

  ctx.save();
  drawSky(ctx, f);
  drawStars(ctx, f);
  if (type === 'shower') drawShower(ctx, f, ev.env);
  if (type === 'meteor') drawMeteors(ctx, f, ev.env);
  drawMoon(ctx, f, ev);
  drawFlash(ctx, f);
  drawClouds(ctx, f);
  drawMountains(ctx, f);
  if (type === 'storm') drawStorm(ctx, f, ev.env);
  drawMist(ctx, f);
  drawFireflies(ctx, f);
  ctx.restore();
}
