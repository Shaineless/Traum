// Hintergrund: Himmelsverlauf, Parallax Ebenen und weltspezifische Stimmung aus Canvas Formen.
//
// Grundebenen: Sterne (Faktor 0,03), Wolkenbänder (0,12), Mond (0,015), Wolkenberge (0,25), Nebel (0,18).
// Dazu je Welt eigene Elemente, die mit dem Gewicht der Welt (aus s.world.blend) ein und ausblenden:
//   Welt 1 Mitternacht: Glühwürmchen Schwärme mit Leuchtspur, gelegentliche Sternschnuppe
//   Welt 2 Lila Traumhimmel: Abendglühen, Schleierwolken, treibende Blütenblätter und aufsteigende Funken
//   Welt 3 Sternennebel: Aurora, dichter Sternenstaub, Nebelschwaden
//   Welt 4 Gewittertraum: dunkle Front, Wetterleuchten mit fernen Blitzadern, schnelle Wolkenfetzen, Regenschleier
// Dream Events (eventEnvelope): Supermond mit Strahlenkranz, Sternschnuppen, Sturm, Sternschauer.
// Ein Komet in der Warnphase (s.hazards) dunkelt den Himmel leicht ab und zeigt dezent seine Anflugrichtung.
//
// Alle Elemente stammen aus festen Tabellen (Seed in game/rng.js, beim Laden gebaut) oder sind reine
// Funktionen von view.time und view.camX. Es gibt keinen Zustand außerhalb von s und view.
// Kosten: höchstens etwa 560 Zeichenaufrufe und 30 Verläufe pro Bild. Die Anzahl der Elemente einer Welt
// wächst mit ihrem Gewicht (fade), beim Überblenden bleibt die Summe also im Rahmen.
// Bei view.reduceMotion: kein Funkeln, kein Blinken, keine Drift der Ebenen, Wetterleuchten stark gedämpft.

import { H as H0, W as W0 } from '../constants.js';
import { eventEnvelope } from '../events.js';
import { cometPosition } from '../obstacles.js';
import { rand, seedRng } from '../rng.js';
import { themeAt } from '../theme.js';

const TAU = Math.PI * 2;
const GOLD = 0.6180339887; // goldener Schnitt, verteilt Reihenfolgen gleichmäßig

const PAR = {
  STARS: 0.03, CLOUDS: 0.12, MOON: 0.015, MOUNTAINS: 0.25, MIST: 0.18, FIREFLY: 0.5, SHOWER: 0.06,
  DUST: 0.045, AURORA: 0.02, NEBULA: 0.07, FRONT: 0.1, CIRRUS: 0.08, SPARK: 0.45, RAIN: 0.3, WIND: 0.5, SCUD: 0.14,
};
const MOON = { X: 0.74, Y: 0.21, R: 40, SWAY: 70, GROW: 0.7 }; // Supermond wächst bis Faktor 1,7
const STORM = { DIM: 0.26, SLANT: 0.45, VEILS: 6 }; // Schleier und Regen lehnen nach rechts (Wind von links)
const RAIN_SLANT = 0.22; // wie der Regen in world.js
const FLASH = { SLOT: 4.8, CHANCE: 0.74, WASH: 0.07, CORE: 0.62 }; // Wetterleuchten: Takt, Wahrscheinlichkeit, Stärke

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

