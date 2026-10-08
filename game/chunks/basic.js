// Chunk Layouts für die frühe Spielphase (Schwierigkeit 1 bis 2,5).
// Jeder Chunk: { id, name, diff, weight, min, max, mech, rest, build(b) }. Siehe docs/ARCHITEKTUR.md.
// Koordinaten in build(b) sind lokal: x = 0 ist die linke Kante der ersten Plattform, y = 0 deren Oberkante.
// Die Reihenfolge folgt der Spielkurve: Tutorial, erste Gegner, Wolkenwege.
// Jeder Einstieg ist mindestens 200 px breit: so findet der Respawn immer eine breite Plattform voraus.

import { PHYS, RAIN, SPIKE } from '../constants.js';
import { maxGap } from '../reach.js';
import { safeFor } from '../validate.js';

const PW = PHYS.W; // Spielerbreite: Lücken bis zu dieser Breite brauchen keinen Anlauf
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Schwierigkeit des Builders, mindestens 1 (auch wenn sie fehlt)
const diffOf = (b) => Math.max(1, Number.isFinite(b.diff) ? b.diff : 1);

// Lücke (Kante zu Kante) für einen einfachen Sprung von Höhe y1 nach y2. frac ist der Anteil dessen,
// was die Schwierigkeit erlaubt. So wachsen die Lücken mit b.diff, ohne dass ein Chunk die Sprungmathematik kennt.
function gapFor(b, y1, y2, frac) {
  const room = maxGap(y1, y2, { safe: safeFor(diffOf(b)) });
  return Math.round(Number.isFinite(room) ? PW + (room - PW) * frac : 0);
}

// So viele Pixel (bis px) werden Plattformen mit steigender Schwierigkeit schmaler: ab diff 3 voll, bei diff 1 gar nicht
const tight = (b, px) => Math.round(px * clamp((diffOf(b) - 1) / 2, 0, 1));

