import test from 'node:test';
import assert from 'node:assert/strict';
import { COMET, H, STEP, W } from '../game/constants.js';
import { createBuilder } from '../game/builder.js';
import { createComet, createLightning, createRain, createSpike, createStaticPlatform } from '../game/entities.js';
import { createState } from '../game/state.js';
import { int, rand, range } from '../game/rng.js';
import { hurtPlayer } from '../game/player.js';
import { updatePlatforms } from '../game/platforms.js';
import { stepSim } from '../game/sim.js';
import { clearHazardsNear, cometHitbox, cometPosition, playerVsHazards, updateObstacles } from '../game/obstacles.js';
import { input, invariants, newGame } from './helpers.mjs';

// ---------- Hilfen ----------

// Schaden kommt aus player.js. Solange dort noch ein Stub liegt, werden nur die Prüfungen übersprungen, die ihn beobachten.
const REAL_HURT = (() => {
  const s = createState();
  return hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 }) !== 'ignored';
})();
const needsHurt = REAL_HURT ? false : 'player.js ist noch ein Stub (hurtPlayer)';

const PHASES = ['idle', 'warn', 'strike', 'cooldown'];
const EPS = 1e-9;
const MIN_WARN = 1.1;

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

function addComet(s, x, y = 360, o = {}) {
  const c = createComet(s, x, y, o);
  s.hazards.push(c);
  return c;
}

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

// Phasenwechsel: [{ phase, t }], der erste Eintrag ist der Zustand vor dem ersten Schritt
function trace(s, c, seconds, dt = STEP) {
  const log = [{ phase: c.phase, t: s.t }];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    tick(s, 1, dt);
    if (c.phase !== log[log.length - 1].phase) log.push({ phase: c.phase, t: s.t });
  }
  return log;
}

function within(actual, want, label, slack = 2 * STEP) {
  assert.ok(actual >= want - EPS && actual <= want + slack, `${label}: ${actual} statt ${want}`);
}

const sfxCount = (s, name) => s.sfx.filter((e) => e.n === name).length;

// ---------- Form und Zeitverlauf ----------

test('createComet: Form, Standardwerte und Tempo', () => {
  const s = createState();
  const c = createComet(s, 500, 360);
  assert.equal(c.kind, 'comet');
  assert.equal(c.phase, 'idle');
  assert.equal(c.timer, 1.6);
  assert.equal(c.idleTime, 1.6);
  assert.equal(c.charge, 0);
  assert.equal(c.progress, 0);
  assert.equal(c.dir, 1);
  assert.equal(c.w, COMET.W);
  // Tempo verkürzt nur die Ruhe, nie weniger als 0,8 s
  assert.ok(createComet(s, 0, 0, { pace: 1.5 }).idleTime < 1.6);
  assert.equal(createComet(s, 0, 0, { pace: 5 }).idleTime, 0.8);
  assert.equal(createComet(s, 0, 0, { pace: 1 }).idleTime, 1.6);
  assert.deepEqual(structuredClone(c), c);
});

test('Komet: Phasenfolge und Dauern entsprechen COMET', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 1.0 });
  const log = trace(s, c, 14);
  assert.deepEqual(
    log.slice(0, 9).map((e) => e.phase),
    ['idle', 'warn', 'strike', 'cooldown', 'idle', 'warn', 'strike', 'cooldown', 'idle'],
  );
  const dur = (i) => log[i + 1].t - log[i].t;
  within(dur(0), 1.0, 'erste Ruhe');
  within(dur(1), COMET.WARN, 'warn');
  within(dur(2), COMET.STRIKE, 'strike');
  within(dur(3), COMET.COOLDOWN, 'cooldown');
  within(dur(4), 1.0, 'zweite Ruhe');
  within(dur(5), COMET.WARN, 'warn, zweiter Zyklus');
});

test('Komet: zwischen Beginn von warn und Einschlag liegen immer mindestens 1,1 s', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 0.8 });
  const log = trace(s, c, 30);
  let cycles = 0;
  for (let i = 0; i < log.length; i++) {
    if (log[i].phase !== 'warn') continue;
    const strike = log.slice(i).find((e) => e.phase === 'strike');
    if (!strike) continue;
    const warn = strike.t - log[i].t;
    assert.ok(warn >= MIN_WARN - EPS, `Vorwarnung ${warn}`);
    within(warn, COMET.WARN, 'Vorwarnung', 3 * STEP);
    cycles++;
  }
  assert.ok(cycles >= 6, `nur ${cycles} Zyklen`);
});

test('Komet: auch mit kürzeren Konstanten bleibt die Vorwarnung mindestens 1,1 s', () => {
  const saved = { ...COMET };
  try {
    COMET.WARN = 0.3;
    const s = world();
    const c = addComet(s, 300, 360, { idle: 0.5 });
    const log = trace(s, c, 8);
    const warn = log.find((e) => e.phase === 'warn');
    const strike = log.find((e) => e.phase === 'strike');
    assert.ok(warn && strike);
    assert.ok(strike.t - warn.t >= MIN_WARN - EPS, `Vorwarnung ${strike.t - warn.t}`);
  } finally {
    Object.assign(COMET, saved);
  }
});