const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${+Math.min(1, Math.max(0, a)).toFixed(3)})`;

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

// Wie stamp, aber um den Winkel ang gedreht
function stampRot(ctx, m, x, y, rx, ry, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  setLocal(ctx, m, rx * c, rx * s, -ry * s, ry * c, x, y);
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
// Einblendung eines Elements mit fester Reihenfolge order (0 bis 1) bei Weltgewicht w: bei w = 1 sind alle da,
// bei kleinem w erscheinen nach und nach einzelne. So wächst die Zahl der Zeichenaufrufe mit w.
const fade = (w, order) => smooth((w - order * 0.6) / 0.4);
const pulse = (x) => (x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 2) : 0);

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

// Sternschauer: zusätzliche Sterne, die mit der Hüllkurve nach und nach erscheinen. spark: Kreuzglanz
const SHOWER_P = W0 + 20;
const SHOWER_STARS = [];
for (let i = 0; i < 48; i++) {
  SHOWER_STARS.push({ x: rnd(0, SHOWER_P), y: 6 + H0 * 0.64 * Math.pow(rnd(), 1.1), r: rnd(1, 2.2), a: rnd(0.55, 1), ph: rnd(0, TAU), sp: rnd(2.2, 5), spark: i % 3 === 0 });
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
  { per: 5.9, life: 1.3 },
];
// Die einzelne Sternschnuppe der Welt 1: seltener Takt, nicht in jedem Takt
const AMBIENT_METEOR = { per: 9.5, life: 1.15, skip: 0.35 };

// Schleier des Traumsturms
const VEIL_M = 300;
const VEIL_P = W0 + VEIL_M * 2;
const VEILS = Array.from({ length: STORM.VEILS }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (VEIL_P / STORM.VEILS), w: rnd(90, 190), a: rnd(0.55, 1), v: rnd(26, 50) }));

// Windlinien des Traumsturms: lange weiche Streifen, die schnell durchs Bild ziehen
const WIND_M = 160;
const WIND_P = W0 + WIND_M * 2;
const WINDLINES = Array.from({ length: 9 }, (_, i) => ({
  x: rnd(0, WIND_P), y: 28 + (H0 - 120) * ((i * GOLD) % 1), len: rnd(55, 130), v: rnd(210, 420), a: rnd(0.5, 1), rot: rnd(0.03, 0.12), th: rnd(1.1, 2),
}));

// Welt 1: fünf Glühwürmchen Schwärme mit je vier Tieren, die auf lockeren Bahnen um ihre Mitte kreisen
const SWARM_M = 130;
const SWARM_P = W0 + SWARM_M * 2;
const SWARMS = Array.from({ length: 5 }, (_, i) => ({ x: (i + rnd(0.15, 0.85)) * (SWARM_P / 5), y: H0 * rnd(0.36, 0.74), dr: rnd(-6, 7), ph: rnd(0, TAU) }));
const SWARM_FLY = Array.from({ length: 20 }, (_, i) => ({
  sw: i % 5, rx: rnd(20, 54), ry: rnd(12, 30), a: rnd(0, TAU), sp: rnd(0.4, 0.95) * (rand(dec) < 0.5 ? -1 : 1), ph: rnd(0, TAU),
  r: rnd(10, 16), al: rnd(0.75, 1), tw: rnd(0.7, 1.5), order: ((i * GOLD) % 1),
}));

// Welt 2: Schleierwolken (lange dünne Streifen), Blütenblätter und Funken
const CIR_M = 380;
const CIR_P = W0 + CIR_M * 2;
const CIRRUS = Array.from({ length: 7 }, (_, i) => ({
  x: (i + rnd(0.1, 0.9)) * (CIR_P / 7), y: 30 + 36 * i + rnd(-12, 12), len: rnd(150, 270), th: rnd(11, 19), rot: rnd(-0.12, 0.02), a: rnd(0.6, 1), warm: i > 3,
}));
const PETAL_M = 30;
const PETAL_P = W0 + PETAL_M * 2;
const PETALS = Array.from({ length: 18 }, (_, i) => ({
  x: rnd(0, PETAL_P), y: rnd(0, H0 + 40), vx: rnd(18, 48), vy: rnd(15, 34), r: rnd(4.4, 8), rot: rnd(0, TAU), spin: rnd(-1.4, 1.4),
  tum: rnd(1.1, 2.6), ph: rnd(0, TAU), par: rnd(0.32, 0.55), col: i % 3, order: ((i * GOLD) % 1),
}));
const SPARK_M = 20;
const SPARK_P = W0 + SPARK_M * 2;
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  x: rnd(0, SPARK_P), u0: rnd(0, 1), vy: rnd(0.025, 0.06), r: rnd(3.5, 7), sw: rnd(6, 16), ph: rnd(0, TAU), tw: rnd(2, 5), order: ((i * GOLD) % 1),
}));

// Welt 3: Aurora Bänder, Sternenstaub entlang eines Bandes quer über den Himmel, Nebelschwaden
const AURORA = [
  { y: 178, h: 122, amp: 30, sp: 0.3, k: 0.0105, ph: 0, a: 0.72, n: 16, rays: 10, col: 0 },
  { y: 118, h: 96, amp: 22, sp: -0.23, k: 0.0145, ph: 2.1, a: 0.58, n: 12, rays: 8, col: 1 },
  { y: 218, h: 64, amp: 14, sp: 0.18, k: 0.0185, ph: 4, a: 0.38, n: 8, rays: 0, col: 2 },
];
const DUST_M = 14;
const DUST_P = W0 + DUST_M * 2;
// Das Sternenband schwingt als Sinus über den Himmel, ist also nach einer Breite DUST_P wieder gleich (keine Naht)
const dustBand = (x) => 150 + 80 * Math.sin((TAU * x) / DUST_P + 0.6);
const DUST = Array.from({ length: 52 }, (_, i) => {
  const x = rnd(0, DUST_P);
  const inBand = i % 4 !== 3;
  const y = inBand ? dustBand(x) + (rnd() + rnd() + rnd() - 1.5) * 56 : rnd(6, 300);
  return { x, y: Math.min(318, Math.max(5, y)), r: rnd(0.9, 1.9), a: rnd(0.35, 0.95), ph: rnd(0, TAU), sp: rnd(1.2, 3.4), order: ((i * GOLD) % 1) };
});
const NEBULA_M = 280;
const NEBULA_P = W0 + NEBULA_M * 2;
const NEBULA = Array.from({ length: 6 }, (_, i) => ({
  x: (i + rnd(0.1, 0.9)) * (NEBULA_P / 6), y: rnd(40, 250), rx: rnd(130, 230), ry: rnd(26, 52), rot: rnd(-0.5, 0.15), col: i % 3, a: rnd(0.6, 1), v: rnd(-3, 4),
}));

// Welt 4: dunkle Front oben, hellere Unterseite, schnelle Wolkenfetzen, Regenschleier
const FRONT_M = 260;
const FRONT_P = W0 + FRONT_M * 2;
const FRONT = Array.from({ length: 11 }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (FRONT_P / 11), y: rnd(6, 66), rx: rnd(100, 185), ry: rnd(46, 78), v: rnd(14, 32), a: rnd(0.55, 1) }));
const FRONT_LIT = Array.from({ length: 9 }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (FRONT_P / 9), y: rnd(76, 128), rx: rnd(60, 115), ry: rnd(13, 25), v: rnd(14, 32), a: rnd(0.5, 1) }));
const SCUD_M = 170;
const SCUD_P = W0 + SCUD_M * 2;
const SCUDS = Array.from({ length: 7 }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (SCUD_P / 7), y: rnd(92, 250), rx: rnd(60, 120), ry: rnd(9, 17), v: rnd(60, 95), a: rnd(0.6, 1) }));
const RAIN_M = 60;
const RAIN_P = W0 + RAIN_M * 2 + RAIN_SLANT * H0;
const RAIN = Array.from({ length: 48 }, (_, i) => ({
  x: rnd(0, RAIN_P), y: rnd(0, H0 + 60), vy: rnd(250, 340), len: rnd(14, 32), far: i % 3 === 0, order: ((i * GOLD) % 1),
}));
const SHAFTS = Array.from({ length: 5 }, (_, i) => ({ x: (i + rnd(0.1, 0.9)) * (RAIN_P / 5), w: rnd(70, 150), a: rnd(0.55, 1), v: rnd(8, 16) }));

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
  const amp = f.reduce ? 0 : 0.6 + 0.3 * f.showerEnv; // Tiefe des Funkelns, im Sternschauer stärker
  ctx.fillStyle = th.star;
  for (const st of STARS) {
    const x = wrapX(st.x - off, STAR_M, STAR_P);
    if (x < -8 || x > W + 8) continue;
    const tw = f.reduce ? 1 : 0.5 + 0.5 * Math.sin(time * st.sp + st.ph);
    ctx.globalAlpha = st.a * (1 - amp * (1 - tw)) * (f.reduce ? 0.85 : 1);
    if (st.kind === 0) {
      ctx.fillRect(x, st.y, 1.2, 1.2);
    } else if (st.kind === 1) {
      ctx.fillRect(x - 1.1, st.y - 1.1, 2.2, 2.2); // klein genug, dass ein Quadrat wie ein Punkt wirkt (spart Aufrufe)
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
  const haloR = r * (4.4 + boost * 1.4);
  const ha = (0.3 + 0.34 * boost) * (1 + breath);
  const haloColor = boost > 0 ? mixc(th.moon, '#fff3cf', 0.5 * boost) : th.moon;
  const halo = ctx.createRadialGradient(mx, my, r * 0.8, mx, my, haloR);
  halo.addColorStop(0, tint(haloColor, ha));
  halo.addColorStop(0.3, tint(haloColor, ha * 0.3));
  halo.addColorStop(1, tint(haloColor, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(mx - haloR, my - haloR, haloR * 2, haloR * 2);

  if (boost > 0.02) drawMoonRays(ctx, f, mx, my, r, boost, haloColor);

  // Scheibe mit Licht oben links und dunklerem Rand
  const disc = ctx.createRadialGradient(mx - r * 0.35, my - r * 0.35, r * 0.05, mx, my, r);
  disc.addColorStop(0, mixc(th.moon, '#ffffff', 0.4 + 0.45 * boost));
  disc.addColorStop(0.55, mixc(th.moon, '#ffffff', 0.1 + 0.35 * boost));
  disc.addColorStop(1, mixc(th.moon, th.sky[1], 0.4 - 0.3 * boost));
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

// Strahlenkranz des Supermonds: sieben schmale weiche Ellipsen (je zwei Strahlen) und ein heller Ring
function drawMoonRays(ctx, f, mx, my, r, boost, color) {
  const base = baseMatrix(ctx);
  const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  rg.addColorStop(0, tint(mixc(color, '#ffffff', 0.6), 0.9));
  rg.addColorStop(0.5, tint(color, 0.28));
  rg.addColorStop(1, tint(color, 0));
  ctx.fillStyle = rg;
  const rot = f.reduce ? 0.2 : f.time * 0.045;
  for (let i = 0; i < 7; i++) {
    const long = i % 2 === 0;
    const live = f.reduce ? 0.75 : 0.8 + 0.2 * Math.sin(f.time * 0.9 + i * 1.7);
    ctx.globalAlpha = boost * (long ? 0.6 : 0.36) * live;
    stampRot(ctx, base, mx, my, r * (long ? 3.5 : 2.5), r * 0.09, rot + (i * Math.PI) / 7);
  }
  // Ring: ein Verlauf, der nur bei etwa dem 1,4 fachen Radius leuchtet
  const ring = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  ring.addColorStop(0, tint(color, 0));
  ring.addColorStop(0.55, tint(color, 0));
  ring.addColorStop(0.68, tint(color, 0.55));
  ring.addColorStop(0.82, tint(color, 0));
  ring.addColorStop(1, tint(color, 0));
  ctx.fillStyle = ring;
  ctx.globalAlpha = boost * 0.7;
  stamp(ctx, base, mx, my, r * 2.2, r * 2.2);
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Welt 1: Glühwürmchen Schwärme und Sternschnuppe ----------

// Ort des Glühwürmchens ff zur Zeit t (Parallax Versatz off schon abgezogen). Schreibt in out [x, y].
function flyPos(ff, t, off, f, out) {
  const sw = SWARMS[ff.sw];
  const drift = f.reduce ? 0 : t * sw.dr;
  const calm = f.reduce ? 0.3 : 1;
  const sx = wrapX(sw.x - off + drift + (f.reduce ? 0 : 26 * Math.sin(t * 0.13 + sw.ph)), SWARM_M, SWARM_P);
  const sy = sw.y + (f.reduce ? 0 : 14 * Math.sin(t * 0.21 + sw.ph));
  const ang = ff.a + (f.reduce ? 0 : t * ff.sp);
  out[0] = sx + ff.rx * Math.cos(ang);
  out[1] = sy + ff.ry * Math.sin(ang * 1.3 + ff.ph) * calm + (f.reduce ? Math.sin(t * ff.sp + ff.ph) * 3 : 0);
}

function drawFireflies(ctx, f, w) {
  const { W, time, th } = f;
  const off = f.cam * PAR.FIREFLY;
  const base = baseMatrix(ctx);
  ctx.globalCompositeOperation = 'lighter';
  const warm = mixc(th.accent, '#d4ff8a', 0.3);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.08, tint(warm, 0.95));
  g.addColorStop(0.24, tint(warm, 0.55));
  g.addColorStop(0.55, tint(warm, 0.16));
  g.addColorStop(1, tint(warm, 0));
  ctx.fillStyle = g;
  const p = [0, 0];
  const q = [0, 0];
  for (const ff of SWARM_FLY) {
    const k = fade(w, ff.order);
    if (k < 0.02) continue;
    flyPos(ff, time, off, f, p);
    if (p[0] < -40 || p[0] > W + 40) continue;
    const blink = f.reduce ? 0.65 : 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(time * ff.tw + ff.ph * 2), 1.4);
    const a = ff.al * blink * k;
    if (a < 0.04) continue;
    if (!f.reduce) {
      // Leuchtspur: weicher Streifen vom Ort vor 0,9 Sekunden bis zum jetzigen
      flyPos(ff, time - 0.9, off, f, q);
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      const len = Math.hypot(dx, dy);
      if (len > 2 && len < 160) {
        ctx.globalAlpha = a * 0.42;
        stampRot(ctx, base, p[0] - dx * 0.5, p[1] - dy * 0.5, len * 0.55 + ff.r * 0.8, ff.r * 0.72, Math.atan2(dy, dx));
      }
    }
    ctx.globalAlpha = a;
    stamp(ctx, base, p[0], p[1], ff.r, ff.r);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  resetMatrix(ctx, base);
}

// Lage eines Streifens im Takt: [Kopf x, Kopf y, Richtung x, Richtung y, Schweiflänge, Fortschritt] oder null.
// i verschiebt die Spur im Takt. skip: Anteil der Takte ohne Streifen.
function meteorAt(f, i, per, life, skip) {
  const slow = f.reduce ? 1.8 : 1; // ruhigere Bewegung
  per *= slow;
  life *= slow;
  const u = f.time / per + i * 0.37;
  const slot = Math.floor(u);
  const h1 = hash(slot * 7.1 + i * 31.7);
  const h2 = hash(slot * 13.3 + i * 57.9 + 3);
  if (skip > 0 && hash(slot * 2.9 + i * 11.3 + 5) < skip) return null;
  const ph = (u - slot) * per - h1 * (per - life); // Sekunden seit dem Start im Takt
  if (ph < 0 || ph > life) return null;
  const p = ph / life;
  const ang = 0.4 + 0.3 * h2; // Richtung von oben rechts nach unten links
  const dx = -Math.cos(ang);
  const dy = Math.sin(ang);
  const dist = 300 + 140 * h2;
  const x0 = f.W * (0.4 + 0.65 * hash(slot * 3.3 + i * 9.1));
  const y0 = f.H * (0.02 + 0.26 * h1);
  return [x0 + dx * dist * p, y0 + dy * dist * p, dx, dy, 40 + 90 * Math.min(1, p * 2.5), p];
}

// Ein Streifen mit Glanz, Kern und Kopf. a ist die Gesamthelligkeit 0 bis 1.
function drawStreak(ctx, m, glow, hx, hy, dx, dy, tail, a) {
  const tx = hx - dx * tail;
  const ty = hy - dy * tail;
  const g = ctx.createLinearGradient(tx, ty, hx, hy);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
  ctx.strokeStyle = g;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.2;
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.fillStyle = glow;
  ctx.globalAlpha = a;
  stamp(ctx, m, hx, hy, 11, 11);
  ctx.globalAlpha = 1;
  resetMatrix(ctx, m);
}

function streakGlow(ctx) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  return g;
}

function drawMeteors(ctx, f, env) {
  const n = f.reduce ? 2 : METEORS.length;
  const m = baseMatrix(ctx);
  const glow = streakGlow(ctx);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const s = meteorAt(f, i, METEORS[i].per, METEORS[i].life, 0);
    if (!s) continue;
    const a = env * Math.pow(Math.sin(Math.PI * s[5]), 0.6) * (f.reduce ? 0.6 : 1);
    if (a <= 0.01) continue;
    drawStreak(ctx, m, glow, s[0], s[1], s[2], s[3], s[4], a);
  }
}

// Die gelegentliche Sternschnuppe der Welt 1. Nicht im ruhigen Modus (schnelle Bewegung).
function drawAmbientMeteor(ctx, f, w) {
  if (f.reduce) return;
  const s = meteorAt(f, 5, AMBIENT_METEOR.per, AMBIENT_METEOR.life, AMBIENT_METEOR.skip);
  if (!s) return;
  const a = w * Math.pow(Math.sin(Math.PI * s[5]), 0.6) * 0.85;
  if (a <= 0.02) return;
  ctx.lineCap = 'round';
  drawStreak(ctx, baseMatrix(ctx), streakGlow(ctx), s[0], s[1], s[2], s[3], s[4] * 0.9, a);
}

// ---------- Welt 2: Abendglühen, Schleierwolken, Blütenblätter, Funken ----------

function drawSunset(ctx, f, w) {
  const { W, H } = f;
  const base = baseMatrix(ctx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(255,208,150,0.8)');
  g.addColorStop(0.3, 'rgba(255,150,150,0.45)');
  g.addColorStop(0.65, 'rgba(240,110,190,0.17)');
  g.addColorStop(1, 'rgba(240,110,190,0)');
  ctx.fillStyle = g;
  const cx = W * 0.3 + 40 * Math.sin(f.cam * 0.0006);
  ctx.globalAlpha = w * 0.95;
  stamp(ctx, base, cx, H * 0.76, W * 0.72, H * 0.3);
  ctx.globalAlpha = w * 0.6;
  stamp(ctx, base, W * 0.64, H * 0.79, W * 0.7, H * 0.16);
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
  // dünnes Band über dem Horizont
  const band = ctx.createLinearGradient(0, H * 0.58, 0, H * 0.84);
  band.addColorStop(0, 'rgba(255,170,130,0)');
  band.addColorStop(0.7, tint('rgba(255,176,130,0.26)', w));
  band.addColorStop(1, 'rgba(255,150,170,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, H * 0.58, W, H * 0.26);
}

function drawCirrus(ctx, f, w) {
  const { W, th } = f;
  const off = f.cam * PAR.CIRRUS;
  const base = baseMatrix(ctx);
  const cool = softBlob(ctx, mixc(th.cloud, '#ffe2f6', 0.5), 0.95, 0.6);
  const warm = softBlob(ctx, 'rgba(255,196,160,1)', 0.16, 0.6);
  CIRRUS.forEach((c, i) => {
    const k = fade(w, (i * GOLD) % 1);
    if (k < 0.02) return;
    const x = wrapX(c.x - off, CIR_M, CIR_P);
    if (x < -c.len || x > W + c.len) return;
    ctx.fillStyle = c.warm ? warm : cool;
    ctx.globalAlpha = c.a * k;
    stampRot(ctx, base, x, c.y, c.len, c.th, c.rot);
    stampRot(ctx, base, x + c.len * 0.3, c.y + c.th * 1.2, c.len * 0.62, c.th * 0.8, c.rot * 1.4);
  });
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

function drawPetals(ctx, f, w) {
  const { W, H, time } = f;
  const speed = f.reduce ? 0.25 : 1;
  const colors = ['rgba(255,190,224,', 'rgba(255,232,246,', 'rgba(214,178,255,'];
  for (let col = 0; col < 3; col++) {
    ctx.fillStyle = `${colors[col]}${(0.78 * clamp01(w * 1.4)).toFixed(3)})`;
    ctx.beginPath();
    for (const p of PETALS) {
      if (p.col !== col || fade(w, p.order) < 0.05) continue;
      const t = time * speed;
      const x = wrapX(p.x - f.cam * p.par + t * p.vx + (f.reduce ? 0 : 12 * Math.sin(time * 0.7 + p.ph)), PETAL_M, PETAL_P);
      if (x < -10 || x > W + 10) continue;
      const y = mod(p.y + t * p.vy + (f.reduce ? 0 : 8 * Math.sin(time * 1.1 + p.ph * 1.7)), H + 40) - 20;
      const tum = f.reduce ? 0.8 : 0.25 + 0.75 * Math.abs(Math.cos(time * p.tum + p.ph));
      const rot = p.rot + (f.reduce ? 0 : time * p.spin);
      ctx.moveTo(x + p.r * Math.cos(rot), y + p.r * Math.sin(rot));
      ctx.ellipse(x, y, p.r, p.r * 0.5 * tum + 0.5, rot, 0, TAU);
    }
    ctx.fill();
  }
}

function drawSparks(ctx, f, w) {
  const { W, H, time, th } = f;
  const base = baseMatrix(ctx);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, tint(th.accent, 0.95));
  g.addColorStop(0.25, tint(th.accent, 0.4));
  g.addColorStop(1, tint(th.accent, 0));
  ctx.fillStyle = g;
  const speed = f.reduce ? 0.25 : 1;
  for (const s of SPARKS) {
    const k = fade(w, s.order);
    if (k < 0.03) continue;
    const x = wrapX(s.x - f.cam * PAR.SPARK + s.sw * Math.sin(time * 0.8 + s.ph) * (f.reduce ? 0 : 1), SPARK_M, SPARK_P);
    if (x < -12 || x > W + 12) continue;
    const u = mod(s.u0 + time * speed * s.vy, 1); // 0 unten am Horizont, 1 oben
    const y = H * 0.82 - u * H * 0.74;
    const life = Math.pow(Math.sin(Math.PI * u), 0.8);
    const tw = f.reduce ? 0.7 : 0.55 + 0.45 * Math.sin(time * s.tw + s.ph);
    ctx.globalAlpha = k * life * tw;
    stamp(ctx, base, x, y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  resetMatrix(ctx, base);
}

// ---------- Welt 3: Aurora, Sternenstaub, Nebelschwaden ----------

// Farben der Vorhänge: [Lichtkante unten, Mitte, Spitze oben, Rand]
const AURORA_COLORS = [
  [[200, 255, 200], [110, 255, 150], [70, 225, 200], [110, 150, 255]],
  [[200, 250, 255], [100, 235, 235], [160, 150, 255], [190, 130, 255]],
  [[240, 200, 255], [220, 150, 255], [200, 130, 255], [255, 130, 220]],
];

// Weicher Körper eines Vorhangs: Verlauf in einer Einheitsellipse, am unteren Rand hell, nach oben und zu den Seiten weich.
// Der innere Kreis sitzt unten in der Mitte (0, 1), der äußere ist der Einheitskreis.
function auroraBody(ctx, col) {
  const c = AURORA_COLORS[col];
  const g = ctx.createRadialGradient(0, 1, 0, 0, 0, 1);
  g.addColorStop(0, rgba(c[0][0], c[0][1], c[0][2], 1));
  g.addColorStop(0.15, rgba(c[1][0], c[1][1], c[1][2], 0.85));
  g.addColorStop(0.45, rgba(c[2][0], c[2][1], c[2][2], 0.34));
  g.addColorStop(0.8, rgba(c[3][0], c[3][1], c[3][2], 0.08));
  g.addColorStop(1, rgba(c[3][0], c[3][1], c[3][2], 0));
  return g;
}

// Senkrechter Einheitsverlauf eines dünnen Strahls: oben durchsichtig, unten hell, ganz unten wieder weich
function auroraRay(ctx, col) {
  const c = AURORA_COLORS[col];
  const g = ctx.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, rgba(c[3][0], c[3][1], c[3][2], 0));
  g.addColorStop(0.5, rgba(c[2][0], c[2][1], c[2][2], 0.25));
  g.addColorStop(0.8, rgba(c[1][0], c[1][1], c[1][2], 0.75));
  g.addColorStop(0.9, rgba(c[0][0], c[0][1], c[0][2], 0.9));
  g.addColorStop(1, rgba(c[0][0], c[0][1], c[0][2], 0));
  return g;
}

// Aurora: je Band ein wehender Vorhang aus weichen, stark überlappenden Flammen (unten hell) und dünnen Strahlen.
// Die untere Kante folgt einer Sinuskurve aus view.time, Höhe und Helligkeit wechseln von Flamme zu Flamme.
// Im ruhigen Modus steht die Aurora still.
function drawAurora(ctx, f, w) {
  const { W } = f;
  const t = f.reduce ? 0 : f.time;
  const base = baseMatrix(ctx);
  const off = f.cam * PAR.AURORA;
  ctx.globalCompositeOperation = 'lighter';
  AURORA.forEach((band, b) => {
    const edge = (x) => band.y + band.amp * (Math.sin(x * band.k + t * band.sp + band.ph) + 0.4 * Math.sin(x * band.k * 2.3 - t * band.sp * 1.7 + band.ph * 1.3));
    const patch = (x) => 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.0065 + band.ph + t * 0.06), 1.2);
    // Flammen: n Stück gleichmäßig auf einer Spur der Länge W plus zwei Flammenradien, so springt beim Wiedereintritt nichts
    const gap = W / (band.n - 3);
    const rx = gap * 1.5;
    const m = rx + 8;
    ctx.fillStyle = auroraBody(ctx, band.col);
    for (let i = 0; i < band.n; i++) {
      const k = fade(w, (i * GOLD + b * 0.31) % 1);
      if (k < 0.03) continue;
      const x = wrapX(gap * i - off, m, gap * band.n) + 6 * Math.sin(i * 2.9 + t * 0.4);
      if (x < -rx || x > W + rx) continue;
      const hh = band.h * (0.65 + 0.35 * Math.sin(i * 1.7 + t * 0.21 + b));
      const shimmer = f.reduce ? 0.8 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(i * 2.7 + t * 0.9 + b));
      ctx.globalAlpha = band.a * k * patch(x) * shimmer;
      stamp(ctx, base, x, edge(x) - hh / 2, rx, hh / 2);
    }
    if (!band.rays) return;
    ctx.fillStyle = auroraRay(ctx, band.col);
    const span = W + 60;
    const rg = span / band.rays;
    for (let j = 0; j < band.rays; j++) {
      const k = fade(w, (j * GOLD + b * 0.17 + 0.05) % 1);
      if (k < 0.03) continue;
      const x = wrapX(rg * (j + 0.5) - off, 30, span) + 10 * Math.sin(j * 3.1 + t * 0.35);
      if (x < -20 || x > W + 20) continue;
      const hh = band.h * (0.7 + 0.3 * Math.sin(j * 1.9 + t * 0.21 + b));
      const shimmer = f.reduce ? 0.6 : 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(j * 2.7 + t * 1.1 + b * 2.3));
      const wd = 6 + 7 * (0.5 + 0.5 * Math.sin(j * 5.3));
      ctx.globalAlpha = band.a * 0.75 * k * patch(x) * shimmer;
      setLocal(ctx, base, wd, 0, 0.12 * hh * Math.sin(x * band.k + t * band.sp + band.ph), hh, x - wd / 2, edge(x) - hh);
      ctx.fillRect(0, 0, 1, 1);
    }
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  resetMatrix(ctx, base);
}

function drawStarDust(ctx, f, w) {
  const { W, time, th } = f;
  const off = f.cam * PAR.DUST;
  const base = baseMatrix(ctx);
  // Milchstraße: ein paar breite zarte Schleier entlang des Sternenbandes (Kopien an den Rändern gegen Sprünge)
  ctx.fillStyle = softBlob(ctx, mixc(th.star, '#9fb4ff', 0.5), 0.14, 0.6);
  ctx.globalAlpha = w * 0.9;
  for (let i = 0; i < 4; i++) {
    const xo = (i + 0.5) * (DUST_P / 4);
    const x = wrapX(xo - off, DUST_M, DUST_P);
    const ang = Math.atan(((80 * TAU) / DUST_P) * Math.cos((TAU * xo) / DUST_P + 0.6));
    for (let c = -1; c <= 1; c++) {
      const px = x + c * DUST_P;
      if (px < -210 || px > W + 210) continue;
      stampRot(ctx, base, px, dustBand(xo), 190, 40, ang);
    }
  }
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
  ctx.fillStyle = th.star;
  for (const d of DUST) {
    const k = fade(w, d.order);
    if (k < 0.05) continue;
    const x = wrapX(d.x - off, DUST_M, DUST_P);
    if (x < -4 || x > W + 4) continue;
    const tw = f.reduce ? 0.8 : 0.5 + 0.5 * Math.sin(time * d.sp + d.ph);
    ctx.globalAlpha = d.a * k * (0.3 + 0.7 * tw);
    ctx.fillRect(x, d.y, d.r, d.r);
  }
  ctx.globalAlpha = 1;
}

function drawNebula(ctx, f, w) {
  const { W } = f;
  const base = baseMatrix(ctx);
  const cols = [
    softBlob(ctx, 'rgba(150,110,255,1)', 0.2, 0.6),
    softBlob(ctx, 'rgba(70,225,255,1)', 0.17, 0.6),
    softBlob(ctx, 'rgba(255,130,220,1)', 0.13, 0.6),
  ];
  const off = f.cam * PAR.NEBULA;
  NEBULA.forEach((n, i) => {
    const k = fade(w, (i * GOLD) % 1);
    if (k < 0.03) return;
    const x = wrapX(n.x - off + (f.reduce ? 0 : f.time * n.v), NEBULA_M, NEBULA_P);
    if (x < -n.rx || x > W + n.rx) return;
    ctx.fillStyle = cols[n.col];
    ctx.globalAlpha = n.a * k;
    stampRot(ctx, base, x, n.y, n.rx, n.ry, n.rot);
    stampRot(ctx, base, x + n.rx * 0.4, n.y - n.ry * 0.5, n.rx * 0.6, n.ry * 0.8, n.rot * 0.6);
  });
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Welt 4: Front, Wetterleuchten, Adern, Wolkenfetzen, Regen ----------

// Gewicht der Welt idx (0 bis 3) beim Überblenden
function worldWeights(world) {
  const k = smooth(world.blend);
  const w = [0, 0, 0, 0];
  w[world.from] += 1 - k;
  w[world.to] += k;
  return w;
}

// Wetterleuchten: im Takt FLASH.SLOT ein Fenster, in dem meist ein weiches Doppelaufleuchten kommt.
// Jeder Schlag ist ein sanfter Anstieg und Abfall (keine harten Sprünge), höchstens etwa zwei Schläge pro Sekunde.
const NO_FLASH = { k: 0, x: 0, y: 0, slot: 0 };
function flashAt(time, reduce) {
  const slot = Math.floor(time / FLASH.SLOT);
  if (hash(slot + 0.5) > FLASH.CHANCE) return NO_FLASH;
  const start = hash(slot * 3.7 + 1.1) * (FLASH.SLOT - 2.6);
  const u = time - slot * FLASH.SLOT - start;
  const x = hash(slot * 5.3 + 2.9);
  const y = hash(slot * 8.1 + 4.2);
  const power = 0.7 + 0.3 * hash(slot * 2.1 + 9.4);
  if (reduce) return { k: 0.3 * power * pulse(u / 1.8), x, y, slot };
  const echo = hash(slot * 4.4 + 7.7) > 0.5 ? 0.4 * pulse((u - 1.15) / 0.45) : 0;
  return { k: power * Math.max(pulse(u / 0.5), 0.7 * pulse((u - 0.36) / 0.75), echo), x, y, slot };
}

// Weicher Fleck mit dichterer Mitte und schärferem Rand: wirkt wie eine Wolke, nicht wie Nebel
function cloudBlob(ctx, r, g, b, a) {
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, rgba(r, g, b, a));
  gr.addColorStop(0.55, rgba(r, g, b, a * 0.92));
  gr.addColorStop(0.82, rgba(r, g, b, a * 0.42));
  gr.addColorStop(1, rgba(r, g, b, 0));
  return gr;
}

// Dunkle Front am oberen Rand mit hellerer Unterseite. k: Stärke 0 bis 1.
function drawFront(ctx, f, k, lit) {
  const { W } = f;
  const base = baseMatrix(ctx);
  const off = f.cam * PAR.FRONT;
  const speed = f.reduce ? 0 : 1;
  ctx.fillStyle = cloudBlob(ctx, 5, 8, 22, 0.9);
  for (const c of FRONT) {
    const x = wrapX(c.x - off + f.time * c.v * speed, FRONT_M, FRONT_P);
    if (x < -c.rx || x > W + c.rx) continue;
    ctx.globalAlpha = c.a * k;
    stamp(ctx, base, x, c.y, c.rx, c.ry);
  }
  // Unterseite: bläulich, wird vom Wetterleuchten erhellt
  ctx.fillStyle = cloudBlob(ctx, 104, 124, 186, 0.62);
  for (const c of FRONT_LIT) {
    const x = wrapX(c.x - off + f.time * c.v * speed, FRONT_M, FRONT_P);
    if (x < -c.rx || x > W + c.rx) continue;
    ctx.globalAlpha = Math.min(1, c.a * k * (0.55 + 1.6 * lit));
    stamp(ctx, base, x, c.y, c.rx, c.ry);
  }
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// Wetterleuchten: weiches Licht hinter der Front, dazu ein leichter Schleier über dem ganzen Bild
function drawFlash(ctx, f, fl, w) {
  const a = fl.k * w;
  if (a <= 0.004) return;
  const { W, H } = f;
  const cx = W * (0.15 + 0.7 * fl.x);
  const cy = 36 + 80 * fl.y;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.66);
  g.addColorStop(0, `rgba(205,222,255,${(FLASH.CORE * a).toFixed(3)})`);
  g.addColorStop(0.4, `rgba(180,200,255,${(0.2 * a).toFixed(3)})`);
  g.addColorStop(1, 'rgba(170,190,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgba(170,190,255,${(FLASH.WASH * a).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
}

// Ferne Blitzader: eine dünne Zickzacklinie mit Ast, kommt unter der Front hervor und endet hoch über dem Boden.
// Der Verlauf ist fest aus dem Takt des Wetterleuchtens (slot) abgeleitet.
function drawVein(ctx, f, fl, w) {
  const a = Math.pow(fl.k, 1.4) * w;
  if (a <= 0.03) return;
  const { W } = f;
  const n = fl.slot;
  let x = W * (0.12 + 0.76 * hash(n * 2.3 + 0.7));
  let y = 40 + 30 * hash(n * 1.9 + 3.1);
  const bias = hash(n * 6.1 + 1.3) < 0.5 ? -1 : 1;
  const brx = [0, 0];
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 7; i++) {
    x += bias * 5 + (hash(n * 4.7 + i * 1.9) - 0.5) * 34;
    y += 9 + 11 * hash(n * 3.3 + i * 2.7);
    ctx.lineTo(x, y);
    if (i === 3) { brx[0] = x; brx[1] = y; }
  }
  // Ast
  let bx = brx[0];
  let by = brx[1];
  ctx.moveTo(bx, by);
  for (let i = 0; i < 3; i++) {
    bx -= bias * (10 + 12 * hash(n * 7.7 + i * 3.1));
    by += 10 + 10 * hash(n * 5.9 + i * 1.3);
    ctx.lineTo(bx, by);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(150,175,255,${(0.26 * a).toFixed(3)})`;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = `rgba(238,244,255,${(0.7 * a).toFixed(3)})`;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

