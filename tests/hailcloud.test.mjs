import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, ENEMY, HAIL, LIMITS, PHYS, STEP, W } from '../game/constants.js';
import { createHailcloud, createSpike, createStaticPlatform, createWalker } from '../game/entities.js';
import { createState } from '../game/state.js';
import { int, range, seedRng } from '../game/rng.js';
import { emit } from '../game/particles.js';
import { hurtPlayer } from '../game/player.js';
import { damageEnemy, enemyHitbox, playerVsEnemies, updateEnemies } from '../game/enemies.js';
import { input, invariants, newGame, run } from './helpers.mjs';

const HC = ENEMY.HAILCLOUD;
const needsHurt = (() => {
  const s = createState();
  return hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 }) !== 'ignored' ? false : 'player.js ist noch ein Stub (hurtPlayer)';
})();
const needsParticles = (() => {
  const s = createState();
  emit(s, 'poof', 0, 0);
  return s.particles.length > 0 ? false : 'particles.js ist noch ein Stub (emit)';
})();

// ---------- Hilfen ----------

function park(s) {
  const p = s.player;
  p.x = 5000;
  p.y = 0;
  p.vx = 0;
  p.vy = 0;
}

// Eine Hagelwolke mit Mittelpunkt (x, y) im Bild. range 0 hält sie an einem Fleck.
function cloudWorld({ camX = 0, x = 400, y = 170, seed = 3, ...opts } = {}) {
  const s = createState({ seed });
  s.camX = camX;
  park(s);
  const e = createHailcloud(s, x, y, opts);
  s.enemies.push(e);
  return { s, e };
}

// Wie sim.js: erst die Zeit weiter, dann die Gegner
function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateEnemies(s, STEP);
  }
}

const hails = (s) => s.hazards.filter((h) => h.kind === 'hail');
const sfxCount = (s, name) => s.sfx.filter((x) => x.n === name).length;

// Läuft bis zum ersten Hagelkorn und merkt sich die Zeiten
function observeShot(s, e, max = 60 * 40) {
  let tWind = null;
  let tTele = null;
  for (let i = 0; i < max; i++) {
    tick(s);
    if (tWind === null && e.state === 'windup') tWind = s.t;
    if (tTele === null && e.telegraph > 0) tTele = s.t;
    if (hails(s).length) return { tWind, tTele, tHail: s.t };
  }
  assert.fail('kein Schuss innerhalb der Zeit');
  return null;
}

function place(s, { cx, foot, vy = 0, jumpHeld = false, invuln = 0, dashT = 0 }) {
  const p = s.player;
  p.x = cx - p.w / 2;
  p.y = foot - p.h;
  p.vx = 0;
  p.vy = vy;
  p.jumpHeld = jumpHeld;
  p.invuln = invuln;
  p.dash.t = dashT;
  p.dead = false;
  return p;
}

const centerX = (e) => e.x + e.w / 2;
// Mittlerer Winkel eines Hagelkorns zur Senkrechten (negativ: nach links)
const angleOf = (h) => Math.atan2(h.vx, h.vy);

// ---------- Schweben ----------

test('Hagelwolke schwebt wie der Flieger: Sinus in y, Hin und Her zwischen minX und maxX', () => {
  const { s, e } = cloudWorld({ range: 200, dir: 1, phase: 0.7 });
  e.cooldown = 9999;
  assert.equal(e.kind, 'hailcloud');
  assert.equal(e.state, 'fly');
  let lo = Infinity;
  let hi = -Infinity;
  let turns = 0;
  let prevDir = e.dir;
  const x0 = e.x;
  tick(s, 30);
  assert.ok(Math.abs(e.x - (x0 + HC.speed * 0.5)) < 0.6, 'Geschwindigkeit aus ENEMY.HAILCLOUD');
  assert.ok(Math.abs(e.vx - HC.speed) < 1e-9);
  for (let i = 0; i < 60 * 60; i++) {
    tick(s);
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
    const y = e.baseY + e.amp * Math.sin(HC.omega * s.t + e.phase);
    assert.ok(Math.abs(e.y - y) < 1e-9, 'Sinus Bahn wie beim Flieger');
    assert.equal(e.telegraph, 0);
    assert.equal(e.state, 'fly');
    lo = Math.min(lo, e.x);
    hi = Math.max(hi, e.x);
    if (e.dir !== prevDir) turns++;
    prevDir = e.dir;
  }
  assert.equal(lo, e.minX);
  assert.equal(hi, e.maxX);
  assert.ok(turns >= 8, `${turns} Wendungen`);
  assert.equal(hails(s).length, 0, 'ohne abgelaufenen cooldown kein Schuss');
});

