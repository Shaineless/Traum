import test from 'node:test';
import assert from 'node:assert/strict';
import { COMET, H, HAIL, LIGHTNING, RAIN, SPIKE, STEP, W, WIND } from '../game/constants.js';
import { createComet, createHail, createLightning, createMovingPlatform, createRain, createSpike, createStaticPlatform, createWind } from '../game/entities.js';
import { createState } from '../game/state.js';
import { int, rand, range } from '../game/rng.js';
import { emit } from '../game/particles.js';
import { hurtPlayer } from '../game/player.js';
import { eventWindVx, startEvent } from '../game/events.js';
import { updatePlatforms } from '../game/platforms.js';
import { stepSim } from '../game/sim.js';
import { clearHazardsNear, lightningColumn, playerVsHazards, rainAt, spikeHitbox, updateObstacles, windAt } from '../game/obstacles.js';
import { input, invariants, newGame } from './helpers.mjs';

// ---------- Hilfen ----------

// Schaden und Partikel kommen aus anderen Modulen. Solange dort noch Stubs liegen,
// werden nur die Prüfungen übersprungen, die genau diese Wirkung beobachten.
const REAL_HURT = (() => {
  const s = createState();
  return hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 }) !== 'ignored';
})();
const REAL_PARTICLES = (() => {
  const s = createState();
  emit(s, 'poof', 0, 0);
  return s.particles.length > 0;
})();
const needsHurt = REAL_HURT ? false : 'player.js ist noch ein Stub (hurtPlayer)';
const needsParticles = REAL_PARTICLES ? false : 'particles.js ist noch ein Stub (emit)';

const PHASES = ['idle', 'glow', 'flicker', 'strike', 'cooldown'];
const EPS = 1e-9;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Der Spieler steht weit links und stört nicht. Viele Leben, damit mehrere Treffer den Test nicht beenden.
function world({ camX = 0, seed = 5 } = {}) {
  const s = createState({ seed });
  s.camX = camX;
  s.lives = 50;
  const p = s.player;
  p.x = -9000;
  p.y = 0;
  return s;
}

function add(s, o) {
  (['spike', 'lightning', 'comet', 'hail'].includes(o.kind) ? s.hazards : s.zones).push(o);
  return o;
}

const sfxCount = (s, name) => s.sfx.filter((e) => e.n === name).length;

// Spieler mit Mitte cx, Füßen bei foot, ohne Schutz
function place(s, cx, foot) {
  const p = s.player;
  p.x = cx - p.w / 2;
  p.y = foot - p.h;
  p.vx = 0;
  p.vy = 0;
  p.invuln = 0;
  p.dead = false;
  p.dash.t = 0;
  return p;
}

// Ein Schritt wie in sim.js: Zeit, Plattformen, Hindernisse, dann Treffer. Die Unverwundbarkeit läuft ab.
function tick(s, n = 1, dt = STEP) {
  for (let i = 0; i < n; i++) {
    s.t += dt;
    s.player.invuln = Math.max(0, s.player.invuln - dt);
    updatePlatforms(s, dt);
    updateObstacles(s, dt);
    playerVsHazards(s);
  }
}

// Phasenwechsel eines Blitzes: [{ phase, t }], der erste Eintrag ist der Zustand vor dem ersten Schritt
function trace(s, b, seconds, dt = STEP) {
  const log = [{ phase: b.phase, t: s.t }];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    tick(s, 1, dt);
    if (b.phase !== log[log.length - 1].phase) log.push({ phase: b.phase, t: s.t });
  }
  return log;
}

function within(actual, want, label, slack = 2 * STEP) {
  assert.ok(actual >= want - EPS && actual <= want + slack, `${label}: ${actual} statt ${want}`);
}

// ---------- Blitze: Zeitverlauf ----------

test('Blitz: Phasenfolge und Dauern entsprechen LIGHTNING', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 1.0 }));
  const log = trace(s, b, 12);
  assert.deepEqual(
    log.slice(0, 11).map((e) => e.phase),
    ['idle', 'glow', 'flicker', 'strike', 'cooldown', 'idle', 'glow', 'flicker', 'strike', 'cooldown', 'idle'],
  );
  const dur = (i) => log[i + 1].t - log[i].t;
  within(dur(0), 1.0, 'erste Ruhe');
  within(dur(1), LIGHTNING.GLOW, 'glow');
  within(dur(2), LIGHTNING.FLICKER, 'flicker');
  within(dur(3), LIGHTNING.STRIKE, 'strike');
  within(dur(4), LIGHTNING.COOLDOWN, 'cooldown');
  within(dur(5), 1.0, 'zweite Ruhe');
  within(dur(6), LIGHTNING.GLOW, 'glow, zweiter Zyklus');
});

test('Blitz: zwischen Beginn von glow und Einschlag liegen immer GLOW plus FLICKER, mindestens 0,9 s', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 0.8 }));
  const log = trace(s, b, 25);
  let cycles = 0;
  for (let i = 0; i < log.length; i++) {
    if (log[i].phase !== 'glow') continue;
    const strike = log.slice(i).find((e) => e.phase === 'strike');
    if (!strike) continue;
    const warn = strike.t - log[i].t;
    assert.ok(warn >= 0.9, `Vorwarnung ${warn}`);
    within(warn, LIGHTNING.GLOW + LIGHTNING.FLICKER, 'Vorwarnung', 3 * STEP);
    cycles++;
  }
  assert.ok(cycles >= 6, `nur ${cycles} Zyklen`);
});

test('Blitz: auch mit kürzeren Konstanten bleibt die Vorwarnung mindestens 0,9 s', () => {
  const saved = { ...LIGHTNING };
  try {
    LIGHTNING.GLOW = 0.2;
    LIGHTNING.FLICKER = 0.1;
    const s = world();
    const b = add(s, createLightning(s, 300, { idle: 0.5 }));
    const log = trace(s, b, 8);
    const glow = log.find((e) => e.phase === 'glow');
    const strike = log.find((e) => e.phase === 'strike');
    assert.ok(glow && strike);
    assert.ok(strike.t - glow.t >= 0.9 - EPS, `Vorwarnung ${strike.t - glow.t}`);
  } finally {
    Object.assign(LIGHTNING, saved);
  }
});

for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1, 0.5]) {
  test(`Blitz: Vorwarnung bleibt bei Schrittweite ${dt.toFixed(4)} erhalten und kein Einschlag fällt aus`, () => {
    const s = world();
    const b = add(s, createLightning(s, 300, { idle: 0.7 }));
    const log = trace(s, b, 14, dt);
    const strikes = log.filter((e) => e.phase === 'strike').length;
    assert.ok(strikes >= 2, `nur ${strikes} Einschläge`);
    for (let i = 0; i < log.length; i++) {
      if (log[i].phase !== 'glow') continue;
      const strike = log.slice(i).find((e) => e.phase === 'strike');
      if (strike) assert.ok(strike.t - log[i].t >= 0.9 - EPS, `Vorwarnung ${strike.t - log[i].t}`);
    }
    // jede Phase wurde beobachtet, es gibt keinen Sprung über eine Phase hinweg
    const order = log.map((e) => PHASES.indexOf(e.phase));
    for (let i = 1; i < order.length; i++) assert.equal(order[i], (order[i - 1] + 1) % PHASES.length);
  });
}

