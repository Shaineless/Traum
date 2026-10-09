// Tests für die Chunk Layouts der Albtraum Phase (game/chunks/nightmare.js, Schwierigkeit 7 bis 9).
// Die allgemeine Fairness Prüfung (Sprünge, sicherer Anfang, Host Plattformen) steckt in tests/chunks.test.mjs.
// Hier steht, was für diese Layouts zusätzlich gilt: Lernziele, Mechanik Tags, Variation, Sonderfälle der Mechaniken
// (Sprungwolke, Eis, Blinkwolke, Komet, Hagelwolke), die Fähigkeiten als Abkürzung und, mit der echten Physik, ob die
// Layouts so spielbar sind, wie ihre Kommentare behaupten. Die Hauptroute braucht immer nur Sprung und Doppelsprung.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS } from '../game/chunks/index.js';
import { NIGHTMARE } from '../game/chunks/nightmare.js';
import { COMET, H, LIMITS, METER, PHYS, SPRING, STEP, Y_MAX, Y_MIN, difficultyAt, mechsAt } from '../game/constants.js';
import { createBuilder } from '../game/builder.js';
import { createStaticPlatform } from '../game/entities.js';
import { updateCollectibles } from '../game/collectibles.js';
import { playerVsEnemies, updateEnemies } from '../game/enemies.js';
import { playerVsHazards, updateObstacles } from '../game/obstacles.js';
import { updatePlatforms } from '../game/platforms.js';
import { updatePlayer } from '../game/player.js';
import { hopRatio, maxRise, platformAt } from '../game/reach.js';
import { seedRng } from '../game/rng.js';
import { createState } from '../game/state.js';
import { fireShot, updateShots } from '../game/shots.js';
import { ensureAhead, initGenerator } from '../game/generator.js';
import { readFileSync } from 'node:fs';
import { safeFor, validateStaged } from '../game/validate.js';
import { buildChunk } from './chunk-harness.mjs';

const byId = Object.fromEntries(NIGHTMARE.map((c) => [c.id, c]));
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const OX = 1000; // Ursprung, mit dem tests/chunk-harness.mjs baut
const MECH_TAGS = ['moving', 'breakable', 'walker', 'spike', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'rain', 'fallingstar', 'powerup',
  'spring', 'ice', 'blink', 'comet', 'hailcloud'];
const POWER_TYPES = ['shield', 'dash', 'magnet', 'feather', 'double'];

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
const wrap = (v) => v - Math.floor(v);
const hostOf = (st, e) => st.platforms.find((p) => p.id === e.hostId);
const offRoute = (st) => st.platforms.filter((p) => !st.route.includes(p));
const kindOf = (p) => (p.kind !== 'static' ? p.kind : p.slick ? 'ice' : p.ground ? 'ground' : 'cloud');
const kinds = (st) => st.route.map(kindOf);
const ofKind = (st, kind) => st.enemies.filter((e) => e.kind === kind);
const hazards = (st, kind) => st.hazards.filter((h) => h.kind === kind).sort((p, q) => p.x - q.x);
const centerOf = (e) => (e.minX + e.maxX + e.w) / 2; // Mitte der Streifzone eines Gegners
const left = (p) => (p.kind === 'moving' ? p.ox - Math.abs(p.ax) : p.x);
const right = (p) => (p.kind === 'moving' ? p.ox + Math.abs(p.ax) + p.w : p.x + p.w);
// Waagerechter Abstand zweier Bereiche (0, wenn sie sich überlappen)
const spanGap = (a0, a1, b0, b1) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
// Liegt x in der Lücke zwischen den Plattformen a und b?
const inGap = (x, a, b) => x > right(a) && x < left(b);
// Die Lücken entlang der Route als Paare
const hops = (st) => st.route.slice(0, -1).map((p, i) => [p, st.route[i + 1]]);

// ---------- Bibliothek ----------

const REQUIRED = ['cloud-ladder', 'storm-corridor', 'blink-ice-maze', 'hail-charger-gauntlet', 'catapult-chain', 'rainbow-dash-run', 'boss-arena',
  'slam-shaft', 'shuriken-gallery', 'ice-hail-slide', 'ferry-hopper', 'comet-hail-run', 'blink-flyer-rhythm', 'spring-tower', 'thunder-rain-run',
  'ice-storm', 'crumble-hail-bridge', 'abyss-sprint', 'dream-fortress', 'storm-crown', 'twin-catapult', 'floating-gardens'];

test('NIGHTMARE enthält mindestens 16 Chunks mit allen Pflicht IDs und steht in CHUNKS', () => {
  assert.ok(NIGHTMARE.length >= 16, `nur ${NIGHTMARE.length} Chunks`);
  for (const id of REQUIRED) assert.ok(byId[id], `Chunk ${id} fehlt`);
  assert.equal(NIGHTMARE.length, REQUIRED.length, 'Chunk ohne Eintrag in REQUIRED');
  for (const c of NIGHTMARE) assert.ok(CHUNKS.includes(c), `${c.id} fehlt in CHUNKS`);
  assert.equal(new Set(CHUNKS.map((c) => c.id)).size, CHUNKS.length, 'IDs über alle Chunks eindeutig');
});

test('IDs sind englische kebab case Namen, Namen sind deutsch und ohne Striche', () => {
  for (const c of NIGHTMARE) {
    assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, `ID ${c.id}`);
    assert.ok(typeof c.name === 'string' && c.name.length >= 3, `Name von ${c.id}`);
    assert.ok(!/[-‐-―]/.test(c.name), `Name von ${c.id} enthält Striche`);
    assert.ok(/^[A-ZÄÖÜ]/.test(c.name), `Name von ${c.id} beginnt nicht groß`);
  }
  assert.equal(new Set(NIGHTMARE.map((c) => c.name)).size, NIGHTMARE.length, 'Namen eindeutig');
});

test('Felder: Gewicht 1 bis 3, Schwierigkeit 7 bis 9, ab 1600 Metern, Tags gültig, kein Ruhechunk', () => {
  for (const c of NIGHTMARE) {
    assert.ok(Number.isInteger(c.weight) && c.weight >= 1 && c.weight <= 3, `${c.id} weight ${c.weight}`);
    assert.ok(c.diff >= 7 && c.diff <= 9, `${c.id} diff ${c.diff}`);
    assert.ok(c.max > c.min && c.min >= 1600, `${c.id} min ${c.min} max ${c.max}`);
    assert.equal(c.rest, false, `${c.id} rest`);
    assert.ok(Array.isArray(c.mech) && c.mech.length >= 2 && c.mech.every((m) => MECH_TAGS.includes(m)), `${c.id} mech`);
    assert.equal(typeof c.build, 'function');
  }
});

test('Pflichtwerte: Schwierigkeit, Startmeter und Mechanik jedes Chunks', () => {
  const spec = {
    'cloud-ladder': [7, 1650, ['flyer', 'spike', 'walker']],
    'storm-corridor': [7, 1700, ['comet', 'lightning', 'wind']],
    'blink-ice-maze': [7, 1650, ['blink', 'ice']],
    'hail-charger-gauntlet': [7.5, 1900, ['charger', 'hailcloud']],
    'catapult-chain': [7.5, 1900, ['flyer', 'spring']],
    'rainbow-dash-run': [7.5, 1900, ['powerup', 'spike', 'walker']],
    'boss-arena': [8, 2200, ['charger', 'jumper', 'walker']],
    'slam-shaft': [8, 2200, ['jumper', 'walker']],
    'shuriken-gallery': [8, 2200, ['flyer', 'hailcloud', 'spike', 'spring']],
    'ice-hail-slide': [8, 2200, ['hailcloud', 'ice']],
    'ferry-hopper': [8, 2250, ['jumper', 'moving', 'spike']],
    'comet-hail-run': [8.5, 2500, ['comet', 'hailcloud']],
    'blink-flyer-rhythm': [8.5, 2500, ['blink', 'fallingstar', 'flyer', 'spike']],
    'spring-tower': [8.5, 2500, ['charger', 'hailcloud', 'powerup', 'spring']],
    'thunder-rain-run': [8.5, 2500, ['charger', 'lightning', 'rain']],
    'ice-storm': [8.5, 2550, ['ice', 'lightning', 'wind']],
    'crumble-hail-bridge': [7.5, 1950, ['breakable', 'fallingstar', 'hailcloud']],
    'abyss-sprint': [9, 2800, ['fallingstar', 'flyer']],
    'dream-fortress': [9, 2900, ['charger', 'hailcloud', 'powerup', 'spike', 'spring', 'walker']],
    'storm-crown': [9, 2900, ['charger', 'comet', 'lightning', 'walker']],
    'twin-catapult': [9, 2900, ['blink', 'flyer', 'spring']],
    'floating-gardens': [9, 2850, ['flyer', 'hailcloud', 'moving']],
  };
  assert.deepEqual(Object.keys(spec).sort(), [...REQUIRED].sort());
  for (const [id, [diff, min, mech]] of Object.entries(spec)) {
    const c = byId[id];
    assert.equal(c.diff, diff, `${id} diff`);
    assert.equal(c.min, min, `${id} min`);
    assert.deepEqual([...c.mech].sort(), mech, `${id} mech`);
  }
});

test('mech Liste entspricht genau den Mechaniken, die der Chunk baut, und ist am Startmeter freigeschaltet', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const used = [...st.tags].filter((t) => MECH_TAGS.includes(t)).sort();
      assert.deepEqual(used, [...c.mech].sort(), `${c.id} Seed ${seed}`);
    }
    const unlocked = mechsAt(c.min);
    for (const m of c.mech) assert.ok(unlocked.has(m), `${c.id}: ${m} bei Meter ${c.min} nicht freigeschaltet`);
  }
});

test('Schwierigkeit und Startmeter passen zur Kurve: Schwierigkeit 7 ab 1600 m, 8 ab 2200 m, 9 ab 2800 m', () => {
  for (const c of NIGHTMARE) {
    assert.ok(c.min >= 1600 + (c.diff - 7) * 600, `${c.id}: min ${c.min} zu früh für diff ${c.diff}`);
    // Spätestens, wo die Kurve plus 0,6 den Chunk erreicht, darf er auftauchen: min liegt nicht weit dahinter
    assert.ok(c.diff <= difficultyAt(c.min) + 1.8, `${c.id}: diff ${c.diff} bei Meter ${c.min} (Kurve ${difficultyAt(c.min).toFixed(2)}) zu hoch`);
  }
  const bucket = (lo, hi) => NIGHTMARE.filter((c) => c.diff >= lo && c.diff <= hi).length;
  assert.ok(bucket(7, 7.5) >= 5 && bucket(8, 8.5) >= 6 && bucket(9, 9) >= 4, 'Schwierigkeiten sind nicht über 7 bis 9 verteilt');
});