test('Hagelwolke hat dieselbe Hitbox wie die anderen Gegner', () => {
  const { e } = cloudWorld();
  assert.deepEqual(enemyHitbox(e), { x: e.x + 3, y: e.y + 3, w: HC.w - 6, h: HC.h - 6 });
  assert.equal(e.w, HC.w);
  assert.equal(e.h, HC.h);
});

// ---------- Cooldown und Vorwarnung ----------

test('Nach dem cooldown beginnt die Vorwarnung, nicht früher', () => {
  const { s, e } = cloudWorld();
  e.cooldown = 1.0;
  const t0 = s.t;
  let started = null;
  for (let i = 0; i < 200 && started === null; i++) {
    tick(s);
    if (e.state === 'windup') started = s.t - t0;
  }
  assert.ok(started >= 1.0 - 1e-9, `begann nach ${started}`);
  assert.ok(started <= 1.0 + 2 * STEP, `begann nach ${started}`);
  assert.equal(hails(s).length, 0, 'noch kein Hagel');
});

test('Vorwarnung: mindestens 0,8 s zwischen Beginn des Telegraphs und dem ersten Hagelkorn, bei jedem Tempo', () => {
  for (const pace of [1, 1.2, 1.6, 3]) {
    const { s, e } = cloudWorld({ pace });
    e.cooldown = 0.3;
    const { tWind, tTele, tHail } = observeShot(s, e);
    assert.ok(tTele !== null && tWind !== null);
    assert.ok(tHail - tTele >= 0.8, `Tempo ${pace}: Telegraph ${tHail - tTele} s vor dem Schuss`);
    assert.ok(tHail - tWind >= 0.8, `Tempo ${pace}: Windup ${tHail - tWind} s`);
    assert.ok(tHail - tWind <= 0.8 + 3 * STEP, `Tempo ${pace}: Windup nicht unnötig lang (${tHail - tWind})`);
    assert.equal(tTele, tWind, 'das Telegraph ist schon im ersten Windup Schritt sichtbar');
  }
});

test('Während der Vorwarnung: Telegraph steigt linear bis 1, die Wolke zittert und steht in x still', () => {
  const { s, e } = cloudWorld({ range: 300, dir: 1 });
  e.cooldown = 0;
  tick(s);
  assert.equal(e.state, 'windup');
  const x0 = e.x;
  const tele = [e.telegraph];
  let shaken = false;
  let steps = 0;
  while (e.state === 'windup') {
    tick(s);
    steps++;
    assert.ok(steps < 200);
    if (e.state !== 'windup') break;
    tele.push(e.telegraph);
    assert.equal(e.x, x0, 'in x ruhig');
    assert.equal(e.vx, 0);
    assert.ok(Math.abs(e.shakeX) <= 2.5 + 1e-9);
    if (Math.abs(e.shakeX) > 0.5) shaken = true;
    const y = e.baseY + e.amp * Math.sin(HC.omega * s.t + e.phase);
    assert.ok(Math.abs(e.y - y) < 1e-9, 'der Sinus läuft weiter');
    assert.equal(hails(s).length, 0, 'vor dem Ende kein Hagel');
  }
  assert.ok(shaken, 'Zittern sichtbar');
  assert.ok(tele[0] > 0, 'schon im ersten Schritt größer als 0');
  for (let i = 1; i < tele.length; i++) {
    const d = tele[i] - tele[i - 1];
    assert.ok(d >= 0, 'fällt nie');
    if (tele[i] < 1) assert.ok(Math.abs(d - STEP / HC.windup) < 1e-9, 'steigt linear');
  }
  assert.equal(tele[tele.length - 1], 1, 'vor dem Schuss voll aufgeladen');
  assert.equal(e.state, 'fly');
  assert.equal(e.telegraph, 0);
  assert.equal(e.shakeX, 0);
  assert.equal(hails(s).length, HC.balls);
});