test('Blitz: charge steigt in glow und flicker von 0 auf 1, in strike 1, sonst 0', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 0.5 }));
  const seen = { idle: [], glow: [], flicker: [], strike: [], cooldown: [] };
  const first = { glow: [], flicker: [] }; // nur der erste Zyklus, dort steigt charge durchgehend
  let strikes = 0;
  let prev = b.phase;
  for (let i = 0; i < 60 * 8; i++) {
    tick(s);
    if (b.phase === 'strike' && prev !== 'strike') strikes++;
    prev = b.phase;
    seen[b.phase].push(b.charge);
    if (strikes === 0 && first[b.phase]) first[b.phase].push(b.charge);
    assert.ok(b.charge >= 0 && b.charge <= 1);
  }
  assert.ok(strikes >= 2);
  assert.ok(seen.idle.every((c) => c === 0), 'idle: 0');
  assert.ok(seen.cooldown.every((c) => c === 0), 'cooldown: 0');
  assert.ok(seen.strike.every((c) => c === 1), 'strike: 1');
  assert.equal(first.glow[0], 0, 'glow beginnt bei 0');
  assert.ok(first.flicker[0] >= 0.75, 'flicker beginnt hoch');
  assert.ok(first.flicker[first.flicker.length - 1] > 0.9, 'flicker endet nahe 1');
  const all = first.glow.concat(first.flicker);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] > all[i - 1] - EPS, 'charge steigt durchgehend');
});

test('Blitz: struck gilt von Beginn des Einschlags bis zum Ende der Abkühlung', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 0.5 }));
  for (let i = 0; i < 60 * 8; i++) {
    tick(s);
    assert.equal(b.struck, b.phase === 'strike' || b.phase === 'cooldown', `Phase ${b.phase}`);
  }
});

// ---------- Blitze: Schaden ----------

test('Blitz: in idle, glow, flicker und cooldown entsteht nie Schaden, selbst mitten in der Säule', () => {
  for (const phase of ['idle', 'glow', 'flicker', 'cooldown']) {
    const s = world();
    const b = add(s, createLightning(s, 300));
    b.phase = phase;
    b.timer = 5;
    place(s, 300, 360);
    for (let i = 0; i < 10; i++) playerVsHazards(s);
    assert.equal(s.lives, 50, phase);
    assert.equal(s.run.hits, 0, phase);
    assert.equal(s.deathCause, null, phase);
  }
});

test('Blitz: in der Phase strike trifft die Säule, Ursache ist Blitz', { skip: needsHurt }, () => {
  const s = world();
  const b = add(s, createLightning(s, 300));
  b.phase = 'strike';
  b.timer = 0.2;
  place(s, 290, 360);
  playerVsHazards(s);
  assert.equal(s.lives, 49);
  assert.equal(s.run.hits, 1);
  assert.deepEqual(s.deathCause, { kind: 'lightning', label: 'Blitz' });
  assert.ok(s.player.vx < 0, 'Rückstoß weg von der Mitte der Säule');
  // Unverwundbar: kein zweiter Treffer im selben Einschlag
  for (let i = 0; i < 5; i++) playerVsHazards(s);
  assert.equal(s.run.hits, 1);
});

test('Blitz: Spieler in der Säule verliert pro Einschlag genau ein Leben und nur in der Phase strike', { skip: needsHurt }, () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 1.0 }));
  place(s, 300, 360);
  let strikes = 0;
  let prev = b.phase;
  for (let i = 0; i < 60 * 20; i++) {
    const hits = s.run.hits;
    const lives = s.lives;
    tick(s);
    if (b.phase === 'strike' && prev !== 'strike') strikes++;
    prev = b.phase;
    if (s.run.hits !== hits) assert.equal(b.phase, 'strike', 'Treffer außerhalb von strike');
    if (b.phase !== 'strike') assert.equal(s.lives, lives, `Leben in ${b.phase} verloren`);
  }
  assert.ok(strikes >= 5);
  assert.equal(s.run.hits, strikes);
  assert.equal(s.lives, 50 - strikes);
});

test('Blitz: Hitbox Grenzen der Säule (x plus minus 28, von der Wolke bis zum unteren Bildrand)', { skip: needsHurt }, () => {
  const col = lightningColumn({ x: 300, w: LIGHTNING.WIDTH, cloudY: LIGHTNING.CLOUD_Y });
  assert.deepEqual(col, { x: 300 - LIGHTNING.WIDTH / 2, y: LIGHTNING.CLOUD_Y, w: LIGHTNING.WIDTH, h: H - LIGHTNING.CLOUD_Y });
  const hit = (px, py) => {
    const s = world();
    const b = add(s, createLightning(s, 300));
    b.phase = 'strike';
    b.timer = 1;
    const p = s.player;
    p.x = px;
    p.y = py;
    p.invuln = 0;
    playerVsHazards(s);
    return s.run.hits === 1;
  };
  // Der Spieler ist 44 breit, seine Hitbox 4 px pro Seite kleiner: Säule von 272 bis 328
  assert.equal(hit(232, 300), false, 'Hitbox berührt die linke Kante nur');
  assert.equal(hit(232.5, 300), true, 'ein halber Pixel drin');
  assert.equal(hit(229, 300), false, 'Zeichnung ragt hinein, Hitbox nicht');
  assert.equal(hit(324, 300), false, 'Hitbox berührt die rechte Kante nur');
  assert.equal(hit(323.5, 300), true);
  assert.equal(hit(300 - 22, 300), true, 'mittig');
  // Senkrecht: Spieler 34 hoch, Hitbox von y plus 4 bis y plus 30
  assert.equal(hit(278, 22), false, 'unter der Hitbox oberhalb der Wolke');
  assert.equal(hit(278, 22.5), true);
  assert.equal(hit(278, H - 4), false, 'unterhalb des Bildrands');
  assert.equal(hit(278, H - 4.5), true);
  assert.equal(hit(278, H + 80), false, 'in den Abgrund gefallen');
  assert.equal(hit(278, 380), true, 'tief im Abgrund, aber noch im Bild: Säule gilt auch über Abgründen');
});

test('Blitz: kein Treffer bei Unverwundbarkeit, im Dash, mit Schild nur Absorbieren, nicht beim toten Spieler', { skip: needsHurt }, () => {
  const strike = () => {
    const s = world();
    const b = add(s, createLightning(s, 300));
    b.phase = 'strike';
    b.timer = 1;
    place(s, 300, 360);
    return s;
  };
  let s = strike();
  s.player.invuln = 0.5;
  playerVsHazards(s);
  assert.equal(s.lives, 50);

  s = strike();
  s.player.dash.t = 0.1;
  playerVsHazards(s);
  assert.equal(s.lives, 50);

  s = strike();
  s.player.power.shield = true;
  playerVsHazards(s);
  assert.equal(s.lives, 50);
  assert.equal(s.player.power.shield, false);
  assert.equal(s.run.hits, 0);

  s = strike();
  s.player.dead = true;
  playerVsHazards(s);
  assert.equal(s.lives, 50);
});

test('Blitz: Einschlag nahe der Kamera lässt den Bildschirm wackeln, weit außen nicht', () => {
  let s = world();
  let b = add(s, createLightning(s, 300));
  b.phase = 'flicker';
  b.timer = STEP / 2;
  assert.equal(s.fx.shake, 0);
  tick(s);
  assert.equal(b.phase, 'strike');
  assert.ok(s.fx.shake > 0, 'shake bei Einschlag im Bild');

  // Im Bildbereich, aber links vom sichtbaren Rand (camX minus 80): kein Wackeln
  s = world({ camX: 1000 });
  b = add(s, createLightning(s, 920));
  b.phase = 'flicker';
  b.timer = STEP / 2;
  tick(s);
  assert.equal(b.phase, 'strike');
  assert.equal(s.fx.shake, 0);
  assert.equal(s.particles.length, 0);
});

test('Blitz: Einschlag erzeugt Funken', { skip: needsParticles }, () => {
  const s = world();
  s.platforms.push(createStaticPlatform(s, 200, 360, 300));
  const b = add(s, createLightning(s, 300));
  b.phase = 'flicker';
  b.timer = STEP / 2;
  tick(s);
  assert.equal(b.phase, 'strike');
  assert.ok(s.particles.length > 0);
  const before = s.particles.length;
  tick(s, 5);
  assert.equal(s.particles.length, before, 'Funken nur beim Beginn des Einschlags');
});

