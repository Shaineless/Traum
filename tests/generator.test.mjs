// Tests für den Chunk Sequenzer (game/generator.js).
// Die Welt wird ohne Spieler erzeugt: die Kamera wird künstlich vorangetrieben (s.camX setzen, ensureAhead
// aufrufen). Geprüft wird einmal mit eigenen Test Chunks und einmal mit der echten Bibliothek.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  H, HINTS, LIMITS, METER, REST, SECTIONS, START_X, W, difficultyAt, gateMeter,
} from '../game/constants.js';
import {
  createStaticPlatform, createMovingPlatform, createBreakablePlatform, createWalker, createSpike, createLightning, createStar,
  createPowerup, createGate, createRain,
} from '../game/entities.js';
import { cleanup, chunkAt, ensureAhead, initGenerator, updateHints } from '../game/generator.js';
import { hopOk, maxGap } from '../game/reach.js';
import { createState } from '../game/state.js';
import { activeEnemies } from '../game/sim.js';
import { safeFor } from '../game/validate.js';
import { CHUNKS, FLAT, GATE } from '../game/chunks/index.js';
import { checkChunk } from './chunk-harness.mjs';
import { input, invariants, newGame, run } from './helpers.mjs';

// ---------- Test Chunks ----------

// Abstand, den ein Sprung von Höhe y1 nach y2 mit dem Anteil k der Spielsicherheit überbrückt
const hop = (b, y1, y2, k = 0.8, o = {}) => Math.max(60, Math.floor(maxGap(y1, y2, { safe: safeFor(b.diff) * k, ...o })));

const TEST_LIB = [
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

// ---------- Werkzeug ----------

const MECH_OF_KIND = { walker: 'walker', jumper: 'jumper', flyer: 'flyer', charger: 'charger', spike: 'spike', lightning: 'lightning', wind: 'wind', rain: 'rain' };
const unlockMeter = (tag) => Math.min(...SECTIONS.filter((sec) => sec.mech.includes(tag)).map((sec) => sec.from));
const meterOf = (x) => (x - START_X) / METER;
const LISTS = ['platforms', 'enemies', 'hazards', 'zones', 'stars', 'powerups', 'gates'];

// Erzeugt die Welt bis meters Meter. Die Kamera läuft in Schritten von step Pixeln voran.
// Gemerkt werden alle je erzeugten Objekte (world), die Höchststände der Zähler und Verstöße der Invarianten.
function drive(seed, lib, { meters = 8000, step = 100, setup, every = 100 } = {}) {
  const s = createState({ seed });
  s.gen = { keepLog: true };
  if (setup) setup(s);
  const world = Object.fromEntries(LISTS.map((k) => [k, []]));
  const max = { platforms: 0, hazards: 0, stars: 0, enemies: 0 };
  const problems = [];
  const take = (before) => {
    for (const key of LISTS) {
      const list = s[key];
      let i = list.length;
      while (i > 0 && list[i - 1].id >= before) i--;
      for (; i < list.length; i++) world[key].push(list[i]);
    }
  };
  const watch = (n) => {
    max.platforms = Math.max(max.platforms, s.platforms.length);
    max.hazards = Math.max(max.hazards, s.hazards.length);
    max.stars = Math.max(max.stars, s.stars.length);
    max.enemies = Math.max(max.enemies, activeEnemies(s));
    if (n % every === 0) for (const e of invariants(s)) problems.push(`Schritt ${n}: ${e}`);
  };
  const t0 = performance.now();
  initGenerator(s, lib);
  take(1);
  watch(0);
  const endX = START_X + meters * METER;
  let cam = 0;
  for (let n = 1; s.gen.nextX < endX; n++) {
    cam += step;
    s.camX = cam;
    const before = s.nextId;
    ensureAhead(s, lib);
    take(before);
    watch(n);
  }
  const ms = performance.now() - t0;
  return { s, world, max, problems, ms, log: s.gen.chunkLog, stats: s.gen.stats };
}

// Größte Zahl von Gegnern, die in ein Fenster der Breite Fenster passen (xs gezählt wie in activeEnemies: e.x)
function densest(xs, width) {
  const a = xs.slice().sort((p, q) => p - q);
  let best = 0;
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const x0 = a[i] - 1e-3;
    while (j < a.length && a[j] < x0 + width) j++;
    let k = i;
    while (k > 0 && a[k - 1] > x0) k--;
    best = Math.max(best, j - k);
  }
  return best;
}

// Chunk zu einer Objekt id (die Chunks haben aufeinanderfolgende id Bereiche)
function chunkOfId(log, id) {
  let lo = 0;
  let hi = log.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id < log[mid].idMin) hi = mid - 1;
    else if (id > log[mid].idMax) lo = mid + 1;
    else return log[mid];
  }
  return null;
}

