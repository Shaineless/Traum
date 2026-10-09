// Tests für den Chunk Sequenzer (game/generator.js).
// Die Welt wird ohne Spieler erzeugt: die Kamera wird künstlich vorangetrieben (s.camX setzen, ensureAhead
// aufrufen). Geprüft wird einmal mit eigenen Test Chunks und einmal mit der echten Bibliothek.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  H, HINTS, LIMITS, METER, REST, SECTIONS, START_X, TIPS, W, difficultyAt, gateMeter,
} from '../game/constants.js';
import {
  createStaticPlatform, createMovingPlatform, createBreakablePlatform, createWalker, createSpike, createLightning, createStar,
  createPowerup, createGate, createRain, createSpringPlatform, createBlinkPlatform, createHailcloud, createHail, createComet,
} from '../game/entities.js';
import { cleanup, chunkAt, diffFit, ensureAhead, initGenerator, updateHints } from '../game/generator.js';
import { hopOk, hopOkMoving } from '../game/reach.js';
import { createState } from '../game/state.js';
import { activeEnemies, stepSim } from '../game/sim.js';
import { safeFor } from '../game/validate.js';
import { CHUNKS, FLAT, GATE } from '../game/chunks/index.js';
import { checkChunk } from './chunk-harness.mjs';
import { TEST_LIB, hop, unlockMeter } from './gen-lib.mjs';
import { input, invariants, newGame, run } from './helpers.mjs';

// Die Test Chunks stehen in tests/gen-lib.mjs: eine Grundliste bis Schwierigkeit 5 (TEST_LIB[0] bis [7] sind einfache
// Chunks, auf die einzelne Tests mit Index zugreifen) und dazu der obere Teil der Kurve bis 9,4 mit allen neuen Mechaniken.

// ---------- Werkzeug ----------