test('Die Vorwarnung wird vom Tempo nicht verkürzt', () => {
  const times = [];
  for (const pace of [1, 1.6]) {
    const { s, e } = cloudWorld({ pace });
    e.cooldown = 0;
    const r = observeShot(s, e);
    times.push(r.tHail - r.tWind);
  }
  assert.ok(Math.abs(times[0] - times[1]) < 1e-9, `${times}`);
});

test('Tempo: Hagelwolke fliegt schneller, der Sinus bleibt wie im Vertrag', () => {
  for (const pace of [1, 1.5]) {
    const { s, e } = cloudWorld({ range: 600, dir: 1, phase: 0.4, pace });
    e.cooldown = 9999;
    const x0 = e.x;
    tick(s, 60);
    assert.ok(Math.abs(e.x - (x0 + HC.speed * pace)) < 1, `Tempo ${pace}`);
    assert.ok(Math.abs(e.vx - HC.speed * pace) < 1e-9);
    assert.ok(Math.abs(e.y - (e.baseY + e.amp * Math.sin(HC.omega * s.t + e.phase))) < 1e-9);
  }
  for (const pace of [0, NaN, -1, undefined]) {
    const { s, e } = cloudWorld({ range: 600, dir: 1 });
    e.pace = pace;
    e.cooldown = 9999;
    const x0 = e.x;
    tick(s, 60);
    assert.ok(Math.abs(e.x - (x0 + HC.speed)) < 1, `kaputtes Tempo ${String(pace)} zählt als 1`);
  }
});

// ---------- Fächer ----------

test('Schuss: ein Fächer aus balls Hagelkörnern, Winkel gleichmäßig von minus spread bis plus spread', () => {
  const { s, e } = cloudWorld({ x: 380, y: 160 });
  e.cooldown = 0;
  observeShot(s, e);
  const list = hails(s);
  assert.equal(list.length, HC.balls);
  assert.equal(s.hazards.length, HC.balls, 'nur Hagel entstanden');
  const sorted = list.slice().sort((a, b) => angleOf(a) - angleOf(b));
  for (let i = 0; i < sorted.length; i++) {
    const want = HC.balls > 1 ? -HC.spread + (2 * HC.spread * i) / (HC.balls - 1) : 0;
    const h = sorted[i];
    assert.ok(Math.abs(angleOf(h) - want) < 1e-9, `Winkel ${angleOf(h)} statt ${want}`);
    assert.ok(Math.abs(Math.hypot(h.vx, h.vy) - HC.ballSpeed) < 1e-9, 'Geschwindigkeit ballSpeed');
    assert.ok(h.vy > 0, 'nach unten');
    assert.equal(h.kind, 'hail');
    assert.equal(h.life, HAIL.LIFE);
    assert.equal(h.x, e.x + e.w / 2, 'aus der Mitte der Wolke');
    assert.equal(h.y, e.y + e.h, 'unter der Wolke');
  }
  assert.ok(Math.abs(angleOf(sorted[0]) + angleOf(sorted[sorted.length - 1])) < 1e-9, 'symmetrisch um die Senkrechte');
  assert.equal(new Set(list.map((h) => h.id)).size, list.length, 'eigene ids');
  for (const h of list) assert.ok(!s.enemies.some((x) => x.id === h.id) && !s.platforms.some((x) => x.id === h.id));
});

