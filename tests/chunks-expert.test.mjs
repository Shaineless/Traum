// Tests für die Chunk Layouts der späten Phase (game/chunks/expert.js, Schwierigkeit 5 bis 7).
// Die allgemeine Fairness Prüfung (Sprünge, sicherer Anfang, Host Plattformen) steckt in tests/chunks.test.mjs.
// Hier steht, was für diese Layouts zusätzlich gilt: Lernziele, Mechanik Tags, Variation, Sonderfälle der neuen
// Mechaniken (Sprungwolke, Eis, Blinkwolke, Komet, Hagelwolke) und, mit der echten Physik, ob die Layouts so spielbar
// sind, wie ihre Kommentare behaupten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS } from '../game/chunks/index.js';
import { EXPERT } from '../game/chunks/expert.js';
import { COMET, H, LIMITS, PHYS, SPRING, STEP, Y_MAX, Y_MIN, difficultyAt, mechsAt } from '../game/constants.js';
import { createBuilder } from '../game/builder.js';
import { createStaticPlatform } from '../game/entities.js';
import { updateCollectibles } from '../game/collectibles.js';
import { playerVsEnemies, updateEnemies } from '../game/enemies.js';
import { playerVsHazards, updateObstacles } from '../game/obstacles.js';
import { updatePlatforms } from '../game/platforms.js';
import { updatePlayer } from '../game/player.js';
import { hopOk, hopRatio, maxRise } from '../game/reach.js';
import { seedRng } from '../game/rng.js';
import { createState } from '../game/state.js';
import { safeFor, validateStaged } from '../game/validate.js';
import { buildChunk } from './chunk-harness.mjs';

const byId = Object.fromEntries(EXPERT.map((c) => [c.id, c]));
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
const gapBetween = (a, b) => b.x - (a.x + a.w);
const covers = (z, x) => x >= z.x && x <= z.x + z.w;
const hostOf = (st, e) => st.platforms.find((p) => p.id === e.hostId);
const wrap = (v) => v - Math.floor(v);
const offRoute = (st) => st.platforms.filter((p) => !st.route.includes(p));
// Waagerechter Abstand zweier Bereiche (0, wenn sie sich überlappen)
const spanGap = (a0, a1, b0, b1) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));

// ---------- Bibliothek ----------

const REQUIRED = ['spring-sky-route', 'blink-rhythm', 'ice-walker', 'comet-runway', 'charger-crumble', 'wind-flyer-tunnel', 'double-bolt-rain',
  'spring-stairs', 'jumper-slalom', 'moving-blink', 'shrine-storm', 'shrine-hail', 'charger-catapult', 'hail-gap', 'ice-wind-gust',
  'comet-crumble', 'flyer-hail-watch', 'blink-zigzag', 'walker-herd', 'cloud-arena'];

test('EXPERT enthält mindestens 16 Chunks mit allen Pflicht IDs und steht in CHUNKS', () => {
  assert.ok(EXPERT.length >= 16, `nur ${EXPERT.length} Chunks`);
  for (const id of REQUIRED) assert.ok(byId[id], `Chunk ${id} fehlt`);
  for (const c of EXPERT) assert.ok(CHUNKS.includes(c), `${c.id} fehlt in CHUNKS`);
  assert.equal(new Set(CHUNKS.map((c) => c.id)).size, CHUNKS.length, 'IDs über alle Chunks eindeutig');
});

test('IDs sind englische kebab case Namen, Namen sind deutsch und ohne Striche', () => {
  for (const c of EXPERT) {
    assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, `ID ${c.id}`);
    assert.ok(typeof c.name === 'string' && c.name.length >= 3, `Name von ${c.id}`);
    assert.ok(!/[-‐-―]/.test(c.name), `Name von ${c.id} enthält Striche`);
    assert.ok(/^[A-ZÄÖÜ]/.test(c.name), `Name von ${c.id} beginnt nicht groß`);
  }
});

test('Felder: Gewicht 1 bis 3, Schwierigkeit 5 bis 7, ab 1000 Metern, Tags gültig, kein Ruhechunk', () => {
  for (const c of EXPERT) {
    assert.ok(Number.isInteger(c.weight) && c.weight >= 1 && c.weight <= 3, `${c.id} weight ${c.weight}`);
    assert.ok(c.diff >= 5 && c.diff <= 7, `${c.id} diff ${c.diff}`);
    assert.ok(c.max > c.min && c.min >= 1000, `${c.id} min ${c.min} max ${c.max}`);
    assert.equal(c.rest, false, `${c.id} rest`);
    assert.ok(Array.isArray(c.mech) && c.mech.length >= 1 && c.mech.every((m) => MECH_TAGS.includes(m)), `${c.id} mech`);
    assert.equal(typeof c.build, 'function');
  }
});

test('Pflichtwerte: Schwierigkeit, Startmeter und Mechanik jedes Chunks', () => {
  const spec = {
    'spring-sky-route': [5.5, 1250, ['hailcloud', 'spring']],
    'blink-rhythm': [5, 1200, ['blink']],
    'ice-walker': [5, 1000, ['ice', 'walker']],
    'comet-runway': [6.5, 1700, ['comet', 'spring']],
    'charger-crumble': [6, 1300, ['breakable', 'charger']],
    'wind-flyer-tunnel': [6, 1300, ['flyer', 'wind']],
    'double-bolt-rain': [6, 1300, ['lightning', 'rain', 'walker']],
    'spring-stairs': [5, 1000, ['spike', 'spring']],
    'jumper-slalom': [6, 1350, ['jumper', 'spike']],
    'moving-blink': [6.5, 1500, ['blink', 'moving']],
    'shrine-storm': [6, 1350, ['lightning', 'powerup', 'spring', 'walker']],
    'shrine-hail': [6.5, 1500, ['hailcloud', 'powerup', 'spike']],
    'charger-catapult': [6.5, 1500, ['charger', 'spring']],
    'hail-gap': [6, 1350, ['hailcloud']],
    'ice-wind-gust': [5.5, 1300, ['ice', 'wind']],
    'comet-crumble': [7, 1700, ['breakable', 'comet']],
    'flyer-hail-watch': [7, 1600, ['flyer', 'hailcloud', 'walker']],
    'blink-zigzag': [6, 1400, ['blink', 'fallingstar']],
    'walker-herd': [5.5, 1200, ['spring', 'walker']],
    'cloud-arena': [7, 1600, ['charger', 'jumper', 'walker']],
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
  for (const c of EXPERT) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const used = [...st.tags].filter((t) => MECH_TAGS.includes(t)).sort();
      assert.deepEqual(used, [...c.mech].sort(), `${c.id} Seed ${seed}`);
    }
    const unlocked = mechsAt(c.min);
    for (const m of c.mech) assert.ok(unlocked.has(m), `${c.id}: ${m} bei Meter ${c.min} nicht freigeschaltet`);
  }
});

test('Schwierigkeit und Startmeter passen zur Kurve: Schwierigkeit 5 ab 1000 m, 6 ab 1300 m, 7 ab 1600 m', () => {
  for (const c of EXPERT) {
    assert.ok(c.min >= 1000 + (c.diff - 5) * 300, `${c.id}: min ${c.min} zu früh für diff ${c.diff}`);
    // Spätestens, wo die Kurve plus 0,6 den Chunk erreicht, darf er auftauchen: min liegt nicht weit dahinter
    assert.ok(c.diff <= difficultyAt(c.min) + 1.8, `${c.id}: diff ${c.diff} bei Meter ${c.min} (Kurve ${difficultyAt(c.min).toFixed(2)}) zu hoch`);
  }
  const bucket = (lo, hi) => EXPERT.filter((c) => c.diff >= lo && c.diff <= hi).length;
  assert.ok(bucket(5, 5.5) >= 4 && bucket(6, 6) >= 4 && bucket(6.5, 7) >= 4, 'Schwierigkeiten sind nicht über 5 bis 7 verteilt');
});

