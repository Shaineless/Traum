import test from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY, PHYS, STEP } from '../game/constants.js';
import { createCharger, createFlyer, createJumper, createStaticPlatform, createWalker } from '../game/entities.js';
import { createState } from '../game/state.js';
import { int, range, seedRng } from '../game/rng.js';
import { emit } from '../game/particles.js';
import { hurtPlayer, updatePlayer } from '../game/player.js';
import { DEAD_TIME, clearEnemiesNear, enemyHitbox, playerHitbox, playerVsEnemies, updateEnemies } from '../game/enemies.js';
import { input, newGame, run } from './helpers.mjs';

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

function park(s) {
  const p = s.player;
  p.x = 5000;
  p.y = 0;
  p.vx = 0;
  p.vy = 0;
}

function world({ x = 100, y = 300, w = 500, seed = 5 } = {}) {
  const s = createState({ seed });
  const plat = createStaticPlatform(s, x, y, w);
  s.platforms.push(plat);
  s.camX = 0;
  park(s);
  return { s, plat };
}

function add(s, e) {
  s.enemies.push(e);
  return e;
}

// Wie sim.js: erst die Zeit weiter, dann die Gegner
function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateEnemies(s, STEP);
  }
}

function tickUntil(s, pred, max = 3000) {
  let n = 0;
  while (!pred() && n < max) {
    tick(s);
    n++;
  }
  assert.ok(n < max, 'Bedingung wurde nicht erreicht');
  return n;
}

// Feste Position, damit der Gegner im Test nicht wegwandert
function pin(e) {
  e.minX = e.x;
  e.maxX = e.x;
  return e;
}

// Spieler mit Mitte cx, Füßen bei foot
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

// Ein Ausschnitt von sim.js mit echter Spielerphysik: Gegner, Spieler, dann Kollision
function simStep(s, inp = input()) {
  s.t += STEP;
  updateEnemies(s, STEP);
  updatePlayer(s, inp, STEP);
  playerVsEnemies(s);
}

function walkerScene() {
  const { s, plat } = world();
  const e = pin(add(s, createWalker(s, plat, 0.5)));
  return { s, e, plat };
}

// ---------- Walker ----------

test('Walker läuft mit seiner Geschwindigkeit und bleibt zwischen minX und maxX', () => {
  const { s, plat } = world();
  const e = add(s, createWalker(s, plat, 0.5, { dir: 1 }));
  const x0 = e.x;
  tick(s, 60);
  assert.ok(Math.abs(e.x - (x0 + ENEMY.WALKER.speed)) < 1);
  assert.ok(e.anim > 0.99);
  for (let i = 0; i < 60 * 120; i++) {
    tick(s);
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
    assert.equal(e.y, e.baseY);
  }
});

test('Walker bleibt an der Kante turnTime Sekunden stehen, Telegraph steigt linear, dann dreht er um', () => {
  const { s, plat } = world();
  const e = add(s, createWalker(s, plat, 0.5, { dir: 1 }));
  tickUntil(s, () => e.state === 'turn');
  assert.equal(e.x, e.maxX);
  assert.equal(e.telegraph, 0);
  assert.equal(e.dir, 1);
  const tele = [];
  let steps = 0;
  for (;;) {
    tick(s);
    steps++;
    if (e.state !== 'turn') break;
    assert.equal(e.x, e.maxX);
    assert.equal(e.vx, 0);
    tele.push(e.telegraph);
  }
  assert.ok(Math.abs(steps * STEP - ENEMY.WALKER.turnTime) <= STEP * 1.5, `Standzeit ${steps * STEP}`);
  assert.ok(tele.length >= 15);
  for (let i = 1; i < tele.length; i++) {
    assert.ok(Math.abs(tele[i] - tele[i - 1] - STEP / ENEMY.WALKER.turnTime) < 1e-9, 'Telegraph steigt linear');
  }
  assert.ok(tele[tele.length - 1] > 0.85 && tele[tele.length - 1] < 1);
  assert.equal(e.dir, -1);
  assert.equal(e.state, 'patrol');
  assert.equal(e.telegraph, 0);
  tick(s, 10);
  assert.ok(e.x < e.maxX);
});

test('Walker dreht an beiden Enden um und hat dabei jedes Mal die Vorwarnung', () => {
  const { s, plat } = world({ w: 200 });
  const e = add(s, createWalker(s, plat, 0.5, { dir: -1 }));
  const turnsAt = [];
  let prev = e.state;
  for (let i = 0; i < 60 * 60; i++) {
    tick(s);
    if (e.state === 'turn' && prev !== 'turn') turnsAt.push(e.x);
    prev = e.state;
  }
  assert.ok(turnsAt.length >= 8);
  for (const x of turnsAt) assert.ok(x === e.minX || x === e.maxX, 'dreht nur an der Kante');
  assert.ok(turnsAt.some((x) => x === e.minX) && turnsAt.some((x) => x === e.maxX));
});

// ---------- Jumper ----------

