import test from 'node:test';
import assert from 'node:assert/strict';
import { H, HAIL, LIMITS, STEP, W } from '../game/constants.js';
import {
  createBlinkPlatform, createBreakablePlatform, createComet, createHail, createLightning, createMovingPlatform, createSpike,
  createStaticPlatform,
} from '../game/entities.js';
import { createState } from '../game/state.js';
import { int, rand, range } from '../game/rng.js';
import { hurtPlayer } from '../game/player.js';
import { updatePlatforms } from '../game/platforms.js';
import { stepSim } from '../game/sim.js';
import { clearHazardsNear, destroyHail, hailHitbox, playerVsHazards, updateObstacles } from '../game/obstacles.js';
import { input, invariants, newGame } from './helpers.mjs';

// ---------- Hilfen ----------

// Schaden kommt aus player.js. Solange dort noch ein Stub liegt, werden nur die Prüfungen übersprungen, die ihn beobachten.
const REAL_HURT = (() => {
  const s = createState();
  return hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 }) !== 'ignored';
})();
const needsHurt = REAL_HURT ? false : 'player.js ist noch ein Stub (hurtPlayer)';

const EPS = 1e-9;
const R_HIT = HAIL.R - 2; // Trefferkreis ist 2 px kleiner als die Zeichnung

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

function addHail(s, x, y, vx = 0, vy = 0) {
  const h = createHail(s, x, y, vx, vy);
  s.hazards.push(h);
  return h;
}

const hails = (s) => s.hazards.filter((h) => h.kind === 'hail');

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

// ---------- Form und Flug ----------

test('createHail: Form und Konstanten', () => {
  const s = createState();
  const h = createHail(s, 100, 50, 30, 280);
  assert.equal(h.kind, 'hail');
  assert.equal(h.life, HAIL.LIFE);
  assert.equal(h.w, HAIL.R * 2);
  assert.deepEqual([h.x, h.y, h.vx, h.vy], [100, 50, 30, 280]);
  assert.deepEqual(hailHitbox(h), { x: 100, y: 50, r: R_HIT });
  assert.deepEqual(structuredClone(h), h);
});

test('Hagel: fliegt geradlinig (x plus vx mal dt, y plus vy mal dt) und zählt anim hoch', () => {
  const s = world();
  const h = addHail(s, 200, 20, 45, 120);
  const y0 = 20;
  for (let i = 1; i <= 90; i++) {
    tick(s);
    assert.ok(Math.abs(h.x - (200 + 45 * i * STEP)) < 1e-6, `x nach ${i}`);
    assert.ok(Math.abs(h.y - (y0 + 120 * i * STEP)) < 1e-6, `y nach ${i}`);
    assert.ok(Math.abs(h.anim - i * STEP) < 1e-9);
    assert.ok(Math.abs(h.life - (HAIL.LIFE - i * STEP)) < 1e-9);
  }
  assert.equal(hails(s).length, 1);
});

test('Hagel: Flug ist unabhängig von der Schrittweite (gleiche Strecke in gleicher Zeit)', () => {
  for (const dt of [1 / 240, 1 / 60, 1 / 30, 0.1]) {
    const s = world();
    const h = addHail(s, 200, 20, -60, 100);
    const n = Math.round(1 / dt);
    tick(s, n, dt);
    assert.ok(Math.abs(h.x - 140) < 1e-6 && Math.abs(h.y - 120) < 1e-6, `dt ${dt}: ${h.x}, ${h.y}`);
  }
});

test('Hagel: ein stehendes Korn verschwindet nach HAIL.LIFE Sekunden mit Staub im Bild', () => {
  const s = world();
  const h = addHail(s, 300, 200, 0, 0);
  tick(s, Math.round((HAIL.LIFE - 0.1) / STEP));
  assert.equal(hails(s).length, 1, 'noch da');
  assert.ok(h.life > 0);
  assert.equal(s.particles.length, 0);
  tick(s, Math.round(0.2 / STEP));
  assert.equal(hails(s).length, 0, 'weg');
  assert.ok(s.particles.length > 0, 'poof');
});