// Alle Fairness und Ablauf Regeln für eine erzeugte Welt. Gibt eine Liste von Verstößen zurück.
function analyse(r, { label }) {
  const out = [];
  const bad = (msg) => out.push(`${label}: ${msg}`);
  const { world, log, stats, max } = r;
  for (const p of r.problems.slice(0, 3)) bad(p);

  // Limits und Zahlen
  if (max.platforms > LIMITS.MAX_PLATFORMS) bad(`Plattformen ${max.platforms}`);
  if (max.hazards > LIMITS.MAX_HAZARDS) bad(`Hindernisse ${max.hazards}`);
  if (max.stars > LIMITS.MAX_STARS) bad(`Sterne ${max.stars}`);
  if (max.enemies > LIMITS.MAX_ENEMIES_ACTIVE) bad(`aktive Gegner ${max.enemies}`);
  const win = W + 520;
  const living = world.enemies.filter((e) => !(e.dead > 0));
  for (const [name, xs] of [['x', living.map((e) => e.x)], ['minX', living.map((e) => e.minX)], ['maxX', living.map((e) => e.maxX)]]) {
    const d = densest(xs, win);
    if (d > LIMITS.MAX_ENEMIES_ACTIVE) bad(`${d} Gegner (${name}) in einem Fenster von ${win} px`);
  }

  // Traumtore bei gateMeter(n) plus minus 40 Metern, mit ruhigem Chunk davor und danach
  const gates = world.gates.slice().sort((p, q) => p.x - q.x);
  const lastMeter = meterOf(r.s.gen.nextX);
  for (let n = 1; gateMeter(n) + 60 < lastMeter; n++) {
    const g = gates[n - 1];
    if (!g) {
      bad(`Tor ${n} fehlt`);
      break;
    }
    if (g.index !== n) bad(`Tor Nummer ${g.index} statt ${n}`);
    if (Math.abs(meterOf(g.x) - gateMeter(n)) > 40) bad(`Tor ${n} bei ${meterOf(g.x).toFixed(0)} m statt ${gateMeter(n)} m`);
  }
  log.forEach((c, i) => {
    if (!c.gate) return;
    if (!log[i - 1] || !log[i - 1].rest) bad(`vor Tor ${c.gate} kein ruhiger Chunk`);
    if (!log[i + 1] || !log[i + 1].rest) bad(`nach Tor ${c.gate} kein ruhiger Chunk`);
  });

  // Ruhepausen
  const rests = log.filter((c) => c.rest);
  let last = 0;
  for (const c of rests) {
    if (c.meter - last > REST.EVERY + REST.JITTER + 200) bad(`zu lange ohne Ruhepause bis ${c.meter.toFixed(0)} m`);
    last = c.meter;
  }
  if (rests.length < 8000 / (REST.EVERY + 300)) bad(`nur ${rests.length} Ruhepausen`);

  // Erster Chunk ruhig, Einschlafen (250 m): nur diff 1 und keine Gegner
  if (!log[0].rest) bad('erster Chunk ist nicht ruhig');
  for (const c of log) {
    if (c.meter < SECTIONS[0].to) {
      if (c.diff > 1) bad(`Chunk ${c.id} mit diff ${c.diff} im Einschlafen`);
      if (c.enemies) bad(`Chunk ${c.id} mit Gegnern im Einschlafen`);
    }
  }

  // Schwierigkeit: nie mehr als Kurve plus 0,6
  for (const c of log) if (c.diff > difficultyAt(c.meter) + 0.6 + 1e-9) bad(`Chunk ${c.id} (diff ${c.diff}) bei ${c.meter.toFixed(0)} m über der Kurve`);

  // Keine Mechanik vor ihrer Freischaltung (Meter gegen SECTIONS)
  const early = (tag, x, what) => {
    if (meterOf(x) < unlockMeter(tag) - 1e-6) bad(`${what} (${tag}) bei ${meterOf(x).toFixed(1)} m, frei ab ${unlockMeter(tag)} m`);
  };
  for (const e of world.enemies) early(MECH_OF_KIND[e.kind], e.minX, `Gegner ${e.id}`);
  for (const h of world.hazards) early(MECH_OF_KIND[h.kind], h.kind === 'lightning' ? h.x - h.w / 2 : h.x, `Hindernis ${h.id}`);
  for (const z of world.zones) early(MECH_OF_KIND[z.kind], z.x, `Zone ${z.id}`);
  for (const p of world.platforms) {
    if (p.kind === 'moving') early('moving', p.ox - Math.abs(p.ax), `Plattform ${p.id}`);
    if (p.kind === 'breakable') early('breakable', p.x, `Plattform ${p.id}`);
  }
  for (const st of world.stars) if (st.falling) early('fallingstar', st.x, `Stern ${st.id}`);
  for (const pu of world.powerups) early('powerup', pu.x, `Powerup ${pu.id}`);

  // Kein Gegner oder Hindernis in den ersten SAFE_START Pixeln eines Chunks
  const danger = [
    ...world.enemies.map((e) => ({ id: e.id, x: e.minX, what: e.kind })),
    ...world.hazards.map((h) => ({ id: h.id, x: h.kind === 'lightning' ? h.x - h.w / 2 : h.x, what: h.kind })),
  ];
  for (const d of danger) {
    const c = chunkOfId(log, d.id);
    if (!c) bad(`${d.what} ${d.id} gehört zu keinem Chunk`);
    else if (d.x < c.ox + LIMITS.SAFE_START - 1e-6) bad(`${d.what} ${d.id} im sicheren Anfang von ${c.id}`);
  }

  // Jeder Chunk beginnt mit einer breiten statischen Plattform (Landeplatz für den Respawn)
  const byX = new Map(world.platforms.filter((q) => q.kind === 'static').map((q) => [q.x, q]));
  for (const c of log) {
    const p = byX.get(c.ox);
    if (!p || p.w < 160 || p.id < c.idMin || p.id > c.idMax) bad(`Chunk ${c.id} bei ${c.ox} ohne breite Einstiegsplattform`);
  }

  // Anteil der Fallbacks
  if (stats.chunks < 100) bad(`nur ${stats.chunks} Chunks`);
  if (stats.fallbacks > stats.chunks * 0.05) bad(`${stats.fallbacks} Fallbacks bei ${stats.chunks} Chunks`);
  if (stats.chunks !== log.length) bad(`stats.chunks ${stats.chunks} passt nicht zum Protokoll ${log.length}`);
  return out;
}

const REAL_NOTE = `echte Bibliothek (${CHUNKS.length} Chunks)`;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

// ---------- Test Bibliothek ----------

test('Test Chunks: mindestens 8 verschiedene Tags, diff 1 bis 5, verschiedene min Werte', () => {
  const tags = new Set(TEST_LIB.flatMap((c) => c.mech));
  assert.ok(tags.size >= 8, `nur ${tags.size} Tags`);
  assert.ok(TEST_LIB.some((c) => c.diff === 1) && TEST_LIB.some((c) => c.diff === 5));
  assert.ok(new Set(TEST_LIB.map((c) => c.min)).size >= 5);
  assert.ok(TEST_LIB.length >= 8);
});

