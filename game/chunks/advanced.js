// Chunk Layouts für die mittlere und späte Spielphase (Schwierigkeit 2,5 bis 5).
// Jeder Chunk: { id, name, diff, weight, min, max, mech, rest, build(b) }. Siehe docs/ARCHITEKTUR.md.
// Koordinaten in build(b) sind lokal: x = 0 ist die linke Kante der ersten Plattform, y = 0 deren Oberkante.
// Die Reihenfolge folgt der Spielkurve: Bröckelndes Land (800 bis 1200), Windtal (1200 bis 1700), Traumsturm (ab 1700).
// Jeder Chunk lehrt eine Sache oder verbindet zwei bekannte Mechaniken. Gegner stehen nie in den ersten 220 px,
// Hindernisse nie auf dem einzigen Landeplatz einer Lücke, und jede Wartestelle ist sicher.
// Alle Lücken rechnen mit etwas Gegenwind (Sturmereignis), damit sie auch dann gültig bleiben.

import { PHYS, SPIKE } from '../constants.js';
import { maxGap } from '../reach.js';
import { safeFor } from '../validate.js';

const PW = PHYS.W; // Spielerbreite: Lücken bis zu dieser Breite brauchen keinen Anlauf
const TAU = Math.PI * 2;
const STORM = 50; // Gegenwind in px/s, mit dem jede Lücke mindestens gerechnet wird (Sturm bis 40)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Schwierigkeit des Builders, mindestens 1 (auch wenn sie fehlt)
const diffOf = (b) => Math.max(1, Number.isFinite(b.diff) ? b.diff : 1);
// Fortschritt 0 bis 1 im Spiel ab Meter from über span Meter: Chunks werden mit der Zeit etwas strenger
const ramp = (b, from, span = 1500) => clamp(((Number.isFinite(b.meter) ? b.meter : from) - from) / span, 0, 1);

// Lücke (Kante zu Kante) für einen einfachen Sprung von Höhe y1 nach y2. frac ist der Anteil dessen,
// was die Schwierigkeit erlaubt (über 1 verlangt Warten auf die richtige Stellung einer beweglichen Plattform).
function gapFor(b, y1, y2, frac, wind = STORM) {
  const room = maxGap(y1, y2, { safe: safeFor(diffOf(b)), wind });
  return Math.round(Number.isFinite(room) ? PW + (room - PW) * frac : 0);
}

// Höhe eines Standardsprungs mit vollem Lauftempo über dem Absprung nach dx Pixeln
const jumpArc = (dx) => {
  const t = dx / PHYS.MOVE_SPEED;
  return PHYS.JUMP_SPEED * t - 0.5 * PHYS.GRAVITY * t * t;
};

