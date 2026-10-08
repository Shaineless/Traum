import test from 'node:test';
import assert from 'node:assert/strict';
import { input, invariants, newGame, run } from './helpers.mjs';

test('Spiel läuft 20 Sekunden ohne Fehler und mit gültigen Invarianten', () => {
  const s = newGame(7);
  run(s, 60 * 20, (st, i) => input({ move: 1, jumpPressed: i % 40 === 0, jumpHeld: i % 40 < 25 }));
  assert.deepEqual(invariants(s), []);
});

test('mehrere Seeds laufen stabil', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = newGame(seed);
    run(s, 60 * 8, (st, i) => input({ move: i % 300 < 200 ? 1 : -1, jumpPressed: i % 33 === 0, jumpHeld: i % 33 < 20, dashPressed: i % 97 === 0 }));
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});
