// Tests für die Chunk Layouts der mittleren und späten Phase (game/chunks/advanced.js).
// Die allgemeine Fairness Prüfung (Sprünge, sicherer Anfang, Host Plattformen) steckt in tests/chunks.test.mjs.
// Hier steht, was für diese Layouts zusätzlich gelten muss: Lernziele, Mechanik Tags, Variation, Sonderfälle,
// und mit der echten Physik, ob die Layouts so spielbar sind, wie ihre Kommentare behaupten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS } from '../game/chunks/index.js';
import { ADVANCED } from '../game/chunks/advanced.js';
import { H, LIMITS, PHYS, STEP, difficultyAt, mechsAt } from '../game/constants.js';
import { createBuilder } from '../game/builder.js';
import { createStaticPlatform } from '../game/entities.js';
import { updateCollectibles } from '../game/collectibles.js';
import { playerVsEnemies, updateEnemies } from '../game/enemies.js';
import { playerVsHazards, updateObstacles } from '../game/obstacles.js';
import { updatePlatforms } from '../game/platforms.js';
import { updatePlayer } from '../game/player.js';
import { hopOk, hopRatio, maxRise, platformAt } from '../game/reach.js';
import { seedRng } from '../game/rng.js';
import { createState } from '../game/state.js';
import { safeFor } from '../game/validate.js';
import { buildChunk as buildChunkReal } from './chunk-harness.mjs';

// Layout Tests prüfen die Geometrie bei Tempo 1. Das Tempo der Schwierigkeit prüft validateStaged im echten Spiel.
const buildChunk = (c, o = {}) => buildChunkReal(c, { pace: 1, ...o });

const byId = Object.fromEntries(ADVANCED.map((c) => [c.id, c]));
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const OX = 1000; // Ursprung, mit dem tests/chunk-harness.mjs baut
const MECH_TAGS = ['moving', 'breakable', 'walker', 'spike', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'rain', 'fallingstar', 'powerup'];

const build = (id, seed, opts = {}) => buildChunk(byId[id], { seed, ...opts });
// Baut den Chunk für alle Seeds, meldet jede verletzte Fairness Regel und ruft fn mit dem Ergebnis auf
const each = (id, fn, opts = {}) => {
  for (const seed of SEEDS) {
    const r = build(id, seed, opts);
    assert.deepEqual(r.errors, [], `${id} Seed ${seed}`);
    fn(r.st, seed, r);
  }
};
const route = (st) => st.route;
const gapBetween = (a, b) => b.x - (a.x + a.w);
const inRange = (v, lo, hi) => v >= lo && v <= hi;
const covers = (z, x) => x >= z.x && x <= z.x + z.w;
// Position einer Plattform in Phase k von n eines Umlaufs (feste Plattformen bleiben, wo sie sind)
const at = (p, k, n) => ({ ...platformAt(p, ((Math.PI * 2) / (p.omega || 1)) * (k / n)), kind: 'static' });
const PHASES = 64;
// Anteil der Phasen eines Umlaufs, in denen der Sprung von a nach b mit einem Sprung machbar ist
function feasible(a, b, diff, wind = 0) {
  let ok = 0;
  for (let k = 0; k < PHASES; k++) if (hopOk(at(a, k, PHASES), at(b, k, PHASES), { safe: safeFor(diff), wind })) ok++;
  return ok / PHASES;
}
const minGapOver = (a, b) => {
  let m = Infinity;
  for (let k = 0; k < PHASES; k++) {
    const p = at(a, k, PHASES);
    const q = at(b, k, PHASES);
    m = Math.min(m, q.x - (p.x + p.w));
  }
  return m;
};
const hostOf = (st, e) => st.platforms.find((p) => p.id === e.hostId);

// ---------- Bibliothek ----------

const REQUIRED = ['crumble-bridge', 'crumble-abyss-star', 'jumper-pen', 'combo-line', 'lightning-run', 'wind-narrow', 'updraft-climb',
  'flyer-gap', 'charger-arena', 'moving-chain', 'falling-star-gap', 'storm-crossing', 'gauntlet', 'combo-flyers', 'power-shrine',
  'rain-crumble', 'lightning-gap', 'jumper-pair'];

test('ADVANCED enthält mindestens 15 Chunks mit allen Pflicht IDs und steht in CHUNKS', () => {
  assert.ok(ADVANCED.length >= 15, `nur ${ADVANCED.length} Chunks`);
  for (const id of REQUIRED) assert.ok(byId[id], `Chunk ${id} fehlt`);
  for (const c of ADVANCED) assert.ok(CHUNKS.includes(c), `${c.id} fehlt in CHUNKS`);
});

test('IDs sind englische kebab case Namen und eindeutig, Namen sind deutsch und ohne Striche', () => {
  const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  for (const c of ADVANCED) {
    assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, `ID ${c.id}`);
    assert.ok(typeof c.name === 'string' && c.name.length >= 3, `Name von ${c.id}`);
    assert.ok(!dashes.some((d) => c.name.includes(d)) && !/[-‐-―]/.test(c.name), `Name von ${c.id} enthält Striche`);
  }
  assert.equal(new Set(CHUNKS.map((c) => c.id)).size, CHUNKS.length, 'IDs über alle Chunks eindeutig');
});

test('Felder: Gewicht 1 bis 4, Schwierigkeit 2,5 bis 5, max über min, Tags gültig', () => {
  for (const c of ADVANCED) {
    assert.ok(Number.isInteger(c.weight) && c.weight >= 1 && c.weight <= 4, `${c.id} weight ${c.weight}`);
    assert.ok(c.diff >= 2.5 && c.diff <= 5, `${c.id} diff ${c.diff}`);
    assert.ok(c.max > c.min && c.min >= 800, `${c.id} min ${c.min} max ${c.max}`);
    assert.equal(typeof c.rest, 'boolean', `${c.id} rest`);
    assert.ok(Array.isArray(c.mech) && c.mech.every((m) => MECH_TAGS.includes(m)), `${c.id} mech`);
    assert.equal(typeof c.build, 'function');
  }
});

test('Pflichtwerte laut Auftrag: Schwierigkeit, Startmeter, Mechanik, Ruhe', () => {
  const spec = {
    'crumble-bridge': [3, 800, ['breakable'], false],
    'crumble-abyss-star': [4, 1000, ['breakable', 'fallingstar'], false],
    'jumper-pen': [3, 800, ['jumper'], false],
    'combo-line': [3, 900, ['walker'], false],
    'lightning-run': [3.5, 1000, ['lightning'], false],
    'wind-narrow': [3.5, 1200, ['wind'], false],
    'updraft-climb': [3.5, 1200, ['wind'], false],
    'flyer-gap': [3.5, 1200, ['flyer'], false],
    'charger-arena': [4, 1200, ['charger'], false],
    'moving-chain': [4, 1500, ['moving'], false],
    'falling-star-gap': [3, 800, ['fallingstar'], false],
    'storm-crossing': [5, 1700, ['breakable', 'lightning', 'wind'], false],
    gauntlet: [5, 1700, ['moving', 'spike', 'walker'], false],
    'combo-flyers': [4, 1500, ['flyer', 'walker'], false],
    'power-shrine': [2.5, 800, ['powerup'], true],
    'rain-crumble': [3.5, 1000, ['breakable', 'rain'], false],
    'lightning-gap': [4, 1100, ['lightning'], false],
    'jumper-pair': [4, 1300, ['jumper'], false],
  };
  for (const [id, [diff, min, mech, rest]] of Object.entries(spec)) {
    const c = byId[id];
    assert.equal(c.diff, diff, `${id} diff`);
    assert.equal(c.min, min, `${id} min`);
    assert.deepEqual([...c.mech].sort(), mech, `${id} mech`);
    assert.equal(c.rest, rest, `${id} rest`);
  }
  assert.equal(byId['power-shrine'].weight, 1);
});