test('Auswahl: jede Phase hat Chunks, mindestens ein Drittel kombiniert zwei oder mehr Mechaniken, jede neue Mechanik kommt mehrfach vor', () => {
  const pick = (meter) => EXPERT.filter((c) => c.min <= meter && meter < c.max && c.diff <= difficultyAt(meter) + 0.6 && c.mech.every((m) => mechsAt(meter).has(m)));
  assert.ok(pick(1000).length >= 2, 'zu wenige Chunks bei 1000 m');
  assert.ok(pick(1400).length >= 8, 'zu wenige Chunks bei 1400 m');
  assert.ok(pick(1900).length >= 16, 'zu wenige Chunks bei 1900 m');
  assert.ok(EXPERT.filter((c) => c.mech.length >= 2).length * 3 >= EXPERT.length, 'zu wenige Kombinationen');
  assert.ok(EXPERT.filter((c) => c.mech.length >= 3).length >= 4, 'Tripel Kombinationen fehlen');
  const uses = (tag) => EXPERT.filter((c) => c.mech.includes(tag)).length;
  const need = { spring: 4, ice: 2, blink: 3, comet: 2, hailcloud: 4, powerup: 2, wind: 2, flyer: 2, charger: 3, walker: 5, spike: 3, breakable: 2, lightning: 2, jumper: 2, rain: 1, moving: 1, fallingstar: 1 };
  for (const [tag, n] of Object.entries(need)) assert.ok(uses(tag) >= n, `${tag} kommt nur in ${uses(tag)} Chunks vor`);
});

// ---------- Allgemeine Eigenschaften ----------

