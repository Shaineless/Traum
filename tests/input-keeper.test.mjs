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