test('Jumper: Wartezeit, Zusammenziehen mit linearer Vorwarnung, Sprung in Blickrichtung, Landung auf der Plattform', () => {
  const { s, plat } = world({ w: 400 });
  const e = add(s, createJumper(s, plat, 0.5, { dir: 1 }));
  e.cooldown = 1.0;
  let t0 = s.t;
  tickUntil(s, () => e.state === 'crouch');
  assert.ok(s.t - t0 >= 1.0 - 1e-9 && s.t - t0 <= 1.0 + 2 * STEP, 'wartet die Wartezeit ab');
  const crouchX = e.x;
  assert.equal(e.dir, 1);
  const tele = [];
  t0 = s.t;
  while (e.state === 'crouch') {
    tick(s);
    if (e.state === 'crouch') {
      tele.push(e.telegraph);
      assert.equal(e.x, crouchX, 'beim Zusammenziehen steht er still');
      assert.equal(e.y, e.baseY);
    }
  }
  const crouchTime = s.t - t0;
  assert.ok(crouchTime >= 0.45, `Vorwarnung ${crouchTime}`);
  assert.ok(Math.abs(crouchTime - ENEMY.JUMPER.crouchTime) <= 2 * STEP);
  for (let i = 1; i < tele.length; i++) {
    assert.ok(Math.abs(tele[i] - tele[i - 1] - STEP / ENEMY.JUMPER.crouchTime) < 1e-9, 'Telegraph steigt linear');
  }
  assert.equal(e.state, 'air');
  assert.equal(e.vx, ENEMY.JUMPER.hopVx);
  assert.equal(e.vy, -ENEMY.JUMPER.hopVy);
  assert.equal(e.telegraph, 0);

  let top = e.y;
  const airStart = s.t;
  tickUntil(s, () => {
    top = Math.min(top, e.y);
    return e.state !== 'air';
  });
  const airTime = s.t - airStart;
  assert.equal(e.y, e.baseY, 'landet exakt auf der Plattform');
  assert.equal(e.state, 'patrol');
  assert.ok(Math.abs(airTime - (2 * ENEMY.JUMPER.hopVy) / PHYS.GRAVITY) < 0.04);
  assert.ok(Math.abs(e.baseY - top - ENEMY.JUMPER.hopVy ** 2 / (2 * PHYS.GRAVITY)) < 6);
  const moved = e.x - crouchX;
  assert.ok(moved > 15 && moved < 40, `sprang ${moved} px nach vorn`);
  assert.ok(e.cooldown >= ENEMY.JUMPER.minWait && e.cooldown <= ENEMY.JUMPER.maxWait, 'neue Wartezeit aus dem Bereich');

  // die neue Wartezeit wird eingehalten
  const wait = e.cooldown;
  t0 = s.t;
  tickUntil(s, () => e.state === 'crouch');
  assert.ok(s.t - t0 >= wait - 1e-9);
});

test('Jumper springt nie gezielt auf den Spieler: sein Verlauf hängt nicht von der Spielerposition ab', () => {
  const { s, plat } = world({ w: 500 });
  const e = add(s, createJumper(s, plat, 0.5, { dir: 1 }));
  e.cooldown = 0.3;
  const other = structuredClone(s);
  place(s, { cx: e.x - 150, foot: 300 });
  place(other, { cx: e.x + 150, foot: 300 });
  for (let i = 0; i < 60 * 40; i++) {
    tick(s);
    tick(other);
    assert.deepEqual(s.enemies[0], other.enemies[0]);
  }
  assert.equal(s.rng, other.rng);
});

test('Jumper dreht vor dem Sprung um, wenn er an der Kante sonst hinunterspränge', () => {
  const { s, plat } = world({ w: 400 });
  const right = add(s, createJumper(s, plat, 1, { dir: 1 }));
  right.cooldown = 0;
  right.x = right.maxX - 10;
  tickUntil(s, () => right.state === 'crouch');
  assert.equal(right.dir, -1, 'Blickrichtung ist schon beim Zusammenziehen umgedreht');
  const startX = right.x;
  tickUntil(s, () => right.state === 'air');
  tickUntil(s, () => right.state === 'patrol');
  assert.ok(right.x < startX, 'sprang von der Kante weg');
  assert.ok(right.x >= right.minX && right.x <= right.maxX);

  const left = add(s, createJumper(s, plat, 0, { dir: -1 }));
  left.cooldown = 0;
  left.x = left.minX + 10;
  tickUntil(s, () => left.state === 'crouch');
  assert.equal(left.dir, 1);
  tickUntil(s, () => left.state === 'air');
  tickUntil(s, () => left.state === 'patrol');
  assert.ok(left.x > left.minX + 10);
});

test('Jumper auf sehr schmaler Plattform springt auf der Stelle und bleibt darauf', () => {
  const { s, plat } = world({ w: 70 });
  const e = add(s, createJumper(s, plat, 0.5));
  e.cooldown = 0;
  for (let i = 0; i < 60 * 30; i++) {
    tick(s);
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
    assert.ok(e.y <= e.baseY);
  }
});

test('Jumper und Charger patrouillieren langsam hin und her und drehen am Rand um', () => {
  const { s, plat } = world({ w: 220 });
  const j = add(s, createJumper(s, plat, 0.5));
  const c = add(s, createCharger(s, plat, 0.5));
  j.cooldown = 999;
  c.cooldown = 999;
  const seen = { j: [Infinity, -Infinity], c: [Infinity, -Infinity] };
  for (let i = 0; i < 60 * 40; i++) {
    const jx = j.x;
    const cx = c.x;
    tick(s);
    assert.ok(Math.abs(j.x - jx) <= ENEMY.JUMPER.speed * STEP + 1e-9);
    assert.ok(Math.abs(c.x - cx) <= ENEMY.CHARGER.speed * STEP + 1e-9);
    seen.j = [Math.min(seen.j[0], j.x), Math.max(seen.j[1], j.x)];
    seen.c = [Math.min(seen.c[0], c.x), Math.max(seen.c[1], c.x)];
  }
  assert.deepEqual(seen.j, [j.minX, j.maxX]);
  assert.deepEqual(seen.c, [c.minX, c.maxX]);
  assert.equal(j.state, 'patrol');
  assert.equal(c.state, 'patrol');
});