// ---------- Blitze: außerhalb des Bildes ----------

test('Blitz weit rechts bleibt bei ruhender Kamera dauerhaft in idle mit vollem timer', () => {
  const s = world();
  const b = add(s, createLightning(s, 3000, { idle: 1.5 }));
  tick(s, 60 * 40);
  assert.equal(b.phase, 'idle');
  assert.equal(b.timer, 1.5);
  assert.equal(b.charge, 0);
  assert.equal(s.run.hits, 0);
});

test('Blitz: nach dem Eintritt ins Bild kommt der Einschlag frühestens nach idleTime plus 0,9 s', () => {
  for (const idle of [0.4, 1.5]) {
    const s = world();
    const b = add(s, createLightning(s, 3000, { idle }));
    let enter = null;
    let strike = null;
    for (let i = 0; i < 60 * 60 && strike === null; i++) {
      s.camX += 300 * STEP; // Kamera fährt heran
      const before = s.t;
      const inView = b.x <= s.camX + W + 200;
      if (inView && enter === null) enter = before;
      tick(s);
      if (!inView) {
        assert.equal(b.phase, 'idle');
        assert.equal(b.timer, idle);
      }
      if (b.phase === 'strike') strike = s.t;
    }
    assert.ok(enter !== null && strike !== null);
    const wait = strike - enter;
    assert.ok(wait >= idle + 0.9 - EPS, `idle ${idle}: Einschlag nach ${wait} s`);
    within(wait, idle + LIGHTNING.GLOW + LIGHTNING.FLICKER, `idle ${idle}`, 4 * STEP);
  }
});

test('Blitz: ein nach clearHazardsNear verlängerter timer bleibt außerhalb des Bildes erhalten', () => {
  const s = world();
  const b = add(s, createLightning(s, 3000, { idle: 1.0 }));
  clearHazardsNear(s, 2900, 3100);
  assert.equal(b.timer, 3.0);
  tick(s, 60 * 5);
  assert.equal(b.phase, 'idle');
  assert.equal(b.timer, 3.0);
});

test('Blitz: grenzt an den Bildbereich (camX minus 100 bis camX plus W plus 200)', () => {
  const s = world({ camX: 500 });
  const inside = add(s, createLightning(s, 500 + W + 200, { idle: 0.2 }));
  const outside = add(s, createLightning(s, 500 + W + 201, { idle: 0.2 }));
  const behindIn = add(s, createLightning(s, 400, { idle: 0.2 }));
  const behindOut = add(s, createLightning(s, 399, { idle: 0.2 }));
  tick(s, 30);
  assert.equal(inside.phase, 'glow');
  assert.equal(behindIn.phase, 'glow');
  assert.equal(outside.phase, 'idle');
  assert.equal(outside.timer, 0.2);
  assert.equal(behindOut.phase, 'idle');
  assert.equal(behindOut.timer, 0.2);
});

test('Blitz: eine Vorwarnung, die aus dem Bild gerät, beginnt später von vorn', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 1.0 }));
  let n = 0;
  while (b.phase !== 'flicker' && n++ < 600) tick(s);
  assert.equal(b.phase, 'flicker');
  s.camX = 5000; // Sprung der Kamera: der Blitz liegt weit hinter dem Bild
  tick(s);
  assert.equal(b.phase, 'idle');
  assert.equal(b.timer, 1.0);
  assert.equal(b.charge, 0);
  assert.equal(b.struck, false);
  tick(s, 60 * 10);
  assert.equal(b.phase, 'idle');
  // Zurück im Bild: wieder die volle Wartezeit und Vorwarnung
  s.camX = 0;
  const t0 = s.t;
  let strike = null;
  for (let i = 0; i < 600 && strike === null; i++) {
    tick(s);
    if (b.phase === 'strike') strike = s.t;
  }
  assert.ok(strike - t0 >= 1.0 + 0.9 - EPS, `Einschlag nach ${strike - t0}`);
});

test('Blitz: ein laufender Einschlag und die Abkühlung enden auch dann, wenn der Blitz aus dem Bild gerät', () => {
  const s = world();
  const b = add(s, createLightning(s, 300, { idle: 1.0 }));
  b.phase = 'strike';
  b.timer = 0.1;
  b.struck = true;
  s.camX = 5000;
  tick(s, 60 * 2);
  assert.equal(b.phase, 'idle');
  assert.equal(b.timer, 1.0);
  assert.equal(b.struck, false);
});

test('Blitz: Tempo (pace) verkürzt nur die Ruhephase, die Vorwarnung bleibt mindestens 0,9 s', () => {
  const s = world();
  const slow = createLightning(s, 300, { idle: 1.5, pace: 1 });
  const fast = createLightning(s, 300, { idle: 1.5, pace: 1.5 });
  const crazy = createLightning(s, 300, { idle: 1.5, pace: 9 });
  assert.ok(fast.idleTime < slow.idleTime);
  assert.equal(crazy.idleTime, 0.6);
  for (const b of [slow, fast, crazy]) {
    const t = world();
    t.hazards.push(b);
    const log = trace(t, b, 10);
    const glow = log.find((e) => e.phase === 'glow');
    const strike = log.find((e) => e.phase === 'strike');
    assert.ok(glow && strike);
    assert.ok(strike.t - glow.t >= 0.9 - EPS, `Vorwarnung ${strike.t - glow.t}`);
    within(strike.t - glow.t, LIGHTNING.GLOW + LIGHTNING.FLICKER, 'Vorwarnung', 3 * STEP);
  }
});

test('Blitz: Ton glow zu Beginn der Vorwarnung und Ton strike beim Einschlag, jeweils einmal pro Zyklus', () => {
  const s = world();
  const b = createLightning(s, 300, { idle: 0.6 });
  s.hazards.push(b);
  let prev = b.phase;
  let glows = 0;
  let strikes = 0;
  for (let i = 0; i < 60 * 12; i++) {
    s.sfx.length = 0; // nimbus-game.js leert die Liste nach jedem Bild
    tick(s);
    if (b.phase === 'glow' && prev === 'idle') {
      glows++;
      assert.equal(sfxCount(s, 'glow'), 1);
    } else {
      assert.equal(sfxCount(s, 'glow'), 0, 'glow nur beim Beginn der Vorwarnung');
    }
    if (b.phase === 'strike' && prev !== 'strike') {
      strikes++;
      assert.equal(sfxCount(s, 'strike'), 1);
    } else {
      assert.equal(sfxCount(s, 'strike'), 0);
    }
    prev = b.phase;
  }
  assert.ok(glows >= 4 && strikes >= 4);
  assert.equal(glows, strikes);
});

test('Blitz: ein Blitz weit außerhalb des Bildes macht keinen Ton', () => {
  const s = world();
  s.hazards.push(createLightning(s, 4000, { idle: 0.2 }));
  tick(s, 60 * 10);
  assert.equal(s.sfx.length, 0);
});


// ---------- Stachelwolken ----------

function spikeScene() {
  const s = world();
  const plat = createStaticPlatform(s, 100, 300, 400);
  s.platforms.push(plat);
  const spike = add(s, createSpike(s, plat, 0.5));
  return { s, plat, spike };
}

test('Stachelwolke: Hitbox ist seitlich 6 px und oben 8 px kleiner als die Zeichnung', () => {
  const { spike } = spikeScene();
  assert.equal(spike.w, SPIKE.w);
  assert.deepEqual(spikeHitbox(spike), { x: spike.x + 6, y: spike.y + 8, w: SPIKE.w - 12, h: SPIKE.h - 8 });
});

