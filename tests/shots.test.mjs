// Sternenwurf: fireShot und updateShots in game/shots.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, H, MAX_LIVES, STEP, W } from '../game/constants.js';
import {
  createFlyer, createHail, createHailcloud, createShot, createStaticPlatform, createWalker,
} from '../game/entities.js';
import { damageEnemy } from '../game/enemies.js';
import { PRESET_NAMES } from '../game/particles.js';
import { hurtPlayer, updatePlayer } from '../game/player.js';
import { fireShot, updateShots } from '../game/shots.js';
import { createState } from '../game/state.js';
import { stepSim } from '../game/sim.js';
import { input, invariants, newGame } from './helpers.mjs';

const { SHOT } = ABILITY;
const GROUND_Y = 360;

function world() {
  const s = createState({ seed: 1 });
  s.camX = 0;
  const g = createStaticPlatform(s, -500, GROUND_Y, 3000, { ground: true });
  s.platforms.push(g);
  const p = s.player;
  p.x = 300;
  p.y = GROUND_Y - p.h;
  p.onGround = true;
  p.groundId = g.id;
  p.ammo = 3;
  p.face = 1;
  return { s, g, p };
}

const sfxCount = (s, name) => s.sfx.filter((e) => e.n === name).length;

function damageReady() {
  const s = createState({ seed: 1 });
  const g = createStaticPlatform(s, 0, 360, 400);
  s.platforms.push(g);
  const e = createWalker(s, g, 0.5);
  s.enemies.push(e);
  return damageEnemy(s, e, 'shot') === true && e.dead > 0;
}
const DAMAGE = damageReady();
const needsDamage = (name, fn) => test(name, { skip: DAMAGE ? false : 'damageEnemy in enemies.js ist noch ein Stub' }, fn);

// Gegner auf dem Boden, Mitte bei cx
function walkerAt(s, g, cx) {
  const e = createWalker(s, g, 0.5);
  e.x = cx - e.w / 2;
  e.minX = e.maxX = e.x;
  s.enemies.push(e);
  return e;
}

// ---------- fireShot ----------

test('fireShot ohne Wurfsterne tut nichts', () => {
  const { s, p } = world();
  p.ammo = 0;
  assert.equal(fireShot(s), false);
  assert.equal(s.shots.length, 0);
  assert.equal(sfxCount(s, 'throw'), 0);
  assert.equal(p.throwCd, 0);
  p.ammo = NaN;
  assert.equal(fireShot(s), false);
  p.ammo = -1;
  assert.equal(fireShot(s), false);
});

test('fireShot wirft in Blickrichtung, verbraucht einen Wurfstern und startet die Abklingzeit', () => {
  for (const face of [1, -1]) {
    const { s, p } = world();
    p.face = face;
    assert.equal(fireShot(s), true);
    assert.equal(s.shots.length, 1);
    const sh = s.shots[0];
    assert.equal(sh.kind, 'shot');
    assert.equal(sh.vx, face * SHOT.SPEED);
    assert.equal(sh.vy, 0);
    assert.equal(sh.life, SHOT.LIFE);
    assert.equal(p.ammo, 2);
    assert.equal(p.throwCd, SHOT.COOLDOWN);
    assert.equal(sfxCount(s, 'throw'), 1);
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    assert.ok((cx - (p.x + p.w / 2)) * face > 0, 'startet vor dem Spieler');
    assert.ok(Math.abs(cx - (p.x + p.w / 2)) < p.w, 'und nahe bei ihm');
    assert.ok(Math.abs(cy - (p.y + p.h / 2)) < 1, 'auf Körperhöhe');
    if (PRESET_NAMES.includes('throw')) assert.ok(s.particles.length > 0, 'Partikel throw');
  }
});

test('fireShot: Abklingzeit sperrt, danach wirft er wieder', () => {
  const { s, p } = world();
  assert.equal(fireShot(s), true);
  assert.equal(fireShot(s), false, 'zu früh');
  assert.equal(p.ammo, 2);
  p.throwCd = 0;
  assert.equal(fireShot(s), true);
  assert.equal(p.ammo, 1);
  assert.equal(s.shots.length, 2);
  assert.equal(new Set(s.shots.map((x) => x.id)).size, 2, 'eigene ids');
});

