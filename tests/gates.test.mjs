import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, GATE, MAX_LIVES, SCORE, STEP, WORLDS, W } from '../game/constants.js';
import { createGate } from '../game/entities.js';
import { createState } from '../game/state.js';
import { emit } from '../game/particles.js';
import { themeAt } from '../game/theme.js';
import { updateGates } from '../game/gates.js';
import { stepSim } from '../game/sim.js';
import { input, invariants, newGame } from './helpers.mjs';

// ---------- Hilfen ----------

// Partikel kommen aus einem anderen Modul. Solange dort noch ein Stub liegt, entfallen nur diese Prüfungen.
const REAL_PARTICLES = (() => {
  const s = createState();
  emit(s, 'poof', 0, 0);
  return s.particles.length > 0;
})();
const needsParticles = REAL_PARTICLES ? false : 'particles.js ist noch ein Stub (emit)';

function world() {
  const s = createState({ seed: 4 });
  s.camX = 0;
  s.player.x = 100;
  s.player.y = 300;
  return s;
}

function gate(s, x, index = 1, y = 360) {
  const g = createGate(s, x, y, index);
  s.gates.push(g);
  return g;
}

// Stellt den Mittelpunkt des Spielers auf x
const standAt = (s, x) => { s.player.x = x - s.player.w / 2; };

function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateGates(s, STEP);
  }
}

// ---------- Durchqueren ----------

test('Tor wird erst passiert, wenn die Spielermitte die Tormitte erreicht', () => {
  const s = world();
  const g = gate(s, 500);
  standAt(s, 499.9);
  tick(s, 5);
  assert.equal(g.passed, false);
  assert.equal(s.run.bonus, 0);
  assert.equal(s.world.gatesPassed, 0);
  standAt(s, 500);
  tick(s);
  assert.equal(g.passed, true);
  assert.equal(s.world.gatesPassed, 1);
});

test('die Höhe des Spielers ist egal', () => {
  for (const y of [-400, 0, 300, 600]) {
    const s = world();
    const g = gate(s, 500);
    s.player.y = y;
    standAt(s, 520);
    tick(s);
    assert.equal(g.passed, true, `y ${y}`);
  }
});

test('jedes Tor wirkt nur einmal, auch beim Hin und Herlaufen', () => {
  const s = world();
  const g = gate(s, 500, 2);
  for (let i = 0; i < 6; i++) {
    standAt(s, i % 2 ? 450 : 560);
    tick(s, 3);
  }
  assert.equal(g.passed, true);
  assert.equal(s.run.bonus, SCORE.GATE * 2);
  assert.equal(s.world.gatesPassed, 1);
  assert.equal(s.banner.text, 'Traumwelt 2');
});

test('ein bereits passiertes Tor wird nie wieder ausgelöst', () => {
  const s = world();
  const g = gate(s, 500);
  g.passed = true;
  standAt(s, 600);
  tick(s, 10);
  assert.equal(s.world.gatesPassed, 0);
  assert.equal(s.run.bonus, 0);
  assert.equal(s.banner, null);
});

test('ein toter Spieler passiert kein Tor', () => {
  const s = world();
  const g = gate(s, 500);
  s.player.dead = true;
  s.lives = 1;
  standAt(s, 600);
  tick(s, 10);
  assert.equal(g.passed, false);
  assert.equal(s.lives, 1);
  assert.equal(s.run.bonus, 0);
});

test('zwei Tore im selben Schritt werden beide einmal gezählt', () => {
  const s = world();
  const a = gate(s, 500, 1);
  const b = gate(s, 700, 2);
  standAt(s, 900);
  tick(s);
  assert.equal(a.passed && b.passed, true);
  assert.equal(s.world.gatesPassed, 2);
  assert.equal(s.run.bonus, SCORE.GATE * 3);
  assert.equal(s.world.index, 2);
  assert.equal(s.world.from, 1);
});