const MECH_OF_KIND = {
  walker: 'walker', jumper: 'jumper', flyer: 'flyer', charger: 'charger', hailcloud: 'hailcloud', spike: 'spike',
  lightning: 'lightning', comet: 'comet', wind: 'wind', rain: 'rain',
};
// x der linken Kante eines Hindernisses (Blitz und Komet haben ihre Mitte in x)
const hazardLeft = (h) => (h.kind === 'lightning' || h.kind === 'comet' ? h.x - h.w / 2 : h.x);
const meterOf = (x) => (x - START_X) / METER;
const atMeter = (m) => START_X + m * METER;
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
  for (const h of world.hazards) early(MECH_OF_KIND[h.kind], hazardLeft(h), `Hindernis ${h.id}`);
  for (const z of world.zones) early(MECH_OF_KIND[z.kind], z.x, `Zone ${z.id}`);
  for (const p of world.platforms) {
    if (p.kind === 'moving') early('moving', p.ox - Math.abs(p.ax), `Plattform ${p.id}`);
    if (p.kind === 'breakable') early('breakable', p.x, `Plattform ${p.id}`);
    if (p.kind === 'spring') early('spring', p.x, `Plattform ${p.id}`);
    if (p.kind === 'blink') early('blink', p.x, `Plattform ${p.id}`);
    if (p.slick) early('ice', p.x, `Plattform ${p.id}`);
  }
  for (const st of world.stars) if (st.falling) early('fallingstar', st.x, `Stern ${st.id}`);
  for (const pu of world.powerups) early('powerup', pu.x, `Powerup ${pu.id}`);

  // Kein Gegner oder Hindernis in den ersten SAFE_START Pixeln eines Chunks
  const danger = [
    ...world.enemies.map((e) => ({ id: e.id, x: e.minX, what: e.kind })),
    ...world.hazards.map((h) => ({ id: h.id, x: hazardLeft(h), what: h.kind })),
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

test('Test Chunks: alle Mechaniken, diff 1 bis 9,4, dicht genug für die ganze Kurve', () => {
  const tags = new Set(TEST_LIB.flatMap((c) => c.mech));
  for (const tag of ['spring', 'ice', 'blink', 'comet', 'hailcloud', 'walker', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'moving', 'breakable']) {
    assert.ok(tags.has(tag), `Tag ${tag} fehlt`);
  }
  assert.ok(TEST_LIB.some((c) => c.diff === 1) && TEST_LIB.some((c) => c.diff >= 9.4));
  assert.ok(new Set(TEST_LIB.map((c) => c.min)).size >= 12);
  // Zu jeder Stelle der Kurve gibt es mehrere Chunks innerhalb von 0,6 um die Zieldifficulty
  for (let m = 300; m <= 4000; m += 100) {
    const near = TEST_LIB.filter((c) => !c.rest && m >= c.min && m < c.max && Math.abs(c.diff - difficultyAt(m)) <= 0.6 + 1e-9);
    assert.ok(near.length >= 2, `bei ${m} m nur ${near.length} Chunks nahe der Kurve ${difficultyAt(m).toFixed(1)}`);
  }
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

// Mittlere Schwierigkeit der normalen Chunks (ohne Ruhepausen) zwischen zwei Metern, über mehrere Seeds
function meanDiff(logs, a, b) {
  const xs = logs.flatMap((log) => log.filter((c) => !c.rest && c.meter >= a && c.meter < b).map((c) => c.diff));
  return xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
}

test('Weltgröße: Schwierigkeit steigt über die Abschnitte bis in den Albtraum', () => {
  const logs = [1, 2, 3, 4, 5, 6].map((seed) => drive(seed, TEST_LIB, { meters: 4600 }).log);
  const steps = [[250, 800], [800, 1200], [1200, 1700], [1700, 2400], [2400, 3200], [3200, 4000]];
  const means = steps.map(([a, b]) => meanDiff(logs, a, b));
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1] + 0.4, `Abschnitt ab ${steps[i][0]} m: ${means.map((m) => m.toFixed(2)).join(' < ')}`);
  assert.ok(means[0] < 3.3, `Anfang ${means[0].toFixed(2)}`);
  // Albtraum: bei 3200 m und danach liegen die Chunks im Mittel bei mindestens 8,5
  for (const [a, b] of [[3200, 3700], [3700, 4600]]) {
    const m = meanDiff(logs, a, b);
    assert.ok(m >= 8.5, `${a} bis ${b} m: mittlere Schwierigkeit ${m.toFixed(2)}`);
  }
  assert.ok(difficultyAt(3200) >= 8.5 && difficultyAt(3200) <= 9);
});

// ---------- Auswahl nach Zieldifficulty ----------

test('Gewicht nach Abstand: am meisten nahe dem Ziel, 2,5 Stufen darunter höchstens ein Zehntel', () => {
  for (const target of [1, 3.8, 6.2, 9]) {
    assert.equal(diffFit(target, target), 1);
    // Ein Stück darüber (erlaubt sind bis +0,6) fällt sanft ab, darunter stärker, alles bleibt endlich und positiv
    let prev = 1;
    for (let d = 0.05; d <= 0.6 + 1e-9; d += 0.05) {
      const f = diffFit(target + d, target);
      assert.ok(f < prev && f > 0.5, `+${d.toFixed(2)}: ${f}`);
      prev = f;
    }
    prev = 1;
    for (let u = 0.05; u <= 9; u += 0.05) {
      const f = diffFit(target - u, target);
      assert.ok(f < prev && f > 0 && Number.isFinite(f), `-${u.toFixed(2)}: ${f}`);
      prev = f;
    }
    assert.ok(diffFit(target - 0.5, target) > 0.6, 'nahe dem Ziel bleibt das Gewicht hoch');
    assert.ok(diffFit(target - 1, target) < 0.3, 'eine Stufe darunter ist es schon deutlich weniger');
    assert.ok(diffFit(target - 2.5, target) <= 0.1, 'ab 2,5 Stufen darunter höchstens ein Zehntel');
    assert.ok(diffFit(target - 2.5, target) < diffFit(target - 1.5, target) && diffFit(target - 5, target) < diffFit(target - 4, target));
  }
  // Auch weit unter dem Ziel bleibt die Reihenfolge erhalten: von zwei zu leichten Chunks gewinnt der schwerere deutlich
  assert.ok(diffFit(5, 9) > 2 * diffFit(4, 9) * 0.99 && diffFit(5, 9) > 2 * diffFit(3, 9));
  // Ungültige Werte stören nicht
  for (const bad of [NaN, undefined, Infinity, -Infinity]) {
    assert.ok(Number.isFinite(diffFit(bad, 5)) && Number.isFinite(diffFit(5, bad)));
  }
});

test('Auswahl: Chunks weit unter dem Ziel kommen selten vor, Chunks nahe dem Ziel am häufigsten', () => {
  // Je fünf gleich gebaute Chunks mit Schwierigkeit 2,5 / 3,5 / 4,5 / 5,5. Zwischen 1300 und 1500 m liegt das Ziel bei 5,2 bis 5,7.
  const levels = [2.5, 3.5, 4.5, 5.5];
  const lib = [TEST_LIB[0]];
  for (const diff of levels) {
    for (let i = 1; i <= 5; i++) {
      lib.push({
        id: `d${diff}-${i}`, name: `Stufe ${diff}`, diff, weight: 2, min: 0, max: Infinity, mech: [],
        build(b) {
          const a = b.ground(0, 0, 300);
          const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 500 + 20 * i);
          b.starsOver(h, 3, 60);
          b.route(a, h);
        },
      });
    }
  }
  const count = Object.fromEntries(levels.map((d) => [d, 0]));
  for (let seed = 1; seed <= 60; seed++) {
    const r = drive(seed, lib, { meters: 1500 });
    for (const c of r.log) if (!c.rest && c.meter >= 1300 && c.meter < 1500) count[c.diff]++;
  }
  const all = levels.reduce((p, d) => p + count[d], 0);
  assert.ok(all > 400, `nur ${all} Chunks`);
  assert.ok(count[5.5] > count[4.5] && count[4.5] > count[3.5], JSON.stringify(count));
  assert.ok(count[3.5] / all < 0.04 && count[2.5] / all < 0.03, `weit unter dem Ziel: ${JSON.stringify(count)}`);
  assert.ok(count[5.5] / all > 0.65 && count[4.5] / all < 0.35, `nahe dem Ziel: ${JSON.stringify(count)}`);
});