for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1, 0.5]) {
  test(`Komet: Vorwarnung bleibt bei Schrittweite ${dt.toFixed(4)} erhalten und kein Einschlag fällt aus`, () => {
    const s = world();
    const c = addComet(s, 300, 360, { idle: 0.9 });
    const log = trace(s, c, 20, dt);
    const strikes = log.filter((e) => e.phase === 'strike').length;
    assert.ok(strikes >= 2, `nur ${strikes} Einschläge`);
    for (let i = 0; i < log.length; i++) {
      if (log[i].phase !== 'warn') continue;
      const strike = log.slice(i).find((e) => e.phase === 'strike');
      if (strike) assert.ok(strike.t - log[i].t >= MIN_WARN - EPS, `Vorwarnung ${strike.t - log[i].t}`);
    }
    const order = log.map((e) => PHASES.indexOf(e.phase));
    for (let i = 1; i < order.length; i++) assert.equal(order[i], (order[i - 1] + 1) % PHASES.length);
  });
}

test('Komet: Tempo (pace) verkürzt nur die Ruhephase, nie die Vorwarnung', () => {
  const fast = world();
  const slow = world();
  const a = addComet(fast, 300, 360, { idle: 1.6, pace: 1.6 });
  const b = addComet(slow, 300, 360, { idle: 1.6, pace: 1 });
  const la = trace(fast, a, 12);
  const lb = trace(slow, b, 12);
  const idleOf = (log) => log[1].t - log[0].t;
  const warnOf = (log) => log[2].t - log[1].t;
  assert.ok(idleOf(la) < idleOf(lb) - 0.4, `Ruhe ${idleOf(la)} gegen ${idleOf(lb)}`);
  within(idleOf(la), a.idleTime, 'Ruhe mit Tempo');
  within(warnOf(la), COMET.WARN, 'warn mit Tempo');
  within(warnOf(lb), COMET.WARN, 'warn ohne Tempo');
  assert.ok(warnOf(la) >= MIN_WARN - EPS);

  // Der Builder leitet das Tempo aus der Schwierigkeit ab (paceAt) und reicht es an createComet und createLightning durch
  const s = createState({ seed: 3 });
  const make = (diff) => createBuilder(s, { ox: 0, oy: 300, diff, meter: 0, mechs: new Set(), measure: true });
  const easy = make(1);
  const hard = make(9);
  assert.equal(easy.pace, 1);
  assert.ok(hard.pace > 1.4);
  assert.ok(hard.comet(100, 0).idleTime < easy.comet(100, 0).idleTime, 'Komet: schwerer heißt kürzere Ruhe');
  assert.ok(hard.lightning(300).idleTime < easy.lightning(300).idleTime, 'Blitz: schwerer heißt kürzere Ruhe');
  assert.ok(hard.comet(100, 0).idleTime >= 0.8);
});

test('Komet: charge steigt in warn von 0 auf 1, in strike 1, sonst 0. progress läuft nur in strike von 0 auf 1', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 0.5 });
  const seen = { idle: [], warn: [], strike: [], cooldown: [] };
  const progress = { idle: [], warn: [], strike: [], cooldown: [] };
  for (let i = 0; i < 60 * 6; i++) {
    tick(s);
    seen[c.phase].push(c.charge);
    progress[c.phase].push(c.progress);
    assert.ok(c.charge >= 0 && c.charge <= 1 && c.progress >= 0 && c.progress <= 1);
  }
  assert.ok(seen.strike.length > 0 && seen.warn.length > 0);
  assert.ok(seen.idle.every((v) => v === 0), 'idle: charge 0');
  assert.ok(seen.cooldown.every((v) => v === 0), 'cooldown: charge 0');
  assert.ok(seen.strike.every((v) => v === 1), 'strike: charge 1');
  const warn = seen.warn.slice(0, Math.round(COMET.WARN / STEP) - 1); // erster Zyklus
  assert.equal(warn[0], 0, 'warn beginnt bei 0');
  assert.ok(warn[warn.length - 1] > 0.95, 'warn endet nahe 1');
  for (let i = 1; i < warn.length; i++) assert.ok(warn[i] > warn[i - 1] - EPS, 'charge steigt durchgehend');
  for (const ph of ['idle', 'warn', 'cooldown']) assert.ok(progress[ph].every((v) => v === 0), `${ph}: progress 0`);
  const st = progress.strike.slice(0, Math.round(COMET.STRIKE / STEP));
  assert.equal(st[0], 0, 'strike beginnt bei 0');
  assert.ok(st[st.length - 1] > 0.85, 'strike endet nahe 1');
  for (let i = 1; i < st.length; i++) assert.ok(st[i] > st[i - 1] - EPS, 'progress steigt durchgehend');
});