test('Der Fächer zielt nie auf den Spieler: gleicher Verlauf, egal wo er steht', () => {
  const a = cloudWorld({ range: 100 });
  const b = cloudWorld({ range: 100 });
  place(a.s, { cx: a.e.x - 200, foot: 400 });
  place(b.s, { cx: b.e.x + 300, foot: 100 });
  a.e.cooldown = 0.5;
  b.e.cooldown = 0.5;
  for (let i = 0; i < 60 * 20; i++) {
    tick(a.s);
    tick(b.s);
    assert.deepEqual(a.s.hazards, b.s.hazards);
    assert.deepEqual(a.s.enemies, b.s.enemies);
  }
  assert.ok(a.s.hazards.length > 0);
  assert.equal(a.s.rng, b.s.rng);
});

test('Schuss: Ton hail genau einmal, Partikel, danach wieder fly mit cooldown durch Tempo', () => {
  for (const pace of [1, 1.5]) {
    const { s, e } = cloudWorld({ pace });
    e.cooldown = 0;
    s.particles.length = 0;
    observeShot(s, e);
    assert.equal(sfxCount(s, 'hail'), 1, 'ein Ton pro Schuss');
    assert.equal(e.state, 'fly');
    assert.equal(e.telegraph, 0);
    assert.equal(e.shakeX, 0);
    assert.ok(Math.abs(e.cooldown - HC.cooldown / pace) < 1e-9, `cooldown ${e.cooldown} bei Tempo ${pace}`);
    if (!needsParticles) assert.equal(s.particles.filter((q) => q.shape === 'cloud' && q.grow >= 18).length, 8, 'Staubwölkchen (poof) am Schuss');
  }
});

test('Zweiter Schuss kommt nach cooldown durch Tempo plus Vorwarnung, schnellere Wolken schießen öfter', () => {
  const gaps = {};
  for (const pace of [1, 1.6]) {
    const { s, e } = cloudWorld({ pace, range: 0 });
    e.cooldown = 0;
    observeShot(s, e);
    const t1 = s.t;
    s.hazards.length = 0;
    const second = observeShot(s, e);
    gaps[pace] = { toWind: second.tWind - t1, toShot: second.tHail - t1 };
    assert.ok(second.tWind - t1 >= HC.cooldown / pace - 1e-9 && second.tWind - t1 <= HC.cooldown / pace + 2 * STEP, `Pause ${second.tWind - t1}`);
    assert.ok(second.tHail - second.tTele >= 0.8);
  }
  assert.ok(gaps[1.6].toShot < gaps[1].toShot);
});

// ---------- Nur im Bild schießen ----------

test('Außerhalb des Bildes wird nie geschossen, auch nicht nach vielen Zyklen', () => {
  for (const cx of [-41, -150, W + 41, W + 300]) {
    const { s, e } = cloudWorld({ x: cx, range: 0 });
    e.cooldown = 0;
    for (let i = 0; i < 60 * 30; i++) {
      tick(s);
      assert.equal(e.state, 'fly', `Mitte ${cx}`);
      assert.equal(e.telegraph, 0);
    }
    assert.equal(hails(s).length, 0, `Mitte ${cx}`);
    assert.equal(sfxCount(s, 'hail'), 0);
  }
});

test('Der Bildbereich reicht genau 40 px über die Ränder: camX minus 40 bis camX plus W plus 40', () => {
  for (const [cam, cx, shoots] of [
    [0, -40, true], [0, -41, false], [0, W + 40, true], [0, W + 41, false],
    [1000, 960, true], [1000, 959, false], [1000, 1000 + W + 40, true], [1000, 1000 + W + 41, false],
    [0, 400, true],
  ]) {
    const { s, e } = cloudWorld({ camX: cam, x: cx, range: 0 });
    e.cooldown = 0;
    tick(s, 60 * 3);
    assert.equal(hails(s).length > 0, shoots, `camX ${cam} Mitte ${cx}`);
  }
});

