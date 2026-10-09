// Statistische Tests der Schwierigkeitskurve des Generators (game/generator.js, SECTIONS in constants.js).
// Die Kurve steigt bis Schwierigkeit 9 bei 3200 Metern (Albtraum). Geprüft wird über je 30 Seeds bis 8000 Meter:
// Die mittlere Schwierigkeit der Chunks wächst von Block zu Block, kein Chunk liegt weit über der Kurve, der
// Fallback flat bleibt die Ausnahme und die Erzeugung ist schnell. Einmal mit den dichten Test Chunks
// (tests/gen-lib.mjs, Schwierigkeit 1 bis 9,4) und einmal mit der echten Bibliothek, die parallel wächst.
// Die echte Bibliothek kann nur so schwer werden wie ihre schwersten Chunks, darum prüfen die Tests dort
// "so weit sie reicht" und melden den Rest als Diagnose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { METER, START_X, difficultyAt, sectionAt } from '../game/constants.js';
import { ensureAhead, initGenerator } from '../game/generator.js';
import { createState } from '../game/state.js';
import { CHUNKS } from '../game/chunks/index.js';
import { TEST_LIB } from './gen-lib.mjs';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const METERS = 8000;
const BLOCK = 500;
const BLOCKS = METERS / BLOCK;
const LIBS = [['Test Chunks', TEST_LIB], [`echte Bibliothek (${CHUNKS.length} Chunks)`, CHUNKS]];

// Erzeugt die Welt ohne Spieler: die Kamera läuft in Schritten von step Pixeln voran.
function generate(seed, lib, { meters = METERS, step = 100, keepLog = true } = {}) {
  const s = createState({ seed });
  if (keepLog) s.gen = { keepLog: true };
  const t0 = performance.now();
  initGenerator(s, lib);
  const endX = START_X + meters * METER;
  for (let cam = step; s.gen.nextX < endX; cam += step) {
    s.camX = cam;
    ensureAhead(s, lib);
  }
  return { s, ms: performance.now() - t0, log: s.gen.chunkLog || [], stats: s.gen.stats };
}

// Läufe je Bibliothek nur einmal erzeugen
const cache = new Map();
function runs(lib) {
  if (!cache.has(lib)) cache.set(lib, SEEDS.map((seed) => generate(seed, lib)));
  return cache.get(lib);
}

// Mittlere Schwierigkeit der normalen Chunks (ohne Ruhepausen) je 500 m Block, über alle Seeds
function blockMeans(lib) {
  const sum = new Array(BLOCKS).fill(0);
  const cur = new Array(BLOCKS).fill(0);
  const n = new Array(BLOCKS).fill(0);
  for (const r of runs(lib)) {
    for (const c of r.log) {
      if (c.rest) continue;
      const i = Math.min(BLOCKS - 1, Math.floor(c.meter / BLOCK));
      sum[i] += c.diff;
      cur[i] += difficultyAt(c.meter);
      n[i]++;
    }
  }
  return sum.map((v, i) => ({ from: i * BLOCK, n: n[i], mean: v / Math.max(1, n[i]), curve: cur[i] / Math.max(1, n[i]) }));
}

const fmt = (blocks) => blocks.map((b) => `${b.from}:${b.mean.toFixed(2)}`).join(' ');
const topDiff = (lib) => Math.max(...lib.filter((c) => !c.rest).map((c) => c.diff));

// ---------- Die Kurve selbst ----------

test('Kurve: steigt von 1 auf 9, ohne Sprünge, Albtraum ab 3200 Metern', () => {
  assert.equal(difficultyAt(0), 1);
  assert.ok(difficultyAt(3200) >= 8.5 && difficultyAt(3200) <= 9, `bei 3200 m: ${difficultyAt(3200)}`);
  assert.equal(difficultyAt(100000), 9, 'danach bleibt es bei 9');
  let prev = difficultyAt(0);
  for (let m = 1; m <= 6000; m++) {
    const d = difficultyAt(m);
    assert.ok(d >= prev - 1e-9, `fällt bei ${m} m`);
    assert.ok(d - prev < 0.02, `Sprung bei ${m} m: ${prev} auf ${d}`);
    prev = d;
  }
  // Rund 80 Prozent steiler als zuvor: die Kurve erreicht 5 spätestens bei 1200 m und 6 vor 1700 m
  assert.ok(difficultyAt(1200) >= 5 && difficultyAt(1700) >= 6.2 - 1e-9);
  assert.equal(sectionAt(3200).name, 'Traumsturm');
});