test('mech Liste entspricht genau den Mechaniken, die der Chunk baut, und ist am Startmeter freigeschaltet', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const used = [...st.tags].filter((t) => MECH_TAGS.includes(t)).sort();
      assert.deepEqual(used, [...c.mech].sort(), `${c.id} Seed ${seed}`);
    }
    const unlocked = mechsAt(c.min);
    for (const m of c.mech) assert.ok(unlocked.has(m), `${c.id}: ${m} bei Meter ${c.min} nicht freigeschaltet`);
  }
});

test('die Kurve ist abgedeckt: jede Phase hat Auswahl, ab 1700 Metern kombinieren mindestens 4 Chunks mehrere Mechaniken', () => {
  const pick = (meter) => ADVANCED.filter((c) => c.min <= meter && meter < c.max && c.diff <= difficultyAt(meter) + 0.6 && c.mech.every((m) => mechsAt(meter).has(m)));
  assert.ok(pick(800).length >= 3, 'zu wenige Chunks bei 800 m');
  assert.ok(pick(1200).length >= 6, 'zu wenige Chunks bei 1200 m');
  assert.ok(pick(1700).length >= 8, 'zu wenige Chunks bei 1700 m');
  const combos = ADVANCED.filter((c) => c.min <= 1700 && c.max > 1700 && c.mech.length >= 2);
  assert.ok(combos.length >= 4, `nur ${combos.length} Kombinationen ab 1700 m`);
  assert.ok(pick(1700).filter((c) => c.mech.length >= 2).length >= 4, 'die Kombinationen müssen am Anfang des Traumsturms auch wählbar sein');
  const triples = ADVANCED.filter((c) => c.mech.length >= 3);
  assert.ok(triples.length >= 3, 'Tripel Kombinationen fehlen');
  // Frühe Chunks sind leichter: je später der Startmeter, desto höher die Schwierigkeit (grob)
  assert.ok(Math.max(...ADVANCED.filter((c) => c.min <= 1000).map((c) => c.diff)) <= 4);
});

// ---------- Allgemeine Eigenschaften ----------

test('jeder Chunk erzeugt über 12 Seeds mindestens 3 verschiedene Layouts', () => {
  for (const c of ADVANCED) {
    const layouts = new Set();
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      layouts.add(JSON.stringify([st.platforms.map((p) => [p.x, p.y, p.w]), st.stars.map((s) => [s.x, s.y]), st.hazards.map((h) => h.x)]));
    }
    assert.ok(layouts.size >= 3, `${c.id} liefert nur ${layouts.size} Layouts`);
  }
});