// ---------- Flyer ----------

test('Flyer schwebt sinusförmig und wendet an den Enden seiner Bahn', () => {
  const { s } = world();
  const e = add(s, createFlyer(s, 400, 160, { range: 160, dir: 1, phase: 0.7 }));
  let lo = Infinity;
  let hi = -Infinity;
  let turns = 0;
  let prevDir = e.dir;
  for (let i = 0; i < 60 * 60; i++) {
    tick(s);
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
    const y = e.baseY + e.amp * Math.sin(ENEMY.FLYER.omega * s.t + e.phase);
    assert.ok(Math.abs(e.y - y) < 1e-9, 'Sinus Bahn wie im Vertrag');
    assert.equal(e.telegraph, 0);
    assert.equal(e.state, 'fly');
    lo = Math.min(lo, e.x);
    hi = Math.max(hi, e.x);
    if (e.dir !== prevDir) turns++;
    prevDir = e.dir;
  }
  assert.equal(lo, e.minX);
  assert.equal(hi, e.maxX);
  assert.ok(turns >= 15, `${turns} Wendungen`);
});

test('Flyer: Geschwindigkeit stimmt mit der Bahn überein', () => {
  const { s } = world();
  const e = add(s, createFlyer(s, 400, 160, { range: 300, dir: 1 }));
  const x0 = e.x;
  tick(s, 60);
  assert.ok(Math.abs(e.x - (x0 + ENEMY.FLYER.speed)) < 1);
  assert.equal(e.vx, ENEMY.FLYER.speed);
});

// ---------- Charger ----------

function chargerScene({ t = 0.3, w = 500 } = {}) {
  const { s, plat } = world({ w });
  const e = add(s, createCharger(s, plat, t, { dir: 1 }));
  return { s, e, plat };
}

test('Charger erkennt den Spieler nur im begrenzten Bereich', () => {
  const { s, e } = chargerScene({ t: 0.5 });
  pin(e);
  e.cooldown = 0;
  const c = centerX(e);
  const foot = e.y + e.h;

  place(s, { cx: c + ENEMY.CHARGER.detectX + 40, foot });
  tick(s, 240);
  assert.equal(e.state, 'patrol', 'zu weit weg in x');

  place(s, { cx: c + 100, foot: foot - ENEMY.CHARGER.detectY - 30 });
  tick(s, 240);
  assert.equal(e.state, 'patrol', 'Höhenunterschied zu groß');

  place(s, { cx: c + 100, foot });
  s.player.dead = true;
  tick(s, 240);
  assert.equal(e.state, 'patrol', 'toter Spieler wird nicht erkannt');

  place(s, { cx: c - ENEMY.CHARGER.detectX + 10, foot: foot - ENEMY.CHARGER.detectY + 10 });
  tick(s);
  assert.equal(e.state, 'windup', 'am Rand des Bereichs wird erkannt');
});

test('Charger: Windup dauert mindestens 0,7 s, Telegraph steigt linear, er zittert und die Richtung bleibt fest', () => {
  const { s, e } = chargerScene();
  e.dir = -1;
  place(s, { cx: centerX(e) + 150, foot: e.y + e.h });
  tickUntil(s, () => e.state === 'windup');
  assert.equal(e.dir, 1, 'Richtung zum Spieler');
  assert.equal(e.telegraph, 0);
  const x0 = e.x;
  const tele = [];
  let shaken = false;
  const t0 = s.t;
  let n = 0;
  while (e.state === 'windup') {
    // der Spieler wechselt mitten im Windup die Seite, der Charger bleibt bei seiner Richtung
    if (n === 12) place(s, { cx: centerX(e) - 200, foot: e.y + e.h });
    tick(s);
    n++;
    if (e.state !== 'windup') break;
    tele.push(e.telegraph);
    assert.equal(e.dir, 1);
    assert.equal(e.x, x0, 'während des Aufladens steht er');
    assert.ok(Math.abs(e.shakeX) <= 2.5 + 1e-9);
    if (Math.abs(e.shakeX) > 0.5) shaken = true;
  }
  const windupTime = s.t - t0;
  assert.ok(windupTime >= 0.7, `Windup ${windupTime}`);
  assert.ok(Math.abs(windupTime - ENEMY.CHARGER.windup) <= 2 * STEP);
  assert.ok(shaken, 'Zittern vorhanden');
  for (let i = 1; i < tele.length; i++) {
    assert.ok(Math.abs(tele[i] - tele[i - 1] - STEP / ENEMY.CHARGER.windup) < 1e-9, 'Telegraph steigt linear');
  }
  assert.ok(tele[tele.length - 1] > 0.9);
  assert.equal(e.state, 'dash');
  assert.equal(e.shakeX, 0);
  assert.equal(e.telegraph, 0);
});

