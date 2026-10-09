// Tests für die frühen Chunk Layouts (game/chunks/basic.js) und die Spezial Chunks (game/chunks/special.js).
// Die allgemeine Fairness Prüfung (Sprünge, sicherer Anfang, Host Plattformen) steckt in tests/chunks.test.mjs.
// Hier steht, was für diese Layouts zusätzlich gelten muss: Lernziele, Mechanik Tags, Variation, Sonderfälle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, FLAT, GATE } from '../game/chunks/index.js';
import { BASIC } from '../game/chunks/basic.js';
import { H, LIMITS, SPIKE, STEP, mechsAt } from '../game/constants.js';
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

const ALL = [...BASIC, FLAT, GATE];
const byId = Object.fromEntries(ALL.map((c) => [c.id, c]));
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const MECH_TAGS = ['moving', 'breakable', 'walker', 'spike', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'rain', 'fallingstar', 'powerup'];

const build = (id, seed, opts = {}) => buildChunk(byId[id], { seed, ...opts });
const each = (id, fn, opts = {}) => {
  for (const seed of SEEDS) {
    const r = build(id, seed, opts);
    assert.deepEqual(r.errors, [], `${id} Seed ${seed}`);
    fn(r.st, seed, r);
  }
};
const route = (st) => st.route;
// Position einer Plattform in Phase k von n eines Umlaufs (bei festen Plattformen immer gleich)
const at = (p, k, n) => ({ ...platformAt(p, ((Math.PI * 2) / (p.omega || 1)) * (k / n)), kind: 'static' });
const PHASES = 64;
const gapBetween = (a, b) => b.x - (a.x + a.w);
const onTop = (plat, star) => star.x >= plat.x && star.x <= plat.x + plat.w && star.y < plat.y;

// ---------- Bibliothek ----------

test('BASIC enthält mindestens 15 Chunks mit allen Pflicht IDs', () => {
  assert.ok(BASIC.length >= 15, `nur ${BASIC.length} Chunks`);
  const need = ['meadow', 'stepping-stones', 'first-gap', 'stairs-up', 'stairs-down', 'rolling-hills', 'walker-intro', 'walker-pair',
    'spike-hop', 'spiked-stairs', 'shield-nook', 'moving-ferry', 'moving-lift', 'rain-meadow', 'rest-garden', 'star-ladder'];
  for (const id of need) assert.ok(BASIC.some((c) => c.id === id), `Chunk ${id} fehlt`);
});

test('index.js führt alle BASIC Chunks und die Spezial Chunks', () => {
  for (const c of BASIC) assert.ok(CHUNKS.includes(c), `${c.id} fehlt in CHUNKS`);
  assert.equal(FLAT.id, 'flat');
  assert.equal(GATE.id, 'gate');
  assert.ok(!CHUNKS.includes(FLAT) && !CHUNKS.includes(GATE), 'Spezial Chunks gehören nicht in die Zufallsauswahl');
});

test('IDs sind englische kebab case Namen, Namen sind deutsch und ohne Striche', () => {
  const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  for (const c of ALL) {
    assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, `ID ${c.id}`);
    assert.ok(typeof c.name === 'string' && c.name.length >= 3, `Name von ${c.id}`);
    assert.ok(!dashes.some((d) => c.name.includes(d)) && !/\s-\s/.test(c.name), `Name von ${c.id} enthält Striche`);
  }
  assert.equal(new Set(ALL.map((c) => c.id)).size, ALL.length);
});

test('Felder: Gewicht 1 bis 4 für BASIC, Gewicht 0 für Spezial Chunks, max über min', () => {
  for (const c of BASIC) {
    assert.ok(Number.isInteger(c.weight) && c.weight >= 1 && c.weight <= 4, `${c.id} weight ${c.weight}`);
    assert.ok(c.max > c.min, `${c.id} max muss größer als min sein`);
    assert.equal(typeof c.rest, 'boolean', `${c.id} rest`);
    assert.ok(Array.isArray(c.mech), `${c.id} mech`);
  }
  assert.equal(FLAT.weight, 0);
  assert.equal(GATE.weight, 0);
  assert.equal(GATE.special, 'gate');
});