test('fireShot: tote Spieler werfen nicht, höchstens 4 Wurfsterne gleichzeitig', () => {
  const { s, p } = world();
  p.dead = true;
  assert.equal(fireShot(s), false);
  p.dead = false;
  p.ammo = 9;
  for (let i = 0; i < 4; i++) {
    p.throwCd = 0;
    assert.equal(fireShot(s), true, `Wurf ${i + 1}`);
  }
  p.throwCd = 0;
  assert.equal(fireShot(s), false, 'fünfter Wurf scheitert');
  assert.equal(s.shots.length, 4);
  assert.equal(p.ammo, 5, 'der Vorrat bleibt unberührt');
  assert.equal(p.throwCd, 0);
});

test('fireShot legt s.shots an, falls es fehlt', () => {
  const { s } = world();
  delete s.shots;
  assert.equal(fireShot(s), true);
  assert.equal(s.shots.length, 1);
});

// ---------- updateShots: Flug ----------

test('Wurfstern fliegt geradlinig, ohne Schwerkraft, und lebt SHOT.LIFE Sekunden', () => {
  const { s } = world();
  fireShot(s);
  const sh = s.shots[0];
  const x0 = sh.x;
  const y0 = sh.y;
  let frames = 0;
  while (s.shots.length && frames < 100) {
    updateShots(s, STEP);
    frames++;
    if (s.shots.length) {
      assert.ok(Math.abs(sh.x - (x0 + SHOT.SPEED * frames * STEP)) < 1e-6, 'gleichmäßig');
      assert.equal(sh.y, y0);
      assert.ok(Math.abs(sh.anim - frames * STEP) < 1e-9);
    }
  }
  assert.ok(Math.abs(frames * STEP - SHOT.LIFE) < 2 * STEP, `Lebensdauer ${frames * STEP}`);
  assert.equal(s.shots.length, 0);
  const travelled = sh.x - x0;
  assert.ok(Math.abs(travelled - SHOT.SPEED * SHOT.LIFE) < SHOT.SPEED * 2 * STEP, `Reichweite ${travelled}`);
});

test('updateShots: nach links, schräg und mit großem Schritt (gekappt)', () => {
  const { s, p } = world();
  p.face = -1;
  fireShot(s);
  const sh = s.shots[0];
  const x0 = sh.x;
  updateShots(s, STEP);
  assert.ok(sh.x < x0);
  s.shots.push(createShot(s, 400, 200, 100, 200));
  const d = s.shots[1];
  const dx0 = d.x;
  updateShots(s, 1); // wird auf 1/20 gekappt
  assert.ok(Math.abs(d.x - (dx0 + 100 / 20)) < 1e-6, `Schritt gekappt (${d.x - dx0})`);
  assert.ok(Math.abs(d.y - (200 - d.h / 2 + 200 / 20)) < 1e-6, `Schritt gekappt (${d.y})`);
});

test('updateShots ignoriert dt gleich 0, NaN und negativ', () => {
  const { s } = world();
  fireShot(s);
  const before = JSON.stringify(s.shots);
  updateShots(s, 0);
  updateShots(s, NaN);
  updateShots(s, -1);
  assert.equal(JSON.stringify(s.shots), before);
  updateShots({ shots: undefined, camX: 0 }, STEP);
  updateShots({ camX: 0 }, STEP);
});

test('Wurfsterne weit außerhalb des Bildes verschwinden', () => {
  const { s } = world();
  s.camX = 1000;
  const mk = (x, y, vx = 0, vy = 0) => createShot(s, x, y, vx, vy);
  const inside = mk(1300, 200);
  s.shots.push(
    mk(500, 200), // weit links
    mk(2200, 200), // weit rechts
    mk(1300, H + 400), // weit unten
    mk(1300, -400), // weit oben
    inside,
  );
  updateShots(s, STEP);
  assert.deepEqual(s.shots, [inside]);
  // und beim Hinausfliegen
  const out = mk(1000 + W + 100, 200, 640, 0);
  s.shots.push(out);
  for (let i = 0; i < 10 && s.shots.includes(out); i++) updateShots(s, STEP);
  assert.ok(!s.shots.includes(out));
});

test('kaputte Wurfsterne (NaN) werden entfernt, die Liste bleibt dieselbe', () => {
  const { s } = world();
  const list = s.shots;
  const ok = createShot(s, 400, 200, 100, 0);
  const bad = createShot(s, 400, 200, NaN, 0);
  const bad2 = createShot(s, 400, 200, 100, 0);
  bad2.life = NaN;
  list.push(bad, null, ok, bad2);
  updateShots(s, STEP);
  assert.equal(s.shots, list, 'in place');
  assert.deepEqual(s.shots, [ok]);
});