test('ohne Tore und bei kaputter Zeit passiert nichts', () => {
  const s = world();
  const g = gate(s, 500);
  standAt(s, 900);
  const before = structuredClone(s);
  for (const dt of [0, -1, NaN, undefined]) updateGates(s, dt);
  assert.deepEqual(s, before);
  assert.equal(g.passed, false);
  const empty = world();
  assert.doesNotThrow(() => tick(empty, 5));
});

// ---------- Bonus und Heilung ----------

test('Bonus ist SCORE.GATE mal Nummer des Tors', () => {
  for (const index of [1, 2, 3, 7]) {
    const s = world();
    gate(s, 500, index);
    standAt(s, 500);
    tick(s);
    assert.equal(s.run.bonus, SCORE.GATE * index);
  }
});

test('Popup zeigt den Bonus', () => {
  const s = world();
  gate(s, 500, 3);
  standAt(s, 500);
  tick(s);
  assert.ok(s.popups.some((p) => p.text === '+300'));
});

test('ein Leben dazu, aber nie über MAX_LIVES', () => {
  for (let lives = 1; lives <= MAX_LIVES; lives++) {
    const s = world();
    s.lives = lives;
    gate(s, 500);
    standAt(s, 500);
    tick(s);
    assert.equal(s.lives, Math.min(MAX_LIVES, lives + GATE.HEAL), `Leben ${lives}`);
  }
});

test('Popup Heilung nur, wenn wirklich ein Leben dazukommt', () => {
  const hurt = world();
  hurt.lives = 2;
  gate(hurt, 500);
  standAt(hurt, 500);
  tick(hurt);
  assert.ok(hurt.popups.some((p) => p.text === '+1 Leben'));
  const full = world();
  gate(full, 500);
  standAt(full, 500);
  tick(full);
  assert.equal(full.lives, MAX_LIVES);
  assert.ok(!full.popups.some((p) => p.text === '+1 Leben'));
});

test('GATE.HEAL heilt nie über MAX_LIVES hinaus, auch bei einem größeren Wert', () => {
  const old = GATE.HEAL;
  try {
    GATE.HEAL = 5;
    for (let lives = 1; lives <= MAX_LIVES; lives++) {
      const s = world();
      s.lives = lives;
      gate(s, 500);
      standAt(s, 500);
      tick(s);
      assert.equal(s.lives, MAX_LIVES, `Leben ${lives}`);
    }
  } finally {
    GATE.HEAL = old;
  }
});

test('wer schon mehr als MAX_LIVES hat, verliert nichts und bekommt nichts', () => {
  const s = world();
  s.lives = MAX_LIVES + 2;
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.equal(s.lives, MAX_LIVES + 2);
  assert.ok(!s.popups.some((p) => p.text === '+1 Leben'));
});

test('kaputte Leben (NaN) werden nicht geheilt und nicht noch kaputter', () => {
  const s = world();
  s.lives = NaN;
  gate(s, 500);
  standAt(s, 500);
  assert.doesNotThrow(() => tick(s));
  assert.ok(Number.isNaN(s.lives));
  assert.equal(s.world.gatesPassed, 1);
});

// ---------- Wurfstern ----------

test('das Tor gibt einen Wurfstern, aber nie mehr als ABILITY.AMMO.MAX', () => {
  for (let ammo = 0; ammo <= ABILITY.AMMO.MAX; ammo++) {
    const s = world();
    s.player.ammo = ammo;
    gate(s, 500);
    standAt(s, 500);
    tick(s);
    assert.equal(s.player.ammo, Math.min(ABILITY.AMMO.MAX, ammo + 1), `Vorrat ${ammo}`);
    assert.equal(s.popups.some((p) => p.text === '+1 Wurfstern'), ammo < ABILITY.AMMO.MAX, `Popup bei Vorrat ${ammo}`);
  }
});