test('Charger: Dash ist vorhersehbar, hat feste Richtung und Länge, danach Cooldown', () => {
  const { s, e } = chargerScene();
  place(s, { cx: centerX(e) + 100, foot: e.y + e.h });
  tickUntil(s, () => e.state === 'dash');
  const x0 = e.x;
  const t0 = s.t;
  while (e.state === 'dash') {
    place(s, { cx: centerX(e) - 100, foot: e.y + e.h }); // Spieler läuft herum, der Dash bleibt gleich
    tick(s);
    assert.equal(e.dir, 1);
    if (e.state === 'dash') assert.equal(e.vx, ENEMY.CHARGER.dashSpeed);
  }
  assert.ok(Math.abs(s.t - t0 - ENEMY.CHARGER.dashTime) <= 2 * STEP);
  assert.ok(Math.abs(e.x - x0 - ENEMY.CHARGER.dashSpeed * ENEMY.CHARGER.dashTime) < 10);
  assert.equal(e.state, 'cooldown');
  const stopX = e.x;
  const c0 = s.t;
  while (e.state === 'cooldown') {
    tick(s);
    assert.equal(e.x, stopX);
  }
  assert.ok(Math.abs(s.t - c0 - ENEMY.CHARGER.cooldown) <= 2 * STEP);
  assert.equal(e.state, 'patrol');
});

test('Charger stoppt am Plattformrand und fällt nie herunter', () => {
  const { s, e } = chargerScene({ t: 0.5, w: 400 });
  e.x = e.maxX - 70;
  place(s, { cx: centerX(e) + 120, foot: e.y + e.h });
  tickUntil(s, () => e.state === 'dash');
  let guard = 0;
  while (e.state === 'dash' && guard++ < 200) {
    tick(s);
    assert.ok(e.x <= e.maxX);
  }
  assert.equal(e.x, e.maxX, 'steht genau am Rand');
  assert.equal(e.state, 'cooldown');
  assert.equal(e.y, e.baseY);
  // nach dem Cooldown geht er zurück und nicht über den Rand
  tick(s, 60 * 3);
  assert.ok(e.x <= e.maxX && e.x >= e.minX);
});

test('Charger am linken Rand mit Spieler dahinter bleibt auf der Plattform', () => {
  const { s, e } = chargerScene({ t: 0, w: 300 });
  e.cooldown = 0;
  place(s, { cx: e.x - 150, foot: e.y + e.h });
  for (let i = 0; i < 60 * 10; i++) {
    tick(s);
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
  }
});

// ---------- Stomp, Dash, Schaden ----------

test('Stomp bei hoher Fallgeschwindigkeit wird erkannt', () => {
  for (const vy of [PHYS.MAX_FALL, 700, 500, 300]) {
    const { s, e } = walkerScene();
    // Im Vorschritt waren die Füße 9 px unter der Oberkante (innerhalb der Toleranz), jetzt vy / 60 tiefer
    place(s, { cx: centerX(e), foot: e.y + 9 + vy * STEP, vy });
    playerVsEnemies(s);
    assert.ok(e.dead > 0, `Stomp bei vy ${vy}`);
    assert.equal(e.state, 'dead');
    assert.equal(s.run.kills, 1);
    assert.equal(s.player.vy, -PHYS.STOMP_BOUNCE);
  }
});

test('Stomp zählt über die Fußposition im Vorschritt, nicht über die aktuelle', () => {
  const { s, e } = walkerScene();
  // jetzt 14 px unter der Oberkante, aber mit 900 px/s aus 1 px darüber gekommen
  place(s, { cx: centerX(e), foot: e.y + 14, vy: PHYS.MAX_FALL });
  playerVsEnemies(s);
  assert.ok(e.dead > 0);
});

test('Stomp Toleranz endet bei 10 px unter der Oberkante im Vorschritt', () => {
  const vy = 300; // 5 px pro Schritt
  const ok = walkerScene();
  place(ok.s, { cx: centerX(ok.e), foot: ok.e.y + 14, vy }); // Vorschritt: 9 px unter der Oberkante
  playerVsEnemies(ok.s);
  assert.ok(ok.e.dead > 0);

  const no = walkerScene();
  place(no.s, { cx: centerX(no.e), foot: no.e.y + 16, vy }); // Vorschritt: 11 px unter der Oberkante
  playerVsEnemies(no.s);
  assert.equal(no.e.dead, 0);
  assert.equal(no.s.run.kills, 0);
});

test('Stomp mit gehaltener Sprungtaste springt höher', () => {
  const a = walkerScene();
  place(a.s, { cx: centerX(a.e), foot: a.e.y + 10, vy: 400 });
  playerVsEnemies(a.s);
  assert.equal(a.s.player.vy, -PHYS.STOMP_BOUNCE);

  const b = walkerScene();
  place(b.s, { cx: centerX(b.e), foot: b.e.y + 10, vy: 400, jumpHeld: true });
  playerVsEnemies(b.s);
  assert.equal(b.s.player.vy, -PHYS.STOMP_BOUNCE_HELD);
});

test('Stomp knapp an der Kante des Gegners zählt als Stomp', () => {
  const { s, e } = walkerScene();
  const hb = enemyHitbox(e);
  const pw = playerHitbox(s.player).w;
  // Spielerhitbox überlappt die Gegnerhitbox nur um 2 px, von links
  const hitX = hb.x - pw + 2;
  place(s, { cx: 0, foot: e.y + 8, vy: 600 });
  s.player.x = hitX - 4;
  playerVsEnemies(s);
  assert.ok(e.dead > 0, 'von links knapp');

  const r = walkerScene();
  const hr = enemyHitbox(r.e);
  place(r.s, { cx: 0, foot: r.e.y + 8, vy: 600 });
  r.s.player.x = hr.x + hr.w - 2 - 4;
  playerVsEnemies(r.s);
  assert.ok(r.e.dead > 0, 'von rechts knapp');
});

