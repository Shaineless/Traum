// Bildschirmeffekte über der Szene und unter dem HUD. Alles dezent, alles eine reine Funktion von s und view.
//
// Von unten nach oben: Farbtönung bei Dream Events, warmes Combo Leuchten, Randverdunklung beim Gleiten,
// Geschwindigkeitslinien im Dash, Wellenring beim Traumtor, Weißblitz beim Stampfen, Herzschlag Vignette.
// Nichts davon braucht eigenen Zustand: Der Zeitpunkt des Stampfens folgt aus dem Rückprall von Nimbus
// (squashX ist nach dem Sturzflug größer als 1 und vy zeigt nach oben), der Ring am Traumtor aus world.blend
// (läuft nach dem Durchqueren in drei Sekunden von 0 bis 1), die Linien aus view.time.
//
// Kosten: höchstens fünf Verläufe und etwa 60 Zeichenaufrufe pro Bild, nur ganzflächige Füllungen und wenige Striche.
// Bei view.reduceMotion bleiben nur ruhige Flächen: Herzschlag Vignette ohne Puls, Randverdunklung, Ereignis Tönung und
// Combo Schein in halber Stärke. Linien, Wellenring, Weißblitz und alles, was pulsiert, entfallen.

import { H as H0, W as W0 } from '../constants.js';
import { eventEnvelope } from '../events.js';

const RAINBOW = ['#ff7a9c', '#ffb86b', '#ffe27a', '#9dffc8', '#8fe9ff', '#b69cff'];
const GATE_BLEND_TIME = 3; // Sekunden, in denen world.blend nach einem Tor von 0 auf 1 läuft (gates.js)
const WAVE = { DUR: 1.15, R0: 26, R1: 400 }; // Wellenring: Dauer und Radius
const BEAT = 0.95; // Sekunden pro Herzschlag
const LINES = 14; // Geschwindigkeitslinien im Dash
const SLAM = { SQUASH: 1.04, SQUASH_SPAN: 0.21, VY: 150, VY_SPAN: 170, WASH: 0.08, SPOT: 0.42 }; // WASH: ganzes Bild, SPOT: Fleck am Boden

// Tönung je Ereignis: Farbe (r, g, b), Stärke oben und unten
const TINTS = {
  meteor: [130, 150, 255, 0.12, 0.04],
  supermoon: [255, 230, 160, 0.12, 0.05],
  storm: [84, 108, 156, 0.2, 0.1],
  shower: [255, 184, 224, 0.1, 0.04],
};