test('jeder Chunk erzeugt über 12 Seeds mindestens 3 verschiedene Layouts und ist bei gleichem Seed gleich', () => {
  for (const c of EXPERT) {
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
  for (const c of EXPERT) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const r = route(st);
      assert.ok(r.length >= 2, `${c.id}: Route zu kurz`);
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

test('Breite, Höhe und Mengen: 1000 bis 2000 px breit, höchstens 185 px Höhenspanne, alle Grenzen des Generators eingehalten', () => {
  for (const c of EXPERT) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.ok(st.maxX >= 1000 && st.maxX <= 2000, `${c.id}: Breite ${Math.round(st.maxX)}`);
      assert.ok(st.platMaxY - st.platMinY <= Y_MAX - Y_MIN, `${c.id}: Höhenspanne ${st.platMaxY - st.platMinY}`);
      assert.ok(st.platforms.length <= 16 && st.enemies.length <= 7 && st.hazards.length <= 6, `${c.id}: zu viele Objekte`);
      assert.ok(st.platforms.length <= LIMITS.MAX_PLATFORMS / 4, `${c.id}: zu viele Plattformen für das Limit`);
    }
  }
});

test('jeder Chunk trägt Sterne: mindestens 12, höchstens 48 auch mit Supermond, alle im Bild', () => {
  for (const c of EXPERT) {
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

test('Risikosterne gibt es nur im Chunk mit fallingstar, nur über Abgründen und nie im sicheren Anfang', () => {
  for (const c of EXPERT) {
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
  for (const c of EXPERT) {
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
  for (const c of EXPERT) {
    for (const seed of SEEDS) {
      assert.deepEqual(buildChunk(c, { seed, eventWind: 40 }).errors, [], `${c.id} Seed ${seed} im Sturm`);
      for (const extra of [0, 400, 1000, 1500, 3000]) {
        assert.deepEqual(buildChunk(c, { seed, meter: c.min + extra }).errors, [], `${c.id} +${extra} m Seed ${seed}`);
      }
    }
  }
});

test('jeder Chunk ist bei jeder Schwierigkeit von 5 bis 8 gültig, denn die Lücken passen sich der Schwierigkeit des Builders an', () => {
  for (const c of EXPERT) {
    for (const diff of [5, 5.5, 6, 6.5, 7, 8]) {
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
  for (const c of EXPERT) {
    for (const seed of [1, 2, 3]) assert.equal(sig(c, seed, 0), sig(c, seed, 333), `${c.id} Seed ${seed}`);
  }
});

// Der Generator darf den Einstieg überall zwischen der tiefsten und der höchsten erlaubten Lage setzen. An beiden Enden
// muss der Chunk gültig bleiben (der Bildrand oben und der Höhenbereich der Plattformen).
test('Randlagen: auch bei der höchsten und der tiefsten erlaubten Einstiegshöhe besteht der Chunk die Prüfung des Generators', () => {
  for (const c of EXPERT) {
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

// ---------- Neue Mechaniken ----------

test('Sprungwolken: Breite 60 bis 140, nie Einstieg oder Ausstieg, und keine Flieger oder Hagelwolken in ihrer Flugbahn', () => {
  const chunks = EXPERT.filter((c) => c.mech.includes('spring'));
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
        // Die Sprungwolke wirft 232 px hoch: darüber hängt nichts, das sie rammen könnte, und es bleibt Platz bis zum Bildrand
        for (const e of st.enemies) {
          if (e.kind !== 'flyer' && e.kind !== 'hailcloud') continue;
          assert.ok(spanGap(p.x - 40, p.x + p.w + 340, e.minX, e.maxX + e.w) > 0 || e.baseY + e.h + e.amp < p.y - 232 - PHYS.H - 40, `${c.id}: ${e.kind} liegt in der Flugbahn einer Sprungwolke`);
        }
      }
    }
  }
});

test('Eiswolken: mindestens 130 px breit, nie Einstieg oder Ausstieg, nie Gastgeber von Gegnern oder Stachelwolken', () => {
  const chunks = EXPERT.filter((c) => c.mech.includes('ice'));
  assert.ok(chunks.length >= 2);
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

test('Blinkwolken: lange fest, immer mit Vorwarnung, und in jeder Kette erscheint eine Wolke nach der anderen im Takt einer Welle', () => {
  const chunks = EXPERT.filter((c) => c.mech.includes('blink'));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const chain = st.route.filter((p) => p.kind === 'blink');
      assert.ok(chain.length >= 3, `${c.id}: Kette zu kurz`);
      for (const p of chain) {
        assert.ok(p.w >= 92 && p.period >= 3.4 && p.period <= 4.4, `${c.id}: Blinkwolke ${p.w} px, Takt ${p.period}`);
        assert.ok(p.period * p.on >= 2, `${c.id}: Blinkwolke zu kurz fest`);
      }
      for (let i = 1; i < chain.length; i++) {
        assert.equal(chain[i].period, chain[i - 1].period, `${c.id}: Takt wechselt`);
        const lag = wrap(chain[i - 1].phase - chain[i].phase); // Anteil des Takts, um den die Wolke später erscheint
        assert.ok(lag >= 0.235 && lag <= 0.285, `${c.id}: Welle mit Abstand ${lag.toFixed(3)}`);
        // Die nächste Wolke ist da, bevor die vorige zu flackern beginnt, und noch eine Weile frei von Flackern danach
        const freeWindow = (chain[i].on - 0.7 / chain[i].period - lag) * chain[i].period;
        assert.ok(freeWindow >= 0.35, `${c.id}: zu wenig Zeit zum Umsteigen (${freeWindow.toFixed(2)} s)`);
      }
      assert.ok(!st.route[0].period && !st.route[st.route.length - 1].period, 'Ein und Ausstieg sind feste Wolken');
    }
  }
});

test('Kometen: schlagen auf festem Boden ein, mit mindestens 150 px Abstand, nie im Anfang, eine Sekunde Vorwarnung bleibt', () => {
  const chunks = EXPERT.filter((c) => c.mech.includes('comet'));
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const comets = st.hazards.filter((h) => h.kind === 'comet').sort((p, q) => p.x - q.x);
      assert.ok(comets.length >= 2 && comets.length <= 4);
      for (const h of comets) {
        const floor = st.platforms.find((p) => h.x > p.x && h.x < p.x + p.w && Math.abs(p.y - h.y) < 12);
        assert.ok(floor && floor.kind === 'static', `${c.id}: Komet ohne festen Boden`);
        assert.ok(h.x - floor.x >= COMET.RADIUS + PHYS.W + 20, `${c.id}: Komet im Landebereich`);
        assert.ok(floor.x + floor.w - h.x >= COMET.RADIUS + PHYS.W + 20, `${c.id}: Komet im Absprungbereich`);
        assert.ok(h.idleTime >= 0.8, 'Komet braucht eine Ruhezeit');
        assert.ok(h.x - OX >= 300, `${c.id}: Komet zu früh`);
      }
      for (let i = 1; i < comets.length; i++) assert.ok(comets[i].x - comets[i - 1].x >= 150);
    }
  }
});

test('Hagelwolken und Flieger: 165 px über der höchsten Fläche, ein Köder Stern dabei, nie über Gegnern am Boden', () => {
  const chunks = EXPERT.filter((c) => c.mech.includes('hailcloud') || c.mech.includes('flyer'));
  assert.ok(chunks.length >= 5);
  for (const c of chunks) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const clouds = st.enemies.filter((e) => e.kind === 'hailcloud' || e.kind === 'flyer');
      assert.ok(clouds.length >= 1, `${c.id}: keine schwebende Wolke`);
      for (const e of clouds) {
        let surface = Infinity;
        for (const p of st.platforms) if (p.x + p.w > e.minX - 200 && p.x < e.maxX + e.w + 200) surface = Math.min(surface, p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y);
        assert.ok(e.baseY + e.h + e.amp <= surface - 165, `${c.id}: ${e.kind} blockiert normale Sprünge`);
        assert.ok(e.baseY + e.h + e.amp >= surface - 200, `${c.id}: ${e.kind} schwebt höher als nötig`);
        assert.ok(e.amp <= 8, 'kleines Auf und Ab');
        const cx = e.minX + (e.maxX - e.minX) / 2 + e.w / 2;
        if (e.kind === 'flyer') assert.ok(st.stars.some((s) => Math.abs(s.x - cx) < 2 && s.y < e.baseY - e.amp), `${c.id}: Stern über dem Flieger fehlt`);
        else assert.ok(st.stars.some((s) => Math.abs(s.x - cx) >= (e.maxX - e.minX) / 2 + e.w / 2 + 30 && Math.abs(s.x - cx) <= (e.maxX - e.minX) / 2 + e.w / 2 + 50 && Math.abs(s.y - (e.baseY + e.h / 2 - 26)) < 1), `${c.id}: Köder Stern neben der Hagelwolke fehlt`);
        // Hagel fällt nach unten: unter einer Hagelwolke darf kein Bodengegner patrouillieren
        if (e.kind === 'hailcloud') {
          for (const g of st.enemies) if (g.kind !== 'flyer' && g.kind !== 'hailcloud') assert.ok(spanGap(e.minX - 40, e.maxX + e.w + 40, g.minX, g.maxX + g.w) > 0, `${c.id}: Hagel über einem ${g.kind}`);
          for (const h of st.hazards) if (h.kind === 'spike') assert.ok(spanGap(e.minX - 40, e.maxX + e.w + 40, h.x, h.x + h.w) > 0, `${c.id}: Hagel über einer Stachelwolke`);
        }
      }
      // gegenläufige Paare fliegen nicht im Gleichschritt
      const flyers = clouds.filter((e) => e.kind === 'flyer');
      if (flyers.length === 2) assert.notEqual(flyers[0].dir, flyers[1].dir);
    }
  }
});

test('Powerup Schreine: hoch über einer Gefahr, nur mit Doppelsprung oder Sprungwolke erreichbar, nie auf der Route', () => {
  const types = new Set();
  for (const c of EXPERT.filter((x) => x.mech.includes('powerup'))) {
    for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
      const { st, errors } = buildChunk(c, { seed });
      assert.deepEqual(errors, [], `${c.id} Seed ${seed}`);
      assert.equal(st.powerups.length, 1);
      const p = st.powerups[0];
      assert.ok(POWER_TYPES.includes(p.type), p.type);
      types.add(p.type);
      const shrine = st.platforms.find((q) => !st.route.includes(q) && q.kind === 'static' && p.x > q.x && p.x < q.x + q.w);
      assert.ok(shrine && !shrine.ground && shrine.w <= 120, `${c.id}: Schrein fehlt`);
      assert.ok(p.y < shrine.y && shrine.y - p.y <= 40, 'Powerup liegt auf dem Schrein');
      const base = Math.max(...st.route.map((q) => q.y));
      const rise = base - shrine.y;
      assert.ok(rise > maxRise() + 4, `${c.id}: Schrein ${rise} px hoch ist mit einem Sprung erreichbar`);
      assert.ok(rise < maxRise(true) - 60, `${c.id}: Schrein ${rise} px hoch ist selbst mit Doppelsprung zu hoch`);
      const ground = st.route.find((q) => q.ground && q.x < shrine.x && q.x + q.w > shrine.x + shrine.w);
      assert.ok(ground, 'Schrein steht über der Lauflinie');
      assert.equal(hopRatio(ground, shrine), Infinity, 'mit einem Sprung erreichbar');
      assert.ok(Number.isFinite(hopRatio(ground, shrine, { dbl: true })), 'auch mit Doppelsprung unerreichbar');
      assert.ok(hopRatio(ground, shrine, { dbl: true }) < 0.7, 'der Doppelsprung ist zu knapp');
    }
  }
  assert.ok(types.size >= 4, `nur ${[...types]} kommen vor`);
});

// ---------- Die einzelnen Layouts ----------

test('spring-sky-route: die Sprungwolke ist der einzige Weg zu den hohen Wolken, die Hagelwolke wacht über dem Ausstieg', () => {
  each('spring-sky-route', (st) => {
    const [a, sp, h1, h2, exit] = route(st);
    assert.deepEqual(route(st).map((p) => p.kind), ['static', 'spring', 'static', 'static', 'static']);
    const rise = a.y - h1.y;
    assert.ok(rise >= 130 && rise <= 152, `Anstieg ${rise}`);
    assert.equal(hopOk(a, h1, { safe: 1, dbl: true }), false, 'die hohe Wolke ist auch ohne Sprungwolke zu erreichen');
    assert.ok(hopOk(sp, h1, { safe: 0.76, dbl: false }), 'von der Sprungwolke aus reicht ein Sprung');
    assert.ok(Math.abs(h2.y - h1.y) <= 12 && h1.y < sp.y - 120);
    const cloud = st.enemies[0];
    assert.equal(st.enemies.length, 1);
    assert.equal(cloud.kind, 'hailcloud');
    assert.ok(cloud.minX > exit.x + 60 && cloud.maxX + cloud.w < exit.x + exit.w - 40, 'Hagelwolke schwebt über dem Ausstieg');
    const trail = st.stars.filter((s) => s.x > sp.x + 20 && s.x < h1.x + h1.w && s.y < sp.y - 40);
    assert.ok(trail.length >= 6, `Sternspur hat ${trail.length} Sterne`);
  });
});

test('blink-rhythm: vier Blinkwolken in einer Welle zwischen zwei festen Wolken, Sterne zeichnen jeden Sprungbogen', () => {
  each('blink-rhythm', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => p.kind), ['static', 'blink', 'blink', 'blink', 'blink', 'static']);
    for (let i = 0; i < r.length - 1; i++) {
      const arc = st.stars.filter((s) => s.x > r[i].x + r[i].w - 10 && s.x < r[i + 1].x + 10 && s.y < Math.min(r[i].y, r[i + 1].y) - 20);
      assert.ok(arc.length >= 3, `Bogen ${i} hat ${arc.length} Sterne`);
    }
    for (let i = 1; i < r.length - 1; i++) assert.ok(gapBetween(r[i], r[i + 1]) >= PHYS.W && gapBetween(r[i - 1], r[i]) >= PHYS.W, 'Lücken brauchen einen echten Sprung');
    assert.equal(st.enemies.length + st.hazards.length + st.zones.length, 0, 'reiner Rhythmus Chunk');
  });
});