test('Hagel: verschwindet unter dem Bild (y größer H plus 40), nicht früher, ohne Staub', () => {
  const s = world();
  const h = addHail(s, 300, H + 30, 0, 600);
  tick(s); // y = H + 40: bleibt (nicht größer)
  assert.ok(Math.abs(h.y - (H + 40)) < 1e-9);
  assert.equal(hails(s).length, 1);
  tick(s);
  assert.equal(hails(s).length, 0);
  assert.equal(s.particles.length, 0, 'unter dem Bild kein Staub');
});

test('Hagel: verschwindet weit links von der Kamera, nicht früher', () => {
  const s = world({ camX: 1000 });
  const stays = addHail(s, 1000 - 199, 200, 0, 0);
  const goes = addHail(s, 1000 - 201, 200, 0, 0);
  tick(s);
  assert.deepEqual(hails(s).map((h) => h.id), [stays.id]);
  // Die Kamera läuft weiter, das Korn bleibt hinter ihr zurück
  s.camX += 100;
  tick(s);
  assert.equal(hails(s).length, 0);
  assert.ok(!s.hazards.includes(goes), 'das Korn hinter der Kamera ist weg');
  assert.equal(s.particles.length, 0, 'weit links kein Staub');
});

test('Hagel: fliegt es nach rechts aus dem Bild, bleibt es bis zum Ende seiner Zeit erhalten und verschwindet dann', () => {
  const s = world();
  addHail(s, W + 300, 100, 400, 0);
  tick(s, 60 * 2);
  assert.equal(hails(s).length, 1);
  tick(s, 60 * 2);
  assert.equal(hails(s).length, 0, 'nach HAIL.LIFE weg');
});

// ---------- Treffer ----------

test('Hagel: Trefferkreis gegen die Spielerbox (Spieler 4 px kleiner, Kreis 2 px kleiner als die Zeichnung)', { skip: needsHurt }, () => {
  // Spieler: p.x 278, p.y 326 → Hitbox x 282 bis 318, y 330 bis 356
  const hit = (hx, hy) => {
    const s = world();
    addHail(s, hx, hy);
    const p = place(s, 300, 360);
    p.x = 278;
    p.y = 326;
    playerVsHazards(s);
    return s.run.hits === 1;
  };
  assert.equal(hit(300, 340), true, 'mitten drin');
  // Von oben: Mittelpunkt x 300 liegt über der Box, Abstand zur Oberkante (330) muss kleiner als 7 sein
  assert.equal(hit(300, 330 - R_HIT), false, 'berührt nur');
  assert.equal(hit(300, 330 - R_HIT + 0.5), true);
  assert.equal(hit(300, 330 - R_HIT - 0.5), false);
  // Von unten und von der Seite
  assert.equal(hit(300, 356 + R_HIT - 0.5), true);
  assert.equal(hit(300, 356 + R_HIT), false);
  assert.equal(hit(282 - R_HIT, 340), false);
  assert.equal(hit(282 - R_HIT + 0.5, 340), true);
  assert.equal(hit(318 + R_HIT - 0.5, 340), true);
  assert.equal(hit(318 + R_HIT + 0.5, 340), false);
  // Ecke: Abstand zur Ecke (282, 330) muss kleiner als 7 sein
  assert.equal(hit(282 - 4.9, 330 - 4.9), true, 'Ecke, Abstand 6,93');
  assert.equal(hit(282 - 5, 330 - 5), false, 'Ecke, Abstand 7,07');
  // Die Zeichnung (Radius 9) reicht weiter als der Kreis: Berührung nur der Zeichnung zählt nicht
  assert.equal(hit(300, 330 - HAIL.R), false);
  assert.equal(hit(1000, 340), false, 'weit weg');
});

