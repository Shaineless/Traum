import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputKeeper } from '../game/input-keeper.js';

const frame = (o = {}) => ({ move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, ...o });

test('Sprung in einem Bild ohne Simulationsschritt geht nicht verloren (Bildschirm mit 144 Hz)', () => {
  const k = createInputKeeper();
  // Bild 1: Taste gedrückt, aber es läuft kein Schritt
  k.add(frame({ move: 1, jumpPressed: true, jumpHeld: true }));
  // Bild 2: Taste schon losgelassen, jetzt läuft ein Schritt
  const p2 = frame({ move: 1 });
  k.add(p2);
  const step = k.first(p2);
  assert.equal(step.jumpPressed, true);
  assert.equal(step.jumpHeld, true, 'ein kurzer Tipp soll nicht zu einem Mini Hüpfer werden');
  assert.equal(step.move, 1);
});

test('der Druck wird nur einmal abgeholt', () => {
  const k = createInputKeeper();
  const p = frame({ jumpPressed: true, jumpHeld: true });
  k.add(p);
  assert.equal(k.first(p).jumpPressed, true);
  const q = frame({ jumpHeld: true });
  k.add(q);
  assert.equal(k.first(q).jumpPressed, false);
});

test('weitere Schritte im selben Bild bekommen keinen neuen Druck', () => {
  const k = createInputKeeper();
  const p = frame({ jumpPressed: true, jumpHeld: true, dashPressed: true });
  k.add(p);
  assert.equal(k.first(p).dashPressed, true);
  const r = k.rest(p);
  assert.equal(r.jumpPressed, false);
  assert.equal(r.dashPressed, false);
  assert.equal(r.jumpHeld, true);
});

test('Dash Druck wird ebenfalls gemerkt', () => {
  const k = createInputKeeper();
  k.add(frame({ dashPressed: true }));
  const p = frame();
  k.add(p);
  assert.equal(k.first(p).dashPressed, true);
});

import { createState } from '../game/state.js';
import { initGenerator } from '../game/generator.js';
import { stepSim } from '../game/sim.js';
import { PHYS, STEP } from '../game/constants.js';

test('ein Sprung während des Hitstops geht nicht verloren', () => {
  const s = createState({ seed: 3 });
  initGenerator(s);
  for (let i = 0; i < 40; i++) stepSim(s, frame(), STEP); // landen
  assert.equal(s.player.onGround, true);
  s.fx.hitstop = 0.05;
  stepSim(s, frame({ jumpPressed: true, jumpHeld: true }), STEP);
  assert.ok(s.player.buffer > 0, 'der Sprung bleibt im Puffer');
  assert.ok(PHYS.JUMP_BUFFER > 0);
  for (let i = 0; i < 6; i++) stepSim(s, frame({ jumpHeld: true }), STEP);
  assert.ok(s.player.vy < -100 || !s.player.onGround, 'Nimbus springt nach dem Hitstop');
});
