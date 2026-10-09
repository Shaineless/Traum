// Gemeinsame Test Chunks für die Tests des Generators (generator, reachability, difficulty).
// TEST_LIB_HIGH deckt den oberen Teil der Kurve ab (Schwierigkeit 2,6 bis 9,4) und zeigt alle neuen Mechaniken:
// Sprungwolke, Eiswolke, Blinkwolke, Hagelwolke und Komet. Die echte Bibliothek wächst parallel, diese Chunks
// machen die Tests unabhängig davon.
import { SECTIONS, difficultyAt } from '../game/constants.js';
import { maxGap } from '../game/reach.js';
import { safeFor } from '../game/validate.js';

// Abstand, den ein Sprung von Höhe y1 nach y2 mit dem Anteil k der Spielsicherheit überbrückt
export const hop = (b, y1, y2, k = 0.8, o = {}) => Math.max(60, Math.floor(maxGap(y1, y2, { safe: safeFor(b.diff) * k, ...o })));

// Frühester Meter, an dem ein Chunk der Schwierigkeit diff zur Kurve passt (Kurve plus 0,6 reicht heran)
export function minFor(diff) {
  for (let m = 0; m < 6000; m += 10) if (difficultyAt(m) + 0.6 >= diff) return m;
  return 6000;
}

// Meter, ab dem ein Tag freigeschaltet ist
export const unlockMeter = (tag) => Math.min(...SECTIONS.filter((sec) => sec.mech.includes(tag)).map((sec) => sec.from));

const HOST_W = { walker: 170, jumper: 190, charger: 240 }; // knapp über den Mindestbreiten der Gegner Plattformen (110, 150, 220)

// Reihe von Plattformen mit je einem Gegner, dazu Blitze, Komet, Flieger oder Hagelwolke je nach Optionen.
// Gleich hohe Plattformen, Lücken mit 75 Prozent der erlaubten Weite: der Chunk wird nur durch Gegner schwer.
// Höchstens drei Gegner, damit die Länge (bis etwa 36 Meter) zu den echten Chunks passt.
function heavy(id, diff, kinds, { bolts = 0, comet = false, flyer = false, hail = false, min = minFor(diff) } = {}) {
  const mech = [...new Set(kinds)];
  if (bolts) mech.push('lightning');
  if (comet) mech.push('comet');
  if (flyer) mech.push('flyer');
  if (hail) mech.push('hailcloud');
  return {
    id, name: `Test ${id}`, diff, weight: 2, min, max: Infinity, mech,
    build(b) {
      const a = b.ground(0, 0, 240);
      const route = [a];
      const hosts = [];
      let x = 240;
      for (const kind of kinds) {
        x += hop(b, 0, 0, 0.75);
        const h = b.ground(x, 0, HOST_W[kind]);
        b[kind](h, 0.5);
        b.starsOver(h, 3, 70);
        route.push(h);
        hosts.push(h);
        x += h.w;
      }
      x += hop(b, 0, 0, 0.75);
      const e = b.ground(x, 0, 250);
      b.starsOver(e, 3, 55);
      route.push(e);
      for (let i = 0; i < bolts; i++) {
        const h = hosts[hosts.length - 1 - i * 2] || hosts[0];
        b.lightning(h.x - b.ox + h.w / 2);
      }
      if (comet) b.comet(e.x - b.ox + e.w / 2, 0);
      if (flyer) b.flyer(hosts[0].x - b.ox - 80, -203);
      if (hail) b.hailcloud(e.x - b.ox + 120, -204);
      b.route(...route);
    },
  };
}