test('Hagel: Treffer ruft hurtPlayer mit Ursache Hagel, Rückstoß weg vom Korn, das Korn verschwindet', { skip: needsHurt }, () => {
  const s = world();
  const other = addHail(s, 900, 100);
  const h = addHail(s, 290, 340);
  place(s, 300, 360);
  playerVsHazards(s);
  assert.equal(s.lives, 49);
  assert.equal(s.run.hits, 1);
  assert.deepEqual(s.deathCause, { kind: 'hail', label: 'Hagel' });
  assert.ok(s.player.vx > 0, 'Korn links vom Spieler: Rückstoß nach rechts');
  assert.deepEqual(s.hazards.map((e) => e.id), [other.id], 'das treffende Korn ist weg, das andere bleibt');
  assert.ok(!s.hazards.includes(h));
  assert.ok(s.particles.length > 0, 'Staub beim Treffer');

  const right = world();
  addHail(right, 320, 340);
  place(right, 300, 360);
  playerVsHazards(right);
  assert.ok(right.player.vx < 0, 'Korn rechts: Rückstoß nach links');
});

test('Hagel: mehrere Körner im selben Schritt kosten nur ein Leben, die übrigen fliegen weiter', { skip: needsHurt }, () => {
  const s = world();
  for (let i = 0; i < 4; i++) addHail(s, 290 + i * 8, 340);
  place(s, 300, 360);
  playerVsHazards(s);
  assert.equal(s.lives, 49);
  assert.equal(s.run.hits, 1);
  assert.equal(hails(s).length, 3);
  for (let i = 0; i < 10; i++) playerVsHazards(s);
  assert.equal(s.run.hits, 1, 'unverwundbar');
});

test('Hagel: Schild absorbiert, das Korn verschwindet trotzdem', { skip: needsHurt }, () => {
  const s = world();
  addHail(s, 300, 340);
  place(s, 300, 360).power.shield = true;
  playerVsHazards(s);
  assert.equal(s.lives, 50);
  assert.equal(s.player.power.shield, false);
  assert.equal(s.run.hits, 0);
  assert.equal(hails(s).length, 0);
});

test('Hagel: im Respawn Fenster und bei Unverwundbarkeit passiert nichts, das Korn fliegt weiter', { skip: needsHurt }, () => {
  const s = world();
  const h = addHail(s, 300, 340);
  const p = place(s, 300, 360);
  p.invuln = 2.2; // wie nach respawnPlayer
  tick(s, 60 * 2);
  assert.equal(s.run.hits, 0);
  assert.equal(s.lives, 50);
  assert.ok(hails(s).includes(h), 'das Korn wurde nicht vom Spieler verbraucht (2 s sind weniger als HAIL.LIFE)');
  // Ein stehendes Korn, das den Spieler nach Ablauf der Unverwundbarkeit noch überlappt, trifft dann
  const t = world();
  addHail(t, 300, 340);
  t.player = place(t, 300, 360);
  t.player.invuln = 0.5;
  tick(t, 20);
  assert.equal(t.run.hits, 0);
  tick(t, 20);
  assert.equal(t.run.hits, 1);
});

test('Hagel: im Dash und beim toten Spieler wird niemand getroffen', { skip: needsHurt }, () => {
  let s = world();
  addHail(s, 300, 340);
  place(s, 300, 360).dash.t = 0.1;
  playerVsHazards(s);
  assert.equal(s.lives, 50);
  assert.equal(hails(s).length, 1, 'im Dash fliegt das Korn weiter');

  s = world();
  addHail(s, 300, 340);
  place(s, 300, 360).dead = true;
  playerVsHazards(s);
  assert.equal(s.lives, 50);
  assert.equal(hails(s).length, 1);
});

test('Hagel: ein fallendes Korn trifft den stehenden Spieler genau einmal', { skip: needsHurt }, () => {
  const s = world();
  s.platforms.push(createStaticPlatform(s, 100, 360, 400));
  addHail(s, 300, 20, 0, 300);
  place(s, 300, 360);
  tick(s, 60 * 3);
  assert.equal(s.run.hits, 1);
  assert.equal(hails(s).length, 0);
  assert.deepEqual(s.deathCause, { kind: 'hail', label: 'Hagel' });
});

// ---------- Plattformen ----------

function platScene(y = 300) {
  const s = world();
  const plat = createStaticPlatform(s, 200, y, 300);
  s.platforms.push(plat);
  return { s, plat };
}