test('Auswahl: fehlt die Schwierigkeit der Kurve in der Bibliothek, gewinnt der schwerste Chunk', () => {
  // Nur Chunks bis Schwierigkeit 4, die Kurve liegt bei 3200 m und mehr bei 9
  const levels = [1.5, 2.5, 3, 3.5, 4];
  const lib = [TEST_LIB[0]];
  for (const diff of levels) {
    for (let i = 1; i <= 3; i++) {
      lib.push({
        id: `l${diff}-${i}`, name: `Stufe ${diff}`, diff, weight: 2, min: 0, max: Infinity, mech: [],
        build(b) {
          const a = b.ground(0, 0, 300);
          const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 500 + 20 * i);
          b.starsOver(h, 3, 60);
          b.route(a, h);
        },
      });
    }
  }
  const count = Object.fromEntries(levels.map((d) => [d, 0]));
  for (let seed = 1; seed <= 20; seed++) {
    const r = drive(seed, lib, { meters: 3800 });
    for (const c of r.log) if (!c.rest && c.meter >= 3300) count[c.diff]++;
  }
  const all = levels.reduce((p, d) => p + count[d], 0);
  assert.ok(count[4] / all > 0.3, JSON.stringify(count));
  assert.ok(count[4] > count[3.5] && count[3.5] > count[3] && count[3] > count[2.5] && count[2.5] > count[1.5], JSON.stringify(count));
});

// ---------- Tore ----------

test('Tore stehen nahe bei gateMeter(n), auch wenn die Chunks mit der Schwierigkeit länger werden', () => {
  for (const [name, lib] of [['Test Chunks', TEST_LIB], ['echte Bibliothek', CHUNKS]]) {
    const dev = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = drive(seed, lib, { meters: 6000, every: 1e9 });
      for (const c of r.log) if (c.gate) dev.push(meterOf(c.gateX) - gateMeter(c.gate));
    }
    const mean = dev.reduce((p, q) => p + q, 0) / dev.length;
    assert.ok(dev.length >= 150, `nur ${dev.length} Tore`);
    assert.ok(Math.abs(mean) < 10, `${name}: im Mittel ${mean.toFixed(1)} m neben der Marke`);
    assert.ok(dev.every((d) => Math.abs(d) < 40), `${name}: größte Abweichung ${Math.max(...dev.map(Math.abs)).toFixed(1)} m`);
  }
});

// ---------- Powerups ----------

// Abstände zwischen Powerups (Meter) für eine Welt bis meters, der Anfang bei 0 und das Ende zählen mit
function powerGaps(seed, lib, meters = 8000) {
  const r = drive(seed, lib, { meters, every: 1e9 });
  const at = r.world.powerups.map((pu) => meterOf(pu.x)).filter((m) => m <= meters).sort((p, q) => p - q);
  const gaps = [];
  let prev = 0;
  for (const m of [...at, meters]) {
    gaps.push(m - prev);
    prev = m;
  }
  return { gaps, count: at.length };
}

test('Powerups: nach langer Dürre bekommen Ruhechunks mit Powerups mehr Gewicht', () => {
  // Gleiche Ruhechunks, zwei mit und vier ohne Powerup. Ohne Ausgleich läge der Anteil bei einem Drittel.
  const mk = (id, power) => ({
    id, name: id, diff: 1, weight: 2, min: 300, max: Infinity, mech: power ? ['powerup'] : [], rest: true,
    build(b) {
      const g = b.ground(0, 0, 560);
      if (power) b.powerup('shield', 280, -70);
      b.starsOver(g, 5, 55);
      b.route(g);
    },
  });
  const lib = [...TEST_LIB.slice(0, 8).filter((c) => c.id !== 't-gift'), mk('rp1', true), mk('rp2', true), mk('rn1', false), mk('rn2', false), mk('rn3', false), mk('rn4', false)];
  let withPower = 0;
  let rests = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = drive(seed, lib, { meters: 4000, every: 1e9 });
    for (const c of r.log) {
      if (c.step === 'normal' || c.gate || !/^r[pn]/.test(c.id)) continue;
      rests++;
      if (c.id.startsWith('rp')) withPower++;
    }
  }
  assert.ok(rests > 150, `nur ${rests} Ruhepausen`);
  assert.ok(withPower / rests > 0.6, `Anteil ${(withPower / rests).toFixed(2)} bei ${rests} Ruhepausen`);
});