export const TEST_LIB_HIGH = [
  // neue Mechaniken, je ein Chunk, der sie vorstellt
  {
    id: 't-spring', name: 'Testsprungwolke', diff: 2.8, weight: 2, min: 500, max: Infinity, mech: ['spring'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, 0, 0.7);
      const sp = b.spring(x1, 0, 100);
      const x2 = x1 + 100 + 80;
      const hi = b.cloud(x2, -130, 170);
      const e = b.ground(x2 + 170 + hop(b, -130, 0, 0.6), 0, 340);
      b.starArc(x1 + 20, x2 + 40, -20, 150, 6);
      b.starsOver(e, 3, 55);
      b.route(a, sp, hi, e);
    },
  },
  {
    id: 't-ice', name: 'Testeiswolke', diff: 4, weight: 2, min: 800, max: Infinity, mech: ['ice'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, 0, 0.7);
      const ice = b.ice(x1, 0, 320);
      const e = b.ground(x1 + 320 + hop(b, 0, 0, 0.6, { wind: 70 }), 0, 320);
      b.starsOver(ice, 4, 55);
      b.starsOver(e, 3, 55);
      b.route(a, ice, e);
    },
  },
  {
    id: 't-blink', name: 'Testblinkwolke', diff: 5.2, weight: 2, min: 1200, max: Infinity, mech: ['blink'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, -20, 0.7);
      const b1 = b.blink(x1, -20, 130, { period: 3.6, phase: 0 });
      const x2 = x1 + 130 + hop(b, -20, -20, 0.7);
      const b2 = b.blink(x2, -20, 130, { period: 3.6, phase: 0.5 });
      const e = b.ground(x2 + 130 + hop(b, -20, 0, 0.7), 0, 330);
      b.starsOver(b1, 2, 50);
      b.starsOver(b2, 2, 50);
      b.starsOver(e, 3, 55);
      b.route(a, b1, b2, e);
    },
  },
  {
    id: 't-hail', name: 'Testhagelwolke', diff: 5.4, weight: 2, min: 1200, max: Infinity, mech: ['hailcloud'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 640);
      b.hailcloud(h.x - b.ox + 330, -202);
      b.starsOver(h, 5, 60);
      b.route(a, h);
    },
  },
  {
    id: 't-comet', name: 'Testkomet', diff: 6.6, weight: 2, min: 1700, max: Infinity, mech: ['comet'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 700);
      b.comet(h.x - b.ox + 360, 0);
      b.starsOver(h, 5, 60);
      b.route(a, h);
    },
  },
  // mittlere Reihen: schließen die Lücke der Grundliste zwischen Schwierigkeit 2,6 und 5
  heavy('t-w26', 2.6, ['walker'], { min: 250 }),
  heavy('t-w31', 3.1, ['walker', 'walker'], { min: 500 }),
  heavy('t-w35', 3.5, ['walker', 'walker'], { min: 650 }),
  heavy('t-j38', 3.8, ['jumper'], { min: 800 }),
  heavy('t-j42', 4.2, ['jumper', 'walker'], { min: 900 }),
  heavy('t-j46', 4.6, ['jumper', 'jumper'], { min: 1000, bolts: 1 }),
  heavy('t-c50', 5.0, ['charger'], { min: 1200 }),
  // schwere Reihen: Gegner und Blitze in wachsender Zahl
  heavy('t-h58', 5.8, ['walker', 'jumper']),
  heavy('t-h63', 6.3, ['charger'], { bolts: 1 }),
  heavy('t-h69', 6.9, ['jumper', 'walker', 'charger']),
  heavy('t-h74', 7.4, ['charger', 'jumper'], { bolts: 1, flyer: true }),
  heavy('t-h79', 7.9, ['walker', 'charger', 'jumper'], { bolts: 2 }),
  heavy('t-h84', 8.4, ['jumper', 'jumper', 'charger'], { bolts: 1, comet: true }),
  heavy('t-h89', 8.9, ['charger', 'walker', 'jumper'], { bolts: 2 }),
  heavy('t-h94', 9.4, ['charger', 'charger', 'jumper'], { bolts: 2, comet: true, hail: true }),
  // zweite Auswahl in der Mitte, damit der Wiederholungsschutz nicht die ganze Auswahl verbraucht
  heavy('t-g62', 6.2, ['jumper', 'jumper']),
  heavy('t-g71', 7.1, ['walker', 'charger'], { bolts: 1 }),
  heavy('t-g80', 8.0, ['charger', 'charger'], { comet: true }),
  heavy('t-g87', 8.7, ['jumper', 'charger', 'walker'], { bolts: 1, hail: true }),
  heavy('t-g91', 9.1, ['charger', 'jumper', 'charger'], { bolts: 2 }),
];