test('Stachelwolke: Grenzen der Hitbox', { skip: needsHurt }, () => {
  // Spike: x 282 bis 318, y 272 bis 300. Hitbox x 288 bis 312, y 280 bis 300.
  const hit = (px, py) => {
    const { s } = spikeScene();
    const p = s.player;
    p.x = px;
    p.y = py;
    p.invuln = 0;
    playerVsHazards(s);
    return s.run.hits === 1;
  };
  assert.equal(hit(278, 266), true, 'steht auf der Plattform mitten in der Wolke');
  assert.equal(hit(248, 266), false, 'Hitbox des Spielers berührt die linke Kante nur');
  assert.equal(hit(248.5, 266), true);
  assert.equal(hit(245, 266), false, 'Zeichnung überlappt, Hitbox nicht');
  assert.equal(hit(308, 266), false, 'rechte Kante');
  assert.equal(hit(307.5, 266), true);
  assert.equal(hit(278, 250), false, 'Füße gerade über der oberen Hitbox Kante');
  assert.equal(hit(278, 250.5), true);
  assert.equal(hit(278, 247), false, 'Zeichnung überlappt oben, Hitbox nicht');
  assert.equal(hit(278, 296), false, 'Kopf gerade unter der Unterkante');
  assert.equal(hit(278, 295.5), true);
});

test('Stachelwolke: Berührung ruft hurtPlayer mit Ursache Stachelwolke und Rückstoß weg von der Wolke', { skip: needsHurt }, () => {
  const { s } = spikeScene();
  place(s, 292, 300);
  playerVsHazards(s);
  assert.equal(s.lives, 49);
  assert.equal(s.run.hits, 1);
  assert.deepEqual(s.deathCause, { kind: 'spike', label: 'Stachelwolke' });
  assert.ok(s.player.vx < 0, 'von links berührt, Rückstoß nach links');
  playerVsHazards(s);
  assert.equal(s.run.hits, 1, 'unverwundbar nach dem Treffer');

  const right = spikeScene();
  place(right.s, 310, 300);
  playerVsHazards(right.s);
  assert.ok(right.s.player.vx > 0, 'von rechts berührt, Rückstoß nach rechts');
});

test('Stachelwolke: Schild absorbiert, Unverwundbarkeit, Dash und toter Spieler schützen', { skip: needsHurt }, () => {
  const run = (setup) => {
    const { s } = spikeScene();
    place(s, 300, 300);
    setup(s.player);
    playerVsHazards(s);
    return s;
  };
  let s = run((p) => { p.power.shield = true; });
  assert.equal(s.lives, 50);
  assert.equal(s.player.power.shield, false);
  assert.equal(s.run.hits, 0);
  s = run((p) => { p.invuln = 1; });
  assert.equal(s.lives, 50);
  s = run((p) => { p.dash.t = 0.1; });
  assert.equal(s.lives, 50);
  s = run((p) => { p.dead = true; });
  assert.equal(s.lives, 50);
});

test('Stachelwolke: folgt einer beweglichen Host Plattform in jedem Schritt', () => {
  const s = world();
  const plat = createMovingPlatform(s, 500, 300, 220, { ax: 100, ay: 40, period: 3.2, phase: 0.4 });
  s.platforms.push(plat);
  const spike = add(s, createSpike(s, plat, 0.5));
  const dx = spike.hostDx;
  assert.ok(Math.abs(dx - (spike.x - plat.x)) < EPS);
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < 60 * 8; i++) {
    tick(s);
    assert.ok(Math.abs(spike.x - (plat.x + dx)) < EPS, 'x folgt der Plattform');
    assert.ok(Math.abs(spike.y - (plat.y - SPIKE.h)) < EPS, 'y folgt der Plattform');
    minX = Math.min(minX, spike.x);
    maxX = Math.max(maxX, spike.x);
  }
  assert.ok(maxX - minX > 150, 'die Plattform hat sich wirklich bewegt');
  assert.ok(spike.anim > 7.9, 'anim läuft für die Darstellung');
});

test('Stachelwolke: ist die Host Plattform weg, bleibt die Wolke stehen', () => {
  const s = world();
  const plat = createMovingPlatform(s, 500, 300, 220, { ax: 100, ay: 40 });
  s.platforms.push(plat);
  const spike = add(s, createSpike(s, plat, 0.3));
  tick(s, 45);
  s.platforms = [];
  const { x, y } = spike;
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  tick(s, 120);
  assert.equal(spike.x, x);
  assert.equal(spike.y, y);
  // Auch eine Wolke ohne Host (hostId 0) bleibt stehen
  const lone = add(s, { ...createSpike(s, createStaticPlatform(s, 600, 300, 200), 0.5), hostId: 0 });
  tick(s, 10);
  assert.equal(lone.x, 600 + 0.5 * (200 - SPIKE.w));
});

test('Stachelwolke: wird nur im aktiven Bereich bewegt (camX minus 200 bis camX plus W plus 500)', () => {
  const s = world();
  const near = createMovingPlatform(s, 600, 300, 220, { ax: 100, ay: 0 });
  const far = createMovingPlatform(s, 2000, 300, 220, { ax: 100, ay: 0 });
  s.platforms.push(near, far);
  const a = add(s, createSpike(s, near, 0.5));
  const b = add(s, createSpike(s, far, 0.5));
  const bx = b.x;
  tick(s, 90);
  assert.ok(a.anim > 1.4);
  assert.equal(b.anim, 0);
  assert.equal(b.x, bx);
  // Die Kamera kommt heran: jetzt wird sie aktiv und springt an ihren Platz
  s.camX = 1500;
  tick(s);
  assert.ok(b.anim > 0);
  assert.ok(Math.abs(b.x - (far.x + b.hostDx)) < EPS);
});

// ---------- Regen ----------

function rainRun(z, s, seconds, dt = STEP) {
  const log = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    tick(s, 1, dt);
    log.push({ t: s.t, active: z.active, intensity: z.intensity });
  }
  return log;
}

test('Regen: Zyklus aus (OFF), an (ON), aus, an', () => {
  const s = world();
  const z = add(s, createRain(s, 100));
  assert.equal(z.active, false);
  const log = rainRun(z, s, 24);
  const switches = [];
  let prev = false;
  for (const e of log) {
    if (e.active !== prev) switches.push({ active: e.active, t: e.t });
    prev = e.active;
  }
  const want = [RAIN.OFF, RAIN.OFF + RAIN.ON, 2 * RAIN.OFF + RAIN.ON, 2 * (RAIN.OFF + RAIN.ON), 3 * RAIN.OFF + 2 * RAIN.ON];
  assert.deepEqual(switches.slice(0, 5).map((e) => e.active), [true, false, true, false, true]);
  switches.slice(0, 5).forEach((e, i) => assert.ok(Math.abs(e.t - want[i]) <= 2 * STEP, `Wechsel ${i} bei ${e.t}`));
});