// ---------- Treffer ----------

test('Wurfstern verschwindet beim Treffer, auch wenn der Gegner den Schaden nicht annimmt', () => {
  const { s, g } = world();
  fireShot(s);
  walkerAt(s, g, 330 + 120);
  let frames = 0;
  while (s.shots.length && frames < 60) {
    updateShots(s, STEP);
    frames++;
  }
  assert.equal(s.shots.length, 0, 'weg nach dem Treffer');
  assert.ok(frames * STEP < SHOT.LIFE - 0.2, `schon nach ${frames * STEP} s, nicht erst am Lebensende`);
});

needsDamage('Wurfstern besiegt den Gegner vor ihm, Punkte und Combo wie bei einem Stomp', () => {
  const { s, g } = world();
  fireShot(s);
  const e = walkerAt(s, g, 330 + 150);
  const hits0 = s.run.kills;
  let frames = 0;
  while (s.shots.length && frames < 60) {
    updateShots(s, STEP);
    frames++;
  }
  assert.ok(e.dead > 0, 'besiegt');
  assert.equal(e.state, 'dead');
  assert.equal(s.run.kills, hits0 + 1);
  assert.equal(s.combo.count, 1);
  assert.ok(s.run.bonus > 0);
  assert.ok(frames * STEP < 0.3, `Treffer nach ${frames * STEP} s`);
});

needsDamage('Wurfstern trifft nur in Flugrichtung, Höhe zählt, hinter und über ihm passiert nichts', () => {
  const { s, g } = world();
  const behind = walkerAt(s, g, 150); // hinter dem Spieler
  const high = createFlyer(s, 480, 150); // zu hoch
  const low = createFlyer(s, 520, 330 + 80); // darunter im Boden, zu tief
  s.enemies.push(high, low);
  fireShot(s);
  for (let i = 0; i < 60; i++) updateShots(s, STEP);
  assert.ok(!(behind.dead > 0));
  assert.ok(!(high.dead > 0));
  assert.ok(!(low.dead > 0));
  assert.equal(s.run.kills, 0);
});

needsDamage('Wurfstern trifft den nächsten Gegner zuerst und fliegt nicht hindurch', () => {
  const { s, g } = world();
  const far = walkerAt(s, g, 330 + 260);
  const near = walkerAt(s, g, 330 + 100);
  fireShot(s);
  for (let i = 0; i < 60; i++) updateShots(s, STEP);
  assert.ok(near.dead > 0);
  assert.ok(!(far.dead > 0), 'der Stern ist aufgebraucht');
  assert.equal(s.run.kills, 1);
});

needsDamage('Schon tote Gegner werden durchflogen, mehrere gleichzeitige Treffer sind sauber', () => {
  const { s, g } = world();
  const dead = walkerAt(s, g, 330 + 80);
  dead.dead = 0.2;
  dead.state = 'dead';
  const alive = walkerAt(s, g, 330 + 200);
  fireShot(s);
  for (let i = 0; i < 60; i++) updateShots(s, STEP);
  assert.equal(dead.dead, 0.2, 'unverändert');
  assert.ok(alive.dead > 0);
  assert.equal(s.run.kills, 1);

  // zwei Sterne auf denselben Gegner: der zweite fliegt durch, kein Doppelkill
  const w = world();
  const e = walkerAt(w.s, w.g, 330 + 100);
  w.s.shots.push(createShot(w.s, 340, e.y + e.h / 2, SHOT.SPEED, 0), createShot(w.s, 336, e.y + e.h / 2, SHOT.SPEED, 0));
  for (let i = 0; i < 30; i++) updateShots(w.s, STEP);
  assert.equal(w.s.run.kills, 1, 'nur ein Kill');
});

needsDamage('Auch bei großen Schritten fliegt der Stern nicht durch einen Gegner', () => {
  const { s, g } = world();
  const e = walkerAt(s, g, 330 + 90);
  s.shots.push(createShot(s, 340, e.y + e.h / 2, SHOT.SPEED * 3, 0)); // 3 mal so schnell, ein Schritt 1/20 s
  updateShots(s, 1 / 20);
  updateShots(s, 1 / 20);
  assert.ok(e.dead > 0);
});