// Grundliste: Chunks von Schwierigkeit 1 bis 5 mit allen alten Mechaniken (die Tests des Generators brauchen sie ab Meter 0)
export const BASE_LIB = [
  {
    id: 't-meadow', name: 'Testwiese', diff: 1, weight: 3, min: 0, max: Infinity, mech: [], rest: true,
    build(b) {
      const g = b.ground(0, 0, b.int(520, 680));
      b.starsOver(g, b.int(5, 8), 55);
      b.route(g);
    },
  },
  {
    id: 't-gift', name: 'Testgeschenk', diff: 1, weight: 2, min: 250, max: Infinity, mech: ['powerup'], rest: true,
    build(b) {
      const g = b.ground(0, 0, 600);
      b.powerup(b.pick(['shield', 'magnet', 'feather']), 300, -60);
      b.starsOver(g, 6, 55);
      b.route(g);
    },
  },
  {
    id: 't-pause', name: 'Testpause', diff: 2, weight: 2, min: 800, max: Infinity, mech: [], rest: true,
    build(b) {
      const a = b.ground(0, 0, 300);
      const x = 300 + hop(b, 0, -20, 0.6);
      const c = b.cloud(x, -20, 200);
      const e = b.ground(x + 200 + hop(b, -20, 0, 0.6), 0, 340);
      b.starArc(300, x, -20, 55, 5);
      b.starsOver(e, 5, 55);
      b.route(a, c, e);
    },
  },
  {
    id: 't-hops', name: 'Testhüpfer', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -20);
      const c = b.cloud(x1, -20, 170);
      const x2 = x1 + 170 + hop(b, -20, 0);
      const e = b.ground(x2, 0, 320);
      b.starArc(260, x1, -20, 60, 5);
      b.starsOver(e, 4, 55);
      b.route(a, c, e);
    },
  },
  {
    id: 't-wave', name: 'Testwelle', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 240);
      const x1 = 240 + hop(b, 0, 25);
      const c1 = b.cloud(x1, 25, 150);
      const x2 = x1 + 150 + hop(b, 25, -10);
      const c2 = b.cloud(x2, -10, 150);
      const x3 = x2 + 150 + hop(b, -10, 20);
      const e = b.ground(x3, 20, 300);
      b.starsOver(c1, 3, 50);
      b.starsOver(c2, 3, 50);
      b.starsOver(e, 4, 50);
      b.route(a, c1, c2, e);
    },
  },
  {
    id: 't-bumps', name: 'Testhügel', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, -15);
      const c = b.cloud(x1, -15, 200);
      const e = b.ground(x1 + 200 + hop(b, -15, -15), -15, 280);
      b.starArc(300, x1 + 200, -15, 50, 5);
      b.starsOver(e, 3, 50);
      b.route(a, c, e);
    },
  },
  {
    id: 't-long', name: 'Testweg', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 400);
      const x1 = 400 + hop(b, 0, 0, 0.6);
      const e = b.ground(x1, 0, 480);
      b.starsOver(a, 4, 55);
      b.starsOver(e, 5, 55);
      b.route(a, e);
    },
  },
  {
    id: 't-steps', name: 'Teststufen', diff: 1.5, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -30);
      const c1 = b.cloud(x1, -30, 150);
      const x2 = x1 + 150 + hop(b, -30, -60);
      const c2 = b.cloud(x2, -60, 150);
      const x3 = x2 + 150 + hop(b, -60, -60);
      const e = b.cloud(x3, -60, 240);
      b.starLine(x1 + 20, -80, x2 + 130, -110, 5);
      b.starsOver(e, 4, 55);
      b.route(a, c1, c2, e);
    },
  },
  {
    id: 't-walker', name: 'Testgewitter', diff: 1.5, weight: 2, min: 250, max: Infinity, mech: ['walker'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 560);
      b.walker(h, 0.55);
      b.starsOver(h, 4, 80);
      b.route(a, h);
    },
  },
  {
    id: 't-spike', name: 'Teststachel', diff: 2, weight: 2, min: 250, max: Infinity, mech: ['spike'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 440);
      const sp = b.spike(h, 0.5);
      b.starArc(sp.x - b.ox - 50, sp.x - b.ox + sp.w + 50, -30, 70, 5);
      b.route(a, h);
    },
  },
  {
    id: 't-moving', name: 'Testwolke', diff: 2.3, weight: 2, min: 500, max: Infinity, mech: ['moving'],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -20, 0.6);
      const m = b.moving(x1, -20, 150, { ay: 35, period: 3.6 });
      const e = b.ground(x1 + 150 + hop(b, -20, 0, 0.6), 0, 320);
      b.starsOver(e, 4, 55);
      b.route(a, m, e);
    },
  },
  {
    id: 't-rain', name: 'Testregen', diff: 2.2, weight: 2, min: 500, max: Infinity, mech: ['rain'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 620);
      b.rain(h.x - b.ox - 40, 360);
      b.starsOver(h, 6, 60);
      b.route(a, h);
    },
  },
  {
    id: 't-crumble', name: 'Testbrösel', diff: 3, weight: 2, min: 800, max: Infinity, mech: ['breakable'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, -15, 0.7);
      const br1 = b.breakable(x1, -15, 130);
      const x2 = x1 + 130 + hop(b, -15, -15, 0.7);
      const br2 = b.breakable(x2, -15, 130);
      const e = b.ground(x2 + 130 + hop(b, -15, 0, 0.7), 0, 320);
      b.starsOver(br1, 2, 50);
      b.starsOver(br2, 2, 50);
      b.route(a, br1, br2, e);
    },
  },
  {
    id: 't-jumper', name: 'Testhüpfer Gegner', diff: 3, weight: 2, min: 800, max: Infinity, mech: ['jumper'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 460);
      b.jumper(h, 0.5);
      b.starsOver(h, 4, 80);
      b.route(a, h);
    },
  },
  {
    id: 't-bolt', name: 'Testblitz', diff: 3.2, weight: 2, min: 800, max: Infinity, mech: ['lightning'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 640);
      b.lightning(h.x - b.ox + 300);
      b.starsOver(h, 5, 60);
      b.route(a, h);
    },
  },
  {
    id: 't-wind', name: 'Testwind', diff: 3.2, weight: 2, min: 1200, max: Infinity, mech: ['wind'],
    build(b) {
      const a = b.ground(0, 0, 280);
      const x1 = 280 + hop(b, 0, 0, 0.6);
      const e = b.ground(x1, 0, 340);
      b.wind(200, -220, x1 + 100, 300, { vx: 50 });
      b.starsOver(e, 4, 55);
      b.route(a, e);
    },
  },
  {
    id: 't-flyer', name: 'Testflieger', diff: 3.5, weight: 2, min: 1200, max: Infinity, mech: ['flyer'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 560);
      b.flyer(h.x - b.ox + 280, -210);
      b.starsOver(h, 4, 60);
      b.route(a, h);
    },
  },
  {
    id: 't-charger', name: 'Teststurm', diff: 4, weight: 2, min: 1200, max: Infinity, mech: ['charger'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 560);
      b.charger(h, 0.7);
      b.starsOver(h, 3, 70);
      b.route(a, h);
    },
  },
  {
    id: 't-double', name: 'Testweitsprung', diff: 5, weight: 2, min: 1700, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -40, 0.8, { dbl: true });
      const c = b.cloud(x1, -40, 160);
      const e = b.ground(x1 + 160 + hop(b, -40, 0, 0.8, { dbl: true }), 0, 300);
      b.starArc(260, x1, -40, 90, 6);
      b.starsOver(e, 3, 55);
      b.route(a, c, e);
    },
  },
  {
    // Hoher Chunk: zwingt den Generator, Anstieg und Höhenbereich sauber zu verbinden
    id: 't-tall', name: 'Testturm', diff: 2.5, weight: 2, min: 250, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -55, 0.55);
      const c1 = b.cloud(x1, -55, 150);
      const x2 = x1 + 150 + hop(b, -55, -110, 0.55);
      const c2 = b.cloud(x2, -110, 150);
      const e = b.ground(x2 + 150 + 120, 70, 300);
      b.starsOver(c1, 2, 50);
      b.starsOver(c2, 2, 50);
      b.route(a, c1, c2, e);
    },
  },
];

export const TEST_LIB = [...BASE_LIB, ...TEST_LIB_HIGH];
