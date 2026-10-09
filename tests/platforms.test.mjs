import test from 'node:test';
import assert from 'node:assert/strict';
import { BLINK, SPRING, STEP } from '../game/constants.js';
import { createBlinkPlatform, createBreakablePlatform, createMovingPlatform, createSpringPlatform, createStaticPlatform } from '../game/entities.js';
import { isSolid, onPlayerLand, platformById, updatePlatforms } from '../game/platforms.js';
import { platformAt } from '../game/reach.js';
import { createState } from '../game/state.js';
import { invariants, newGame, run } from './helpers.mjs';

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

// ---------- Blinkwolke ----------

const EPS = 1e-9;
const frac = (v) => v - Math.floor(v);

// Soll nach dem Vertrag: ph = (s.t / period + phase) modulo 1, solid = ph < on, warn = solid und ph >= on minus WARN / period
function expected(p, t) {
  const ph = frac(t / p.period + p.phase);
  const solid = ph < p.on;
  return { ph, solid, warn: solid && ph >= p.on - BLINK.WARN / p.period };
}

function blinkScene(opts = {}) {
  const s = createState({ seed: 1 });
  const b = createBlinkPlatform(s, 300, 300, 120, opts);
  s.platforms.push(b);
  return { s, b };
}

test('Blinkwolke: ohne Schritt ist sie fest und sichtbar (Zustand aus createBlinkPlatform)', () => {
  const { b } = blinkScene();
  assert.equal(b.solid, true);
  assert.equal(b.warn, false);
  assert.equal(b.alpha, 1);
  assert.equal(isSolid(b), true);
});

test('Blinkwolke: solid und warn folgen dem Takt aus s.t, period, on und phase', () => {
  for (const opts of [{}, { period: 4.4, on: 0.55, phase: 0.3 }, { period: 3.4, phase: 0.9 }, { period: 3.9, on: 0.7, phase: 0.5 }]) {
    const { s, b } = blinkScene(opts);
    let flips = 0;
    let last = null;
    for (let i = 0; i < 60 * 24; i++) {
      tick(s);
      const want = expected(b, s.t);
      assert.equal(b.solid, want.solid, `solid bei t ${s.t}`);
      assert.equal(b.warn, want.warn, `warn bei t ${s.t}`);
      assert.equal(isSolid(b), want.solid);
      if (last !== null && last !== b.solid) flips++;
      last = b.solid;
    }
    // In 24 s gibt es mindestens fünf Wechsel in jede Richtung
    assert.ok(flips >= 10, `nur ${flips} Wechsel bei ${JSON.stringify(opts)}`);
  }
});

test('Blinkwolke: der feste Anteil entspricht on, der Rest ist unsichtbar', () => {
  const { s, b } = blinkScene({ period: 4, on: 0.6, phase: 0 });
  let solid = 0;
  const n = 60 * 40;
  for (let i = 0; i < n; i++) {
    tick(s);
    if (b.solid) solid++;
  }
  assert.ok(Math.abs(solid / n - 0.6) < 0.01, `fester Anteil ${solid / n}`);
});

test('Blinkwolke: die Vorwarnung dauert BLINK.WARN Sekunden direkt vor dem Verschwinden', () => {
  const { s, b } = blinkScene({ period: 4, on: 0.62, phase: 0 });
  // Zyklus: fest von 0 bis 2,48 s, davon warnen die letzten 0,7 s ab 1,78 s
  let warnStart = null;
  let warnEnd = null;
  let off = null;
  let prevSolid = true;
  for (let i = 0; i < 60 * 4 && off === null; i++) {
    tick(s);
    if (b.warn && warnStart === null) warnStart = s.t;
    if (warnStart !== null && !b.warn && warnEnd === null) warnEnd = s.t;
    if (prevSolid && !b.solid) off = s.t;
    prevSolid = b.solid;
  }
  assert.ok(warnStart !== null && off !== null);
  assert.ok(Math.abs(off - warnStart - BLINK.WARN) <= 2 * STEP, `Vorwarnung ${off - warnStart} s`);
  assert.ok(Math.abs(off - 2.48) <= 2 * STEP, `Verschwinden bei ${off}`);
  // Die Vorwarnung endet genau mit dem Verschwinden und ist nie ausgeschaltet, solange die Wolke fest ist
  assert.ok(Math.abs(warnEnd - off) <= STEP + EPS);
});