test('Knapp daneben (keine Überlappung der Hitboxen) passiert nichts', () => {
  const { s, e } = walkerScene();
  const hb = enemyHitbox(e);
  const pw = playerHitbox(s.player).w;
  place(s, { cx: 0, foot: e.y + 8, vy: 600 });
  s.player.x = hb.x - pw - 4; // Hitboxen berühren sich nur
  playerVsEnemies(s);
  assert.equal(e.dead, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.run.kills, 0);
});

test('Combo Stomps geben 25, 50, 75, 100, 100 Punkte', () => {
  const { s, plat } = world({ w: 800 });
  const walkers = [];
  for (let i = 0; i < 5; i++) walkers.push(pin(add(s, createWalker(s, plat, i / 4))));
  const gained = [];
  for (const e of walkers) {
    const before = s.run.bonus;
    place(s, { cx: centerX(e), foot: e.y + 10, vy: 400 });
    playerVsEnemies(s);
    gained.push(s.run.bonus - before);
    assert.ok(e.dead > 0);
  }
  assert.deepEqual(gained, [25, 50, 75, 100, 100]);
  assert.equal(s.run.kills, 5);
  assert.equal(s.run.bestCombo, 5);
});

test('Zwei Gegner im selben Schritt werden beide gestompt und der Spieler springt nur einmal ab', () => {
  const { s, plat } = world({ w: 400 });
  const a = pin(add(s, createWalker(s, plat, 0.5)));
  const b = add(s, createWalker(s, plat, 0.5));
  b.x = a.x + 30;
  pin(b);
  place(s, { cx: a.x + 35, foot: a.y + 10, vy: 500 });
  playerVsEnemies(s);
  assert.ok(a.dead > 0 && b.dead > 0);
  assert.equal(s.run.kills, 2);
  assert.equal(s.player.vy, -PHYS.STOMP_BOUNCE);
});

test('Der Dash des Spielers besiegt Gegner ohne Absprung', () => {
  const { s, e } = walkerScene();
  place(s, { cx: e.x - 10, foot: e.y + e.h, dashT: 0.1 });
  s.player.vx = PHYS.DASH_SPEED;
  playerVsEnemies(s);
  assert.ok(e.dead > 0);
  assert.equal(e.state, 'dead');
  assert.equal(s.run.bonus, 25);
  assert.equal(s.run.kills, 1);
  assert.equal(s.player.vy, 0, 'Dash prallt nicht ab');
  assert.equal(s.fx.shake, 5, 'registerKill mit how dash');
  assert.equal(s.lives, 3);
});

test('Seitlicher Treffer ist kein Stomp und kein Kill', () => {
  const { s, e } = walkerScene();
  place(s, { cx: e.x - 5, foot: e.y + e.h });
  playerVsEnemies(s);
  assert.equal(e.dead, 0);
  assert.equal(e.state, 'patrol');
  assert.equal(s.run.kills, 0);
  assert.notEqual(s.player.vy, -PHYS.STOMP_BOUNCE, 'kein Absprung');
});

test('Treffer von unten ist kein Stomp', () => {
  const { s, e } = walkerScene();
  place(s, { cx: centerX(e), foot: e.y + 24, vy: -300 });
  playerVsEnemies(s);
  assert.equal(e.dead, 0);
  assert.equal(s.run.kills, 0);
  assert.notEqual(s.player.vy, -PHYS.STOMP_BOUNCE, 'kein Absprung');
});

test('Aufsteigender oder ruhender Spieler knapp über der Oberkante stompt nicht', () => {
  for (const vy of [-60, -10, 0]) {
    const { s, e } = walkerScene();
    place(s, { cx: centerX(e), foot: e.y + 8, vy });
    playerVsEnemies(s);
    assert.equal(e.dead, 0, `vy ${vy}`);
    assert.equal(s.run.kills, 0);
  }
});

test('Fallender Spieler, der schon tief im Gegner steckt, wird getroffen statt zu stompen', () => {
  const { s, e } = walkerScene();
  place(s, { cx: centerX(e), foot: e.y + 24, vy: 120 });
  playerVsEnemies(s);
  assert.equal(e.dead, 0);
  assert.equal(s.run.kills, 0);
});

test('Seitlicher Treffer ruft hurtPlayer mit Ursache und Position des Gegners', { skip: needsHurt }, () => {
  const labels = { walker: 'Gewitterwolke', jumper: 'Hüpfer', flyer: 'Fliegende Wolke', charger: 'Sturmwolke' };
  for (const [kind, label] of Object.entries(labels)) {
    const { s, plat } = world();
    const e = pin(add(s, kind === 'walker' ? createWalker(s, plat) : kind === 'jumper' ? createJumper(s, plat) : kind === 'charger' ? createCharger(s, plat) : createFlyer(s, 300, 250)));
    place(s, { cx: e.x - 5, foot: e.y + e.h });
    playerVsEnemies(s);
    assert.equal(s.lives, 2, kind);
    assert.deepEqual(s.deathCause, { kind: 'enemy', label });
    assert.ok(s.player.invuln > 0);
    assert.ok(s.player.vx < 0, 'Knockback weg vom Gegner');
    assert.equal(e.dead, 0);
    // im selben Moment gibt es keinen zweiten Treffer
    playerVsEnemies(s);
    assert.equal(s.lives, 2);
  }
});

test('Während der Unverwundbarkeit gibt es keinen Schaden, Stomps funktionieren trotzdem', () => {
  const side = walkerScene();
  place(side.s, { cx: side.e.x - 5, foot: side.e.y + side.e.h, invuln: 1 });
  playerVsEnemies(side.s);
  assert.equal(side.s.lives, 3);
  assert.equal(side.e.dead, 0);
  assert.equal(side.s.player.invuln, 1);

  const top = walkerScene();
  place(top.s, { cx: centerX(top.e), foot: top.e.y + 10, vy: 400, invuln: 1 });
  playerVsEnemies(top.s);
  assert.ok(top.e.dead > 0);
});

