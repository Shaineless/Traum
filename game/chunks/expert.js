// Chunk Layouts für die späte Spielphase (Schwierigkeit 5 bis 7), ab etwa 1000 Metern.
// Jeder Chunk: { id, name, diff, weight, min, max, mech, rest, build(b) }. Siehe docs/ARCHITEKTUR.md.
// Koordinaten in build(b) sind lokal: x = 0 ist die linke Kante der ersten Plattform, y = 0 deren Oberkante.
// Die Layouts nutzen die neuen Mechaniken (Sprungwolken, Eis, Blinkwolken, Kometen, Hagelwolken) und kombinieren
// mindestens zwei Dinge. Sie sind dichter als die frühen Chunks (engere Wolken, größere Lücken, mehr Gefahren
// gleichzeitig), bleiben aber fair: jede Gefahr kündigt sich an, die Route braucht nur Sprung und Doppelsprung,
// und Stampfen, Wurfstern und Dash sind Abkürzungen oder Auswege, nie Pflicht.
// Gegner stehen nie in den ersten 220 px, Hindernisse nie auf dem einzigen Landeplatz einer Lücke.
// Alle Lücken rechnen mit etwas Gegenwind (Sturmereignis), damit sie auch dann gültig bleiben.
// Die Größe jeder Lücke leitet sich aus b.diff ab, die Layouts bleiben also bei jeder Schwierigkeit gültig.
// Hinweis zu validate.js: Sprünge nach oben über die Höhe eines einfachen Sprungs gelten nur von einer Sprungwolke aus
// als machbar. Darum führt jeder hohe Anstieg der Routen über eine Sprungwolke, Schreine liegen abseits der Route.

import { ENEMY, PHYS, SPIKE, SPRING } from '../constants.js';
import { maxGap } from '../reach.js';
import { safeFor } from '../validate.js';

const PW = PHYS.W; // Spielerbreite: Lücken bis zu dieser Breite brauchen keinen Anlauf
const TAU = Math.PI * 2;
const STORM = 50; // Gegenwind in px/s, mit dem jede Lücke mindestens gerechnet wird (Sturm bis 40)
const ICE_HEAD = 70; // Absprung von Eis: validate.js rechnet mit diesem Gegenwind
const AIR = PHYS.GRAVITY / 2; // halbe Schwerkraft für die Flugbahn y = y0 + v t + AIR t²

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Schwierigkeit des Builders, mindestens 1 (auch wenn sie fehlt)
const diffOf = (b) => Math.max(1, Number.isFinite(b.diff) ? b.diff : 1);
// Fortschritt 0 bis 1 im Spiel ab Meter from über span Meter: Chunks werden mit der Zeit etwas strenger
const ramp = (b, from, span = 1500) => clamp(((Number.isFinite(b.meter) ? b.meter : from) - from) / span, 0, 1);
const wrap = (v) => v - Math.floor(v);

// Lücke (Kante zu Kante) für einen Sprung von Höhe y1 nach y2. frac ist der Anteil dessen, was die Schwierigkeit
// erlaubt. dbl rechnet mit dem Doppelsprung (Lücken weit über dem einfachen Sprung, nur mit zweitem Sprung machbar).
function gapFor(b, y1, y2, frac, wind = STORM, dbl = false) {
  const room = maxGap(y1, y2, { safe: safeFor(diffOf(b)), wind, dbl });
  return Math.round(Number.isFinite(room) ? PW + (room - PW) * frac : 0);
}

// Sternbogen über einer Lücke von x1 (rechte Kante links, Höhe y1) bis x2 (linke Kante rechts, Höhe y2)
function gapArc(b, x1, y1, x2, y2, n = 3) {
  b.starArc(x1 - 6, x2 + 6, Math.min(y1, y2) - 30, clamp((x2 - x1) * 0.35, 38, 72), n);
}

// Flugbahn nach dem Start von einer Sprungwolke (Mitte x0, Oberkante y0) bei vollem Lauftempo vx: Sterne im Takt
function springTrail(b, x0, y0, vx, n, t0 = 0.14, t1 = 0.86) {
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
    b.star(x0 + vx * t, y0 - PHYS.H / 2 - SPRING.SPEED * t + AIR * t * t);
  }
}

// Waagerechte Strecke bei vollem Lauftempo, die der Spieler nach dem Start von einer Sprungwolke fliegt, bis er beim
// Abstieg wieder auf Höhe h über der Wolke ist (h negativ: das Ziel liegt tiefer). 0, wenn die Höhe nicht reicht.
function springReach(h) {
  const disc = SPRING.SPEED * SPRING.SPEED - 4 * AIR * h;
  return disc < 0 ? 0 : (PHYS.MOVE_SPEED * (SPRING.SPEED + Math.sqrt(disc))) / (2 * AIR);
}

// Begrenzt die Streifzone eines Bodengegners auf x0 bis x1 (lokal zur Plattform).
// So bleiben Landung und Absprung der Plattform frei von Gegnern.
function patrol(e, plat, x0, x1, t = 0.5) {
  e.minX = plat.x + x0;
  e.maxX = Math.max(e.minX, plat.x + x1 - e.w);
  e.x = e.minX + (e.maxX - e.minX) * t;
  e.spawnX = e.x;
}

// Brüchige Plattform: Breite nie unter dem Mindestmaß von validate.js
const crumbleW = (b, lo, hi, tightness = 0) => Math.max(92, b.int(lo, hi) - Math.round(tightness));

// Oberkante der höchsten Plattform (lokal) im Bereich x0 bis x1, so wie validate.js sie für Flieger und Hagelwolken prüft
function surfaceIn(b, x0, x1) {
  let top = Infinity;
  for (const p of b.st.platforms) {
    const px = p.x - b.ox;
    if (px + p.w <= x0 || px >= x1) continue;
    top = Math.min(top, (p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y) - b.oy);
  }
  return Number.isFinite(top) ? top : 0;
}