test('Pflichtwerte laut Auftrag: Schwierigkeit, Startmeter, Mechanik, Ruhe', () => {
  const spec = {
    meadow: [1, 0, [], true],
    'stepping-stones': [1, 0, [], false],
    'first-gap': [1, 0, [], false],
    'stairs-up': [1, 0, [], false],
    'stairs-down': [1, 0, [], false],
    'rolling-hills': [1, 0, [], true],
    'walker-intro': [1.5, 250, ['walker'], false],
    'walker-pair': [2, 300, ['walker'], false],
    'spike-hop': [2, 250, ['spike'], false],
    'spiked-stairs': [2.5, 350, ['spike'], false],
    'shield-nook': [1.5, 300, ['powerup'], true],
    'moving-ferry': [2, 500, ['moving'], false],
    'moving-lift': [2, 500, ['moving'], false],
    'rain-meadow': [2, 500, ['rain'], false],
    'rest-garden': [2, 500, ['powerup'], true],
    'star-ladder': [2, 250, [], false],
  };
  for (const [id, [diff, min, mech, rest]] of Object.entries(spec)) {
    const c = byId[id];
    assert.equal(c.diff, diff, `${id} diff`);
    assert.equal(c.min, min, `${id} min`);
    assert.deepEqual([...c.mech].sort(), mech, `${id} mech`);
    assert.equal(c.rest, rest, `${id} rest`);
  }
  assert.equal(byId['shield-nook'].weight, 1);
});

test('Tutorial: mindestens 6 verschiedene Chunks ab Meter 0, bis 250 Meter nur Schwierigkeit 1 ohne Mechaniken', () => {
  const start = BASIC.filter((c) => c.min === 0);
  assert.ok(start.length >= 6, `nur ${start.length} Startchunks`);
  for (const c of BASIC.filter((x) => x.min < 250)) {
    assert.equal(c.diff, 1, `${c.id} ist zu schwer fürs Tutorial`);
    assert.deepEqual(c.mech, [], `${c.id} braucht eine Mechanik`);
  }
  for (const c of BASIC.filter((x) => x.min >= 250)) assert.ok(c.min >= 250, c.id);
});

test('Tutorial Chunks haben weder Gegner noch Hindernisse noch Zonen noch Powerups', () => {
  for (const c of BASIC.filter((x) => x.min < 250)) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.equal(st.enemies.length + st.hazards.length + st.zones.length + st.powerups.length, 0, `${c.id} Seed ${seed}`);
    }
  }
});

test('mech Liste entspricht genau den Mechaniken, die der Chunk baut', () => {
  for (const c of ALL) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const used = [...st.tags].filter((t) => MECH_TAGS.includes(t)).sort();
      assert.deepEqual(used, [...c.mech].sort(), `${c.id} Seed ${seed}`);
    }
    const unlocked = mechsAt(c.min);
    for (const m of c.mech) assert.ok(unlocked.has(m), `${c.id}: ${m} bei Meter ${c.min} nicht freigeschaltet`);
  }
});

test('ruhige Chunks haben keine Gegner, keine Hindernisse und keine Zonen', () => {
  for (const c of ALL.filter((x) => x.rest)) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.equal(st.enemies.length + st.hazards.length + st.zones.length, 0, `${c.id} Seed ${seed}`);
    }
  }
  assert.ok(BASIC.filter((c) => c.rest && c.min === 0).length >= 2, 'zu wenige ruhige Chunks im Tutorial');
});

// ---------- Allgemeine Eigenschaften ----------

test('jeder Chunk erzeugt über 12 Seeds mindestens 3 verschiedene Layouts', () => {
  for (const c of ALL) {
    const layouts = new Set();
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      layouts.add(JSON.stringify([st.platforms.map((p) => [p.x, p.y, p.w]), st.stars.map((s) => [s.x, s.y])]));
    }
    assert.ok(layouts.size >= 3, `${c.id} liefert nur ${layouts.size} Layouts`);
  }
});