test('Hagel: trifft die Oberseite einer festen Plattform und verschwindet mit Staub am Auftreffpunkt', () => {
  const { s, plat } = platScene();
  addHail(s, 300, 200, 0, 300);
  let steps = 0;
  while (hails(s).length && steps++ < 600) tick(s);
  assert.equal(hails(s).length, 0);
  // Unterkante des Korns erreicht die Oberkante bei y 291
  assert.ok(Math.abs(steps * STEP * 300 + 200 - (plat.y - HAIL.R)) < 300 * STEP + 1, `nach ${steps} Schritten`);
  assert.ok(s.particles.length > 0);
  assert.ok(s.particles.every((p) => Math.abs(p.y - plat.y) < 40), 'Staub an der Plattform');
});

test('Hagel: Plattformränder (Kreis berührt die Kante knapp) und weit daneben', () => {
  const { s } = platScene();
  const inside = addHail(s, 200 + 5, 200, 0, 300);
  const edgeIn = addHail(s, 200 - HAIL.R + 1, 200, 0, 300);
  const edgeOut = addHail(s, 200 - HAIL.R - 1, 200, 0, 300);
  const rightIn = addHail(s, 500 + HAIL.R - 1, 200, 0, 300);
  const rightOut = addHail(s, 500 + HAIL.R + 1, 200, 0, 300);
  tick(s, 30); // 150 px weiter: die Oberkante der Plattform (y 300) ist passiert
  const left = hails(s).map((h) => h.id);
  assert.ok(!left.includes(inside.id) && !left.includes(edgeIn.id) && !left.includes(rightIn.id), 'Treffer verschwinden');
  assert.ok(left.includes(edgeOut.id) && left.includes(rightOut.id), 'Körner daneben fliegen vorbei');
});

test('Hagel: Plattformen sind einseitig, von unten oder aus dem Inneren fliegt es hindurch', () => {
  const { s, plat } = platScene();
  const up = addHail(s, 300, 400, 0, -200); // von unten nach oben durch die Plattform
  const inner = addHail(s, 350, plat.y + 6, 0, 200); // startet schon unter der Oberkante
  tick(s, 60);
  assert.ok(hails(s).includes(up), 'von unten kein Kontakt');
  assert.ok(up.y < plat.y - 50, 'es ist oben angekommen');
  assert.ok(hails(s).includes(inner) || inner.y > H, 'aus dem Inneren kein Kontakt');
  assert.ok(inner.y > plat.y + 100);
});

test('Hagel: Kontakt gibt es auch bei sehr großen Schritten (kein Durchfliegen von oben)', () => {
  for (const dt of [0.1, 0.25, 0.5]) {
    const { s } = platScene();
    addHail(s, 300, 150, 0, 600);
    tick(s, Math.ceil(1.5 / dt), dt);
    assert.equal(hails(s).length, 0, `dt ${dt}`);
  }
});

test('Hagel: unsichtbare Blinkwolken und zerbrochene brüchige Plattformen lassen es durch, feste halten es auf', () => {
  const s = world();
  const blink = createBlinkPlatform(s, 100, 300, 200, { period: 4, on: 0.5, phase: 0 }); // fest 0 bis 2 s
  const brk = createBreakablePlatform(s, 400, 300, 200);
  s.platforms.push(blink, brk);
  brk.state = 'broken';
  // Beide sind jetzt im Takt bzw. Zustand nicht fest: blink wird bei t 2,5 weg
  s.t = 2.5;
  updatePlatforms(s, STEP);
  assert.equal(blink.solid, false);
  const a = addHail(s, 200, 200, 0, 300);
  const b = addHail(s, 500, 200, 0, 300);
  tick(s, 40);
  assert.ok(a.y > 300 + 20 && b.y > 300 + 20, 'beide fliegen durch');
  assert.equal(hails(s).length, 2);

  // Feste Blinkwolke und intakte brüchige Plattform halten es auf
  const t = world();
  const blink2 = createBlinkPlatform(t, 100, 300, 200, { period: 4, on: 0.5, phase: 0 });
  const brk2 = createBreakablePlatform(t, 400, 300, 200);
  t.platforms.push(blink2, brk2);
  addHail(t, 200, 200, 0, 300);
  addHail(t, 500, 200, 0, 300);
  tick(t, 40);
  assert.equal(hails(t).length, 0);
});