// ---------- Flugbahn ----------

test('cometPosition: Anflug aus Richtung dir, endet am Einschlagpunkt', () => {
  const s = world();
  for (const dir of [1, -1]) {
    const c = addComet(s, 400, 360, { dir });
    const start = cometPosition(c);
    assert.ok(start.y < 360 - 200, 'beginnt hoch am Himmel');
    assert.ok(dir > 0 ? start.x > 400 + 100 : start.x < 400 - 100, `beginnt seitlich auf der Seite dir ${dir}`);
    c.phase = 'strike';
    let last = start;
    for (let k = 0; k <= 10; k++) {
      c.progress = k / 10;
      const p = cometPosition(c);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.y >= last.y - EPS, 'fliegt nach unten');
      assert.ok(dir > 0 ? p.x <= last.x + EPS : p.x >= last.x - EPS, 'fliegt zur Mitte');
      last = p;
    }
    assert.deepEqual(last, { x: 400, y: 360 });
    c.phase = 'cooldown';
    assert.deepEqual(cometPosition(c), { x: 400, y: 360 });
    c.phase = 'warn';
    assert.deepEqual(cometPosition(c), start);
  }
});

test('cometHitbox: Kreis mit COMET.RADIUS um den Einschlagpunkt', () => {
  const s = world();
  const c = addComet(s, 300, 360);
  assert.deepEqual(cometHitbox(c), { x: 300, y: 360, r: COMET.RADIUS });
});

// ---------- Schaden ----------

test('Komet: in idle, warn und cooldown entsteht nie Schaden, selbst mitten im Einschlagpunkt', () => {
  for (const phase of ['idle', 'warn', 'cooldown']) {
    const s = world();
    const c = addComet(s, 300, 360);
    c.phase = phase;
    c.timer = 5;
    place(s, 300, 360);
    for (let i = 0; i < 10; i++) playerVsHazards(s);
    assert.equal(s.lives, 50, phase);
    assert.equal(s.run.hits, 0, phase);
    assert.equal(s.deathCause, null, phase);
  }
});

test('Komet: in der Phase strike trifft der Kreis, Ursache ist Komet, Rückstoß weg vom Einschlag', { skip: needsHurt }, () => {
  const s = world();
  const c = addComet(s, 300, 360);
  c.phase = 'strike';
  c.timer = 0.2;
  place(s, 290, 360);
  playerVsHazards(s);
  assert.equal(s.lives, 49);
  assert.equal(s.run.hits, 1);
  assert.deepEqual(s.deathCause, { kind: 'comet', label: 'Komet' });
  assert.ok(s.player.vx < 0, 'Rückstoß weg vom Einschlagpunkt');
  for (let i = 0; i < 5; i++) playerVsHazards(s);
  assert.equal(s.run.hits, 1, 'unverwundbar: kein zweiter Treffer im selben Einschlag');

  const right = world();
  const c2 = addComet(right, 300, 360);
  c2.phase = 'strike';
  c2.timer = 0.2;
  place(right, 320, 360);
  playerVsHazards(right);
  assert.ok(right.player.vx > 0);
});

test('Komet: Spieler am Einschlagpunkt verliert pro Einschlag genau ein Leben und nur in der Phase strike', { skip: needsHurt }, () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 1.0 });
  place(s, 300, 360);
  let strikes = 0;
  let prev = c.phase;
  for (let i = 0; i < 60 * 20; i++) {
    const hits = s.run.hits;
    const lives = s.lives;
    tick(s);
    if (c.phase === 'strike' && prev !== 'strike') strikes++;
    prev = c.phase;
    if (s.run.hits !== hits) assert.equal(c.phase, 'strike', 'Treffer außerhalb von strike');
    if (c.phase !== 'strike') assert.equal(s.lives, lives, `Leben in ${c.phase} verloren`);
  }
  assert.ok(strikes >= 4);
  assert.equal(s.run.hits, strikes);
  assert.equal(s.lives, 50 - strikes);
});