test('Blinkwolke: warn gilt nie bei einer unsichtbaren Wolke, alpha passt zum Zustand', () => {
  const { s, b } = blinkScene({ period: 3.6, on: 0.6, phase: 0.2 });
  let sawWarn = false;
  let sawOff = false;
  let sawFull = false;
  for (let i = 0; i < 60 * 30; i++) {
    tick(s);
    assert.ok(b.alpha >= 0.15 - EPS && b.alpha <= 1 + EPS, `alpha ${b.alpha}`);
    if (!b.solid) {
      assert.equal(b.warn, false);
      assert.ok(Math.abs(b.alpha - 0.15) < EPS, `unsichtbar: alpha ${b.alpha}`);
      sawOff = true;
    } else if (b.warn) {
      assert.ok(b.alpha >= 0.4 - EPS && b.alpha <= 1 + EPS, `Flackern: alpha ${b.alpha}`);
      sawWarn = true;
    } else {
      assert.equal(b.alpha, 1);
      sawFull = true;
    }
  }
  assert.ok(sawWarn && sawOff && sawFull);
});

test('Blinkwolke: alpha flackert in der Vorwarnung wirklich (mehrere verschiedene Werte, Schwankung)', () => {
  const { s, b } = blinkScene({ period: 4, on: 0.62, phase: 0 });
  const seen = [];
  for (let i = 0; i < 60 * 4; i++) {
    tick(s);
    if (b.warn) seen.push(b.alpha);
  }
  assert.ok(seen.length >= 35, `${seen.length} Schritte Vorwarnung`);
  assert.ok(Math.max(...seen) - Math.min(...seen) > 0.4, 'deutliche Schwankung');
  let turns = 0;
  for (let i = 2; i < seen.length; i++) if ((seen[i] - seen[i - 1]) * (seen[i - 1] - seen[i - 2]) < 0) turns++;
  assert.ok(turns >= 4, `nur ${turns} Umkehrpunkte`);
  assert.ok(turns <= 24, `${turns} Umkehrpunkte in 0,7 s wären ein Strobo`);
});

test('Blinkwolke: gleicher s.t gibt immer denselben Zustand, unabhängig von Schrittweite und Vorgeschichte', () => {
  const a = blinkScene({ period: 3.7, on: 0.6, phase: 0.45 });
  const c = blinkScene({ period: 3.7, on: 0.6, phase: 0.45 });
  for (const t of [0, 0.5, 1.7, 2.2, 2.3, 3.0, 7.3, 11.11, 100.5]) {
    a.s.t = t;
    updatePlatforms(a.s, STEP);
    c.s.t = 50; // andere Vorgeschichte
    updatePlatforms(c.s, 1);
    c.s.t = t;
    updatePlatforms(c.s, 0.25);
    assert.deepEqual([a.b.solid, a.b.warn, a.b.alpha], [c.b.solid, c.b.warn, c.b.alpha], `t ${t}`);
  }
});

test('Blinkwolke: phase verschiebt den Takt, zwei Wolken mit anderer Phase sind nicht gleichzeitig weg', () => {
  const s = createState({ seed: 1 });
  const a = createBlinkPlatform(s, 100, 300, 120, { period: 4, on: 0.6, phase: 0 });
  const b = createBlinkPlatform(s, 400, 300, 120, { period: 4, on: 0.6, phase: 0.5 });
  s.platforms.push(a, b);
  let bothOff = 0;
  let differ = 0;
  for (let i = 0; i < 60 * 16; i++) {
    tick(s);
    if (!a.solid && !b.solid) bothOff++;
    if (a.solid !== b.solid) differ++;
  }
  assert.equal(bothOff, 0, 'on 0,6 und Versatz 0,5: immer mindestens eine fest');
  assert.ok(differ > 60);
});