test('Routen: erste Plattform ist Boden bei x = 0 und breit genug für den Respawn, die Route läuft nach rechts', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const r = route(st);
      assert.ok(r.length >= 1, `${c.id}: keine Route`);
      assert.equal(r[0].ground, true, `${c.id}: Einstieg muss b.ground sein`);
      assert.equal(r[0].x, OX);
      assert.ok(r[0].w >= 200 && r[r.length - 1].w >= 140, `${c.id}: Ein oder Ausstieg zu schmal`);
      assert.equal(r[r.length - 1].kind, 'static');
      for (const p of r) assert.ok(st.platforms.includes(p), `${c.id}: Routenplattform ${p.id} fehlt in platforms`);
      const xs = r.map((p) => (p.kind === 'moving' ? p.ox : p.x));
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${c.id}: Route läuft nicht nach rechts`);
    }
  }
});

test('Breite und Höhe: 600 bis 1650 px breit, Plattformen auf höchstens 180 px Höhenspanne, Mengen innerhalb der Grenzen', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.ok(st.maxX >= 600 && st.maxX <= 1650, `${c.id}: Breite ${Math.round(st.maxX)}`);
      assert.ok(st.platMaxY - st.platMinY <= 180, `${c.id}: Höhenspanne ${st.platMaxY - st.platMinY}`);
      assert.ok(st.platforms.length <= 14 && st.enemies.length <= 6 && st.hazards.length <= 5, `${c.id}: zu viele Objekte`);
    }
  }
});

test('jeder Chunk trägt Sterne: mindestens 12 auf der Route, Sterne liegen im Bild', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st, oy } = buildChunk(c, { seed });
      assert.ok(st.stars.length >= 12 || (st.stars.length >= 8 && c.rest), `${c.id} Seed ${seed}: nur ${st.stars.length} Sterne`);
      for (const s of st.stars) assert.ok(s.y >= 20 && s.y <= H, `${c.id}: Stern außerhalb des Bildes (y ${Math.round(s.y)}, oy ${Math.round(oy)})`);
    }
  }
});

test('Risikosterne gibt es nur in den beiden Chunks mit fallingstar, und nur über Abgründen', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const risk = st.stars.filter((s) => s.falling);
      assert.equal(risk.length > 0, c.mech.includes('fallingstar'), `${c.id} Seed ${seed}`);
      for (const star of risk) {
        assert.equal(star.bonus, 'risk');
        assert.ok(star.x - OX >= 200, 'Risikostern im sicheren Anfang');
        const below = st.platforms.filter((p) => {
          const x0 = p.kind === 'moving' ? p.ox - Math.abs(p.ax) : p.x;
          const x1 = p.kind === 'moving' ? p.ox + Math.abs(p.ax) + p.w : p.x + p.w;
          return star.x >= x0 - 14 && star.x <= x1 + 14;
        });
        assert.equal(below.length, 0, `${c.id}: Risikostern über einer Plattform`);
      }
    }
  }
});

test('ruhige Chunks haben keine Gegner, keine Hindernisse und keine Zonen', () => {
  const rests = ADVANCED.filter((c) => c.rest);
  assert.ok(rests.length >= 1);
  for (const c of rests) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.equal(st.enemies.length + st.hazards.length + st.zones.length, 0, `${c.id} Seed ${seed}`);
    }
  }
});

test('sicherer Anfang und Landezonen: Gegner und Blitze nie in den ersten 220 px, Gegner lassen Platz zum Landen und Abspringen', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      for (const h of st.hazards) assert.ok(h.x - h.w / 2 - OX >= LIMITS.SAFE_START, `${c.id}: Hindernis im Anfang`);
      for (const e of st.enemies) {
        assert.ok(e.minX - OX >= LIMITS.SAFE_START, `${c.id}: Gegner im Anfang`);
        if (e.kind === 'flyer') continue;
        const host = hostOf(st, e);
        assert.ok(e.minX - host.x >= 56, `${c.id}: Landezone vor ${e.kind} nur ${Math.round(e.minX - host.x)} px`);
        assert.ok(host.x + host.w - (e.maxX + e.w) >= 56, `${c.id}: Absprungzone hinter ${e.kind} nur ${Math.round(host.x + host.w - (e.maxX + e.w))} px`);
        assert.ok(e.x >= e.minX && e.x <= e.maxX, `${c.id}: Gegner steht außerhalb seiner Zone`);
      }
    }
  }
});

test('Blitze: nie auf dem Landeplatz hinter einer Lücke, nie über einer brüchigen Wolke, zwei Zonen sind zeitlich versetzt', () => {
  for (const c of ADVANCED.filter((x) => x.mech.includes('lightning'))) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const bolts = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
      assert.ok(bolts.length >= 1);
      for (const h of bolts) {
        const x0 = h.x - h.w / 2;
        const x1 = h.x + h.w / 2;
        for (const p of st.platforms) {
          if (p.x >= x1 || p.x + p.w <= x0) continue;
          assert.notEqual(p.kind, 'breakable', `${c.id}: Blitz über einer brüchigen Wolke`);
          if (p === route(st)[0]) continue;
          assert.ok(x0 - p.x >= 64, `${c.id}: Blitz im Landebereich von Plattform ${p.id} (${Math.round(x0 - p.x)} px)`);
          assert.ok(p.x + p.w - x1 >= 64, `${c.id}: Blitz im Absprungbereich von Plattform ${p.id}`);
        }
        assert.ok(h.idleTime >= 1, 'Blitz braucht eine Wartezeit');
      }
      for (let i = 1; i < bolts.length; i++) {
        assert.ok(bolts[i].x - bolts[i - 1].x >= 150);
        assert.ok(bolts[i].idleTime - bolts[i - 1].idleTime >= 1, `${c.id}: Wartezeiten nicht versetzt`);
      }
    }
  }
});

test('Mengen und Fairness bleiben mit Sternboost (Supermond) und Sturm (Gegenwind 40) in den Grenzen', () => {
  for (const c of ADVANCED) {
    for (const seed of SEEDS) {
      const boosted = buildChunk(c, { seed, starBoost: true });
      assert.deepEqual(boosted.errors, [], `${c.id} Seed ${seed} mit Boost`);
      assert.ok(boosted.st.stars.length <= 48, `${c.id}: ${boosted.st.stars.length} Sterne mit Boost`);
      const storm = buildChunk(c, { seed, eventWind: 40 });
      assert.deepEqual(storm.errors, [], `${c.id} Seed ${seed} im Sturm`);
    }
  }
});

test('Chunks bleiben später im Spiel gültig, auch wenn die Parameter mit den Metern strenger werden', () => {
  for (const c of ADVANCED) {
    for (const extra of [0, 400, 1000, 1500, 3000]) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const r = buildChunk(c, { seed, meter: c.min + extra });
        assert.deepEqual(r.errors, [], `${c.id} +${extra} m Seed ${seed}`);
      }
    }
  }
});

test('der Bau hängt nicht von der Einstiegshöhe ab (Messlauf und echter Bau legen dasselbe Layout an)', () => {
  const sig = (c, seed, oy) => {
    const s = createState({ seed });
    seedRng(s, seed);
    const b = createBuilder(s, { ox: 700, oy, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
    c.build(b);
    const rel = (o) => [Math.round(o.x - 700), Math.round(o.y - oy)];
    return JSON.stringify([b.st.platforms.map((p) => [...rel(p), p.w]), b.st.stars.map(rel), b.st.enemies.map((e) => rel(e)), b.st.hazards.map((h) => Math.round(h.x - 700)), b.st.zones.map((z) => [Math.round(z.x - 700), z.vx, z.ay])]);
  };
  for (const c of ADVANCED) {
    for (const seed of [1, 2, 3]) assert.equal(sig(c, seed, 0), sig(c, seed, 333), `${c.id} Seed ${seed}`);
  }
});

// ---------- Brüchiges Land ----------

test('crumble-bridge: drei bis vier brüchige Wolken tragen über eine Lücke, die kein Sprung überbrückt', () => {
  each('crumble-bridge', (st) => {
    const r = route(st);
    const crumbles = r.filter((p) => p.kind === 'breakable');
    assert.ok(crumbles.length >= 3 && crumbles.length <= 4, `${crumbles.length} brüchige Wolken`);
    assert.deepEqual(r.map((p) => p.kind), ['static', ...crumbles.map(() => 'breakable'), 'static']);
    const span = gapBetween(r[0], r[r.length - 1]);
    assert.ok(span >= 400, `Spannweite ${Math.round(span)} px`);
    assert.equal(hopOk(r[0], r[r.length - 1], { safe: 1, dbl: true }), false, 'die Lücke ist auch ohne Brücke zu überspringen');
    for (const p of crumbles) {
      assert.ok(p.w >= 92 && p.w <= 114 && p.respawn === 0 && p.state === 'idle');
      assert.ok(st.stars.some((s) => Math.abs(s.x - (p.x + p.w / 2)) < 2 && s.y < p.y - 30), 'Stern über der Wolke fehlt');
    }
    for (let i = 1; i < r.length; i++) assert.ok(gapBetween(r[i - 1], r[i]) >= 44, 'Lücken zwischen den Wolken brauchen einen echten Sprung');
  });
});

test('crumble-abyss-star: eine Kette brüchiger Wolken, ein Risikostern sinkt in einer Lücke zwischen zwei Wolken', () => {
  each('crumble-abyss-star', (st) => {
    const r = route(st);
    const crumbles = r.filter((p) => p.kind === 'breakable');
    assert.ok(crumbles.length >= 3 && crumbles.length <= 4);
    const risk = st.stars.filter((s) => s.falling);
    assert.equal(risk.length, 1);
    const star = risk[0];
    assert.equal(star.value, 25);
    assert.ok(star.triggerDist <= 160 && star.fallSpeed >= 40 && star.fallSpeed <= 80);
    const i = r.findIndex((p, k) => k < r.length - 1 && p.x + p.w <= star.x && r[k + 1].x >= star.x);
    assert.ok(i >= 1, 'Stern liegt nicht zwischen zwei Routenplattformen');
    assert.equal(r[i].kind, 'breakable');
    assert.equal(r[i + 1].kind, 'breakable');
    const low = Math.max(r[i].y, r[i + 1].y);
    assert.ok(star.y > low && star.y < low + 60, `Stern liegt ${Math.round(star.y - low)} px unter der Plattformhöhe`);
    // Die Hauptroute trägt auch ohne den Stern: genug normale Sterne
    assert.ok(st.stars.filter((s) => !s.falling).length >= 14);
  });
});

test('crumble-abyss-star: der Risikostern ist mit Fallenlassen und Doppelsprung zu holen, ohne zu stürzen', () => {
  // Zufallssuche mit festem Zufallsstrom: es genügt, dass eine Handvoll Eingabefolgen den Stern holt und sicher landet
  const c = byId['crumble-abyss-star'];
  let lcg = 12345;
  const rnd = () => ((lcg = (lcg * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const seed of [1, 2, 3]) {
    const s = createState({ seed });
    seedRng(s, seed);
    const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
    c.build(b);
    const st = b.st;
    const star = st.stars.find((x) => x.falling);
    const left = route(st).filter((p) => p.x + p.w <= star.x).pop();
    let wins = 0;
    for (let n = 0; n < 1500; n++) {
      const s2 = structuredClone(s);
      Object.assign(s2, { platforms: structuredClone(st.platforms), stars: st.stars.map((x) => ({ ...x })), enemies: [], hazards: [], zones: [], powerups: [] });
      const pl = s2.platforms.find((p) => p.id === left.id);
      Object.assign(s2.player, { x: pl.x + pl.w * (0.2 + 0.7 * rnd()) - 22, y: pl.y - 34, onGround: true, groundId: pl.id });
      s2.camX = s2.player.x - 300;
      const target = s2.stars.find((x) => x.id === star.id);
      let move = 1;
      let held = false;
      for (let i = 0; i < 200; i++) {
        let press = false;
        if (i % 5 === 0) {
          const r = rnd();
          move = r < 0.6 ? 1 : r < 0.85 ? 0 : -1;
          press = rnd() < 0.18;
          held = rnd() < 0.7 ? true : held && rnd() < 0.5;
        }
        s2.t += STEP;
        updatePlatforms(s2, STEP);
        updatePlayer(s2, { move, jumpPressed: press, jumpHeld: held, dashPressed: false }, STEP);
        updateCollectibles(s2, STEP);
        if (s2.player.y > H + 40) break;
        if (target.got && s2.player.onGround && s2.player.groundId !== pl.id) { wins++; break; }
      }
    }
    assert.ok(wins >= 8, `Seed ${seed}: nur ${wins} von 1500 Eingabefolgen holen den Stern und landen sicher`);
  }
});

test('jumper-pen: ein Hüpfer in der Mitte einer breiten Plattform, kurze Streifzone, Sterne ringsum', () => {
  each('jumper-pen', (st) => {
    const [pen] = route(st);
    assert.equal(st.enemies.length, 1);
    const e = st.enemies[0];
    assert.equal(e.kind, 'jumper');
    assert.equal(e.hostId, pen.id);
    assert.ok(pen.w >= 600);
    assert.ok(e.minX - pen.x >= 260, 'Landezone vor dem Hüpfer');
    assert.ok(e.maxX + e.w - e.minX <= 130, 'Streifzone zu breit, der Spieler kann nicht mehr darüber');
    assert.ok(pen.x + pen.w - (e.maxX + e.w) >= 150, 'Absprungzone hinter dem Hüpfer');
    const over = st.stars.filter((s) => s.x > e.minX - 12 && s.x < e.maxX + e.w + 12 && s.y < pen.y - 60);
    assert.ok(over.length >= 4, 'Sternbogen über dem Hüpfer fehlt');
    assert.ok(st.stars.filter((s) => s.x < e.minX - 40 && onTop(pen, s)).length >= 3, 'Sterne links fehlen');
    assert.ok(st.stars.filter((s) => s.x > e.maxX + e.w + 60 && onTop(pen, s)).length >= 3, 'Sterne rechts fehlen');
  });
});
const onTop = (plat, star) => star.x >= plat.x && star.x <= plat.x + plat.w && star.y < plat.y;

test('combo-line: drei Gewitterwolken auf drei dicht folgenden Wolken mit Sternen im Abprallbereich darüber', () => {
  each('combo-line', (st) => {
    const r = route(st);
    assert.equal(st.enemies.length, 3);
    assert.ok(st.enemies.every((e) => e.kind === 'walker'));
    const hosts = st.enemies.map((e) => hostOf(st, e));
    assert.equal(new Set(hosts.map((p) => p.id)).size, 3, 'jeder Walker braucht eine eigene Plattform');
    hosts.sort((p, q) => p.x - q.x);
    for (let i = 1; i < 3; i++) {
      assert.ok(r.indexOf(hosts[i]) === r.indexOf(hosts[i - 1]) + 1, 'die Walker Plattformen müssen unmittelbar aufeinander folgen');
      assert.ok(inRange(gapBetween(hosts[i - 1], hosts[i]), 44, 120), `Lücke ${gapBetween(hosts[i - 1], hosts[i])}`);
    }
    for (const p of hosts) {
      assert.ok(p.w >= 176 && p.w <= 208);
      const above = st.stars.filter((s) => s.x > p.x && s.x < p.x + p.w && s.y < p.y - 50 && s.y > p.y - 150);
      assert.ok(above.length >= 4, `nur ${above.length} Sterne über einer Walker Plattform`);
    }
    assert.equal(st.hazards.length, 0);
  });
});

test('lightning-run: zwei Blitzzonen mit versetzten Wartezeiten auf einem ebenen Lauf', () => {
  each('lightning-run', (st) => {
    const [a, run] = route(st);
    assert.equal(route(st).length, 2);
    assert.equal(run.y, a.y, 'der Lauf muss eben sein');
    assert.ok(run.w >= 700);
    const bolts = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
    assert.equal(bolts.length, 2);
    for (const h of bolts) assert.ok(h.x - h.w / 2 >= run.x + 160 && h.x + h.w / 2 <= run.x + run.w - 150, 'Zone liegt auf dem Lauf mit Platz davor und danach');
    assert.ok(bolts[1].x - bolts[0].x >= 230, 'zu dicht beieinander');
    assert.ok(bolts[1].idleTime - bolts[0].idleTime >= 1.1 && bolts[0].idleTime <= 1.4);
    const bait = st.stars.filter((s) => bolts.some((h) => Math.abs(s.x - h.x) < 50 && s.y < run.y - 50));
    assert.ok(bait.length >= 4, 'Köder über den Zonen fehlen');
  });
});

// ---------- Windtal ----------

test('wind-narrow: Seitenwind über schmalen Wolken, die Zone deckt die ganze Kette und stört weder Einstieg noch Verbindung', () => {
  const signs = new Set();
  each('wind-narrow', (st, seed, r) => {
    const rt = route(st);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.equal(z.kind, 'wind');
    assert.ok(Math.abs(z.vx) >= 60 && Math.abs(z.vx) <= 120 && z.ay === 0, `vx ${z.vx} ay ${z.ay}`);
    signs.add(Math.sign(z.vx));
    const narrow = rt.slice(1, -1);
    assert.ok(narrow.length >= 3 && narrow.length <= 4);
    assert.ok(narrow.every((p) => !p.ground && p.w >= 74 && p.w <= 98), 'die Wolken müssen schmal sein');
    for (const p of narrow) assert.ok(covers(z, p.x) && covers(z, p.x + p.w), 'Wind deckt nicht jede Wolke');
    assert.ok(z.x - OX >= 40, 'Zone beginnt zu früh und zählt als Gegenwind der Verbindung');
    const exit = rt[rt.length - 1];
    assert.ok(z.x + z.w <= exit.x + exit.w - 40, 'Zone reicht über den Ausstieg hinaus');
    // der Wind stört die Sprünge nicht: auch mit Gegenwind sind die Lücken sicher
    const head = Math.max(0, -z.vx);
    for (let i = 0; i < rt.length - 1; i++) assert.ok(hopOk(rt[i], rt[i + 1], { safe: safeFor(3.5), wind: head }), `Sprung ${i} mit Gegenwind`);
    assert.ok(z.y + z.h <= H && r.oy + z.y - OX < 1e9);
  });
  assert.equal(signs.size, 2, 'Rücken und Gegenwind müssen beide vorkommen');
});

test('updraft-climb: die hohe Wolke ist mit einem Sprung nicht zu erreichen, der Aufwind trägt sie in Reichweite', () => {
  each('updraft-climb', (st) => {
    const [a, hill, exit] = route(st);
    assert.equal(route(st).length, 3);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.equal(z.vx, 0);
    assert.ok(z.ay <= -500 && z.ay >= -800, `Auftrieb ${z.ay}`);
    const rise = a.y - hill.y;
    assert.ok(rise > maxRise() + 20 && rise < maxRise(true) - 40, `Anstieg ${rise}`);
    assert.equal(hopRatio(a, hill), Infinity, 'ohne Aufwind unerreichbar mit einem Sprung');
    assert.ok(Number.isFinite(hopRatio(a, hill, { dbl: true })));
    // mit Aufwind reicht ein Sprung: Höhe v² / (2 (g plus Auftrieb)) liegt über dem Anstieg
    const lifted = (PHYS.JUMP_SPEED * PHYS.JUMP_SPEED) / (2 * (PHYS.GRAVITY + z.ay));
    assert.ok(lifted >= rise + 12, `mit Aufwind nur ${Math.round(lifted)} px Sprunghöhe bei Anstieg ${rise}`);
    assert.ok(covers(z, a.x + a.w - 10) && covers(z, hill.x + 20), 'Säule steht über der Lücke');
    assert.ok(z.x + z.w <= exit.x + exit.w - 40);
    const column = st.stars.filter((s) => Math.abs(s.x - (a.x + a.w + (hill.x - a.x - a.w) / 2)) < 2);
    assert.ok(column.length >= 5, 'Sternsäule im Aufwind fehlt');
  });
});

test('updraft-climb mit der echten Physik: ein Sprung schafft die Wolke nur mit Aufwind', () => {
  const c = byId['updraft-climb'];
  for (const seed of [1, 2, 3]) {
    const res = {};
    for (const withLift of [true, false]) {
      const s = createState({ seed });
      seedRng(s, seed);
      const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
      c.build(b);
      const st = b.st;
      const [a, hill] = route(st);
      let wins = 0;
      for (const off of [20, 60, 100, 140]) {
        for (const jf of [0, 5, 10]) {
          for (const stop of [999, 25, 35, 45]) {
            const s2 = structuredClone(s);
            Object.assign(s2, { platforms: structuredClone(st.platforms), stars: [], enemies: [], hazards: [], zones: withLift ? structuredClone(st.zones) : [], powerups: [] });
            Object.assign(s2.player, { x: a.x + a.w - off, y: a.y - 34, onGround: true, groundId: a.id });
            s2.camX = s2.player.x - 300;
            for (let i = 0; i < 160; i++) {
              const input = { move: i < stop ? 1 : 0, jumpPressed: i === jf, jumpHeld: i >= jf && i < jf + 22, dashPressed: false, downHeld: true };
              s2.t += STEP;
              updatePlatforms(s2, STEP);
              updatePlayer(s2, input, STEP);
              if (s2.player.onGround && s2.player.groundId === hill.id) { wins++; break; }
              if (s2.player.y > H + 40) break;
            }
          }
        }
      }
      res[withLift] = wins;
    }
    assert.equal(res[false], 0, `Seed ${seed}: ohne Aufwind darf ein Sprung die Wolke nie erreichen`);
    assert.ok(res[true] >= 3, `Seed ${seed}: mit Aufwind nur ${res[true]} Treffer`);
  }
});

test('flyer-gap: zwei Flieger hoch über einer Lücke, die Route läuft darunter durch, Sterne für den mutigen Weg darüber', () => {
  each('flyer-gap', (st) => {
    const [a, exit] = route(st);
    assert.equal(route(st).length, 2);
    assert.equal(st.enemies.length, 2);
    const surface = Math.min(a.y, exit.y);
    for (const f of st.enemies) {
      assert.equal(f.kind, 'flyer');
      assert.ok(f.baseY + f.h + f.amp <= surface - 165, 'Flieger blockiert normale Sprünge');
      assert.ok(f.baseY + f.h + f.amp >= surface - 175, 'Flieger schwebt höher als nötig, der Stomp wäre unerreichbar');
      assert.ok(f.amp <= 8, 'kleines Auf und Ab, damit ein sauberer Doppelsprung trifft');
      assert.equal(surface, a.y, 'der Einstieg ist die höchste Fläche');
      const mid = f.minX + (f.maxX - f.minX) / 2 + f.w / 2;
      assert.ok(mid > a.x + a.w - 40 && mid < exit.x + 60, 'Flieger schwebt nicht über der Lücke');
    }
    assert.notEqual(st.enemies[0].dir, st.enemies[1].dir);
    assert.notEqual(st.enemies[0].phase, st.enemies[1].phase);
    const brave = st.stars.filter((s) => s.y < st.enemies[0].baseY);
    assert.ok(brave.length >= 5, 'Bogen über den Fliegern fehlt');
    assert.ok(gapBetween(a, exit) >= 120, 'Lücke zu klein');
    assert.ok(hopOk(a, exit, { safe: safeFor(3.5) }), 'die Route braucht keinen Doppelsprung');
  });
});

test('Flieger sind mit der echten Physik zu besiegen: Zufallssuche findet Doppelsprünge, die auf einem Flieger landen', () => {
  const need = { 'flyer-gap': 6, 'combo-flyers': 12 };
  let lcg = 777;
  const rnd = () => ((lcg = (lcg * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const id of Object.keys(need)) {
    const c = byId[id];
    for (const seed of [1, 2]) {
      const s = createState({ seed });
      seedRng(s, seed);
      const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
      c.build(b);
      const st = b.st;
      const entry = route(st)[0];
      let wins = 0;
      for (let n = 0; n < 2000; n++) {
        const s2 = structuredClone(s);
        Object.assign(s2, { platforms: structuredClone(st.platforms), stars: [], enemies: structuredClone(st.enemies), hazards: [], zones: [], powerups: [] });
        Object.assign(s2.player, { x: entry.x + entry.w * (0.4 + 0.5 * rnd()) - 22, y: entry.y - 34, onGround: true, groundId: entry.id });
        s2.camX = s2.player.x - 300;
        let move = 1;
        let held = false;
        for (let i = 0; i < 260; i++) {
          let press = false;
          if (i % 5 === 0) {
            const r = rnd();
            move = r < 0.7 ? 1 : r < 0.9 ? 0 : -1;
            press = rnd() < 0.22;
            held = rnd() < 0.7 ? true : held && rnd() < 0.5;
          }
          s2.t += STEP;
          updatePlatforms(s2, STEP);
          updateEnemies(s2, STEP);
          updatePlayer(s2, { move, jumpPressed: press, jumpHeld: held, dashPressed: false }, STEP);
          const lives0 = s2.lives;
          playerVsEnemies(s2);
          if (s2.lives < lives0 || s2.player.y > H + 40) break;
          if (s2.enemies.some((e) => e.kind === 'flyer' && e.dead > 0)) { wins++; break; }
        }
      }
      assert.ok(wins >= need[id], `${id} Seed ${seed}: nur ${wins} von 2000 Eingabefolgen besiegen einen Flieger`);
    }
  }
});

test('charger-arena: eine Sturmwolke auf breiter Plattform und eine Deckung, die sie nicht sieht, aber mit einem Sprung erreichbar ist', () => {
  each('charger-arena', (st) => {
    const [, arena] = route(st);
    assert.equal(st.enemies.length, 1);
    const e = st.enemies[0];
    assert.equal(e.kind, 'charger');
    assert.equal(e.hostId, arena.id);
    assert.ok(arena.w >= 540);
    const cover = st.platforms.find((p) => !route(st).includes(p));
    assert.ok(cover && !cover.ground && cover.w <= 112);
    const rise = arena.y - cover.y;
    assert.ok(rise > 80 && rise < maxRise() - 20, `Deckung ${rise} px hoch`);
    assert.ok(hopOk(arena, cover, { safe: safeFor(4) }), 'Deckung nicht mit einem Sprung erreichbar');
    assert.ok(cover.x + cover.w > e.minX && cover.x < e.maxX + e.w, 'Deckung steht nicht über der Streifzone');
    assert.ok(e.minX - arena.x >= 180 && arena.x + arena.w - (e.maxX + e.w) >= 120);
    assert.ok(st.stars.some((s) => Math.abs(s.x - (cover.x + cover.w / 2)) < 2 && s.y < cover.y), 'Stern auf der Deckung');
  });
});

test('charger-arena mit der echten Physik: auf der Deckung bleibt die Sturmwolke ruhig, am Boden lädt sie auf', () => {
  const c = byId['charger-arena'];
  for (const seed of [1, 2, 3, 4]) {
    for (const onCover of [true, false]) {
      const s = createState({ seed });
      seedRng(s, seed);
      const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
      c.build(b);
      const st = b.st;
      const arena = route(st)[1];
      const cover = st.platforms.find((p) => !route(st).includes(p));
      const e = st.enemies[0];
      Object.assign(s, { platforms: st.platforms, enemies: st.enemies, stars: [], hazards: [], zones: [], powerups: [] });
      if (onCover) Object.assign(s.player, { x: cover.x + cover.w / 2 - 22, y: cover.y - 34, onGround: true, groundId: cover.id });
      else Object.assign(s.player, { x: e.minX - 150, y: arena.y - 34, onGround: true, groundId: arena.id });
      s.camX = s.player.x - 300;
      const states = new Set();
      for (let i = 0; i < 240; i++) {
        s.t += STEP;
        updatePlatforms(s, STEP);
        updateEnemies(s, STEP);
        updatePlayer(s, { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false }, STEP);
        states.add(e.state);
        if (!onCover && e.state === 'windup') break;
      }
      if (onCover) assert.deepEqual([...states], ['patrol'], `Seed ${seed}: Sturmwolke wird auf der Deckung aufmerksam`);
      else assert.ok(states.has('windup'), `Seed ${seed}: Kontrolle, am Boden lädt sie auf`);
    }
  }
});

test('moving-chain: eine waagerechte und eine senkrechte Wolke im selben Takt, in den meisten Phasen erreichbar, aber nicht in allen', () => {
  each('moving-chain', (st) => {
    const [a, h, v, exit] = route(st);
    assert.deepEqual(route(st).map((p) => p.kind), ['static', 'moving', 'moving', 'static']);
    assert.ok(h.ax >= 54 && h.ay === 0, 'erste Wolke schwingt waagerecht');
    assert.ok(v.ay >= 38 && v.ax === 0, 'zweite Wolke schwingt senkrecht');
    assert.equal(h.omega, v.omega, 'gleicher Takt');
    const period = (Math.PI * 2) / h.omega;
    assert.ok(period >= 3.8 && period <= 4.4);
    const f1 = feasible(a, h, 4);
    const f2 = feasible(h, v, 4);
    const f3 = feasible(v, exit, 4);
    assert.ok(f1 >= 0.5 && f1 <= 0.95, `Einstieg in ${Math.round(f1 * 100)} Prozent der Phasen`);
    assert.ok(f2 >= 0.5, `Sprung zwischen den Wolken in ${Math.round(f2 * 100)} Prozent der Phasen`);
    assert.ok(f3 >= 0.6, `Ausstieg in ${Math.round(f3 * 100)} Prozent der Phasen`);
    assert.ok(feasible(a, h, 4, 40) >= 0.3 && feasible(h, v, 4, 40) >= 0.3, 'im Sturm bleibt die Kette erreichbar');
    for (const [p, q] of [[a, h], [h, v], [v, exit]]) assert.ok(minGapOver(p, q) >= 20, 'Wolken kommen sich zu nah');
    assert.ok(st.stars.length >= 16);
  });
});

test('falling-star-gap: drei bis vier Risikosterne über einer breiten Lücke, die in die Flugbahn sinken', () => {
  each('falling-star-gap', (st) => {
    const [a, exit] = route(st);
    assert.equal(route(st).length, 2);
    const risk = st.stars.filter((s) => s.falling);
    assert.ok(risk.length >= 3 && risk.length <= 4);
    assert.ok(gapBetween(a, exit) >= 120);
    for (const s of risk) {
      assert.ok(s.x > a.x + a.w + 20 && s.x < exit.x - 20, 'Stern nicht über der Lücke');
      assert.equal(s.triggerDist, 260);
      assert.ok(s.y < a.y - 50, 'Stern hängt zu tief');
      assert.equal(s.started, false);
    }
    const xs = risk.map((s) => s.x);
    assert.deepEqual(xs, [...xs].sort((p, q) => p - q), 'Sterne laufen von links nach rechts');
    assert.ok(st.stars.some((s) => !s.falling && s.x > a.x + a.w && s.x < exit.x), 'ein sicherer Bogen gehört dazu');
  });
});

test('falling-star-gap mit der echten Physik: wer im Lauf springt, holt alle Sterne, wer am Rand zögert, verliert sie', () => {
  const c = byId['falling-star-gap'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const got = {};
    for (const wait of [0, 90]) {
      const s = createState({ seed });
      seedRng(s, seed);
      const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
      c.build(b);
      const st = b.st;
      const [a] = route(st);
      Object.assign(s, { platforms: st.platforms, stars: st.stars, enemies: [], hazards: [], zones: [], powerups: [] });
      const all = [...st.stars];
      Object.assign(s.player, { x: a.x + 20, y: a.y - 34, onGround: true, groundId: a.id });
      s.camX = s.player.x - 300;
      let waited = 0;
      let jumped = false;
      for (let i = 0; i < 300 && s.player.y <= H; i++) {
        const atEdge = s.player.x + s.player.w >= a.x + a.w - 4;
        if (atEdge && !jumped && waited < wait) waited++;
        const go = atEdge && !jumped && waited >= wait && s.player.onGround;
        if (go) jumped = true;
        s.t += STEP;
        updatePlatforms(s, STEP);
        updatePlayer(s, { move: atEdge && !jumped && waited < wait ? 0 : 1, jumpPressed: go, jumpHeld: jumped, dashPressed: false }, STEP);
        updateCollectibles(s, STEP);
      }
      const risk = all.filter((x) => x.falling);
      got[wait] = { n: risk.filter((x) => x.got).length, total: risk.length };
    }
    assert.equal(got[0].n, got[0].total, `Seed ${seed}: im Lauf müssen alle Risikosterne zu holen sein`);
    assert.ok(got[90].n <= 1, `Seed ${seed}: nach langem Zögern sind die Sterne weg (${got[90].n})`);
  }
});

// ---------- Traumsturm ----------

test('storm-crossing: Wind, brüchige Wolken und Blitz, mit fester Insel zum Abwarten in der Mitte', () => {
  const signs = new Set();
  each('storm-crossing', (st) => {
    const rt = route(st);
    const crumbles = rt.filter((p) => p.kind === 'breakable');
    assert.equal(crumbles.length, 3);
    const island = rt.slice(1, -1).find((p) => p.kind === 'static');
    assert.ok(island && !island.ground && island.w >= 240, 'Insel fehlt');
    const idx = rt.indexOf(island);
    assert.ok(idx >= 2 && idx <= 3, 'Insel liegt nicht zwischen den brüchigen Wolken');
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.ok(Math.abs(z.vx) >= 78, `Wind ${z.vx}`);
    signs.add(Math.sign(z.vx));
    for (const p of rt.slice(1, -1)) assert.ok(covers(z, p.x + p.w / 2), 'Wind deckt nicht die ganze Route');
    assert.ok(covers(z, rt[rt.length - 1].x + 40));
    assert.ok(z.x + z.w <= rt[rt.length - 1].x + rt[rt.length - 1].w - 40);
    const bolts = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
    assert.equal(bolts.length, 2);
    assert.ok(bolts[0].x > island.x + 120 && bolts[0].x < island.x + island.w - 60, 'erste Blitzzone gehört auf die Insel');
    assert.ok(bolts[1].x > rt[rt.length - 1].x + 80, 'zweite Blitzzone gehört auf den Ausstieg');
    for (const p of crumbles) assert.ok(p.w >= 92 && p.w <= 106);
  });
  assert.equal(signs.size, 2);
});

test('gauntlet: Gewitterwolke, Stachelwolke und bewegliche Wolke nacheinander, jede auf eigener Plattform', () => {
  each('gauntlet', (st) => {
    const rt = route(st);
    assert.deepEqual(rt.map((p) => p.kind), ['static', 'static', 'moving', 'static']);
    const walkers = st.enemies.filter((e) => e.kind === 'walker').sort((p, q) => p.x - q.x);
    assert.equal(walkers.length, 2);
    assert.equal(st.hazards.length, 1);
    const spike = st.hazards[0];
    assert.equal(spike.kind, 'spike');
    const spikeHost = st.platforms.find((p) => p.id === spike.hostId);
    assert.equal(spikeHost, rt[1]);
    assert.equal(hostOf(st, walkers[0]), rt[0]);
    assert.equal(hostOf(st, walkers[1]), rt[3]);
    assert.ok(walkers.every((e) => e.hostId !== spike.hostId), 'Walker und Stachelwolke teilen sich eine Plattform');
    assert.ok(spike.x - spikeHost.x >= 90 && spikeHost.x + spikeHost.w - (spike.x + spike.w) >= 90, 'Anlauf und Landung an der Stachelwolke');
    assert.ok(rt[0].w >= 460, 'der lange Einstieg lässt den Walker erst nach 250 px beginnen');
    const f = feasible(rt[1], rt[2], 5);
    assert.ok(f >= 0.5 && f <= 0.95, `Fähre in ${Math.round(f * 100)} Prozent der Phasen erreichbar`);
    assert.ok(feasible(rt[2], rt[3], 5) >= 0.5);
    assert.ok(feasible(rt[1], rt[2], 5, 40) >= 0.3 && feasible(rt[2], rt[3], 5, 40) >= 0.3, 'im Sturm bleibt die Fähre erreichbar');
    assert.ok(st.stars.length >= 20);
  });
});

test('combo-flyers: zwei Flieger über zwei Lücken und ein Walker auf der Insel dazwischen', () => {
  each('combo-flyers', (st) => {
    const [a, mid, exit] = route(st);
    assert.equal(route(st).length, 3);
    const fl = st.enemies.filter((e) => e.kind === 'flyer').sort((p, q) => p.x - q.x);
    const wk = st.enemies.filter((e) => e.kind === 'walker');
    assert.equal(fl.length, 2);
    assert.equal(wk.length, 1);
    assert.equal(wk[0].hostId, mid.id);
    const centre = (f) => f.minX + (f.maxX - f.minX) / 2 + f.w / 2;
    assert.ok(centre(fl[0]) > a.x + a.w - 40 && centre(fl[0]) < mid.x + 60, 'erster Flieger über der ersten Lücke');
    assert.ok(centre(fl[1]) > mid.x + mid.w - 40 && centre(fl[1]) < exit.x + 60, 'zweiter Flieger über der zweiten Lücke');
    for (const f of fl) {
      const above = st.stars.filter((s) => s.x > f.minX - 10 && s.x < f.maxX + f.w + 10 && s.y < f.baseY - 15);
      assert.ok(above.length >= 4, 'Sterne über dem Flieger fehlen');
    }
    assert.ok(hopOk(a, mid, { safe: safeFor(4) }) && hopOk(mid, exit, { safe: safeFor(4) }), 'die Route braucht keinen Doppelsprung');
    assert.equal(st.hazards.length, 0);
  });
});

test('power-shrine: ein zufälliges Powerup auf einer hohen Wolke, nur mit Doppelsprung erreichbar', () => {
  const types = new Set();
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
    const r = build('power-shrine', seed);
    assert.deepEqual(r.errors, [], `Seed ${seed}`);
    const { st } = r;
    const [g] = route(st);
    assert.equal(route(st).length, 1);
    assert.equal(st.powerups.length, 1);
    const p = st.powerups[0];
    assert.ok(['dash', 'magnet', 'feather'].includes(p.type), p.type);
    types.add(p.type);
    const shrine = st.platforms.find((x) => x !== g);
    assert.ok(shrine && !shrine.ground && shrine.w <= 130);
    const rise = g.y - shrine.y;
    assert.ok(rise >= 146 && rise <= 156, `Höhe ${rise}`);
    assert.equal(hopRatio(g, shrine), Infinity, 'mit einem Sprung erreichbar');
    assert.ok(Number.isFinite(hopRatio(g, shrine, { dbl: true })), 'auch mit Doppelsprung unerreichbar');
    assert.ok(p.x > shrine.x && p.x < shrine.x + shrine.w && p.y < shrine.y);
    // Der Spieler erreicht das Powerup mit einem einfachen Sprung nie: Mitte der Spielerfigur im Scheitel plus Abholradius
    assert.ok(g.y - p.y > maxRise() + PHYS.H / 2 + 30, 'das Powerup liegt in Reichweite eines einfachen Sprungs');
    assert.ok(g.x + g.w - (shrine.x + shrine.w) >= 100 && shrine.x - g.x >= 100, 'Schrein steht über der Plattform');
  }
  assert.equal(types.size, 3, `nur ${[...types]} kommen vor`);
});

test('power-shrine mit der echten Physik: ein Doppelsprung holt das Powerup, ein einfacher Sprung nie', () => {
  const c = byId['power-shrine'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = createState({ seed });
    seedRng(s, seed);
    const b = createBuilder(s, { ox: 200, oy: 330, diff: c.diff, meter: c.min, mechs: mechsAt(c.min), gateIndex: 1 });
    c.build(b);
    const st = b.st;
    const [g] = route(st);
    const shrine = st.platforms.find((x) => x !== g);
    const result = { single: 0, double: 0 };
    for (const d of [-200, -150, -100, -60, -30]) {
      for (const jf of [0, 6, 12]) {
        for (const dbl of [-1, 10, 16, 22, 28, 34, 40]) {
          for (const stop of [999, 20, 30, 40]) {
            const s2 = structuredClone(s);
            Object.assign(s2, { platforms: structuredClone(st.platforms), stars: [], enemies: [], hazards: [], zones: [], powerups: structuredClone(st.powerups) });
            Object.assign(s2.player, { x: shrine.x + d, y: g.y - 34, onGround: true, groundId: g.id });
            s2.camX = s2.player.x - 300;
            const presses = dbl >= 0 ? [jf, jf + dbl] : [jf];
            for (let i = 0; i < 160; i++) {
              const input = { move: i < stop ? 1 : 0, jumpPressed: presses.includes(i), jumpHeld: presses.some((q) => i >= q && i < q + 22), dashPressed: false, downHeld: true };
              s2.t += STEP;
              updatePlatforms(s2, STEP);
              updatePlayer(s2, input, STEP);
              updateCollectibles(s2, STEP);
              if (s2.powerups.length === 0) {
                result[dbl >= 0 ? 'double' : 'single']++;
                break;
              }
            }
          }
        }
      }
    }
    assert.equal(result.single, 0, `Seed ${seed}: das Powerup ist mit einem Sprung zu holen`);
    assert.ok(result.double >= 20, `Seed ${seed}: Doppelsprung holt es nur ${result.double} mal`);
  }
});

test('rain-crumble: Regen über der ganzen Kette aus schmalen brüchigen Wolken', () => {
  each('rain-crumble', (st) => {
    const rt = route(st);
    const crumbles = rt.filter((p) => p.kind === 'breakable');
    assert.ok(crumbles.length >= 3 && crumbles.length <= 4);
    assert.ok(crumbles.every((p) => p.w <= 108), 'brüchige Wolken sind knapp bemessen');
    const rains = st.zones.filter((z) => z.kind === 'rain');
    assert.equal(rains.length, 2);
    assert.notEqual(rains[0].timer, rains[1].timer, 'beide Wolken regnen zu verschiedenen Zeiten');
    for (const p of crumbles) assert.ok(rains.some((z) => covers(z, p.x + p.w / 2)), 'Regen deckt nicht jede Wolke');
    assert.ok(rains.every((z) => z.timer >= 0 && z.timer < z.onTime + z.offTime));
    assert.ok(Math.max(...rains.map((z) => z.x + z.w)) <= rt[rt.length - 1].x + rt[rt.length - 1].w);
  });
});

test('lightning-gap: je eine Blitzzone mitten über zwei Lücken, dazwischen eine Insel zum Abwarten', () => {
  each('lightning-gap', (st) => {
    const [a, mid, exit] = route(st);
    assert.equal(route(st).length, 3);
    const bolts = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
    assert.equal(bolts.length, 2);
    const gaps = [[a, mid], [mid, exit]];
    bolts.forEach((h, i) => {
      const [l, r] = gaps[i];
      assert.ok(h.x - h.w / 2 >= l.x + l.w + 40 && h.x + h.w / 2 <= r.x - 40, `Zone ${i} liegt nicht mitten über der Lücke`);
    });
    assert.ok(mid.w >= 230 && st.hazards.every((h) => h.kind === 'lightning'), 'Insel muss sicher sein');
    assert.ok(gapBetween(a, mid) >= 150 && gapBetween(mid, exit) >= 150, 'Lücken sind breit');
    for (const h of bolts) assert.ok(st.stars.some((s) => Math.abs(s.x - h.x) < h.w / 2 && s.y < Math.min(a.y, mid.y, exit.y) - 60), 'Bogen führt nicht durch die Zone');
  });
});

test('jumper-pair: zwei Hüpfer auf einer sehr langen Plattform mit freier Gasse dazwischen', () => {
  each('jumper-pair', (st) => {
    const [g] = route(st);
    assert.equal(route(st).length, 1);
    assert.ok(g.w >= 840);
    assert.equal(st.enemies.length, 2);
    assert.ok(st.enemies.every((e) => e.kind === 'jumper' && e.hostId === g.id));
    const [e1, e2] = [...st.enemies].sort((p, q) => p.x - q.x);
    assert.ok(e1.maxX + e1.w - e1.minX <= 120 && e2.maxX + e2.w - e2.minX <= 120, 'Zonen zu breit');
    const lane = e2.minX - (e1.maxX + e1.w);
    assert.ok(lane >= 150, `Gasse nur ${Math.round(lane)} px`);
    assert.ok(g.x + g.w - (e2.maxX + e2.w) >= 140);
    assert.ok(st.stars.filter((s) => s.x > e1.maxX + e1.w && s.x < e2.minX).length >= 4, 'Sterne in der Gasse');
  });
});

test('thunder-stroll: Regen, ein Hüpfer im Regen und ein Blitz dahinter auf einer langen Wiese', () => {
  each('thunder-stroll', (st) => {
    const [, meadow] = route(st);
    assert.equal(st.enemies.length, 1);
    const e = st.enemies[0];
    assert.equal(e.kind, 'jumper');
    assert.equal(e.hostId, meadow.id);
    const bolt = st.hazards[0];
    assert.equal(st.hazards.length, 1);
    assert.equal(bolt.kind, 'lightning');
    assert.ok(bolt.x - (e.maxX + e.w) >= 150, 'Blitz zu dicht hinter dem Hüpfer');
    assert.ok(meadow.x + meadow.w - (bolt.x + bolt.w / 2) >= 200, 'Absprungzone hinter dem Blitz');
    const rains = st.zones.filter((z) => z.kind === 'rain');
    assert.equal(rains.length, 2);
    assert.ok(rains.some((z) => covers(z, e.minX) && covers(z, e.maxX + e.w)), 'der Hüpfer steht nicht im Regen');
  });
});

test('charger-bridge: die Sturmwolke steht auf dem langen Einstieg, dahinter führt eine Brücke aus brüchigen Wolken', () => {
  each('charger-bridge', (st) => {
    const rt = route(st);
    const e = st.enemies[0];
    assert.equal(st.enemies.length, 1);
    assert.equal(e.kind, 'charger');
    assert.equal(e.hostId, rt[0].id);
    assert.ok(rt[0].w >= 500 && e.minX - rt[0].x >= 250);
    const crumbles = rt.filter((p) => p.kind === 'breakable');
    assert.ok(crumbles.length >= 2 && crumbles.length <= 3);
    assert.deepEqual(rt.map((p) => p.kind), ['static', ...crumbles.map(() => 'breakable'), 'static']);
    assert.ok(rt[0].x + rt[0].w - (e.maxX + e.w) >= 80, 'Absprung vor der Brücke bleibt frei');
  });
});

test('gust-ferry: eine waagerechte Fähre im kräftigen Wind, in den meisten Phasen erreichbar', () => {
  const signs = new Set();
  each('gust-ferry', (st) => {
    const [a, ferry, exit] = route(st);
    assert.deepEqual(route(st).map((p) => p.kind), ['static', 'moving', 'static']);
    assert.ok(ferry.ax >= 54 && ferry.ay === 0);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.ok(Math.abs(z.vx) >= 70 && Math.abs(z.vx) <= 120);
    signs.add(Math.sign(z.vx));
    assert.ok(covers(z, ferry.ox) && covers(z, exit.x + 50) && z.x + z.w <= exit.x + exit.w - 40);
    const wind = Math.max(0, -z.vx);
    const f1 = feasible(a, ferry, 4, wind);
    const f2 = feasible(ferry, exit, 4, wind);
    assert.ok(f1 >= 0.5 && f1 <= 0.95, `Einstieg in ${Math.round(f1 * 100)} Prozent der Phasen`);
    assert.ok(f2 >= 0.5 && f2 <= 0.95, `Ausstieg in ${Math.round(f2 * 100)} Prozent der Phasen`);
    assert.ok(minGapOver(a, ferry) >= 20 && minGapOver(ferry, exit) >= 20);
  });
  assert.equal(signs.size, 2);
});

// ---------- Spielbarkeit mit der echten Physik ----------
// Ein Vorausschau Bot (wie tests/bot.mjs, aber nur für einen einzelnen Chunk) läuft vom Einstieg über das
// Layout bis auf eine breite Plattform hinter dem Ausstieg. Er probiert Eingabeskripte auf einer Kopie des Zustands
// und bleibt bei jedem Treffer oder Sturz hängen. Das fängt Fehler ab, die die reine Geometrie nicht sieht:
// Gegnerwege, Blitzzeiten, Stachelwolken, Regen, Wind und bewegliche Plattformen.

const IDLE = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false };
const SCRIPTS = [{ f: () => ({ ...IDLE, move: 1 }) }, { f: () => IDLE }];
for (const move of [1, 0]) {
  for (const jf of [0, 4, 9, 15, 22, 30, 40]) {
    for (const dbl of [-1, 20, 30, 40]) {
      SCRIPTS.push({ f: (i) => ({ move, jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1), jumpHeld: (i >= jf && i < jf + 22) || (dbl >= 0 && i >= jf + dbl && i < jf + dbl + 18), dashPressed: false, downHeld: true }) });
    }
  }
}

function simStep(s, input) {
  s.t += STEP;
  updatePlatforms(s, STEP);
  updateObstacles(s, STEP);
  updateEnemies(s, STEP);
  updatePlayer(s, input, STEP);
  playerVsEnemies(s);
  playerVsHazards(s);
  updateCollectibles(s, STEP);
  s.camX = Math.max(s.camX, s.player.x - 300);
  s.particles.length = 0;
  s.popups.length = 0;
}

function lookahead(s, script, goalX) {
  const c = structuredClone(s);
  const lives0 = c.lives;
  const hits0 = c.run.hits;
  let steps = 0;
  let fell = false;
  for (; steps < 66; steps++) {
    simStep(c, script.f(steps));
    if (c.player.y > H + 30) { fell = true; break; }
    if (c.lives < lives0 || c.run.hits > hits0) break;
  }
  const damage = fell || c.lives < lives0 || c.run.hits > hits0;
  return { damage, score: Math.min(c.player.x, goalX) - s.player.x - (damage ? 2000 - steps * 10 : 0) };
}

// Gibt null zurück, wenn der Bot das Ziel erreicht, sonst eine Beschreibung des Scheiterns
function playThrough(chunk, seed, { diff = chunk.diff, meter = chunk.min } = {}) {
  const s = createState({ seed });
  seedRng(s, seed);
  const ox = 200;
  const b = createBuilder(s, { ox, oy: 330, diff, meter, mechs: mechsAt(meter), gateIndex: 1 });
  chunk.build(b);
  const st = b.st;
  const entry = st.route[0];
  const last = st.route[st.route.length - 1];
  // Hinter dem Ausstieg liegt die nächste breite Plattform nach einer mittleren Lücke, wie im echten Spiel
  const goal = createStaticPlatform(s, last.x + last.w + 110, last.y, 3000, { ground: true });
  Object.assign(s, { platforms: [...st.platforms, goal], enemies: st.enemies, hazards: st.hazards, zones: st.zones, stars: st.stars, powerups: st.powerups });
  Object.assign(s.player, { x: entry.x + 30, y: entry.y - s.player.h, onGround: true });
  s.camX = s.player.x - 300;
  let current = SCRIPTS[0];
  let start = 0;
  for (let k = 0; k < 60 * 40; k++) {
    if (k % 6 === 0) {
      if (lookahead(s, SCRIPTS[0], goal.x).damage) {
        let best = null;
        for (const sc of SCRIPTS) {
          const r = lookahead(s, sc, goal.x);
          if (!best || r.score > best.r.score) best = { sc, r };
        }
        current = best.sc;
      } else current = SCRIPTS[0];
      start = k;
    }
    const lives0 = s.lives;
    const hits0 = s.run.hits;
    simStep(s, current.f(k - start));
    const where = Math.round(s.player.x - ox);
    if (s.lives < lives0 || s.run.hits > hits0) return `Treffer bei x ${where}: ${s.deathCause ? s.deathCause.label : '?'}`;
    if (s.player.y > H + 60) return `gestürzt bei x ${where}`;
    if (s.player.onGround && s.player.groundId === goal.id && s.player.x >= goal.x + 60) return null;
  }
  return 'Ziel nicht rechtzeitig erreicht';
}

test('Spielbarkeit: der Test Bot kommt durch jeden Chunk, ohne getroffen zu werden oder zu stürzen', () => {
  for (const c of ADVANCED) {
    for (const seed of [1, 2, 3]) assert.equal(playThrough(c, seed), null, `${c.id} Seed ${seed}`);
  }
});

test('Spielbarkeit: auch spät im Spiel, wenn die Parameter strenger sind', () => {
  for (const c of ADVANCED) {
    for (const seed of [4, 5]) assert.equal(playThrough(c, seed, { meter: c.min + 2000 }), null, `${c.id} Seed ${seed} +2000 m`);
  }
});

test('Spielbarkeit: der Bot scheitert zu Recht an unmöglichen Chunks (Kontrolle)', () => {
  const gapTooWide = { build(bd) { const a = bd.ground(0, 0, 240); bd.route(a, bd.ground(a.w + 520, 0, 240)); } };
  const spikeWall = { build(bd) { const a = bd.ground(0, 0, 900); for (let i = 0; i < 10; i++) bd.spike(a, 0.3 + i * 0.045); bd.route(a); } };
  for (const c of [gapTooWide, spikeWall]) assert.notEqual(playThrough({ ...c, diff: 2, min: 1700 }, 1), null);
});