// Sternbogen über einer Lücke von x1 (linke Kante der Lücke, Höhe y1) bis x2 (rechte Kante, Höhe y2)
function gapArc(b, x1, y1, x2, y2, n = 4) {
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

// Stachelwolke im Abstand off von der linken Plattformkante, dazu ein Sternbogen als Hinweis.
// px, py: lokale Position der Plattform.
function spikeWithArc(b, plat, px, py, off) {
  const h = b.spike(plat, off / (plat.w - SPIKE.w));
  b.starArc(px + off - 34, px + off + SPIKE.w + 34, py - 30, 68, 5);
  return h;
}

export const BASIC = [
  // Die ruhige Wiese: breite Plattform, Sterne zum Einsammeln. Der Spieler lernt Laufen und Springen.
  {
    id: 'meadow',
    name: 'Wiese',
    diff: 1,
    weight: 3,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const g = b.ground(0, 0, b.int(520, 700));
      b.starsOver(g, b.int(5, 8), 55);
      b.route(g);
    },
  },

  // Trittsteine: kleine Wolken mit kleinen Lücken. Der Spieler übt kurze Sprünge von Stein zu Stein.
  {
    id: 'stepping-stones',
    name: 'Trittsteine',
    diff: 1,
    weight: 3,
    min: 0,
    max: 1000,
    mech: [],
    rest: false,
    build(b) {
      const first = b.ground(0, 0, b.int(200, 230));
      b.starsOver(first, 3, 42, 30);
      const route = [first];
      const n = b.int(3, 4);
      let x = first.w;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        const ny = clamp(y + b.pick([-24, -12, 0, 0, 12, 24]), -48, 36);
        const gap = gapFor(b, y, ny, b.rand(0.3, 0.55));
        const p = b.cloud(x + gap, ny, last ? b.int(150, 175) : b.int(96, 124) - tight(b, 24));
        gapArc(b, x, y, x + gap, ny, 3);
        if (last) b.starsOver(p, 3, 42, 30);
        else b.star(x + gap + p.w / 2, ny - 42);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      b.route(...route);
    },
  },

  // Erste Lücke: ein echter Abgrund mit Sternbogen. Der Bogen zeigt, wie der Sprung verläuft.
  {
    id: 'first-gap',
    name: 'Erste Lücke',
    diff: 1,
    weight: 3,
    min: 0,
    max: 1000,
    mech: [],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(260, 340));
      const dy = b.pick([-16, 0, 0, 16]);
      const gap = gapFor(b, 0, dy, b.rand(0.6, 0.85));
      const c = b.ground(a.w + gap, dy, b.int(260, 340));
      b.starsOver(a, 4, 42, 40);
      gapArc(b, a.w, 0, a.w + gap, dy, 5);
      b.starsOver(c, 5, 42, 40);
      b.route(a, c);
    },
  },

  // Treppe nach oben: Wolkenstufen, jede etwas höher. Der Spieler lernt, Höhe zu gewinnen.
  {
    id: 'stairs-up',
    name: 'Treppe nach oben',
    diff: 1,
    weight: 2,
    min: 0,
    max: 1400,
    mech: [],
    rest: false,
    build(b) {
      const first = b.ground(0, 0, b.int(200, 230));
      b.starsOver(first, 3, 42, 30);
      const route = [first];
      const levels = b.int(3, 4);
      let x = first.w;
      let y = 0;
      for (let i = 0; i < levels; i++) {
        const last = i === levels - 1;
        const ny = y - b.int(26, 36);
        const gap = gapFor(b, y, ny, b.rand(0.3, 0.55));
        const p = last ? b.ground(x + gap, ny, b.int(210, 250)) : b.cloud(x + gap, ny, b.int(120, 150) - tight(b, 20));
        gapArc(b, x, y, x + gap, ny, 3);
        b.starsOver(p, last ? 5 : 2, 42, 30);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      b.route(...route);
    },
  },

  // Treppe nach unten: der Weg führt abwärts. Der Spieler lernt, dass Fallen und Weiterlaufen sicher ist.
  {
    id: 'stairs-down',
    name: 'Treppe nach unten',
    diff: 1,
    weight: 2,
    min: 0,
    max: 1400,
    mech: [],
    rest: false,
    build(b) {
      const first = b.ground(0, 0, b.int(200, 240));
      b.starsOver(first, 4, 42, 30);
      const route = [first];
      const levels = b.int(2, 3); // der Abstieg bleibt flach, damit der Chunk auch nach tiefen Ausstiegen passt
      let x = first.w;
      let y = 0;
      for (let i = 0; i < levels; i++) {
        const last = i === levels - 1;
        const ny = y + b.int(28, 38);
        const gap = gapFor(b, y, ny, b.rand(0.3, 0.55));
        const p = last ? b.ground(x + gap, ny, b.int(210, 250)) : b.cloud(x + gap, ny, b.int(120, 150) - tight(b, 20));
        gapArc(b, x, y, x + gap, ny, 3);
        b.starsOver(p, last ? 5 : 2, 42, 30);
        route.push(p);
        x += gap + p.w;
        y = ny;
      }
      b.route(...route);
    },
  },

  // Sanfte Hügel: Auf und Ab ohne echte Lücken, lange Sternreihen. Ein ruhiger Chunk zum Sammeln.
  {
    id: 'rolling-hills',
    name: 'Sanfte Hügel',
    diff: 1,
    weight: 2,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const first = b.ground(0, 0, b.int(200, 250));
      b.starsOver(first, 5, 42, 24);
      const route = [first];
      const n = b.int(3, 4);
      let dir = b.pick([-1, 1]);
      let x = first.w;
      let y = 0;
      for (let i = 1; i < n; i++) {
        const ny = y + dir * b.int(14, 28);
        const px = x + b.int(20, 40);
        const p = b.ground(px, ny, b.int(190, 250));
        b.starsOver(p, 5, 42, 24);
        route.push(p);
        x = px + p.w;
        y = ny;
        dir = -dir;
      }
      b.route(...route);
    },
  },

  // Sternenallee: eine lange Plattform mit einer Sternenwelle. Reine Belohnung, kein Risiko.
  {
    id: 'star-avenue',
    name: 'Sternenallee',
    diff: 1,
    weight: 1,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const w = b.int(620, 760);
      const g = b.ground(0, 0, w);
      const n = 14;
      const phase = b.rand(0, TAU);
      for (let i = 0; i < n; i++) b.star(60 + ((w - 120) * i) / (n - 1), -46 - 18 * Math.sin(phase + i * 0.9));
      b.route(g);
    },
  },

  // Wolkenpfad: ein Weg aus breiten Wolken, nur durch schmale Spalten getrennt. Ruhig und voller Sterne.
  {
    id: 'cloud-walk',
    name: 'Wolkenpfad',
    diff: 1,
    weight: 2,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const first = b.ground(0, 0, b.int(200, 240));
      b.starsOver(first, 4, 42, 24);
      const route = [first];
      const n = b.int(3, 4);
      let x = first.w;
      for (let i = 0; i < n; i++) {
        const px = x + b.int(24, 40);
        const p = b.cloud(px, b.int(-8, 8), b.int(170, 210));
        b.starsOver(p, 5, 42, 24);
        route.push(p);
        x = px + p.w;
      }
      b.route(...route);
    },
  },

  // Mondterrasse: zwei breite Terrassen, dazwischen eine kleine Wolke als Stufe nach oben oder unten.
  {
    id: 'moon-terrace',
    name: 'Mondterrasse',
    diff: 1,
    weight: 1,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const a = b.ground(0, 0, b.int(280, 340));
      const dy = b.pick([-1, 1]) * b.int(26, 34);
      const g1 = b.int(24, 40);
      const step = b.cloud(a.w + g1, dy, b.int(110, 130));
      const top = b.ground(a.w + g1 + step.w + b.int(24, 40), 2 * dy, b.int(320, 380));
      b.starsOver(a, 5, 42, 24);
      b.starsOver(step, 2, 42, 24);
      b.starsOver(top, 7, 42, 24);
      b.route(a, step, top);
    },
  },

  // Traumtal: erst hinab in ein Tal, dann über eine Wolke wieder hinaus. Sterne markieren den Weg.
  {
    id: 'dream-valley',
    name: 'Traumtal',
    diff: 1,
    weight: 2,
    min: 0,
    max: 1400,
    mech: [],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(200, 230));
      const vy = b.int(46, 64);
      const g1 = gapFor(b, 0, vy, b.rand(0.35, 0.55));
      const v = b.ground(a.w + g1, vy, b.int(280, 340));
      const cy = vy - b.int(34, 46);
      const g2 = gapFor(b, vy, cy, b.rand(0.3, 0.5));
      const cx = a.w + g1 + v.w + g2;
      const c = b.cloud(cx, cy, b.int(110, 130));
      const ey = cy - b.int(14, 26);
      const g3 = gapFor(b, cy, ey, b.rand(0.3, 0.5));
      const x = b.ground(cx + c.w + g3, ey, b.int(210, 250));
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + g1, vy, 4);
      b.starsOver(v, 6, 42, 30);
      gapArc(b, a.w + g1 + v.w, vy, cx, cy, 3);
      gapArc(b, cx + c.w, cy, cx + c.w + g3, ey, 3);
      b.starsOver(x, 4, 42, 30);
      b.route(a, v, c, x);
    },
  },

  // Wolkengabel: unten der einfache Weg, oben zwei kleine Wolken mit mehr Sternen. Wer hüpft, wird belohnt.
  {
    id: 'fork-clouds',
    name: 'Wolkengabel',
    diff: 1,
    weight: 2,
    min: 0,
    max: 1400,
    mech: [],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(200, 240));
      const ly = b.pick([-12, 0, 12]);
      const g1 = gapFor(b, 0, ly, b.rand(0.4, 0.6));
      const low = b.cloud(a.w + g1, ly, b.int(170, 200));
      const ey = b.pick([0, 0, 12]);
      const g2 = gapFor(b, ly, ey, b.rand(0.4, 0.6));
      const lowEnd = a.w + g1 + low.w;
      const exit = b.ground(lowEnd + g2, ey, b.int(210, 250));
      // Oberer, freiwilliger Weg: erste Wolke über der Lücke, zweite über dem Ende der unteren Wolke
      const uy1 = -b.int(44, 52);
      const uy2 = -b.int(46, 54);
      b.cloud(a.w + 12, uy1, 100);
      b.cloud(lowEnd - 90, uy2, 100);
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + g1, ly, 3);
      b.starsOver(low, 3, 42, 30);
      gapArc(b, lowEnd, ly, lowEnd + g2, ey, 3);
      b.starsOver(exit, 4, 42, 30);
      b.starLine(a.w + 30, uy1 - 44, lowEnd + 4, uy2 - 44, 7);
      b.route(a, low, exit);
    },
  },

  // Erste Gewitterwolke: ein Walker auf einer langen Plattform, Sterne im Bogen darüber.
  // Anfang und Ende der Plattform bleiben frei. Der Spieler lernt, auf Gegner zu springen.
  {
    id: 'walker-intro',
    name: 'Erste Gewitterwolke',
    diff: 1.5,
    weight: 3,
    min: 250,
    max: 1200,
    mech: ['walker'],
    rest: false,
    build(b) {
      const w = b.int(600, 680);
      const g = b.ground(0, 0, w);
      const from = b.int(250, 280);
      const to = w - b.int(170, 200);
      const e = b.walker(g, 0.5, { dir: b.pick([-1, 1]) });
      patrol(e, g, from, to);
      b.starLine(40, -42, from - 50, -42, 3);
      b.starArc(from + 10, to - 10, -30, 92, 7);
      b.starLine(to + 40, -42, w - 40, -42, 3);
      b.route(g);
    },
  },

  // Zwei Gewitterwolken hintereinander. Der Sternbogen über dem ersten Walker führt in den Sprung zum
  // zweiten: wer den ersten besiegt, kommt mit dem Abprall bis zum nächsten und kann eine Combo beginnen.
  {
    id: 'walker-pair',
    name: 'Zwei Gewitterwolken',
    diff: 2,
    weight: 2,
    min: 300,
    max: 2400,
    mech: ['walker'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(210, 250));
      const y1 = b.pick([-16, 0, 16]);
      const g1 = gapFor(b, 0, y1, b.rand(0.35, 0.5));
      const p1 = b.cloud(a.w + g1, y1, b.int(330, 380) - tight(b, 20));
      const y2 = clamp(y1 + b.pick([-16, 0, 16]), -32, 32);
      const g2 = gapFor(b, y1, y2, b.rand(0.4, 0.55));
      const x2 = a.w + g1 + p1.w + g2;
      const p2 = b.ground(x2, y2, b.int(380, 420) - tight(b, 20));
      const e1 = b.walker(p1, 0.5, { dir: 1 });
      patrol(e1, p1, 100, p1.w - 100);
      const e2 = b.walker(p2, 0.5, { dir: -1 });
      patrol(e2, p2, 100, p2.w - 150);
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + g1, y1, 4);
      b.starArc(a.w + g1 + 110, a.w + g1 + p1.w - 110, y1 - 30, 85, 5);
      gapArc(b, a.w + g1 + p1.w, y1, x2, y2, 4);
      b.starArc(x2 + 110, x2 + p2.w - 160, y2 - 30, 85, 5);
      b.starLine(x2 + p2.w - 110, y2 - 42, x2 + p2.w - 30, y2 - 42, 3);
      b.route(a, p1, p2);
    },
  },

  // Stachelsprung: eine Stachelwolke auf einer breiten Plattform. Der Sternbogen zeigt den Sprung darüber.
  {
    id: 'spike-hop',
    name: 'Stachelsprung',
    diff: 2,
    weight: 3,
    min: 250,
    max: 2400,
    mech: ['spike'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(200, 240));
      const hy = b.pick([-16, 0, 0, 16]);
      const gap = gapFor(b, 0, hy, b.rand(0.4, 0.6));
      const h = b.ground(a.w + gap, hy, b.int(420, 480) - tight(b, 40));
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + gap, hy, 4);
      spikeWithArc(b, h, a.w + gap, hy, b.int(130, 160));
      b.starLine(a.w + gap + h.w - 190, hy - 42, a.w + gap + h.w - 40, hy - 42, 4);
      b.route(a, h);
    },
  },

  // Stachelstufen: Stufen mit Stachelwolken auf den Absätzen, meist aufwärts, manchmal abwärts.
  // Der Spieler landet vor der Wolke, springt darüber und weiter zur nächsten Stufe.
  {
    id: 'spiked-stairs',
    name: 'Stachelstufen',
    diff: 2.5,
    weight: 2,
    min: 350,
    max: 3000,
    mech: ['spike'],
    rest: false,
    build(b) {
      const dir = b.chance(0.35) ? 1 : -1;
      const first = b.ground(0, 0, b.int(200, 225));
      b.starsOver(first, 3, 42, 30);
      const route = [first];
      let x = first.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const last = i === 2;
        const ny = y + dir * b.int(28, 38);
        const gap = gapFor(b, y, ny, b.rand(0.35, 0.55));
        const px = x + gap;
        const p = last ? b.ground(px, ny, b.int(210, 240)) : b.cloud(px, ny, b.int(250, 290) - tight(b, 10));
        gapArc(b, x, y, px, ny, 3);
        if (last) b.starsOver(p, 4, 42, 30);
        else spikeWithArc(b, p, px, ny, b.int(100, 125));
        route.push(p);
        x = px + p.w;
        y = ny;
      }
      b.route(...route);
    },
  },

  // Schildnische: ein Schild liegt auf einer kleinen Wolke über der Wiese. Ein Sprung genügt, ein ruhiger Chunk.
  {
    id: 'shield-nook',
    name: 'Schildnische',
    diff: 1.5,
    weight: 1,
    min: 300,
    max: Infinity,
    mech: ['powerup'],
    rest: true,
    build(b) {
      const w = b.int(560, 660);
      const g = b.ground(0, 0, w);
      const nw = b.int(100, 120);
      const nx = w / 2 - nw / 2 + b.int(-60, 60);
      const ny = -b.int(62, 72);
      b.cloud(nx, ny, nw);
      b.powerup('shield', nx + nw / 2, ny - 34);
      b.starLine(40, -42, nx - 70, -42, 4);
      b.starLine(nx + nw + 70, -42, w - 40, -42, 4);
      b.starLine(nx - 90, -36, nx - 24, ny - 10, 3);
      b.starLine(nx + nw + 24, ny - 10, nx + nw + 90, -36, 3);
      b.route(g);
    },
  },

  // Wolkenfähre: die Lücke ist für einen einfachen Sprung zu weit. Nur die schwingende Wolke trägt hinüber,
  // und sie ist in jeder Phase sicher zu erreichen. Der Spieler lernt, auf bewegliche Plattformen zu warten.
  {
    id: 'moving-ferry',
    name: 'Wolkenfähre',
    diff: 2,
    weight: 3,
    min: 500,
    max: 2600,
    mech: ['moving'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(220, 260));
      const ey = b.pick([-12, 0, 0, 12]);
      const mw = b.int(110, 130);
      // Größte Lücken zur Fähre: Fähre ganz rechts (Einstieg) und ganz links (Ausstieg)
      const far1 = gapFor(b, 0, 0, b.rand(0.78, 0.9));
      const far2 = gapFor(b, 0, ey, b.rand(0.78, 0.9));
      // Auch in der nächsten Stellung bleiben mindestens 24 px bis zu den Plattformkanten
      const ax = Math.floor(Math.min(b.int(54, 66), (Math.min(far1, far2) - 24) / 2));
      const cx = a.w + far1 - ax;
      const ferry = b.moving(cx, 0, mw, { ax, period: b.rand(3.2, 4), phase: b.rand(0, TAU) });
      const x = cx - ax + mw + far2;
      const exit = b.ground(x, ey, b.int(240, 280));
      b.starsOver(a, 3, 42, 30);
      b.starLine(a.w + 20, -58, x - 20, ey - 58, 7);
      b.starsOver(exit, 4, 42, 30);
      b.route(a, ferry, exit);
    },
  },

  // Wolkenaufzug: das Ziel liegt höher, als ein Sprung reicht. Die senkrecht schwingende Wolke bringt hinauf.
  {
    id: 'moving-lift',
    name: 'Wolkenaufzug',
    diff: 2,
    weight: 2,
    min: 500,
    max: 2600,
    mech: ['moving'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(210, 250));
      const ay = b.int(44, 54);
      const rise = b.int(126, 136);
      const lw = b.int(100, 120);
      const g1 = b.int(50, 70);
      const g2 = b.int(50, 70);
      const lx = a.w + g1;
      const lift = b.moving(lx, -ay, lw, { ay, period: b.rand(3.4, 4), phase: b.rand(0, TAU) });
      const tx = lx + lw + g2;
      const t = b.ground(tx, -rise, b.int(230, 270));
      b.starsOver(a, 3, 42, 30);
      b.starLine(lx + lw / 2, -34, lx + lw / 2, -rise - 20, 5);
      b.starsOver(t, 5, 42, 30);
      b.route(a, lift, t);
    },
  },

  // Regenwiese: unter der Regenwolke wird der Boden rutschig. Eine kleine Lücke am Ende fordert Gefühl.
  {
    id: 'rain-meadow',
    name: 'Regenwiese',
    diff: 2,
    weight: 2,
    min: 500,
    max: 2600,
    mech: ['rain'],
    rest: false,
    build(b) {
      const g = b.ground(0, 0, b.int(560, 640));
      const dy = b.pick([-14, 0, 0, 14]);
      const gap = gapFor(b, 0, dy, b.rand(0.3, 0.5));
      const x = b.ground(g.w + gap, dy, b.int(220, 260));
      b.rain(g.w - 260, 300, { offset: b.rand(0, RAIN.ON + RAIN.OFF) });
      b.starsOver(g, 6, 42, 40);
      gapArc(b, g.w, 0, g.w + gap, dy, 4);
      b.starsOver(x, 4, 42, 30);
      b.route(g, x);
    },
  },

  // Traumgarten: viele Sterne und eine Traumfeder auf einer Wolke über dem Weg. Die Feder ist freiwillig.
  {
    id: 'rest-garden',
    name: 'Traumgarten',
    diff: 2,
    weight: 2,
    min: 500,
    max: Infinity,
    mech: ['powerup'],
    rest: true,
    build(b) {
      const a = b.ground(0, 0, b.int(230, 260));
      const g1y = -b.int(0, 16);
      const g1x = a.w + b.int(24, 40);
      const g1 = b.ground(g1x, g1y, b.int(260, 300));
      const nw = b.int(100, 120);
      const nx = g1x + g1.w - nw - b.int(10, 40);
      const ny = g1y - b.int(62, 70);
      b.cloud(nx, ny, nw);
      b.powerup('feather', nx + nw / 2, ny - 34);
      const x = b.ground(g1x + g1.w + b.int(24, 40), g1y + b.pick([-8, 0, 8]), b.int(280, 330));
      b.starsOver(a, 4, 42, 30);
      b.starsOver(g1, 5, 42, 30);
      b.starArc(nx - 50, nx + nw + 50, ny - 22, 46, 4);
      b.starsOver(x, 6, 42, 30);
      b.route(a, g1, x);
    },
  },

  // Sternenleiter: Wolken steigen wie eine Leiter hinauf zu einem hohen Pfad mit vielen Sternen.
  // Die Hauptroute bleibt unten, der Aufstieg ist freiwillig.
  {
    id: 'star-ladder',
    name: 'Sternenleiter',
    diff: 2,
    weight: 2,
    min: 250,
    max: 1800,
    mech: [],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(230, 260));
      const g1 = gapFor(b, 0, 0, b.rand(0.4, 0.6));
      const mid = b.cloud(a.w + g1, 0, b.int(190, 220));
      const ey = b.pick([0, 0, 8]);
      const g2 = gapFor(b, 0, ey, b.rand(0.4, 0.6));
      const ex = a.w + g1 + mid.w + g2;
      const exit = b.ground(ex, ey, b.int(240, 270));
      // Leiter: drei Stufen schräg nach rechts oben, die erste direkt über dem Ende des Einstiegs
      const step = b.int(40, 46);
      const lw = b.int(96, 110);
      const l1x = a.w - 40;
      const l2x = l1x + lw + 20;
      const l3x = l2x + lw + 20;
      const top = -3 * step;
      b.cloud(l1x, -step, lw);
      b.cloud(l2x, -2 * step, lw);
      const high = b.cloud(l3x, top, b.int(240, 280));
      b.starsOver(a, 3, 42, 30);
      gapArc(b, a.w, 0, a.w + g1, 0, 3);
      b.starsOver(mid, 3, 42, 30);
      gapArc(b, a.w + g1 + mid.w, 0, ex, ey, 3);
      b.starsOver(exit, 4, 42, 30);
      b.star(l1x + lw / 2, -step - 42);
      b.star(l2x + lw / 2, -2 * step - 42);
      b.starLine(l3x + 24, top - 44, l3x + high.w - 24, top - 44, 8);
      b.route(a, mid, exit);
    },
  },

  // Schwebende Stufen: eine Fähre, eine feste Wolke und ein Aufzug nacheinander.
  // Jeder Sprung ist in jeder Phase der beweglichen Plattformen sicher, es zählt das Timing.
  {
    id: 'moving-steps',
    name: 'Schwebende Stufen',
    diff: 2.5,
    weight: 2,
    min: 650,
    max: 3000,
    mech: ['moving'],
    rest: false,
    build(b) {
      const a = b.ground(0, 0, b.int(200, 230));
      const cy = -b.int(10, 24);
      const mw = b.int(110, 124);
      const far1 = gapFor(b, 0, 0, b.rand(0.7, 0.82));
      const far2 = gapFor(b, 0, cy, b.rand(0.7, 0.82));
      const ax = Math.floor(Math.min(b.int(46, 58), (Math.min(far1, far2) - 24) / 2));
      const cx1 = a.w + far1 - ax;
      const ferry = b.moving(cx1, 0, mw, { ax, period: b.rand(3.2, 4), phase: b.rand(0, TAU) });
      const px = cx1 - ax + mw + far2;
      const c = b.cloud(px, cy, b.int(130, 150));
      // Aufzug: steigt bis zur Höhe des Ausstiegs, der Ausstieg liegt auf seiner höchsten Stellung
      const ay = b.int(32, 38);
      const lw = b.int(100, 112);
      const lx = px + c.w + b.int(50, 66);
      const lift = b.moving(lx, cy - ay, lw, { ay, period: b.rand(3.4, 4), phase: b.rand(0, TAU) });
      const ex = lx + lw + b.int(50, 66);
      const exit = b.ground(ex, cy - 2 * ay, b.int(230, 260));
      b.starsOver(a, 3, 42, 30);
      b.starLine(a.w + 20, -58, px - 20, cy - 58, 6);
      b.starsOver(c, 3, 42, 30);
      b.starLine(lx + lw / 2, cy - 30, lx + lw / 2, cy - 2 * ay - 30, 4);
      b.starsOver(exit, 4, 42, 30);
      b.route(a, ferry, c, lift, exit);
    },
  },
];