test('Auswahl: jede Phase hat Chunks, mindestens ein Drittel kombiniert zwei oder mehr Mechaniken, jede Mechanik kommt mehrfach vor', () => {
  const pick = (meter) => NIGHTMARE.filter((c) => c.min <= meter && meter < c.max && c.diff <= difficultyAt(meter) + 0.6 && c.mech.every((m) => mechsAt(meter).has(m)));
  assert.ok(pick(1850).length >= 3, 'zu wenige Chunks bei 1850 m');
  assert.ok(pick(2300).length >= 6, 'zu wenige Chunks bei 2300 m');
  assert.ok(pick(2600).length >= 12, 'zu wenige Chunks bei 2600 m');
  assert.ok(pick(2900).length >= 18, 'zu wenige Chunks bei 2900 m');
  assert.ok(NIGHTMARE.filter((c) => c.mech.length >= 2).length * 3 >= NIGHTMARE.length, 'zu wenige Kombinationen');
  assert.ok(NIGHTMARE.filter((c) => c.mech.length >= 3).length * 3 >= NIGHTMARE.length, 'Tripel Kombinationen fehlen');
  assert.ok(NIGHTMARE.filter((c) => c.mech.length >= 4).length >= 3, 'Vierer Kombinationen fehlen');
  const uses = (tag) => NIGHTMARE.filter((c) => c.mech.includes(tag)).length;
  const need = { spring: 4, ice: 3, blink: 3, comet: 3, hailcloud: 8, powerup: 3, wind: 2, flyer: 7, charger: 5, walker: 5, spike: 5, breakable: 1,
    lightning: 4, jumper: 2, rain: 1, moving: 2, fallingstar: 2 };
  for (const [tag, n] of Object.entries(need)) assert.ok(uses(tag) >= n, `${tag} kommt nur in ${uses(tag)} Chunks vor`);
});

// ---------- Allgemeine Eigenschaften ----------

test('jeder Chunk erzeugt über 12 Seeds mindestens 3 verschiedene Layouts und ist bei gleichem Seed gleich', () => {
  for (const c of NIGHTMARE) {
    const layouts = new Set();
    const sigOf = ({ st }) => JSON.stringify([st.platforms.map((p) => [p.x, p.y, p.w]), st.stars.map((s) => [s.x, s.y]), st.hazards.map((h) => h.x), st.enemies.map((e) => [e.x, e.dir])]);
    for (const seed of SEEDS) {
      const sig = sigOf(buildChunk(c, { seed }));
      layouts.add(sig);
      assert.equal(sig, sigOf(buildChunk(c, { seed })), `${c.id} Seed ${seed} nicht deterministisch`);
    }
    assert.ok(layouts.size >= 3, `${c.id} liefert nur ${layouts.size} Layouts`);
  }
});