test('Regen: intensity blendet in RAIN.FADE Sekunden sanft ein und aus', () => {
  const s = world();
  const z = add(s, createRain(s, 100));
  const log = rainRun(z, s, 16);
  let last = 0;
  let upFrom = null;
  let downFrom = null;
  let reachedFull = null;
  let reachedZero = null;
  for (const e of log) {
    assert.ok(e.intensity >= 0 && e.intensity <= 1);
    assert.ok(Math.abs(e.intensity - last) <= STEP / RAIN.FADE + EPS, 'nie ein Sprung');
    // Gemessen ab dem Schritt davor: im Schritt des Umschaltens läuft die Blende schon einen Schritt
    if (e.active && upFrom === null) upFrom = e.t - STEP;
    if (e.intensity >= 1 && reachedFull === null) reachedFull = e.t;
    if (!e.active && upFrom !== null && downFrom === null) downFrom = e.t - STEP;
    if (downFrom !== null && e.intensity <= 0 && reachedZero === null) reachedZero = e.t;
    if (upFrom !== null && e.active && e.t > upFrom + RAIN.FADE + 2 * STEP && e.t < RAIN.OFF + RAIN.ON) assert.equal(e.intensity, 1);
    if (!e.active && e.t > RAIN.OFF + RAIN.ON + RAIN.FADE + 2 * STEP && e.t < 2 * RAIN.OFF + RAIN.ON) assert.equal(e.intensity, 0);
    last = e.intensity;
  }
  within(reachedFull - upFrom, RAIN.FADE, 'Einblenden', 2 * STEP);
  within(reachedZero - downFrom, RAIN.FADE, 'Ausblenden', 2 * STEP);
  // Vor dem ersten Regen bleibt alles trocken
  assert.ok(log.filter((e) => e.t < RAIN.OFF - STEP).every((e) => e.intensity === 0));
});

test('Regen: offset verschiebt den Zyklus, ein großer offset beginnt mitten im Regen', () => {
  let s = world();
  let z = add(s, createRain(s, 100, 300, { offset: 2 }));
  let log = rainRun(z, s, 3);
  let first = log.find((e) => e.active);
  assert.ok(Math.abs(first.t - (RAIN.OFF - 2)) <= 2 * STEP, `Start bei ${first.t}`);

  s = world();
  z = add(s, createRain(s, 100, 300, { offset: RAIN.OFF + 1 }));
  log = rainRun(z, s, 6);
  assert.equal(log[0].active, true);
  const end = log.find((e) => !e.active);
  assert.ok(Math.abs(end.t - (RAIN.ON - 1)) <= 2 * STEP, `Ende bei ${end.t}`);
});

test('Regen: außerhalb des Bildbereichs ruht die Zone, im Bild beginnt der Zyklus erst dann', () => {
  const s = world();
  const z = add(s, createRain(s, 4000, 300, { offset: 1 }));
  tick(s, 60 * 30);
  assert.equal(z.active, false);
  assert.equal(z.timer, 1);
  assert.equal(z.intensity, 0);
  // Die Zone liegt genau am Rand des Bildbereichs (Kante bei camX plus W plus 200): sie läuft an
  s.camX = 4000 - W - 200;
  const t0 = s.t;
  const log = rainRun(z, s, 4);
  const start = log.find((e) => e.active);
  assert.ok(Math.abs(start.t - t0 - (RAIN.OFF - 1)) <= 2 * STEP);
  // Eine Zone links vom Bild ruht ebenfalls
  const left = add(s, createRain(s, s.camX - 1000, 300, { offset: 1 }));
  tick(s, 60 * 10);
  assert.equal(left.active, false);
  assert.equal(left.timer, 1);
});

test('Regen: rainAt liefert die größte intensity der Zonen, die den Punkt enthalten', () => {
  const s = world();
  const a = add(s, createRain(s, 100, 300, { y: 90 }));
  const b = add(s, createRain(s, 250, 300, { y: 150 }));
  a.intensity = 0.4;
  b.intensity = 0.9;
  assert.equal(rainAt(s, 150, 200), 0.4);
  assert.equal(rainAt(s, 300, 200), 0.9, 'überlappend: die größere');
  assert.equal(rainAt(s, 300, 120), 0.4, 'über der Wolke der zweiten Zone');
  assert.equal(rainAt(s, 500, 300), 0.9);
  assert.equal(rainAt(s, 90, 200), 0, 'links daneben');
  assert.equal(rainAt(s, 551, 200), 0, 'rechts daneben');
  assert.equal(rainAt(s, 150, 80), 0, 'über der Regenwolke');
  assert.equal(rainAt(s, 150, 90), 0.4, 'auf der Wolke (Rand gehört dazu)');
  assert.equal(rainAt(s, 150, H), 0.4, 'bis zum unteren Bildrand');
  assert.equal(rainAt(s, 150, H + 1), 0, 'darunter nicht mehr');
  b.intensity = 0;
  assert.equal(rainAt(s, 300, 200), 0.4);
  assert.equal(rainAt({ zones: [] }, 1, 1), 0);
  assert.equal(rainAt(s, NaN, 200), 0);
  assert.equal(rainAt(s, 150, NaN), 0);
});

test('Regen: Wind und Hindernisse zählen nicht als Regen', () => {
  const s = world();
  add(s, createWind(s, 0, 0, 1000, 450, { vx: 50 }));
  assert.equal(rainAt(s, 100, 100), 0);
  const r = add(s, createRain(s, 0, 1000));
  r.intensity = 0.5;
  assert.equal(windAt(s, 100, 100).vx, 50);
  assert.equal(rainAt(s, 100, 100), 0.5);
});

test('Regen: gelegentlich leichte Tropfen, nur bei Regen und im Bild, nur wenige pro Sekunde', { skip: needsParticles }, () => {
  // So viele Partikel erzeugt ein einzelnes emit('rain')
  const sizes = [];
  for (let i = 0; i < 12; i++) {
    const p = createState({ seed: i + 1 });
    emit(p, 'rain', 100, 100);
    sizes.push(p.particles.length);
  }
  const perEmit = Math.max(...sizes);
  assert.ok(perEmit >= 1);

  // Es regnet im Bild
  const s = world();
  const z = add(s, createRain(s, 100));
  z.active = true;
  z.timer = 0;
  z.intensity = 1;
  tick(s, 60 * 10);
  assert.ok(s.particles.length >= perEmit, 'es tropft');
  assert.ok(s.particles.length <= perEmit * 5 * 10, `zu viele Tropfen: ${s.particles.length}`);
  for (const p of s.particles) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));

  // Trocken: nichts
  const dry = world();
  add(dry, createRain(dry, 100, 300, { offset: 0 }));
  tick(dry, 60 * 2);
  assert.equal(dry.particles.length, 0);

  // Regen, aber außerhalb des Bildes: nichts
  const away = world();
  const far = add(away, createRain(away, 3000));
  far.active = true;
  far.intensity = 1;
  tick(away, 60 * 10);
  assert.equal(away.particles.length, 0);
});

test('Regen: die Tropfen entstehen im sichtbaren Teil der Zone', { skip: needsParticles }, () => {
  const s = world({ camX: 1000 });
  const z = add(s, createRain(s, 900, 600)); // reicht von 900 bis 1500, sichtbar ab 1000
  z.active = true;
  z.intensity = 1;
  for (let i = 0; i < 600; i++) {
    tick(s);
    for (const p of s.particles) assert.ok(p.x >= 1000 - 1 && p.x <= 1000 + W + 1, `x ${p.x}`);
    s.particles.length = 0;
  }
});

// ---------- Wind ----------

test('Wind: ein Punkt in einer Zone bekommt vx und ay, davor und danach nichts', () => {
  const s = world();
  add(s, createWind(s, 100, 100, 200, 150, { vx: 80, ay: -300 }));
  assert.deepEqual(windAt(s, 150, 150), { vx: 80, ay: -300 });
  assert.deepEqual(windAt(s, 99, 150), { vx: 0, ay: 0 });
  assert.deepEqual(windAt(s, 301, 150), { vx: 0, ay: 0 });
  assert.deepEqual(windAt(s, 150, 99), { vx: 0, ay: 0 });
  assert.deepEqual(windAt(s, 150, 251), { vx: 0, ay: 0 });
  // Rand gehört zur Zone
  assert.deepEqual(windAt(s, 100, 100), { vx: 80, ay: -300 });
  assert.deepEqual(windAt(s, 300, 250), { vx: 80, ay: -300 });
});