// Schnelle dunkle Wolkenfetzen unter der Front
function drawScud(ctx, f, w) {
  const { W } = f;
  const base = baseMatrix(ctx);
  ctx.fillStyle = softBlob(ctx, 'rgba(20,28,56,1)', 0.5, 0.7);
  SCUDS.forEach((c, i) => {
    const k = fade(w, (i * GOLD) % 1);
    if (k < 0.03) return;
    const x = wrapX(c.x - f.cam * PAR.SCUD + (f.reduce ? 0 : f.time * c.v), SCUD_M, SCUD_P);
    if (x < -c.rx || x > W + c.rx) return;
    ctx.globalAlpha = c.a * k;
    stampRot(ctx, base, x, c.y, c.rx, c.ry, 0.05);
  });
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// Feiner schräger Regenschleier weit hinten: weiche Bahnen und dünne Striche, alles in einer geneigten Matrix
function drawRain(ctx, f, w) {
  const { H, time } = f;
  const base = baseMatrix(ctx);
  const g = ctx.createLinearGradient(0, 0, 1, 0);
  g.addColorStop(0, 'rgba(150,172,225,0)');
  g.addColorStop(0.5, 'rgba(150,172,225,0.13)');
  g.addColorStop(1, 'rgba(150,172,225,0)');
  ctx.fillStyle = g;
  for (const sh of SHAFTS) {
    const x = wrapX(sh.x - f.cam * PAR.RAIN * 0.8 + (f.reduce ? 0 : time * sh.v), RAIN_M, RAIN_P) - RAIN_SLANT * H * 0.5;
    if (x > f.W || x + RAIN_SLANT * H + sh.w < 0) continue;
    ctx.globalAlpha = sh.a * w * (f.reduce ? 0.7 : 1);
    setLocal(ctx, base, sh.w, 0, RAIN_SLANT * H, H * 0.78, x, 0);
    ctx.fillRect(0, 0, 1, 1);
  }
  // Striche: in lokalen Koordinaten senkrecht, die Matrix neigt sie
  setLocal(ctx, base, 1, 0, RAIN_SLANT, 1, 0, 0);
  const speed = f.reduce ? 0.35 : 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? 'rgba(175,195,240,1)' : 'rgba(205,220,255,1)';
    for (const r of RAIN) {
      if ((r.far ? 0 : 1) !== pass) continue;
      const k = fade(w, r.order);
      if (k < 0.05) continue;
      const lx = wrapX(r.x - f.cam * PAR.RAIN * (r.far ? 0.8 : 1), RAIN_M, RAIN_P) - RAIN_SLANT * H;
      const y = mod(r.y + time * r.vy * speed * (r.far ? 0.8 : 1), H + 60) - 30;
      if (lx > f.W || lx + RAIN_SLANT * (y + r.len) < 0) continue;
      ctx.globalAlpha = (r.far ? 0.12 : 0.2) * k * (f.reduce ? 0.7 : 1);
      ctx.fillRect(lx, y, 1.1, r.len);
    }
  }
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Mehr aus den Grundebenen ----------

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

// dens: Dichte (1 normal, in Welt 3 etwas mehr Nebel)
function drawMist(ctx, f, dens) {
  const { W, time, th } = f;
  const off = f.cam * PAR.MIST;
  const base = baseMatrix(ctx);
  ctx.fillStyle = softBlob(ctx, th.mist, 2.6 * dens, 0.55);
  for (const m of MIST) {
    const x = wrapX(m.x - off + (f.reduce ? 0 : time * m.v), MIST_M, MIST_P);
    if (x < -m.rx || x > W + m.rx) continue;
    const y = m.y + (f.reduce ? 0 : Math.sin(time * 0.2 + m.ph) * 4);
    stamp(ctx, base, x, y, m.rx, m.ry);
  }
  resetMatrix(ctx, base);
}

// ---------- Dream Events ----------

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
      const L = 3 + st.r * 2.4 * (f.reduce ? 0.8 : 0.6 + 0.4 * tw);
      ctx.fillRect(x - L, st.y - 0.6, L * 2, 1.2);
      ctx.fillRect(x - 0.6, st.y - L, 1.2, L * 2);
    } else {
      ctx.fillRect(x - st.r / 2, st.y - st.r / 2, st.r, st.r);
    }
  }
  ctx.globalAlpha = 1;
}