test('Komet: Trefferkreis (Radius 40 um den Einschlagpunkt gegen die Spielerbox mit 4 px Abzug)', { skip: needsHurt }, () => {
  const hit = (px, py) => {
    const s = world();
    const c = addComet(s, 300, 360);
    c.phase = 'strike';
    c.timer = 1;
    const p = s.player;
    p.x = px;
    p.y = py;
    p.invuln = 0;
    playerVsHazards(s);
    return s.run.hits === 1;
  };
  // Spieler 44 mal 34, Hitbox von x plus 4 bis x plus 40 und y plus 4 bis y plus 30.
  // Füße auf dem Boden (y 326): Hitbox y 330 bis 356, nächster Punkt zum Mittelpunkt (300, 360) liegt 4 px über ihm.
  assert.equal(hit(278, 326), true, 'mitten drin');
  // Seitlich: nächster Punkt (x1, 356): Abstand sqrt(dx² + 16) < 40 heißt dx < 39,8
  assert.equal(hit(300 + 39 - 4, 326), true, 'rechter Rand, knapp drin (Hitbox links bei 339)');
  assert.equal(hit(300 + 40 - 4, 326), false, 'Hitbox beginnt genau bei 340: kein Treffer');
  assert.equal(hit(300 - 40 - 44 + 4, 326), false, 'linker Rand: Hitbox endet bei 260');
  assert.equal(hit(300 - 38 - 44 + 4, 326), true, 'linker Rand, knapp drin');
  // Senkrecht: Sprung über den Einschlag. Hitbox unten bei y + 30 muss über 360 - 40 = 320 bleiben.
  assert.equal(hit(278, 326 - 30), true, 'Füße 30 px über dem Boden: noch im Kreis');
  assert.equal(hit(278, 326 - 36), false, 'Füße 36 px über dem Boden: Hitbox unten bei 320, Berühren zählt nicht');
  assert.equal(hit(278, 326 - 37), false, 'darüber');
  assert.equal(hit(278, 326 - 35.5), true, 'Füße 35,5 px über dem Boden: knapp drin');
  assert.equal(hit(278, 326 - 100), false, 'hoher Sprung rettet');
  // Unter dem Einschlagpunkt (im Boden): Hitbox oben bei y + 4 muss unter 400 liegen
  assert.equal(hit(278, 395.5), true);
  assert.equal(hit(278, 396), false, 'Hitbox beginnt genau bei 400');
});

test('Komet: kein Treffer bei Unverwundbarkeit, im Dash, mit Schild nur Absorbieren, nicht beim toten Spieler', { skip: needsHurt }, () => {
  const strike = () => {
    const s = world();
    const c = addComet(s, 300, 360);
    c.phase = 'strike';
    c.timer = 1;
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

test('Komet: ein Spieler außerhalb des Kreises überlebt jeden Einschlag unverletzt', () => {
  const s = world();
  addComet(s, 300, 360, { idle: 0.8 });
  place(s, 300 + 40 + 22 + 6, 360);
  tick(s, 60 * 15);
  assert.equal(s.run.hits, 0);
  assert.equal(s.lives, 50);
});

// ---------- Bildbereich ----------

test('Komet weit rechts bleibt bei ruhender Kamera dauerhaft in idle mit vollem timer', () => {
  const s = world();
  const c = addComet(s, 3000, 360, { idle: 1.5 });
  tick(s, 60 * 40);
  assert.equal(c.phase, 'idle');
  assert.equal(c.timer, 1.5);
  assert.equal(c.charge, 0);
  assert.equal(c.progress, 0);
  assert.equal(s.run.hits, 0);
  assert.equal(sfxCount(s, 'comet'), 0);
});

test('Komet: nach dem Eintritt ins Bild kommt der Einschlag frühestens nach idleTime plus 1,1 s', () => {
  for (const idle of [0.8, 1.6]) {
    const s = world();
    const c = addComet(s, 3000, 360, { idle });
    let enter = null;
    let strike = null;
    for (let i = 0; i < 60 * 60 && strike === null; i++) {
      s.camX += 300 * STEP; // Kamera fährt heran
      const before = s.t;
      const visible = c.x <= s.camX + W + 200;
      if (visible && enter === null) enter = before;
      tick(s);
      if (!visible) {
        assert.equal(c.phase, 'idle');
        assert.equal(c.timer, idle);
      }
      if (c.phase === 'strike') strike = s.t;
    }
    assert.ok(enter !== null && strike !== null);
    const wait = strike - enter;
    assert.ok(wait >= idle + MIN_WARN - EPS, `idle ${idle}: Einschlag nach ${wait} s`);
    within(wait, idle + COMET.WARN, `idle ${idle}`, 4 * STEP);
  }
});

test('Komet: grenzt an den Bildbereich (camX minus 100 bis camX plus W plus 200)', () => {
  const s = world({ camX: 500 });
  const inside = addComet(s, 500 + W + 200, 360, { idle: 0.2 });
  const outside = addComet(s, 500 + W + 201, 360, { idle: 0.2 });
  const behindIn = addComet(s, 400, 360, { idle: 0.2 });
  const behindOut = addComet(s, 399, 360, { idle: 0.2 });
  tick(s, 30);
  assert.equal(inside.phase, 'warn');
  assert.equal(behindIn.phase, 'warn');
  assert.equal(outside.phase, 'idle');
  assert.equal(outside.timer, 0.2);
  assert.equal(behindOut.phase, 'idle');
  assert.equal(behindOut.timer, 0.2);
});

test('Komet: eine Vorwarnung, die aus dem Bild gerät, beginnt später von vorn', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 1.0 });
  let n = 0;
  while (c.phase !== 'warn' && n++ < 600) tick(s);
  tick(s, 30);
  assert.equal(c.phase, 'warn');
  assert.ok(c.charge > 0.2);
  s.camX = 5000; // Sprung der Kamera: der Komet liegt weit hinter dem Bild
  tick(s);
  assert.equal(c.phase, 'idle');
  assert.equal(c.timer, 1.0);
  assert.equal(c.charge, 0);
  assert.equal(c.progress, 0);
  tick(s, 60 * 10);
  assert.equal(c.phase, 'idle');
  // Zurück im Bild: wieder die volle Wartezeit und Vorwarnung
  s.camX = 0;
  const t0 = s.t;
  let strike = null;
  for (let i = 0; i < 600 && strike === null; i++) {
    tick(s);
    if (c.phase === 'strike') strike = s.t;
  }
  assert.ok(strike - t0 >= 1.0 + MIN_WARN - EPS, `Einschlag nach ${strike - t0}`);
});