test('ice-walker: zwei lange Eiswolken, jede führt auf eine feste Wolke mit einer Gewitterwolke', () => {
  each('ice-walker', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => !!p.slick), [false, true, false, true, false, false]);
    const posts = [r[2], r[4]];
    assert.equal(st.enemies.length, 2);
    posts.forEach((p, i) => {
      const e = st.enemies.find((q) => q.hostId === p.id);
      assert.ok(e && e.kind === 'walker', 'Wachposten fehlt');
      assert.ok(e.minX - p.x >= 90, 'Landezone nach dem Rutschen zu klein');
      assert.ok(p.w >= 224 && r[1 + 2 * i].w >= 150, 'Maße');
    });
    assert.notEqual(st.enemies[0].dir, st.enemies[1].dir);
  });
});

test('comet-runway: drei Kometen auf einer langen Lauflinie, die Fluchtwolke liegt abseits der Route und wirft über die Mitte', () => {
  each('comet-runway', (st) => {
    const [a, run] = route(st);
    assert.equal(route(st).length, 2);
    assert.ok(run.w >= 940 && run.y === a.y, 'Lauflinie');
    const comets = st.hazards.filter((h) => h.kind === 'comet').sort((p, q) => p.x - q.x);
    assert.equal(comets.length, 3);
    assert.ok(comets.every((h) => h.y === run.y));
    assert.ok(new Set(comets.map((h) => h.idleTime.toFixed(2))).size === 3, 'Kometen schlagen versetzt ein');
    const spring = offRoute(st)[0];
    assert.equal(offRoute(st).length, 1);
    assert.equal(spring.kind, 'spring');
    assert.ok(run.y - spring.y >= 60 && run.y - spring.y <= 72, 'die Fluchtwolke liegt einen Sprung über der Linie');
    assert.ok(spring.x > comets[0].x + COMET.RADIUS + 10 && spring.x + spring.w < comets[1].x - COMET.RADIUS, 'Fluchtwolke zwischen dem ersten und zweiten Kometen');
    // Der Flug trägt den Spieler mit vollem Tempo über den Einschlagpunkt des zweiten Kometen hinweg
    const land = spring.x + spring.w / 2 + 316;
    assert.ok(land > comets[1].x + COMET.RADIUS + PHYS.W / 2 && land < comets[2].x - COMET.RADIUS - PHYS.W / 2, `Landung bei ${Math.round(land - OX)}`);
    assert.ok(st.stars.filter((s) => s.x > spring.x && s.x < land && s.y < spring.y).length >= 5, 'Sternspur der Flugbahn');
  });
});

test('charger-crumble: Brücke aus brüchigen Wolken, Insel mit Sturmwolke und Deckung darüber', () => {
  each('charger-crumble', (st) => {
    const r = route(st);
    const kinds = r.map((p) => p.kind);
    assert.deepEqual(kinds, ['static', 'breakable', 'breakable', 'static', 'breakable', 'static']);
    const island = r[3];
    const e = st.enemies[0];
    assert.equal(st.enemies.length, 1);
    assert.equal(e.kind, 'charger');
    assert.equal(e.hostId, island.id);
    assert.ok(island.w >= 310 && e.minX - island.x >= 140 && island.x + island.w - (e.maxX + e.w) >= 56);
    const cover = offRoute(st)[0];
    assert.ok(cover && cover.y < island.y - 80 && cover.w <= 110 && hopOk(island, cover, { safe: safeFor(6) }), 'Deckung');
    assert.ok(cover.x + cover.w > e.minX && cover.x < e.maxX + e.w, 'Deckung steht über der Streifzone');
    for (const p of r.filter((q) => q.kind === 'breakable')) assert.ok(p.w >= 92 && p.respawn === 0);
  });
});

test('wind-flyer-tunnel: Wind über der ganzen Kette, zwei Flieger gegenläufig über der ersten und der letzten Lücke', () => {
  const signs = new Set();
  each('wind-flyer-tunnel', (st) => {
    const r = route(st);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.ok(Math.abs(z.vx) >= 86 && Math.abs(z.vx) <= 120 && z.ay === 0, `vx ${z.vx}`);
    signs.add(Math.sign(z.vx));
    for (const p of r.slice(1, -1)) assert.ok(covers(z, p.x) && covers(z, p.x + p.w), 'Wind deckt nicht jede Wolke');
    assert.ok(z.x + z.w <= r[r.length - 1].x + r[r.length - 1].w - 40);
    const fl = st.enemies.filter((e) => e.kind === 'flyer');
    assert.equal(fl.length, 2);
    assert.ok(r.slice(1, -1).every((p) => p.w >= 86 && p.w <= 104), 'schmale Wolken');
    const head = Math.max(0, -z.vx);
    for (let i = 0; i < r.length - 1; i++) assert.ok(hopOk(r[i], r[i + 1], { safe: safeFor(6), wind: head }), `Sprung ${i} mit Gegenwind`);
  });
  assert.equal(signs.size, 2, 'Rücken und Gegenwind müssen beide vorkommen');
});

test('double-bolt-rain: drei Blitze auf einer nassen Lauflinie, die Gewitterwolke patrouilliert in der Gasse zwischen zwei Zonen', () => {
  each('double-bolt-rain', (st) => {
    const [, run] = route(st);
    const bolts = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
    assert.equal(bolts.length, 3);
    assert.equal(st.enemies.length, 1);
    const e = st.enemies[0];
    assert.equal(e.kind, 'walker');
    assert.equal(e.hostId, run.id);
    assert.ok(e.minX - bolts[1].x >= 90 && bolts[2].x - (e.maxX + e.w) >= 90, 'Gasse zwischen Wächter und Zonen zu eng');
    for (const h of bolts) assert.ok(h.x - OX >= 450 && run.x + run.w - (h.x + h.w / 2) >= 150, 'Zone liegt auf der Lauflinie mit Platz davor und danach');
    assert.ok(new Set(bolts.map((h) => h.idleTime.toFixed(2))).size === 3, 'Blitze sind zeitlich versetzt');
    const rains = st.zones.filter((z) => z.kind === 'rain');
    assert.equal(rains.length, 2);
    for (const h of bolts) assert.ok(rains.some((z) => covers(z, h.x)), 'Regen deckt nicht jeden Blitz');
    assert.notEqual(rains[0].timer, rains[1].timer);
    assert.ok(st.stars.filter((s) => bolts.some((h) => Math.abs(s.x - h.x) < 50 && s.y < run.y - 50)).length >= 6, 'Köder über den Zonen');
  });
});