test('Übersprungener Schuss setzt den cooldown neu und zeigt keine Vorwarnung', () => {
  for (const pace of [1, 1.6]) {
    const { s, e } = cloudWorld({ x: W + 200, range: 0, pace });
    e.cooldown = 0;
    tick(s);
    assert.equal(e.state, 'fly');
    assert.equal(e.telegraph, 0);
    assert.ok(Math.abs(e.cooldown - HC.cooldown / pace) < 1e-9);
    assert.equal(hails(s).length, 0);
  }
});

test('Kommt die Wolke später ins Bild, schießt sie mit Vorwarnung und nicht sofort', () => {
  const { s, e } = cloudWorld({ x: W + 200, range: 0 });
  e.cooldown = 0;
  tick(s, 60); // außerhalb: der Schuss entfällt, der cooldown beginnt von vorn
  s.camX = 300; // jetzt im Bild
  const tMove = s.t;
  const r = observeShot(s, e);
  assert.ok(r.tWind - tMove >= HC.cooldown - 1.0 - 2 * STEP, `Vorwarnung begann ${r.tWind - tMove} s nach dem Einblenden`);
  assert.ok(r.tHail - r.tTele >= 0.8);
});

test('Verlässt die Wolke das Bild während der Vorwarnung, entfällt der Schuss', () => {
  const { s, e } = cloudWorld({ x: 400, range: 0 });
  e.cooldown = 0;
  tick(s, 10);
  assert.equal(e.state, 'windup');
  assert.ok(e.telegraph > 0);
  s.camX = 400 + 41; // die Mitte der Wolke liegt jetzt knapp links vom Bild, sie ist aber noch aktiv
  tick(s, 90);
  assert.equal(e.state, 'fly');
  assert.equal(hails(s).length, 0, 'kein Hagel');
  assert.equal(sfxCount(s, 'hail'), 0);
  assert.equal(e.telegraph, 0);
  assert.equal(e.shakeX, 0);
  assert.ok(e.cooldown > 1.5 && e.cooldown <= HC.cooldown, `cooldown ${e.cooldown}`);
});

test('Außerhalb des aktiven Bereichs friert die Hagelwolke samt Vorwarnung ein', () => {
  const { s, e } = cloudWorld({ x: 400, range: 0 });
  e.cooldown = 0;
  tick(s, 10);
  const snap = { state: e.state, timer: e.timer, telegraph: e.telegraph };
  s.camX = 3000;
  tick(s, 120);
  assert.deepEqual({ state: e.state, timer: e.timer, telegraph: e.telegraph }, snap);
  assert.equal(hails(s).length, 0);
});

// ---------- Limit der Hindernisse ----------

function fillHazards(s, n) {
  const plat = createStaticPlatform(s, 3000, 300, 100);
  for (let i = 0; i < n; i++) s.hazards.push(createSpike(s, plat, 0.5));
}

test('Passt der Fächer nicht mehr in LIMITS.MAX_HAZARDS, entfällt der Schuss', () => {
  const free = HC.balls - 1;
  const { s, e } = cloudWorld();
  fillHazards(s, LIMITS.MAX_HAZARDS - free);
  const before = s.hazards.length;
  e.cooldown = 0;
  tick(s, 60 * 10);
  assert.equal(s.hazards.length, before, 'nichts dazugekommen');
  assert.equal(sfxCount(s, 'hail'), 0);
  assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS);
  assert.ok(Math.abs(e.cooldown) <= HC.cooldown, 'cooldown wird neu gesetzt und läuft ab');
});

test('Wenn der Fächer genau noch hineinpasst, wird geschossen und das Limit nie überschritten', () => {
  const { s, e } = cloudWorld();
  fillHazards(s, LIMITS.MAX_HAZARDS - HC.balls);
  e.cooldown = 0;
  observeShot(s, e);
  assert.equal(s.hazards.length, LIMITS.MAX_HAZARDS);
  // weitere Zyklen: es bleibt bei höchstens MAX_HAZARDS
  tick(s, 60 * 30);
  assert.equal(s.hazards.length, LIMITS.MAX_HAZARDS);
});