test('Komet: ein laufender Einschlag und die Abkühlung enden auch dann, wenn der Komet aus dem Bild gerät', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 1.0 });
  c.phase = 'strike';
  c.timer = 0.1;
  s.camX = 5000;
  tick(s, 60 * 2);
  assert.equal(c.phase, 'idle');
  assert.equal(c.timer, 1.0);
  assert.equal(c.progress, 0);
});

// ---------- Effekte und Töne ----------

test('Komet: Ton comet zu Beginn der Vorwarnung, Ton strike beim Einschlag, jeweils genau einmal pro Zyklus', () => {
  const s = world();
  const c = addComet(s, 300, 360, { idle: 0.6 });
  let cycles = 0;
  let prev = c.phase;
  for (let i = 0; i < 60 * 24; i++) {
    s.sfx.length = 0; // nimbus-game.js leert die Liste nach jedem Bild
    tick(s);
    const now = { comet: sfxCount(s, 'comet'), strike: sfxCount(s, 'strike') };
    if (c.phase === 'warn' && prev === 'idle') {
      assert.deepEqual(now, { comet: 1, strike: 0 }, 'comet beim Beginn der Vorwarnung');
    } else if (c.phase === 'strike' && prev === 'warn') {
      assert.deepEqual(now, { comet: 0, strike: 1 }, 'strike beim Einschlag');
      cycles++;
    } else {
      assert.deepEqual(now, { comet: 0, strike: 0 }, `Ton ohne Phasenwechsel (${prev} nach ${c.phase})`);
    }
    prev = c.phase;
    for (const e of s.sfx) assert.ok(e.v > 0 && e.v <= 1);
  }
  assert.ok(cycles >= 6, `nur ${cycles} Zyklen`);
});

test('Komet: Einschlag nahe der Kamera erzeugt Funken, Staub und Wackeln genau am Einschlagpunkt', () => {
  const s = world();
  const c = addComet(s, 300, 360);
  c.phase = 'warn';
  c.timer = STEP / 2;
  assert.equal(s.fx.shake, 0);
  assert.equal(s.particles.length, 0);
  tick(s);
  assert.equal(c.phase, 'strike');
  assert.ok(s.fx.shake > 0, 'shake');
  assert.ok(s.particles.length > 0, 'Partikel');
  const cx = s.particles.reduce((a, p) => a + p.x, 0) / s.particles.length;
  assert.ok(Math.abs(cx - 300) < 40, `Partikel um den Einschlagpunkt, Mitte bei ${cx}`);
  assert.ok(s.particles.some((p) => p.shape === 'line'), 'Funken (spark)');
  assert.ok(s.particles.some((p) => p.shape === 'cloud'), 'Staub (poof)');
  // Funken und Staub gibt es nur beim Beginn des Einschlags, danach nur noch die leichte Spur des Anflugs
  const afterImpact = s.particles.length;
  tick(s, Math.round(COMET.STRIKE / STEP) + 2);
  assert.equal(c.phase, 'cooldown');
  const trail = s.particles.length - afterImpact;
  assert.ok(trail >= 0 && trail <= 2 * Math.round(COMET.STRIKE / STEP) + 4, `Spur ${trail} Partikel`);
  const calm = s.particles.length;
  tick(s, 3);
  assert.ok(s.particles.length <= calm, 'nach dem Einschlag entstehen keine neuen Partikel');
});

test('Komet: der Anflug zieht eine Funkenspur entlang seiner Bahn, nur im Bild', () => {
  const s = world();
  const c = addComet(s, 300, 360, { dir: 1 });
  c.phase = 'warn';
  c.timer = STEP / 2;
  tick(s);
  s.particles.length = 0; // Einschlag selbst weglassen
  const xs = [];
  const ys = [];
  for (let i = 0; i < 20; i++) {
    const n = s.particles.length;
    tick(s);
    if (c.phase !== 'strike') break;
    const added = s.particles.slice(n);
    if (added.length) {
      const pos = cometPosition(c);
      for (const p of added) {
        assert.ok(Math.abs(p.x - pos.x) <= 8.5 && Math.abs(p.y - pos.y) <= 10.5, 'Spur entsteht an der Position des Kometen');
      }
      xs.push(pos.x);
      ys.push(pos.y);
    }
  }
  assert.ok(ys.length >= 6, `nur ${ys.length} Spurpartikel`);
  assert.ok(Math.min(...ys) >= -40, 'nichts über dem Bild');
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1] - 1e-6 && xs[i] <= xs[i - 1] + 1e-6, 'Spur wandert nach unten und zum Einschlagpunkt');

  // Weit außerhalb des Bildes: nichts
  const far = world({ camX: 1000 });
  const f = addComet(far, 300, 360);
  f.phase = 'strike';
  f.timer = 0.3;
  tick(far, 5);
  assert.equal(far.particles.length, 0);
});