// Abdunkeln, schräge Wolkenschleier und lange Windlinien des Traumsturms
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
    setLocal(ctx, base, v.w, 0, STORM.SLANT * H, H, x - STORM.SLANT * H * 0.5, 0);
    ctx.fillRect(0, 0, 1, 1);
  }

  // Windlinien: weiche lange Striche, die schnell nach rechts ziehen
  ctx.fillStyle = softBlob(ctx, 'rgba(205,218,255,1)', 0.8, 0.5);
  const lines = f.reduce ? 6 : WINDLINES.length;
  for (let i = 0; i < lines; i++) {
    const l = WINDLINES[i];
    const k = fade(env, (i * GOLD) % 1);
    if (k < 0.03) continue;
    const x = wrapX(l.x - f.cam * PAR.WIND + time * l.v * (f.reduce ? 0.12 : 1), WIND_M, WIND_P);
    if (x < -l.len || x > W + l.len) continue;
    ctx.globalAlpha = 0.5 * l.a * k * (f.reduce ? 0.6 : 1);
    stampRot(ctx, base, x, l.y, l.len, l.th, l.rot);
  }
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Komet Vorfreude ----------

// Stärke 0 bis 1, solange ein Komet in der Warnphase (oder gerade im Einschlag) im Bild ist
function cometAlert(s, f) {
  if (!s || !Array.isArray(s.hazards)) return null;
  let best = null;
  let bestK = 0;
  for (const h of s.hazards) {
    if (!h || h.kind !== 'comet' || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
    let k = 0;
    if (h.phase === 'warn') k = smooth(num(h.charge));
    else if (h.phase === 'strike') k = 1 - smooth(num(h.progress) * 1.6); // nach dem Einschlag klingt es schnell ab
    if (k <= bestK || Math.abs(h.x - f.cam - f.W / 2) > f.W) continue;
    best = h;
    bestK = k;
  }
  return best && bestK > 0.01 ? { h: best, k: bestK } : null;
}

// Der Himmel wird einen Hauch dunkler, ein feiner weicher Schweif zeigt von oben die Anflugrichtung.
// Die genaue Markierung zeichnet world.js, hier bleibt es bei einer Ahnung.
function drawCometHint(ctx, f, c) {
  const { W, H } = f;
  ctx.fillStyle = `rgba(6,8,22,${(0.13 * c.k).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  const h = c.h;
  const a = cometPosition({ x: h.x, y: h.y, dir: h.dir, phase: 'warn', progress: 0 });
  const dx = h.x - a.x;
  const dy = h.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1)) return;
  const ux = dx / len;
  const uy = dy / len;
  if (!(uy > 0.05)) return;
  const t0 = h.y / uy; // Strecke vom Einschlag zurück bis zur Bildoberkante
  const ex = h.x - ux * t0 - f.cam;
  if (ex < -90 || ex > W + 90) return;
  const reach = Math.min(Math.max(0, t0 - 20), 110 + 90 * c.k);
  if (!(reach > 10)) return;
  const base = baseMatrix(ctx);
  const g = softBlob(ctx, 'rgba(210,225,255,1)', 0.5, 0.5);
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.34 * c.k;
  // Der Schweif liegt in Flugrichtung, sein oberes Ende am Bildrand
  stampRot(ctx, base, ex + ux * reach * 0.5, uy * reach * 0.5, reach * 0.55, 3 + 2 * c.k, Math.atan2(uy, ux));
  ctx.globalAlpha = 1;
  resetMatrix(ctx, base);
}

// ---------- Einstieg ----------

// view: { W, H, camX, time, reduceMotion }. Zeichnet nur in den Bildbereich.
export function drawBackground(ctx, s, view) {
  const v = view || {};
  // Welt säubern: ganze Zahlen von 0 bis 3 und ein endlicher Übergang
  const w0 = (s && s.world) || {};
  const world = { from: mod(Math.floor(num(w0.from)), 4), to: mod(Math.floor(num(w0.to)), 4), blend: clamp01(num(w0.blend, 1)) };
  const e = s && s.events ? eventEnvelope(s) : null;
  const ev = e && e.env > 0.002 ? e : null;
  const type = ev ? ev.type : '';
  const f = {
    W: Number.isFinite(v.W) && v.W > 0 ? v.W : W0,
    H: Number.isFinite(v.H) && v.H > 0 ? v.H : H0,
    cam: num(v.camX),
    time: num(v.time),
    reduce: !!v.reduceMotion,
    th: themeAt({ ...world, index: world.to }),
    world,
    showerEnv: type === 'shower' ? ev.env : 0,
  };
  const w = worldWeights(world);
  const fl = w[3] > 0.01 ? flashAt(f.time, f.reduce) : NO_FLASH;
  const frontK = Math.max(w[3], type === 'storm' ? 0.85 * ev.env : 0);
  const comet = cometAlert(s, f);

  ctx.save();
  drawSky(ctx, f);
  if (w[1] > 0.01) drawSunset(ctx, f, w[1]);
  drawStars(ctx, f);
  if (w[2] > 0.01) {
    drawStarDust(ctx, f, w[2]);
    drawAurora(ctx, f, w[2]);
  }
  if (type === 'shower') drawShower(ctx, f, ev.env);
  if (type === 'meteor') drawMeteors(ctx, f, ev.env);
  else if (w[0] > 0.01) drawAmbientMeteor(ctx, f, w[0]);
  if (w[2] > 0.01) drawNebula(ctx, f, w[2]);
  drawMoon(ctx, f, ev);
  if (!f.reduce && w[3] > 0.01) drawVein(ctx, f, fl, w[3]);
  if (frontK > 0.01) drawFront(ctx, f, frontK, fl.k * w[3]);
  if (w[3] > 0.01) drawFlash(ctx, f, fl, w[3]);
  if (w[1] > 0.01) drawCirrus(ctx, f, w[1]);
  drawClouds(ctx, f);
  if (w[3] > 0.01) {
    drawScud(ctx, f, w[3]);
    drawRain(ctx, f, w[3]);
  }
  drawMountains(ctx, f);
  if (type === 'storm') drawStorm(ctx, f, ev.env);
  drawMist(ctx, f, 1 + 0.5 * w[2]);
  if (w[0] > 0.01) drawFireflies(ctx, f, w[0]);
  if (w[1] > 0.01) {
    drawPetals(ctx, f, w[1]);
    drawSparks(ctx, f, w[1]);
  }
  if (comet) drawCometHint(ctx, f, comet);
  ctx.restore();
}