test('Wurfstern vom Tor: Ladestand bleibt, bis der Vorrat voll ist, dann wird er zurückgesetzt', () => {
  const half = world();
  half.player.starAcc = 7;
  gate(half, 500);
  standAt(half, 500);
  tick(half);
  assert.equal(half.player.ammo, 1);
  assert.equal(half.player.starAcc, 7, 'die gesammelten Sterne bleiben erhalten');

  const filled = world();
  filled.player.ammo = ABILITY.AMMO.MAX - 1;
  filled.player.starAcc = 7;
  gate(filled, 500);
  standAt(filled, 500);
  tick(filled);
  assert.equal(filled.player.ammo, ABILITY.AMMO.MAX);
  assert.equal(filled.player.starAcc, 0, 'wie in chargeAmmo');

  const full = world();
  full.player.ammo = ABILITY.AMMO.MAX;
  full.player.starAcc = 4;
  gate(full, 500);
  standAt(full, 500);
  tick(full);
  assert.equal(full.player.ammo, ABILITY.AMMO.MAX);
  assert.equal(full.player.starAcc, 0);
});

test('kaputter Vorrat (NaN, fehlt) wird wie 0 behandelt', () => {
  for (const bad of [NaN, undefined, -4]) {
    const s = world();
    s.player.ammo = bad;
    gate(s, 500);
    standAt(s, 500);
    tick(s);
    assert.ok(Number.isFinite(s.player.ammo), `Vorrat ${bad}`);
    assert.ok(s.player.ammo >= 0 && s.player.ammo <= ABILITY.AMMO.MAX);
  }
});

test('jedes Tor gibt einen eigenen Wurfstern, auch mehrere im selben Schritt', () => {
  const s = world();
  gate(s, 500, 1);
  gate(s, 700, 2);
  gate(s, 900, 3);
  gate(s, 1100, 4);
  standAt(s, 1200);
  tick(s);
  assert.equal(s.world.gatesPassed, 4);
  assert.equal(s.player.ammo, ABILITY.AMMO.MAX);
  assert.equal(s.lives, MAX_LIVES);
  assert.ok(s.popups.length <= 10);
});

test('der Wurfstern vom Tor lässt sich werfen', () => {
  const s = newGame(3);
  const p = s.player;
  p.ammo = 0;
  const g = createGate(s, p.x + p.w / 2 + 10, 360, 1);
  s.gates.push(g);
  stepSim(s, input({ move: 1 }), STEP);
  for (let i = 0; i < 20 && !g.passed; i++) stepSim(s, input({ move: 1 }), STEP);
  assert.equal(g.passed, true);
  assert.ok(p.ammo >= 1);
  const ammo = p.ammo;
  for (let i = 0; i < 5; i++) stepSim(s, input({ throwPressed: i === 0 }), STEP);
  assert.equal(p.ammo, ammo - 1, 'der Stern vom Tor ist ein ganz normaler Wurfstern');
  assert.equal(s.shots.length, 1);
});

// ---------- Töne ----------

test('das Tor spielt den Ton gate, genau einmal pro Tor', () => {
  const s = world();
  const g = gate(s, 500);
  standAt(s, 499);
  tick(s, 5);
  assert.equal(s.sfx.length, 0, 'vor dem Tor bleibt es still');
  standAt(s, 520);
  tick(s);
  assert.deepEqual(s.sfx.map((e) => e.n), ['gate']);
  tick(s, 30);
  assert.equal(s.sfx.length, 1, 'ein passiertes Tor spielt nichts mehr');
  assert.equal(g.passed, true);
  gate(s, 700, 2);
  gate(s, 800, 3);
  standAt(s, 900);
  tick(s);
  assert.equal(s.sfx.filter((e) => e.n === 'gate').length, 3);
});

test('ein toter Spieler löst keinen Ton aus', () => {
  const s = world();
  gate(s, 500);
  s.player.dead = true;
  standAt(s, 600);
  tick(s, 5);
  assert.equal(s.sfx.length, 0);
});

// ---------- Doppelpunkte ----------