test('Komet: Einschlag weit außen macht keine Effekte und keinen Ton, nahe der Kamera aber schon', () => {
  // Im Bildbereich, aber links vom sichtbaren Rand (camX minus 80): kein Wackeln, kein Staub
  let s = world({ camX: 1000 });
  let c = addComet(s, 920, 360);
  c.phase = 'warn';
  c.timer = STEP / 2;
  tick(s);
  assert.equal(c.phase, 'strike');
  assert.equal(s.fx.shake, 0);
  assert.equal(s.particles.length, 0);
  assert.equal(sfxCount(s, 'strike'), 0);

  // Knapp außerhalb des Bildes rechts (W plus 60 ist noch nah)
  s = world({ camX: 1000 });
  c = addComet(s, 1000 + W + 60, 360);
  c.phase = 'warn';
  c.timer = STEP / 2;
  tick(s);
  assert.ok(s.fx.shake > 0);
  assert.equal(sfxCount(s, 'strike'), 1);
});

test('Komet: der Warnton im Randbereich ist leiser als im Bild', () => {
  const near = world();
  addComet(near, 300, 360, { idle: 0.05 });
  tick(near, 10);
  const far = world();
  addComet(far, W + 150, 360, { idle: 0.05 });
  tick(far, 10);
  assert.equal(sfxCount(near, 'comet'), 1);
  assert.equal(sfxCount(far, 'comet'), 1);
  assert.ok(far.sfx.find((e) => e.n === 'comet').v < near.sfx.find((e) => e.n === 'comet').v);
});

test('Töne sammeln sich höchstens bis LIMITS.MAX_SFX', () => {
  const s = world();
  for (let i = 0; i < 30; i++) addComet(s, 100 + i * 20, 360, { idle: 0.05 });
  tick(s, 20);
  assert.ok(s.sfx.length <= 16, `${s.sfx.length} Töne`);
});

// ---------- clearHazardsNear ----------

test('clearHazardsNear setzt Kometen im Bereich auf idle mit idleTime plus 2, charge 0 und progress 0', () => {
  const s = world();
  const inside = addComet(s, 400, 360, { idle: 1.5 });
  const outside = addComet(s, 1200, 360, { idle: 1.5 });
  for (const c of [inside, outside]) {
    c.phase = 'warn';
    c.timer = 0.2;
    c.charge = 0.9;
  }
  clearHazardsNear(s, 300, 700);
  assert.equal(inside.phase, 'idle');
  assert.equal(inside.timer, 1.5 + 2);
  assert.equal(inside.charge, 0);
  assert.equal(inside.progress, 0);
  assert.equal(outside.phase, 'warn');
  assert.equal(outside.timer, 0.2);
  assert.equal(outside.charge, 0.9);
  assert.equal(s.hazards.length, 2, 'Kometen bleiben erhalten');

  // Wirkt auch mitten im Einschlag
  inside.phase = 'strike';
  inside.progress = 0.5;
  clearHazardsNear(s, 300, 700);
  assert.equal(inside.phase, 'idle');
  assert.equal(inside.progress, 0);
});

test('clearHazardsNear: Randfälle beim Kometen (Breite COMET.W, vertauschte Grenzen)', () => {
  const s = world();
  const c = addComet(s, 400, 360, { idle: 1 }); // Zone von 360 bis 440
  c.phase = 'warn';
  clearHazardsNear(s, 440, 900);
  assert.equal(c.phase, 'idle', 'streift den Rand');
  c.phase = 'warn';
  clearHazardsNear(s, 440.5, 900);
  assert.equal(c.phase, 'warn', 'knapp daneben');
  clearHazardsNear(s, 100, 359.5);
  assert.equal(c.phase, 'warn');
  clearHazardsNear(s, 500, 300); // vertauscht
  assert.equal(c.phase, 'idle');
});

test('clearHazardsNear: nach dem Zurücksetzen schlägt der Komet frühestens idleTime plus 2 plus Vorwarnung ein', () => {
  const s = world();
  const c = addComet(s, 400, 360, { idle: 1.0 });
  tick(s, 60 * 1.2);
  assert.equal(c.phase, 'warn');
  clearHazardsNear(s, 300, 500);
  const t0 = s.t;
  let strike = null;
  for (let i = 0; i < 60 * 12 && strike === null; i++) {
    tick(s);
    if (c.phase === 'strike') strike = s.t;
  }
  assert.ok(strike - t0 >= 1.0 + 2 + MIN_WARN - EPS, `Einschlag nach ${strike - t0}`);
});