test('Wind: überlappende Zonen werden summiert, andere nicht', () => {
  const s = world();
  add(s, createWind(s, 0, 0, 500, 450, { vx: 60, ay: -200 }));
  add(s, createWind(s, 100, 0, 200, 450, { vx: 40, ay: -150 }));
  add(s, createWind(s, 1000, 0, 200, 450, { vx: -100, ay: -700 }));
  assert.deepEqual(windAt(s, 50, 200), { vx: 60, ay: -200 });
  assert.deepEqual(windAt(s, 150, 200), { vx: 100, ay: -350 });
  assert.deepEqual(windAt(s, 1100, 200), { vx: -100, ay: -700 });
  assert.deepEqual(windAt(s, 700, 200), { vx: 0, ay: 0 });
});

test('Wind: die Summe wird auf WIND.MAX_VX und WIND.MAX_LIFT begrenzt', () => {
  const s = world();
  for (let i = 0; i < 3; i++) add(s, createWind(s, 0, 0, 500, 450, { vx: 100, ay: -500 }));
  assert.deepEqual(windAt(s, 10, 10), { vx: WIND.MAX_VX, ay: -WIND.MAX_LIFT });
  const t = world();
  for (let i = 0; i < 3; i++) add(t, createWind(t, 0, 0, 500, 450, { vx: -100, ay: 500 }));
  assert.deepEqual(windAt(t, 10, 10), { vx: -WIND.MAX_VX, ay: WIND.MAX_LIFT });
  // Gegensätzliche Zonen heben sich auf
  const u = world();
  add(u, createWind(u, 0, 0, 500, 450, { vx: 100 }));
  add(u, createWind(u, 0, 0, 500, 450, { vx: -100 }));
  assert.equal(windAt(u, 10, 10).vx, 0);
  // Die Grenzen sind auch bei von Hand gebauten Zonen mit zu großen Werten wirksam
  const v = world();
  v.zones.push({ id: 900, kind: 'wind', x: 0, y: 0, w: 100, h: 100, vx: 5000, ay: -90000 });
  assert.deepEqual(windAt(v, 10, 10), { vx: WIND.MAX_VX, ay: -WIND.MAX_LIFT });
  // Der Wind lässt den Spieler nie schweben: es bleibt eine abwärts gerichtete Gesamtbeschleunigung
  assert.ok(WIND.MAX_VX < 300 / 2 && WIND.MAX_LIFT < 1900);
});

test('Wind: zählt auch ohne Zone das Sturm Ereignis dazu und begrenzt die Summe', () => {
  const s = world();
  assert.equal(windAt(s, 10, 10).vx, clamp(eventWindVx(s), -WIND.MAX_VX, WIND.MAX_VX));
  add(s, createWind(s, 0, 0, 500, 450, { vx: 100 }));
  const ev = eventWindVx(s);
  assert.equal(windAt(s, 10, 10).vx, clamp(100 + ev, -WIND.MAX_VX, WIND.MAX_VX));
  assert.equal(windAt(s, 999, 10).vx, clamp(ev, -WIND.MAX_VX, WIND.MAX_VX), 'Ereigniswind gilt überall');
});

// Sucht einen Zeitpunkt, an dem das Sturm Ereignis spürbaren Wind liefert (mit dem Stub aus events.js gibt es keinen)
function stormWorld() {
  const s = world();
  startEvent(s, 'storm');
  if (!s.events.active) return null;
  for (let t = 0.5; t < 13; t += 0.25) {
    s.events.active.t = t;
    s.t = t;
    if (Math.abs(eventWindVx(s)) > 5) return s;
  }
  return null;
}
const storm = stormWorld();

test('Wind: Traumsturm schiebt überall und addiert sich zu den Zonen', { skip: storm ? false : 'events.js liefert noch keinen Ereigniswind' }, () => {
  const ev = eventWindVx(storm);
  assert.ok(Math.abs(ev) <= 70);
  assert.equal(windAt(storm, 5, 5).vx, ev);
  storm.zones.push(createWind(storm, 0, 0, 500, 450, { vx: ev > 0 ? 100 : -100 }));
  assert.equal(windAt(storm, 5, 5).vx, clamp(ev + (ev > 0 ? 100 : -100), -WIND.MAX_VX, WIND.MAX_VX));
});

test('Wind: windAt gibt jedes Mal ein neues Objekt zurück, das Zustand nicht verändert', () => {
  const s = world();
  const z = add(s, createWind(s, 0, 0, 500, 450, { vx: 50, ay: -100 }));
  const a = windAt(s, 10, 10);
  a.vx = 9999;
  assert.equal(windAt(s, 10, 10).vx, 50);
  assert.equal(z.vx, 50);
  assert.equal(z.ay, -100);
});

// ---------- clearHazardsNear ----------

test('clearHazardsNear entfernt Stachelwolken im Bereich und lässt die anderen stehen', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 300, 3000);
  s.platforms.push(plat);
  const a = add(s, createSpike(s, plat, 100 / (3000 - SPIKE.w)));
  const b = add(s, createSpike(s, plat, 600 / (3000 - SPIKE.w)));
  const c = add(s, createSpike(s, plat, 1200 / (3000 - SPIKE.w)));
  clearHazardsNear(s, 500, 800);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id, c.id]);
  // Randfälle: eine Wolke, die den Bereich nur berührt, zählt als drin
  clearHazardsNear(s, 1200 + SPIKE.w, 1500);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id]);
  clearHazardsNear(s, 100 - 50, 100 - 1);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id], 'knapp daneben');
});

test('clearHazardsNear setzt Blitze im Bereich auf idle mit idleTime plus 2 und charge 0', () => {
  const s = world();
  const inside = add(s, createLightning(s, 400, { idle: 1.5 }));
  const outside = add(s, createLightning(s, 1200, { idle: 1.5 }));
  inside.phase = 'flicker';
  inside.timer = 0.2;
  inside.charge = 0.95;
  outside.phase = 'flicker';
  outside.timer = 0.2;
  outside.charge = 0.95;
  outside.x = 1200;
  clearHazardsNear(s, 300, 700);
  assert.equal(inside.phase, 'idle');
  assert.equal(inside.timer, 1.5 + 2);
  assert.equal(inside.charge, 0);
  assert.equal(inside.struck, false);
  assert.equal(outside.phase, 'flicker');
  assert.equal(outside.timer, 0.2);
  assert.equal(outside.charge, 0.95);
  assert.equal(s.hazards.length, 2, 'Blitze bleiben erhalten');

  // Wirkt auch mitten im Einschlag
  inside.phase = 'strike';
  inside.struck = true;
  clearHazardsNear(s, 300, 700);
  assert.equal(inside.phase, 'idle');
  assert.equal(inside.struck, false);
});

test('clearHazardsNear: ein Blitz, dessen Säule den Bereich nur streift, wird zurückgesetzt', () => {
  const s = world();
  const b = add(s, createLightning(s, 400, { idle: 1 })); // Säule von 372 bis 428
  b.phase = 'glow';
  clearHazardsNear(s, 428, 900);
  assert.equal(b.phase, 'idle');
  const c = add(s, createLightning(s, 400, { idle: 1 }));
  c.phase = 'glow';
  clearHazardsNear(s, 428.5, 900);
  assert.equal(c.phase, 'glow');
});

test('clearHazardsNear: nach dem Zurücksetzen schlägt der Blitz frühestens idleTime plus 2 plus Vorwarnung ein', () => {
  const s = world();
  const b = add(s, createLightning(s, 400, { idle: 1.0 }));
  tick(s, 60 * 1.2);
  assert.equal(b.phase, 'glow');
  clearHazardsNear(s, 300, 500);
  const t0 = s.t;
  let strike = null;
  for (let i = 0; i < 60 * 10 && strike === null; i++) {
    tick(s);
    if (b.phase === 'strike') strike = s.t;
  }
  assert.ok(strike - t0 >= 1.0 + 2 + 0.9 - EPS, `Einschlag nach ${strike - t0}`);
});