for (const chunk of TEST_LIB) {
  test(`Test Chunk ${chunk.id} besteht die Prüfung der Chunk Werkstatt`, () => {
    assert.deepEqual(checkChunk(chunk, { seeds: 10 }), []);
  });
}

// ---------- Welt bis 8000 Metern ----------

test('Test Chunks: 40 Seeds bis 8000 m halten alle Regeln', () => {
  const problems = [];
  for (const seed of SEEDS) {
    const r = drive(seed, TEST_LIB);
    problems.push(...analyse(r, { label: `Seed ${seed}` }).slice(0, 4));
    assert.equal(r.stats.rejects, 0, `Seed ${seed}: Test Chunks sollten nie abgelehnt werden (${JSON.stringify(r.s.gen.errors.slice(0, 2))})`);
  }
  assert.deepEqual(problems.slice(0, 12), []);
});

test(`${REAL_NOTE}: 40 Seeds bis 8000 m halten alle Regeln`, () => {
  const problems = [];
  for (const seed of SEEDS) {
    const r = drive(seed, CHUNKS);
    problems.push(...analyse(r, { label: `Seed ${seed}` }).slice(0, 4));
  }
  assert.deepEqual(problems.slice(0, 12), []);
});

test('Weltgröße: Schwierigkeit steigt über die Abschnitte', () => {
  const avg = (log, a, b) => {
    const xs = log.filter((c) => !c.rest && c.meter >= a && c.meter < b).map((c) => c.diff);
    return xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
  };
  let early = 0;
  let late = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = drive(seed, TEST_LIB);
    early += avg(r.log, 250, 800);
    late += avg(r.log, 3700, 8000);
  }
  assert.ok(late - early > 5 * 1.2, `früh ${(early / 5).toFixed(2)}, spät ${(late / 5).toFixed(2)}`);
});

// ---------- Determinismus ----------

test('Determinismus: gleicher Seed ergibt dieselbe Welt, anderer Seed eine andere', () => {
  for (const lib of [TEST_LIB, CHUNKS]) {
    const seen = new Set();
    for (const seed of [1, 2, 3, 11, 12, 40]) {
      const a = drive(seed, lib, { meters: 3000 });
      const b = drive(seed, lib, { meters: 3000 });
      assert.equal(JSON.stringify(a.s.gen), JSON.stringify(b.s.gen), `Seed ${seed}`);
      assert.equal(JSON.stringify(a.world), JSON.stringify(b.world), `Seed ${seed}`);
      assert.equal(JSON.stringify(a.s), JSON.stringify(b.s), `Seed ${seed}`);
      seen.add(JSON.stringify(a.world));
    }
    assert.equal(seen.size, 6, 'verschiedene Seeds ergeben verschiedene Welten');
  }
});

test('Zustand ist reine Daten: eine Kopie erzeugt dieselbe Welt weiter', () => {
  const a = drive(5, TEST_LIB, { meters: 1500 });
  const copy = structuredClone(a.s);
  for (let i = 0; i < 400; i++) {
    a.s.camX += 60;
    copy.camX += 60;
    ensureAhead(a.s, TEST_LIB);
    ensureAhead(copy, TEST_LIB);
  }
  assert.equal(JSON.stringify(a.s), JSON.stringify(copy));
  assert.ok(a.s.gen.nextX > START_X + 1500 * METER);
});

test('Die Welt hängt nicht vom Zufall anderer Module ab', () => {
  const plain = drive(8, TEST_LIB, { meters: 2000 });
  const noisy = drive(8, TEST_LIB, {
    meters: 2000,
    setup: (s) => { s.rng = 12345; },
  });
  // Der Generator zieht seinen Strom einmal beim Start aus s.rng, danach ist er unabhängig
  assert.notEqual(JSON.stringify(plain.world), JSON.stringify(noisy.world));
  const s = createState({ seed: 8 });
  initGenerator(s, TEST_LIB);
  const t = createState({ seed: 8 });
  initGenerator(t, TEST_LIB);
  for (let i = 0; i < 300; i++) {
    s.camX += 50;
    t.camX += 50;
    t.rng = (t.rng * 7 + i) >>> 0; // fremde Module würfeln anders
    ensureAhead(s, TEST_LIB);
    ensureAhead(t, TEST_LIB);
  }
  assert.equal(JSON.stringify(s.gen), JSON.stringify(t.gen));
  assert.equal(JSON.stringify(s.platforms), JSON.stringify(t.platforms));
});

// ---------- Zeit ----------

test('Erzeugungszeit für 8000 Meter liegt unter 1500 ms', () => {
  for (const lib of [TEST_LIB, CHUNKS]) {
    drive(1, lib, { meters: 1000 }); // Aufwärmen
    const best = Math.min(...[1, 2, 3].map((seed) => drive(seed, lib, { step: 100, every: 1e9 }).ms));
    assert.ok(best < 1500, `${best.toFixed(0)} ms`);
  }
});

test('Erzeugungszeit bei realistischen Kameraschritten (5 px) liegt unter 1500 ms', () => {
  const r = drive(2, TEST_LIB, { step: 5, every: 1e9 });
  assert.ok(r.ms < 1500, `${r.ms.toFixed(0)} ms`);
});

// ---------- Aufbau ----------