test('clearHazardsNear: ein nach dem Zurücksetzen verlängerter timer bleibt außerhalb des Bildes erhalten', () => {
  const s = world();
  const c = addComet(s, 3000, 360, { idle: 1.0 });
  clearHazardsNear(s, 2900, 3100);
  assert.equal(c.timer, 3.0);
  tick(s, 60 * 5);
  assert.equal(c.phase, 'idle');
  assert.equal(c.timer, 3.0);
});

test('clearHazardsNear: Kometen, Blitze, Stachelwolken und Regen gemischt', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 360, 3000);
  s.platforms.push(plat);
  const spike = createSpike(s, plat, 0.2);
  const lightning = createLightning(s, spike.x + 100, { idle: 1 });
  const comet = addComet(s, spike.x + 300, 360, { idle: 1 });
  const rain = createRain(s, spike.x, 200);
  s.hazards.push(spike, lightning);
  s.zones.push(rain);
  lightning.phase = 'glow';
  comet.phase = 'warn';
  clearHazardsNear(s, spike.x - 10, spike.x + 500);
  assert.deepEqual(s.hazards.map((h) => h.kind), ['comet', 'lightning'], 'Stachelwolke weg, Rest bleibt');
  assert.equal(lightning.phase, 'idle');
  assert.equal(comet.phase, 'idle');
  assert.deepEqual(s.zones.map((z) => z.id), [rain.id]);
});

// ---------- Zusammenspiel ----------

test('Komet: verbraucht weder s.rng noch Partikel Zähler der Simulation und bleibt kopierbar', () => {
  const s = world();
  addComet(s, 300, 360, { idle: 0.5 });
  const rng = s.rng;
  tick(s, 60 * 10);
  assert.equal(s.rng, rng);
  assert.deepEqual(structuredClone(s.hazards), s.hazards);
});

test('Komet: bei gleicher Eingabe laufen zwei Simulationen identisch', () => {
  const make = () => {
    const s = world();
    addComet(s, 300, 360, { idle: 0.7, dir: -1 });
    addComet(s, 520, 330, { idle: 1.1 });
    return s;
  };
  const a = make();
  const b = make();
  tick(a, 60 * 12);
  tick(b, 60 * 12);
  assert.deepEqual(a.hazards, b.hazards);
  assert.deepEqual(a.sfx, b.sfx);
});

test('sim: Komet über dem stehenden Spieler trifft nach der Vorwarnung genau einmal', { skip: needsHurt }, () => {
  const s = newGame(5);
  s.hazards.length = 0;
  for (let i = 0; i < 40; i++) stepSim(s, input());
  const p = s.player;
  assert.equal(p.onGround, true);
  const floor = s.platforms.find((pl) => pl.id === p.groundId);
  const c = createComet(s, p.x + p.w / 2, floor.y, { idle: 0.5 });
  s.hazards.push(c);
  p.invuln = 0;
  let warnT = null;
  let hitT = null;
  const phases = [];
  for (let i = 0; i < 60 * 4 && hitT === null; i++) {
    stepSim(s, input());
    if (c.phase === 'warn' && warnT === null) warnT = s.t;
    if (s.run.hits > 0) hitT = s.t;
    else phases.push(c.phase);
  }
  assert.ok(warnT !== null && hitT !== null);
  assert.ok(hitT - warnT >= MIN_WARN - EPS, `Vorwarnung ${hitT - warnT}`);
  assert.equal(s.lives, 2);
  assert.equal(c.phase, 'strike');
  assert.deepEqual(s.deathCause, { kind: 'comet', label: 'Komet' });
  assert.ok(phases.includes('warn'), 'der Spieler sah die Vorwarnung');
  assert.deepEqual(invariants(s), []);
});

test('sim: nach einem Respawn ist die Umgebung 2 Sekunden lang kometenfrei', { skip: needsHurt }, () => {
  const s = newGame(5);
  for (let i = 0; i < 40; i++) stepSim(s, input());
  const p = s.player;
  const floor = s.platforms.find((pl) => pl.id === p.groundId);
  const c = createComet(s, p.x + p.w / 2 + 150, floor.y, { idle: 0.5 });
  s.hazards.push(c);
  for (let i = 0; i < 70; i++) stepSim(s, input());
  assert.equal(c.phase, 'warn');
  hurtPlayer(s, { kind: 'fall', label: 'Test', x: p.x, y: p.y }); // löst den Respawn aus
  assert.equal(c.phase, 'idle', 'Respawn setzt Kometen im Bereich zurück');
  assert.ok(c.timer >= c.idleTime + 2 - EPS);
});

// ---------- Kaputte Daten und Fuzz ----------