test('Blinkwolke: Vorwarnung und Wechsel stimmen auch bei großen Schrittweiten', () => {
  for (const dt of [1 / 120, 1 / 30, 0.1, 0.5]) {
    const { s, b } = blinkScene({ period: 3.5, on: 0.6, phase: 0.1 });
    for (let i = 0; i < Math.round(30 / dt); i++) {
      s.t += dt;
      updatePlatforms(s, dt);
      const want = expected(b, s.t);
      assert.equal(b.solid, want.solid);
      assert.equal(b.warn, want.warn);
    }
  }
});

test('Blinkwolke: eine feste Wolke trägt, eine unsichtbare nicht', () => {
  const { s, b } = blinkScene({ period: 4, on: 0.5, phase: 0 });
  tick(s, 30);
  assert.equal(isSolid(b), true);
  tick(s, 60 * 2); // t = 2,5 s: nach dem festen Anteil
  assert.equal(b.solid, false);
  assert.equal(isSolid(b), false);
  assert.equal(platformById(s, b.id), b, 'sie bleibt in der Liste, nur nicht fest');
});

test('Blinkwolke: Staubwölkchen beim Wechsel, aber nur im Bild und nicht im ersten Schritt', () => {
  // Im Bild: bei jedem Wechsel ein Poof
  let { s, b } = blinkScene({ period: 4, on: 0.5, phase: 0 });
  s.camX = 200;
  const counts = [];
  let flips = 0;
  let prev = true;
  for (let i = 0; i < 60 * 8; i++) {
    const before = s.particles.length;
    tick(s);
    if (b.solid !== prev) {
      flips++;
      counts.push(s.particles.length - before);
    }
    prev = b.solid;
  }
  assert.ok(flips >= 3);
  assert.ok(counts.every((c) => c > 0), `Wechsel ohne Staub: ${counts}`);

  // Weit außerhalb: kein Staub
  ({ s, b } = blinkScene({ period: 4, on: 0.5, phase: 0 }));
  s.camX = 5000;
  tick(s, 60 * 8);
  assert.equal(s.particles.length, 0);

  // Erzeugt mitten im unsichtbaren Teil des Takts: der erste Schritt macht keinen Staub
  ({ s, b } = blinkScene({ period: 4, on: 0.5, phase: 0 }));
  s.t = 3;
  s.camX = 200;
  updatePlatforms(s, STEP);
  assert.equal(b.solid, false);
  assert.equal(s.particles.length, 0);
});

test('Blinkwolke: kaputte Werte werfen nichts und ergeben endliche Felder', () => {
  const s = createState({ seed: 1 });
  const bad = [
    { ...createBlinkPlatform(s, 0, 300, 120), period: NaN },
    { ...createBlinkPlatform(s, 0, 300, 120), period: 0 },
    { ...createBlinkPlatform(s, 0, 300, 120), period: -3 },
    { ...createBlinkPlatform(s, 0, 300, 120), on: NaN },
    { ...createBlinkPlatform(s, 0, 300, 120), phase: NaN },
    { ...createBlinkPlatform(s, 0, 300, 120), on: 7 },
    { ...createBlinkPlatform(s, 0, 300, 120), on: -1 },
  ];
  s.platforms.push(...bad);
  s.camX = NaN;
  for (let i = 0; i < 400; i++) {
    tick(s);
    for (const p of bad) {
      assert.equal(typeof p.solid, 'boolean');
      assert.equal(typeof p.warn, 'boolean');
      assert.ok(Number.isFinite(p.alpha) && p.alpha >= 0 && p.alpha <= 1);
    }
  }
  s.t = NaN;
  updatePlatforms(s, STEP);
  for (const p of bad) assert.ok(Number.isFinite(p.alpha));
  // on 7 heißt dauerhaft fest ohne Vorwarnung, on 0 oder weniger heißt dauerhaft weg
  assert.equal(bad[5].solid, true);
  assert.equal(bad[5].warn, false);
  assert.equal(bad[6].solid, false);
});