test('Hagel: eine Blinkwolke, die unter ihm fest wird, fängt es nicht rückwirkend ab', () => {
  // Das Korn ist beim Festwerden schon unter der Oberkante: einseitig, kein Kontakt
  const s = world();
  const blink = createBlinkPlatform(s, 100, 300, 200, { period: 4, on: 0.5, phase: 0 });
  s.platforms.push(blink);
  s.t = 2.5;
  updatePlatforms(s, STEP);
  const h = addHail(s, 200, 305, 0, 5);
  s.t = 3.9;
  tick(s, 12); // t 4,1: wieder fest
  assert.equal(blink.solid, true);
  assert.ok(hails(s).includes(h), 'nicht von der Plattform erfasst');
});

test('Hagel: eine bewegliche Plattform, die von unten hochfährt und das Korn erreicht, nimmt es mit Staub weg', () => {
  const s = world();
  const m = createMovingPlatform(s, 300, 330, 200, { ax: 0, ay: 60, period: 4 });
  s.platforms.push(m);
  tick(s, 1); // Plattform ist an ihrem Platz
  const h = addHail(s, 400, 270); // schwebt über der Bahn
  h.life = 99;
  let steps = 0;
  while (hails(s).length && steps++ < 60 * 8) tick(s);
  assert.equal(hails(s).length, 0, 'irgendwann erreicht ihn die Plattform von unten und die Oberseite berührt ihn');
});

test('Hagel: verschwundene Körner nehmen andere Hindernisse nicht mit, die Reihenfolge bleibt', () => {
  const { s, plat } = platScene();
  const spike = createSpike(s, plat, 0.9);
  const lightning = createLightning(s, 4000, { idle: 1 });
  const comet = createComet(s, 4500, 360);
  s.hazards.push(spike);
  addHail(s, 300, 200, 0, 300);
  s.hazards.push(lightning);
  addHail(s, 350, 250, 0, 300);
  s.hazards.push(comet);
  const stay = addHail(s, 450, 600, 0, 0);
  stay.life = 99;
  tick(s, 60);
  assert.deepEqual(s.hazards.map((h) => h.kind), ['spike', 'lightning', 'comet'], 'Körner weg, Rest in Ordnung');
  assert.equal(s.hazards[0].id, spike.id);
});

// ---------- destroyHail ----------

test('destroyHail: entfernt Körner im Radius, zählt sie, lässt Fernes und andere Hindernisse stehen', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 300, 3000);
  s.platforms.push(plat);
  const spike = createSpike(s, plat, 0.1);
  s.hazards.push(spike);
  const near1 = addHail(s, 300, 200);
  const near2 = addHail(s, 340, 230);
  const far = addHail(s, 600, 200);
  const light = createLightning(s, 310, { idle: 1 });
  s.hazards.push(light);
  const n = destroyHail(s, 300, 200, 60);
  assert.equal(n, 2);
  const ids = s.hazards.map((h) => h.id);
  assert.deepEqual(ids, [spike.id, far.id, light.id], 'Reihenfolge bleibt, andere Arten bleiben');
  assert.ok(!s.hazards.includes(near1) && !s.hazards.includes(near2));
  assert.equal(destroyHail(s, 300, 200, 60), 0, 'zweiter Aufruf findet nichts mehr');
  assert.ok(s.particles.length > 0, 'poof');
});

test('destroyHail: ein Korn zählt, sobald sein Kreis den Radius berührt (Abstand bis r plus HAIL.R)', () => {
  const s = world();
  const inside = addHail(s, 100 + 50 + HAIL.R - 0.01, 0);
  const outside = addHail(s, 100 + 50 + HAIL.R + 0.01, 0);
  assert.equal(destroyHail(s, 100, 0, 50), 1);
  assert.deepEqual(s.hazards.map((h) => h.id), [outside.id]);
  assert.ok(!s.hazards.includes(inside));
  // Radius 0 trifft nur ein Korn, dessen Mitte nahe genug liegt
  assert.equal(destroyHail(s, 0, 0, 0), 0);
  const mid = addHail(s, 3, 4);
  assert.equal(destroyHail(s, 0, 0, 0), 1, `Abstand 5 < ${HAIL.R}`);
  assert.ok(!s.hazards.includes(mid));
});