test('Doppelpunkte verdoppeln den Torbonus, das Popup zeigt den echten Wert', () => {
  const s = world();
  s.player.power.double = 5;
  gate(s, 500, 2);
  standAt(s, 500);
  tick(s);
  assert.equal(s.run.bonus, SCORE.GATE * 2 * 2);
  assert.ok(s.popups.some((p) => p.text === `+${SCORE.GATE * 4}`));
  assert.ok(!s.popups.some((p) => p.text === `+${SCORE.GATE * 2}`));
});

// ---------- Weltwechsel ----------

test('Weltwechsel setzt from, to, index und startet das Blenden', () => {
  const s = world();
  assert.deepEqual(s.world, { index: 0, from: 0, to: 0, blend: 1, gatesPassed: 0 });
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.deepEqual(s.world, { index: 1, from: 0, to: 1, blend: 0, gatesPassed: 1 });
});

test('blend wächst in 3 Sekunden von 0 auf 1 und bleibt dann bei 1', () => {
  const s = world();
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.equal(s.world.blend, 0);
  tick(s, 90);
  assert.ok(Math.abs(s.world.blend - 0.5) < 1e-9, `blend ${s.world.blend}`);
  tick(s, 89);
  assert.ok(s.world.blend < 1);
  tick(s, 2);
  assert.equal(s.world.blend, 1);
  tick(s, 100);
  assert.equal(s.world.blend, 1);
});

test('blend steigt gleichmäßig und nie rückwärts', () => {
  const s = world();
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  let last = s.world.blend;
  for (let i = 0; i < 200; i++) {
    tick(s);
    assert.ok(s.world.blend >= last);
    assert.ok(Math.abs(s.world.blend - last - STEP / 3) < 1e-9 || s.world.blend === 1);
    last = s.world.blend;
  }
});

test('die Farben wechseln mit dem Blenden von einer Welt zur nächsten', () => {
  const s = world();
  gate(s, 500);
  assert.equal(themeAt(s.world).name, WORLDS[0].name);
  standAt(s, 500);
  tick(s);
  assert.equal(themeAt(s.world).name, WORLDS[0].name);
  tick(s, 100);
  assert.equal(themeAt(s.world).name, WORLDS[1].name);
  tick(s, 100);
  assert.equal(themeAt(s.world).index, 1);
  assert.deepEqual(themeAt(s.world).sky, WORLDS[1].sky, 'am Ende des Blendens sind es genau die Farben der neuen Welt');
});

test('nach vier Toren beginnt der Kreis von vorn, die Nummer zählt weiter', () => {
  const s = world();
  const names = [];
  for (let i = 1; i <= 5; i++) {
    gate(s, 500 * i, i);
    standAt(s, 500 * i);
    tick(s);
    names.push([s.banner.text, s.banner.sub, s.world.index, s.world.from, s.world.to]);
    tick(s, 200);
  }
  assert.deepEqual(names, [
    ['Traumwelt 2', WORLDS[1].name, 1, 0, 1],
    ['Traumwelt 3', WORLDS[2].name, 2, 1, 2],
    ['Traumwelt 4', WORLDS[3].name, 3, 2, 3],
    ['Traumwelt 5', WORLDS[0].name, 0, 3, 0],
    ['Traumwelt 6', WORLDS[1].name, 1, 0, 1],
  ]);
  assert.equal(s.world.gatesPassed, 5);
});

test('Banner nennt die Traumwelt und enthält keine Striche als Satzzeichen', () => {
  const s = world();
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.equal(s.banner.text, 'Traumwelt 2');
  assert.equal(s.banner.sub, 'Lila Traumhimmel');
  assert.ok(s.banner.dur > 2);
  assert.ok(![ '-', String.fromCharCode(0x2013), String.fromCharCode(0x2014) ].some((d) => (s.banner.text + s.banner.sub).includes(d)));
});

// ---------- Effekte und Respawn ----------