test('Fuzz: kaputte Kometen werfen nichts und verschlechtern nichts', () => {
  const s = world();
  const bad = [
    { ...createComet(s, NaN, 360) },
    { ...createComet(s, 300, NaN) },
    { ...createComet(s, 300, 360), timer: NaN, phase: 'strike' },
    { ...createComet(s, 310, 360), phase: 'kaputt' },
    { ...createComet(s, 320, 360), idleTime: NaN, timer: -5 },
    { ...createComet(s, 330, 360), dir: NaN },
    { ...createComet(s, 340, 360), dir: 0 },
    { ...createComet(s, 350, 360), w: NaN },
  ];
  s.hazards.push(...bad);
  place(s, 320, 360);
  for (let i = 0; i < 600; i++) tick(s, 1, STEP);
  for (const c of bad.slice(2)) {
    assert.ok(PHASES.includes(c.phase), `Phase ${c.phase}`);
    assert.ok(Number.isFinite(c.timer) && Number.isFinite(c.charge) && Number.isFinite(c.progress));
  }
  assert.ok(bad.slice(5).every((c) => Number.isFinite(c.dir) && c.dir !== 0));
  for (const dt of [0, -1, NaN, undefined, -0.5]) {
    const before = JSON.stringify(s.hazards);
    updateObstacles(s, dt);
    assert.equal(JSON.stringify(s.hazards), before, `dt ${dt}`);
  }
  s.camX = NaN;
  updateObstacles(s, STEP);
  playerVsHazards(s);
  clearHazardsNear(s, NaN, 3);
  clearHazardsNear(s, undefined, undefined);
});

// Gibt es zum Treffer einen sichtbaren Grund (ein Komet in strike, dessen Kreis den Spieler berührt)?
function cometCause(s) {
  const p = s.player;
  const px0 = p.x + 4;
  const px1 = p.x + p.w - 4;
  const py0 = p.y + 4;
  const py1 = p.y + p.h - 4;
  for (const h of s.hazards) {
    if (h.kind !== 'comet' || h.phase !== 'strike') continue;
    const dx = Math.min(px1, Math.max(px0, h.x)) - h.x;
    const dy = Math.min(py1, Math.max(py0, h.y)) - h.y;
    if (dx * dx + dy * dy < COMET.RADIUS * COMET.RADIUS) return true;
  }
  return false;
}

test('Fuzz: zufällige Kometen, Kamerasprünge und Schrittweiten erzeugen nie NaN und nie unerklärliche Treffer', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = { rng: seed };
    const s = world({ seed });
    s.lives = 99;
    const n = int(r, 3, 10);
    for (let i = 0; i < n; i++) addComet(s, range(r, 0, 3000), range(r, 250, 400), { idle: range(r, 0, 3), dir: rand(r) < 0.5 ? -1 : 1, pace: range(r, 1, 1.6) });
    const p = s.player;
    for (let i = 0; i < 1500; i++) {
      const roll = rand(r);
      const dt = roll < 0.85 ? STEP : roll < 0.9 ? 0 : roll < 0.95 ? 0.05 : 0.1;
      if (rand(r) < 0.01) s.camX = range(r, -200, 3500);
      else s.camX += 4;
      p.x = s.camX + range(r, 0, W);
      p.y = range(r, 0, H + 20);
      p.invuln = rand(r) < 0.2 ? 0 : p.invuln;
      const hits = s.run.hits;
      tick(s, 1, dt);
      if (s.run.hits !== hits) assert.ok(cometCause(s), `Seed ${seed} Schritt ${i}: Treffer ohne Ursache`);
      if (rand(r) < 0.01) clearHazardsNear(s, p.x - 260, p.x + p.w + 420);
      for (const h of s.hazards) {
        assert.ok(PHASES.includes(h.phase));
        assert.ok(h.charge >= 0 && h.charge <= 1 && h.progress >= 0 && h.progress <= 1 && Number.isFinite(h.timer));
        if (h.phase !== 'strike') assert.equal(h.progress, 0);
      }
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});

test('Fuzz: Spiel mit eigenen Kometen läuft stabil, Kometenschäden gibt es nur im Einschlag', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = newGame(seed);
    const plat = s.platforms[0];
    s.hazards.push(createComet(s, plat.x + 400, plat.y, { idle: 0.6 }), createComet(s, plat.x + 650, plat.y, { idle: 1.1, dir: -1 }));
    s.lives = 99;
    let prevHits = 0;
    for (let i = 0; i < 60 * 12; i++) {
      stepSim(s, input({ move: i % 200 < 140 ? 1 : -1, jumpPressed: i % 37 === 0, jumpHeld: i % 37 < 22 }));
      if (s.run.hits > prevHits && s.deathCause && s.deathCause.kind === 'comet') {
        assert.ok(s.hazards.some((h) => h.kind === 'comet' && h.phase === 'strike'), `Seed ${seed}: Kometenschaden ohne Einschlag`);
      }
      prevHits = s.run.hits;
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});