test('Blinkwolke: bleibt eine Wolke mit on 1 fest, gibt es nie Vorwarnung', () => {
  const { s, b } = blinkScene({ on: 1 });
  for (let i = 0; i < 60 * 12; i++) {
    tick(s);
    assert.equal(b.solid, true);
    assert.equal(b.warn, false);
    assert.equal(b.alpha, 1);
  }
});

test('Blinkwolke: ist die feste Zeit kürzer als die Vorwarnung, warnt sie von Anfang an', () => {
  const { s, b } = blinkScene({ period: 3.4, on: 0.1, phase: 0 }); // fest nur 0,34 s
  for (let i = 0; i < 60 * 3.4; i++) {
    tick(s);
    if (b.solid) assert.equal(b.warn, true);
    else assert.equal(b.warn, false);
  }
});

test('Blinkwolke: andere Plattformarten bekommen keine Blinkfelder', () => {
  const s = createState({ seed: 1 });
  const a = createStaticPlatform(s, 0, 300, 200);
  const sp = createSpringPlatform(s, 300, 300, 100);
  s.platforms.push(a, sp);
  tick(s, 60);
  assert.equal('warn' in a, false);
  assert.equal('solid' in sp, false);
  assert.equal(isSolid(a), true);
  assert.equal(isSolid(sp), true);
});

// ---------- Sprungwolke ----------

test('Sprungwolke: press klingt in 0,25 s von 1 auf 0 ab', () => {
  const s = createState({ seed: 1 });
  const sp = createSpringPlatform(s, 300, 300, 100);
  s.platforms.push(sp);
  assert.equal(sp.press, 0);
  assert.equal(sp.launch, SPRING.SPEED);
  tick(s, 30);
  assert.equal(sp.press, 0, 'ohne Abprall bleibt sie oben');

  sp.press = 1; // player.js setzt press = 1 nach dem Abprall
  const log = [];
  for (let i = 1; i <= 30; i++) {
    tick(s);
    log.push(sp.press);
  }
  assert.ok(Math.abs(log[0] - (1 - STEP / 0.25)) < 1e-9, `erster Schritt ${log[0]}`);
  for (let i = 1; i < log.length; i++) assert.ok(log[i] <= log[i - 1] + EPS, 'nur fallend');
  assert.ok(Math.abs(log[7] - 0.5) < 0.01 + STEP / 0.25, `nach ${8 * STEP} s etwa 0,5: ${log[7]}`);
  assert.ok(log[13] > 0, 'nach 14 Schritten (0,233 s) noch eingedrückt');
  assert.equal(log[15], 0, 'nach 16 Schritten (0,267 s) ganz oben');
  assert.equal(log[29], 0);
  assert.ok(log.every((v) => v >= 0 && v <= 1));
});

test('Sprungwolke: ein neuer Abprall setzt press wieder auf 1 und klingt neu ab', () => {
  const s = createState({ seed: 1 });
  const sp = createSpringPlatform(s, 300, 300, 100);
  s.platforms.push(sp);
  sp.press = 1;
  tick(s, 8);
  assert.ok(sp.press > 0.4 && sp.press < 0.6);
  sp.press = 1;
  tick(s, 1);
  assert.ok(sp.press > 0.9);
  tick(s, 20);
  assert.equal(sp.press, 0);
});

test('Sprungwolke: klingt bei beliebiger Schrittweite in 0,25 s ab, kaputte Werte werden 0', () => {
  for (const dt of [1 / 120, 1 / 30, 0.1, 0.3]) {
    const s = createState({ seed: 1 });
    const sp = createSpringPlatform(s, 300, 300, 100);
    s.platforms.push(sp);
    sp.press = 1;
    let t = 0;
    while (sp.press > 0 && t < 1) {
      s.t += dt;
      updatePlatforms(s, dt);
      t += dt;
    }
    assert.ok(t >= 0.25 - dt - EPS && t <= 0.25 + dt + EPS, `dt ${dt}: ${t} s`);
  }
  const s = createState({ seed: 1 });
  const sp = createSpringPlatform(s, 300, 300, 100);
  s.platforms.push(sp);
  for (const bad of [NaN, undefined, -1, Infinity]) {
    sp.press = bad;
    updatePlatforms(s, STEP);
    assert.ok(Number.isFinite(sp.press) && sp.press >= 0 && sp.press <= 1, `press ${bad} wurde ${sp.press}`);
  }
});

