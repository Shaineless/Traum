import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE, MAX_LIVES, SCORE, STEP, WORLDS, W } from '../game/constants.js';
import { createGate } from '../game/entities.js';
import { createState } from '../game/state.js';
import { emit } from '../game/particles.js';
import { themeAt } from '../game/theme.js';
import { updateGates } from '../game/gates.js';
import { stepSim } from '../game/sim.js';
import { input, newGame } from './helpers.mjs';

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
  for (let i = 0; i < 240 && !g.passed; i++) stepSim(s, input({ move: 1 }), STEP);
  assert.equal(g.passed, true);
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
