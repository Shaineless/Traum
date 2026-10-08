import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP } from '../game/constants.js';
import { createBreakablePlatform, createMovingPlatform, createStaticPlatform } from '../game/entities.js';
import { isSolid, onPlayerLand, platformById, updatePlatforms } from '../game/platforms.js';
import { platformAt } from '../game/reach.js';
import { createState } from '../game/state.js';

// Ein Schritt wie in sim.js: erst die Zeit, dann die Plattformen
function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updatePlatforms(s, STEP);
  }
}

test('isSolid und platformById', () => {
  const s = createState({ seed: 1 });
  const a = createStaticPlatform(s, 0, 300, 200);
  const b = createBreakablePlatform(s, 300, 300, 100);
  s.platforms.push(a, b);
  assert.equal(isSolid(a), true);
  assert.equal(isSolid(b), true);
  b.state = 'broken';
  assert.equal(isSolid(b), false);
  assert.equal(platformById(s, a.id), a);
  assert.equal(platformById(s, 9999), null);
  assert.equal(platformById(s, 0), null);
  assert.equal(isSolid(null), false);
});

test('bewegliche Plattform folgt platformAt, vx und vy sind analytisch, dx und dy sind die Differenz', () => {
  const s = createState({ seed: 1 });
  const m = createMovingPlatform(s, 500, 300, 120, { ax: 90, ay: 40, period: 2.5, phase: 0.7 });
  s.platforms.push(m);
  tick(s, 3);
  let lastX = m.x;
  let lastY = m.y;
  for (let i = 0; i < 400; i++) {
    tick(s);
    const want = platformAt(m, s.t);
    assert.ok(Math.abs(m.x - want.x) < 1e-9 && Math.abs(m.y - want.y) < 1e-9);
    assert.ok(Math.abs(m.dx - (m.x - lastX)) < 1e-9 && Math.abs(m.dy - (m.y - lastY)) < 1e-9);
    // Die analytische Geschwindigkeit stimmt mit der Verschiebung pro Sekunde überein (mittlerer Wert im Schritt)
    assert.ok(Math.abs(m.vx - m.dx / STEP) < 90 * m.omega * m.omega * STEP, 'vx passt zu dx');
    assert.ok(Math.abs(m.vy - m.dy / STEP) < 40 * m.omega * m.omega * STEP, 'vy passt zu dy');
    lastX = m.x;
    lastY = m.y;
  }
});

test('der erste Schritt einer beweglichen Plattform reißt nichts mit', () => {
  const s = createState({ seed: 1 });
  s.t = 123.4; // mitten im Spiel erzeugt
  const m = createMovingPlatform(s, 500, 300, 120, { ax: 90, ay: 40 });
  s.platforms.push(m);
  updatePlatforms(s, STEP);
  assert.equal(m.dx, 0);
  assert.equal(m.dy, 0);
  const want = platformAt(m, s.t);
  assert.ok(Math.abs(m.x - want.x) < 1e-9 && Math.abs(m.y - want.y) < 1e-9);
});

test('statische Plattformen bleiben unberührt', () => {
  const s = createState({ seed: 1 });
  const a = createStaticPlatform(s, 10, 300, 200);
  s.platforms.push(a);
  tick(s, 60);
  assert.deepEqual([a.x, a.y, a.dx, a.dy], [10, 300, 0, 0]);
});

test('brüchige Plattform bleibt ohne Spieler unverändert', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100);
  s.platforms.push(b);
  tick(s, 600);
  assert.equal(b.state, 'idle');
  assert.equal(b.alpha, 1);
  assert.equal(b.shakeX, 0);
});