test('spring-stairs: drei Sprungwolken führen in Stufen nach oben, oben teilt eine Stachelwolke die Landung', () => {
  each('spring-stairs', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => p.kind), ['static', 'spring', 'spring', 'spring', 'static', 'static']);
    const [, s1, s2, s3, top, exit] = r;
    assert.ok(s2.y < s1.y - 50 && s3.y < s2.y - 44 && top.y < s3.y - 20, 'Stufen steigen');
    const spike = st.hazards[0];
    assert.equal(st.hazards.length, 1);
    assert.equal(spike.hostId, top.id);
    assert.ok(spike.x - top.x >= 56 && top.x + top.w - (spike.x + spike.w) >= 100, 'große Landezone hinter der Stachelwolke');
    // Mit vollem Lauftempo trägt der Flug von jeder Stufe auf die nächste
    for (const [p, q] of [[s1, s2], [s2, s3], [s3, top]]) {
      const reach = (PHYS.MOVE_SPEED * (SPRING.SPEED + Math.sqrt(SPRING.SPEED ** 2 - 4 * (PHYS.GRAVITY / 2) * (p.y - q.y)))) / PHYS.GRAVITY;
      const landing = p.x + p.w / 2 + reach;
      assert.ok(landing > q.x + 10 && landing < q.x + q.w + 60, `Flug landet ${Math.round(landing - q.x)} px hinter der Kante`);
    }
    assert.ok(exit.y > top.y + 100, 'Abstieg');
  });
});

test('jumper-slalom: Hüpfer unten, Stachelwolke oben, im Wechsel', () => {
  each('jumper-slalom', (st) => {
    const r = route(st);
    assert.equal(r.length, 5);
    const [, p1, p2, p3] = r;
    assert.equal(st.enemies.length, 2);
    assert.ok(st.enemies.every((e) => e.kind === 'jumper'));
    assert.equal(hostOf(st, st.enemies[0]), p1);
    assert.equal(hostOf(st, st.enemies[1]), p3);
    assert.equal(st.hazards.length, 1);
    assert.equal(st.hazards[0].hostId, p2.id);
    assert.ok(p2.y < p1.y - 30 && p2.y < p3.y - 30, 'Stachelwolke liegt in der oberen Reihe');
    assert.ok(p2.w <= 200 && p1.w >= 236);
  });
});

test('moving-blink: eine Fähre trägt zu einer Welle aus drei Blinkwolken', () => {
  each('moving-blink', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => p.kind), ['static', 'moving', 'blink', 'blink', 'blink', 'static']);
    assert.ok(r[1].ax >= 50 && r[1].ay === 0, 'waagerechte Fähre');
    for (let i = 0; i < 4; i++) {
      const p = r[i];
      const q = r[i + 1];
      const qx = q.kind === 'moving' ? q.ox - q.ax : q.x;
      const px = p.kind === 'moving' ? p.ox + p.ax + p.w : p.x + p.w;
      assert.ok(qx - px >= 20 || p.kind !== 'moving' && q.kind !== 'moving' && qx - px >= PHYS.W, `Wolken kommen sich zu nah (${Math.round(qx - px)})`);
    }
  });
});

test('shrine-storm: der Schrein hängt über der Blitzzone, eine Sprungwolke davor, eine Gewitterwolke dahinter', () => {
  each('shrine-storm', (st) => {
    const [, run] = route(st);
    assert.equal(st.hazards.length, 1);
    const bolt = st.hazards[0];
    assert.equal(bolt.kind, 'lightning');
    const shrine = offRoute(st).find((p) => p.kind === 'static');
    const spring = offRoute(st).find((p) => p.kind === 'spring');
    assert.ok(shrine && spring && offRoute(st).length === 2);
    assert.ok(Math.abs(shrine.x + shrine.w / 2 - bolt.x) <= 20, 'Schrein liegt nicht über der Zone');
    assert.ok(spring.x + spring.w / 2 < bolt.x - 190, 'Sprungwolke steht nicht weit genug vor der Zone');
    const e = st.enemies[0];
    assert.equal(e.kind, 'walker');
    assert.ok(e.minX - bolt.x >= 90, 'Gewitterwolke zu nah an der Zone');
    assert.equal(e.hostId, run.id);
    // Der Flug von der Sprungwolke endet auf dem Schrein, wenn der Spieler die Taste hält
    const reach = (PHYS.MOVE_SPEED * (SPRING.SPEED + Math.sqrt(SPRING.SPEED ** 2 - 4 * (PHYS.GRAVITY / 2) * (spring.y - shrine.y)))) / PHYS.GRAVITY;
    const landing = spring.x + spring.w / 2 + reach;
    assert.ok(landing > shrine.x - 30 && landing < shrine.x + shrine.w + 30, `Landung ${Math.round(landing - shrine.x)} px hinter der Kante`);
  });
});

test('shrine-hail: Hagelwolke genau über dem Schrein, Stachelwolke auf der Lauflinie davor', () => {
  each('shrine-hail', (st) => {
    const [, run] = route(st);
    const shrine = offRoute(st)[0];
    const cloud = st.enemies[0];
    assert.equal(st.enemies.length, 1);
    assert.equal(cloud.kind, 'hailcloud');
    const mid = cloud.minX + (cloud.maxX - cloud.minX) / 2 + cloud.w / 2;
    assert.ok(Math.abs(mid - (shrine.x + shrine.w / 2)) < 2, 'Hagelwolke nicht über dem Schrein');
    const spike = st.hazards[0];
    assert.equal(st.hazards.length, 1);
    assert.equal(spike.hostId, run.id);
    assert.ok(spike.x + spike.w < cloud.minX - 100, 'Stachelwolke vor der Hagelzone');
    assert.ok(run.w >= 780);
  });
});

test('charger-catapult: Sturmwolke in der Mitte, eine Sprungwolke über dem Anlauf trägt über sie hinweg', () => {
  each('charger-catapult', (st) => {
    const [, arena] = route(st);
    const e = st.enemies[0];
    assert.equal(st.enemies.length, 1);
    assert.equal(e.kind, 'charger');
    assert.equal(e.hostId, arena.id);
    const spring = offRoute(st)[0];
    assert.equal(offRoute(st).length, 1);
    assert.equal(spring.kind, 'spring');
    assert.ok(arena.y - spring.y >= 66 && arena.y - spring.y <= 74 && spring.x + spring.w < e.minX - 30 && spring.x - arena.x >= 120);
    const land = spring.x + spring.w / 2 + 316;
    assert.ok(land > e.maxX + e.w + 10 && land < arena.x + arena.w - 40, `Landung bei ${Math.round(land - OX)}`);
    assert.ok(e.minX - arena.x >= 250 && arena.x + arena.w - (e.maxX + e.w) >= 200);
  });
});

