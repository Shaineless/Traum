import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, FLAT, GATE } from '../game/chunks/index.js';
import { checkChunk } from './chunk-harness.mjs';

test('mindestens 28 Chunk Layouts', () => {
  assert.ok(CHUNKS.length >= 28, `nur ${CHUNKS.length} Chunks`);
});

test('Chunk IDs sind eindeutig', () => {
  const ids = [...CHUNKS, FLAT, GATE].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const chunk of [...CHUNKS, FLAT, GATE]) {
  test(`Chunk ${chunk.id} ist fair, deterministisch und gültig`, () => {
    assert.deepEqual(checkChunk(chunk), []);
  });
}