// ---------- Mittlere Schwierigkeit je Block ----------

test('Test Chunks: die mittlere Schwierigkeit steigt von Block zu Block bis in den Albtraum', (tc) => {
  const blocks = blockMeans(TEST_LIB);
  tc.diagnostic(`Test Chunks: ${fmt(blocks)}`);
  for (const b of blocks) assert.ok(b.n >= 100, `Block ab ${b.from} m hat nur ${b.n} Chunks`);
  // Während die Kurve steigt (bis 3000 m): jeder Block deutlich schwerer als der davor
  for (let i = 1; i <= 6; i++) {
    assert.ok(blocks[i].mean > blocks[i - 1].mean + 0.5, `Block ab ${blocks[i].from} m (${blocks[i].mean.toFixed(2)}) nicht über dem davor (${blocks[i - 1].mean.toFixed(2)})`);
  }
  // Danach bleibt die Kurve bei 9: die Blöcke fallen nicht ab und liegen im Albtraum
  for (let i = 7; i < BLOCKS; i++) {
    assert.ok(blocks[i].mean >= blocks[i - 1].mean - 0.2, `Block ab ${blocks[i].from} m fällt ab`);
    assert.ok(blocks[i].mean >= 8.5, `Block ab ${blocks[i].from} m: ${blocks[i].mean.toFixed(2)}`);
  }
  assert.ok(blocks[0].mean < 1.5 && blocks[1].mean < 3.5);
});

test('Test Chunks: die Chunks folgen der Kurve, der Rückstand bleibt klein', () => {
  const blocks = blockMeans(TEST_LIB);
  for (const b of blocks.slice(1)) assert.ok(b.curve - b.mean < 0.8 && b.mean - b.curve < 0.3, `Block ab ${b.from} m: Kurve ${b.curve.toFixed(2)}, Chunks ${b.mean.toFixed(2)}`);
  // Auch einzeln: fast alle Chunks liegen höchstens eine Stufe unter der Kurve
  let near = 0;
  let all = 0;
  for (const r of runs(TEST_LIB)) {
    for (const c of r.log) {
      if (c.rest || c.meter < 300) continue;
      all++;
      if (difficultyAt(c.meter) - c.diff <= 1.5) near++;
    }
  }
  assert.ok(near / all > 0.9, `${(100 * near / all).toFixed(1)} Prozent der Chunks höchstens 1,5 unter der Kurve`);
});

test('Test Chunks: in jedem Seed ist der Albtraum schwerer als das Windtal, und das schwerer als der Anfang', () => {
  for (const [i, r] of runs(TEST_LIB).entries()) {
    const mean = (a, b) => {
      const xs = r.log.filter((c) => !c.rest && c.meter >= a && c.meter < b).map((c) => c.diff);
      return xs.reduce((p, q) => p + q, 0) / xs.length;
    };
    const early = mean(250, 800);
    const mid = mean(1200, 1700);
    const late = mean(3200, 8000);
    assert.ok(early + 1.5 < mid && mid + 2 < late, `Seed ${SEEDS[i]}: ${early.toFixed(2)} / ${mid.toFixed(2)} / ${late.toFixed(2)}`);
  }
});

test('Echte Bibliothek: die mittlere Schwierigkeit steigt, so weit die Chunks reichen', (tc) => {
  const blocks = blockMeans(CHUNKS);
  const top = topDiff(CHUNKS);
  tc.diagnostic(`echte Bibliothek (schwerster Chunk ${top}): ${fmt(blocks)}`);
  tc.diagnostic(`Kurve: ${blocks.map((b) => `${b.from}:${b.curve.toFixed(1)}`).join(' ')}`);
  // Steigt die Kurve noch deutlich unter dem schwersten Chunk, muss auch das Mittel steigen
  let checked = 0;
  for (let i = 1; i < BLOCKS; i++) {
    if (blocks[i].curve + 0.6 > top - 1) break;
    checked++;
    assert.ok(blocks[i].mean > blocks[i - 1].mean + 0.3, `Block ab ${blocks[i].from} m (${blocks[i].mean.toFixed(2)}) nicht über dem davor (${blocks[i - 1].mean.toFixed(2)})`);
  }
  assert.ok(checked >= 2, `nur ${checked} Blöcke unter dem schwersten Chunk geprüft`);
  // Danach pendelt es sich nahe am oberen Ende der Bibliothek ein und fällt nicht zurück
  const peak = Math.max(...blocks.map((b) => b.mean));
  const tail = blocks.slice(Math.ceil(3200 / BLOCK));
  const tailMean = tail.reduce((p, b) => p + b.mean, 0) / tail.length;
  assert.ok(tailMean >= Math.min(top - 2, 8), `ab 3200 m im Mittel ${tailMean.toFixed(2)} bei schwerstem Chunk ${top}`);
  assert.ok(tailMean >= peak - 0.7, `ab 3200 m ${tailMean.toFixed(2)} gegen Spitze ${peak.toFixed(2)}`);
  // Fehlt der Bibliothek der obere Teil der Kurve, steht das als Diagnose im Protokoll
  const lag = blocks[blocks.length - 1].curve - blocks[blocks.length - 1].mean;
  if (lag > 1) tc.diagnostic(`Hinweis: im Albtraum liegen die Chunks im Mittel ${lag.toFixed(1)} unter der Kurve, es fehlen schwere Chunks`);
});