test('Start: Startplattform, ruhiger erster Chunk, Welt GEN_AHEAD voraus', () => {
  const s = createState({ seed: 4 });
  initGenerator(s, TEST_LIB);
  const start = s.platforms[0];
  assert.deepEqual([start.x, start.y, start.w, start.kind], [-200, 360, 900, 'static']);
  assert.ok(s.gen.nextX >= LIMITS.GEN_AHEAD);
  assert.equal(s.gen.stats.chunks, s.gen.spans.length);
  assert.ok(s.gen.stats.chunks >= 2);
  assert.equal(s.gen.spans[0].id, 't-meadow');
  const second = s.platforms.find((p) => p.x > 700);
  assert.ok(second.w >= 160 && second.kind === 'static');
});

test('Start mit der echten Bibliothek und Fallback Chunks', () => {
  const s = newGame(3);
  assert.ok(s.gen.nextX >= LIMITS.GEN_AHEAD);
  assert.deepEqual(invariants(s), []);
  assert.ok([...CHUNKS, FLAT, GATE].some((c) => c.id === s.gen.spans[0].id));
});

test('Ausgang und Einstieg: Höhen bleiben im erlaubten Bereich', () => {
  const r = drive(6, TEST_LIB);
  for (const p of r.world.platforms) {
    const top = p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y;
    const bottom = p.kind === 'moving' ? p.oy + Math.abs(p.ay) : p.y;
    assert.ok(top >= 214 && bottom <= 401, `Plattform ${p.id} ${top} bis ${bottom}`);
  }
  for (const st of r.world.stars) assert.ok(st.y > -20 && st.y < H, `Stern ${st.id} bei y ${st.y}`);
});

test('Chunks wiederholen sich nicht in den letzten drei', () => {
  for (const lib of [TEST_LIB]) {
    const r = drive(9, lib);
    const bad = [];
    r.log.forEach((c, i) => {
      if (c.fallback || c.gate) return;
      for (let k = 1; k <= 3 && i - k >= 0; k++) if (r.log[i - k].id === c.id) bad.push(`${c.id} bei ${c.meter.toFixed(0)} m`);
    });
    // Ruhechunks dürfen wiederkehren, wenn nur wenige zur Wahl stehen (Tor, Ruhepause)
    assert.deepEqual(bad.filter((x) => !/t-meadow|t-gift|t-pause/.test(x)).slice(0, 5), []);
  }
});

test('Abwechslung: gleiche Mechanik nicht endlos hintereinander', () => {
  const r = drive(10, TEST_LIB);
  let run3 = 0;
  for (let i = 3; i < r.log.length; i++) {
    const key = (c) => c.tags.slice().sort().join('|');
    if (r.log[i].meter > 1500 && key(r.log[i]) === key(r.log[i - 1]) && key(r.log[i]) === key(r.log[i - 2]) && key(r.log[i]) === key(r.log[i - 3]) && key(r.log[i]) !== '') run3++;
  }
  assert.ok(run3 <= 3, `${run3} Folgen mit viermal derselben Mechanik`);
});

test('Einführung: neue Mechaniken erscheinen bald nach ihrer Freischaltung', () => {
  const unlock = (tag) => Math.min(...SECTIONS.filter((sec) => sec.mech.includes(tag)).map((sec) => sec.from));
  const delays = { walker: [], moving: [], breakable: [], wind: [] };
  for (let seed = 1; seed <= 20; seed++) {
    const r = drive(seed, TEST_LIB, { meters: 2200 });
    for (const tag of Object.keys(delays)) {
      const first = r.log.find((c) => c.tags.includes(tag));
      assert.ok(first, `Seed ${seed}: ${tag} kommt nie vor`);
      delays[tag].push(first.meter - unlock(tag));
    }
  }
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  for (const [tag, d] of Object.entries(delays)) {
    assert.ok(mean(d) < 100, `${tag}: im Mittel ${mean(d).toFixed(0)} m nach der Freischaltung`);
    assert.ok(Math.max(...d) < 260, `${tag}: spätestens ${Math.max(...d).toFixed(0)} m nach der Freischaltung`);
  }
});

// ---------- Ereignisse ----------

test('enemyBoost verdoppelt das Gewicht von Chunks mit Gegnern', () => {
  const share = (boost) => {
    let enemy = 0;
    let all = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = drive(seed, TEST_LIB, { meters: 3500, setup: (s) => { s.events.enemyBoost = boost; } });
      for (const c of r.log) {
        if (c.meter < 1700 || c.rest) continue;
        all++;
        if (c.enemies) enemy++;
      }
    }
    return enemy / all;
  };
  const plain = share(false);
  const boosted = share(true);
  assert.ok(boosted > plain + 0.04, `ohne ${plain.toFixed(2)}, mit ${boosted.toFixed(2)}`);
});

test('starBoost: mehr Sterne', () => {
  const count = (boost) => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) n += drive(seed, TEST_LIB, { meters: 2000, setup: (s) => { s.events.starBoost = boost; } }).world.stars.length;
    return n;
  };
  assert.ok(count(true) > count(false) * 1.2);
});

test('Traumsturm: Welt wird weiter erzeugt und bleibt im Rahmen', () => {
  const r = drive(3, TEST_LIB, {
    meters: 3000,
    setup: (s) => { s.events.active = { type: 'storm', t: 0, dur: 1e9, data: {} }; s.events.enemyBoost = true; },
  });
  assert.deepEqual(analyse(r, { label: 'Sturm' }).filter((m) => !/Tor|Ruhepause|nur \d+ Chunks/.test(m)), []);
});

test('Großer Kamerasprung: die Welt holt schnell auf und bleibt im Limit', () => {
  for (const lib of [TEST_LIB, CHUNKS]) {
    const s = createState({ seed: 9 });
    initGenerator(s, lib);
    s.camX = 300000;
    const t0 = performance.now();
    ensureAhead(s, lib);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
    assert.ok(s.gen.nextX >= s.camX + LIMITS.GEN_AHEAD);
    assert.ok(s.platforms.length <= LIMITS.MAX_PLATFORMS && s.platforms.every((p) => p.x + p.w >= s.camX - LIMITS.CLEAN_BEHIND - 1 || p.kind === 'moving'));
    assert.deepEqual(invariants(s), []);
    // Der Anschluss nach dem Sprung ist normal begehbar: jede Plattform vor der Kamera hat eine Nachfolgerin in Reichweite
    const ps = s.platforms.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].x - (ps[i - 1].x + ps[i - 1].w) < 400);
  }
});