test('clearHazardsNear: vertauschte Grenzen, NaN, leere Liste, Zonen bleiben unberührt', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 300, 3000);
  s.platforms.push(plat);
  const spike = add(s, createSpike(s, plat, 0.2));
  const z = add(s, createRain(s, spike.x, 200));
  const w = add(s, createWind(s, spike.x, 0, 200, 450, { vx: 50 }));
  clearHazardsNear(s, NaN, 100);
  clearHazardsNear(s, 0, Infinity);
  clearHazardsNear(s, undefined, undefined);
  assert.equal(s.hazards.length, 1);
  clearHazardsNear(s, spike.x + 100, spike.x - 100);
  assert.equal(s.hazards.length, 0);
  assert.deepEqual(s.zones.map((e) => e.id), [z.id, w.id]);
  clearHazardsNear(s, 0, 10000);
  assert.equal(s.hazards.length, 0);
});

// ---------- Alle Hindernisarten zusammen ----------

test('Alle Hindernisarten an einer Stelle kosten pro Schritt nur ein Leben und der Rest bleibt Daten', { skip: needsHurt }, () => {
  const s = world();
  const plat = createStaticPlatform(s, 100, 360, 400);
  s.platforms.push(plat);
  const spike = add(s, createSpike(s, plat, 0.5));
  const light = add(s, createLightning(s, spike.x + 18, { idle: 1 }));
  const comet = add(s, createComet(s, spike.x + 18, 360, { idle: 1 }));
  const hail = add(s, createHail(s, spike.x + 18, 340, 0, 0));
  light.phase = 'strike';
  light.timer = 0.2;
  comet.phase = 'strike';
  comet.timer = 0.2;
  place(s, spike.x + 18, 360);
  playerVsHazards(s);
  assert.equal(s.run.hits, 1);
  assert.equal(s.lives, 49);
  for (let i = 0; i < 5; i++) playerVsHazards(s);
  assert.equal(s.run.hits, 1, 'unverwundbar nach dem ersten Treffer');
  assert.ok(s.hazards.includes(spike) && s.hazards.includes(light) && s.hazards.includes(comet));
  assert.ok(s.hazards.length === 3 || s.hazards.includes(hail));
  assert.deepEqual(structuredClone(s.hazards), s.hazards);
});

test('updateObstacles lässt Reihenfolge und Zahl der Hindernisse bis auf verschwundene Hagelkörner unverändert', () => {
  const s = world();
  const plat = createStaticPlatform(s, 100, 360, 400);
  s.platforms.push(plat);
  const kinds = [];
  for (let i = 0; i < 6; i++) {
    kinds.push(add(s, createSpike(s, plat, i / 6)).id);
    kinds.push(add(s, createComet(s, 4000 + i * 100, 360)).id);
    add(s, createHail(s, 300 + i * 10, 330, 0, 300)); // fällt in wenigen Schritten auf die Plattform
    kinds.push(add(s, createLightning(s, 5000 + i * 100)).id);
  }
  assert.equal(s.hazards.filter((h) => h.kind === 'hail').length, 6);
  tick(s, 12);
  assert.equal(s.hazards.filter((h) => h.kind === 'hail').length, 0, 'alle Körner sind auf der Plattform zerplatzt');
  assert.deepEqual(s.hazards.map((h) => h.id), kinds);
});

// ---------- Zusammenspiel mit sim.js und player.js ----------

test('sim: Blitz über dem stehenden Spieler trifft nach der Vorwarnung genau einmal', { skip: needsHurt }, () => {
  const s = newGame(5);
  s.hazards.length = 0;
  const idle = [];
  for (let i = 0; i < 40; i++) stepSim(s, input());
  const p = s.player;
  assert.equal(p.onGround, true);
  const b = createLightning(s, p.x + p.w / 2, { idle: 0.5 });
  s.hazards.push(b);
  p.invuln = 0;
  let glowT = null;
  let hitT = null;
  for (let i = 0; i < 60 * 3 && hitT === null; i++) {
    stepSim(s, input());
    if (b.phase === 'glow' && glowT === null) glowT = s.t;
    if (s.run.hits > 0) hitT = s.t;
    else idle.push(b.phase);
  }
  assert.ok(glowT !== null && hitT !== null);
  assert.ok(hitT - glowT >= 0.9 - EPS, `Vorwarnung ${hitT - glowT}`);
  assert.equal(s.lives, 2);
  assert.equal(b.phase, 'strike');
  assert.deepEqual(s.deathCause, { kind: 'lightning', label: 'Blitz' });
  assert.ok(idle.includes('glow') && idle.includes('flicker'), 'der Spieler sah die Vorwarnung');
});

test('sim: im Regen wird der Spieler nass, im Wind driftet er', () => {
  const s = newGame(5);
  s.zones.push(createRain(s, -500, 3000));
  s.zones.push(createWind(s, -500, 0, 3000, 450, { vx: 100 }));
  const r = s.zones[0];
  r.active = true;
  r.timer = 0;
  r.intensity = 1;
  for (let i = 0; i < 90; i++) stepSim(s, input());
  assert.ok(s.player.wet > 0.8, `wet ${s.player.wet}`);
  assert.ok(s.player.windVx > 90 && s.player.windVx <= 100, `windVx ${s.player.windVx}`);
});

test('sim: Spieler steht unter Wind, Eingabe nach links gewinnt gegen den Wind', () => {
  const s = newGame(5);
  s.zones.push(createWind(s, -500, 0, 3000, 450, { vx: WIND.MAX_VX }));
  for (let i = 0; i < 40; i++) stepSim(s, input());
  const x0 = s.player.x;
  for (let i = 0; i < 60; i++) stepSim(s, input({ move: -1 }));
  assert.ok(s.player.x < x0 - 100, 'trotz Gegenwind vorwärts im Sinne der Eingabe');
});

// ---------- Fuzz ----------

function randomWorld(seed) {
  const r = { rng: seed };
  const s = createState({ seed });
  s.lives = 99;
  const plats = [];
  for (let i = 0; i < 6; i++) {
    const x = i * 500 + range(r, -40, 40);
    const p = rand(r) < 0.4
      ? createMovingPlatform(s, x + 200, range(r, 250, 380), range(r, 150, 260), { ax: range(r, 0, 120), ay: range(r, 0, 60), period: range(r, 2.2, 5), phase: range(r, 0, 6) })
      : createStaticPlatform(s, x, range(r, 250, 380), range(r, 160, 420));
    s.platforms.push(p);
    plats.push(p);
  }
  const n = int(r, 4, 12);
  for (let i = 0; i < n; i++) {
    const roll = rand(r);
    if (roll < 0.4) add(s, createSpike(s, plats[int(r, 0, plats.length - 1)], rand(r)));
    else if (roll < 0.7) add(s, createLightning(s, range(r, 0, 3000), { idle: range(r, 0, 3) }));
    else if (roll < 0.9) add(s, createComet(s, range(r, 0, 3000), range(r, 250, 400), { idle: range(r, 0, 3), dir: rand(r) < 0.5 ? -1 : 1 }));
    else add(s, createHail(s, range(r, 0, 3000), range(r, -20, 200), range(r, -120, 120), range(r, 100, 360)));
  }
  for (let i = 0; i < 4; i++) {
    const x = range(r, 0, 3000);
    if (rand(r) < 0.5) add(s, createWind(s, x, range(r, 0, 200), range(r, 50, 600), range(r, 50, 400), { vx: range(r, -300, 300), ay: range(r, -2000, 2000) }));
    else add(s, createRain(s, x, range(r, 100, 500), { y: range(r, 40, 200), offset: range(r, 0, 9) }));
  }
  return { s, r };
}