test('Toter Spieler und tote Gegner lösen nichts mehr aus', () => {
  const a = walkerScene();
  place(a.s, { cx: centerX(a.e), foot: a.e.y + 10, vy: 400 });
  a.s.player.dead = true;
  playerVsEnemies(a.s);
  assert.equal(a.e.dead, 0);

  const b = walkerScene();
  place(b.s, { cx: centerX(b.e), foot: b.e.y + 10, vy: 400 });
  playerVsEnemies(b.s);
  const bonus = b.s.run.bonus;
  place(b.s, { cx: centerX(b.e), foot: b.e.y + 10, vy: 400 });
  playerVsEnemies(b.s);
  assert.equal(b.s.run.bonus, bonus, 'ein toter Gegner gibt keine Punkte mehr');
  assert.equal(b.s.run.kills, 1);
  assert.equal(b.s.lives, 3);
});

test('Besiegter Gegner schrumpft 0,4 s und wird dann entfernt, das Array bleibt dasselbe', () => {
  const { s, plat } = world();
  const dying = pin(add(s, createWalker(s, plat, 0.3)));
  const other = add(s, createWalker(s, plat, 0.8));
  const list = s.enemies;
  place(s, { cx: centerX(dying), foot: dying.y + 10, vy: 400 });
  playerVsEnemies(s);
  assert.equal(dying.dead, 0.001);
  park(s);
  const x = dying.x;
  let prev = dying.dead;
  for (let i = 0; i < 20; i++) {
    tick(s);
    assert.ok(dying.dead > prev);
    prev = dying.dead;
    assert.equal(dying.x, x);
    assert.ok(s.enemies.includes(dying));
  }
  tick(s, 6);
  assert.equal(s.enemies.includes(dying), false);
  assert.equal(s.enemies.includes(other), true);
  assert.equal(s.enemies, list);
  assert.ok(DEAD_TIME === 0.4);
});

test('Ohne Entfernungen bleibt s.enemies unverändert', () => {
  const { s, plat } = world();
  add(s, createWalker(s, plat));
  const list = s.enemies;
  const before = list.slice();
  tick(s, 30);
  assert.equal(s.enemies, list);
  assert.deepEqual(list.map((e) => e.id), before.map((e) => e.id));
});

// ---------- Zusammenspiel mit der echten Spielerphysik ----------

test('Fall auf einen Gegner: aus jeder Höhe entweder Stomp oder gar kein Kontakt, nie Schaden', () => {
  for (const drop of [20, 60, 120, 200, 300, 450]) {
    for (const off of [-45, -36, -34, -20, 0, 20, 34, 36, 45]) {
      const { s, plat } = world();
      const e = pin(add(s, createWalker(s, plat, 0.5)));
      place(s, { cx: centerX(e) + off, foot: e.y - drop });
      let fastest = 0;
      for (let i = 0; i < 150; i++) {
        simStep(s);
        fastest = Math.max(fastest, s.player.vy);
      }
      const label = `Höhe ${drop} Versatz ${off}`;
      assert.equal(s.lives, 3, label);
      if (Math.abs(off) < 35) {
        assert.equal(e.state, 'dead', label);
        assert.equal(s.run.bonus, 25, label);
      } else {
        assert.equal(e.dead, 0, label);
      }
      if (drop === 450) assert.ok(fastest >= PHYS.MAX_FALL - 1, 'mit voller Fallgeschwindigkeit getestet');
    }
  }
});

test('Ein Walker, der in den stehenden Spieler läuft, verletzt ihn genau einmal pro Unverwundbarkeit', () => {
  const { s, plat } = world({ w: 700 });
  const e = add(s, createWalker(s, plat, 0.1, { dir: 1 }));
  place(s, { cx: e.x + 200, foot: plat.y });
  let n = 0;
  while (s.lives === 3 && n++ < 60 * 10) simStep(s);
  assert.equal(s.lives, 2, 'Walker hat den Spieler getroffen');
  assert.equal(s.deathCause.label, 'Gewitterwolke');
  assert.equal(e.dead, 0);
  for (let i = 0; i < 60; i++) simStep(s);
  assert.equal(s.lives, 2, 'während der Unverwundbarkeit kein zweiter Treffer');
});

test('Echter Dash besiegt einen Walker im Weg ohne Schaden', () => {
  const { s, plat } = world({ w: 700 });
  const e = pin(add(s, createWalker(s, plat, 0.5)));
  place(s, { cx: e.x - 110, foot: plat.y });
  s.player.power.dashT = 8;
  simStep(s, input({ move: 1, dashPressed: true }));
  assert.ok(s.player.dash.t > 0, 'Dash läuft');
  for (let i = 0; i < 30; i++) simStep(s, input({ move: 1 }));
  assert.equal(e.state, 'dead');
  assert.equal(s.lives, 3);
  assert.equal(s.run.kills, 1);
});

// ---------- Bereich, Host, Aufräumen ----------