test('Routen: erste Plattform ist Boden bei x = 0 und breit genug für den Respawn, die Route läuft nach rechts', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const r = route(st);
      assert.ok(r.length >= 3, `${c.id}: Route zu kurz`);
      assert.equal(r[0].ground, true, `${c.id}: Einstieg muss b.ground sein`);
      assert.equal(r[0].x, OX);
      assert.ok(r[0].w >= 200 && r[r.length - 1].w >= 140, `${c.id}: Ein oder Ausstieg zu schmal`);
      assert.equal(r[r.length - 1].kind, 'static');
      assert.ok(!r[0].slick && !r[r.length - 1].slick && r[0].kind === 'static', `${c.id}: Ein oder Ausstieg ist Eis oder Sprungwolke`);
      for (const p of r) assert.ok(st.platforms.includes(p), `${c.id}: Routenplattform ${p.id} fehlt in platforms`);
      const xs = r.map((p) => (p.kind === 'moving' ? p.ox : p.x));
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${c.id}: Route läuft nicht nach rechts`);
    }
  }
});

test('Breite, Höhe und Mengen: 1300 bis 2500 px breit, höchstens 185 px Höhenspanne, alle Grenzen des Generators eingehalten', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.ok(st.maxX >= 1300 && st.maxX <= 2500, `${c.id}: Breite ${Math.round(st.maxX)}`);
      assert.ok(st.platMaxY - st.platMinY <= Y_MAX - Y_MIN, `${c.id}: Höhenspanne ${st.platMaxY - st.platMinY}`);
      assert.ok(st.platforms.length <= 16 && st.enemies.length <= 7 && st.hazards.length <= 6, `${c.id}: zu viele Objekte`);
      assert.ok(st.platforms.length <= LIMITS.MAX_PLATFORMS / 4, `${c.id}: zu viele Plattformen für das Limit`);
      // Hagelwolken legen im Spiel Hagelkörner in s.hazards ab: der Chunk selbst bleibt weit unter dem Limit
      assert.ok(st.hazards.length + st.enemies.filter((e) => e.kind === 'hailcloud').length * 3 <= LIMITS.MAX_HAZARDS / 2, `${c.id}: zu viele Hindernisse samt Hagel`);
    }
  }
});

test('jeder Chunk trägt Sterne: mindestens 12, höchstens 48 auch mit Supermond, alle im Bild', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st, oy } = buildChunk(c, { seed });
      assert.ok(st.stars.length >= 12, `${c.id} Seed ${seed}: nur ${st.stars.length} Sterne`);
      for (const s of st.stars) assert.ok(s.y >= 20 && s.y <= H, `${c.id}: Stern außerhalb des Bildes (y ${Math.round(s.y)}, oy ${Math.round(oy)})`);
      const boosted = buildChunk(c, { seed, starBoost: true });
      assert.deepEqual(boosted.errors, [], `${c.id} Seed ${seed} mit Supermond`);
      assert.ok(boosted.st.stars.length <= 48, `${c.id}: ${boosted.st.stars.length} Sterne mit Supermond`);
    }
  }
});

test('Risikosterne gibt es nur in Chunks mit fallingstar, nur über Abgründen und nie im sicheren Anfang', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const risk = st.stars.filter((s) => s.falling);
      assert.equal(risk.length > 0, c.mech.includes('fallingstar'), `${c.id} Seed ${seed}`);
      for (const star of risk) {
        assert.equal(star.bonus, 'risk');
        assert.ok(star.x - OX >= LIMITS.SAFE_START, `${c.id}: Risikostern im sicheren Anfang`);
        const below = st.platforms.filter((p) => star.x >= p.x - 14 && star.x <= p.x + p.w + 14);
        assert.equal(below.length, 0, `${c.id}: Risikostern über einer Plattform`);
      }
    }
  }
});

test('sicherer Anfang und Landezonen: nichts Gefährliches in den ersten 220 px, Bodengegner lassen Platz zum Landen und Abspringen', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      for (const h of st.hazards) assert.ok(h.x - h.w / 2 - OX >= LIMITS.SAFE_START, `${c.id}: Hindernis im Anfang`);
      for (const e of st.enemies) {
        assert.ok(e.minX - OX >= LIMITS.SAFE_START, `${c.id}: ${e.kind} im Anfang`);
        if (e.kind === 'flyer' || e.kind === 'hailcloud') continue;
        const host = hostOf(st, e);
        assert.ok(e.minX - host.x >= 56, `${c.id}: Landezone vor ${e.kind} nur ${Math.round(e.minX - host.x)} px`);
        assert.ok(host.x + host.w - (e.maxX + e.w) >= 56, `${c.id}: Absprungzone hinter ${e.kind} nur ${Math.round(host.x + host.w - (e.maxX + e.w))} px`);
        assert.ok(e.x >= e.minX && e.x <= e.maxX, `${c.id}: Gegner steht außerhalb seiner Zone`);
      }
      for (const z of st.zones) if (z.kind === 'wind') assert.ok(Math.abs(z.vx) <= 120, `${c.id}: Wind zu stark`);
    }
  }
});

test('Ereignisse und späteres Spiel: mit Sturm (Gegenwind 40), Supermond und höheren Metern bleibt jeder Chunk gültig', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      assert.deepEqual(buildChunk(c, { seed, eventWind: 40 }).errors, [], `${c.id} Seed ${seed} im Sturm`);
      for (const extra of [0, 400, 1000, 1500, 3000]) {
        assert.deepEqual(buildChunk(c, { seed, meter: c.min + extra }).errors, [], `${c.id} +${extra} m Seed ${seed}`);
      }
    }
  }
});

test('jeder Chunk ist bei jeder Schwierigkeit von 7 bis 9,5 gültig, denn die Lücken passen sich der Schwierigkeit des Builders an', () => {
  for (const c of NIGHTMARE) {
    for (const diff of [7, 7.5, 8, 8.5, 9, 9.5]) {
      for (const seed of SEEDS) assert.deepEqual(buildChunk(c, { seed, diff }).errors, [], `${c.id} diff ${diff} Seed ${seed}`);
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
  for (const c of NIGHTMARE) {
    for (const seed of [1, 2, 3]) assert.equal(sig(c, seed, 0), sig(c, seed, 333), `${c.id} Seed ${seed}`);
  }
});

// Der Generator darf den Einstieg überall zwischen der tiefsten und der höchsten erlaubten Lage setzen. An beiden Enden
// muss der Chunk gültig bleiben (der Bildrand oben und der Höhenbereich der Plattformen).
test('Randlagen: auch bei der höchsten und der tiefsten erlaubten Einstiegshöhe besteht der Chunk die Prüfung des Generators', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS) {
      const s = createState({ seed });
      seedRng(s, seed);
      const mechs = mechsAt(c.min);
      const probe = createBuilder(s, { ox: 0, oy: 0, diff: c.diff, meter: c.min, mechs, measure: true });
      const saved = s.rng;
      c.build(probe);
      s.rng = saved;
      const m = probe.st;
      const lo = Math.max(Y_MIN - m.platMinY, 24 - m.minY);
      const hi = Math.min(Y_MAX - m.platMaxY, H - 12 - m.maxY);
      assert.ok(lo <= hi, `${c.id} Seed ${seed}: kein Platz im Höhenbereich (${lo} bis ${hi})`);
      assert.ok(hi - lo >= 15, `${c.id} Seed ${seed}: nur ${Math.round(hi - lo)} px Spielraum für die Einstiegshöhe`);
      for (const oy of [lo, hi, Math.round((lo + hi) / 2)]) {
        s.rng = saved;
        const b = createBuilder(s, { ox: OX, oy, diff: c.diff, meter: c.min, mechs, gateIndex: 1 });
        c.build(b);
        assert.deepEqual(validateStaged(b.st, { ox: OX, diff: c.diff, mechs }), [], `${c.id} Seed ${seed} bei oy ${Math.round(oy)}`);
        for (const p of b.st.platforms) {
          const top = p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y;
          assert.ok(top >= Y_MIN - 0.5 && top <= Y_MAX + 0.5, `${c.id}: Plattform außerhalb des Höhenbereichs`);
        }
      }
    }
  }
});

test('Albtraum Chunks sind dicht: jeder trägt mindestens zwei Gefahren, erzwingt zwei knappe Landungen oder eine Lücke nahe am Limit', () => {
  for (const c of NIGHTMARE) {
    for (const seed of SEEDS.slice(0, 4)) {
      const { st } = buildChunk(c, { seed });
      const dangers = st.enemies.length + st.hazards.length + st.zones.length;
      const narrow = st.route.filter((p) => p.w < 120 && p.kind !== 'spring').length;
      const ratios = hops(st).map(([p, q]) => hopRatio(p, q, { dbl: true }));
      const hard = ratios.some((r) => Number.isFinite(r) && r >= 0.6);
      assert.ok(dangers >= 2 || narrow >= 2 || hard, `${c.id} Seed ${seed}: weder Gefahren (${dangers}) noch knappe Landungen (${narrow}) noch weite Lücken`);
    }
  }
});

test('Quelltext: Zufall nur über den Builder, keine Uhr, keine Striche als Satzzeichen in den Texten', () => {
  const src = readFileSync(new URL('../game/chunks/nightmare.js', import.meta.url), 'utf8');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src), 'Zufall oder Uhr im Quelltext');
  assert.ok(!/[\u2013\u2014]/.test(src), 'Gedankenstrich im Quelltext');
  assert.ok(/^export const NIGHTMARE = \[/m.test(src));
});

test('Generator: im Albtraum Bereich bauen sich die Chunks ohne Ablehnung, und die Auswahl ist abwechslungsreich', () => {
  const ids = new Set(NIGHTMARE.map((c) => c.id));
  const seen = new Map();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = createState({ seed });
    s.gen = { keepLog: true };
    initGenerator(s);
    for (let i = 0; i < 700 && s.camX < 3800 * METER; i++) {
      s.camX += 300;
      s.player.x = s.camX + 300;
      ensureAhead(s);
    }
    const own = (s.gen.errors || []).filter((e) => ids.has(e.chunk));
    assert.deepEqual(own, [], `Seed ${seed}: abgelehnte Albtraum Chunks`);
    for (const e of s.gen.chunkLog) {
      if (!ids.has(e.id)) continue;
      seen.set(e.id, (seen.get(e.id) || 0) + 1);
      const c = byId[e.id];
      assert.ok(e.meter >= c.min, `${e.id} steht bei Meter ${Math.round(e.meter)} vor seinem Startmeter ${c.min}`);
      assert.ok(e.diff >= 7, `${e.id} mit Schwierigkeit ${e.diff}`);
    }
  }
  assert.ok(seen.size >= 16, `nur ${seen.size} verschiedene Albtraum Chunks in sechs Läufen`);
});

// ---------- Mechaniken ----------

test('Sprungwolken: Breite 60 bis 140, nie Einstieg oder Ausstieg, und keine Flieger oder Hagelwolken in ihrer Flugbahn', () => {
  const chunks = NIGHTMARE.filter((c) => c.mech.includes('spring'));
  assert.ok(chunks.length >= 4);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const springs = st.platforms.filter((p) => p.kind === 'spring');
      assert.ok(springs.length >= 1, `${c.id}: keine Sprungwolke`);
      for (const p of springs) {
        assert.ok(p.w >= 60 && p.w <= 140, `${c.id}: Sprungwolke ${p.w} px breit`);
        assert.equal(p.launch, SPRING.SPEED);
        assert.ok(p !== st.route[0] && p !== st.route[st.route.length - 1]);
        assert.ok(st.route.includes(p), `${c.id}: Sprungwolke abseits der Route`);
        // Die Sprungwolke wirft 232 px hoch: darüber hängt nichts, das sie rammen könnte, und es bleibt Platz bis zum Bildrand
        // Die Flugbahn reicht von der Sprungwolke bis zum Ende der nächsten Routenplattform, auf der sie landet (höchstens 340 px weit).
        // Ausnahme catapult-chain: dort schweben Flieger absichtlich im Abstieg über dem Abgrund, siehe den eigenen Test.
        const landing = st.route[st.route.indexOf(p) + 1];
        for (const e of st.enemies) {
          if (e.kind !== 'flyer' && e.kind !== 'hailcloud') continue;
          if (c.id === 'catapult-chain' && e.kind === 'flyer') continue;
          if (e.maxX + e.w <= p.x + 8) continue; // hinter dem Absprung: die Flugbahn führt nach rechts weg
          assert.ok(spanGap(p.x - 40, Math.min(landing.x + landing.w, p.x + p.w + 340), e.minX, e.maxX + e.w) > 0 || e.baseY + e.h + e.amp < p.y - 232 - PHYS.H - 40, `${c.id}: ${e.kind} liegt in der Flugbahn einer Sprungwolke`);
        }
      }
    }
  }
});

test('Eiswolken: mindestens 130 px breit, nie Einstieg oder Ausstieg, nie Gastgeber von Gegnern oder Stachelwolken', () => {
  const chunks = NIGHTMARE.filter((c) => c.mech.includes('ice'));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const ices = st.platforms.filter((p) => p.slick);
      assert.ok(ices.length >= 2, `${c.id}: zu wenig Eis`);
      for (const p of ices) {
        assert.ok(p.w >= 130 && p.kind === 'static');
        assert.ok(st.route.includes(p), `${c.id}: Eiswolke abseits der Route`);
        assert.ok(!st.enemies.some((e) => e.hostId === p.id) && !st.hazards.some((h) => h.hostId === p.id));
      }
    }
  }
});

test('Blinkwolken: lange fest, immer mit Vorwarnung, und jede Kette läuft als Welle mit dem Spieler', () => {
  const chunks = NIGHTMARE.filter((c) => c.mech.includes('blink'));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const chain = st.route.filter((p) => p.kind === 'blink');
      assert.ok(chain.length >= 2, `${c.id}: Kette zu kurz`);
      for (const p of chain) {
        assert.ok(p.w >= 92 && p.period >= 3.4 && p.period <= 4.4, `${c.id}: Blinkwolke ${p.w} px, Takt ${p.period}`);
        assert.ok(p.period * p.on >= 2, `${c.id}: Blinkwolke zu kurz fest`);
      }
      // Die Welle: jede Wolke erscheint um die Laufzeit zwischen den Wolken (230 px pro Sekunde) später als die vorige
      for (let i = 1; i < chain.length; i++) {
        assert.equal(chain[i].period, chain[i - 1].period, `${c.id}: Takt wechselt`);
        const dx = chain[i].x + chain[i].w / 2 - (chain[i - 1].x + chain[i - 1].w / 2);
        const want = wrap(dx / 230 / chain[i].period);
        const lag = wrap(chain[i - 1].phase - chain[i].phase);
        const off = Math.min(Math.abs(lag - want), 1 - Math.abs(lag - want));
        assert.ok(off < 1e-6, `${c.id}: Welle um ${off.toFixed(4)} verschoben`);
      }
      assert.ok(!st.route[0].period && !st.route[st.route.length - 1].period, 'Ein und Ausstieg sind feste Wolken');
    }
  }
});

test('Kometen: schlagen auf festem Boden ein, mit mindestens 150 px Abstand, nie im Anfang, eine Sekunde Vorwarnung bleibt', () => {
  const chunks = NIGHTMARE.filter((c) => c.mech.includes('comet'));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const comets = hazards(st, 'comet');
      assert.ok(comets.length >= 1 && comets.length <= 4);
      for (const h of comets) {
        const floor = st.platforms.find((p) => h.x > p.x && h.x < p.x + p.w && Math.abs(p.y - h.y) < 12);
        assert.ok(floor && floor.kind === 'static', `${c.id}: Komet ohne festen Boden`);
        assert.ok(h.x - floor.x >= COMET.RADIUS + PHYS.W + 20, `${c.id}: Komet im Landebereich`);
        assert.ok(floor.x + floor.w - h.x >= COMET.RADIUS + PHYS.W + 20, `${c.id}: Komet im Absprungbereich`);
        assert.ok(h.idleTime >= 0.8, 'Komet braucht eine Ruhezeit');
        assert.ok(h.x - OX >= 300, `${c.id}: Komet zu früh`);
      }
      const zones = st.hazards.filter((h) => h.kind === 'comet' || h.kind === 'lightning').sort((p, q) => p.x - q.x);
      for (let i = 1; i < zones.length; i++) assert.ok(zones[i].x - zones[i - 1].x >= 150);
    }
  }
});

test('Hagelwolken und Flieger: 165 px über der höchsten Fläche, ein Stern darüber als Köder, nie über Gegnern am Boden', () => {
  const chunks = NIGHTMARE.filter((c) => c.mech.includes('hailcloud') || c.mech.includes('flyer'));
  assert.ok(chunks.length >= 10);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const clouds = st.enemies.filter((e) => e.kind === 'hailcloud' || e.kind === 'flyer');
      assert.ok(clouds.length >= 1, `${c.id}: keine schwebende Wolke`);
      for (const e of clouds) {
        let surface = Infinity;
        for (const p of st.platforms) if (p.x + p.w > e.minX - 200 && p.x < e.maxX + e.w + 200) surface = Math.min(surface, p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y);
        assert.ok(e.baseY + e.h + e.amp <= surface - 165, `${c.id}: ${e.kind} blockiert normale Sprünge`);
        assert.ok(e.baseY + e.h + e.amp >= surface - 215, `${c.id}: ${e.kind} schwebt höher als nötig`);
        assert.ok(e.amp <= 8, 'kleines Auf und Ab');
        // Der Köder Stern hängt über der Mitte der Wolke. Ohne ihn bleiben die Fliegerreihe der Wurfstern Galerie (dort liegen die
        // Sterne am Boden) und die Hagelwolke des Federturms, deren Stern im Bogen der Sprungwolke läge.
        const cx = centerOf(e);
        const decoy = st.stars.some((s) => Math.abs(s.x - cx) < 2 && s.y < e.baseY - e.amp);
        if (!['shuriken-gallery', 'spring-tower'].includes(c.id)) assert.ok(decoy, `${c.id}: Stern über dem ${e.kind} fehlt`);
        // Hagel fällt nach unten: unter einer Hagelwolke darf kein Bodengegner patrouillieren und keine Stachelwolke stehen
        if (e.kind === 'hailcloud') {
          for (const g of st.enemies) if (g.kind !== 'flyer' && g.kind !== 'hailcloud') assert.ok(spanGap(e.minX - 40, e.maxX + e.w + 40, g.minX, g.maxX + g.w) > 0, `${c.id}: Hagel über einem ${g.kind}`);
          for (const h of st.hazards) if (h.kind === 'spike') assert.ok(spanGap(e.minX - 40, e.maxX + e.w + 40, h.x, h.x + h.w) > 0, `${c.id}: Hagel über einer Stachelwolke`);
        }
      }
      // gegenläufige Paare fliegen nicht im Gleichschritt
      for (const kind of ['flyer', 'hailcloud']) {
        const same = clouds.filter((e) => e.kind === kind);
        if (same.length === 2) assert.notEqual(same[0].dir, same[1].dir, `${c.id}: zwei ${kind} im Gleichschritt`);
      }
    }
  }
});

test('Powerups: Regenbogen Dash am Anfang der Strecke, Schreine auf hohen Terrassen, alle Typen gültig', () => {
  const types = new Set();
  for (const c of NIGHTMARE.filter((x) => x.mech.includes('powerup'))) {
    for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
      const { st, errors } = buildChunk(c, { seed });
      assert.deepEqual(errors, [], `${c.id} Seed ${seed}`);
      assert.equal(st.powerups.length, 1);
      const p = st.powerups[0];
      assert.ok(POWER_TYPES.includes(p.type), p.type);
      types.add(p.type);
      const host = st.platforms.find((q) => p.x > q.x && p.x < q.x + q.w && p.y < q.y && q.y - p.y <= 60);
      assert.ok(host, `${c.id}: Powerup schwebt über keiner Plattform`);
      if (c.id === 'rainbow-dash-run') {
        assert.equal(p.type, 'dash');
        assert.equal(host, st.route[0], 'das Regenbogen Dash liegt auf dem Einstieg');
        assert.ok(p.x - OX >= 100, 'Dash liegt nicht direkt am Rand');
      } else {
        // Der Turm hängt hoch über der Lauflinie: nur mit der Sprungwolke (oder dem Doppelsprung) zu erreichen
        assert.ok(['spring-tower', 'dream-fortress'].includes(c.id), c.id);
        assert.ok(st.route.includes(host) && host.y <= st.route[0].y - 130, `${c.id}: Powerup nicht auf dem Turm`);
      }
    }
  }
  assert.ok(types.has('dash'));
  assert.ok(types.size >= 4, `nur ${[...types]} kommen vor`);
});

// ---------- Die einzelnen Layouts ----------

test('cloud-ladder: drei Stufen steigen an, auf jeder wartet eine Gewitterwolke oder Stachelwolke im Wechsel, Flieger kreisen über den Lücken', () => {
  each('cloud-ladder', (st) => {
    const [a, p1, p2, p3, exit] = route(st);
    assert.deepEqual(kinds(st), ['ground', 'cloud', 'cloud', 'cloud', 'ground']);
    assert.ok(p1.y < a.y && p2.y < p1.y && p3.y < p2.y, 'Stufen steigen an');
    assert.ok(exit.y > p3.y && exit.y === a.y, 'der Abstieg führt zurück auf die Lauflinie');
    const plan = [p1, p2, p3].map((p) => (st.enemies.some((e) => e.hostId === p.id) ? 'walker' : st.hazards.some((h) => h.hostId === p.id) ? 'spike' : 'leer'));
    assert.ok(plan.join() === 'walker,spike,walker' || plan.join() === 'spike,walker,spike', plan.join());
    const flyers = ofKind(st, 'flyer');
    assert.equal(flyers.length, 2);
    assert.ok(inGap(centerOf(flyers[0]), p1, p2) || inGap(centerOf(flyers[1]), p1, p2), 'ein Flieger über der zweiten Lücke');
    assert.ok(flyers.some((f) => inGap(centerOf(f), p3, exit)), 'ein Flieger über dem Abstieg');
    assert.notEqual(flyers[0].dir, flyers[1].dir);
  });
});

test('storm-corridor: zwei Blitze, Gegenwind über der Lücke hinter der Insel, dann Komet und Blitz, die Insel bleibt frei', () => {
  each('storm-corridor', (st) => {
    const [a, r1, island, r2, exit] = route(st);
    assert.deepEqual(kinds(st), ['ground', 'ground', 'cloud', 'ground', 'ground']);
    assert.equal(st.enemies.length, 0);
    const order = st.hazards.slice().sort((p, q) => p.x - q.x).map((h) => h.kind);
    assert.deepEqual(order, ['lightning', 'lightning', 'comet', 'lightning']);
    const [l1, l2, c1, l3] = st.hazards.slice().sort((p, q) => p.x - q.x);
    assert.ok(l1.x > r1.x && l2.x < r1.x + r1.w, 'beide Blitze auf der ersten Strecke');
    assert.ok(c1.x > r2.x && l3.x < r2.x + r2.w, 'Komet und Blitz auf der zweiten Strecke');
    assert.ok(l2.idleTime - l1.idleTime >= 0.4, 'die Blitze sind zeitlich versetzt');
    for (const h of st.hazards) assert.ok(h.x < island.x - 60 || h.x > island.x + island.w + 60, 'nichts schlägt auf der Insel ein');
    const wind = st.zones.filter((z) => z.kind === 'wind');
    assert.equal(wind.length, 1);
    assert.ok(wind[0].vx <= -70 && wind[0].vx >= -110, `Gegenwind ${wind[0].vx}`);
    assert.ok(wind[0].x < island.x + island.w && wind[0].x + wind[0].w > r2.x, 'der Wind weht über der Lücke hinter der Insel');
    assert.ok(wind[0].x > r1.x + r1.w, 'die erste Strecke liegt im Windschatten');
    assert.ok(a.w >= 200 && exit.w >= 140);
  });
});

test('blink-ice-maze: Eis und Blinkwolken wechseln sich ab, in der Mitte steht eine feste Insel zum Warten', () => {
  each('blink-ice-maze', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ice', 'blink', 'cloud', 'ice', 'blink', 'ground']);
    const [, i1, b1, isl, i2, b2] = route(st);
    assert.ok(i1.w >= 150 && i2.w >= 150, 'Eis ist breit genug zum Bremsen');
    assert.ok(isl.w >= 138 && isl.w <= 150);
    assert.ok(b1.w <= 106 && b2.w <= 106, 'Blinkwolken sind schmal');
    assert.equal(st.enemies.length + st.hazards.length, 0, 'die Schwierigkeit kommt allein aus Eis und Takt');
  });
});

test('hail-charger-gauntlet: zwei Inseln mit je einer Sturmwolke, Hagelwolken über der ersten und der letzten Lücke im Wechseltakt', () => {
  each('hail-charger-gauntlet', (st) => {
    const [a, m1, m2, exit] = route(st);
    assert.deepEqual(kinds(st), ['ground', 'cloud', 'cloud', 'ground']);
    const chargers = ofKind(st, 'charger');
    assert.equal(chargers.length, 2);
    assert.deepEqual(chargers.map((e) => hostOf(st, e)), [m1, m2]);
    for (const e of chargers) assert.ok(hostOf(st, e).w >= 310);
    assert.notEqual(chargers[0].dir, chargers[1].dir, 'die Sturmwolken blicken in entgegengesetzte Richtungen');
    const hails = ofKind(st, 'hailcloud');
    assert.equal(hails.length, 2);
    assert.ok(inGap(centerOf(hails[0]), a, m1) && inGap(centerOf(hails[1]), m2, exit), 'Hagel über der ersten und der letzten Lücke');
    assert.notEqual(hails[0].dir, hails[1].dir);
    assert.ok(Math.abs(wrap(hails[0].phase) - wrap(hails[1].phase)) >= 0.3, 'die Salven sind zeitlich versetzt');
  });
});

test('catapult-chain: drei Sprungwolken über drei Abgründe, Sterne zeichnen jede Flugbahn, Flieger über der zweiten und dritten', () => {
  each('catapult-chain', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'spring', 'cloud', 'spring', 'cloud', 'spring', 'ground']);
    const r = route(st);
    const flyers = ofKind(st, 'flyer');
    assert.equal(flyers.length, 2);
    assert.ok(inGap(centerOf(flyers[0]), r[3], r[4]) && inGap(centerOf(flyers[1]), r[5], r[6]), 'Flieger über der zweiten und dritten Flugbahn');
    assert.notEqual(flyers[0].dir, flyers[1].dir);
    // Vier Sterne je Flugbahn hängen zwischen der Sprungwolke und dem nächsten Knoten, höher als die Wolken
    for (const [sp, node] of [[r[1], r[2]], [r[3], r[4]], [r[5], r[6]]]) {
      const trail = st.stars.filter((s) => s.x > sp.x && s.x < node.x + 40 && s.y < sp.y - 40);
      assert.ok(trail.length >= 4, `Flugbahn mit nur ${trail.length} Sternen`);
    }
    // Die Sprungwolke wirft höher, als jeder Knoten über ihr liegt
    for (let i = 1; i < r.length; i += 2) assert.ok(r[i + 1].y >= r[i].y - 40 && r[i + 1].y <= r[i].y + 40);
  });
});

test('rainbow-dash-run: Regenbogen Dash am Anfang, drei Wolken mit Gegnern im Wechsel, zum Schluss eine Wiese voller Gewitterwolken', () => {
  each('rainbow-dash-run', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'cloud', 'cloud', 'cloud', 'ground']);
    const [a, p1, p2, p3, fin] = route(st);
    assert.equal(st.powerups[0].type, 'dash');
    assert.ok(st.powerups[0].x < a.x + a.w - 60, 'das Powerup liegt nicht am Rand der Einstiegsplattform');
    const plan = [p1, p2, p3].map((p) => (st.enemies.some((e) => e.hostId === p.id) ? 'walker' : st.hazards.some((h) => h.hostId === p.id) ? 'spike' : 'leer'));
    assert.ok(plan.join() === 'walker,spike,walker' || plan.join() === 'spike,walker,spike', plan.join());
    const finale = st.enemies.filter((e) => e.hostId === fin.id);
    assert.equal(finale.length, 3, 'drei Gewitterwolken im Finale');
    assert.ok(fin.w >= 500);
    finale.sort((p, q) => p.minX - q.minX);
    for (let i = 1; i < finale.length; i++) assert.ok(finale[i].minX - (finale[i - 1].maxX + finale[i - 1].w) <= 50, 'dicht an dicht');
  });
});

test('boss-arena: Sturmwolke, Gewitterwolke und Hüpfer wachen in getrennten Gassen, die Terrasse über der mittleren Gasse ist außer Sicht', () => {
  each('boss-arena', (st) => {
    const [, arena] = route(st);
    assert.deepEqual(kinds(st), ['ground', 'ground', 'ground']);
    assert.ok(arena.w >= 800);
    assert.deepEqual(st.enemies.map((e) => e.kind).sort(), ['charger', 'jumper', 'walker']);
    assert.ok(st.enemies.every((e) => e.hostId === arena.id));
    const lanes = st.enemies.slice().sort((p, q) => p.minX - q.minX);
    for (let i = 1; i < lanes.length; i++) assert.ok(lanes[i].minX - (lanes[i - 1].maxX + lanes[i - 1].w) >= 60, 'Gassen mit Platz dazwischen');
    const [terrace] = offRoute(st);
    assert.equal(offRoute(st).length, 1);
    assert.ok(terrace.y <= arena.y - 90, 'die Sturmwolke erkennt den Spieler dort oben nicht (Sichthöhe 70 px)');
    assert.ok(Math.abs(terrace.x + terrace.w / 2 - centerOf(lanes[1])) <= 40, 'die Terrasse liegt über der mittleren Gasse');
    assert.ok(terrace.w <= 224 && terrace.w >= 196);
    assert.ok(st.stars.filter((s) => s.x > terrace.x && s.x < terrace.x + terrace.w).length >= 4, 'Sternenschatz auf der Terrasse');
  });
});

test('slam-shaft: oben die Treppe über den Schacht, unten der Boden mit den Wächtern beidseits der höchsten Wolke, der Boden führt zum Ausstieg', () => {
  each('slam-shaft', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'cloud', 'cloud', 'cloud', 'ground']);
    const [a, p1, p2, p3, exit] = route(st);
    assert.ok(p1.y < a.y && p2.y < p1.y && p3.y > p2.y, 'die Treppe steigt, hält und fällt');
    const [low] = offRoute(st);
    assert.equal(offRoute(st).length, 1);
    assert.ok(low.ground && low.y - a.y === 66, 'Schachtboden 66 px unter der Starthöhe');
    assert.ok(low.x >= a.x + a.w && low.x + low.w <= exit.x, 'der Boden liegt im Schacht');
    assert.ok(exit.x - (low.x + low.w) <= 60, 'der Boden endet kurz vor dem Ausstieg');
    assert.ok(Math.abs(p1.y - p3.y) <= 12, 'erste und letzte Stufe sind etwa gleich hoch');
    // Wächter: Gewitterwolke, Hüpfer in der Mitte, Gewitterwolke, gleichmäßig um die Mitte der höchsten Wolke
    const guards = st.enemies.slice().sort((p, q) => p.minX - q.minX);
    assert.deepEqual(guards.map((e) => e.kind), ['walker', 'jumper', 'walker']);
    assert.ok(guards.every((e) => e.hostId === low.id));
    const mid = p2.x + p2.w / 2;
    assert.ok(Math.abs(centerOf(guards[1]) - mid) <= 2, 'der Hüpfer steht unter der Mitte der höchsten Wolke');
    assert.ok(Math.abs(centerOf(guards[0]) + centerOf(guards[2]) - 2 * mid) <= 2, 'die Gewitterwolken liegen symmetrisch');
    // Der Fall am Rand der höchsten Wolke (Mitte des Spielers 22 px neben der Kante) liegt in Reichweite einer Schockwelle (Radius 112)
    // der nahen Gewitterwolke und des Hüpfers
    for (const [near, far] of [[guards[0], guards[2]], [guards[2], guards[0]]]) {
      const edge = near === guards[0] ? p2.x - 22 : p2.x + p2.w + 22;
      assert.ok(Math.abs(near.minX + near.w / 2 - edge) <= 118 && Math.abs(near.maxX + near.w / 2 - edge) <= 118, 'die nahe Gewitterwolke liegt außerhalb der Schockwelle');
      const j = guards[1];
      assert.ok(Math.min(Math.abs(j.minX + j.w / 2 - edge), Math.abs(j.maxX + j.w / 2 - edge)) <= 112, 'der Hüpfer liegt außerhalb der Schockwelle');
      assert.ok(Math.abs(centerOf(far) - edge) > 112, 'die ferne Gewitterwolke bleibt für einen Stampfer oder Sprung übrig');
    }
    // Aus dem Schacht führt ein Sprung zurück: Anstieg 66 px und eine kurze Lücke
    assert.ok(Number.isFinite(hopRatio(low, exit)) && hopRatio(low, exit) <= 0.5, 'Klettern zum Ausstieg ist leicht');
    assert.equal(st.hazards.length, 0);
    // Die Hauptroute läuft nie durch den Schacht
    assert.ok(!route(st).includes(low));
  });
});

test('shuriken-gallery: Sprungwolke auf eine lange Wiese mit zwei Stachelwolken, darüber eine Reihe aus Fliegern und Hagelwolken', () => {
  each('shuriken-gallery', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'spring', 'ground', 'ground']);
    const [, , lane] = route(st);
    assert.ok(lane.w >= 760);
    const spikes = hazards(st, 'spike');
    assert.equal(spikes.length, 2);
    assert.ok(spikes.every((h) => h.hostId === lane.id));
    const row = [...ofKind(st, 'flyer'), ...ofKind(st, 'hailcloud')].sort((p, q) => centerOf(p) - centerOf(q));
    assert.equal(ofKind(st, 'flyer').length, 4);
    assert.equal(ofKind(st, 'hailcloud').length, 2);
    for (let i = 1; i < row.length; i++) {
      const step = centerOf(row[i]) - centerOf(row[i - 1]);
      assert.ok(step >= 104 && step <= 118, `Reihe mit Abstand ${Math.round(step)}`);
    }
    for (const e of row) {
      assert.ok(centerOf(e) > lane.x + 200 && centerOf(e) < lane.x + lane.w, 'die Reihe hängt über der Wiese');
      // Höhe: mindestens 165 px über der Lauflinie (normale Sprünge treffen nie), und doch in Reichweite eines Doppelsprungs
      const lift = lane.y - (e.baseY + e.h / 2);
      assert.ok(lift >= 165 + e.h / 2 && lift <= maxRise(true) + 30, `Reihe ${Math.round(lift)} px über der Wiese`);
    }
    assert.ok(st.stars.filter((s) => s.x > lane.x && s.x < lane.x + lane.w && s.y > lane.y - 60).length >= 6, 'Sterne am Boden laden die Wurfsterne');
  });
});

test('ice-hail-slide: drei Eiswolken mit einer festen Insel dazwischen, Hagelwolken über der zweiten Lücke und vor dem Ausstieg', () => {
  each('ice-hail-slide', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ice', 'ice', 'cloud', 'ice', 'ground']);
    const [, , i2, , , exit] = route(st);
    const [, i1, , isl] = route(st);
    assert.ok(isl.w >= 138 && isl.w <= 152);
    const hails = ofKind(st, 'hailcloud');
    assert.equal(hails.length, 2);
    assert.ok(inGap(centerOf(hails[0]), i1, i2), 'erste Salve zwischen den ersten beiden Eiswolken');
    assert.ok(centerOf(hails[1]) > st.route[4].x + st.route[4].w && centerOf(hails[1]) < exit.x, 'zweite Salve vor dem Ausstieg');
    assert.notEqual(hails[0].dir, hails[1].dir);
  });
});

test('ferry-hopper: zwei Fähren tragen über breite Lücken, die erste Insel bewacht ein Hüpfer, die zweite trägt eine Stachelwolke', () => {
  each('ferry-hopper', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'moving', 'cloud', 'moving', 'cloud', 'ground']);
    const [a, f1, i1, f2, i2, exit] = route(st);
    assert.equal(ofKind(st, 'jumper')[0].hostId, i1.id);
    assert.equal(hazards(st, 'spike')[0].hostId, i2.id);
    assert.equal(st.enemies.length + st.hazards.length, 2);
    for (const f of [f1, f2]) {
      assert.ok(f.ax >= 40 && f.ay === 0, 'die Fähren schwingen waagerecht');
      assert.ok(f.w >= 110 && f.w <= 122);
      assert.ok((Math.PI * 2) / f.omega >= 1.8 && (Math.PI * 2) / f.omega <= 3.6, `Umlauf ${(Math.PI * 2) / f.omega} s`);
    }
    // Wer wartet, kommt durch: jede Lücke ist nur in einem Teil des Takts überspringbar (mindestens ein Drittel, höchstens vier Fünftel)
    const safe = safeFor(byId['ferry-hopper'].diff);
    for (const [from, to] of [[a, f1], [f1, i1], [i1, f2], [f2, i2], [i2, exit]]) {
      if (from.kind !== 'moving' && to.kind !== 'moving') continue;
      const mover = from.kind === 'moving' ? from : to;
      const period = (Math.PI * 2) / mover.omega;
      let ok = 0;
      for (let k = 0; k < 40; k++) {
        const t = (period * k) / 40;
        if (hopRatio(platformAt(from, t), platformAt(to, t)) <= safe) ok++;
      }
      assert.ok(ok / 40 >= 0.3 && ok / 40 <= 0.85, `Lücke nach ${to.id} überspringbar in ${ok} von 40 Zeitpunkten`);
    }
  });
});

test('comet-hail-run: drei Kometen auf einer langen Wiese, eine Fluchtwolke zwischen dem ersten und zweiten, zwei Hagelwolken dahinter', () => {
  each('comet-hail-run', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ground', 'ground']);
    const [, run] = route(st);
    assert.ok(run.w >= 880);
    const comets = hazards(st, 'comet');
    assert.equal(comets.length, 3);
    for (let i = 1; i < 3; i++) assert.ok(comets[i].x - comets[i - 1].x >= 240);
    const [cover] = offRoute(st);
    assert.equal(offRoute(st).length, 1);
    assert.ok(cover.x > comets[0].x && cover.x + cover.w < comets[1].x + 60, 'die Fluchtwolke liegt zwischen den ersten beiden Einschlägen');
    assert.ok(run.y - cover.y >= 70 && run.y - cover.y <= 82, 'ein Sprung über der Wiese');
    const hails = ofKind(st, 'hailcloud');
    assert.equal(hails.length, 2);
    assert.ok(centerOf(hails[0]) > comets[1].x && centerOf(hails[1]) > comets[2].x, 'Hagel fächert zwischen und hinter den späteren Einschlägen');
    assert.notEqual(hails[0].dir, hails[1].dir);
    // Der Komet trifft nur sein Feld: die Zone der Hagelwolken liegt nicht im Einschlagfeld
    for (const h of hails) for (const c of comets) assert.ok(Math.abs(centerOf(h) - c.x) > COMET.RADIUS + (h.maxX - h.minX) / 2, 'Hagel und Komet überlagern sich');
  });
});

test('blink-flyer-rhythm: vier Blinkwolken in zwei Wellen um eine feste Insel mit Stachelwolke, zwei Risikosterne über Lücken, zwei Flieger', () => {
  each('blink-flyer-rhythm', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'blink', 'blink', 'cloud', 'blink', 'blink', 'ground']);
    const r = route(st);
    assert.equal(hazards(st, 'spike')[0].hostId, r[3].id);
    assert.equal(st.stars.filter((s) => s.falling).length, 2);
    const flyers = ofKind(st, 'flyer');
    assert.equal(flyers.length, 2);
    assert.ok(inGap(centerOf(flyers[0]), r[2], r[3]) && inGap(centerOf(flyers[1]), r[4], r[5]), 'Flieger über der Lücke zur Insel und über der letzten Kette');
    assert.notEqual(flyers[0].dir, flyers[1].dir);
    for (const p of r.filter((q) => q.kind === 'blink')) assert.ok(p.w <= 104 && p.w >= 90);
  });
});

test('spring-tower: die Sprungwolke wirft auf einen hohen Turm mit Sturmwolke und Powerup, die Hagelwolke wacht über dem Einstieg', () => {
  each('spring-tower', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'spring', 'cloud', 'ground']);
    const [a, spring, tower, exit] = route(st);
    assert.ok(a.y - tower.y >= 138 && a.y - tower.y <= 150, 'der Turm ist höher als jeder einfache Sprung');
    assert.ok(a.y - tower.y > maxRise(), 'ohne Sprungwolke braucht der Aufstieg den Doppelsprung');
    assert.ok(tower.w >= 316);
    const c = ofKind(st, 'charger')[0];
    assert.equal(c.hostId, tower.id);
    assert.equal(st.powerups[0].y < tower.y && st.powerups[0].x > c.maxX + c.w, true, 'das Powerup liegt hinter der Sturmwolke');
    const h = ofKind(st, 'hailcloud')[0];
    assert.ok(Math.abs(centerOf(h) - (a.x + a.w)) <= 40, 'Hagelwolke über dem rechten Ende des Einstiegs');
    assert.ok(centerOf(h) < spring.x - 20, 'die Salve fällt vor der Sprungwolke');
    assert.ok(exit.y > tower.y, 'der Abstieg führt vom Turm zurück');
  });
});

test('thunder-rain-run: drei Blitze auf einer nassen Wiese, zwischen dem ersten und zweiten wacht eine Sturmwolke, darüber eine Terrasse', () => {
  each('thunder-rain-run', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ground', 'ground']);
    const [, run] = route(st);
    const bolts = hazards(st, 'lightning');
    assert.equal(bolts.length, 3);
    const c = ofKind(st, 'charger')[0];
    assert.ok(c.minX > bolts[0].x + 40 && c.maxX + c.w < bolts[1].x - 40, 'die Sturmwolke wacht zwischen dem ersten und zweiten Blitz');
    assert.ok(bolts[1].idleTime - bolts[0].idleTime >= 0.7, 'die Blitze schlagen versetzt ein');
    assert.ok(bolts[0].x - run.x >= 230, 'vor dem ersten Blitz bleibt Platz zum Bremsen');
    const rain = st.zones.filter((z) => z.kind === 'rain');
    assert.equal(rain.length, 2);
    assert.ok(Math.min(...rain.map((z) => z.x)) - run.x >= 170, 'die Landezone ist trocken');
    for (const z of rain) assert.ok(z.x >= run.x && z.x + z.w <= run.x + run.w - 40, 'Regen fällt nur auf die Wiese und endet vor dem Absprung');
    const [terrace] = offRoute(st);
    assert.equal(offRoute(st).length, 1);
    assert.ok(run.y - terrace.y >= 90 && Math.abs(terrace.x + terrace.w / 2 - centerOf(c)) <= 30, 'die Terrasse liegt außer Sicht über der Sturmwolke');
    assert.ok(terrace.w <= 124);
  });
});

test('ice-storm: drei Eiswolken unter kräftigem Gegenwind, auf der mittleren schlägt ein Blitz ein', () => {
  each('ice-storm', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ice', 'ice', 'ice', 'ground']);
    const [a, i1, i2, i3, exit] = route(st);
    assert.equal(st.enemies.length, 0);
    const bolt = hazards(st, 'lightning');
    assert.equal(bolt.length, 1);
    assert.ok(bolt[0].x > i2.x + 30 && bolt[0].x < i2.x + i2.w - 30, 'der Blitz trifft die mittlere Eiswolke');
    assert.ok(i2.w > i1.w && i2.w > i3.w, 'die mittlere Eiswolke ist die längste');
    const wind = st.zones.filter((z) => z.kind === 'wind');
    assert.equal(wind.length, 1);
    assert.ok(wind[0].vx <= -88 && wind[0].vx >= -120, `Gegenwind ${wind[0].vx}`);
    assert.ok(wind[0].x < a.x + a.w && wind[0].x + wind[0].w > exit.x, 'der Wind weht über der ganzen Kette');
  });
});

test('crumble-hail-bridge: vier brüchige Wolken um eine feste Insel, Hagelwolke über deren linker Hälfte, ein Risikostern über der Lücke', () => {
  each('crumble-hail-bridge', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'breakable', 'breakable', 'cloud', 'breakable', 'breakable', 'ground']);
    const island = route(st)[3];
    for (const p of route(st).filter((q) => q.kind === 'breakable')) assert.ok(p.w >= 92 && p.w <= 110);
    const h = ofKind(st, 'hailcloud')[0];
    assert.ok(centerOf(h) >= island.x && centerOf(h) <= island.x + island.w * 0.5, 'Hagel fällt auf die linke Hälfte der Insel');
    assert.equal(st.stars.filter((s) => s.falling).length, 1);
    assert.ok(island.w >= 178 && island.w <= 190, 'rechts bleibt eine sichere Ecke');
  });
});

test('abyss-sprint: fünf schmale Wolken, die breiten Lücken brauchen den Doppelsprung und tragen Risikosterne, die kurzen sind bewacht', () => {
  each('abyss-sprint', (st) => {
    const r = route(st);
    assert.deepEqual(kinds(st), ['ground', 'cloud', 'cloud', 'cloud', 'cloud', 'cloud', 'ground']);
    for (const p of r.slice(1, -1)) assert.ok(p.w >= 84 && p.w <= 98, `Wolke ${p.w} px`);
    assert.equal(st.enemies.filter((e) => e.kind !== 'flyer').length + st.hazards.length, 0, 'keine Gegner am Boden');
    const all = hops(st);
    const wide = all.filter(([p, q]) => hopRatio(p, q, { wind: 0 }) > 1);
    assert.equal(wide.length, 2, 'zwei breite Lücken brauchen den Doppelsprung');
    for (const [p, q] of wide) {
      assert.ok(hopRatio(p, q, { wind: 0 }) >= 1.1, 'deutlich über der Reichweite eines einfachen Sprungs');
      assert.ok(hopRatio(p, q, { dbl: true, wind: 0 }) <= safeFor(9) - 0.15, 'mit dem Doppelsprung mit Luft zum Limit');
      assert.ok(q.y >= p.y, 'breite Lücken liegen waagerecht oder abwärts');
      const risk = st.stars.filter((s) => s.falling && s.x > right(p) && s.x < left(q));
      assert.equal(risk.length, 1, 'ein Risikostern pro breiter Lücke');
    }
    const short = all.filter((h) => !wide.includes(h)).filter(([, q]) => q !== r[r.length - 1]);
    assert.ok(short.length >= 3);
    for (const [p, q] of short) assert.ok(hopRatio(p, q, { wind: 0 }) >= 0.45 && hopRatio(p, q, { wind: 0 }) <= 0.9, `kurzer Sprung mit Verhältnis ${hopRatio(p, q, { wind: 0 }).toFixed(2)}`);
    const flyers = ofKind(st, 'flyer');
    assert.equal(flyers.length, 2);
    assert.notEqual(flyers[0].dir, flyers[1].dir);
    for (const f of flyers) assert.ok(all.some((h) => !wide.includes(h) && inGap(centerOf(f), h[0], h[1])), 'Flieger nur über kurzen Lücken');
  });
});

test('dream-fortress: Hof mit Stachelwolke unter einer Hagelwolke, Sprungwolke auf den Turm mit Sturmwolke und Powerup, zweiter Hof mit zwei Gewitterwolken', () => {
  each('dream-fortress', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ground', 'spring', 'cloud', 'ground']);
    const [, court1, , tower, court2] = route(st);
    assert.equal(hazards(st, 'spike')[0].hostId, court1.id);
    assert.equal(ofKind(st, 'charger')[0].hostId, tower.id);
    assert.equal(st.powerups.length, 1);
    const walkers = ofKind(st, 'walker');
    assert.equal(walkers.length, 2);
    assert.ok(walkers.every((w) => w.hostId === court2.id));
    const h = ofKind(st, 'hailcloud')[0];
    assert.ok(centerOf(h) > court1.x + court1.w * 0.6 && centerOf(h) < court1.x + court1.w + 20, 'Hagelwolke über dem hinteren Hof');
    assert.ok(court1.y - tower.y >= 130, 'der Turm hängt hoch');
    assert.ok(court2.y > tower.y, 'der Abstieg führt in den zweiten Hof');
    assert.ok(court1.w >= 344 && court2.w >= 396);
  });
});

test('storm-crown: Komet, Sturmwolke, Blitz, Gewitterwolke und Komet in einer Reihe, getrennte Zonen, Terrasse über der Sturmwolke', () => {
  each('storm-crown', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'ground', 'ground']);
    const [, arena] = route(st);
    assert.ok(arena.w >= 880);
    const c = ofKind(st, 'charger')[0];
    const w = ofKind(st, 'walker')[0];
    const [c1, l1, c2] = [...hazards(st, 'comet'), ...hazards(st, 'lightning')].sort((p, q) => p.x - q.x).map((h) => h);
    assert.deepEqual([c1.kind, l1.kind, c2.kind], ['comet', 'lightning', 'comet']);
    assert.ok(c1.x < c.minX && c.maxX + c.w < l1.x && l1.x < w.minX && w.maxX + w.w < c2.x, 'die Zonen reihen sich ohne Überlappung');
    assert.equal(st.hazards.length, 3);
    const [terrace] = offRoute(st);
    assert.equal(offRoute(st).length, 1);
    assert.ok(arena.y - terrace.y >= 90 && Math.abs(terrace.x + terrace.w / 2 - centerOf(c)) <= 30, 'die Terrasse liegt über der Sturmwolke');
    assert.ok(c2.idleTime - c1.idleTime >= 0.2 && l1.idleTime - c1.idleTime >= 0.6, 'die Einschläge folgen zeitlich nacheinander');
  });
});

test('twin-catapult: Sprungwolke auf eine hohe Blinkwolke, eine zweite Blinkwolke im Takt dahinter, ein Flieger über der Lücke', () => {
  each('twin-catapult', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'spring', 'blink', 'blink', 'ground']);
    const [a, , b1, b2, exit] = route(st);
    assert.ok(a.y - b1.y >= 100 && a.y - b1.y <= 114, 'die erste Blinkwolke hängt hoch');
    assert.ok(a.y - b1.y <= SPRING.SPEED ** 2 / (2 * PHYS.GRAVITY), 'die Sprungwolke reicht hoch genug');
    assert.ok(Math.abs(b2.y - b1.y) <= 14);
    assert.ok(exit.y > b2.y);
    const f = ofKind(st, 'flyer')[0];
    assert.ok(inGap(centerOf(f), b1, b2), 'Flieger über der Lücke zwischen den Blinkwolken');
    assert.equal(st.enemies.length + st.hazards.length, 1);
  });
});

test('floating-gardens: drei schwingende Wolken, die mittlere hebt und senkt sich, Flieger über der ersten Lücke, Hagel über der zweiten', () => {
  each('floating-gardens', (st) => {
    assert.deepEqual(kinds(st), ['ground', 'moving', 'moving', 'moving', 'ground']);
    const [, m1, m2, m3] = route(st);
    assert.ok(m1.ax >= 44 && m1.ay === 0 && m3.ax >= 44 && m3.ay === 0, 'die äußeren Wolken schwingen waagerecht');
    assert.ok(m2.ax === 0 && m2.ay >= 30 && m2.ay <= 40, 'die mittlere hebt und senkt sich');
    for (const m of [m1, m2, m3]) assert.ok((Math.PI * 2) / m.omega >= 1.8 && m.w >= 100 && m.w <= 118, `Wolke ${m.w} px, Umlauf ${(Math.PI * 2) / m.omega} s`);
    const f = ofKind(st, 'flyer')[0];
    const h = ofKind(st, 'hailcloud')[0];
    assert.ok(centerOf(f) > right(m1) - 60 && centerOf(f) < left(m2) + 60, 'Flieger über der Lücke zwischen der ersten und zweiten Wolke');
    assert.ok(centerOf(h) > right(m2) - 60 && centerOf(h) < left(m3) + 60, 'Hagel über der Lücke zwischen der zweiten und dritten Wolke');
  });
});

// ---------- Physik: Sprungwolke und Katapult ----------

const IDLE = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, slamPressed: false, throwPressed: false, downHeld: false };

function simStep(s, input) {
  s.t += STEP;
  updatePlatforms(s, STEP);
  updateObstacles(s, STEP);
  updateEnemies(s, STEP);
  updatePlayer(s, input, STEP);
  updateShots(s, STEP);
  playerVsEnemies(s);
  playerVsHazards(s);
  updateCollectibles(s, STEP);
  s.camX = Math.max(s.camX, s.player.x - 300);
  s.particles.length = 0;
  s.popups.length = 0;
}

// Baut den Chunk bei ox = 200, oy = 330 in einen frischen Zustand
function setup(chunk, seed, { diff = chunk.diff, meter = chunk.min, enemies = true, t0 = 0 } = {}) {
  const s = createState({ seed });
  seedRng(s, seed);
  const b = createBuilder(s, { ox: 200, oy: 330, diff, meter, mechs: mechsAt(meter), gateIndex: 1 });
  chunk.build(b);
  const st = b.st;
  Object.assign(s, { platforms: st.platforms, enemies: enemies ? st.enemies : [], hazards: st.hazards, zones: st.zones, stars: st.stars, powerups: st.powerups });
  s.t = t0;
  return { s, st };
}

const putOn = (s, plat, dx = 30) => {
  Object.assign(s.player, { x: plat.x + dx, y: plat.y - s.player.h, onGround: true, groundId: plat.id, vx: 0, vy: 0 });
  s.camX = s.player.x - 300;
};

test('catapult-chain mit der echten Physik: eine Sprungwolke trägt den Spieler hoch und über den Abgrund auf den nächsten Knoten', () => {
  const c = byId['catapult-chain'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { s, st } = setup(c, seed, { enemies: false });
    const [a, sp, node] = route(st);
    putOn(s, a, 20);
    let launched = false;
    let landed = false;
    for (let i = 0; i < 300 && !landed; i++) {
      const p = s.player;
      // Anlauf, Sprung 190 px vor der Mitte der Sprungwolke (ein Sprung trägt 215 px weit und landet von oben darauf), danach nur nach rechts halten
      const jump = !launched && p.onGround && p.groundId === a.id && p.x + p.w / 2 >= sp.x + sp.w / 2 - 190;
      simStep(s, { ...IDLE, move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0) });
      if (sp.press > 0) launched = true;
      assert.ok(p.y < H + 40, `Seed ${seed}: abgestürzt`);
      if (launched && p.onGround && p.groundId === node.id) landed = true;
    }
    assert.ok(launched && landed, `Seed ${seed}: Flug endet nicht auf dem Knoten (gestartet ${launched})`);
  }
});

test('spring-tower mit der echten Physik: von der Sprungwolke aus erreicht der Spieler den Turm, der einfache Sprung vom Einstieg nicht', () => {
  const c = byId['spring-tower'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { s, st } = setup(c, seed, { enemies: false });
    const [a, sp, tower] = route(st);
    putOn(s, a, 20);
    let launched = false;
    let up = false;
    for (let i = 0; i < 300 && !up; i++) {
      const p = s.player;
      const jump = !launched && p.onGround && p.groundId === a.id && p.x + p.w / 2 >= sp.x + sp.w / 2 - 190;
      simStep(s, { ...IDLE, move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0) });
      if (sp.press > 0) launched = true;
      assert.ok(p.y < H + 40, `Seed ${seed}: abgestürzt`);
      if (launched && p.onGround && p.groundId === tower.id) up = true;
    }
    assert.ok(up, `Seed ${seed}: die Sprungwolke trägt nicht auf den Turm`);
  }
  // Kontrolle: ohne Sprungwolke bleibt der Turm für einen einfachen Sprung unerreichbar
  const { st } = setup(c, 1, { enemies: false });
  assert.equal(hopRatio(route(st)[0], route(st)[2]), Infinity);
});

// ---------- Physik: Fähigkeiten als Abkürzung ----------

// Sturzflug im Schacht: vom Rand der höchsten Wolke abspringen (side -1 links, 1 rechts), im Fallen stampfen.
// Gibt die Zahl der besiegten Wächter und der Treffer zurück.
function dropIntoShaft(seed, side, slam = true) {
  const { s, st } = setup(byId['slam-shaft'], seed);
  const top = route(st)[2];
  const [low] = offRoute(st);
  putOn(s, top, side < 0 ? 4 : top.w - s.player.w - 4);
  s.player.face = side;
  let slammed = false;
  let landed = false;
  for (let i = 0; i < 160 && !landed; i++) {
    const p = s.player;
    const doSlam = slam && !slammed && !p.onGround && i > 2 && p.y > top.y - p.h - 20;
    if (doSlam) slammed = true;
    simStep(s, { ...IDLE, move: p.onGround || p.y < top.y ? side : 0, slamPressed: doSlam });
    if (p.onGround && p.groundId === low.id && i > 5) landed = true;
    assert.ok(p.y < H + 40, `Seed ${seed} Seite ${side}: abgestürzt`);
  }
  return { hits: s.run.hits, kills: s.run.kills, slammed, landed };
}

test('slam-shaft mit der echten Physik: der Sturzflug neben der höchsten Wolke besiegt die Wächter in Reichweite, ohne den Spieler zu verletzen', () => {
  let total = 0;
  let runs = 0;
  for (const side of [-1, 1]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = dropIntoShaft(seed, side);
      assert.ok(r.slammed && r.landed, `Seed ${seed} Seite ${side}: Sturzflug nicht ausgeführt`);
      assert.equal(r.hits, 0, `Seed ${seed} Seite ${side}: getroffen`);
      assert.ok(r.kills >= 1, `Seed ${seed} Seite ${side}: kein Wächter besiegt`);
      total += r.kills;
      runs++;
    }
  }
  assert.ok(total / runs >= 1.8, `im Mittel nur ${(total / runs).toFixed(2)} von 3 Wächtern besiegt`);
});

test('slam-shaft ohne Stampfen: wer neben der höchsten Wolke hinunterfällt, landet im Schacht vor den Wächtern und wird oft getroffen (Kontrolle)', () => {
  // Der Schacht ist das Risiko, die Hauptroute oben die sichere Wahl. Ohne Sturzflug bleiben alle Wächter am Leben.
  let alive = 0;
  for (const side of [-1, 1]) {
    for (const seed of [1, 2, 3, 4]) {
      const r = dropIntoShaft(seed, side, false);
      assert.ok(r.landed);
      alive += 3 - r.kills;
    }
  }
  assert.ok(alive >= 20, `ohne Stampfen überleben nur ${alive} von 24 Wächtern`);
});

test('rainbow-dash-run mit der echten Physik: das Regenbogen Dash liegt auf dem Weg, und sein Dash fegt durch die ersten Gewitterwolken des Finales', () => {
  const c = byId['rainbow-dash-run'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    // Wer den Einstieg entlang läuft, sammelt das Dash ein, ohne zu springen
    {
      const { s, st } = setup(c, seed);
      putOn(s, route(st)[0], 20);
      for (let i = 0; i < 60 && s.player.power.dashT <= 0; i++) simStep(s, { ...IDLE, move: 1 });
      assert.ok(s.player.power.dashT > 0, `Seed ${seed}: das Dash wird beim Laufen nicht eingesammelt`);
    }
    // Der Dash beginnt vor der ersten Gewitterwolke des Finales: er besiegt sie, und der Spieler bleibt dabei unverwundbar
    const { s, st } = setup(c, seed);
    const fin = route(st)[4];
    const first = st.enemies.filter((e) => e.hostId === fin.id).sort((p, q) => p.minX - q.minX)[0];
    putOn(s, fin, first.minX - fin.x - 70);
    s.player.power.dashT = 8;
    s.player.face = 1;
    for (let i = 0; i < 14; i++) simStep(s, { ...IDLE, move: 1, dashPressed: i === 0 });
    assert.equal(s.run.hits, 0, `Seed ${seed}: im Dash getroffen`);
    assert.ok(s.run.kills >= 1 && s.run.kills <= 2, `Seed ${seed}: ${s.run.kills} Gewitterwolken im Dash besiegt`);
  }
});

test('shuriken-gallery mit der echten Physik: aus dem Doppelsprung holt jeder Sprung bis zu zwei Wolken der Reihe herunter', () => {
  const c = byId['shuriken-gallery'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { s, st } = setup(c, seed);
    const lane = route(st)[2];
    putOn(s, lane, 70);
    s.player.ammo = 3;
    s.player.face = 1;
    let thrown = 0;
    for (let i = 0; i < 100; i++) {
      const p = s.player;
      simStep(s, { ...IDLE, jumpPressed: i === 0 || i === 22, jumpHeld: i < 52 });
      // Geworfen wird, solange die Füße 158 bis 214 px über der Wiese sind (dort liegt der Spieler auf Höhe der Reihe)
      const h = lane.y - (p.y + p.h);
      if (!p.onGround && h >= 158 && h <= 214 && fireShot(s)) thrown++;
      assert.equal(s.run.hits, 0, `Seed ${seed}: getroffen von ${s.deathCause ? s.deathCause.label : '?'}`);
    }
    assert.equal(thrown, 2, `Seed ${seed}: ${thrown} Würfe im Fenster`);
    assert.equal(s.run.kills, 2, `Seed ${seed}: ${s.run.kills} Wolken besiegt`);
    assert.ok(s.run.bestCombo >= 2 || s.combo.count >= 2, `Seed ${seed}: keine Combo`);
  }
  // Kontrolle: ein einfacher Sprung reicht nicht an die Reihe heran, auch nicht beim Werfen
  const { s, st } = setup(c, 1);
  const lane = route(st)[2];
  putOn(s, lane, 70);
  s.player.ammo = 3;
  for (let i = 0; i < 80; i++) {
    simStep(s, { ...IDLE, jumpPressed: i === 0, jumpHeld: i < 40 });
    if (!s.player.onGround) fireShot(s);
  }
  assert.equal(s.run.kills, 0, 'vom einfachen Sprung aus trifft kein Wurfstern die Reihe');
});

// ---------- Physik: Spielbarkeit ----------
// Zwei Läufer mit der echten Physik, die nur Springen und Doppelsprung nutzen.
// 1. Ein Vorausschau Bot (wie in tests/chunks-advanced.test.mjs) probiert alle 0,1 s Eingabeskripte auf einer Kopie des
//    Zustands und bleibt bei jedem Treffer oder Sturz hängen. Ein Sprung zählt erst, wenn er gelandet ist und der Spieler dort
//    stehen bleiben kann (nach der Landung bremst er). Das fängt Gegnerwege, Blitzzeiten, Stachelwolken, Regen, Wind,
//    Hagel, Eis, Blinkwolken und bewegliche Plattformen ab. Er gleitet nie und nutzt weder Stampfen noch Wurfstern noch Dash.
// 2. Der Orakel Läufer geht die Route Plattform für Plattform ab und springt erst, wenn eine Kopie des Zustands
//    zeigt, dass der Sprung sicher auf der nächsten Plattform endet. Er prüft die Ketten ohne Gegner, wo
//    der richtige Zeitpunkt zählt, und beginnt zu allen Zeiten im Takt.

// Die Sprungtaste wird nur im Aufstieg gehalten, nie zum Gleiten: die Hauptroute braucht nur Springen und Doppelsprung
const holdRising = (i, c, jf, dbl) => i >= jf && i < jf + 44 && (i < jf + 2 || (dbl >= 0 && i >= jf + dbl && i < jf + dbl + 2) || c.player.vy < 0);

const SCRIPTS = [{ f: () => ({ ...IDLE, move: 1 }) }, { f: () => IDLE }];
// Rennen und springen: nach jf Schritten springen, optional dbl Schritte später ein zweites Mal
for (const jf of [0, 4, 9, 15, 22, 30, 40, 48]) {
  for (const dbl of [-1, 20, 32]) {
    for (const move of jf === 0 ? [1, 0] : [1]) {
      SCRIPTS.push({ f: (i, c) => ({ ...IDLE, move, jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1), jumpHeld: holdRising(i, c, jf, dbl) }) });
    }
  }
}

// Nach der Landung bremst der Bot und bleibt stehen, in der Vorausschau und im Lauf gleichermaßen
const BRAKE = { f: (i, c) => ({ ...IDLE, move: c.player.vx > 60 ? -1 : c.player.vx < -60 ? 1 : 0 }) };
// Stehen bleiben, springen und erst dann losrennen (nötig, wenn man dicht vor einem Gegner steht)
for (const jf of [0, 10, 24, 40]) {
  for (const dbl of [-1, 26]) SCRIPTS.push({ f: (i, c) => ({ ...IDLE, move: i >= jf + 4 ? 1 : 0, jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1), jumpHeld: holdRising(i, c, jf, dbl) }) });
}
// Ein paar Schritte zur Seite rücken und dann bremsen (um einer Salve oder einem Einschlag auszuweichen)
for (const dir of [1, -1]) for (const n of [4, 9, 16, 24]) SCRIPTS.push({ f: (i, c) => (i < n ? { ...IDLE, move: dir } : BRAKE.f(i, c)) });

const lowestSurface = (s) => Math.max(...s.platforms.map((p) => (p.kind === 'moving' ? p.oy + Math.abs(p.ay) : p.y)));

function lookahead(s, script, goalX) {
  const c = structuredClone(s);
  const lowY = Math.min(H + 30, lowestSurface(c) + 70);
  const lives0 = c.lives;
  const hits0 = c.run.hits;
  let steps = 0;
  let fell = false;
  let air = !c.player.onGround;
  let landed = -1;
  // Vorausschau: mindestens 1,1 s, bei einem Flug bis zur Landung. Nach der Landung bremst der Spieler und bleibt stehen
  // (0,6 s lang), denn ein Sprung auf eine schmale Wolke zählt nur, wenn man dort auch bleiben kann.
  for (; steps < 170; steps++) {
    simStep(c, landed >= 0 ? BRAKE.f(steps, c) : script.f(steps, c));
    if (c.player.y > lowY) { fell = true; break; }
    if (c.lives < lives0 || c.run.hits > hits0) break;
    if (!c.player.onGround) air = true;
    else if (air && steps > 4 && landed < 0) { landed = steps; air = false; }
    if (landed >= 0 && steps >= landed + 36) break;
    if (landed < 0 && steps >= 65 && !air) break;
  }
  const damage = fell || c.lives < lives0 || c.run.hits > hits0;
  return { damage, steps, score: Math.min(c.player.x, goalX) - s.player.x - (damage ? 2000 - steps * 10 : 0) };
}

// Gibt null zurück, wenn der Bot das Ziel erreicht, sonst eine Beschreibung des Scheiterns.
// from: Plattform, auf der der Bot beginnt (Standard: der Einstieg), dx: Abstand zu deren linker Kante.
function playThrough(chunk, seed, { diff = chunk.diff, meter = chunk.min, t0 = 0, from = null, dx = 30 } = {}) {
  const { s, st } = setup(chunk, seed, { diff, meter, t0 });
  const ox = 200;
  const start = from ? from(st) : st.route[0];
  const last = st.route[st.route.length - 1];
  // Hinter dem Ausstieg liegt die nächste breite Plattform, wie im echten Spiel
  const goal = createStaticPlatform(s, last.x + last.w, last.y, 3000, { ground: true });
  s.platforms = [...st.platforms, goal];
  Object.assign(s.player, { x: start.x + dx, y: start.y - s.player.h, onGround: true, groundId: start.id });
  s.camX = s.player.x - 300;
  let current = SCRIPTS[0];
  let begin = 0;
  let prevAir = false;
  for (let k = 0; k < 60 * 45; k++) {
    if (k % 6 === 0) {
      if (lookahead(s, SCRIPTS[0], goal.x).damage) {
        // Der bisherige Plan läuft als Kandidat weiter und gewinnt bei Gleichstand, damit ein guter Sprung nicht mitten im Flug verworfen wird
        const offset = k - begin;
        const prev = current;
        const keep = { f: (i, c) => prev.f(i + offset, c) };
        let best = null;
        for (const sc of [keep, ...SCRIPTS]) {
          const r = lookahead(s, sc, goal.x);
          if (sc === keep) r.score += 1;
          if (!best || r.score > best.r.score) best = { sc, r };
        }
        current = best.sc;
        begin = k;
        if (best.sc === keep) { current = prev; begin = k - offset; }
      } else {
        current = SCRIPTS[0];
        begin = k;
      }
    }
    const lives0 = s.lives;
    const hits0 = s.run.hits;
    if (s.player.onGround && prevAir) { current = BRAKE; begin = k; }
    prevAir = !s.player.onGround;
    simStep(s, current.f(k - begin, s));
    const where = Math.round(s.player.x - ox);
    if (s.lives < lives0 || s.run.hits > hits0) return `Treffer bei x ${where}: ${s.deathCause ? s.deathCause.label : '?'}`;
    if (s.player.y > H + 60) return `gestürzt bei x ${where}`;
    if (s.player.onGround && s.player.groundId === goal.id && s.player.x >= goal.x + 60) return null;
  }
  return 'Ziel nicht rechtzeitig erreicht';
}

// Chunks, in denen der Zeitpunkt zählt (Blinkwolken, Fähren, schwingende Wolken): der Bot beginnt zu mehreren Zeiten im Takt
const TIMED = ['blink-ice-maze', 'blink-flyer-rhythm', 'twin-catapult', 'ferry-hopper', 'floating-gardens'];

test('Spielbarkeit: der Test Bot kommt durch jeden Chunk, ohne getroffen zu werden oder zu stürzen', () => {
  for (const c of NIGHTMARE.filter((x) => !TIMED.includes(x.id))) {
    for (const seed of [1, 2, 3]) assert.equal(playThrough(c, seed), null, `${c.id} Seed ${seed}`);
  }
});

test('Spielbarkeit: auch spät im Spiel und bei Schwierigkeit 9,5, wenn die Lücken länger werden', () => {
  for (const c of NIGHTMARE.filter((x) => !TIMED.includes(x.id))) {
    assert.equal(playThrough(c, 4, { meter: c.min + 1500 }), null, `${c.id} Seed 4 +1500 m`);
    assert.equal(playThrough(c, 5, { diff: 9.5 }), null, `${c.id} Seed 5 Schwierigkeit 9,5`);
  }
});

test('Spielbarkeit mit Takt: der Test Bot besteht Blinkwolken, Fähren und schwingende Wolken zu jedem Zeitpunkt im Takt', () => {
  for (const id of TIMED) {
    for (const seed of [1, 2, 3]) {
      for (const t0 of [0, 1.3, 2.6]) assert.equal(playThrough(byId[id], seed, { t0 }), null, `${id} Seed ${seed} Start ${t0}`);
    }
    assert.equal(playThrough(byId[id], 4, { t0: 0.7, diff: 9.5 }), null, `${id} Seed 4 Schwierigkeit 9,5`);
  }
});

test('slam-shaft: wer in den Schacht fällt, kommt über den Boden wieder zum Ausstieg', () => {
  const lowOf = (st) => offRoute(st)[0];
  for (const seed of [1, 2, 3, 4]) {
    // Der Spieler beginnt hinter den Wächtern am rechten Ende des Bodens, wie nach einem Sturz hinter sie oder nach dem Stampfen
    assert.equal(playThrough(byId['slam-shaft'], seed, { from: lowOf, dx: lowOf(setup(byId['slam-shaft'], seed).st).w - 120 }), null, `Seed ${seed}`);
  }
});

test('catapult-chain mit einem blinden Läufer: wer die Flieger nicht beachtet, wird höchstens in der Hälfte der Läufe getroffen', () => {
  // Der blinde Läufer springt vor jeder Sprungwolke ab, hält nach rechts und schaut nie nach den Fliegern.
  const c = byId['catapult-chain'];
  let hit = 0;
  let runs = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const t0 of [0, 0.7, 1.4, 2.1]) {
      const { s, st } = setup(c, seed, { enemies: true, t0 });
      const r = route(st);
      putOn(s, r[0], 20);
      let at = 1;
      let launched = false;
      for (let i = 0; i < 60 * 14 && at < r.length - 1 && s.run.hits === 0 && s.player.y < H + 40; i++) {
        const p = s.player;
        const sp = r[at];
        const jump = !launched && p.onGround && p.groundId === r[at - 1].id && p.x + p.w / 2 >= sp.x + sp.w / 2 - 190;
        simStep(s, { ...IDLE, move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0) });
        if (sp.press > 0) launched = true;
        if (launched && p.onGround && p.groundId === r[at + 1].id) { at += 2; launched = false; }
      }
      runs++;
      if (s.run.hits > 0) hit++;
    }
  }
  assert.ok(hit <= runs / 2, `${hit} von ${runs} blinden Läufen enden mit einem Treffer`);
  assert.ok(hit >= 1, 'die Flieger sind gefährlich: kein einziger blinder Lauf wurde getroffen');
});

test('Spielbarkeit: der Bot scheitert zu Recht an unmöglichen Chunks (Kontrolle)', () => {
  const gapTooWide = { build(bd) { const a = bd.ground(0, 0, 240); bd.route(a, bd.ground(a.w + 520, 0, 240)); } };
  const spikeWall = { build(bd) { const a = bd.ground(0, 0, 900); for (let i = 0; i < 10; i++) bd.spike(a, 0.3 + i * 0.045); bd.route(a); } };
  for (const c of [gapTooWide, spikeWall]) assert.notEqual(playThrough({ ...c, diff: 8, min: 2300 }, 1), null);
  // Eine Blinkwolke, die kaum fest ist, ist nie sicher, und die Lücken sind zu breit, um sie zu überspringen
  const never = { build(bd) { const a = bd.ground(0, 0, 240); const z = bd.blink(a.w + 200, 0, 100, { period: 4, on: 0.04 }); bd.route(a, z, bd.ground(a.w + 500, 0, 240)); } };
  assert.notEqual(playThrough({ ...never, diff: 8, min: 2300 }, 1), null, 'der Bot kommt nicht über eine Blinkwolke, die kaum fest ist');
  // Kontrolle der Kontrolle: dieselbe Kette mit einer Blinkwolke, die lange fest ist, besteht der Bot
  const fair = { build(bd) { const a = bd.ground(0, 0, 240); const z = bd.blink(a.w + 200, 0, 100, { period: 4, on: 0.62 }); bd.route(a, z, bd.ground(a.w + 500, 0, 240)); } };
  assert.equal(playThrough({ ...fair, diff: 8, min: 2300 }, 1), null);
});