needsDamage('Wurfstern trifft auch Flieger und Hagelwolken', () => {
  const { s } = world();
  const f = createFlyer(s, 520, 300);
  const h = createHailcloud(s, 680, 300);
  s.enemies.push(f, h);
  s.shots.push(createShot(s, 340, 300, SHOT.SPEED, 0));
  for (let i = 0; i < 30 && f.dead === 0; i++) updateShots(s, STEP);
  assert.ok(f.dead > 0, 'Flieger');
  const s2 = world().s;
  const h2 = createHailcloud(s2, 520, 300);
  s2.enemies.push(h2);
  s2.shots.push(createShot(s2, 340, 300, SHOT.SPEED, 0));
  for (let i = 0; i < 20 && h2.dead === 0; i++) updateShots(s2, STEP);
  assert.ok(h2.dead > 0, 'Hagelwolke');
});

test('Wurfsterne treffen nie den Spieler', () => {
  const { s, p } = world();
  s.shots.push(createShot(s, p.x + p.w / 2, p.y + p.h / 2, 0, 0)); // genau auf dem Spieler
  s.shots.push(createShot(s, p.x + p.w / 2 + 40, p.y + p.h / 2, -SHOT.SPEED, 0)); // fliegt auf ihn zu
  for (let i = 0; i < 20; i++) updateShots(s, STEP);
  assert.equal(s.lives, MAX_LIVES);
  assert.equal(p.invuln, 0);
  assert.equal(s.run.hits, 0);
  assert.equal(s.mode, 'playing');
});

// ---------- Hagel ----------

test('Wurfstern zerstört Hagelkörner und verschwindet dabei, ferne Körner bleiben', () => {
  const { s } = world();
  const near = createHail(s, 420, 300, 0, 0);
  const far = createHail(s, 600, 300, 0, 0);
  const below = createHail(s, 420, 360, 0, 0);
  s.hazards.push(near, far, below);
  s.shots.push(createShot(s, 340, 300, SHOT.SPEED, 0));
  for (let i = 0; i < 20 && s.shots.length; i++) updateShots(s, STEP);
  assert.equal(s.shots.length, 0, 'der Stern ist verbraucht');
  assert.ok(!s.hazards.includes(near), 'getroffen');
  assert.ok(s.hazards.includes(far));
  assert.ok(s.hazards.includes(below));
});

// ---------- Zusammenspiel mit dem Spieler ----------

needsDamage('Spieler wirft per throwPressed und erledigt einen Gegner in der Ferne', () => {
  const { s, g, p } = world();
  const e = walkerAt(s, g, p.x + p.w / 2 + 260);
  const step = (inp) => {
    s.t += STEP;
    s.realT += STEP;
    updatePlayer(s, inp, STEP);
    updateShots(s, STEP);
  };
  step(input({ throwPressed: true }));
  assert.equal(p.ammo, 2);
  for (let i = 0; i < 40 && !(e.dead > 0); i++) step(input());
  assert.ok(e.dead > 0, 'getroffen');
  assert.equal(s.shots.length, 0);
});

test('Im vollen Spiel: Wurfsterne laden über Sterne auf, Werfen verbraucht sie, Invarianten bleiben leer', () => {
  const s = newGame(7);
  const p = s.player;
  assert.equal(p.ammo, 0);
  for (let i = 0; i < 30; i++) stepSim(s, input({ throwPressed: true }), STEP);
  assert.equal(s.shots.length, 0, 'ohne Vorrat kein Wurf');
  p.ammo = 3;
  let max = 0;
  for (let i = 0; i < 120; i++) {
    stepSim(s, input({ move: 1, throwPressed: i % 3 === 0, jumpHeld: false }), STEP);
    max = Math.max(max, s.shots.length);
    assert.ok(s.shots.length <= 4);
  }
  assert.ok(p.ammo < 3, 'Vorrat verbraucht');
  assert.ok(max >= 1);
  assert.deepEqual(invariants(s), []);
  const clone = structuredClone(s);
  assert.equal(clone.shots.length, s.shots.length);
});

test('Treffer am Spieler beim Werfen: gestunnt wirft er nicht, danach wieder', () => {
  const { s, p } = world();
  hurtPlayer(s, { kind: 'enemy', label: 'Test', x: p.x + 100, y: p.y });
  assert.ok(p.stun > 0);
  updatePlayer(s, input({ throwPressed: true }), STEP);
  assert.equal(s.shots.length, 0);
  for (let i = 0; i < 20; i++) updatePlayer(s, input(), STEP);
  updatePlayer(s, input({ throwPressed: true }), STEP);
  assert.equal(s.shots.length, 1);
});