test('Powerups mit der echten Bibliothek: fast immer höchstens 400 Meter zwischen zwei Powerups (40 Seeds)', (tc) => {
  let count = 0;
  let sum = 0;
  let n = 0;
  let worst = 0;
  let long = 0;
  for (const seed of SEEDS) {
    const r = powerGaps(seed, CHUNKS);
    count += r.count;
    for (const g of r.gaps) {
      sum += g;
      n++;
      worst = Math.max(worst, g);
      if (g > 400) long++;
    }
  }
  tc.diagnostic(`Powerups: ${(count / SEEDS.length).toFixed(1)} je 8000 m, mittlerer Abstand ${(sum / n).toFixed(0)} m, größter ${worst.toFixed(0)} m, ${long} von ${n} Abständen über 400 m`);
  assert.ok(sum / n <= 300, `mittlerer Abstand ${(sum / n).toFixed(0)} m`);
  assert.ok(long / n < 0.1, `${long} von ${n} Abständen über 400 m`);
  assert.ok(worst < 1200, `größter Abstand ${worst.toFixed(0)} m`);
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

test('Einführung: jede Mechanik erscheint innerhalb von 250 Metern nach ihrer Freischaltung', () => {
  const tags = ['walker', 'spike', 'moving', 'rain', 'spring', 'breakable', 'jumper', 'lightning', 'ice', 'wind', 'flyer', 'charger', 'blink', 'hailcloud', 'comet'];
  const delays = Object.fromEntries(tags.map((tag) => [tag, []]));
  for (let seed = 1; seed <= 24; seed++) {
    const r = drive(seed, TEST_LIB, { meters: 2300 });
    for (const tag of tags) {
      const first = r.log.find((c) => c.tags.includes(tag));
      assert.ok(first, `Seed ${seed}: ${tag} kommt nie vor`);
      delays[tag].push(first.meter - unlockMeter(tag));
    }
  }
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  for (const [tag, d] of Object.entries(delays)) {
    assert.ok(Math.min(...d) >= -1e-6, `${tag}: schon vor der Freischaltung`);
    assert.ok(mean(d) < 120, `${tag}: im Mittel ${mean(d).toFixed(0)} m nach der Freischaltung`);
    assert.ok(Math.max(...d) < 250, `${tag}: spätestens ${Math.max(...d).toFixed(0)} m nach der Freischaltung`);
  }
});

test('Einführung mit der echten Bibliothek: was die Chunks zeigen können, erscheint bald nach dem frühesten Chunk', () => {
  // Frühester möglicher Meter einer Mechanik: Freischaltung oder kleinstes min eines passenden Chunks. Was die
  // Bibliothek (noch) nicht zeigt, wird nicht geprüft.
  const tags = ['walker', 'spike', 'moving', 'rain', 'spring', 'breakable', 'jumper', 'lightning', 'ice', 'wind', 'flyer', 'charger', 'blink', 'hailcloud', 'comet'];
  const first = {};
  for (const tag of tags) {
    const mins = CHUNKS.filter((c) => !c.rest && c.mech.includes(tag)).map((c) => c.min);
    if (mins.length) first[tag] = Math.max(unlockMeter(tag), Math.min(...mins));
  }
  assert.ok(Object.keys(first).length >= 8, `nur ${Object.keys(first).join(', ')}`);
  for (let seed = 1; seed <= 16; seed++) {
    const r = drive(seed, CHUNKS, { meters: 2600 });
    for (const [tag, from] of Object.entries(first)) {
      const hit = r.log.find((c) => c.tags.includes(tag));
      assert.ok(hit, `Seed ${seed}: ${tag} kommt bis 2600 m nie vor`);
      assert.ok(hit.meter - from < 250, `Seed ${seed}: ${tag} erst ${(hit.meter - from).toFixed(0)} m nach dem frühesten Zeitpunkt (${from} m)`);
    }
  }
});

test('Einführung: ein Chunk, der eine Mechanik nur nennt, aber nicht baut, blockiert die Auswahl nicht', () => {
  // Der Lügner nennt "ice" (frei ab 800 m), baut aber nur eine gewöhnliche Wolke. Echte Eis Chunks gibt es in dieser Bibliothek nicht.
  const liar = {
    id: 'x-liar', name: 'Lügner', diff: 4, weight: 2, min: 800, max: Infinity, mech: ['ice'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 520);
      b.starsOver(h, 3, 60);
      b.route(a, h);
    },
  };
  const lib = [...TEST_LIB.filter((c) => !c.mech.includes('ice')), liar];
  let liars = 0;
  let all = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = drive(seed, lib, { meters: 3000 });
    assert.equal(r.stats.rejects, 0);
    const mine = r.log.filter((c) => c.id === 'x-liar');
    assert.ok(mine.length > 0 && mine[0].meter - 800 < 250, `Seed ${seed}: der Lügner erscheint nie oder zu spät`);
    for (const c of r.log) {
      if (c.rest || c.meter < 1100) continue;
      all++;
      if (c.id === 'x-liar') liars++;
    }
  }
  assert.ok(liars / all < 0.15, `Anteil ${(100 * liars / all).toFixed(1)} Prozent nach 1100 m`);
});