// Gibt es zum Treffer einen sichtbaren Grund (Blitz oder Komet in strike, Stachelwolke, Hagelkorn)?
// hazards ist der Stand unmittelbar vor der Trefferprüfung (ein treffendes Korn ist danach aus der Liste).
function hasCause(s, hazards) {
  const p = s.player;
  const px0 = p.x + 4;
  const px1 = p.x + p.w - 4;
  const py0 = p.y + 4;
  const py1 = p.y + p.h - 4;
  const circle = (h, r) => {
    const dx = clamp(h.x, px0, px1) - h.x;
    const dy = clamp(h.y, py0, py1) - h.y;
    return dx * dx + dy * dy < r * r;
  };
  for (const h of hazards) {
    if (h.kind === 'lightning' && h.phase === 'strike') {
      const c = lightningColumn(h);
      if (px1 > c.x && px0 < c.x + c.w && py1 > c.y && py0 < c.y + c.h) return true;
    }
    if (h.kind === 'spike') {
      const b = spikeHitbox(h);
      if (px1 > b.x && px0 < b.x + b.w && py1 > b.y && py0 < b.y + b.h) return true;
    }
    if (h.kind === 'comet' && h.phase === 'strike' && circle(h, COMET.RADIUS)) return true;
    if (h.kind === 'hail' && circle(h, HAIL.R - 2)) return true;
  }
  return false;
}

test('Fuzz: zufällige Welten, Kamerasprünge und Schrittweiten erzeugen nie NaN und nie unerklärliche Treffer', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { s, r } = randomWorld(seed);
    const p = s.player;
    for (let i = 0; i < 1500; i++) {
      const roll = rand(r);
      const dt = roll < 0.85 ? STEP : roll < 0.9 ? 0 : roll < 0.95 ? 0.05 : 0.1;
      const jump = rand(r);
      if (jump < 0.01) s.camX = range(r, -200, 3500);
      else s.camX += 4;
      p.x = s.camX + range(r, 0, W);
      p.y = range(r, 0, 470);
      p.invuln = rand(r) < 0.2 ? 0 : p.invuln;
      const hits = s.run.hits;
      const lives = s.lives;
      // Schritt wie tick, aber mit Blick auf die Hindernisse unmittelbar vor der Trefferprüfung
      s.t += dt;
      s.player.invuln = Math.max(0, s.player.invuln - dt);
      updatePlatforms(s, dt);
      updateObstacles(s, dt);
      const seen = s.hazards.map((h) => ({ ...h }));
      playerVsHazards(s);
      if (s.run.hits !== hits) assert.ok(hasCause(s, seen), `Seed ${seed} Schritt ${i}: Treffer ohne Ursache`);
      assert.ok(s.lives <= lives && s.lives >= 0);
      if (rand(r) < 0.01) clearHazardsNear(s, p.x - 260, p.x + p.w + 420);
      const w = windAt(s, range(r, -100, 3500), range(r, -50, 500));
      assert.ok(Number.isFinite(w.vx) && Number.isFinite(w.ay));
      assert.ok(Math.abs(w.vx) <= WIND.MAX_VX && Math.abs(w.ay) <= WIND.MAX_LIFT);
      const rn = rainAt(s, range(r, -100, 3500), range(r, -50, 500));
      assert.ok(rn >= 0 && rn <= 1);
      for (const h of s.hazards) {
        if (h.kind === 'lightning') {
          assert.ok(PHASES.includes(h.phase));
          assert.ok(h.charge >= 0 && h.charge <= 1 && Number.isFinite(h.timer));
        }
        if (h.kind === 'comet') {
          assert.ok(['idle', 'warn', 'strike', 'cooldown'].includes(h.phase));
          assert.ok(h.charge >= 0 && h.charge <= 1 && h.progress >= 0 && h.progress <= 1 && Number.isFinite(h.timer));
        }
        if (h.kind === 'hail') assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && h.life > 0);
      }
      for (const z of s.zones) if (z.kind === 'rain') assert.ok(z.intensity >= 0 && z.intensity <= 1 && Number.isFinite(z.timer));
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});

test('Fuzz: kaputte Daten und ungültige Zeitschritte werfen nichts und verschlechtern nichts', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 300, 600);
  s.platforms.push(plat);
  const bad = [
    { ...createLightning(s, NaN) },
    { ...createLightning(s, 300), timer: NaN, phase: 'strike' },
    { ...createLightning(s, 310), phase: 'kaputt' },
    { ...createLightning(s, 320), idleTime: NaN, timer: -5 },
    { ...createLightning(s, 330), w: NaN },
    { ...createSpike(s, plat, 0.5), hostDx: NaN },
    { ...createSpike(s, plat, 0.5), x: NaN },
    { ...createSpike(s, plat, 0.5), hostId: 123456 },
  ];
  s.hazards.push(...bad);
  s.zones.push(
    { ...createRain(s, 100), timer: NaN, intensity: NaN },
    { ...createRain(s, 100), onTime: 0 },
    { ...createRain(s, 100), offTime: 0 },
    { ...createRain(s, NaN) },
    { id: 777, kind: 'wind', x: 0, y: 0, w: 500, h: 450 },
    { id: 778, kind: 'wind', x: 0, y: 0, w: 500, h: 450, vx: NaN, ay: NaN },
  );
  place(s, 320, 360);
  for (let i = 0; i < 600; i++) {
    tick(s, 1, STEP);
    const w = windAt(s, 320, 300);
    assert.ok(Number.isFinite(w.vx) && Number.isFinite(w.ay));
    assert.ok(Number.isFinite(rainAt(s, 150, 300)));
  }
  // Gesunde Bestandteile sind danach in Ordnung
  assert.ok(PHASES.includes(s.hazards[1].phase) && Number.isFinite(s.hazards[1].timer));
  assert.ok(PHASES.includes(s.hazards[2].phase));
  assert.ok(Number.isFinite(s.hazards[3].timer) && Number.isFinite(s.hazards[3].idleTime));
  assert.ok(Number.isFinite(s.zones[0].intensity) && s.zones[0].intensity >= 0 && s.zones[0].intensity <= 1);

  for (const dt of [0, -1, NaN, undefined, -0.5]) {
    const before = JSON.stringify(s.hazards.concat(s.zones));
    updateObstacles(s, dt);
    assert.equal(JSON.stringify(s.hazards.concat(s.zones)), before, `dt ${dt}`);
  }
  s.camX = NaN;
  updateObstacles(s, STEP);
  playerVsHazards(s);
  s.hazards = [];
  s.zones = [];
  updateObstacles(s, STEP);
  playerVsHazards(s);
  assert.deepEqual(windAt(s, NaN, NaN).vx, 0);
});

test('Fuzz: Spiel mit eigenen Hindernissen läuft stabil, Blitzschäden gibt es nur im Einschlag', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = newGame(seed);
    const plat = s.platforms[0];
    s.hazards.push(createSpike(s, plat, 0.9), createLightning(s, plat.x + 300, { idle: 0.6 }), createLightning(s, plat.x + 700, { idle: 1.1 }));
    s.zones.push(createWind(s, plat.x, 0, 400, 450, { vx: 90, ay: -300 }), createRain(s, plat.x + 200, 300, { offset: 2 }));
    s.lives = 99;
    let prevHits = 0;
    for (let i = 0; i < 60 * 12; i++) {
      stepSim(s, input({ move: i % 200 < 140 ? 1 : -1, jumpPressed: i % 37 === 0, jumpHeld: i % 37 < 22 }));
      if (s.run.hits > prevHits && s.deathCause && s.deathCause.kind === 'lightning') {
        assert.ok(s.hazards.some((h) => h.kind === 'lightning' && h.phase === 'strike'), `Seed ${seed}: Blitzschaden ohne Einschlag`);
      }
      prevHits = s.run.hits;
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});