test('Ungültige Kamera: ensureAhead und cleanup stören den Zustand nicht', () => {
  const s = createState({ seed: 2 });
  initGenerator(s, TEST_LIB);
  const before = JSON.stringify(s);
  for (const cam of [NaN, undefined, -Infinity]) {
    s.camX = cam;
    ensureAhead(s, TEST_LIB);
    cleanup(s);
  }
  s.camX = 0;
  assert.equal(JSON.stringify(s), before);
});

test('Ohne initGenerator ist ensureAhead harmlos', () => {
  const s = createState({ seed: 2 });
  ensureAhead(s);
  updateHints(s);
  assert.equal(s.gen, null);
  assert.equal(chunkAt(s, 100), '');
});

// Windzonen an Anfang und Ende eines Chunks wirken auf den Sprung zwischen zwei Chunks
const windEntry = {
  id: 'w-entry', name: 'Wind am Eingang', diff: 3, weight: 6, min: 1200, max: Infinity, mech: ['wind'],
  build(b) {
    const a = b.ground(0, 0, 300);
    b.wind(-80, -200, 380, 300, { vx: -100 });
    const e = b.ground(300 + hop(b, 0, 0, 0.5), 0, 400);
    b.starsOver(e, 3, 50);
    b.route(a, e);
  },
};
const windExit = {
  id: 'w-exit', name: 'Wind am Ausgang', diff: 3, weight: 6, min: 1200, max: Infinity, mech: ['wind'],
  build(b) {
    const a = b.ground(0, 0, 300);
    const e = b.ground(300 + hop(b, 0, 0, 0.5), 0, 400);
    b.wind(350, -200, 700, 300, { vx: -100 });
    b.starsOver(e, 3, 50);
    b.route(a, e);
  },
};

test('Gegenwind an der Lücke zwischen zwei Chunks wird bei der Sprungweite eingerechnet', () => {
  const lib = [TEST_LIB[0], TEST_LIB[3], TEST_LIB[4], TEST_LIB[5], windEntry, windExit];
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = drive(seed, lib, { meters: 3000 });
    assert.deepEqual(r.problems, []);
    const route = r.s.gen.routeLog;
    route.forEach((b, i) => {
      if (!b.conn || i === 0) return;
      const a = route[i - 1];
      const prevExit = a.chunk === 'w-exit';
      const entry = b.chunk === 'w-entry';
      if (!prevExit && !entry) return;
      checked++;
      assert.ok(hopOk(a, b, { safe: safeFor(b.diff), dbl: false, wind: 100, minLand: 56 }), `${a.chunk} nach ${b.chunk}: Gegenwind nicht eingerechnet`);
    });
  }
  assert.ok(checked >= 10, `nur ${checked} Verbindungen geprüft`);
});

// ---------- Fehlerhafte Chunks ----------

const throwing = { id: 'x-throw', name: 'Wirft', diff: 1, weight: 5, min: 0, max: Infinity, mech: [], build() { throw new Error('kaputt'); } };
const noRoute = { id: 'x-noroute', name: 'Ohne Route', diff: 1, weight: 5, min: 0, max: Infinity, mech: [], build(b) { b.ground(0, 0, 300); } };
const nanChunk = { id: 'x-nan', name: 'NaN', diff: 1, weight: 5, min: 0, max: Infinity, mech: [], build(b) { const g = b.ground(0, NaN, 300); b.route(g); } };
const narrow = { id: 'x-narrow', name: 'Schmal', diff: 1, weight: 5, min: 0, max: Infinity, mech: [], build(b) { const g = b.ground(0, 0, 80); b.route(g); } };
const tooTall = {
  id: 'x-tall', name: 'Zu hoch', diff: 1, weight: 5, min: 0, max: Infinity, mech: [],
  build(b) { const a = b.ground(0, 0, 300); const c = b.cloud(400, -240, 200); b.route(a, c); },
};
const earlyWalker = {
  id: 'x-early', name: 'Zu früh', diff: 1, weight: 5, min: 0, max: Infinity, mech: [],
  build(b) { const a = b.ground(0, 0, 300); const h = b.ground(380, 0, 560); b.walker(h, 0.5); b.route(a, h); },
};
const notAChunk = { id: 'x-nobuild', name: 'Ohne build', diff: 1, weight: 5, min: 0, max: Infinity, mech: [] };
const BROKEN = [throwing, noRoute, nanChunk, narrow, tooTall, earlyWalker, notAChunk];

test('Fehlerhafte Chunks stürzen das Spiel nie ab: Fallback flat, Rejects werden gezählt', () => {
  const r = drive(2, BROKEN, { meters: 1500 });
  assert.deepEqual(r.problems, []);
  assert.ok(r.stats.rejects > 0);
  assert.ok(r.stats.fallbacks > 0);
  // Nur flat, das Tor und der Chunk, der erst ab 250 m gültig wird, kommen durch
  assert.ok(r.log.every((c) => c.id === 'flat' || c.id === 'gate' || (c.id === 'x-early' && c.meter >= 250)), 'nur flat, Tor und gültige Chunks');
  assert.ok(r.log.filter((c) => c.meter < 250).every((c) => c.id === 'flat'));
  assert.ok(r.s.gen.nextX >= START_X + 1500 * METER);
  assert.ok(r.s.gen.errors.length > 0);
  assert.ok(r.log.filter((c) => c.gate).length >= 2);
});