// ---------- Ereignisse ----------

// Zwillings Bibliothek: sechs Chunks mit Gegner und sechs ohne, sonst gleich (Schwierigkeit, Gewicht, Länge).
// So zeigt sich allein der Einfluss von enemyBoost.
function twinLib(kind, min) {
  const mk = (id, withEnemy) => ({
    id, name: id, diff: 3, weight: 2, min, max: Infinity, mech: withEnemy ? [kind] : [],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 520);
      if (withEnemy && kind === 'walker') b.walker(h, 0.5);
      if (withEnemy && kind === 'hailcloud') b.hailcloud(h.x - b.ox + 330, -202);
      b.starsOver(h, 3, 60);
      b.route(a, h);
    },
  });
  return [TEST_LIB[0], ...[1, 2, 3, 4, 5, 6].map((i) => mk(`e${i}`, true)), ...[1, 2, 3, 4, 5, 6].map((i) => mk(`p${i}`, false))];
}

for (const [kind, min, upTo] of [['walker', 300, 1900], ['hailcloud', 1250, 2700]]) {
  test(`enemyBoost verdoppelt das Gewicht von Chunks mit Gegnern (${kind})`, () => {
    const lib = twinLib(kind, min);
    const share = (boost) => {
      let enemy = 0;
      let all = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const r = drive(seed, lib, { meters: upTo, setup: (s) => { s.events.enemyBoost = boost; } });
        assert.equal(r.stats.rejects, 0, JSON.stringify(r.s.gen.errors.slice(0, 2)));
        for (const c of r.log) {
          if (c.meter < min + 100 || c.rest) continue;
          all++;
          if (c.enemies) enemy++;
        }
      }
      return enemy / all;
    };
    const plain = share(false);
    const boosted = share(true);
    const odds = (p) => p / (1 - p);
    assert.ok(boosted > plain + 0.06, `ohne ${plain.toFixed(2)}, mit ${boosted.toFixed(2)}`);
    // Die Wiederholungsregeln dämpfen den Faktor 2 etwas, ein Faktor zwischen 1,3 und 3 muss es bleiben
    assert.ok(odds(boosted) / odds(plain) > 1.3 && odds(boosted) / odds(plain) < 3, `Quotenverhältnis ${(odds(boosted) / odds(plain)).toFixed(2)}`);
  });
}

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
    s.gen = { keepLog: true };
    initGenerator(s, lib);
    s.camX = 300000;
    const t0 = performance.now();
    ensureAhead(s, lib);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
    assert.ok(s.gen.nextX >= s.camX + LIMITS.GEN_AHEAD);
    assert.ok(s.platforms.length <= LIMITS.MAX_PLATFORMS && s.platforms.every((p) => p.x + p.w >= s.camX - LIMITS.CLEAN_BEHIND - 1 || p.kind === 'moving'));
    assert.deepEqual(invariants(s), []);
    // Der Anschluss nach dem Sprung ist begehbar: jede Plattform der Route hinter dem Bild ist mit den physischen Grenzen
    // (Doppelsprung, volle Reichweite, Sprungwolke) von der vorigen aus zu erreichen
    const route = s.gen.routeLog.filter((p) => p.x > s.camX - LIMITS.CLEAN_BEHIND - 4000);
    assert.ok(route.length > 12, `nur ${route.length} Routenplattformen`);
    for (let i = 1; i < route.length; i++) assert.ok(hopOkMoving(route[i - 1], route[i], { safe: 1, dbl: true, minLand: 56 }), `Sprung ${route[i - 1].id} nach ${route[i].id} (${route[i].chunk})`);
    // Die Test Chunks haben keine Sprungwolken: dort liegen die Plattformen auch in x Reihenfolge dicht beieinander
    if (lib === TEST_LIB) {
      const ps = s.platforms.slice().sort((a, b) => a.x - b.x);
      for (let i = 1; i < ps.length; i++) assert.ok(ps[i].x - (ps[i - 1].x + ps[i - 1].w) < 400);
    }
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