test('hail-gap: zwei Hagelwolken über zwei breiten Lücken, versetzt', () => {
  each('hail-gap', (st) => {
    const r = route(st);
    assert.equal(r.length, 4);
    const clouds = st.enemies.filter((e) => e.kind === 'hailcloud').sort((p, q) => p.x - q.x);
    assert.equal(clouds.length, 2);
    assert.equal(st.enemies.length, 2);
    const mid = (e) => e.minX + (e.maxX - e.minX) / 2 + e.w / 2;
    assert.ok(mid(clouds[0]) > r[0].x + r[0].w - 20 && mid(clouds[0]) < r[1].x + 20, 'erste Wolke über der ersten Lücke');
    assert.ok(mid(clouds[1]) > r[2].x + r[2].w - 20 && mid(clouds[1]) < r[3].x + 20, 'zweite Wolke über der letzten Lücke');
    assert.notEqual(clouds[0].cooldown, clouds[1].cooldown, 'die Salven sind zeitlich versetzt');
    assert.ok(gapBetween(r[0], r[1]) >= 110 && gapBetween(r[2], r[3]) >= 110, 'breite Lücken');
  });
});

test('ice-wind-gust: drei bis vier Eiswolken unter kräftigem Wind, in beiden Richtungen', () => {
  const signs = new Set();
  each('ice-wind-gust', (st) => {
    const r = route(st);
    const ices = r.filter((p) => p.slick);
    assert.ok(ices.length >= 3 && ices.length <= 4);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.ok(Math.abs(z.vx) >= 80 && Math.abs(z.vx) <= 120);
    signs.add(Math.sign(z.vx));
    for (const p of ices) assert.ok(covers(z, p.x) && covers(z, p.x + p.w), 'Wind deckt nicht jede Eiswolke');
    const head = Math.max(0, -z.vx);
    for (let i = 0; i < r.length - 1; i++) assert.ok(hopOk(r[i], r[i + 1], { safe: safeFor(5.5), wind: Math.max(head, r[i].slick ? 70 : 0) }), `Sprung ${i}`);
    assert.equal(st.enemies.length + st.hazards.length, 0);
  });
  assert.equal(signs.size, 2);
});

test('comet-crumble: zwei Inseln mit je einem Kometen in der Mitte, dazwischen brüchige Wolken', () => {
  each('comet-crumble', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => p.kind), ['static', 'breakable', 'static', 'breakable', 'static', 'static']);
    const comets = st.hazards.filter((h) => h.kind === 'comet').sort((p, q) => p.x - q.x);
    assert.equal(comets.length, 2);
    comets.forEach((h, i) => {
      const island = r[2 + 2 * i];
      assert.ok(Math.abs(h.x - (island.x + island.w / 2)) <= 12, 'Komet in der Mitte der Insel');
      assert.ok(island.w >= 256);
    });
    assert.ok(comets[1].idleTime - comets[0].idleTime >= 0.3, 'Kometen versetzt');
    for (const p of r.filter((q) => q.kind === 'breakable')) assert.ok(p.w >= 92 && p.w <= 104);
  });
});

test('flyer-hail-watch: zwei Wachen auf festen Wolken, Hagelwolke über der ersten Lücke, Flieger über der zweiten', () => {
  each('flyer-hail-watch', (st) => {
    const r = route(st);
    assert.equal(r.length, 5);
    assert.equal(st.enemies.length, 4);
    const kinds = (k) => st.enemies.filter((e) => e.kind === k);
    assert.equal(kinds('walker').length, 2);
    const [hail] = kinds('hailcloud');
    const [fly] = kinds('flyer');
    const mid = (e) => e.minX + (e.maxX - e.minX) / 2 + e.w / 2;
    assert.ok(mid(hail) > r[1].x + r[1].w - 20 && mid(hail) < r[2].x + 20);
    assert.ok(mid(fly) > r[2].x + r[2].w - 20 && mid(fly) < r[3].x + 20);
    for (const w of kinds('walker')) assert.ok(hostOf(st, w) === r[1] || hostOf(st, w) === r[3]);
  });
});

test('blink-zigzag: Blinkwolken wechseln zwischen zwei Höhen, drei Risikosterne hängen über den Bögen', () => {
  each('blink-zigzag', (st) => {
    const r = route(st);
    assert.deepEqual(r.map((p) => p.kind), ['static', 'blink', 'blink', 'blink', 'blink', 'static']);
    const chain = r.slice(1, -1);
    assert.ok(chain[0].y < chain[1].y - 30 && chain[2].y < chain[1].y - 30 && chain[2].y < chain[3].y - 30, 'oben und unten im Wechsel');
    const risk = st.stars.filter((s) => s.falling);
    assert.equal(risk.length, 3);
    risk.forEach((s, i) => {
      assert.ok(s.x > chain[i].x + chain[i].w && s.x < chain[i + 1].x, 'Risikostern über der Lücke');
      assert.ok(s.value === 25 && s.triggerDist <= 160 && s.fallSpeed >= 40 && s.fallSpeed <= 80);
    });
  });
});

test('walker-herd: drei Gewitterwolken in drei Gassen einer langen Wiese, Sprungwolke über dem Anlauf', () => {
  each('walker-herd', (st) => {
    const [, meadow] = route(st);
    assert.equal(route(st).length, 2);
    assert.ok(meadow.w >= 980);
    assert.equal(st.enemies.length, 3);
    const es = [...st.enemies].sort((p, q) => p.x - q.x);
    assert.ok(es.every((e) => e.kind === 'walker' && e.hostId === meadow.id));
    for (let i = 1; i < 3; i++) assert.ok(es[i].minX - (es[i - 1].maxX + es[i - 1].w) >= 90, 'Gasse zwischen den Gewitterwolken');
    assert.ok(es.every((e) => e.maxX + e.w - e.minX <= 120));
    const spring = offRoute(st)[0];
    assert.equal(spring.kind, 'spring');
    assert.ok(spring.x + spring.w < es[0].minX - 50);
  });
});

test('cloud-arena: Sturmwolke, Gewitterwolke und Hüpfer in drei getrennten Gassen, Deckung über der Sturmwolke', () => {
  each('cloud-arena', (st) => {
    const [, arena] = route(st);
    assert.equal(st.enemies.length, 3);
    const es = ['charger', 'walker', 'jumper'].map((k) => st.enemies.find((e) => e.kind === k));
    assert.ok(es.every((e) => e && e.hostId === arena.id));
    for (let i = 1; i < 3; i++) assert.ok(es[i].minX - (es[i - 1].maxX + es[i - 1].w) >= 100, 'Gasse zwischen den Wächtern');
    assert.ok(arena.x + arena.w - (es[2].maxX + es[2].w) >= 200);
    const cover = offRoute(st)[0];
    assert.ok(cover.y <= arena.y - 86 && cover.x + cover.w > es[0].minX && cover.x < es[0].maxX + es[0].w);
    assert.ok(arena.w >= 1040);
  });
});

// ---------- Physik: Sprungwolke und Katapult ----------

const IDLE = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false };

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

// Baut den Chunk bei ox = 200, oy = 330 in einen frischen Zustand
function setup(chunk, seed, { diff = chunk.diff, meter = chunk.min, enemies = true } = {}) {
  const s = createState({ seed });
  seedRng(s, seed);
  const b = createBuilder(s, { ox: 200, oy: 330, diff, meter, mechs: mechsAt(meter), gateIndex: 1 });
  chunk.build(b);
  const st = b.st;
  Object.assign(s, { platforms: st.platforms, enemies: enemies ? st.enemies : [], hazards: st.hazards, zones: st.zones, stars: st.stars, powerups: st.powerups });
  return { s, st };
}