test('Sprungwolke: bleibt fest und rührt sich nicht von der Stelle', () => {
  const s = createState({ seed: 1 });
  const sp = createSpringPlatform(s, 300, 300, 100);
  s.platforms.push(sp);
  sp.press = 1;
  tick(s, 60);
  assert.deepEqual([sp.x, sp.y, sp.dx, sp.dy, sp.vx, sp.vy], [300, 300, 0, 0, 0, 0]);
  assert.equal(isSolid(sp), true);
});

// ---------- Zusammenspiel im Spiel ----------

test('sim: eine Blinkwolke unter dem stehenden Spieler verschwindet, er fällt hindurch', () => {
  const s = newGame(3);
  const p = s.player;
  const b = createBlinkPlatform(s, p.x - 100, 250, 300, { period: 4, on: 0.5, phase: 0 }); // über dem Boden (y 360), der ihn danach auffängt
  s.platforms.push(b);
  // Spieler auf die Blinkwolke setzen, dort steht er sicher, solange sie fest ist
  p.x = b.x + 120;
  p.y = b.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
  p.groundId = b.id;
  p.invuln = 99;
  const still = { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, slamPressed: false, throwPressed: false, downHeld: false };
  let stoodSolid = 0;
  let fell = false;
  for (let i = 0; i < 60 * 6; i++) {
    run(s, 1, () => still);
    if (b.solid && p.onGround && p.groundId === b.id) stoodSolid++;
    if (!b.solid && p.y > b.y + 40) fell = true;
  }
  assert.ok(stoodSolid > 60, 'er stand erst auf der festen Wolke');
  assert.ok(fell, 'danach fiel er durch die unsichtbare Wolke');
  assert.deepEqual(invariants(s), []);
});

test('Fuzz: gemischte Plattformen bleiben bei beliebigen Schrittweiten endlich und im Wertebereich', () => {
  const s = createState({ seed: 7 });
  for (let i = 0; i < 12; i++) {
    const x = i * 150;
    if (i % 4 === 0) s.platforms.push(createBlinkPlatform(s, x, 300, 100, { period: 3.4 + (i % 3) * 0.5, on: 0.5 + 0.03 * i, phase: i / 12 }));
    else if (i % 4 === 1) s.platforms.push(createSpringPlatform(s, x, 300, 100));
    else if (i % 4 === 2) s.platforms.push(createMovingPlatform(s, x, 300, 100, { ax: 40, ay: 20, period: 3 }));
    else s.platforms.push(createBreakablePlatform(s, x, 300, 100, { respawn: 2 }));
  }
  const dts = [STEP, STEP, 0, 0.05, 0.1, 1 / 240];
  for (let i = 0; i < 4000; i++) {
    const dt = dts[i % dts.length];
    s.t += dt;
    s.camX = (i * 3) % 1800;
    if (i % 97 === 0) for (const p of s.platforms) if (p.kind === 'spring') p.press = 1;
    if (i % 131 === 0) for (const p of s.platforms) if (p.kind === 'breakable') onPlayerLand(s, p);
    updatePlatforms(s, dt);
    for (const p of s.platforms) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      if (p.kind === 'blink') {
        assert.equal(typeof p.solid, 'boolean');
        assert.ok(p.alpha >= 0.15 - EPS && p.alpha <= 1 + EPS);
        assert.equal(isSolid(p), p.solid);
      }
      if (p.kind === 'spring') assert.ok(p.press >= 0 && p.press <= 1);
    }
  }
  assert.deepEqual(invariants(s), []);
});