test('Nur Gegner im aktiven Bereich werden aktualisiert', () => {
  const { s, plat } = world({ w: 300 });
  s.camX = 1000;
  const ahead = add(s, createWalker(s, { ...plat, id: 90, x: 1000 + 800 + 520, y: 300, w: 300 }, 0.5, { dir: 1 }));
  const behind = add(s, createWalker(s, { ...plat, id: 91, x: 1000 - 200 - 340, y: 300, w: 300 }, 0.5, { dir: 1 }));
  const inside = add(s, createWalker(s, { ...plat, id: 92, x: 1000 + 100, y: 300, w: 300 }, 0.5, { dir: 1 }));
  const edge = add(s, createWalker(s, { ...plat, id: 93, x: 2162, y: 300, w: 300 }, 0.5, { dir: 1 }));
  const snap = [ahead, behind, inside, edge].map((e) => ({ x: e.x, anim: e.anim }));
  tick(s, 30);
  assert.deepEqual({ x: ahead.x, anim: ahead.anim }, snap[0], 'weit voraus');
  assert.deepEqual({ x: behind.x, anim: behind.anim }, snap[1], 'weit hinten');
  assert.ok(inside.x > snap[2].x && inside.anim > 0);
  assert.ok(edge.x > snap[3].x, 'knapp im Bereich');
});

test('Tote Gegner außerhalb des Bildes werden trotzdem entfernt', () => {
  const { s, plat } = world();
  s.camX = 4000;
  const e = add(s, createWalker(s, plat));
  e.dead = 0.001;
  e.state = 'dead';
  tick(s, 30);
  assert.equal(s.enemies.length, 0);
});

test('Ohne Host Plattform patrouillieren alle Bodengegner weiter innerhalb minX und maxX', () => {
  const { s, plat } = world({ w: 400 });
  const w = add(s, createWalker(s, plat, 0.5, { dir: 1 }));
  const j = add(s, createJumper(s, plat, 0.5));
  const c = add(s, createCharger(s, plat, 0.5));
  j.cooldown = 0.5;
  s.platforms.length = 0;
  place(s, { cx: centerX(c) + 100, foot: c.y + c.h });
  let jumped = false;
  let charged = false;
  let turned = false;
  for (let i = 0; i < 60 * 30; i++) {
    tick(s);
    for (const e of [w, j, c]) assert.ok(e.x >= e.minX && e.x <= e.maxX);
    if (j.state === 'air') jumped = true;
    if (c.state === 'dash') charged = true;
    if (w.state === 'turn') turned = true;
    s.player.x = c.x + 100;
  }
  assert.ok(jumped && charged && turned);
});

test('Gegner mit unbekanntem Zustand oder kaputter Richtung stürzen nicht ab', () => {
  const { s, plat } = world();
  const a = add(s, createWalker(s, plat));
  a.state = 'fly';
  a.dir = 0;
  const b = add(s, createJumper(s, plat));
  b.state = 'turn';
  b.dir = NaN;
  const c = add(s, createCharger(s, plat));
  c.state = 'crouch';
  tick(s, 120);
  for (const e of [a, b, c]) {
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    assert.ok(e.dir === 1 || e.dir === -1);
  }
  updateEnemies(s, 0);
  updateEnemies(s, NaN);
  updateEnemies({ enemies: [], camX: 0, t: 0 }, STEP);
  playerVsEnemies({ enemies: [], player: s.player });
  assert.ok(Number.isFinite(a.x));
});

test('clearEnemiesNear entfernt Gegner im x Bereich und lässt die anderen stehen', () => {
  const { s, plat } = world({ w: 700 });
  const left = add(s, createWalker(s, plat, 0));
  const mid = add(s, createWalker(s, plat, 0.5));
  const right = add(s, createWalker(s, plat, 1));
  const dead = add(s, createWalker(s, plat, 0.5));
  dead.dead = 0.2;
  const list = s.enemies;
  clearEnemiesNear(s, mid.x - 10, mid.x + 50);
  assert.equal(s.enemies, list);
  assert.deepEqual(s.enemies.map((e) => e.id), [left.id, right.id]);
  if (REAL_PARTICLES) assert.ok(s.particles.length >= 1, 'Partikel poof');
  clearEnemiesNear(s, 5000, 6000);
  assert.equal(s.enemies.length, 2);
  clearEnemiesNear(s, 0, 100000);
  assert.equal(s.enemies.length, 0);
  clearEnemiesNear(s, 0, 100);
});

test('clearEnemiesNear erzeugt für lebende Gegner Partikel', { skip: needsParticles }, () => {
  const { s, plat } = world();
  add(s, createWalker(s, plat, 0.5));
  clearEnemiesNear(s, 0, 10000);
  assert.ok(s.particles.length > 0);
});

// ---------- Zustand ----------

test('Zustand mit Gegnern bleibt kopierbar und eine Kopie läuft identisch weiter', () => {
  const { s, plat } = world({ w: 600 });
  add(s, createWalker(s, plat, 0.2, { dir: 1 }));
  const j = add(s, createJumper(s, plat, 0.5));
  j.cooldown = 0.2;
  add(s, createCharger(s, plat, 0.8));
  add(s, createFlyer(s, 400, 150));
  place(s, { cx: 450, foot: 300 });
  tick(s, 200);
  const copy = structuredClone(s);
  tick(s, 600);
  tick(copy, 600);
  assert.deepEqual(copy.enemies, s.enemies);
  assert.equal(copy.rng, s.rng);
  for (const e of s.enemies) {
    for (const v of Object.values(e)) assert.ok(typeof v !== 'function' && !(v instanceof Set) && !(v instanceof Map));
  }
});

// ---------- Fuzz ----------