test('Ein guter Chunk unter fehlerhaften wird gefunden, Rejects bleiben beschränkt', () => {
  const r = drive(2, [...BROKEN, TEST_LIB[3], TEST_LIB[4]], { meters: 1200 });
  assert.deepEqual(r.problems, []);
  assert.ok(r.log.some((c) => c.id === 't-hops' || c.id === 't-wave'));
  // Pro Chunk höchstens 6 Versuche (1 plus 5 Wiederholungen)
  assert.ok(r.stats.rejects <= r.stats.chunks * 6);
});

test('Leere und ungültige Bibliotheken liefern flat', () => {
  for (const lib of [[], null, undefined, [null, 5, {}]]) {
    const s = createState({ seed: 1 });
    initGenerator(s, lib || undefined);
    assert.ok(s.gen.nextX >= LIMITS.GEN_AHEAD);
    assert.deepEqual(invariants(s), []);
  }
  const s = createState({ seed: 1 });
  initGenerator(s, []);
  assert.ok(s.gen.stats.fallbacks >= 2);
  assert.ok(s.gen.spans.every((x) => x.id === 'flat' || x.id === 'gate'));
});

test('Fehlgeschlagene Versuche verbrauchen keine IDs und Objekte kommen nie doppelt vor', () => {
  const s = createState({ seed: 3 });
  initGenerator(s, [throwing, noRoute, narrow, TEST_LIB[0]]);
  const all = LISTS.flatMap((k) => s[k]);
  assert.equal(new Set(all.map((o) => o.id)).size, all.length);
  assert.equal(s.nextId - 1, all.length, 'IDs gescheiterter Chunks müssen zurückgegeben werden');
  assert.ok(s.gen.stats.rejects > 0);
});

test('Auch wenn flat selbst scheitert, geht die Welt mit einer Notplattform weiter', () => {
  const orig = FLAT.build;
  FLAT.build = () => { throw new Error('flat kaputt'); };
  try {
    const s = createState({ seed: 2 });
    s.gen = { keepLog: true };
    initGenerator(s, []);
    for (let i = 1; i < 300; i++) {
      s.camX = i * 60;
      ensureAhead(s, []);
    }
    assert.ok(s.gen.nextX > 15000);
    assert.deepEqual(invariants(s), []);
    assert.ok(s.platforms.every((p) => p.kind === 'static'));
    assert.ok(s.gen.stats.fallbacks >= s.gen.stats.chunks - 40, 'fast alles Notplattformen und Tore');
    // jede Notplattform ist mit einem Sprung erreichbar
    const ps = s.platforms.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].x - (ps[i - 1].x + ps[i - 1].w) < 140, `Lücke bei ${ps[i].id}`);
  } finally {
    FLAT.build = orig;
  }
});

test('Ein kaputtes Tor wird durch flat ersetzt, die Folge danach läuft weiter', () => {
  const orig = GATE.build;
  GATE.build = () => { throw new Error('Tor kaputt'); };
  try {
    const r = drive(3, TEST_LIB, { meters: 2500 });
    assert.deepEqual(r.problems, []);
    assert.equal(r.world.gates.length, 0);
    assert.ok(r.stats.rejects >= 3);
    assert.ok(r.s.gen.gateN >= 4, 'die Torfolge schreitet weiter');
    assert.ok(r.s.gen.nextX > START_X + 2500 * METER);
  } finally {
    GATE.build = orig;
  }
});

test('Das Protokoll darf auch nach dem Start eingeschaltet werden (wie im Test Bot)', () => {
  const s = createState({ seed: 5 });
  initGenerator(s, TEST_LIB);
  assert.equal(s.gen.routeLog, undefined);
  s.gen.keepLog = true;
  for (let i = 1; i < 200; i++) {
    s.camX = i * 100;
    ensureAhead(s, TEST_LIB);
  }
  assert.ok(s.gen.routeLog.length > 30 && s.gen.chunkLog.length > 10, `${s.gen.routeLog.length} / ${s.gen.chunkLog.length}`);
  assert.deepEqual(invariants(s), []);
});

// ---------- Limits ----------

const spikeHeavy = {
  id: 'h-spikes', name: 'Viele Stacheln', diff: 2, weight: 3, min: 250, max: Infinity, mech: ['spike'],
  build(b) {
    const a = b.ground(0, 0, 300);
    const h = b.ground(300 + hop(b, 0, 0, 0.5), 0, 760);
    for (const t of [0.12, 0.3, 0.5, 0.7, 0.88]) b.spike(h, t);
    b.starsOver(h, 4, 80);
    b.route(a, h);
  },
};
const enemyHeavy = {
  id: 'h-walkers', name: 'Viele Gewitter', diff: 2, weight: 3, min: 250, max: Infinity, mech: ['walker'],
  build(b) {
    const a = b.ground(0, 0, 300);
    const h = b.ground(300 + hop(b, 0, 0, 0.5), 0, 560);
    for (const t of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) b.walker(h, t);
    b.starsOver(h, 4, 80);
    b.route(a, h);
  },
};
const starHeavy = {
  id: 'h-stars', name: 'Viele Sterne', diff: 1, weight: 3, min: 0, max: Infinity, mech: [], rest: true,
  build(b) {
    const g = b.ground(0, 0, 800);
    b.starsOver(g, 24, 50);
    b.starsOver(g, 24, 100);
    b.route(g);
  },
};
const platformHeavy = {
  id: 'h-plats', name: 'Viele Plattformen', diff: 1, weight: 3, min: 0, max: Infinity, mech: [],
  build(b) {
    const route = [b.ground(0, 0, 200)];
    let x = 200;
    for (let i = 0; i < 12; i++) {
      x += hop(b, 0, 0, 0.5);
      route.push(b.cloud(x, 0, 160));
      x += 160;
    }
    b.route(...route);
  },
};