test('Füllt sich die Liste während der Vorwarnung, entfällt der Schuss', () => {
  const { s, e } = cloudWorld();
  e.cooldown = 0;
  tick(s, 10);
  assert.equal(e.state, 'windup');
  fillHazards(s, LIMITS.MAX_HAZARDS);
  tick(s, 90);
  assert.equal(e.state, 'fly');
  assert.equal(hails(s).length, 0);
  assert.equal(s.hazards.length, LIMITS.MAX_HAZARDS);
  assert.equal(sfxCount(s, 'hail'), 0);
  assert.ok(e.cooldown > 1.5 && e.cooldown <= HC.cooldown, `cooldown ${e.cooldown}`);
});

test('Viele Hagelwolken zusammen halten LIMITS.MAX_HAZARDS ein, auch wenn nichts den Hagel entfernt', () => {
  const s = createState({ seed: 7 });
  park(s);
  for (let i = 0; i < 9; i++) {
    const e = createHailcloud(s, 80 + i * 80, 120 + (i % 3) * 30, { range: 60, phase: i * 0.37, dir: i % 2 ? 1 : -1 });
    e.cooldown = 0.2 + i * 0.1;
    s.enemies.push(e);
  }
  let max = 0;
  for (let i = 0; i < 60 * 60; i++) {
    tick(s);
    max = Math.max(max, s.hazards.length);
    assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS);
  }
  assert.ok(max >= LIMITS.MAX_HAZARDS - HC.balls + 1, `Liste war nur bis ${max} gefüllt`);
});

// ---------- Besiegen ----------

function cloudScene() {
  const { s, e } = cloudWorld({ range: 0 });
  e.y = e.baseY;
  return { s, e };
}

test('Stomp von oben besiegt die Hagelwolke, Absprung und Punkte wie bei anderen Gegnern', () => {
  const { s, e } = cloudScene();
  place(s, { cx: centerX(e), foot: e.y + 9 + 400 * STEP, vy: 400 });
  playerVsEnemies(s);
  assert.equal(e.state, 'dead');
  assert.equal(e.dead, 0.001);
  assert.equal(s.run.bonus, 25);
  assert.equal(s.run.kills, 1);
  assert.equal(s.player.vy, -PHYS.STOMP_BOUNCE);
  assert.equal(s.lives, 3);
});

test('Stomp mitten in der Vorwarnung bricht den Schuss ab', () => {
  const { s, e } = cloudScene();
  e.cooldown = 0;
  tick(s, 20);
  assert.equal(e.state, 'windup');
  assert.ok(e.telegraph > 0);
  place(s, { cx: centerX(e), foot: e.y + 8, vy: 300 });
  playerVsEnemies(s);
  assert.equal(e.state, 'dead');
  assert.equal(e.telegraph, 0);
  assert.equal(e.shakeX, 0);
  park(s);
  tick(s, 200);
  assert.equal(hails(s).length, 0, 'tote Wolken schießen nicht');
  assert.equal(s.enemies.length, 0, 'sie verschwindet nach dem Schrumpfen');
});

test('Seitlicher Treffer schadet mit dem Namen Hagelwolke', { skip: needsHurt }, () => {
  const { s, e } = cloudScene();
  place(s, { cx: e.x - 5, foot: e.y + e.h });
  playerVsEnemies(s);
  assert.equal(s.lives, 2);
  assert.deepEqual(s.deathCause, { kind: 'enemy', label: 'Hagelwolke' });
  assert.equal(e.dead, 0);
  assert.ok(s.player.vx < 0, 'Knockback weg vom Gegner');
});