test('Routen: erste Plattform ist Boden bei x = 0, alle Routenplattformen sind gebaut und liegen von links nach rechts', () => {
  for (const c of ALL) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      const r = route(st);
      assert.ok(r.length >= 1, `${c.id}: keine Route`);
      assert.equal(r[0].ground, true, `${c.id}: Einstieg muss b.ground sein`);
      assert.ok(r[0].w >= 200 && r[r.length - 1].w >= 140, `${c.id}: Ein oder Ausstieg zu schmal (Einstiege sind für den Respawn mindestens 200 breit)`);
      for (const p of r) assert.ok(st.platforms.includes(p), `${c.id}: Routenplattform ${p.id} fehlt in platforms`);
      const xs = r.map((p) => (p.kind === 'moving' ? p.ox : p.x));
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${c.id}: Route läuft nicht nach rechts`);
      assert.equal(r[r.length - 1].kind, 'static');
    }
  }
});

test('jede Route enthält Sterne, keine Risikosterne vor Meter 800', () => {
  for (const c of ALL) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.ok(st.stars.length >= 5, `${c.id} Seed ${seed}: nur ${st.stars.length} Sterne`);
      assert.ok(st.stars.every((s) => !s.falling), `${c.id}: Risikostern vor der Freischaltung`);
    }
  }
});

test('Mengen und Fairness bleiben auch mit Sternboost (Supermond) innerhalb der Grenzen', () => {
  for (const c of ALL) {
    for (const seed of SEEDS) {
      const r = buildChunk(c, { seed, starBoost: true });
      assert.deepEqual(r.errors, [], `${c.id} Seed ${seed} mit Boost`);
      assert.ok(r.st.stars.length <= 48, `${c.id}: ${r.st.stars.length} Sterne mit Boost`);
    }
  }
});

test('Chunks bleiben bei jeder Schwierigkeit von 1 bis 5 gültig und breiter als 500 px', () => {
  for (const c of ALL) {
    for (const diff of [1, 1.5, 2, 2.5, 3.5, 5]) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const r = buildChunk(c, { seed, diff, meter: Math.max(c.min, 1700) });
        assert.deepEqual(r.errors, [], `${c.id} diff ${diff} Seed ${seed}`);
      }
    }
    const { st } = buildChunk(c, { seed: 1 });
    if (c.id !== 'flat') assert.ok(st.maxX >= 500 && st.maxX <= 1400, `${c.id}: Breite ${Math.round(st.maxX)}`);
  }
});

test('Plattformen eines Chunks passen immer in den erlaubten Höhenbereich mit Spielraum für den Generator', () => {
  for (const c of ALL) {
    for (const seed of SEEDS) {
      const { st } = buildChunk(c, { seed });
      assert.ok(st.platMaxY - st.platMinY <= 150, `${c.id} Seed ${seed}: Höhenspanne ${st.platMaxY - st.platMinY}`);
    }
  }
});

// ---------- Tutorial Layouts ----------

test('stepping-stones: 3 bis 4 kleine Wolken nach dem Einstieg mit kleinen Lücken', () => {
  each('stepping-stones', (st) => {
    const r = route(st);
    assert.ok(r.length >= 4 && r.length <= 5, `Route mit ${r.length} Plattformen`);
    for (let i = 0; i < r.length - 1; i++) {
      const gap = gapBetween(r[i], r[i + 1]);
      assert.ok(gap >= 40 && gap <= 125, `Lücke ${gap}`);
    }
    const small = r.slice(1, -1);
    assert.ok(small.every((p) => p.w <= 124 && !p.ground), 'Trittsteine müssen klein und schwebend sein');
  });
});

test('first-gap: genau eine echte Lücke mit Sternbogen darüber', () => {
  each('first-gap', (st) => {
    const [a, c] = route(st);
    assert.equal(route(st).length, 2);
    const gap = gapBetween(a, c);
    assert.ok(gap >= 100, `Lücke ${gap} ist zu klein für eine echte Lücke`);
    const over = st.stars.filter((s) => s.x > a.x + a.w - 10 && s.x < c.x + 10);
    assert.ok(over.length >= 5, `nur ${over.length} Sterne im Bogen`);
    assert.ok(over.every((s) => s.y < Math.min(a.y, c.y) - 25), 'Bogen muss über beiden Plattformen liegen');
  });
});

test('stairs-up steigt, stairs-down fällt, jede Stufe in kleinen Schritten', () => {
  each('stairs-up', (st) => {
    const r = route(st);
    for (let i = 1; i < r.length; i++) {
      const rise = r[i - 1].y - r[i].y;
      assert.ok(rise >= 26 && rise <= 36, `Stufe ${rise}`);
    }
    assert.ok(r.length >= 4);
  });
  each('stairs-down', (st) => {
    const r = route(st);
    for (let i = 1; i < r.length; i++) {
      const drop = r[i].y - r[i - 1].y;
      assert.ok(drop >= 28 && drop <= 38, `Stufe ${drop}`);
    }
    assert.ok(r.length >= 3);
  });
});

test('rolling-hills: nur kleine Höhenunterschiede, keine Lücke, die einen Sprung über Abgrund verlangt', () => {
  each('rolling-hills', (st) => {
    const r = route(st);
    assert.ok(r.length >= 3);
    for (let i = 1; i < r.length; i++) {
      assert.ok(gapBetween(r[i - 1], r[i]) < 44, 'Lücke breiter als der Spieler');
      assert.ok(Math.abs(r[i].y - r[i - 1].y) <= 28);
    }
    for (let i = 2; i < r.length; i++) assert.ok((r[i].y - r[i - 1].y) * (r[i - 1].y - r[i - 2].y) < 0, 'Auf und Ab wechselt');
    assert.ok(st.stars.length >= 15);
  });
});

test('cloud-walk und moon-terrace: ruhige Wege ohne Abgrund, mit Wolken und vielen Sternen', () => {
  each('cloud-walk', (st) => {
    const r = route(st);
    assert.ok(r.length >= 4 && r.length <= 5);
    assert.ok(r.slice(1).every((p) => !p.ground && p.w >= 170), 'Wolken breit und schwebend');
    for (let i = 1; i < r.length; i++) assert.ok(gapBetween(r[i - 1], r[i]) < 44 && Math.abs(r[i].y - r[i - 1].y) <= 16);
    assert.ok(st.stars.length >= 18);
  });
  each('moon-terrace', (st) => {
    const [a, step, top] = route(st);
    assert.equal(route(st).length, 3);
    assert.ok(Math.abs(step.y - a.y) >= 26 && Math.abs(step.y - a.y) <= 34, 'Stufe');
    assert.ok(Math.abs(top.y - step.y) >= 26 && Math.abs(top.y - step.y) <= 34 && (top.y - step.y) * (step.y - a.y) > 0, 'zweite Stufe in dieselbe Richtung');
    assert.ok(a.ground && top.ground && a.w >= 280 && top.w >= 320);
    assert.ok(gapBetween(a, step) < 44 && gapBetween(step, top) < 44);
    assert.ok(st.stars.length >= 12);
  });
});

test('star-avenue: lange ebene Plattform mit einer Sternenwelle', () => {
  each('star-avenue', (st) => {
    assert.equal(route(st).length, 1);
    assert.ok(route(st)[0].w >= 620);
    assert.equal(st.stars.length, 14);
  });
});

test('dream-valley: erst hinab ins Tal, dann wieder hinauf', () => {
  each('dream-valley', (st) => {
    const [a, v, c, x] = route(st);
    assert.ok(v.y > a.y + 40, 'Tal liegt tiefer als der Einstieg');
    assert.ok(c.y < v.y && x.y < c.y, 'Ausgang steigt wieder');
  });
});

test('fork-clouds: freiwilliger oberer Weg ist mit einfachen Sprüngen erreichbar und trägt mehr Sterne', () => {
  for (const seed of SEEDS) {
    const r = build('fork-clouds', seed);
    assert.deepEqual(r.errors, []);
    const { st } = r;
    const main = route(st);
    const upper = st.platforms.filter((p) => !main.includes(p)).sort((p, q) => p.x - q.x);
    assert.equal(upper.length, 2);
    const safe = safeFor(1);
    assert.ok(hopOk(main[0], upper[0], { safe }), 'Einstieg zur ersten oberen Wolke');
    assert.ok(hopOk(upper[0], upper[1], { safe }), 'erste zur zweiten oberen Wolke');
    assert.ok(hopOk(upper[1], main[2], { safe }), 'zurück zum Ausstieg');
    assert.ok(hopOk(main[1], upper[1], { safe }), 'von der unteren Wolke nach oben');
    assert.ok(upper.every((p) => p.y < Math.min(...main.map((m) => m.y)) - 30), 'oberer Weg liegt deutlich höher');
  }
});

// ---------- Gegner und Hindernisse ----------

test('walker-intro: ein Walker auf einer langen Plattform, Anfang und Ende bleiben frei, Sterne darüber', () => {
  each('walker-intro', (st) => {
    const [g] = route(st);
    assert.equal(route(st).length, 1);
    assert.ok(g.w >= 600);
    assert.equal(st.enemies.length, 1);
    const e = st.enemies[0];
    assert.equal(e.kind, 'walker');
    assert.equal(e.hostId, g.id);
    assert.ok(e.minX - g.x >= LIMITS.SAFE_START + 30, 'Landezone vor dem Walker zu kurz');
    assert.ok(g.x + g.w - (e.maxX + e.w) >= 160, 'Absprungzone hinter dem Walker zu kurz');
    assert.ok(e.maxX - e.minX >= 80, 'Walker braucht Raum zum Patrouillieren');
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
    const above = st.stars.filter((s) => s.x > e.minX && s.x < e.maxX + e.w && s.y < g.y - 60);
    assert.ok(above.length >= 5, 'Sternbogen über dem Walker fehlt');
  });
});

test('walker-pair: zwei Walker auf zwei verschiedenen Plattformen hintereinander mit freien Landezonen', () => {
  each('walker-pair', (st) => {
    const [a, p1, p2] = route(st);
    assert.equal(route(st).length, 3);
    assert.equal(st.enemies.length, 2);
    const [e1, e2] = [...st.enemies].sort((p, q) => p.x - q.x);
    assert.equal(e1.hostId, p1.id);
    assert.equal(e2.hostId, p2.id);
    assert.notEqual(e1.hostId, e2.hostId);
    assert.ok(e1.minX - p1.x >= 100 && e2.minX - p2.x >= 100, 'Landezonen');
    assert.ok(p2.x + p2.w - (e2.maxX + e2.w) >= 140, 'Absprungzone am Ausstieg');
    assert.ok(a.w >= 210 && st.hazards.length === 0);
  });
});

test('spike-hop: eine Stachelwolke mitten auf einer breiten Plattform mit Sternbogen darüber', () => {
  each('spike-hop', (st) => {
    const [, host] = route(st);
    assert.equal(st.hazards.length, 1);
    const h = st.hazards[0];
    assert.equal(h.kind, 'spike');
    assert.equal(h.hostId, host.id);
    assert.ok(host.w >= 380);
    assert.ok(h.x - host.x >= 100, 'Anlauf vor der Wolke');
    assert.ok(host.x + host.w - (h.x + h.w) >= 180, 'Platz nach der Wolke');
    const arc = st.stars.filter((s) => s.x > h.x - 40 && s.x < h.x + h.w + 40);
    assert.ok(arc.length >= 5, 'Sternbogen fehlt');
    assert.ok(arc.some((s) => s.x > h.x && s.x < h.x + h.w && s.y < h.y - 40), 'Scheitel liegt nicht über der Wolke');
    assert.equal(st.enemies.length, 0);
  });
});

test('spiked-stairs: Stufen in eine Richtung, Stachelwolken auf den Absätzen mit Raum davor und danach', () => {
  each('spiked-stairs', (st) => {
    const r = route(st);
    assert.equal(r.length, 4);
    const steps = r.slice(1).map((p, i) => p.y - r[i].y);
    assert.ok(steps.every((d) => d <= -28) || steps.every((d) => d >= 28), `Stufen ${steps}`);
    const spikes = st.hazards.filter((h) => h.kind === 'spike');
    assert.equal(spikes.length, 2);
    assert.equal(new Set(spikes.map((h) => h.hostId)).size, 2);
    for (const h of spikes) {
      const host = r.find((p) => p.id === h.hostId);
      assert.ok(host && host !== r[0] && host !== r[r.length - 1], 'Stachelwolke gehört auf einen Absatz in der Mitte');
      assert.ok(h.x - host.x >= 100 && host.x + host.w - (h.x + h.w) >= 80);
      assert.ok(h.w === SPIKE.w);
    }
  });
});

// ---------- Powerups ----------

test('shield-nook: Schild auf einer erhöhten kleinen Wolke, mit einem Sprung erreichbar', () => {
  each('shield-nook', (st) => {
    const [g] = route(st);
    assert.equal(st.powerups.length, 1);
    const p = st.powerups[0];
    assert.equal(p.type, 'shield');
    const nook = st.platforms.find((x) => x !== g);
    assert.ok(nook && nook.w <= 120 && !nook.ground);
    assert.ok(g.y - nook.y >= 60 && g.y - nook.y <= 75, `Höhe ${g.y - nook.y}`);
    assert.ok(hopOk(g, nook, { safe: safeFor(1) }), 'Nische nicht mit einem Sprung erreichbar');
    assert.ok(g.y - nook.y < maxRise());
    assert.ok(p.x > nook.x && p.x < nook.x + nook.w && p.y < nook.y, 'Schild liegt nicht auf der Nische');
    assert.ok(nook.x > g.x + 60 && nook.x + nook.w < g.x + g.w - 60, 'Nische steht über der Plattform');
  });
});

test('rest-garden: viele Sterne und eine freiwillige Traumfeder auf einer Wolke abseits der Route', () => {
  each('rest-garden', (st) => {
    assert.equal(st.powerups.length, 1);
    const f = st.powerups[0];
    assert.equal(f.type, 'feather');
    const r = route(st);
    const nook = st.platforms.find((p) => !r.includes(p));
    assert.ok(nook && f.x > nook.x && f.x < nook.x + nook.w && f.y < nook.y);
    const below = r.filter((p) => p.x + p.w > nook.x - 20 && p.x < nook.x + nook.w + 20);
    assert.ok(below.some((p) => hopOk(p, nook, { safe: safeFor(1) })), 'Feder nicht mit einem Sprung erreichbar');
    assert.ok(st.stars.length >= 18, `nur ${st.stars.length} Sterne`);
    for (let i = 1; i < r.length; i++) assert.ok(gapBetween(r[i - 1], r[i]) < 44, 'ruhiger Chunk ohne echte Lücken');
  });
});

// ---------- Bewegliche Plattformen und Regen ----------

test('moving-ferry: ohne Fähre nicht mit einem Sprung überbrückbar, mit Fähre in jeder Phase sicher', () => {
  for (const diff of [1, 2, 3]) {
    for (const seed of SEEDS) {
      const r = build('moving-ferry', seed, { diff, meter: 1700 });
      assert.deepEqual(r.errors, [], `diff ${diff} Seed ${seed}`);
      const [a, m, x] = route(r.st);
      assert.equal(route(r.st).length, 3);
      assert.equal(m.kind, 'moving');
      assert.ok(m.ax >= 40 && m.ay === 0, 'Fähre schwingt waagerecht');
      assert.ok(Math.abs(m.ax) <= 66 && (Math.PI * 2) / m.omega >= 3.2);
      // Ohne Fähre: auch mit vollem Sicherheitsanteil unmöglich
      assert.equal(hopOk(a, x, { safe: 1 }), false, 'Lücke ist ohne Fähre zu überbrücken');
      assert.ok(hopRatio(a, x) > 1.05, `Lücke zu klein: Verhältnis ${hopRatio(a, x).toFixed(2)}`);
      // Mit Fähre: in jeder Phase beide Sprünge sicher, und nie überlappend
      const safe = safeFor(diff);
      for (let k = 0; k < PHASES; k++) {
        const p = at(m, k, PHASES);
        assert.ok(hopOk(a, p, { safe }), `Einstieg zur Fähre in Phase ${k}`);
        assert.ok(hopOk(p, x, { safe }), `Fähre zum Ausstieg in Phase ${k}`);
        assert.ok(p.x - (a.x + a.w) >= 20 && x.x - (p.x + p.w) >= 20, `Fähre kommt in Phase ${k} den Kanten zu nah`);
      }
    }
  }
});

test('moving-lift: Ziel liegt höher als ein Sprung reicht, der Aufzug erreicht es und ist erreichbar', () => {
  for (const diff of [1, 2, 3]) {
    for (const seed of SEEDS) {
      const r = build('moving-lift', seed, { diff, meter: 1700 });
      assert.deepEqual(r.errors, [], `diff ${diff} Seed ${seed}`);
      const [a, lift, t] = route(r.st);
      assert.equal(lift.kind, 'moving');
      assert.ok(lift.ax === 0 && lift.ay >= 40, 'Aufzug schwingt senkrecht');
      assert.ok(a.y - t.y > maxRise(), 'Ziel ist mit einem Sprung zu erreichen');
      assert.equal(hopRatio(a, t), Infinity);
      const safe = safeFor(diff);
      let up = 0;
      let down = 0;
      for (let k = 0; k < PHASES; k++) {
        const p = at(lift, k, PHASES);
        if (hopOk(p, t, { safe })) up++;
        if (hopOk(a, p, { safe })) down++;
      }
      assert.ok(up / PHASES >= 0.4, `nur ${up} von ${PHASES} Phasen erlauben den Sprung zum Ziel`);
      assert.ok(down / PHASES >= 0.6, `nur ${down} von ${PHASES} Phasen erlauben den Einstieg`);
      const column = r.st.stars.filter((s) => Math.abs(s.x - (lift.ox + lift.w / 2)) < 2);
      assert.ok(column.length >= 4, 'Sterne entlang des Aufzugs fehlen');
    }
  }
});

test('moving-steps: Fähre, feste Wolke und Aufzug, jeder Sprung in jeder Phase sicher', () => {
  for (const diff of [1, 2.5]) {
    for (const seed of SEEDS) {
      const r = build('moving-steps', seed, { diff, meter: 1700 });
      assert.deepEqual(r.errors, [], `diff ${diff} Seed ${seed}`);
      const rt = route(r.st);
      assert.deepEqual(rt.map((p) => p.kind), ['static', 'moving', 'static', 'moving', 'static']);
      const safe = safeFor(diff);
      for (let i = 0; i < rt.length - 1; i++) {
        for (let k = 0; k < PHASES; k++) {
          const from = rt[i].kind === 'moving' ? at(rt[i], k, PHASES) : rt[i];
          const to = rt[i + 1].kind === 'moving' ? at(rt[i + 1], k, PHASES) : rt[i + 1];
          assert.ok(hopOk(from, to, { safe }), `Sprung ${i} in Phase ${k} bei diff ${diff}`);
        }
      }
    }
  }
});

test('rain-meadow: Regenwolke über einer breiten Plattform, kleine Lücke dahinter', () => {
  each('rain-meadow', (st) => {
    const [g, x] = route(st);
    assert.equal(st.zones.length, 1);
    const z = st.zones[0];
    assert.equal(z.kind, 'rain');
    assert.ok(g.w >= 560);
    const overlap = Math.min(z.x + z.w, g.x + g.w) - Math.max(z.x, g.x);
    assert.ok(overlap >= 220, `Regen deckt nur ${Math.round(overlap)} px der Plattform`);
    const gap = gapBetween(g, x);
    assert.ok(gap >= 44 && gap <= 125, `Lücke ${gap}`);
    assert.ok(st.stars.filter((s) => onTop(g, s)).length >= 6);
    assert.ok(z.timer >= 0 && z.timer < z.onTime + z.offTime);
  });
});

// ---------- Optionaler Zweig ----------

test('star-ladder: Hauptroute bleibt unten, die Leiter führt mit einfachen Sprüngen zu einem hohen Sternenpfad', () => {
  for (const diff of [1, 2, 3]) {
    for (const seed of SEEDS) {
      const r = build('star-ladder', seed, { diff, meter: 1700 });
      assert.deepEqual(r.errors, [], `diff ${diff} Seed ${seed}`);
      const { st } = r;
      const main = route(st);
      const top = Math.min(...main.map((p) => p.y));
      assert.ok(main.every((p) => Math.abs(p.y - main[0].y) <= 8), 'Hauptroute muss unten bleiben');
      const ladder = st.platforms.filter((p) => !main.includes(p)).sort((p, q) => q.y - p.y);
      assert.equal(ladder.length, 3);
      assert.ok(top - ladder[2].y >= 110, 'Leiter reicht nicht hoch genug');
      const safe = safeFor(diff);
      assert.ok(hopOk(main[0], ladder[0], { safe }), 'Einstieg zur ersten Sprosse');
      assert.ok(hopOk(ladder[0], ladder[1], { safe }) && hopOk(ladder[1], ladder[2], { safe }), 'Sprossen untereinander');
      assert.ok(hopOk(ladder[2], main[2], { safe }), 'Abstieg zum Ausstieg');
      const extra = st.stars.filter((s) => s.y < top - 90 && s.x >= ladder[2].x && s.x <= ladder[2].x + ladder[2].w);
      assert.ok(extra.length >= 6, 'Extra Sterne oben fehlen');
    }
  }
});

// ---------- Spezial Chunks ----------

test('flat: ruhiger Fallback mit einer breiten Plattform und Sternen', () => {
  each('flat', (st) => {
    assert.equal(route(st).length, 1);
    assert.ok(route(st)[0].w >= 480);
    assert.ok(st.enemies.length === 0 && st.hazards.length === 0 && st.powerups.length === 0);
    assert.ok(st.stars.length >= 5);
  });
  assert.equal(FLAT.rest, true);
});

test('gate: breite ebene Plattform mit dem Tor in der Mitte und Sternen drumherum', () => {
  each('gate', (st) => {
    const [g] = route(st);
    assert.equal(route(st).length, 1);
    assert.ok(g.w >= 600 && g.w <= 700, `Breite ${g.w}`);
    assert.equal(st.gates.length, 1);
    const gate = st.gates[0];
    assert.equal(gate.index, 1);
    assert.ok(Math.abs(gate.x - (g.x + g.w / 2)) < 1, 'Tor muss in der Mitte stehen');
    assert.equal(gate.y, g.y);
    assert.ok(st.enemies.length === 0 && st.hazards.length === 0 && st.zones.length === 0 && st.powerups.length === 0);
    assert.ok(st.stars.length >= 15);
    const left = st.stars.filter((s) => s.x < gate.x - gate.w / 2).length;
    const right = st.stars.filter((s) => s.x > gate.x + gate.w / 2).length;
    assert.ok(left >= 6 && right >= 6, 'Sterne müssen das Tor beidseitig umgeben');
    // Kein Stern darf im Ring (Ellipse um die Torfläche, mit 8 px Rand) liegen
    for (const s of st.stars) {
      const nx = (s.x - gate.x) / (gate.w / 2 + 8);
      const ny = (s.y - (gate.y - gate.h / 2)) / (gate.h / 2 + 8);
      assert.ok(nx * nx + ny * ny >= 1, `Stern (${Math.round(s.x - gate.x)}, ${Math.round(s.y - gate.y)}) im Torring`);
    }
  });
  assert.equal(GATE.special, 'gate');
  assert.equal(GATE.rest, true);
});

// ---------- Spielbarkeit mit der echten Physik ----------
// Ein Vorausschau Bot (wie tests/bot.mjs, aber nur für einen einzelnen Chunk) läuft vom Einstieg über das
// Layout bis auf eine breite Plattform hinter dem Ausstieg. Er probiert Eingabeskripte auf einer Kopie des Zustands
// und bleibt bei jedem Treffer oder Sturz hängen. Das fängt Fehler ab, die die reine Geometrie nicht sieht:
// Gegnerwege, Stachelwolken, Regen und bewegliche Plattformen.

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
  for (const c of ALL) {
    for (const seed of [1, 2, 3]) assert.equal(playThrough(c, seed), null, `${c.id} Seed ${seed}`);
  }
});

test('Spielbarkeit: der Bot scheitert zu Recht an einem unmöglichen Chunk (Kontrolle)', () => {
  const gapTooWide = { build(bd) { const a = bd.ground(0, 0, 240); bd.route(a, bd.ground(a.w + 520, 0, 240)); } };
  const spikeWall = { build(bd) { const a = bd.ground(0, 0, 900); for (let i = 0; i < 10; i++) bd.spike(a, 0.3 + i * 0.045); bd.route(a); } };
  for (const c of [gapTooWide, spikeWall]) assert.notEqual(playThrough({ ...c, diff: 2, min: 1700 }, 1), null);
});