for (const heavy of [spikeHeavy, enemyHeavy, starHeavy, platformHeavy]) {
  test(`Limits halten auch mit lauter schweren Chunks (${heavy.id})`, () => {
    const lib = [heavy];
    const s = createState({ seed: 4 });
    s.gen = { keepLog: true };
    initGenerator(s, lib);
    const max = { p: 0, h: 0, st: 0, e: 0 };
    let holes = 0;
    for (let n = 1; n <= 2500; n++) {
      s.camX = n * 20;
      ensureAhead(s, lib);
      max.p = Math.max(max.p, s.platforms.length);
      max.h = Math.max(max.h, s.hazards.length);
      max.st = Math.max(max.st, s.stars.length);
      max.e = Math.max(max.e, activeEnemies(s));
      if (s.gen.nextX < s.camX + W) holes++;
    }
    assert.ok(max.p <= LIMITS.MAX_PLATFORMS, `Plattformen ${max.p}`);
    assert.ok(max.h <= LIMITS.MAX_HAZARDS, `Hindernisse ${max.h}`);
    assert.ok(max.st <= LIMITS.MAX_STARS, `Sterne ${max.st}`);
    assert.ok(max.e <= LIMITS.MAX_ENEMIES_ACTIVE, `Gegner ${max.e}`);
    assert.equal(holes, 0, 'die Welt darf im Bild nie enden');
    assert.deepEqual(invariants(s), []);
  });
}

// ---------- cleanup ----------

test('cleanup entfernt alles links von camX minus CLEAN_BEHIND, tote Gegner und eingesammelte Sterne', () => {
  const s = createState({ seed: 1 });
  s.camX = 2000;
  const lim = s.camX - LIMITS.CLEAN_BEHIND; // 1680
  const gone = [];
  const kept = [];
  const mark = (o, away) => { (away ? gone : kept).push(o); return o; };

  const farPlat = createStaticPlatform(s, 1000, 360, 400); // endet bei 1400
  const edgePlat = createStaticPlatform(s, lim - 300, 360, 300 + 1); // endet knapp rechts der Grenze
  const nearPlat = createStaticPlatform(s, 2100, 360, 200);
  const movingOld = createMovingPlatform(s, 1500, 300, 120, { ax: 60 }); // rechts bei 1680: Grenze genau
  const movingKeep = createMovingPlatform(s, 1500, 300, 140, { ax: 60 }); // rechts bei 1700
  const brOld = createBreakablePlatform(s, 900, 300, 120);
  s.platforms.push(mark(farPlat, true), mark(edgePlat, false), mark(nearPlat, false), mark(movingOld, false), mark(movingKeep, false), mark(brOld, true));

  const w1 = createWalker(s, farPlat, 0.5);
  const w2 = createWalker(s, nearPlat, 0.5);
  const dead = createWalker(s, nearPlat, 0.2);
  dead.dead = 0.5;
  const dying = createWalker(s, nearPlat, 0.8);
  dying.dead = 0.2; // schrumpft noch
  s.enemies.push(mark(w1, true), mark(w2, false), mark(dead, true), mark(dying, false));

  s.hazards.push(mark(createSpike(s, farPlat, 0.5), true), mark(createSpike(s, nearPlat, 0.5), false),
    mark(createLightning(s, 1000), true), mark(createLightning(s, 2300), false));
  s.zones.push(mark(createRain(s, 1000, 300), true), mark(createRain(s, 1500, 300), false));
  const got = createStar(s, 2200, 300);
  got.got = true;
  s.stars.push(mark(createStar(s, 1000, 300), true), mark(createStar(s, 2300, 300), false), mark(got, true), mark(createStar(s, 2300, 600), true));
  const takenUp = createPowerup(s, 'shield', 2200, 300);
  takenUp.got = true;
  s.powerups.push(mark(createPowerup(s, 'dash', 1000, 300), true), mark(createPowerup(s, 'dash', 2200, 300), false), mark(takenUp, true));
  s.gates.push(mark(createGate(s, 1000, 360, 1), true), mark(createGate(s, 2400, 360, 2), false));

  const arrays = LISTS.map((k) => s[k]);
  cleanup(s);
  LISTS.forEach((k, i) => assert.equal(s[k], arrays[i], `${k}: dieselbe Liste`));
  const all = LISTS.flatMap((k) => s[k]);
  for (const o of gone) assert.ok(!all.includes(o), `${o.kind} ${o.id} hätte entfernt werden müssen`);
  for (const o of kept) assert.ok(all.includes(o), `${o.kind} ${o.id} hätte bleiben müssen`);
});

test('cleanup ist stabil bei leerem Zustand und ungültiger Kamera', () => {
  const s = createState({ seed: 1 });
  cleanup(s);
  s.platforms.push(createStaticPlatform(s, 0, 360, 200));
  s.camX = NaN;
  cleanup(s);
  assert.equal(s.platforms.length, 1);
});

test('Während der Erzeugung bleibt nichts weit hinter der Kamera liegen', () => {
  const r = drive(7, TEST_LIB, { meters: 3000 });
  const s = r.s;
  const lim = s.camX - LIMITS.CLEAN_BEHIND;
  for (const p of s.platforms) assert.ok(p.x + p.w >= lim - 1 || p.kind === 'moving', `Plattform ${p.id}`);
  assert.ok(s.platforms.length < 40);
});

// ---------- Hinweise ----------