// Hagelwolken legen im Spiel bis zu LIMITS.MAX_HAZARDS Hagelkörner in s.hazards ab. Der Generator lässt dafür
// beim Übernehmen eines Chunks mit Hagelwolke Platz für sechs Körner frei.
const HAIL_RESERVE = 6;
const hailChunk = {
  id: 'h-hail', name: 'Nur Hagel', diff: 5, weight: 5, min: 1250, max: Infinity, mech: ['hailcloud'],
  build(b) {
    const a = b.ground(0, 0, 300);
    const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 640);
    b.hailcloud(h.x - b.ox + 330, -202);
    b.starsOver(h, 4, 60);
    b.route(a, h);
  },
};
const plainChunk = {
  id: 'h-plain', name: 'Nur Boden', diff: 5, weight: 5, min: 1250, max: Infinity, mech: [],
  build(b) {
    const a = b.ground(0, 0, 300);
    const h = b.ground(300 + hop(b, 0, 0, 0.7), 0, 600);
    b.starsOver(h, 4, 60);
    b.route(a, h);
  },
};

// Zustand bei 1300 m mit n Stachelwolken im Bild (zählen als Hindernisse), ohne Tor und Ruhepause in der Nähe
function hazardWorld(n, seed = 5, withPlain = true) {
  const lib = withPlain ? [TEST_LIB[0], hailChunk, plainChunk] : [TEST_LIB[0], hailChunk];
  const s = createState({ seed });
  initGenerator(s, lib);
  const g = s.gen;
  g.nextX = atMeter(1300);
  g.gateN = 3;
  g.nextRest = 99999;
  s.camX = g.nextX - 500;
  const host = createStaticPlatform(s, s.camX, 360, 400);
  s.platforms.push(host);
  for (let i = 0; i < n; i++) s.hazards.push(createSpike(s, host, (i % 10) / 10));
  ensureAhead(s, lib);
  return s;
}

test('Hagelwolken: mit Platz für sechs Körner im Hindernislimit wird der Chunk gebaut', () => {
  // Der Chunk mit Hagelwolke ist die einzige Wahl für normale Rollen: passt er ins Limit, muss er kommen
  for (let seed = 1; seed <= 12; seed++) {
    const s = hazardWorld(LIMITS.MAX_HAZARDS - HAIL_RESERVE, seed, false);
    assert.ok(s.enemies.some((e) => e.kind === 'hailcloud'), `Seed ${seed}: keine Hagelwolke trotz Platz`);
    assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS - HAIL_RESERVE, `Hindernisse ${s.hazards.length}`);
    assert.ok(s.gen.nextX >= s.camX + LIMITS.GEN_AHEAD);
  }
});

test('Hagelwolken: ohne Platz für sechs Körner wird kein Chunk mit Hagelwolke übernommen, die Welt geht trotzdem weiter', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = hazardWorld(LIMITS.MAX_HAZARDS - HAIL_RESERVE + 1, seed);
    assert.ok(s.enemies.every((e) => e.kind !== 'hailcloud'), `Seed ${seed}: Hagelwolke trotz vollem Hindernislimit`);
    assert.ok(s.gen.nextX >= s.camX + LIMITS.GEN_AHEAD, 'die Welt endet im Bild');
    assert.deepEqual(invariants(s), []);
  }
  // Auch ganz voll: nichts wird über das Limit hinaus gebaut
  const full = hazardWorld(LIMITS.MAX_HAZARDS);
  assert.equal(full.hazards.length, LIMITS.MAX_HAZARDS);
  assert.ok(full.enemies.every((e) => e.kind !== 'hailcloud'));
});