test('weißer Flash, leichtes Wackeln und Partikel', () => {
  const s = world();
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.ok(s.fx.flash > 0.3 && s.fx.flash <= 1);
  assert.equal(s.fx.flashColor, '#ffffff');
  assert.ok(s.fx.shake > 0 && s.fx.shake <= 4, `shake ${s.fx.shake}`);
});

test('Tor erzeugt Partikel', { skip: needsParticles }, () => {
  const s = world();
  gate(s, 500);
  standAt(s, 500);
  tick(s);
  assert.ok(s.particles.length > 0);
});

test('der Respawn Punkt liegt danach am Tor', () => {
  const s = world();
  const g = gate(s, 640, 1, 330);
  standAt(s, 650);
  tick(s);
  assert.deepEqual(s.respawn, { x: g.x - s.player.w / 2, y: g.y - s.player.h });
});

test('ein früheres Tor ändert den Respawn Punkt nicht mehr rückwirkend', () => {
  const s = world();
  gate(s, 500);
  const later = gate(s, 1100, 2, 320);
  standAt(s, 500);
  tick(s);
  const first = { ...s.respawn };
  standAt(s, 1100);
  tick(s);
  assert.notDeepEqual(s.respawn, first);
  assert.deepEqual(s.respawn, { x: later.x - s.player.w / 2, y: later.y - s.player.h });
});

// ---------- Animation ----------

test('anim läuft für Tore im Bild und ruht weit außerhalb', () => {
  const s = world();
  const near = gate(s, 400);
  const far = gate(s, W + 2000);
  const behind = gate(s, -900);
  behind.passed = true;
  tick(s, 60);
  assert.ok(Math.abs(near.anim - 1) < 1e-9);
  assert.equal(far.anim, 0);
  assert.equal(behind.anim, 0);
  near.passed = true;
  tick(s, 60);
  assert.ok(Math.abs(near.anim - 2) < 1e-9, 'läuft nach dem Durchqueren weiter');
});

// ---------- Im Spiel ----------

test('im Spiel: Tor vor dem Spieler wird beim Hinlaufen genau einmal passiert', () => {
  const s = newGame(2);
  const p = s.player;
  const g = createGate(s, p.x + p.w / 2 + 250, 360, 1);
  s.gates.push(g);
  s.lives = MAX_LIVES - 1;
  s.player.ammo = 0;
  let ammoBefore = 0;
  for (let i = 0; i < 240 && !g.passed; i++) {
    ammoBefore = s.player.ammo;
    stepSim(s, input({ move: 1 }), STEP);
  }
  assert.equal(g.passed, true);
  assert.ok(s.player.ammo >= Math.min(ABILITY.AMMO.MAX, ammoBefore + 1), 'ein Wurfstern vom Tor');
  assert.ok(s.sfx.some((e) => e.n === 'gate'));
  assert.equal(s.world.gatesPassed, 1);
  assert.equal(s.world.index, 1);
  assert.equal(s.world.blend, 0);
  assert.equal(s.lives, MAX_LIVES);
  assert.ok(s.run.bonus >= SCORE.GATE);
  for (let i = 0; i < 30; i++) stepSim(s, input({ move: 1 }), STEP);
  assert.ok(s.world.blend > 0.15 && s.world.blend < 0.2, `blend ${s.world.blend}`);
  assert.equal(s.world.gatesPassed, 1);
  assert.doesNotThrow(() => structuredClone(s));
});

// ---------- Fuzz ----------