test('brüchige Plattform: Zeitplan 0,4 s normal, bis 0,8 s wackeln, danach zerbrechen', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100);
  s.platforms.push(b);
  onPlayerLand(s, b);
  assert.equal(b.state, 'armed');

  let sawShake = false;
  let lastAlpha = 1;
  const log = [];
  for (let i = 1; i <= 60; i++) {
    tick(s);
    log.push({ t: i * STEP, state: b.state, alpha: b.alpha, shakeX: b.shakeX });
    if (b.state === 'shaking') {
      if (b.shakeX !== 0) sawShake = true;
      assert.ok(b.alpha <= lastAlpha + 1e-12, 'alpha sinkt nur');
      assert.ok(b.alpha >= 0.55 - 1e-9 && b.alpha <= 1, `alpha ${b.alpha}`);
      lastAlpha = b.alpha;
    }
  }
  const at = (sec) => log[Math.round(sec / STEP) - 1];
  // Normal bis 0,4 s
  for (let i = 1; i < 24; i++) assert.equal(log[i - 1].state, 'armed', `Schritt ${i}`);
  assert.equal(at(0.35).alpha, 1);
  assert.equal(at(0.35).shakeX, 0);
  // Wackeln zwischen 0,4 und 0,8 s
  assert.equal(at(0.4).state, 'shaking');
  assert.equal(at(0.6).state, 'shaking');
  assert.equal(at(0.78).state, 'shaking');
  assert.ok(sawShake);
  assert.ok(at(0.78).alpha < at(0.45).alpha, 'alpha sinkt');
  assert.ok(at(0.78).alpha < 0.62, 'kurz vor dem Bruch fast bei 0,55');
  // Danach zerbrochen
  assert.equal(at(0.8).state, 'broken');
  assert.equal(at(0.9).state, 'broken');
  assert.equal(b.alpha, 0);
  assert.equal(b.shakeX, 0);
  assert.equal(isSolid(b), false);
});

test('Wackeln wird stärker', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100);
  s.platforms.push(b);
  onPlayerLand(s, b);
  let early = 0;
  let late = 0;
  for (let i = 1; i <= 47; i++) {
    tick(s);
    if (b.state !== 'shaking') continue;
    const t = i * STEP;
    if (t < 0.55) early = Math.max(early, Math.abs(b.shakeX));
    else late = Math.max(late, Math.abs(b.shakeX));
  }
  assert.ok(late > early, `spät ${late} gegen früh ${early}`);
});

test('erneutes Landen setzt den Zeitplan nicht zurück', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100);
  s.platforms.push(b);
  onPlayerLand(s, b);
  tick(s, 20);
  onPlayerLand(s, b);
  tick(s, 5);
  assert.equal(b.state, 'shaking');
  tick(s, 30);
  assert.equal(b.state, 'broken');
  onPlayerLand(s, b); // zerbrochen: nichts passiert
  assert.equal(b.state, 'broken');
});

test('ohne respawn bleibt eine zerbrochene Plattform weg', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100);
  s.platforms.push(b);
  onPlayerLand(s, b);
  tick(s, 60 * 30);
  assert.equal(b.state, 'broken');
});

test('mit respawn kehrt die Plattform sichtbar zurück', () => {
  const s = createState({ seed: 1 });
  const b = createBreakablePlatform(s, 0, 300, 100, { respawn: 3 });
  s.platforms.push(b);
  onPlayerLand(s, b);
  tick(s, 50); // 0,83 s: zerbrochen
  assert.equal(b.state, 'broken');
  tick(s, 60 * 3 - 10); // knapp vor der Wiederkehr
  assert.equal(b.state, 'broken');
  assert.equal(b.alpha, 0);
  tick(s, 12);
  assert.equal(b.state, 'idle');
  assert.equal(isSolid(b), true);
  const a0 = b.alpha;
  tick(s, 6);
  assert.ok(b.alpha > a0 && b.alpha < 1, 'blendet ein');
  tick(s, 60);
  assert.equal(b.alpha, 1);
  // und kann wieder betreten werden
  onPlayerLand(s, b);
  assert.equal(b.state, 'armed');
});