test('destroyHail: Eingaben, die keinen Sinn ergeben, ändern nichts', () => {
  const s = world();
  addHail(s, 100, 100);
  assert.equal(destroyHail(s, NaN, 100, 50), 0);
  assert.equal(destroyHail(s, 100, undefined, 50), 0);
  assert.equal(destroyHail(s, 100, 100, NaN), 0);
  assert.equal(destroyHail(s, 100, 100, -5), 0);
  assert.equal(destroyHail(s, 100, 100, Infinity), 0);
  assert.equal(destroyHail(null, 1, 1, 1), 0);
  assert.equal(destroyHail({}, 1, 1, 1), 0);
  assert.equal(hails(s).length, 1);
  const leer = world();
  assert.equal(destroyHail(leer, 1, 1, 100), 0);
});

test('destroyHail: viele Körner auf einmal, höchstens wenige Staubwölkchen, Zahl stimmt', () => {
  const s = world();
  for (let i = 0; i < LIMITS.MAX_HAZARDS; i++) addHail(s, 300 + (i % 6) * 10, 200 + Math.floor(i / 6) * 10);
  const n = destroyHail(s, 320, 210, 112); // Radius der Schockwelle
  assert.equal(n, LIMITS.MAX_HAZARDS);
  assert.equal(s.hazards.length, 0);
  assert.ok(s.particles.length > 0 && s.particles.length <= LIMITS.MAX_PARTICLES);
});

// ---------- clearHazardsNear ----------

test('clearHazardsNear entfernt Hagel im Bereich und lässt die anderen stehen', () => {
  const s = world();
  const a = addHail(s, 100, 200);
  const b = addHail(s, 600, 200);
  const c = addHail(s, 1200, 200);
  clearHazardsNear(s, 500, 800);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id, c.id]);
  assert.ok(!s.hazards.includes(b));
  assert.ok(s.particles.length > 0);
  // Randfälle: der Kreis berührt den Bereich nur
  clearHazardsNear(s, 1200 + HAIL.R, 1500);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id]);
  clearHazardsNear(s, 100 - 50, 100 - HAIL.R - 0.5);
  assert.deepEqual(s.hazards.map((h) => h.id), [a.id], 'knapp daneben');
  clearHazardsNear(s, 300, 100); // vertauscht
  assert.equal(s.hazards.length, 0);
});

test('clearHazardsNear: Hagel, Kometen, Blitze und Stachelwolken gemischt, NaN und leere Liste', () => {
  const s = world();
  const plat = createStaticPlatform(s, 0, 300, 3000);
  s.platforms.push(plat);
  const spike = createSpike(s, plat, 0.2);
  const comet = createComet(s, spike.x + 100, 300, { idle: 1 });
  const lightning = createLightning(s, spike.x + 200, { idle: 1 });
  s.hazards.push(spike, comet, lightning);
  addHail(s, spike.x + 150, 100);
  addHail(s, 2900, 100);
  comet.phase = 'warn';
  lightning.phase = 'glow';
  clearHazardsNear(s, NaN, 100);
  clearHazardsNear(s, 0, Infinity);
  assert.equal(s.hazards.length, 5);
  clearHazardsNear(s, spike.x - 10, spike.x + 400);
  assert.deepEqual(s.hazards.map((h) => h.kind), ['comet', 'lightning', 'hail']);
  assert.equal(comet.phase, 'idle');
  assert.equal(lightning.phase, 'idle');
  clearHazardsNear(world(), 0, 100); // leere Liste wirft nicht
});

// ---------- Zusammenspiel ----------