test('Dash, Stampfen und Wurf besiegen die Hagelwolke', () => {
  const dash = cloudScene();
  place(dash.s, { cx: dash.e.x - 10, foot: dash.e.y + dash.e.h, dashT: 0.1 });
  playerVsEnemies(dash.s);
  assert.equal(dash.e.state, 'dead');
  assert.equal(dash.s.lives, 3);

  const slam = cloudScene();
  const p = place(slam.s, { cx: centerX(slam.e), foot: slam.e.y + 20, vy: ABILITY.SLAM.SPEED });
  p.slam.active = true;
  playerVsEnemies(slam.s);
  assert.equal(slam.e.state, 'dead');
  assert.equal(slam.s.lives, 3);

  const shot = cloudScene();
  assert.equal(damageEnemy(shot.s, shot.e, 'shot'), true);
  assert.equal(shot.e.state, 'dead');
  assert.equal(damageEnemy(shot.s, shot.e, 'shot'), false);
});

test('Ein unverwundbarer Spieler wird von der Hagelwolke selbst nicht getroffen', () => {
  const { s, e } = cloudScene();
  place(s, { cx: e.x - 5, foot: e.y + e.h, invuln: 1 });
  playerVsEnemies(s);
  assert.equal(s.lives, 3);
  assert.equal(e.dead, 0);
});

// ---------- Bereich, Zustand ----------

test('Eine Hagelwolke weit außerhalb des aktiven Bereichs ruht und zählt nicht herunter', () => {
  const { s, e } = cloudWorld({ x: W + 900 });
  const snap = { x: e.x, cooldown: e.cooldown, anim: e.anim };
  tick(s, 120);
  assert.deepEqual({ x: e.x, cooldown: e.cooldown, anim: e.anim }, snap);
  s.camX = 1500;
  const behind = createHailcloud(s, 100, 150);
  s.enemies.push(behind);
  const bs = { x: behind.x, cooldown: behind.cooldown };
  tick(s, 60);
  assert.deepEqual({ x: behind.x, cooldown: behind.cooldown }, bs);
});

test('Hagelwolke verbraucht nie s.rng und der Zustand bleibt kopierbar', () => {
  const { s, e } = cloudWorld({ range: 160, pace: 1.3 });
  e.cooldown = 0.5;
  const rng = s.rng;
  tick(s, 60 * 6);
  assert.equal(s.rng, rng);
  tick(s, 20);
  const copy = structuredClone(s);
  tick(s, 60 * 20);
  tick(copy, 60 * 20);
  assert.deepEqual(copy.enemies, s.enemies);
  assert.deepEqual(copy.hazards, s.hazards);
  assert.equal(copy.nextId, s.nextId);
  for (const v of Object.values(s.enemies[0])) assert.ok(typeof v !== 'function');
});

test('Kaputte Werte bringen die Hagelwolke nicht zum Absturz', () => {
  const { s, e } = cloudWorld({ range: 100 });
  e.dir = 0;
  e.state = 'patrol';
  e.cooldown = NaN;
  e.pace = NaN;
  tick(s, 300);
  assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.cooldown));
  assert.ok(e.dir === 1 || e.dir === -1);
  e.state = 'windup';
  e.timer = 0;
  tick(s, 120);
  assert.ok(['fly', 'windup'].includes(e.state));
  updateEnemies(s, 0);
  updateEnemies(s, NaN);
  s.hazards = undefined;
  e.cooldown = 0;
  e.state = 'fly';
  tick(s, 200); // ohne hazards Liste wird nicht geschossen und nicht abgestürzt
  assert.ok(Number.isFinite(e.x));
});

// ---------- Fuzz ----------