test('Hagelwolken: lauter Hagel Chunks halten die Limits auch mit Hagel im Spiel', () => {
  const lib = [TEST_LIB[0], hailChunk];
  const s = createState({ seed: 6 });
  s.gen = { keepLog: true };
  initGenerator(s, lib);
  let maxHazards = 0;
  let holes = 0;
  for (let n = 1; n <= 1800; n++) {
    s.camX = atMeter(1250) + n * 40;
    s.gen.nextX = Math.max(s.gen.nextX, s.camX);
    ensureAhead(s, lib);
    // Wie im Spiel: jede Hagelwolke im Bild legt bei Gelegenheit drei Körner ab, solange es das Limit erlaubt
    if (n % 20 === 0) {
      for (const e of s.enemies) {
        if (e.kind === 'hailcloud' && e.x > s.camX && e.x < s.camX + W && s.hazards.length + 3 <= LIMITS.MAX_HAZARDS) {
          for (let k = 0; k < 3; k++) s.hazards.push({ id: s.nextId++, kind: 'hail', x: e.x + k * 10, y: e.y + 30, w: 18, h: 18, vx: 0, vy: 300, life: 3, anim: 0 });
        }
      }
    }
    // Hagel fällt aus dem Bild
    if (n % 20 === 10) s.hazards = s.hazards.filter((h) => h.kind !== 'hail');
    maxHazards = Math.max(maxHazards, s.hazards.length);
    if (s.gen.nextX < s.camX + W) holes++;
  }
  assert.equal(holes, 0, 'die Welt darf im Bild nie enden');
  assert.ok(maxHazards <= LIMITS.MAX_HAZARDS, `Hindernisse ${maxHazards}`);
  assert.ok(s.gen.stats.chunks > 50, `${s.gen.stats.chunks} Chunks`);
  assert.deepEqual(invariants(s), []);
});

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

  // Neue Objekte: Sprung und Blinkwolke, Hagelwolke, Hagel, Komet (seine Mitte liegt in x, er reicht 40 px nach links und rechts)
  s.platforms.push(mark(createSpringPlatform(s, 1000, 300, 100), true), mark(createSpringPlatform(s, 2100, 300, 100), false),
    mark(createBlinkPlatform(s, 1500, 300, 100), true), mark(createBlinkPlatform(s, 1600, 300, 100), false)); // endet bei 1600 und 1700
  s.enemies.push(mark(createHailcloud(s, 1000, 200), true), mark(createHailcloud(s, 2200, 200), false));
  s.hazards.push(mark(createHail(s, 1000, 200, 0, 300), true), mark(createHail(s, 2100, 200, 0, 300), false),
    mark(createComet(s, lim - 50, 360), true), mark(createComet(s, lim - 30, 360), false));

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
  for (const tag of ['walker', 'spike', 'moving', 'rain', 'breakable', 'jumper', 'lightning', 'wind', 'flyer', 'charger', 'spring', 'ice', 'blink', 'hailcloud', 'comet']) {
    assert.ok(mechs.includes(tag), `Hinweis ${tag} fehlt`);
  }
  // x liegt an der ersten Stelle, an der die Mechanik wirklich vorkommt
  const w = r.world;
  const first = {
    walker: Math.min(...w.enemies.filter((e) => e.kind === 'walker').map((e) => e.x)),
    spike: Math.min(...w.hazards.filter((e) => e.kind === 'spike').map((e) => e.x)),
    rain: Math.min(...w.zones.filter((e) => e.kind === 'rain').map((e) => e.x)),
    breakable: Math.min(...w.platforms.filter((e) => e.kind === 'breakable').map((e) => e.x)),
    spring: Math.min(...w.platforms.filter((e) => e.kind === 'spring').map((e) => e.x)),
    blink: Math.min(...w.platforms.filter((e) => e.kind === 'blink').map((e) => e.x)),
    ice: Math.min(...w.platforms.filter((e) => e.slick).map((e) => e.x)),
    hailcloud: Math.min(...w.enemies.filter((e) => e.kind === 'hailcloud').map((e) => e.x)),
    comet: Math.min(...w.hazards.filter((e) => e.kind === 'comet').map((e) => e.x - e.w / 2)),
  };
  for (const [tag, x] of Object.entries(first)) assert.equal(q.find((h) => h.mech === tag).x, x, tag);
});

// Markiert alle Tipps als gezeigt, damit nur die Hinweise der Mechaniken geprüft werden
const silenceTips = (s) => { for (const tip of TIPS) s.hints.shown[tip.id] = true; };