// Sternbogen über einer Lücke von x1 (rechte Kante links, Höhe y1) bis x2 (linke Kante rechts, Höhe y2)
function gapArc(b, x1, y1, x2, y2, n = 3) {
  b.starArc(x1 - 6, x2 + 6, Math.min(y1, y2) - 30, clamp((x2 - x1) * 0.35, 38, 72), n);
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

// Fliegende Wolken schweben mit kleinem Auf und Ab. Die Bahn liegt so knapp über der erlaubten Mindesthöhe
// (165 px über der höchsten Fläche in der Nähe), dass ein sauberer Doppelsprung von oben auf sie trifft:
// der Scheitel liegt bei 210 px, die Oberkante nie tiefer als etwa 196 px über der Fläche.
const FLYER_AMP = 6;
const flyerY = (surface) => surface - 181 - FLYER_AMP;

export const ADVANCED = [
  // Brüchige Brücke: drei bis vier brüchige Wolken tragen über eine breite Lücke. Der Spieler lernt,
  // nicht stehen zu bleiben, denn jede Wolke bricht kurz nachdem man sie betritt.
  {
    id: 'crumble-bridge',
    name: 'Brüchige Brücke',
    diff: 3,
    weight: 3,
    min: 800,
    max: 3600,
    mech: ['breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 800);
      const a = b.ground(0, 0, b.int(230, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      let x = a.w;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-16, -8, 0, 8, 16]), -32, 32);
        const gap = gapFor(b, y, ny, b.rand(0.3, 0.45) + 0.12 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 100, 114, 8 * k));
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 46);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.4, 0.55));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Sternenabgrund: eine Kette brüchiger Wolken über einem tiefen Abgrund. Zwischen zwei Wolken sinkt ein Risikostern.
  // Wer ihn will, lässt sich fallen und springt mit dem Doppelsprung zurück. Die Kette selbst bleibt sicher.
  {
    id: 'crumble-abyss-star',
    name: 'Sternenabgrund',
    diff: 4,
    weight: 2,
    min: 1000,
    max: Infinity,
    mech: ['breakable', 'fallingstar'],
    rest: false,
    build(b) {
      const k = ramp(b, 1000);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      const bait = b.int(1, n - 2); // der Stern hängt in der Lücke vor dieser Wolke (0 ist die erste Wolke nach dem Einstieg)
      let x = a.w;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -28, 28);
        const gap = gapFor(b, y, ny, b.rand(0.34, 0.48) + 0.1 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 94, 104, 4 * k));
        if (i === bait) {
          // Risikostern mitten in der Lücke, knapp unter der Plattformhöhe. Er sinkt erst, wenn der Spieler nah ist:
          // wer vom Rand läuft, ohne zu springen, streift ihn im Fallen und springt dann zurück.
          b.riskStar(x + gap / 2, Math.max(y, ny) + 6, { triggerDist: 120, fallSpeed: 60 });
        } else gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 46);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.4, 0.5));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Hüpfergehege: ein Hüpfer in der Mitte einer breiten Plattform, ringsum Sterne. Der Spieler lernt, das
  // Zusammenkauern zu lesen: er springt kurz nach dem Absprung des Hüpfers darüber oder landet auf ihm.
  {
    id: 'jumper-pen',
    name: 'Hüpfergehege',
    diff: 3,
    weight: 2,
    min: 800,
    max: 3600,
    mech: ['jumper'],
    rest: false,
    build(b) {
      const w = b.int(600, 660);
      const pen = b.ground(0, 0, w);
      const from = b.int(260, 290);
      const to = from + b.int(100, 120);
      const e = b.jumper(pen, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e, pen, from, to, b.rand(0, 1));
      b.starLine(40, -42, from - 50, -42, 3);
      b.starArc(from - 10, to + 10, -30, 100, 7); // der Bogen führt über den Hüpfer
      b.starLine(from - 28, -34, from - 28, -76, 2);
      b.starLine(to + 28, -34, to + 28, -76, 2);
      b.starLine(to + 50, -42, w - 60, -42, 4);
      const ey = b.pick([-12, 0, 12]);
      const gap = gapFor(b, 0, ey, b.rand(0.4, 0.55));
      const exit = b.ground(w + gap, ey, b.int(220, 250));
      gapArc(b, w, 0, w + gap, ey, 3);
      b.starsOver(exit, 3, 42, 30);
      b.route(pen, exit);
    },
  },

  // Kombilinie: drei Gewitterwolken auf drei dicht folgenden Wolken, Sterne im Bogen darüber.
  // Wer die erste besiegt, springt mit dem Abprall zur nächsten und baut eine Combo auf.
  {
    id: 'combo-line',
    name: 'Kombilinie',
    diff: 3,
    weight: 3,
    min: 900,
    max: 3600,
    mech: ['walker'],
    rest: false,
    build(b) {
      const k = ramp(b, 900);
      const a = b.ground(0, 0, b.int(220, 240));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const dir = b.pick([-1, 1]); // die Linie steigt oder fällt leicht
      const step = b.int(8, 14);
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const ny = clamp(y + dir * step, -32, 32);
        const gap = gapFor(b, y, ny, b.rand(0.22, 0.34));
        const w = b.int(190, 208) - Math.round(14 * k);
        const p = b.cloud(x + gap, ny, w);
        const e = b.walker(p, 0.5, { dir: i % 2 === 0 ? 1 : -1 });
        patrol(e, p, 64, w - 64, b.rand(0.2, 0.8));
        b.starArc(x + gap + 22, x + gap + w - 22, ny - 62, 70, 4);
        if (i < 2) gapArc(b, x + gap + w, ny, x + gap + w + 80, ny, 2);
        route.push(p);
        x += gap + w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.3, 0.45));
      const exit = b.ground(x + gap, 0, b.int(230, 260));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Blitzlauf: zwei Blitzzonen auf einem ebenen Lauf mit versetzten Wartezeiten. Jeder Blitz kündigt sich
  // eine volle Sekunde an. Der Spieler lernt, das Muster zu lesen und die Zone nach dem Einschlag zu queren.
  {
    id: 'lightning-run',
    name: 'Blitzlauf',
    diff: 3.5,
    weight: 2,
    min: 1000,
    max: 4000,
    mech: ['lightning'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      const gap = gapFor(b, 0, 0, b.rand(0.35, 0.5));
      const runX = a.w + gap;
      const run = b.ground(runX, 0, b.int(700, 740));
      const c1 = runX + b.int(220, 250);
      const c2 = c1 + b.int(230, 270);
      const idle1 = b.rand(1.0, 1.4);
      b.lightning(c1, { idle: idle1 });
      b.lightning(c2, { idle: idle1 + b.rand(1.1, 1.5) });
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, runX, 0, 3);
      b.starLine(runX + 36, -42, c1 - 60, -42, 3);
      b.starArc(c1 - 44, c1 + 44, -30, 84, 4); // Köder über der Zone: erst nach dem Einschlag holen
      b.starLine(c1 + 60, -42, c2 - 60, -42, 3);
      b.starArc(c2 - 44, c2 + 44, -30, 84, 4);
      b.starLine(c2 + 60, -42, runX + run.w - 40, -42, 3);
      b.route(a, run);
    },
  },

  // Seitenwind: schmale Wolken, über denen ein Seitenwind weht. Gegenwind bremst den Sprung, Rückenwind
  // schiebt über das Ziel hinaus. Stehen bleiben lohnt nicht, der Wind trägt den Spieler langsam weg.
  {
    id: 'wind-narrow',
    name: 'Seitenwind',
    diff: 3.5,
    weight: 2,
    min: 1200,
    max: Infinity,
    mech: ['wind'],
    rest: false,
    build(b) {
      const k = ramp(b, 1200);
      const vx = b.pick([-1, 1]) * Math.round(60 + 30 * k + b.rand(0, 14));
      const head = Math.max(0, -vx);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      let x = a.w;
      let y = 0;
      let top = 0;
      let bottom = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-20, -10, 0, 10, 20]), -30, 30);
        const gap = gapFor(b, y, ny, b.rand(0.4, 0.58), Math.max(STORM, head + 6));
        const p = b.cloud(x + gap, ny, b.int(84, 98) - Math.round(10 * k));
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 44);
        route.push(p);
        x += gap + p.w;
        y = ny;
        top = Math.min(top, ny);
        bottom = Math.max(bottom, ny);
      }
      const gap = gapFor(b, y, 0, b.rand(0.4, 0.55), Math.max(STORM, head + 6));
      const exit = b.ground(x + gap, 0, b.int(230, 260));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      // Die Zone beginnt hinter dem Einstieg und endet über dem Ausstieg
      const zx = a.w * 0.55;
      b.wind(zx, top - 175, x + gap + 90 - zx, bottom - top + 230, { vx });
      b.route(...route);
    },
  },

  // Aufwindtreppe: die erste Wolke liegt höher, als ein einfacher Sprung reicht. Eine Säule aus Aufwind trägt den
  // Spieler hinauf, ein Doppelsprung ginge auch. Sterne in der Säule zeigen, wie hoch es geht.
  {
    id: 'updraft-climb',
    name: 'Aufwindtreppe',
    diff: 3.5,
    weight: 2,
    min: 1200,
    max: Infinity,
    mech: ['wind'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const dy1 = -b.int(146, 152); // höher als ein einfacher Sprung (122), mit Aufwind gut erreichbar
      const g1 = gapFor(b, 0, dy1, b.rand(0.3, 0.42));
      const hill = b.cloud(a.w + g1, dy1, b.int(130, 150));
      const dy2 = dy1 + b.pick([-20, -10, 0, 10]);
      const g2 = gapFor(b, dy1, dy2, b.rand(0.3, 0.42));
      const hx = a.w + g1 + hill.w; // rechte Kante der hohen Wolke
      const exit = b.ground(hx + g2, dy2, b.int(250, 280));
      // Sternsäule im Aufwind, dazu Sterne auf der Höhe und ein Bogen zum Ausstieg
      b.starLine(a.w + g1 / 2, -34, a.w + g1 / 2, dy1 - 56, 5);
      b.starsOver(hill, 2, 42, 30);
      gapArc(b, hx, dy1, hx + g2, dy2, 3);
      b.starsOver(exit, 4, 42, 30);
      // Die Säule beginnt etwas vor der Lücke und reicht ein Stück über die hohe Wolke
      b.wind(a.w - 40, dy1 - 150, g1 + 120, 150 - dy1 + 38, { ay: -b.int(580, 640) });
      b.route(a, hill, exit);
    },
  },

  // Wolkenflieger: zwei Flieger schweben hoch über einer Lücke, die Route führt darunter durch. Wer mutig ist,
  // springt doppelt und landet von oben auf einem Flieger. Die Sterne über ihnen zeigen, wo der Abprall hinträgt.
  {
    id: 'flyer-gap',
    name: 'Wolkenflieger',
    diff: 3.5,
    weight: 2,
    min: 1200,
    max: Infinity,
    mech: ['flyer'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      const ey = b.pick([0, 0, 10, 14]); // der Einstieg bleibt die höchste Fläche, die Flieger hängen genau darüber
      const gap = gapFor(b, 0, ey, b.rand(0.7, 0.85));
      const exit = b.ground(a.w + gap, ey, b.int(250, 280));
      const fy = flyerY(0);
      const range = b.int(96, 120);
      // Mitte der Bahnen: nie weiter links, als der sichere Anfang erlaubt (Mitte minus halbe Bahn minus halbe Breite)
      const lo = 226 + range / 2 + 21;
      const c1 = Math.max(lo, a.w + gap * 0.32);
      const c2 = Math.max(c1 + 50, a.w + gap * 0.7);
      b.flyer(c1, fy, { range, dir: 1, phase: 0, amp: FLYER_AMP });
      b.flyer(c2, fy - b.int(0, 4), { range, dir: -1, phase: Math.PI, amp: FLYER_AMP });
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + gap, ey, 4);
      b.starsOver(exit, 4, 42, 30);
      // Der mutige Weg: ein Bogen über beiden Fliegern, im Bereich eines Abpralls nach dem Stomp
      b.starArc(c1 - range / 2, c2 + range / 2, fy - 52, 22, 5);
      b.route(a, exit);
    },
  },

  // Sturmarena: eine breite Plattform mit einer Sturmwolke, die auflädt und losstürmt. Die kleine Wolke darüber
  // ist Deckung, denn die Sturmwolke sieht nur, wer auf ihrer Höhe steht. Von dort lässt sich auf sie herabspringen.
  {
    id: 'charger-arena',
    name: 'Sturmarena',
    diff: 4,
    weight: 2,
    min: 1200,
    max: Infinity,
    mech: ['charger'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const ay = b.pick([-12, 0, 0, 12]);
      const gap = gapFor(b, 0, ay, b.rand(0.45, 0.6));
      const ax = a.w + gap; // lokales x der Arena
      const w = b.int(560, 600);
      const arena = b.ground(ax, ay, w);
      const from = b.int(190, 210);
      const to = from + b.int(190, 210);
      const e = b.charger(arena, 0.5, { dir: -1 });
      patrol(e, arena, from, to, b.rand(0.3, 0.7));
      // Deckung: mehr als 70 px über dem Boden, außerhalb der Sichtweite des Chargers
      const cw = b.int(96, 112);
      const cy = ay - b.int(86, 94);
      const cx = ax + (from + to) / 2 - cw / 2 + b.int(-30, 30);
      b.cloud(cx, cy, cw);
      gapArc(b, a.w, 0, ax, ay, 3);
      b.starLine(ax + 30, ay - 42, ax + from - 44, ay - 42, 3);
      b.starArc(ax + from - 14, ax + to + 50, ay - 30, 104, 7); // der Bogen führt über die Sturmwolke
      b.star(cx + cw / 2, cy - 44);
      b.starLine(ax + to + 80, ay - 42, ax + w - 44, ay - 42, 4);
      b.route(a, arena);
    },
  },

  // Wolkenkette: zwei bewegliche Wolken hintereinander, die erste schwingt waagerecht, die zweite senkrecht.
  // Beide haben denselben Takt. Der Spieler wartet auf die Stellung, in der der Sprung passt, und reitet weiter.
  {
    id: 'moving-chain',
    name: 'Wolkenkette',
    diff: 4,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['moving'],
    rest: false,
    build(b) {
      const period = b.rand(3.8, 4.4);
      const phase = b.rand(0, TAU);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      // Erste Wolke: waagerecht. Der weiteste Abstand verlangt Warten, der nächste lässt 24 px Luft.
      const wh = b.int(112, 124);
      const far1 = gapFor(b, 0, 0, b.rand(1.05, 1.16), 0);
      const axh = Math.floor(Math.min(b.int(60, 72), (far1 - 24) / 2));
      const cx = a.w + far1 - axh;
      const ferry = b.moving(cx, 0, wh, { ax: axh, period, phase });
      // Zweite Wolke: senkrecht, ein Stück höher gelegen. Ihre Bahn liegt rechts von der ersten.
      const ayv = b.int(38, 48);
      const mid = -b.int(8, 20);
      const wv = b.int(108, 120);
      const far2 = gapFor(b, 0, mid - ayv * 0.5, b.rand(1.02, 1.14), 0);
      const vx = cx - axh + wh + far2;
      const lift = b.moving(vx, mid, wv, { ay: ayv, period, phase: phase + b.pick([Math.PI * 0.5, Math.PI * 1.5]) });
      // Ausstieg: auf Höhe der Mitte der zweiten Wolke
      const ey = mid + b.pick([-8, 0, 8]);
      const gap3 = gapFor(b, mid - ayv * 0.5, ey, b.rand(0.6, 0.75));
      const exit = b.ground(vx + wv + gap3, ey, b.int(250, 280));
      b.starLine(a.w + 10, -52, cx + wh / 2, -64, 3);
      b.star(cx + wh / 2, -58);
      b.starLine(cx + axh + wh + 8, -56, vx + wv / 2, mid - ayv - 36, 3);
      b.starLine(vx + wv / 2, mid + ayv - 30, vx + wv / 2, mid - ayv - 36, 4);
      b.starArc(vx + wv, vx + wv + gap3, Math.min(mid - ayv, ey) - 20, 50, 3);
      b.starsOver(exit, 4, 42, 30);
      b.route(a, ferry, lift, exit);
    },
  },

  // Sternenregen: Risikosterne schweben über einer breiten Lücke und beginnen zu sinken, sobald der Spieler näher kommt.
  // Sie sinken genau in die Flugbahn eines Sprungs. Wer zögert, sieht sie im Abgrund verschwinden.
  {
    id: 'falling-star-gap',
    name: 'Sternenregen',
    diff: 3,
    weight: 2,
    min: 800,
    max: 3600,
    mech: ['fallingstar'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const ey = b.pick([-10, 0, 0, 10]);
      const gap = gapFor(b, 0, ey, b.rand(0.78, 0.9));
      const exit = b.ground(a.w + gap, ey, b.int(250, 280));
      const trigger = 260;
      const fall = b.int(52, 62);
      const drop = (fall * trigger) / PHYS.MOVE_SPEED; // so tief sinkt der Stern, bis der Spieler ihn erreicht
      const n = b.int(3, 4);
      for (let i = 0; i < n; i++) {
        const dx = (gap * (i + 1)) / (n + 1);
        // Der Stern soll beim Eintreffen des Spielers auf der Mitte eines Standardsprungs hängen
        const y = -(jumpArc(dx + PW / 2) + PHYS.H / 2 + drop);
        b.riskStar(a.w + dx, Math.min(y, -50), { triggerDist: trigger, fallSpeed: fall });
      }
      b.starLine(a.w + 20, -44, a.w + gap - 20, ey - 44, 3);
      b.starsOver(exit, 4, 42, 30);
      b.route(a, exit);
    },
  },

  // Sturmüberquerung: Wind, brüchige Wolken und ein Blitz zusammen. Auf der festen Insel in der Mitte ist
  // Zeit zum Atmen, dort liegt auch die erste Blitzzone. Der Spieler wartet den Einschlag ab und läuft dann weiter.
  {
    id: 'storm-crossing',
    name: 'Sturmüberquerung',
    diff: 5,
    weight: 2,
    min: 1700,
    max: Infinity,
    mech: ['lightning', 'wind', 'breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 1700);
      const vx = b.pick([-1, 1]) * Math.round(78 + 24 * k + b.rand(0, 8));
      const wind = Math.max(STORM, Math.max(0, -vx) + 6);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const before = b.int(1, 2); // brüchige Wolken vor der Insel, der Rest dahinter
      let x = a.w;
      let y = 0;
      let top = 0;
      let bottom = 0;
      const hop = (frac) => {
        const ny = clamp(y + b.pick([-16, -8, 0, 8, 16]), -24, 24);
        return { ny, gap: gapFor(b, y, ny, frac, wind) };
      };
      const land = (p, ny, gap) => {
        gapArc(b, x, y, x + gap, ny, 3);
        route.push(p);
        x += gap + p.w;
        y = ny;
        top = Math.min(top, ny);
        bottom = Math.max(bottom, ny);
      };
      for (let i = 0; i < before; i++) {
        const { ny, gap } = hop(b.rand(0.3, 0.42));
        const p = b.breakable(x + gap, ny, crumbleW(b, 96, 106, 6 * k));
        b.star(x + gap + p.w / 2, ny - 46);
        land(p, ny, gap);
      }
      // Insel mit der ersten Blitzzone, etwas hinter der Mitte, damit der Landeplatz davor frei bleibt
      const isl = hop(b.rand(0.3, 0.42));
      const island = b.cloud(x + isl.gap, isl.ny, b.int(240, 260));
      const ix = x + isl.gap;
      const idle1 = b.rand(1.0, 1.4);
      b.lightning(ix + island.w * 0.56, { idle: idle1 });
      b.starArc(ix + island.w * 0.56 - 44, ix + island.w * 0.56 + 44, isl.ny - 30, 80, 4);
      land(island, isl.ny, isl.gap);
      for (let i = before; i < 3; i++) {
        const { ny, gap } = hop(b.rand(0.3, 0.42));
        const p = b.breakable(x + gap, ny, crumbleW(b, 96, 106, 6 * k));
        b.star(x + gap + p.w / 2, ny - 46);
        land(p, ny, gap);
      }
      const gap = gapFor(b, y, 0, b.rand(0.3, 0.42), wind);
      const exit = b.ground(x + gap, 0, b.int(290, 310));
      b.lightning(x + gap + exit.w * 0.45, { idle: idle1 + b.rand(1.1, 1.5) });
      b.starLine(x + gap + 36, -42, x + gap + exit.w * 0.45 - 60, -42, 2);
      b.starsOver(exit, 2, 42, 30);
      gapArc(b, x, y, x + gap, 0, 3);
      route.push(exit);
      // Der Wind weht vom Einstieg bis über den Ausstieg
      const zx = a.w * 0.55;
      b.wind(zx, top - 175, x + gap + 90 - zx, bottom - top + 230, { vx });
      b.route(...route);
    },
  },

  // Spießrutenlauf: eine Gewitterwolke, eine Stachelwolke und eine bewegliche Wolke, eine nach der anderen,
  // jede mit freier Landung davor. Der Spieler wendet an, was er bisher gelernt hat.
  {
    id: 'gauntlet',
    name: 'Spießrutenlauf',
    diff: 5,
    weight: 2,
    min: 1700,
    max: Infinity,
    mech: ['walker', 'spike', 'moving'],
    rest: false,
    build(b) {
      // 1. Gewitterwolke: der Einstieg ist lang, die ersten 250 px bleiben frei
      const a = b.ground(0, 0, b.int(470, 490));
      const e1 = b.walker(a, 0.5, { dir: 1 });
      patrol(e1, a, 260, a.w - 130);
      b.starLine(36, -42, 220, -42, 3);
      b.starArc(270, a.w - 140, -30, 84, 5);
      b.starLine(a.w - 100, -42, a.w - 40, -42, 2);
      // 2. Stachelwolke mit Anlauf davor und Platz dahinter
      const y2 = b.pick([-10, 0, 10]);
      const g2 = gapFor(b, 0, y2, b.rand(0.35, 0.45));
      const p2 = b.ground(a.w + g2, y2, b.int(250, 262));
      const off = b.int(96, 108);
      b.spike(p2, off / (p2.w - SPIKE.w));
      gapArc(b, a.w, 0, a.w + g2, y2, 3);
      b.starArc(a.w + g2 + off - 36, a.w + g2 + off + SPIKE.w + 36, y2 - 30, 70, 5);
      // 3. Fähre: die waagerechte Wolke verlangt Timing
      const x = a.w + g2 + p2.w;
      const wf = b.int(110, 122);
      const far1 = gapFor(b, y2, y2, b.rand(1.04, 1.14), 0);
      const axf = Math.floor(Math.min(b.int(50, 60), (far1 - 24) / 2));
      const cx = x + far1 - axf;
      const ferry = b.moving(cx, y2, wf, { ax: axf, period: b.rand(3.6, 4.2), phase: b.rand(0, TAU) });
      b.star(cx + wf / 2, y2 - 56);
      // 4. Ausstieg mit der zweiten Gewitterwolke im vorderen Teil
      const far2 = gapFor(b, y2, y2, b.rand(1.0, 1.1), 0);
      const ex = cx - axf + wf + far2;
      const exit = b.ground(ex, y2, b.int(290, 300));
      const e2 = b.walker(exit, 0.5, { dir: -1 });
      patrol(e2, exit, 76, 176);
      b.starArc(ex + 70, ex + 190, y2 - 30, 84, 5);
      b.starLine(ex + 216, y2 - 42, ex + exit.w - 36, y2 - 42, 2);
      b.route(a, p2, ferry, exit);
    },
  },

  // Himmelskombo: Flieger und Gewitterwolken wechseln sich ab. Wer die Walker besiegt und mit dem Abprall und
  // einem Doppelsprung auf die Flieger fällt, baut eine lange Combo auf. Die sichere Route läuft darunter durch.
  {
    id: 'combo-flyers',
    name: 'Himmelskombo',
    diff: 4,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['flyer', 'walker'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const y1 = b.pick([0, 0, 10]); // der Einstieg bleibt die höchste Fläche, die Flieger hängen genau darüber
      const g1 = gapFor(b, 0, y1, b.rand(0.6, 0.72));
      const mw = b.int(210, 230);
      const mid = b.ground(a.w + g1, y1, mw);
      const y2 = y1 + b.pick([0, 0, 10]);
      const g2 = gapFor(b, y1, y2, b.rand(0.6, 0.72));
      const exit = b.ground(a.w + g1 + mw + g2, y2, b.int(250, 280));
      const e = b.walker(mid, 0.5, { dir: 1 });
      patrol(e, mid, 66, mw - 66);
      const fy = flyerY(0);
      const range = b.int(90, 110);
      const lo = 226 + range / 2 + 21;
      const c1 = Math.max(lo, a.w + g1 / 2);
      const c2 = a.w + g1 + mw + g2 / 2;
      b.flyer(c1, fy, { range, dir: 1, phase: 0, amp: FLYER_AMP });
      b.flyer(c2, fy - b.int(0, 4), { range, dir: -1, phase: Math.PI, amp: FLYER_AMP });
      gapArc(b, a.w, 0, a.w + g1, y1, 3);
      b.starArc(a.w + g1 + 40, a.w + g1 + mw - 40, y1 - 62, 66, 5);
      gapArc(b, a.w + g1 + mw, y1, a.w + g1 + mw + g2, y2, 3);
      b.starsOver(exit, 3, 42, 30);
      // Hohe Bögen über den Fliegern: sie liegen im Bereich des Abpralls nach dem Stomp
      b.starArc(c1 - range / 2, c1 + range / 2, fy - 52, 22, 4);
      b.starArc(c2 - range / 2, c2 + range / 2, fy - 52, 22, 4);
      b.route(a, mid, exit);
    },
  },

  // Kraftschrein: ein Schrein mit einem Powerup auf einer hohen Wolke. Nur ein Doppelsprung reicht hinauf.
  // Ein ruhiger Chunk: kein Gegner, kein Hindernis. Die Sternreihe zeigt den Weg nach oben.
  {
    id: 'power-shrine',
    name: 'Kraftschrein',
    diff: 2.5,
    weight: 1,
    min: 800,
    max: Infinity,
    mech: ['powerup'],
    rest: true,
    build(b) {
      const w = b.int(620, 680);
      const g = b.ground(0, 0, w);
      const sw = b.int(112, 128);
      const sx = w / 2 - sw / 2 + b.int(-50, 50);
      const sy = -b.int(146, 156); // mehr als ein einfacher Sprung (122), weniger als zwei (210)
      b.cloud(sx, sy, sw);
      b.powerup(b.pick(['dash', 'magnet', 'feather']), sx + sw / 2, sy - 34);
      b.starLine(40, -42, sx - 100, -42, 4);
      b.starLine(sx - 92, -60, sx - 14, sy - 30, 4); // Treppe aus Sternen zum Schrein
      b.starArc(sx + sw + 10, sx + sw + 120, -30, 70, 3);
      b.starLine(sx + sw + 140, -42, w - 40, -42, 4);
      b.route(g);
    },
  },

  // Bröckelregen: Regen über brüchigen Wolken. Der Boden ist rutschig, die Wolken sind knapp bemessen
  // und bröckeln trotzdem. Der Spieler lernt, auch auf glattem Grund in Bewegung zu bleiben.
  {
    id: 'rain-crumble',
    name: 'Bröckelregen',
    diff: 3.5,
    weight: 2,
    min: 1000,
    max: 4000,
    mech: ['rain', 'breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 1000);
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const n = b.int(3, 4);
      let x = a.w;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -28, 28);
        const gap = gapFor(b, y, ny, b.rand(0.3, 0.42) + 0.1 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 96, 108, 4 * k));
        gapArc(b, x, y, x + gap, ny, 3);
        b.star(x + gap + p.w / 2, ny - 46);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.35, 0.5));
      const exit = b.ground(x + gap, 0, b.int(240, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 4, 42, 30);
      route.push(exit);
      // Zwei Regenwolken nebeneinander decken die ganze Kette: die erste regnet beim Eintreffen, die zweite etwas später
      const rx = a.w - 40;
      const half = Math.round((x + 30 - rx) / 2) + 10;
      b.rain(rx, half, { offset: b.rand(3.6, 6.2) });
      b.rain(rx + half - 20, x + 30 - (rx + half - 20), { offset: b.rand(0.5, 2.5) });
      b.route(...route);
    },
  },

  // Blitzschlucht: je eine Blitzzone mitten über zwei Lücken. Dazwischen liegt eine feste Insel zum Abwarten.
  // Der Spieler wartet den Einschlag ab und springt in der Pause danach durch die Zone.
  {
    id: 'lightning-gap',
    name: 'Blitzschlucht',
    diff: 4,
    weight: 2,
    min: 1100,
    max: Infinity,
    mech: ['lightning'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const y1 = b.pick([-12, 0, 0, 12]);
      const g1 = gapFor(b, 0, y1, b.rand(0.8, 0.92));
      const mw = b.int(230, 260);
      const mid = b.ground(a.w + g1, y1, mw);
      const y2 = clamp(y1 + b.pick([-12, 0, 12]), -24, 24);
      const g2 = gapFor(b, y1, y2, b.rand(0.8, 0.92));
      const mx2 = a.w + g1 + mw; // linke Kante der zweiten Lücke
      const exit = b.ground(mx2 + g2, y2, b.int(250, 280));
      const idle1 = b.rand(1.0, 1.5);
      b.lightning(a.w + g1 / 2, { idle: idle1 });
      b.lightning(mx2 + g2 / 2, { idle: idle1 + b.rand(1.1, 1.6) });
      // Die Sternbögen führen durch die Zonen: wer sie will, muss den Einschlag abwarten
      gapArc(b, a.w, 0, a.w + g1, y1, 5);
      gapArc(b, mx2, y1, mx2 + g2, y2, 5);
      b.starsOver(mid, 3, 42, 40);
      b.starsOver(exit, 4, 42, 30);
      b.route(a, mid, exit);
    },
  },

  // Hüpferpaar: zwei Hüpfer auf einer sehr langen Plattform. Zwischen ihren Streifzonen bleibt eine freie Gasse.
  // Sie hüpfen unabhängig voneinander, der Spieler liest jeden einzeln und nimmt sich Zeit dazwischen.
  {
    id: 'jumper-pair',
    name: 'Hüpferpaar',
    diff: 4,
    weight: 2,
    min: 1300,
    max: Infinity,
    mech: ['jumper'],
    rest: false,
    build(b) {
      const w = b.int(860, 920);
      const g = b.ground(0, 0, w);
      const zone = b.int(100, 116);
      const x1 = b.int(250, 280);
      const x2 = x1 + zone + b.int(160, 190);
      const e1 = b.jumper(g, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e1, g, x1, x1 + zone, b.rand(0, 1));
      const e2 = b.jumper(g, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e2, g, x2, x2 + zone, b.rand(0, 1));
      b.starLine(40, -42, x1 - 50, -42, 3);
      b.starArc(x1 - 10, x1 + zone + 10, -30, 100, 6);
      b.starLine(x1 + zone + 44, -42, x2 - 44, -42, 4); // die Gasse zwischen den Hüpfern
      b.starArc(x2 - 10, x2 + zone + 10, -30, 100, 6);
      b.starLine(x2 + zone + 50, -42, w - 50, -42, 3);
      b.route(g);
    },
  },

  // Gewitterspaziergang: eine lange Wiese im Sturm. Der Regen macht den Boden glatt, ein Hüpfer wartet mitten im
  // Regen, und dahinter schlägt ein Blitz ein. Wer rutscht, hat Zeit verloren, wer wartet, ist sicher.
  {
    id: 'thunder-stroll',
    name: 'Gewitterspaziergang',
    diff: 4,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['rain', 'jumper', 'lightning'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.4, 0.55));
      const lx = a.w + gap;
      const w = b.int(900, 940);
      const meadow = b.ground(lx, 0, w);
      const from = b.int(290, 320);
      const zone = b.int(100, 116);
      const e = b.jumper(meadow, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e, meadow, from, from + zone, b.rand(0, 1));
      const bolt = from + zone + b.int(190, 230);
      b.lightning(lx + bolt, { idle: b.rand(1.0, 1.5) });
      // Zwei Regenwolken: die erste regnet beim Eintreffen, die zweite etwas später
      b.rain(lx + 10, 300, { offset: b.rand(3.6, 6.2) });
      b.rain(lx + 240, 400, { offset: b.rand(0.5, 2.5) });
      gapArc(b, a.w, 0, lx, 0, 3);
      b.starLine(lx + 40, -42, lx + from - 44, -42, 3);
      b.starArc(lx + from - 10, lx + from + zone + 10, -30, 100, 6);
      b.starLine(lx + from + zone + 44, -42, lx + bolt - 80, -42, 3);
      b.starArc(lx + bolt - 44, lx + bolt + 44, -30, 84, 4);
      b.starLine(lx + bolt + 70, -42, lx + w - 40, -42, 3);
      b.route(a, meadow);
    },
  },

  // Sturmwolkenbrücke: eine Sturmwolke bewacht die lange Plattform vor einer Brücke aus brüchigen Wolken.
  // Erst die Sturmwolke überlisten, dann ohne Zögern über die Brücke. Der Spieler verbindet beide Lektionen.
  {
    id: 'charger-bridge',
    name: 'Sturmwolkenbrücke',
    diff: 4,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['charger', 'breakable'],
    rest: false,
    build(b) {
      const k = ramp(b, 1500);
      const a = b.ground(0, 0, b.int(500, 530));
      const from = b.int(250, 262);
      const to = from + b.int(130, 150);
      const e = b.charger(a, 0.5, { dir: -1 });
      patrol(e, a, from, to, b.rand(0.3, 0.7));
      b.starLine(36, -42, from - 44, -42, 3);
      b.starArc(from - 14, to + 40, -30, 100, 5); // der Bogen führt über die Sturmwolke
      b.starLine(to + 70, -42, a.w - 30, -42, 2);
      const route = [a];
      let x = a.w;
      let y = 0;
      const n = b.int(2, 3);
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -24, 24);
        const g = gapFor(b, y, ny, b.rand(0.34, 0.46) + 0.1 * k);
        const p = b.breakable(x + g, ny, crumbleW(b, 96, 106, 4 * k));
        gapArc(b, x, y, x + g, ny, 3);
        b.star(x + g + p.w / 2, ny - 46);
        route.push(p);
        x += g + p.w;
        y = ny;
      }
      const g = gapFor(b, y, 0, b.rand(0.4, 0.5));
      const exit = b.ground(x + g, 0, b.int(240, 260));
      gapArc(b, x, y, x + g, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Windfähre: eine schwingende Wolke trägt über eine breite Lücke, und ein kräftiger Wind weht darüber.
  // Gegenwind verkürzt den Sprung, Rückenwind trägt weiter. Der Spieler wartet auf die Fähre und springt zur richtigen Zeit.
  {
    id: 'gust-ferry',
    name: 'Windfähre',
    diff: 4,
    weight: 2,
    min: 1500,
    max: Infinity,
    mech: ['moving', 'wind'],
    rest: false,
    build(b) {
      const k = ramp(b, 1500);
      const vx = b.pick([-1, 1]) * Math.round(70 + 26 * k + b.rand(0, 10));
      const wind = Math.max(0, -vx); // die Fähre soll bei jedem Wetter Timing verlangen
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 3, 42, 30);
      const ey = b.pick([-12, 0, 12]);
      const wf = b.int(112, 124);
      const far1 = gapFor(b, 0, 0, b.rand(1.04, 1.14), wind);
      const axf = Math.floor(Math.min(b.int(54, 64), (far1 - 24) / 2));
      const cx = a.w + far1 - axf;
      const ferry = b.moving(cx, 0, wf, { ax: axf, period: b.rand(3.8, 4.4), phase: b.rand(0, TAU) });
      const far2 = gapFor(b, 0, ey, b.rand(1.0, 1.1), wind);
      const ex = cx - axf + wf + far2;
      const exit = b.ground(ex, ey, b.int(260, 280));
      b.starLine(a.w + 10, -52, cx + wf / 2, -66, 3);
      b.star(cx + wf / 2, -60);
      b.starLine(cx + wf / 2 + 40, -64, ex + 10, ey - 52, 3);
      b.starArc(cx - axf, cx + axf + wf, -34, 56, 4); // der Köder auf der ganzen Fährenbahn
      b.starsOver(exit, 4, 42, 30);
      const lo = Math.min(0, ey);
      const hi = Math.max(0, ey);
      const zx = a.w * 0.6;
      b.wind(zx, lo - 175, ex + 90 - zx, hi - lo + 230, { vx });
      b.route(a, ferry, exit);
    },
  },
];