// Schwebende Gegner halten 165 px Abstand zur höchsten Fläche in der Nähe (normale Sprünge treffen sie nie).
// Über dem Flieger hängt ein Stern: er hält den Chunk unter dem Bildrand und belohnt den Stampfer mit dem Abprall.
const FLYER_AMP = 6;
function flyerAbove(b, cx, o = {}) {
  const range = o.range ?? 110;
  const half = range / 2 + ENEMY.FLYER.w / 2;
  const y = surfaceIn(b, cx - half - 200, cx + half + 200) - 183 - FLYER_AMP;
  const e = b.flyer(cx, y, { range, amp: FLYER_AMP, dir: o.dir ?? 1, phase: o.phase ?? 0 });
  b.star(cx, y - 40);
  return e;
}
// Hagelwolken bekommen ihren Stern neben die Bahn, auf die Höhe, die ein sauberer Doppelsprung gerade erreicht
const HAIL_AMP = 8;
function hailAbove(b, cx, o = {}) {
  const range = o.range ?? 100;
  const half = range / 2 + ENEMY.HAILCLOUD.w / 2;
  const y = surfaceIn(b, cx - half - 200, cx + half + 200) - 183 - HAIL_AMP;
  const e = b.hailcloud(cx, y, { range, amp: HAIL_AMP, dir: o.dir ?? -1, phase: o.phase ?? 0 });
  b.star(cx + (o.side ?? 1) * (half + 40), y - 26);
  return e;
}

const POWER_TYPES = ['shield', 'dash', 'magnet', 'feather', 'double'];