// Kleiner eigener Zufall nur für die Tests (mulberry32), die Spiellogik bleibt unberührt
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function fuzzGates(seed, steps = 600) {
  const r = prng(seed);
  const rr = (a, b) => a + r() * (b - a);
  const s = world();
  s.lives = 1 + Math.floor(r() * MAX_LIVES);
  s.player.ammo = Math.floor(r() * (ABILITY.AMMO.MAX + 1));
  s.player.starAcc = Math.floor(r() * 9);
  if (r() < 0.5) s.player.power.double = rr(0, 12);
  let x = 300;
  for (let n = 1; n <= 12; n++) {
    x += rr(60, 400);
    gate(s, x, n, rr(250, 380));
  }
  standAt(s, 100);
  const dts = [STEP, STEP, STEP, 1 / 30, 0.1, 0.5];
  let lastPassed = null;
  for (let i = 0; i < steps; i++) {
    standAt(s, s.player.x + s.player.w / 2 + (r() < 0.1 ? rr(-80, 0) : rr(0, 24)));
    s.player.y = rr(-100, 500);
    if (r() < 0.02) s.player.dead = !s.player.dead;
    s.sfx.length = 0;
    const dt = r() < 0.04 ? [0, -1, NaN][Math.floor(r() * 3)] : dts[Math.floor(r() * dts.length)];
    const valid = dt > 0;
    const cx = s.player.x + s.player.w / 2;
    const alive = !s.player.dead;
    const mult = s.player.power.double > 0 ? 2 : 1;
    const before = { lives: s.lives, ammo: s.player.ammo, bonus: s.run.bonus, passed: s.world.gatesPassed, blend: s.world.blend };
    // Modell: alle noch nicht passierten Tore links der Spielermitte, in Listenreihenfolge
    const hit = valid && alive ? s.gates.filter((g) => !g.passed && cx >= g.x) : [];
    let lives = before.lives;
    let ammo = before.ammo;
    let bonus = before.bonus;
    for (const g of hit) {
      bonus += SCORE.GATE * g.index * mult;
      if (lives < MAX_LIVES) lives = Math.min(MAX_LIVES, lives + GATE.HEAL);
      if (ammo < ABILITY.AMMO.MAX) ammo += 1;
    }
    const frozen = valid ? null : structuredClone(s);

    s.t += valid ? dt : 0;
    updateGates(s, dt);

    if (!valid) {
      assert.deepEqual(s, frozen, 'ungültige Zeit verändert nichts');
      continue;
    }
    assert.equal(s.world.gatesPassed - before.passed, hit.length, `Schritt ${i}`);
    for (const g of hit) assert.equal(g.passed, true);
    assert.equal(s.lives, lives);
    assert.equal(s.player.ammo, ammo);
    assert.equal(s.run.bonus, bonus);
    assert.equal(s.sfx.filter((e) => e.n === 'gate').length, hit.length);
    assert.ok(s.player.ammo >= 0 && s.player.ammo <= ABILITY.AMMO.MAX && Number.isInteger(s.player.ammo));
    assert.ok(s.lives >= 1 && s.lives <= MAX_LIVES);
    assert.equal(s.world.index, s.world.gatesPassed % WORLDS.length);
    assert.equal(s.world.to, s.world.index);
    assert.ok(s.world.blend >= 0 && s.world.blend <= 1);
    if (hit.length === 0) assert.ok(s.world.blend >= before.blend, 'blend fällt nie');
    if (hit.length > 0) {
      lastPassed = hit[hit.length - 1];
      assert.equal(s.banner.text, `Traumwelt ${s.world.gatesPassed + 1}`);
      assert.deepEqual(s.respawn, { x: lastPassed.x - s.player.w / 2, y: lastPassed.y - s.player.h });
    }
    assert.ok(s.popups.length <= 10);
    assert.ok(s.sfx.length <= 16);
  }
  assert.deepEqual(invariants(s), []);
  return s;
}

test('Fuzz: zufällige Läufe an Toren gegen ein einfaches Modell, kaputte Zeiten inklusive', () => {
  let passed = 0;
  for (let seed = 1; seed <= 40; seed++) passed += fuzzGates(seed).world.gatesPassed;
  assert.ok(passed > 200, `nur ${passed} Tore in 40 Läufen`);
});

test('Fuzz: gleicher Zufall gibt gleichen Endzustand', () => {
  assert.deepEqual(fuzzGates(9), fuzzGates(9));
});