// ---------- Grenzen ----------

for (const [name, lib] of LIBS) {
  test(`${name}: kein Chunk schwerer als die Kurve plus 0,7, nie unter 1`, () => {
    let worst = -Infinity;
    for (const [i, r] of runs(lib).entries()) {
      for (const c of r.log) {
        const over = c.diff - difficultyAt(c.meter);
        worst = Math.max(worst, over);
        assert.ok(over <= 0.7, `Seed ${SEEDS[i]}: Chunk ${c.id} (diff ${c.diff}) bei ${c.meter.toFixed(0)} m, Kurve ${difficultyAt(c.meter).toFixed(2)}`);
        assert.ok(c.diff >= 1 && c.diff <= 10, `Chunk ${c.id} diff ${c.diff}`);
      }
    }
    // Der Generator selbst lässt höchstens Kurve plus 0,6 zu
    assert.ok(worst <= 0.6 + 1e-9, `schwerster Überstand ${worst}`);
  });

  test(`${name}: Anteil der Fallbacks unter 5 Prozent`, () => {
    let chunks = 0;
    let fallbacks = 0;
    let rejects = 0;
    for (const r of runs(lib)) {
      chunks += r.stats.chunks;
      fallbacks += r.stats.fallbacks;
      rejects += r.stats.rejects;
      assert.equal(r.stats.chunks, r.log.length);
    }
    assert.ok(chunks > 30 * 100, `nur ${chunks} Chunks`);
    assert.ok(fallbacks / chunks < 0.05, `${fallbacks} Fallbacks bei ${chunks} Chunks`);
    assert.ok(rejects / chunks < 0.05, `${rejects} abgelehnte Versuche bei ${chunks} Chunks`);
  });

  test(`${name}: Ruhepausen bleiben einfach und kommen regelmäßig`, () => {
    let rests = 0;
    let sum = 0;
    let worst = 0;
    for (const r of runs(lib)) {
      const at = r.log.filter((c) => c.rest && c.meter >= 300);
      rests += at.length;
      for (const c of at) {
        sum += c.diff;
        worst = Math.max(worst, c.diff);
      }
      // Spätestens alle 700 m eine Ruhepause, auch im Albtraum
      let last = 0;
      for (const c of r.log) {
        if (!c.rest) continue;
        assert.ok(c.meter - last < 700, `${(c.meter - last).toFixed(0)} m ohne Ruhepause vor ${c.meter.toFixed(0)} m`);
        last = c.meter;
      }
    }
    assert.ok(rests / SEEDS.length > 8000 / 800, `nur ${(rests / SEEDS.length).toFixed(1)} Ruhepausen je Lauf`);
    assert.ok(sum / rests <= 2.5 && worst <= 3.5, `Ruhepausen im Mittel ${(sum / rests).toFixed(2)}, schwerste ${worst}`);
  });

  test(`${name}: Erzeugungszeit für 8000 Meter liegt unter 2 Sekunden`, (tc) => {
    generate(1, lib, { meters: 1000 }); // Aufwärmen
    const times = [1, 2, 3, 4, 5].map((seed) => generate(seed, lib, { keepLog: false }).ms);
    tc.diagnostic(`${name}: ${times.map((x) => x.toFixed(0)).join(' ')} ms`);
    for (const ms of times) assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  });

  test(`${name}: Erzeugungszeit bei realistischen Kameraschritten (5 px) liegt unter 2 Sekunden`, () => {
    const ms = generate(2, lib, { step: 5, keepLog: false }).ms;
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  });
}