export const EXPERT = [
  // Katapult zur Hochroute: eine Sprungwolke schleudert den Spieler zu zwei hohen Wolken, die ein einfacher Sprung nicht erreicht.
  // Die Sternspur zeigt die Flugbahn. Über dem Ausstieg schwebt eine Hagelwolke und fächert nach unten: der Spieler landet
  // aus der Höhe mitten im Warnzittern und wartet die Salve ab, weicht aus oder stampft die Wolke im Abprall.
  {
    id: 'spring-sky-route',
    name: 'Katapult zur Hochroute',
    diff: 5.5,
    weight: 2,
    min: 1250,
    max: Infinity,
    mech: ['spring', 'hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 1250);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const g1 = gapFor(b, 0, 0, b.rand(0.5, 0.68));
      const sx = a.w + g1;
      const sw = b.int(84, 100);
      const sp = b.spring(sx, 0, sw);
      gapArc(b, a.w, 0, sx, 0, 3);
      // Erste hohe Wolke: höher, als ein einfacher Sprung reicht, eine Sprungwolke trägt weit darüber hinaus
      const rise = b.int(132, 150);
      const h1x = sx + sw + b.int(58, 86);
      const h1 = b.cloud(h1x, -rise, b.int(150, 168) - Math.round(14 * k));
      springTrail(b, sx + sw / 2, 0, PHYS.MOVE_SPEED, 6);
      b.starsOver(h1, 2, 42, 30);
      // Zweite hohe Wolke, dann der Abstieg zum Ausstieg
      const y2 = -rise + b.pick([-12, 0, 12]);
      const g2 = gapFor(b, -rise, y2, b.rand(0.55, 0.75) + 0.08 * k);
      const h2 = b.cloud(h1x + h1.w + g2, y2, b.int(140, 160) - Math.round(12 * k));
      gapArc(b, h1x + h1.w, -rise, h1x + h1.w + g2, y2, 3);
      b.starsOver(h2, 2, 42, 30);
      const g3 = gapFor(b, y2, 0, b.rand(0.5, 0.66));
      const ex = h1x + h1.w + g2 + h2.w + g3;
      const exit = b.ground(ex, 0, b.int(310, 340));
      gapArc(b, h1x + h1.w + g2 + h2.w, y2, ex, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      hailAbove(b, ex + b.int(176, 190), { range: 100, dir: b.pick([-1, 1]) });
      b.route(a, sp, h1, h2, exit);
    },
  },

  // Blinkrhythmus: vier Blinkwolken erscheinen nacheinander, jede etwas nach der vorigen. Die Sterne zeichnen
  // die Sprungbögen, das Flackern verrät das Ende. Wer die Welle liest, steigt ohne Hast von Wolke zu Wolke.
  {
    id: 'blink-rhythm',
    name: 'Blinkrhythmus',
    diff: 5,
    weight: 3,
    min: 1200,
    max: Infinity,
    mech: ['blink'],
    rest: false,
    build(b) {
      const k = ramp(b, 1200);
      const period = b.rand(3.4, 3.9);
      const step = b.rand(0.24, 0.28); // Anteil des Takts, um den jede Wolke später erscheint als die vorige
      let phase = b.rand(0, 1);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = 4;
      let x = a.w;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-26, -14, 0, 14, 26]), -48, 26);
        const gap = gapFor(b, y, ny, b.rand(0.5, 0.7) + 0.1 * k);
        const p = b.blink(x + gap, ny, b.int(100, 116) - Math.round(8 * k), { period, phase: wrap(phase) });
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 44);
        route.push(p);
        x += gap + p.w;
        y = ny;
        phase -= step;
      }
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.65));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Eisbahn mit Wachposten: zwei lange Eiswolken führen jeweils zu einer festen Wolke mit einer Gewitterwolke.
  // Auf dem Eis rutscht der Spieler weit, das Bremsen braucht Vorlauf. Wer rechtzeitig springt, stampft die Wache.
  {
    id: 'ice-walker',
    name: 'Eisbahn mit Wachposten',
    diff: 5,
    weight: 3,
    min: 1000,
    max: Infinity,
    mech: ['ice', 'walker'],
    rest: false,
    build(b) {
      const k = ramp(b, 1000);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 2; i++) {
        const iy = clamp(y + b.pick([-16, -8, 0, 8, 16]), -24, 24);
        const ig = gapFor(b, y, iy, b.rand(0.46, 0.6));
        const ice = b.ice(x + ig, iy, b.int(166, 182) - Math.round(10 * k));
        gapArc(b, x, y, x + ig, iy, 3);
        b.starLine(x + ig + 40, iy - 42, x + ig + ice.w - 36, iy - 42, 2);
        route.push(ice);
        x += ig + ice.w;
        y = iy;
        // Wachposten: der Absprung vom Eis rechnet mit schwächerem Anlauf
        const py = clamp(y + b.pick([-20, -10, 0, 10, 20]), -30, 30);
        const pg = gapFor(b, y, py, b.rand(0.5, 0.66), ICE_HEAD);
        const pw = b.int(224, 236);
        const post = b.cloud(x + pg, py, pw);
        const e = b.walker(post, 0.5, { dir: i % 2 === 0 ? -1 : 1 });
        patrol(e, post, 92, pw - 70, b.rand(0.2, 0.8));
        gapArc(b, x, y, x + pg, py, 2);
        b.starArc(x + pg + 96, x + pg + pw - 60, py - 34, 72, 4);
        route.push(post);
        x += pg + pw;
        y = py;
      }
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.64));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 2, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Kometenpiste: eine lange Lauflinie, auf der drei Kometen nacheinander einschlagen. Jeder markiert seinen Einschlagpunkt
  // gut eine Sekunde vorher. Die kleine Sprungwolke über der Linie ist der Ausweg: sie wirft den Spieler über die Mitte.
  {
    id: 'comet-runway',
    name: 'Kometenpiste',
    diff: 6.5,
    weight: 2,
    min: 1700,
    max: Infinity,
    mech: ['comet', 'spring'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(250, 270));
      b.starsOver(a, 3, 42, 30);
      const g0 = gapFor(b, 0, 0, b.rand(0.5, 0.66));
      const rx = a.w + g0;
      const o1 = b.int(250, 280);
      const o2 = o1 + b.int(270, 300);
      const o3 = o2 + b.int(250, 280);
      const w = o3 + b.int(180, 210); // hinter dem letzten Kometen bleibt Platz zum Abspringen
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const c1 = rx + o1;
      const c2 = rx + o2;
      const c3 = rx + o3;
      const idle = b.rand(1.1, 1.4);
      b.comet(c1, 0, { idle, dir: b.pick([-1, 1]) });
      b.comet(c2, 0, { idle: idle + b.rand(1.2, 1.6), dir: b.pick([-1, 1]) });
      b.comet(c3, 0, { idle: idle + b.rand(0.4, 0.8), dir: b.pick([-1, 1]) });
      // Fluchtwolke zwischen den ersten beiden Kometen, einen Sprung über der Linie
      const sw = b.int(76, 90);
      const sx = c1 + b.int(60, 90);
      b.spring(sx, -66, sw);
      springTrail(b, sx + sw / 2, -66, PHYS.MOVE_SPEED, 6);
      b.starLine(rx + 40, -42, c1 - 70, -42, 3);
      b.starArc(c1 - 46, c1 + 46, -30, 82, 4);
      b.starArc(c2 - 46, c2 + 46, -30, 82, 4);
      b.starArc(c3 - 46, c3 + 46, -30, 82, 4);
      b.starLine(c3 + 70, -42, rx + w - 40, -42, 3);
      b.route(a, run);
    },
  },

  // Wächterbrücke: eine Brücke aus brüchigen Wolken führt zu einer festen Insel, auf der eine Sturmwolke wacht.
  // Die Brücke verbietet das Warten, die Sturmwolke erwacht, sobald der Spieler ihre Höhe betritt. Die kleine Deckung
  // darüber sieht sie nicht, von dort lässt sich über sie hinwegspringen oder auf sie herabstürzen.
  {
    id: 'charger-crumble',
    name: 'Wächterbrücke',
    diff: 6,
    weight: 2,
    min: 1300,
    max: Infinity,
    mech: ['charger', 'breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 1300);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      const hop = (plat, ny, gap) => {
        gapArc(b, x, y, x + gap, ny, 2);
        route.push(plat);
        x += gap + plat.w;
        y = ny;
      };
      const crumble = () => {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -24, 24);
        const gap = gapFor(b, y, ny, b.rand(0.46, 0.6) + 0.1 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 96, 106, 6 * k));
        b.star(x + gap + p.w / 2, ny - 46);
        hop(p, ny, gap);
      };
      crumble();
      crumble();
      // Insel mit der Sturmwolke: vorn Platz zum Landen, hinten Platz zum Abspringen
      const iy = clamp(y + b.pick([-10, 0, 10]), -20, 20);
      const ig = gapFor(b, y, iy, b.rand(0.46, 0.6));
      const from = b.int(150, 164);
      const to = from + b.int(92, 106);
      const iw = to + b.int(66, 84); // hinter der Streifzone bleibt Platz zum Abspringen
      const island = b.cloud(x + ig, iy, iw);
      const ix = x + ig;
      const e = b.charger(island, 0.5, { dir: -1 });
      patrol(e, island, from, to, b.rand(0.3, 0.7));
      // Deckung über der Streifzone: höher als die Sichtweite der Sturmwolke
      const cw = b.int(96, 108);
      const cy = iy - b.int(88, 96);
      const cx = ix + (from + to) / 2 - cw / 2 + b.int(-20, 20);
      b.cloud(cx, cy, cw);
      b.star(cx + cw / 2, cy - 44);
      b.starLine(ix + 36, iy - 42, ix + from - 40, iy - 42, 2);
      b.starArc(ix + from - 10, ix + to + 56, iy - 30, 100, 5);
      b.starLine(ix + to + 80, iy - 42, ix + iw - 36, iy - 42, 2);
      hop(island, iy, ig);
      crumble();
      const gap = gapFor(b, y, 0, b.rand(0.46, 0.6));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Windtunnel: ein kräftiger Seitenwind weht über schmale Wolken. Hoch darüber patrouillieren zwei Flieger,
  // die nur Doppelsprünge im Wind erreichen. Wer sie stampft, baut eine Combo auf, wer unten bleibt, hat Ruhe.
  {
    id: 'wind-flyer-tunnel',
    name: 'Windtunnel',
    diff: 6,
    weight: 2,
    min: 1300,
    max: Infinity,
    mech: ['wind', 'flyer'],
    rest: false,
    build(b) {
      const k = ramp(b, 1300);
      const vx = b.pick([-1, 1]) * Math.round(86 + 24 * k + b.rand(0, 10));
      const wind = Math.max(STORM, Math.max(0, -vx) + 6);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      let x = a.w;
      let y = 0;
      let top = 0;
      let bottom = 0;
      const mids = [];
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-22, -11, 0, 11, 22]), -34, 34);
        const gap = gapFor(b, y, ny, b.rand(0.46, 0.62), wind);
        const p = b.cloud(x + gap, ny, b.int(88, 104) - Math.round(8 * k));
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 44);
        mids.push(x + gap / 2);
        route.push(p);
        x += gap + p.w;
        y = ny;
        top = Math.min(top, ny);
        bottom = Math.max(bottom, ny);
      }
      const gap = gapFor(b, y, 0, b.rand(0.46, 0.6), wind);
      const exit = b.ground(x + gap, 0, b.int(250, 280));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      // Zwei Flieger über der ersten und der letzten Lücke, gegenläufig
      const lo = 226 + 55 + 21;
      flyerAbove(b, Math.max(lo, mids[0]), { range: 110, dir: 1, phase: 0 });
      flyerAbove(b, Math.max(lo + 120, x + gap / 2), { range: 110, dir: -1, phase: Math.PI });
      const zx = a.w * 0.5;
      b.wind(zx, top - 175, x + gap + 90 - zx, bottom - top + 240, { vx });
      b.route(...route);
    },
  },

  // Doppelblitz im Regen: auf einer langen, nassen Lauflinie schlagen drei Blitze ein, dazwischen patrouilliert eine
  // Gewitterwolke. Der Regen macht das Bremsen träge, darum lohnt es, den Einschlag früh abzuwarten. Köder aus Sternen
  // hängen in jeder Zone: erst nach dem Einschlag holen.
  {
    id: 'double-bolt-rain',
    name: 'Doppelblitz im Regen',
    diff: 6,
    weight: 2,
    min: 1300,
    max: Infinity,
    mech: ['lightning', 'rain', 'walker'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.5, 0.66));
      const rx = a.w + gap;
      const o1 = b.int(250, 280);
      const o2 = o1 + b.int(250, 280);
      const o3 = o2 + b.int(280, 310);
      const w = o3 + b.int(190, 230); // hinter dem letzten Blitz bleibt Platz zum Abspringen
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const x1 = rx + o1;
      const x2 = rx + o2;
      const x3 = rx + o3;
      const idle = b.rand(1.0, 1.3);
      b.lightning(x1, { idle });
      b.lightning(x2, { idle: idle + b.rand(1.2, 1.6) });
      b.lightning(x3, { idle: idle + b.rand(0.5, 0.8) });
      // Gewitterwolke in der Gasse zwischen dem zweiten und dritten Blitz, mit Platz zu beiden Zonen
      const e = b.walker(run, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e, run, x2 - rx + 96, x3 - rx - 96, b.rand(0.2, 0.8));
      // Zwei Regenwolken: die erste regnet beim Eintreffen, die zweite etwas später
      b.rain(rx + 10, 500, { offset: b.rand(3.6, 6.2) });
      b.rain(rx + 470, 560, { offset: b.rand(0.5, 2.5) });
      b.starLine(rx + 40, -42, x1 - 66, -42, 2);
      b.starArc(x1 - 46, x1 + 46, -30, 84, 4);
      b.starArc(x2 - 46, x2 + 46, -30, 84, 4);
      b.starArc(x2 + 100, x3 - 100, -30, 90, 4);
      b.starArc(x3 - 46, x3 + 46, -30, 84, 4);
      b.starLine(x3 + 70, -42, rx + w - 40, -42, 2);
      b.route(a, run);
    },
  },

  // Sprungwolkentreppe: drei Sprungwolken führen in Stufen nach oben, jede schleudert den Spieler zur nächsten. Oben
  // wartet eine feste Wolke, die eine Stachelwolke in zwei Landezonen teilt, danach geht es hinab zum Ausstieg. Wer die
  // Taste gedrückt hält, landet bei jeder Stufe am Ende der Wolke, wer früh loslässt, in der Mitte. Die Sterne zeigen jede Bahn.
  {
    id: 'spring-stairs',
    name: 'Sprungwolkentreppe',
    diff: 5,
    weight: 2,
    min: 1000,
    max: Infinity,
    mech: ['spring', 'spike'],
    rest: false,
    build(b) {
      const k = ramp(b, 1000);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w + gapFor(b, 0, 0, b.rand(0.5, 0.64));
      gapArc(b, a.w, 0, x, 0, 2);
      const ys = [0, -b.int(54, 64), -b.int(108, 120)];
      const ws = ys.map(() => b.int(92, 106) - Math.round(8 * k));
      for (let i = 0; i < 3; i++) {
        route.push(b.spring(x, ys[i], ws[i]));
        springTrail(b, x + ws[i] / 2, ys[i], PHYS.MOVE_SPEED, 2, 0.25, 0.75);
        // Die nächste Stufe liegt so, dass volles Lauftempo kurz hinter ihrer Mitte landet
        const next = i < 2 ? ys[i + 1] : -b.int(144, 156);
        const nw = i < 2 ? ws[i + 1] : 0;
        const dx = springReach(ys[i] - next) * b.rand(0.78, 0.9);
        x += i < 2 ? Math.round(dx - ws[i] / 2 - nw / 2) + ws[i] : Math.round(dx) - 40;
      }
      // Oben: feste Wolke, die Stachelwolke im linken Drittel lässt vorn einen kleinen und hinten einen großen Landeplatz
      const ty = -b.int(144, 156);
      const tw = b.int(212, 226);
      const top = b.cloud(x, ty, tw);
      b.spike(top, 0.34);
      route.push(top);
      b.starArc(x + 100, x + tw - 24, ty - 30, 70, 3);
      x += tw;
      // Abstieg zum Ausstieg
      const gap = gapFor(b, ty, 0, b.rand(0.5, 0.64));
      const exit = b.ground(x + gap, 0, b.int(250, 280));
      gapArc(b, x, ty, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Hüpferslalom: zwei Reihen von Wolken, unten Hüpfer, oben eine Stachelwolke, im Wechsel. Der Spieler pendelt zwischen den
  // Reihen, liest jeden Hüpfer an seinem Zusammenkauern und springt über jede Stachelwolke mit Platz zum Landen.
  {
    id: 'jumper-slalom',
    name: 'Hüpferslalom',
    diff: 6,
    weight: 2,
    min: 1350,
    max: Infinity,
    mech: ['jumper', 'spike'],
    rest: false,
    build(b) {
      const k = ramp(b, 1350);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const lowRow = i % 2 === 0;
        const ny = lowRow ? b.pick([-6, 0, 6]) : -b.int(40, 52);
        const gap = gapFor(b, y, ny, b.rand(0.48, 0.62) + 0.08 * k);
        if (lowRow) {
          const pw = b.int(236, 252);
          const p = b.cloud(x + gap, ny, pw);
          const e = b.jumper(p, 0.5, { dir: b.pick([-1, 1]) });
          patrol(e, p, 90, pw - 76, b.rand(0, 1));
          gapArc(b, x, y, x + gap, ny, 2);
          b.starArc(x + gap + 80, x + gap + pw - 68, ny - 30, 92, 4);
          route.push(p);
          x += gap + pw;
        } else {
          const pw = b.int(176, 196);
          const p = b.cloud(x + gap, ny, pw);
          b.spike(p, 0.5);
          gapArc(b, x, y, x + gap, ny, 2);
          b.starArc(x + gap + 44, x + gap + pw - 44, ny - 30, 80, 4);
          route.push(p);
          x += gap + pw;
        }
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.64));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 2, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Fähre und Blinkwolken: erst trägt eine schwingende Wolke über die Lücke, dann führen drei Blinkwolken in einer
  // ansteigenden Welle weiter. Der Spieler wartet auf die Fähre und springt los, wenn die erste Blinkwolke frisch erscheint.
  {
    id: 'moving-blink',
    name: 'Fähre und Blinkwolken',
    diff: 6.5,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['moving', 'blink'],
    rest: false,
    build(b) {
      const k = ramp(b, 1500);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      // Fähre: der weiteste Abstand verlangt Warten, der nächste lässt 24 px Luft
      const wh = b.int(112, 124);
      const far1 = gapFor(b, 0, 0, b.rand(1.04, 1.14), 0);
      const axh = Math.floor(Math.min(b.int(56, 66), (far1 - 24) / 2));
      const cx = a.w + far1 - axh;
      const ferry = b.moving(cx, 0, wh, { ax: axh, period: b.rand(3.6, 4.2), phase: b.rand(0, TAU) });
      b.starArc(cx - axh, cx + axh + wh, -34, 56, 4);
      // Blinkwolken in einer Welle: jede erscheint etwas nach der vorigen
      const period = b.rand(3.4, 3.9);
      const step = b.rand(0.24, 0.28);
      let phase = b.rand(0, 1);
      const route = [a, ferry];
      const y1 = -b.int(10, 22);
      const far2 = gapFor(b, 0, y1, b.rand(1.0, 1.1), 0);
      let x = cx - axh + wh + far2;
      let y = y1;
      let p = b.blink(x, y, b.int(100, 112), { period, phase: wrap(phase) });
      b.star(x + p.w / 2, y - 44);
      route.push(p);
      x += p.w;
      for (let i = 0; i < 2; i++) {
        phase -= step;
        const ny = clamp(y + b.pick([-24, -12, 12, 24]), -60, 24);
        const gap = gapFor(b, y, ny, b.rand(0.5, 0.68) + 0.08 * k);
        p = b.blink(x + gap, ny, b.int(98, 110) - Math.round(6 * k), { period, phase: wrap(phase) });
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 44);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.64));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Schrein im Sturm: ein Powerup liegt auf einer hohen Wolke genau über einer Blitzzone. Eine Sprungwolke über der
  // Lauflinie wirft den Spieler hinauf, ein Doppelsprung ginge auch. Der Blitz kündigt sich eine Sekunde an: wer den
  // Schrein mitnimmt, verlässt die Zone vor dem Einschlag. Hinter dem Blitz wartet eine Gewitterwolke.
  {
    id: 'shrine-storm',
    name: 'Schrein im Sturm',
    diff: 6,
    weight: 2,
    min: 1350,
    max: Infinity,
    mech: ['powerup', 'lightning', 'spring', 'walker'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.5, 0.66));
      const rx = a.w + gap;
      const w = b.int(820, 880);
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const bx = rx + b.int(410, 440);
      b.lightning(bx, { idle: b.rand(1.0, 1.3) });
      // Schrein hoch über der Zone, Sprungwolke davor
      const rise = b.int(128, 142);
      const shw = b.int(104, 116);
      const shrine = b.cloud(bx - shw / 2 + b.int(-12, 12), -rise, shw);
      b.powerup(b.pick(POWER_TYPES), shrine.x - b.ox + shw / 2, -rise - 36);
      const sw = b.int(76, 88);
      const scx = bx - b.int(214, 246); // Mitte der Sprungwolke
      b.spring(scx - sw / 2, -64, sw);
      springTrail(b, scx, -64, PHYS.MOVE_SPEED, 5, 0.16, 0.8);
      // Gewitterwolke hinter dem Blitz
      const e = b.walker(run, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e, run, bx - rx + 120, bx - rx + 230, b.rand(0.2, 0.8));
      b.starLine(rx + 40, -42, scx - 70, -42, 3);
      b.starArc(bx + 150, bx + 270, -30, 80, 4);
      b.starLine(bx + 300, -42, rx + w - 40, -42, 2);
      b.route(a, run);
    },
  },

  // Hagelschrein: ein Powerup liegt auf einer hohen Wolke, über der eine Hagelwolke schwebt. Auf der Lauflinie davor
  // wartet eine Stachelwolke. Hagelsalven fächern über den ganzen Schrein und die Linie darunter, darum lohnt es sich,
  // erst die Vorwarnung abzuwarten, dann hinaufzuspringen und gleich wieder herunterzukommen.
  {
    id: 'shrine-hail',
    name: 'Hagelschrein',
    diff: 6.5,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['powerup', 'hailcloud', 'spike'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.5, 0.66));
      const rx = a.w + gap;
      const w = b.int(780, 840);
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const off = b.int(150, 170);
      b.spike(run, off / (run.w - SPIKE.w));
      b.starArc(rx + off - 40, rx + off + SPIKE.w + 40, -30, 74, 4);
      // Schrein: nur mit Doppelsprung zu erreichen, Hagelwolke genau darüber
      const rise = b.int(127, 132);
      const shw = b.int(104, 116);
      const shx = rx + b.int(400, 440);
      const shrine = b.cloud(shx, -rise, shw);
      b.powerup(b.pick(POWER_TYPES), shx + shw / 2, -rise - 36);
      b.starsOver(shrine, 2, 62, 30);
      b.starLine(rx + off + SPIKE.w + 60, -42, shx - 40, -42, 3);
      b.starLine(shx + shw + 60, -42, rx + w - 40, -42, 3);
      hailAbove(b, shx + shw / 2, { range: 90, dir: b.pick([-1, 1]) });
      b.route(a, run);
    },
  },

  // Katapultarena: eine breite Plattform mit einer Sturmwolke in der Mitte. Eine Sprungwolke über dem Anlauf wirft den
  // Spieler hoch über die Sturmwolke hinweg in die Landezone dahinter. Alternativ stampft er sie aus der Luft oder
  // läuft durch, sobald sie aufgeladen hat.
  {
    id: 'charger-catapult',
    name: 'Katapultarena',
    diff: 6.5,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['charger', 'spring'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const ay = b.pick([-10, 0, 10]);
      const gap = gapFor(b, 0, ay, b.rand(0.5, 0.64));
      const ax = a.w + gap;
      const w = b.int(660, 700);
      const arena = b.ground(ax, ay, w);
      gapArc(b, a.w, 0, ax, ay, 3);
      const from = b.int(270, 290);
      const to = from + b.int(110, 130);
      const e = b.charger(arena, 0.5, { dir: -1 });
      patrol(e, arena, from, to, b.rand(0.3, 0.7));
      // Sprungwolke über dem Anlauf, einen Sprung hoch
      const sw = b.int(78, 90);
      const scx = ax + from - b.int(88, 104);
      b.spring(scx - sw / 2, ay - 70, sw);
      springTrail(b, scx, ay - 70, PHYS.MOVE_SPEED, 6, 0.14, 0.9);
      b.starLine(ax + 30, ay - 42, scx - sw / 2 - 40, ay - 42, 2);
      b.starArc(ax + to - 10, ax + to + 90, ay - 30, 70, 3);
      b.starLine(ax + to + 120, ay - 42, ax + w - 40, ay - 42, 3);
      b.route(a, arena);
    },
  },

  // Hagelschlucht: zwei breite Lücken, über jeder schwebt eine Hagelwolke und fächert nach unten. Die Wolken schießen
  // versetzt. Nach der Vorwarnung fliegt die Salve unter dem Sprungbogen vorbei, wer dann abspringt, kommt trocken drüber.
  {
    id: 'hail-gap',
    name: 'Hagelschlucht',
    diff: 6,
    weight: 2,
    min: 1350,
    max: Infinity,
    mech: ['hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 1350);
      const a = b.ground(0, 0, b.int(250, 270));
      b.starsOver(a, 3, 42, 30);
      const y1 = b.pick([-16, 0, 16]);
      const g1 = gapFor(b, 0, y1, b.rand(0.7, 0.84) + 0.06 * k);
      const mid = b.cloud(a.w + g1, y1, b.int(150, 170));
      const y2 = clamp(y1 + b.pick([-18, 0, 18]), -26, 26);
      const g2 = gapFor(b, y1, y2, b.rand(0.5, 0.64));
      const mid2 = b.cloud(a.w + g1 + mid.w + g2, y2, b.int(150, 170));
      const y3 = clamp(y2 + b.pick([-16, 0, 16]), -26, 26);
      const g3 = gapFor(b, y2, y3, b.rand(0.7, 0.84) + 0.06 * k);
      const exit = b.ground(a.w + g1 + mid.w + g2 + mid2.w + g3, y3, b.int(260, 290));
      gapArc(b, a.w, 0, a.w + g1, y1, 4);
      gapArc(b, a.w + g1 + mid.w, y1, a.w + g1 + mid.w + g2, y2, 2);
      gapArc(b, a.w + g1 + mid.w + g2 + mid2.w, y2, exit.x - b.ox, y3, 4);
      b.starsOver(mid, 2, 42, 30);
      b.starsOver(mid2, 2, 42, 30);
      b.starsOver(exit, 3, 42, 30);
      hailAbove(b, a.w + g1 / 2, { range: 90, dir: 1, phase: 0.05 });
      hailAbove(b, a.w + g1 + mid.w + g2 + mid2.w + g3 / 2, { range: 90, dir: -1, phase: 0.85 });
      b.route(a, mid, mid2, exit);
    },
  },

  // Eiswindgasse: drei lange Eiswolken hintereinander, über denen ein starker Wind weht. Rückenwind trägt den Spieler
  // über das Ende hinaus, Gegenwind drückt ihn zurück, und das Bremsen auf dem Eis braucht viel Weg. Wer früh abspringt,
  // verliert keine Zeit.
  {
    id: 'ice-wind-gust',
    name: 'Eiswindgasse',
    diff: 5.5,
    weight: 2,
    min: 1300,
    max: Infinity,
    mech: ['ice', 'wind'],
    rest: false,
    build(b) {
      const k = ramp(b, 1300);
      const vx = b.pick([-1, 1]) * Math.round(80 + 26 * k + b.rand(0, 12));
      const head = Math.max(0, -vx);
      const fromStatic = Math.max(STORM, head + 6);
      const fromIce = Math.max(ICE_HEAD, head + 6);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      let x = a.w;
      let y = 0;
      let top = 0;
      let bottom = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-22, -11, 0, 11, 22]), -34, 34);
        const gap = gapFor(b, y, ny, b.rand(0.44, 0.58), i === 0 ? fromStatic : fromIce);
        const p = b.ice(x + gap, ny, b.int(138, 166) - Math.round(8 * k));
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 44);
        route.push(p);
        x += gap + p.w;
        y = ny;
        top = Math.min(top, ny);
        bottom = Math.max(bottom, ny);
      }
      const gap = gapFor(b, y, 0, b.rand(0.44, 0.56), fromIce);
      const exit = b.ground(x + gap, 0, b.int(250, 280));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      const zx = a.w * 0.55;
      b.wind(zx, top - 175, x + gap + 90 - zx, bottom - top + 240, { vx });
      b.route(...route);
    },
  },

  // Kometenbrücke: zwei Inseln, auf jeder schlägt ein Komet in der Mitte ein, dazwischen führt je eine brüchige Wolke.
  // Auf den Inseln ist Platz zum Atmen, aber der Einschlagpunkt ist markiert: erst nach dem Einschlag durch die Mitte,
  // dann gleich weiter, denn die brüchige Wolke trägt nur kurz.
  {
    id: 'comet-crumble',
    name: 'Kometenbrücke',
    diff: 7,
    weight: 2,
    min: 1700,
    max: Infinity,
    mech: ['comet', 'breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 1700);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      const crumble = () => {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -24, 24);
        const gap = gapFor(b, y, ny, b.rand(0.5, 0.64) + 0.1 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 96, 104, 6 * k));
        gapArc(b, x, y, x + gap, ny, 2);
        b.star(x + gap + p.w / 2, ny - 46);
        route.push(p);
        x += gap + p.w;
        y = ny;
      };
      const island = (idle, dir) => {
        const ny = clamp(y + b.pick([-10, 0, 10]), -20, 20);
        const gap = gapFor(b, y, ny, b.rand(0.5, 0.62));
        const w = b.int(256, 276);
        const p = b.cloud(x + gap, ny, w);
        b.comet(x + gap + w / 2 + b.int(-10, 10), ny, { idle, dir });
        gapArc(b, x, y, x + gap, ny, 2);
        b.starArc(x + gap + w / 2 - 46, x + gap + w / 2 + 46, ny - 30, 84, 4);
        route.push(p);
        x += gap + w;
        y = ny;
      };
      crumble();
      island(b.rand(1.1, 1.4), 1);
      crumble();
      island(b.rand(2.0, 2.5), -1);
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.62));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 2, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Wolkenwache: zwei Gewitterwolken bewachen ihre Wolken, zwischen den Wolken fächert eine Hagelwolke nach unten, und
  // ein Flieger kreist über der zweiten Lücke. Der Spieler stampft, springt und wartet im Wechsel.
  {
    id: 'flyer-hail-watch',
    name: 'Wolkenwache',
    diff: 7,
    weight: 1,
    min: 1600,
    max: Infinity,
    mech: ['flyer', 'hailcloud', 'walker'],
    rest: false,
    build(b) {
      const k = ramp(b, 1600);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      const post = (w, ny, gap, dir) => {
        const p = b.cloud(x + gap, ny, w);
        const e = b.walker(p, 0.5, { dir });
        patrol(e, p, 96, w - 72, b.rand(0.2, 0.8));
        gapArc(b, x, y, x + gap, ny, 2);
        b.starArc(x + gap + 96, x + gap + w - 60, ny - 34, 72, 3);
        route.push(p);
        x += gap + w;
        y = ny;
      };
      const g1 = gapFor(b, 0, 0, b.rand(0.5, 0.64));
      post(b.int(244, 262), 0, g1, -1);
      const hailX = x;
      const y2 = b.pick([-24, -12, 12, 24]);
      const g2 = gapFor(b, y, y2, b.rand(0.66, 0.8) + 0.06 * k);
      const hailMid = hailX + g2 / 2;
      const mid = b.cloud(x + g2, y2, b.int(150, 170));
      gapArc(b, x, y, x + g2, y2, 3);
      b.starsOver(mid, 2, 42, 30);
      route.push(mid);
      x += g2 + mid.w;
      y = y2;
      const y3 = clamp(y2 + b.pick([-24, 0, 24]), -30, 30);
      const g3 = gapFor(b, y, y3, b.rand(0.6, 0.72));
      const flyMid = x + g3 / 2;
      post(b.int(244, 262), y3, g3, 1);
      const gE = gapFor(b, y, 0, b.rand(0.5, 0.64));
      const exit = b.ground(x + gE, 0, b.int(240, 270));
      gapArc(b, x, y, x + gE, 0, 2);
      b.starsOver(exit, 2, 42, 30);
      route.push(exit);
      hailAbove(b, hailMid, { range: 90, dir: 1, phase: 0.3 });
      flyerAbove(b, flyMid, { range: 110, dir: -1, phase: 0 });
      b.route(...route);
    },
  },

  // Blinkzickzack: Blinkwolken in zwei Höhen, unten und oben im Wechsel, erscheinen als Welle. Zwischen den Wolken hängen
  // Risikosterne, die zu sinken beginnen, sobald der Spieler näher kommt. Wer im Takt bleibt, holt sie im Sprung.
  {
    id: 'blink-zigzag',
    name: 'Blinkzickzack',
    diff: 6,
    weight: 2,
    min: 1400,
    max: Infinity,
    mech: ['blink', 'fallingstar'],
    rest: false,
    build(b) {
      const k = ramp(b, 1400);
      const period = b.rand(3.5, 4.0);
      const step = b.rand(0.24, 0.28);
      let phase = b.rand(0, 1);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const ny = i % 2 === 0 ? -b.int(48, 58) : -b.int(2, 10);
        const gap = gapFor(b, y, ny, b.rand(0.5, 0.64) + 0.08 * k);
        const p = b.blink(x + gap, ny, b.int(100, 112) - Math.round(6 * k), { period, phase: wrap(phase) });
        // Die erste Lücke zeigt einen sicheren Bogen, danach hängt ein Risikostern mitten über dem Sprungbogen: er sinkt auf
        // die Höhe, in der der Spieler vorbeikommt, wenn dieser beim Anzeichen des Sterns losspringt
        if (i === 0) gapArc(b, x, y, x + gap, ny, 3);
        else b.riskStar(x + gap / 2, y - 138, { triggerDist: 150, fallSpeed: 55 });
        b.star(x + gap + p.w / 2, ny - 44);
        route.push(p);
        x += gap + p.w;
        y = ny;
        phase -= step;
      }
      const gap = gapFor(b, y, 0, b.rand(0.5, 0.62));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Gewitterherde: drei Gewitterwolken teilen sich eine lange Wiese, jede in ihrer eigenen Gasse. Eine Sprungwolke über
  // dem Anlauf wirft den Spieler hoch über die erste Gasse, Sternbögen führen von Wolke zu Wolke: wer immer weiter
  // stampft, springt im Abprall bis ans Ende der Wiese und baut eine lange Combo auf.
  {
    id: 'walker-herd',
    name: 'Gewitterherde',
    diff: 5.5,
    weight: 2,
    min: 1200,
    max: Infinity,
    mech: ['walker', 'spring'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.5, 0.64));
      const rx = a.w + gap;
      const w = b.int(980, 1040);
      const meadow = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const zone = b.int(104, 118);
      const sw = b.int(76, 88);
      const sx = b.int(110, 130);
      b.spring(rx + sx, -66, sw);
      springTrail(b, rx + sx + sw / 2, -66, PHYS.MOVE_SPEED, 5, 0.2, 0.9);
      let zx = b.int(274, 292);
      for (let i = 0; i < 3; i++) {
        const e = b.walker(meadow, 0.5, { dir: i % 2 === 0 ? -1 : 1 });
        patrol(e, meadow, zx, zx + zone, b.rand(0, 1));
        b.starArc(rx + zx - 6, rx + zx + zone + 6, -30, 100, 4);
        zx += zone + b.int(96, 112);
      }
      b.starLine(rx + 40, -42, rx + sx - 20, -42, 2);
      b.starLine(rx + zx - 40, -42, rx + w - 40, -42, 2);
      b.route(a, meadow);
    },
  },

  // Wolkenarena: drei Wächter in drei Gassen einer langen Plattform: erst eine Sturmwolke, dann eine Gewitterwolke, am Ende
  // ein Hüpfer. Jeder bleibt in seiner Gasse und kündigt sich an. Eine kleine Deckung über der Sturmwolke schützt vor
  // dem Aufladen, und die Sterne darüber führen im Bogen weiter.
  {
    id: 'cloud-arena',
    name: 'Wolkenarena',
    diff: 7,
    weight: 1,
    min: 1600,
    max: Infinity,
    mech: ['charger', 'walker', 'jumper'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.5, 0.64));
      const rx = a.w + gap;
      const c0 = b.int(260, 280);
      const c1 = c0 + b.int(116, 130);
      const w0 = c1 + b.int(120, 140);
      const w1 = w0 + b.int(100, 112);
      const j0 = w1 + b.int(120, 140);
      const j1 = j0 + b.int(100, 112);
      const w = j1 + b.int(200, 240); // hinter dem Hüpfer bleibt Platz zum Abspringen
      const arena = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 3);
      const ec = b.charger(arena, 0.5, { dir: -1 });
      patrol(ec, arena, c0, c1, b.rand(0.3, 0.7));
      const ew = b.walker(arena, 0.5, { dir: b.pick([-1, 1]) });
      patrol(ew, arena, w0, w1, b.rand(0, 1));
      const ej = b.jumper(arena, 0.5, { dir: b.pick([-1, 1]) });
      patrol(ej, arena, j0, j1, b.rand(0, 1));
      // Deckung über der Streifzone der Sturmwolke
      const cw = b.int(96, 108);
      b.cloud(rx + (c0 + c1) / 2 - cw / 2, -b.int(88, 96), cw);
      b.starLine(rx + 40, -42, rx + c0 - 44, -42, 2);
      b.starArc(rx + c0 - 12, rx + c1 + 12, -30, 104, 5);
      b.starArc(rx + w0 - 10, rx + w1 + 10, -30, 96, 4);
      b.starArc(rx + j0 - 10, rx + j1 + 10, -30, 100, 4);
      b.starLine(rx + j1 + 60, -42, rx + w - 40, -42, 2);
      b.route(a, arena);
    },
  },
];