test('Fuzz: Hagelwolken mit Kamera, Plattformen, Stomps und Dash bleiben endlich, im Limit und ehrlich', () => {
  let totalShots = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const r = {};
    seedRng(r, seed);
    const s = createState({ seed });
    park(s);
    const plat = createStaticPlatform(s, 0, 380, 3000);
    s.platforms.push(plat);
    const n = int(r, 1, 6);
    for (let i = 0; i < n; i++) {
      const e = createHailcloud(s, range(r, -200, 1100), range(r, 100, 330), { range: range(r, 0, 250), dir: int(r, 0, 1) ? 1 : -1, phase: range(r, 0, 6), pace: range(r, 0.9, 1.6) });
      e.cooldown = range(r, 0, 3);
      s.enemies.push(e);
    }
    if (int(r, 0, 2) === 0) s.enemies.push(createWalker(s, plat, 0.5));
    const windupStart = new Map();
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 90 === 0) s.camX = range(r, 0, 1500);
      if (i % 53 === 0) {
        const t = s.enemies[int(r, 0, s.enemies.length - 1)];
        if (t) place(s, { cx: centerX(t) + range(r, -30, 30), foot: t.y + range(r, 0, t.h), vy: [0, 400, -200][int(r, 0, 2)], invuln: 99, dashT: int(r, 0, 5) === 0 ? 0.1 : 0 });
      }
      const before = hails(s).length;
      tick(s);
      playerVsEnemies(s);
      if (hails(s).length > before) totalShots++;
      // abgeräumt wird der Hagel hier nur gelegentlich (sonst füllt sich die Liste)
      if (i % 200 === 199) s.hazards.length = 0;
      assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS, `Seed ${seed}: ${s.hazards.length} Hindernisse`);
      for (const e of s.enemies) {
        if (e.kind !== 'hailcloud') continue;
        for (const k of ['x', 'y', 'vx', 'vy', 'timer', 'telegraph', 'cooldown', 'dead']) assert.ok(Number.isFinite(e[k]), `Seed ${seed}: ${k}`);
        assert.ok(e.telegraph >= 0 && e.telegraph <= 1);
        assert.ok(['fly', 'windup', 'dead'].includes(e.state));
        assert.ok(e.x >= e.minX - 1e-9 && e.x <= e.maxX + 1e-9);
        if (e.state === 'windup') {
          if (!windupStart.has(e.id)) windupStart.set(e.id, s.t);
        } else if (windupStart.has(e.id)) {
          // Jede beendete Vorwarnung dauerte mindestens 0,8 s (tot ist die Wolke erst im Nachhinein)
          if (e.state === 'fly') assert.ok(s.t - windupStart.get(e.id) >= 0.8, `Seed ${seed}: Vorwarnung ${s.t - windupStart.get(e.id)} s`);
          windupStart.delete(e.id);
        }
      }
      for (const h of hails(s)) assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && h.vy > 0);
    }
    assert.ok(structuredClone(s));
  }
  assert.ok(totalShots > 20, `nur ${totalShots} Schüsse in allen Läufen`);
});

test('Im laufenden Spiel: Hagelwolken über dem Spieler schießen, Hagel fällt weg und alles bleibt gültig', () => {
  const s = newGame(21);
  const plat = s.platforms.find((p) => p.w >= 300);
  s.camX = Math.max(0, plat.x - 100);
  const cx = s.camX + 300;
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const e = createHailcloud(s, cx + i * 90, 130 + i * 20, { range: 80, phase: i, pace: 1 + i * 0.2 });
    e.cooldown = 0.3 + i * 0.4;
    s.enemies.push(e);
    clouds.push(e);
  }
  s.player.invuln = 999;
  const seen = new Set();
  run(s, 60 * 25, (st, i) => {
    for (const h of st.hazards) if (h.kind === 'hail') seen.add(h.id);
    return input({ move: i % 200 < 100 ? 1 : -1, jumpPressed: i % 70 === 0, jumpHeld: i % 70 < 25 });
  });
  assert.deepEqual(invariants(s), []);
  assert.ok(seen.size >= HC.balls, `nur ${seen.size} Hagelkörner gesehen`);
  assert.ok(hails(s).length < seen.size, 'Hagel verschwindet wieder');
  assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS);
});