test('Hinweise: updateHints zeigt sie als Banner, einmal pro Mechanik', () => {
  const s = createState({ seed: 3 });
  silenceTips(s);
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
  silenceTips(s);
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

// ---------- Tipps zu den Fähigkeiten ----------

test('Tipps: Daten in constants.js sind vollständig und ohne Gedankenstriche', () => {
  assert.ok(TIPS.length >= 4);
  assert.equal(new Set(TIPS.map((x) => x.id)).size, TIPS.length, 'doppelte ids');
  for (const tip of TIPS) {
    assert.ok(typeof tip.id === 'string' && tip.id && typeof tip.text === 'string' && tip.text.length > 5 && Number.isFinite(tip.at) && tip.at > 0);
    assert.ok(!/[\u2013\u2014]/.test(tip.text) && !/^\s*-/.test(tip.text), tip.text);
    assert.ok(!(tip.id in HINTS), `${tip.id} kollidiert mit einer Mechanik`);
  }
  for (let i = 1; i < TIPS.length; i++) assert.ok(TIPS[i].at > TIPS[i - 1].at, 'in der Reihenfolge der Meter');
});

test('Tipps: jeder erscheint einmal pro Lauf als Banner, sobald der Spieler die Meter erreicht', () => {
  const s = createState({ seed: 4 });
  for (const tip of TIPS) {
    s.player.x = atMeter(tip.at - 1);
    s.banner = null;
    updateHints(s);
    assert.equal(s.banner, null, `${tip.id} zu früh`);
    assert.ok(!s.hints.shown[tip.id]);
    s.player.x = atMeter(tip.at);
    updateHints(s);
    assert.ok(s.banner, `${tip.id} fehlt`);
    assert.equal(s.banner.text, tip.text);
    assert.equal(s.banner.sub, '');
    assert.ok(s.banner.dur > 2 && s.banner.dur < 6);
    assert.equal(s.hints.shown[tip.id], true);
    // Nochmal an derselben Stelle: kein zweites Mal
    s.banner = null;
    updateHints(s);
    updateHints(s);
    assert.equal(s.banner, null, `${tip.id} kommt ein zweites Mal`);
  }
  // Weit hinten im Lauf kommt nichts mehr
  s.player.x = atMeter(5000);
  updateHints(s);
  assert.equal(s.banner, null);
  // Ein neuer Lauf (neuer Zustand) zeigt sie wieder
  const fresh = createState({ seed: 4 });
  fresh.player.x = atMeter(TIPS[0].at + 1);
  updateHints(fresh);
  assert.equal(fresh.banner.text, TIPS[0].text);
});

test('Tipps: ein laufendes Banner hat Vorrang, der Tipp wartet danach', () => {
  const s = createState({ seed: 4 });
  s.player.x = atMeter(TIPS[1].at + 1);
  s.hints.shown[TIPS[0].id] = true;
  s.banner = { text: 'Traumwelt 2', sub: '', t: 0, dur: 2.6 };
  updateHints(s);
  assert.equal(s.banner.text, 'Traumwelt 2');
  assert.ok(!s.hints.shown[TIPS[1].id]);
  s.banner = null;
  updateHints(s);
  assert.equal(s.banner.text, TIPS[1].text);
});

test('Tipps: mehrere fällige Tipps kommen nacheinander, einer pro Banner, in der Reihenfolge der Meter', () => {
  const s = createState({ seed: 4 });
  s.player.x = atMeter(TIPS[TIPS.length - 1].at + 10);
  const seen = [];
  for (let i = 0; i < TIPS.length + 2; i++) {
    updateHints(s);
    if (s.banner) {
      seen.push(s.banner.text);
      s.banner = null;
    }
  }
  assert.deepEqual(seen, TIPS.map((x) => x.text));
});

test('Tipps: Hinweise zu Mechaniken kommen zuerst, ein toter oder sterbender Spieler und NaN stören nicht', () => {
  const s = createState({ seed: 4 });
  s.player.x = atMeter(TIPS[0].at + 1);
  s.hints.queue.push({ x: s.player.x + 100, text: HINTS.walker, mech: 'walker' });
  updateHints(s);
  assert.equal(s.banner.text, HINTS.walker);
  s.banner = null;
  updateHints(s);
  assert.equal(s.banner.text, TIPS[0].text);
  // tot, sterbend, NaN
  const d = createState({ seed: 4 });
  d.player.x = atMeter(TIPS[0].at + 1);
  d.player.dead = true;
  updateHints(d);
  d.player.dead = false;
  d.mode = 'dying';
  updateHints(d);
  d.mode = 'playing';
  d.player.x = NaN;
  updateHints(d);
  assert.equal(d.banner, null);
  assert.ok(!d.hints.shown[TIPS[0].id]);
  // fehlende Strukturen
  const e = createState({ seed: 4 });
  e.hints = null;
  updateHints(e);
  e.hints = { shown: {}, queue: [] };
  e.run = null;
  e.player.x = atMeter(TIPS[0].at + 1);
  updateHints(e);
  assert.equal(e.banner.text, TIPS[0].text);
});

test('Tipps: die Simulation ruft updateHints auf, der erste Tipp erscheint auf dem Weg', () => {
  const s = newGame(8);
  s.player.x = atMeter(TIPS[0].at + 2);
  stepSim(s, input({ move: 1 }), 1 / 60);
  assert.ok(s.banner && s.banner.text === TIPS[0].text, JSON.stringify(s.banner));
  assert.equal(s.hints.shown[TIPS[0].id], true);
});

test('Tipps: der Zustand bleibt reine Daten', () => {
  const s = createState({ seed: 4 });
  s.player.x = atMeter(TIPS[0].at + 1);
  updateHints(s);
  assert.deepEqual(structuredClone(s.hints), s.hints);
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