const GROUND = new Set(['walker', 'jumper', 'charger']);
const STATES = {
  walker: ['patrol', 'turn', 'dead'],
  jumper: ['patrol', 'crouch', 'air', 'dead'],
  charger: ['patrol', 'windup', 'dash', 'cooldown', 'dead'],
  flyer: ['fly', 'dead'],
};

function checkEnemy(e, label) {
  for (const k of ['x', 'y', 'vx', 'vy', 'timer', 'anim', 'telegraph', 'cooldown', 'baseY', 'dead', 'dir']) {
    assert.ok(Number.isFinite(e[k]), `${label}: ${k} ist ${e[k]}`);
  }
  if (e.shakeX !== undefined) assert.ok(Number.isFinite(e.shakeX), `${label}: shakeX`);
  assert.ok(e.telegraph >= 0 && e.telegraph <= 1, `${label}: telegraph ${e.telegraph}`);
  assert.ok(e.dir === 1 || e.dir === -1, `${label}: dir`);
  assert.ok(STATES[e.kind].includes(e.state), `${label}: Zustand ${e.state}`);
  if (GROUND.has(e.kind)) {
    assert.ok(e.x >= e.minX - 1e-9 && e.x <= e.maxX + 1e-9, `${label}: x ${e.x} außerhalb ${e.minX}..${e.maxX}`);
    if (e.kind === 'jumper') assert.ok(e.y <= e.baseY + 1e-9 && e.y >= e.baseY - 60, `${label}: y ${e.y}`);
    else assert.equal(e.y, e.baseY, `${label}: y`);
  } else {
    assert.ok(Math.abs(e.y - e.baseY) <= e.amp + 1e-9, `${label}: Flieger y`);
    assert.ok(e.x >= e.minX - 1e-9 && e.x <= e.maxX + 1e-9);
  }
}

function fuzzScene(seed) {
  const r = {};
  seedRng(r, seed);
  const w = Math.round(range(r, 110, 900));
  const { s, plat } = world({ w, seed });
  const n = int(r, 1, 5);
  for (let i = 0; i < n; i++) {
    const kind = int(r, 0, 3);
    const dir = int(r, 0, 1) ? 1 : -1;
    if (kind === 0) add(s, createWalker(s, plat, range(r, 0, 1), { dir }));
    else if (kind === 1) add(s, createJumper(s, plat, range(r, 0, 1), { dir }));
    else if (kind === 2) add(s, createCharger(s, plat, range(r, 0, 1), { dir }));
    else add(s, createFlyer(s, plat.x + range(r, 0, w), 180, { range: range(r, 40, 300), dir, phase: range(r, 0, 6) }));
  }
  return { r, s, plat };
}

test('Fuzz: zufällige Gegner auf zufälligen Plattformen bleiben endlich und fallen nie herunter', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { r, s, plat } = fuzzScene(seed);
    const dashDir = new Map();
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 37 === 0) {
        const foot = plat.y + range(r, -110, 50);
        place(s, { cx: plat.x + range(r, -150, plat.w + 150), foot });
      }
      tick(s);
      for (const e of s.enemies) {
        checkEnemy(e, `Seed ${seed} Schritt ${i} ${e.kind}`);
        if (e.kind === 'charger') {
          if (e.state === 'dash') {
            if (!dashDir.has(e.id)) dashDir.set(e.id, e.dir);
            assert.equal(e.dir, dashDir.get(e.id), 'Dash Richtung bleibt');
          } else dashDir.delete(e.id);
        }
      }
    }
    assert.ok(structuredClone(s));
  }
});

test('Fuzz: mit Kollisionen, Stomps und Dash bleibt alles endlich und tote Gegner verschwinden', () => {
  for (let seed = 100; seed < 130; seed++) {
    const { r, s, plat } = fuzzScene(seed);
    let last = s.enemies.length;
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 11 === 0) {
        const p = place(s, { cx: plat.x + range(r, 0, plat.w), foot: plat.y + range(r, -90, 10), vy: [0, 300, 900, -300][int(r, 0, 3)], invuln: 99, dashT: int(r, 0, 9) === 0 ? 0.1 : 0 });
        p.x += range(r, -20, 20);
      }
      tick(s);
      playerVsEnemies(s);
      assert.ok(s.enemies.length <= last, 'Gegner kommen nicht von allein dazu');
      last = s.enemies.length;
      for (const e of s.enemies) {
        checkEnemy(e, `Seed ${seed} Schritt ${i} ${e.kind}`);
        assert.ok(e.dead < DEAD_TIME + 2 * STEP, 'tote Gegner werden entfernt');
      }
      assert.ok(Number.isFinite(s.player.vy) && Number.isFinite(s.run.bonus));
    }
  }
});

test('Gegner im laufenden Spiel bleiben gültig (mit Generator, Spieler und Simulation)', () => {
  const s = newGame(11);
  const plat = s.platforms.find((p) => p.w >= 300);
  const cx = plat.x + plat.w / 2;
  s.camX = Math.max(0, cx - 300);
  const w = add(s, createWalker(s, plat, 0.8, { dir: 1 }));
  const j = add(s, createJumper(s, plat, 0.5));
  const c = add(s, createCharger(s, plat, 0.2));
  s.player.invuln = 99;
  run(s, 60 * 12, (st, i) => input({ move: i % 120 < 60 ? 1 : -1, jumpPressed: i % 50 === 0, jumpHeld: i % 50 < 20 }));
  for (const e of [w, j, c]) {
    if (!s.enemies.includes(e)) continue;
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    assert.ok(e.x >= e.minX && e.x <= e.maxX);
  }
  assert.ok(structuredClone(s));
});