test('spring-sky-route mit der echten Physik: Anlauf, Sprung auf die Sprungwolke, Taste halten, Landung auf der ersten hohen Wolke', () => {
  const c = byId['spring-sky-route'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { s, st } = setup(c, seed, { enemies: false });
    const [a, sp, h1] = route(st);
    Object.assign(s.player, { x: a.x + 20, y: a.y - s.player.h, onGround: true, groundId: a.id });
    s.camX = s.player.x - 300;
    let apex = Infinity;
    let launched = false;
    let landedOn = 0;
    for (let i = 0; i < 260 && !landedOn; i++) {
      const p = s.player;
      // Sprung so, dass er die Mitte der Sprungwolke trifft. Die Taste gehört nur zum ersten Sprung: wer in der Luft
      // hält, gleitet und fliegt weiter als berechnet
      const jump = !launched && p.onGround && p.groundId === a.id && p.x + p.w / 2 >= sp.x + sp.w / 2 - 195;
      simStep(s, { move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0), dashPressed: false });
      if (sp.press > 0) launched = true; // der Abprall setzt press auf 1
      if (launched) apex = Math.min(apex, p.y + p.h);
      if (launched && p.onGround && p.groundId === h1.id) landedOn = h1.id;
      assert.ok(p.y < H + 40, `Seed ${seed}: abgestürzt`);
    }
    assert.ok(launched, `Seed ${seed}: nie auf der Sprungwolke gelandet`);
    assert.equal(landedOn, h1.id, `Seed ${seed}: der Flug endet nicht auf der hohen Wolke`);
    assert.ok(sp.y - apex >= 225, `Seed ${seed}: Flughöhe nur ${Math.round(sp.y - apex)} px`);
  }
});

test('charger-catapult mit der echten Physik: der Flug von der Sprungwolke geht über die Sturmwolke, ohne dass sie trifft', () => {
  const c = byId['charger-catapult'];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { s, st } = setup(c, seed);
    const [, arena] = route(st);
    const spring = offRoute(st)[0];
    const e = st.enemies[0];
    Object.assign(s.player, { x: arena.x + 30, y: arena.y - s.player.h, onGround: true, groundId: arena.id });
    s.camX = s.player.x - 300;
    let launched = false;
    let beyond = false;
    for (let i = 0; i < 300 && !beyond; i++) {
      const p = s.player;
      // Anlauf, Sprung 150 px vor der Mitte der Sprungwolke (er landet von oben darauf), danach nur nach rechts halten
      const jump = !launched && p.onGround && p.groundId === arena.id && p.x + p.w / 2 >= spring.x + spring.w / 2 - 150;
      simStep(s, { move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0), dashPressed: false });
      if (spring.press > 0) launched = true;
      assert.equal(s.run.hits, 0, `Seed ${seed}: getroffen von ${s.deathCause ? s.deathCause.label : '?'}`);
      assert.ok(p.y < H + 40, `Seed ${seed}: abgestürzt`);
      if (launched && p.onGround && p.groundId === arena.id && p.x > e.maxX + e.w) beyond = true;
    }
    assert.ok(launched && beyond, `Seed ${seed}: kam nicht über die Sturmwolke (gestartet ${launched})`);
  }
});

test('comet-runway mit der echten Physik: die Fluchtwolke wirft den Spieler über den zweiten Kometen, auch während er einschlägt', () => {
  const c = byId['comet-runway'];
  for (const seed of [1, 2, 3, 4]) {
    const { s, st } = setup(c, seed);
    const [, run] = route(st);
    const spring = offRoute(st)[0];
    const comets = st.hazards.filter((h) => h.kind === 'comet').sort((p, q) => p.x - q.x);
    // Der Spieler startet 130 px vor der Sprungwolke und läuft los, sobald die Kometen im Bild sind
    Object.assign(s.player, { x: spring.x - 130, y: run.y - s.player.h, onGround: true, groundId: run.id, vx: 0 });
    s.camX = s.player.x - 300;
    let launched = false;
    let beyond = false;
    for (let i = 0; i < 400 && !beyond; i++) {
      const p = s.player;
      const jump = p.onGround && p.groundId === run.id && !launched && p.x + p.w / 2 >= spring.x + spring.w / 2 - 150;
      simStep(s, { move: 1, jumpPressed: jump, jumpHeld: jump || (!launched && !p.onGround && p.vy < 0), dashPressed: false });
      if (spring.press > 0) launched = true;
      assert.equal(s.run.hits, 0, `Seed ${seed}: getroffen (${s.deathCause ? s.deathCause.label : '?'})`);
      if (launched && p.onGround && p.groundId === run.id) beyond = true;
    }
    assert.ok(launched && beyond, `Seed ${seed}: Flug über den Kometen gelang nicht (gestartet ${launched})`);
  }
});

// ---------- Physik: Spielbarkeit ----------
// Zwei Läufer mit der echten Physik, die nur Springen und Doppelsprung nutzen.
// 1. Ein Vorausschau Bot (wie in tests/chunks-advanced.test.mjs) probiert Eingabeskripte auf einer Kopie des Zustands
//    und bleibt bei jedem Treffer oder Sturz hängen. Das fängt Gegnerwege, Blitzzeiten, Stachelwolken, Regen, Wind
//    und bewegliche Plattformen ab.
// 2. Der Orakel Läufer geht die Route Plattform für Plattform ab und springt erst, wenn eine Kopie des Zustands
//    zeigt, dass der Sprung sicher auf der nächsten Plattform endet. Er prüft die Blinkketten und die Fähre, wo
//    der richtige Zeitpunkt zählt, und beginnt zu allen Zeiten im Takt.

const SCRIPTS = [{ f: () => ({ ...IDLE, move: 1 }) }, { f: () => IDLE }];
for (const move of [1, 0]) {
  for (const jf of [0, 4, 9, 15, 22, 30, 40]) {
    for (const dbl of [-1, 20, 30, 40]) {
      SCRIPTS.push({ f: (i) => ({ move, jumpPressed: i === jf || i === (dbl >= 0 ? jf + dbl : -1), jumpHeld: i >= jf && i < jf + 40, dashPressed: false }) });
    }
  }
}

const lowestSurface = (s) => Math.max(...s.platforms.map((p) => (p.kind === 'moving' ? p.oy + Math.abs(p.ay) : p.y)));

function lookahead(s, script, goalX) {
  const c = structuredClone(s);
  const lowY = Math.min(H + 30, lowestSurface(c) + 70);
  const lives0 = c.lives;
  const hits0 = c.run.hits;
  let steps = 0;
  let fell = false;
  for (; steps < 66; steps++) {
    simStep(c, script.f(steps));
    if (c.player.y > lowY) { fell = true; break; }
    if (c.lives < lives0 || c.run.hits > hits0) break;
  }
  const damage = fell || c.lives < lives0 || c.run.hits > hits0;
  return { damage, score: Math.min(c.player.x, goalX) - s.player.x - (damage ? 2000 - steps * 10 : 0) };
}