test('Hagel: verbraucht weder s.rng noch verändert es das Spiel zufällig, zwei Läufe sind gleich', () => {
  const make = () => {
    const s = world();
    s.platforms.push(createStaticPlatform(s, 0, 360, 2000));
    for (let i = 0; i < 8; i++) addHail(s, 100 + i * 90, 20 + i * 3, (i - 4) * 30, 200 + i * 15);
    return s;
  };
  const a = make();
  const b = make();
  const rng = a.rng;
  tick(a, 60 * 4);
  tick(b, 60 * 4);
  assert.equal(a.rng, rng);
  assert.deepEqual(a.hazards, b.hazards);
  assert.deepEqual(a.particles, b.particles);
  assert.deepEqual(structuredClone(a.hazards), a.hazards);
});

test('sim: ein Hagelfächer über dem Start verschwindet, ohne den Zustand zu verderben', () => {
  const s = newGame(4);
  s.hazards.length = 0;
  s.enemies.length = 0;
  for (let i = 0; i < 20; i++) stepSim(s, input());
  const p = s.player;
  for (let k = -1; k <= 1; k++) s.hazards.push(createHail(s, p.x + 200 + k * 60, 40, k * 90, 300));
  p.invuln = 99; // der Fächer soll sichtbar fallen, nicht den Test beenden
  let maxHail = 0;
  for (let i = 0; i < 60 * 5; i++) {
    stepSim(s, input());
    maxHail = Math.max(maxHail, hails(s).length);
  }
  assert.equal(maxHail, 3);
  assert.equal(hails(s).length, 0, 'alle Körner sind auf Plattformen gefallen oder aus dem Bild');
  assert.deepEqual(invariants(s), []);
});

test('Hagel zählt zu LIMITS.MAX_HAZARDS: die Schrittfunktion hält die Liste ohne Wachstum', () => {
  const s = world();
  s.platforms.push(createStaticPlatform(s, 0, 360, 2000));
  for (let i = 0; i < LIMITS.MAX_HAZARDS; i++) addHail(s, 100 + i * 40, 10, 0, 100 + i * 5);
  assert.equal(s.hazards.length, LIMITS.MAX_HAZARDS);
  const lengths = [];
  for (let i = 0; i < 300; i++) {
    tick(s);
    lengths.push(s.hazards.length);
  }
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] <= lengths[i - 1], 'die Liste wächst nie');
  assert.equal(s.hazards.length, 0);
  assert.deepEqual(invariants(s), []);
});

// ---------- Kaputte Daten und Fuzz ----------

test('Fuzz: kaputte Hagelkörner werfen nichts und werden aufgeräumt oder repariert', () => {
  const s = world();
  s.hazards.push(
    { ...createHail(s, NaN, 100, 0, 100) },
    { ...createHail(s, 100, NaN, 0, 100) },
    { ...createHail(s, 100, 100, NaN, 100) },
    { ...createHail(s, 100, 100, 50, NaN) },
    { ...createHail(s, 100, 100, 0, 0), life: NaN },
    { ...createHail(s, 100, 100, 0, 0), anim: NaN },
    { ...createHail(s, 100, 100, Infinity, 0) },
  );
  place(s, 320, 360);
  tick(s, 600);
  for (const h of hails(s)) assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.life) && Number.isFinite(h.anim));
  assert.equal(hails(s).length, 0, 'nach Ablauf der Zeit ist alles weg');
  for (const dt of [0, -1, NaN, undefined]) {
    const h = addHail(s, 200, 200, 10, 10);
    const before = JSON.stringify(h);
    updateObstacles(s, dt);
    assert.equal(JSON.stringify(h), before, `dt ${dt}`);
    s.hazards.length = 0;
  }
  s.camX = NaN;
  addHail(s, 200, 200, 10, 10);
  updateObstacles(s, STEP);
  playerVsHazards(s);
  assert.ok(Number.isFinite(s.hazards[0] ? s.hazards[0].x : 0));
});

// Gibt es zum Treffer einen sichtbaren Grund (ein Korn, dessen Kreis den Spieler berührt)?
function hailCause(s, hailsBefore) {
  const p = s.player;
  const px0 = p.x + 4;
  const px1 = p.x + p.w - 4;
  const py0 = p.y + 4;
  const py1 = p.y + p.h - 4;
  for (const h of hailsBefore) {
    const dx = Math.min(px1, Math.max(px0, h.x)) - h.x;
    const dy = Math.min(py1, Math.max(py0, h.y)) - h.y;
    if (dx * dx + dy * dy < R_HIT * R_HIT) return true;
  }
  return false;
}