test('Hinweise: jede neue Mechanik wird einmal eingereiht', () => {
  const r = drive(3, TEST_LIB, { meters: 3000 });
  const q = r.s.hints.queue;
  const mechs = q.map((h) => h.mech);
  assert.equal(new Set(mechs).size, mechs.length, 'doppelte Hinweise');
  for (const h of q) {
    assert.equal(h.text, HINTS[h.mech]);
    assert.ok(Number.isFinite(h.x));
  }
  for (const tag of ['walker', 'spike', 'moving', 'rain', 'breakable', 'jumper', 'lightning', 'wind', 'flyer', 'charger']) {
    assert.ok(mechs.includes(tag), `Hinweis ${tag} fehlt`);
  }
  // x liegt an der ersten Stelle, an der die Mechanik wirklich vorkommt
  const w = r.world;
  const first = {
    walker: Math.min(...w.enemies.filter((e) => e.kind === 'walker').map((e) => e.x)),
    spike: Math.min(...w.hazards.filter((e) => e.kind === 'spike').map((e) => e.x)),
    rain: Math.min(...w.zones.filter((e) => e.kind === 'rain').map((e) => e.x)),
    breakable: Math.min(...w.platforms.filter((e) => e.kind === 'breakable').map((e) => e.x)),
  };
  for (const [tag, x] of Object.entries(first)) assert.equal(q.find((h) => h.mech === tag).x, x, tag);
});

test('Hinweise: updateHints zeigt sie als Banner, einmal pro Mechanik', () => {
  const s = createState({ seed: 3 });
  s.hints.queue.push({ x: 5000, text: HINTS.walker, mech: 'walker' }, { x: 6000, text: HINTS.spike, mech: 'spike' });
  s.player.x = 5000 - 300;
  updateHints(s);
  assert.equal(s.banner, null, 'zu früh');
  s.player.x = 5000 - 250;
  updateHints(s);
  assert.ok(s.banner && s.banner.text === HINTS.walker);
  assert.equal(s.hints.shown.walker, true);
  assert.equal(s.hints.queue.length, 1);
  // Ein laufendes Banner wird nicht überschrieben
  s.player.x = 6000 - 100;
  updateHints(s);
  assert.equal(s.banner.text, HINTS.walker);
  assert.equal(s.hints.queue.length, 1);
  s.banner = null;
  updateHints(s);
  assert.equal(s.banner.text, HINTS.spike);
  assert.equal(s.hints.queue.length, 0);
  // Erneut eingereihter Hinweis derselben Mechanik wird nicht noch einmal gezeigt
  s.banner = null;
  s.hints.queue.push({ x: 6000, text: HINTS.walker, mech: 'walker' });
  updateHints(s);
  assert.equal(s.banner, null);
  assert.equal(s.hints.queue.length, 0);
});

test('Hinweise: veraltete Hinweise verfallen, tote Spieler und NaN stören nicht', () => {
  const s = createState({ seed: 3 });
  s.hints.queue.push({ x: 1000, text: HINTS.rain, mech: 'rain' });
  s.player.x = 5000;
  s.banner = { text: 'x', sub: '', t: 0, dur: 2 };
  updateHints(s);
  assert.equal(s.hints.queue.length, 0);
  s.hints.queue.push({ x: 5100, text: HINTS.wind, mech: 'wind' });
  s.banner = null;
  s.player.dead = true;
  updateHints(s);
  assert.equal(s.banner, null);
  s.player.dead = false;
  s.player.x = NaN;
  updateHints(s);
  assert.equal(s.banner, null);
  s.player.x = 5000;
  s.mode = 'dying';
  updateHints(s);
  assert.equal(s.banner, null);
  s.mode = 'playing';
  updateHints(s);
  assert.equal(s.banner.text, HINTS.wind);
});

// ---------- chunkAt ----------

test('chunkAt und Spans', () => {
  const r = drive(4, TEST_LIB, { meters: 1200 });
  const s = r.s;
  assert.ok(s.gen.spans.length <= 8);
  assert.equal(s.gen.spans.length, 8);
  for (const sp of s.gen.spans) {
    assert.ok(typeof sp.id === 'string' && sp.x1 > sp.x0 && Number.isFinite(sp.diff));
    assert.equal(chunkAt(s, sp.x0 + 1), sp.id);
    assert.equal(chunkAt(s, sp.x1 - 1), sp.id);
  }
  // Die Lücke vor einem Chunk gehört noch zum vorigen
  const [a, b] = s.gen.spans.slice(-2);
  assert.equal(chunkAt(s, (a.x1 + b.x0) / 2), a.id);
  assert.equal(chunkAt(s, 1e9), s.gen.spans[7].id);
  assert.equal(chunkAt(s, -5000), '');
  // Frisch gestartet kennt man die Startplattform
  const fresh = createState({ seed: 2 });
  initGenerator(fresh, TEST_LIB);
  assert.equal(chunkAt(fresh, 100), 'start');
  assert.equal(chunkAt(fresh, fresh.gen.spans[0].x0 + 10), fresh.gen.spans[0].id);
  assert.equal(chunkAt(createState({ seed: 1 }), 100), '');
});

// ---------- Zusammenspiel mit der Simulation ----------

test('Mit der echten Simulation: Spiel läuft, Welt bleibt voraus und wird aufgeräumt', () => {
  const s = newGame(21);
  run(s, 60 * 40, (st, i) => input({ move: 1, jumpPressed: i % 37 === 0, jumpHeld: i % 37 < 22 }));
  assert.deepEqual(invariants(s), []);
  assert.ok(s.gen.nextX >= s.camX + LIMITS.GEN_AHEAD - 1);
  assert.ok(s.platforms.every((p) => p.x + p.w > s.camX - LIMITS.CLEAN_BEHIND - 1 || p.kind === 'moving'));
});

test('Mit der echten Simulation: viele Seeds laufen stabil', () => {
  for (let seed = 30; seed < 38; seed++) {
    const s = newGame(seed);
    run(s, 60 * 12, (st, i) => input({ move: 1, jumpPressed: i % 29 === 0, jumpHeld: i % 29 < 18 }));
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});

test('Quelltext des Generators ohne Math.random, Date.now und Gedankenstriche', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../game/generator.js', import.meta.url), 'utf8');
  assert.ok(!/Math\.random|Date\.now|new Date|performance\./.test(src));
  assert.ok(![0x2013, 0x2014].some((c) => src.includes(String.fromCharCode(c))));
});