// Gibt null zurück, wenn der Bot das Ziel erreicht, sonst eine Beschreibung des Scheiterns
function playThrough(chunk, seed, { diff = chunk.diff, meter = chunk.min } = {}) {
  const { s, st } = setup(chunk, seed, { diff, meter });
  const ox = 200;
  const entry = st.route[0];
  const last = st.route[st.route.length - 1];
  // Hinter dem Ausstieg liegt die nächste breite Plattform, wie im echten Spiel
  const goal = createStaticPlatform(s, last.x + last.w, last.y, 3000, { ground: true });
  s.platforms = [...st.platforms, goal];
  Object.assign(s.player, { x: entry.x + 30, y: entry.y - s.player.h, onGround: true });
  s.camX = s.player.x - 300;
  let current = SCRIPTS[0];
  let start = 0;
  for (let k = 0; k < 60 * 45; k++) {
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

// Sprünge des Orakel Läufers: Sprungtaste nur kurz oder lang halten, in der Luft zur Mitte der Zielplattform steuern
const HOLDS = [40, 26, 16];
function hopInput(c, nextId, i, hold) {
  const next = c.platforms.find((p) => p.id === nextId);
  const p = c.player;
  const dx = next.x + next.w / 2 - (p.x + p.w / 2);
  if (i === 0) return { ...IDLE, move: 1, jumpPressed: true, jumpHeld: true };
  return { ...IDLE, move: Math.abs(dx) < 14 ? 0 : dx > 0 ? 1 : -1, jumpHeld: i < hold };
}

// Landet der Sprung sicher auf der Zielplattform, und bleibt der Spieler dort noch mindestens 0,6 Sekunden auf festem Grund?
function hopWorks(s, nextId, hold) {
  const c = structuredClone(s);
  const lowY = Math.min(H + 30, lowestSurface(c) + 70);
  const lives0 = c.lives;
  const bad = () => c.player.y > lowY || c.lives < lives0 || c.run.hits > 0;
  for (let i = 0; i < 100; i++) {
    simStep(c, hopInput(c, nextId, i, hold));
    if (bad()) return false;
    if (c.player.onGround && i > 3) {
      if (c.player.groundId !== nextId) return false;
      for (let k = 0; k < 36; k++) {
        simStep(c, IDLE);
        if (bad() || !c.player.onGround || c.player.groundId !== nextId) return false;
      }
      return true;
    }
  }
  return false;
}

function oracleRun(chunk, seed, { t0 = 0, diff = chunk.diff } = {}) {
  const { s, st } = setup(chunk, seed, { diff });
  s.t = t0;
  const r = st.route;
  Object.assign(s.player, { x: r[0].x + 30, y: r[0].y - s.player.h, onGround: true, groundId: r[0].id });
  s.camX = s.player.x - 300;
  let idx = 0;
  let hopI = -1;
  let hold = 40;
  for (let k = 0; k < 60 * 60; k++) {
    const p = s.player;
    const next = r[idx + 1];
    if (!next && p.onGround && p.groundId === r[idx].id) return null;
    let input = IDLE;
    if (hopI >= 0) {
      input = hopInput(s, next.id, hopI++, hold);
      if (p.onGround && hopI > 4 && p.groundId === next.id) { idx++; hopI = -1; input = IDLE; }
    } else if (next && p.onGround && p.groundId === next.id) {
      idx++;
    } else if (next && p.onGround) {
      const h = HOLDS.find((q) => hopWorks(s, next.id, q));
      if (h) { hold = h; hopI = 0; input = hopInput(s, next.id, hopI++, hold); }
      else input = { ...IDLE, move: p.x + p.w < r[idx].x + r[idx].w - 4 ? 1 : 0 };
    }
    simStep(s, input);
    if (s.player.y > H + 60 || s.run.hits > 0) return `${s.run.hits ? 'Treffer' : 'gestürzt'} bei Plattform ${idx} nach ${s.t.toFixed(1)} s`;
  }
  return `Zeit abgelaufen bei Plattform ${idx}`;
}

const TIMED = ['blink-rhythm', 'blink-zigzag', 'moving-blink'];

test('Spielbarkeit: der Test Bot kommt durch jeden Chunk, ohne getroffen zu werden oder zu stürzen', () => {
  for (const c of EXPERT.filter((x) => !TIMED.includes(x.id))) {
    for (const seed of [1, 2, 3]) assert.equal(playThrough(c, seed), null, `${c.id} Seed ${seed}`);
  }
});

test('Spielbarkeit: auch spät im Spiel und bei Schwierigkeit 5, wenn die Parameter anders sind', () => {
  for (const c of EXPERT.filter((x) => !TIMED.includes(x.id))) {
    assert.equal(playThrough(c, 4, { meter: c.min + 1500 }), null, `${c.id} Seed 4 +1500 m`);
    assert.equal(playThrough(c, 5, { diff: 5 }), null, `${c.id} Seed 5 Schwierigkeit 5`);
  }
});

test('Blinkketten und Fähre mit der echten Physik: wer den richtigen Moment abwartet, kommt zu jedem Zeitpunkt im Takt durch', () => {
  for (const id of TIMED) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const t0 of [0, 0.7, 1.4, 2.1, 2.8, 3.5]) assert.equal(oracleRun(byId[id], seed, { t0 }), null, `${id} Seed ${seed} Start ${t0}`);
    }
    for (const seed of [7, 8]) assert.equal(oracleRun(byId[id], seed, { t0: 1.1, diff: 5 }), null, `${id} Seed ${seed} Schwierigkeit 5`);
  }
});

test('Blinkwolken verlangen den richtigen Moment: blind gelaufen scheitert die Kette oft, als feste Wolken wäre sie leicht (Kontrolle)', () => {
  // Derselbe blinde Läufer (immer rechts, springt an jeder Kante, hält die Taste nur im Aufstieg) auf der Kette als
  // Blinkwolken und als feste Wolken: nur das Blinken darf den Unterschied machen
  const blind = (fixed) => {
    let ok = 0;
    const c = byId['blink-rhythm'];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const t0 of [0, 1, 2, 3]) {
        const { s, st } = setup(c, seed);
        if (fixed) for (const p of st.platforms) if (p.kind === 'blink') Object.assign(p, { kind: 'static', period: undefined });
        s.t = t0;
        const r = st.route;
        const last = r[r.length - 1];
        Object.assign(s.player, { x: r[0].x + 30, y: r[0].y - s.player.h, onGround: true, groundId: r[0].id });
        s.camX = s.player.x - 300;
        let done = false;
        for (let i = 0; i < 60 * 14 && !done && s.player.y < H + 60; i++) {
          const p = s.player;
          const cur = s.platforms.find((q) => q.id === p.groundId);
          const edge = p.onGround && cur && p.x + p.w >= cur.x + cur.w - 2;
          simStep(s, { move: 1, jumpPressed: edge, jumpHeld: edge || (!p.onGround && p.vy < 0), dashPressed: false });
          if (p.onGround && p.groundId === last.id) done = true;
        }
        if (done) ok++;
      }
    }
    return ok;
  };
  const withBlink = blind(false);
  const withFixed = blind(true);
  assert.ok(withFixed >= 20, `als feste Wolken schafft der blinde Läufer nur ${withFixed} von 24`);
  assert.ok(withBlink <= withFixed - 8, `mit Blinken schafft der blinde Läufer ${withBlink} von 24, ohne Blinken ${withFixed}: die Wolken blinken nicht spürbar`);
});

test('Spielbarkeit: der Bot scheitert zu Recht an unmöglichen Chunks (Kontrolle)', () => {
  const gapTooWide = { build(bd) { const a = bd.ground(0, 0, 240); bd.route(a, bd.ground(a.w + 520, 0, 240)); } };
  const spikeWall = { build(bd) { const a = bd.ground(0, 0, 900); for (let i = 0; i < 10; i++) bd.spike(a, 0.3 + i * 0.045); bd.route(a); } };
  for (const c of [gapTooWide, spikeWall]) assert.notEqual(playThrough({ ...c, diff: 6, min: 1700 }, 1), null);
  const never = { build(bd) { const a = bd.ground(0, 0, 240); const z = bd.blink(a.w + 120, 0, 100, { period: 4, on: 0.1 }); bd.route(a, z, bd.ground(a.w + 400, 0, 240)); } };
  assert.notEqual(oracleRun({ ...never, diff: 6, min: 1700 }, 1), null, 'der Orakel Läufer kommt nicht über eine Blinkwolke, die kaum fest ist');
});