test('Fuzz: zufällige Hagelwelten, Kamerasprünge und Schrittweiten erzeugen nie NaN und nie unerklärliche Treffer', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = { rng: seed };
    const s = world({ seed });
    s.lives = 999;
    for (let i = 0; i < 5; i++) {
      s.platforms.push(rand(r) < 0.3
        ? createMovingPlatform(s, i * 400 + 200, range(r, 250, 380), range(r, 150, 260), { ax: range(r, 0, 100), ay: range(r, 0, 60), period: range(r, 2.2, 5), phase: range(r, 0, 6) })
        : rand(r) < 0.5
          ? createBlinkPlatform(s, i * 400, range(r, 250, 380), range(r, 100, 250), { period: range(r, 3.4, 4.4), phase: rand(r) })
          : createStaticPlatform(s, i * 400, range(r, 250, 380), range(r, 160, 400)));
    }
    const p = s.player;
    for (let i = 0; i < 1200; i++) {
      const roll = rand(r);
      const dt = roll < 0.85 ? STEP : roll < 0.9 ? 0 : roll < 0.95 ? 0.05 : 0.1;
      if (rand(r) < 0.01) s.camX = range(r, -200, 2500);
      else s.camX += 4;
      // neue Körner, solange Platz ist
      while (s.hazards.length < LIMITS.MAX_HAZARDS && rand(r) < 0.35) {
        addHail(s, s.camX + range(r, -100, W + 300), range(r, -20, 200), range(r, -150, 150), range(r, 100, 400));
      }
      p.x = s.camX + range(r, 0, W);
      p.y = range(r, 0, H);
      p.invuln = rand(r) < 0.3 ? 0 : p.invuln;
      const hits = s.run.hits;
      s.t += dt;
      s.player.invuln = Math.max(0, s.player.invuln - dt);
      updatePlatforms(s, dt);
      updateObstacles(s, dt);
      const afterUpdate = hails(s).map((h) => ({ x: h.x, y: h.y }));
      playerVsHazards(s);
      if (s.run.hits !== hits) assert.ok(hailCause(s, afterUpdate), `Seed ${seed} Schritt ${i}: Treffer ohne Ursache`);
      if (rand(r) < 0.01) destroyHail(s, p.x, p.y, range(r, 0, 150));
      if (rand(r) < 0.01) clearHazardsNear(s, p.x - 260, p.x + p.w + 420);
      for (const h of hails(s)) {
        assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && h.life > 0 && h.life <= HAIL.LIFE + EPS);
        assert.ok(h.y <= H + 40 + 600 * 0.1 + 1, 'unter dem Bild wird aufgeräumt');
      }
      assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS);
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});

test('Fuzz: Spiel mit Hagelfächern läuft stabil, Hagelschäden gibt es nur bei Berührung', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = newGame(seed);
    s.lives = 99;
    let prevHits = 0;
    for (let i = 0; i < 60 * 12; i++) {
      if (i % 50 === 0 && s.hazards.length < LIMITS.MAX_HAZARDS - 3) {
        const x = s.player.x + 120 + (i % 7) * 25;
        for (let k = -1; k <= 1; k++) s.hazards.push(createHail(s, x, 20, k * 80, 290));
      }
      stepSim(s, input({ move: i % 200 < 140 ? 1 : -1, jumpPressed: i % 37 === 0, jumpHeld: i % 37 < 22 }));
      if (s.run.hits > prevHits && s.deathCause && s.deathCause.kind === 'hail') {
        assert.equal(s.deathCause.label, 'Hagel');
      }
      prevHits = s.run.hits;
      assert.ok(s.hazards.length <= LIMITS.MAX_HAZARDS + 3);
    }
    assert.deepEqual(invariants(s).filter((e) => !e.startsWith('zu viele Hindernisse')), [], `Seed ${seed}`);
  }
});