// ---------- Zahlen ----------

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const pos = (v, d) => (Number.isFinite(v) && v > 0 ? v : d); // Größen müssen positiv sein, sonst gilt der Standard
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const smooth = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
const frac = (v) => v - Math.floor(v);
const gauss = (x, mid, width) => Math.exp(-(((x - mid) / width) ** 2));
const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${+clamp01(a).toFixed(3)})`;

// Pseudozufall aus Index und Zeitschritt, rein deterministisch (kein Math.random)
function hash(i, step) {
  return frac(Math.sin(i * 12.9898 + step * 78.233) * 43758.5453);
}

// ---------- Hilfen ----------

// Randverdunklung oder Randleuchten: innen durchsichtig, außen in der Farbe (r, g, b) mit Stärke a
function edgeTint(f, r, g, b, a, inner, mode) {
  if (!(a > 0.003)) return;
  const { ctx, W, H } = f;
  const gr = ctx.createRadialGradient(W / 2, H / 2, H * inner, W / 2, H / 2, Math.hypot(W, H) * 0.52);
  gr.addColorStop(0, rgba(r, g, b, 0));
  gr.addColorStop(1, rgba(r, g, b, a));
  ctx.globalAlpha = 1;
  ctx.fillStyle = gr;
  if (mode) ctx.globalCompositeOperation = mode;
  ctx.fillRect(0, 0, W, H);
  if (mode) ctx.globalCompositeOperation = 'source-over';
}

// ---------- Effekte ----------

// Dream Events färben das Bild sanft von oben her
function eventTint(f) {
  const s = f.s;
  if (!s.events || !s.events.active) return;
  const env = eventEnvelope(s);
  const t = env && TINTS[env.type];
  if (!t) return;
  const k = clamp01(num(env.env)) * (f.calm ? 0.5 : 1);
  if (!(k > 0.01)) return;
  const { ctx, W, H } = f;
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, rgba(t[0], t[1], t[2], t[3] * k));
  gr.addColorStop(1, rgba(t[0], t[1], t[2], t[4] * k));
  ctx.globalAlpha = 1;
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

// Warmes Leuchten am Rand ab Combo x3, stärker mit jeder weiteren Stufe, blendet mit dem Combo Timer aus
function comboGlow(f) {
  const c = f.s.combo;
  const count = c && typeof c === 'object' ? num(c.count) : 0;
  if (count < 3) return;
  const left = c.timer === undefined ? 1 : clamp01(num(c.timer) / 0.6);
  const ci = clamp01((count - 2) / 5);
  const pulse = f.calm ? 1 : 0.88 + 0.12 * Math.sin(f.time * 3.2);
  edgeTint(f, 255, 150, 84, (0.14 + 0.2 * ci) * left * pulse * (f.calm ? 0.5 : 1), 0.45, 'screen'); // 'screen' hellt auf statt zu vergrauen
}

// Beim Gleiten wird der Rand leicht dunkler, das Bild wirkt ruhiger und weiter
function glideShade(f) {
  const p = f.s.player;
  if (!p || p.dead || !p.glide) return;
  const k = smooth(0.1 + num(p.glideT) / 0.25);
  edgeTint(f, 14, 10, 52, 0.3 * k * (f.calm ? 0.6 : 1), 0.5);
}

// Im Dash ziehen Linien entgegen der Flugrichtung durchs Bild. Der Streifen um Nimbus bleibt frei.
function dashLines(f) {
  const p = f.s.player;
  if (f.calm || !p || p.dead || !p.dash || !(num(p.dash.t) > 0)) return;
  const { ctx, W, H } = f;
  const dir = num(p.dash.dir) < 0 ? -1 : 1;
  const k = clamp01(num(p.dash.t) / 0.05);
  const step = Math.floor(f.time * 30);
  const py = num(p.y) + num(p.h, 34) / 2;
  const rainbow = !!p.dash.rainbow;
  const groups = rainbow ? RAINBOW.length : 2;
  ctx.lineCap = 'round';
  for (let g = 0; g < groups; g++) {
    ctx.strokeStyle = rainbow ? RAINBOW[g] : '#ffffff';
    ctx.lineWidth = rainbow ? 2.4 : g ? 1.6 : 2.8;
    ctx.globalAlpha = (rainbow ? 0.42 : g ? 0.2 : 0.36) * k;
    ctx.beginPath();
    let any = false;
    for (let i = g; i < LINES; i += groups) {
      const y = H * (0.05 + 0.9 * hash(i, 1));
      if (Math.abs(y - py) < 30) continue;
      const len = 90 + 170 * hash(i, 2);
      const x = frac(hash(i, 3) + step * 0.13 * (1 + hash(i, 4))) * (W + len) - len * 0.5;
      ctx.moveTo(x, y);
      ctx.lineTo(x - dir * len, y);
      any = true;
    }
    if (any) ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Wellenring um das Traumtor, das der Spieler zuletzt durchquert hat
function gateWave(f) {
  if (f.calm) return;
  const w = f.s.world;
  const gates = f.s.gates;
  if (!w || !Array.isArray(gates) || gates.length === 0) return;
  const blend = num(w.blend, 1);
  if (blend >= 1) return;
  const e = blend * GATE_BLEND_TIME;
  let g = null;
  for (let i = 0; i < gates.length; i++) {
    const c = gates[i];
    if (c && c.passed && (!g || num(c.index) >= num(g.index))) g = c;
  }
  if (!g || e >= WAVE.DUR) return;
  const { ctx, W } = f;
  const gx = num(g.x) - f.cam;
  const gy = num(g.y) - num(g.h, 190) / 2;
  const waves = 2;
  for (let i = 0; i < waves; i++) {
    const t = clamp01((e - i * 0.14) / WAVE.DUR);
    if (t <= 0 || t >= 1) continue;
    const r = WAVE.R0 + (WAVE.R1 - WAVE.R0) * (1 - (1 - t) ** 3) * (i ? 0.72 : 1);
    if (gx < -r - 20 || gx > W + r + 20) continue;
    const a = (1 - t) ** 1.6 * (i ? 0.4 : 0.62);
    ctx.strokeStyle = i ? '#ffffff' : '#ffe9a8';
    ctx.globalAlpha = a * 0.3;
    ctx.lineWidth = 12 * (1 - t) + 3;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Kurzer Weißblitz, wenn der Sturzflug auf dem Boden endet. Erkennbar am Rückprall: squashX ist noch groß und vy zeigt nach oben.
function slamFlash(f) {
  const p = f.s.player;
  if (f.calm || !p || p.dead || (p.slam && p.slam.active) || p.onGround) return;
  const k = clamp01((num(p.squashX, 1) - SLAM.SQUASH) / SLAM.SQUASH_SPAN) * clamp01((-num(p.vy) - SLAM.VY) / SLAM.VY_SPAN);
  if (!(k > 0.02)) return;
  const { ctx, W, H } = f;
  const fx = num(p.x) + num(p.w, 44) / 2 - f.cam;
  const fy = num(p.y) + num(p.h, 34);
  const gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, H * 0.8);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.4, 'rgba(255,250,235,0.4)');
  gr.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.globalAlpha = SLAM.WASH * k;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = SLAM.SPOT * k;
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

// Herzschlag: bei nur einem Leben pulsiert ein roter Rand im Takt (dumpf, dumpf, Pause)
function lifeVignette(f) {
  const s = f.s;
  const p = s.player;
  if (s.lives !== 1 || s.mode === 'over' || (p && p.dead)) return;
  const v = f.calm ? 0 : Math.max(gauss(frac(f.time / BEAT), 0.05, 0.05), 0.7 * gauss(frac(f.time / BEAT), 0.3, 0.06));
  edgeTint(f, 255, 48, 92, f.calm ? 0.17 : 0.12 + 0.16 * v, 0.46 - 0.07 * v);
}

// ============================================================
// Einstieg
// ============================================================

export function drawScreenFx(ctx, s, ui, view) {
  if (!ctx || !s || !view) return;
  const f = {
    ctx, s, ui,
    W: pos(view.W, W0), H: pos(view.H, H0), cam: num(view.camX), time: num(view.time),
    calm: !!view.reduceMotion,
  };
  ctx.save();
  eventTint(f);
  comboGlow(f);
  glideShade(f);
  dashLines(f);
  gateWave(f);
  slamFlash(f);
  lifeVignette(f);
  ctx.restore();
}
