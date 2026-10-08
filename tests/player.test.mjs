import test from 'node:test';
import assert from 'node:assert/strict';
import { KILL_Y, MAX_LIVES, PHYS, STEP, W } from '../game/constants.js';
import {
  createBreakablePlatform, createLightning, createMovingPlatform, createRain, createSpike,
  createStaticPlatform, createWalker, createWind,
} from '../game/entities.js';
import { clearEnemiesNear } from '../game/enemies.js';
import { clearHazardsNear, rainAt, windAt } from '../game/obstacles.js';
import { bouncePlayer, hurtPlayer, respawnPlayer, updatePlayer } from '../game/player.js';
import { isSolid, updatePlatforms } from '../game/platforms.js';
import { airTime, hopRatio, maxGap, maxRise } from '../game/reach.js';
import { createState } from '../game/state.js';
import { stepSim } from '../game/sim.js';
import { input, invariants, newGame } from './helpers.mjs';

const GROUND_Y = 360;
const MOVE = PHYS.MOVE_SPEED;

// ---------- Hilfen ----------

// Leere Welt mit weit links stehender Kamera, damit der linke Rand nicht stört
function world() {
  const s = createState({ seed: 1 });
  s.camX = -5000;
  return s;
}

function addGround(s, x = -3000, w = 6000, y = GROUND_Y) {
  const g = createStaticPlatform(s, x, y, w, { ground: true });
  s.platforms.push(g);
  return g;
}

// Ein Schritt wie in sim.js (ohne Gegner, Generator und Kamera)
function tick(s, inp = input()) {
  s.t += STEP;
  s.realT += STEP;
  updatePlatforms(s, STEP);
  updatePlayer(s, inp, STEP);
}

function ticks(s, n, inp = input()) {
  for (let i = 0; i < n; i++) tick(s, typeof inp === 'function' ? inp(i) : inp);
}

function standOn(s, plat, x) {
  const p = s.player;
  p.x = x;
  p.y = plat.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true; // gilt als schon stehend, damit bewegliche Plattformen ihn gleich mitnehmen
  p.groundId = plat.id;
  tick(s);
  assert.equal(p.onGround, true, 'steht nach dem Aufsetzen');
  assert.equal(p.groundId, plat.id);
  return p;
}

// Lässt den Spieler wirklich von oben landen (wichtig für brüchige Plattformen)
function dropOnto(s, plat, x) {
  const p = s.player;
  p.x = x;
  p.y = plat.y - p.h - 12;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.groundId = 0;
  for (let i = 0; i < 30 && !p.onGround; i++) tick(s);
  assert.equal(p.onGround, true, 'gelandet');
  return p;
}

const bottom = (p) => p.y + p.h;

// Eine Sprungbahn mit gehaltener Taste, gibt den höchsten Punkt (Anstieg in px) zurück
function peakRise(s, firstHeld = true) {
  const p = s.player;
  const y0 = p.y;
  let minY = y0;
  tick(s, input({ jumpPressed: true, jumpHeld: firstHeld }));
  for (let i = 0; i < 90; i++) {
    tick(s, input({ jumpHeld: firstHeld }));
    minY = Math.min(minY, p.y);
  }
  return y0 - minY;
}

// ---------- Bewegung ----------

test('Beschleunigung: volles Tempo nach etwa 0,1 s, nicht sofort, und knackiges Bremsen', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ move: 1 }));
  assert.ok(p.vx > 0 && p.vx < 0.4 * MOVE, `nach einem Schritt ${p.vx}`);
  let frames = 1;
  while (p.vx < MOVE && frames < 60) {
    tick(s, input({ move: 1 }));
    frames++;
  }
  assert.ok(frames * STEP >= 0.06 && frames * STEP <= 0.12, `Beschleunigung dauert ${frames * STEP} s`);
  assert.equal(p.vx, MOVE);

  const x0 = p.x;
  let f = 0;
  while (p.vx > 0 && f < 60) {
    tick(s);
    f++;
  }
  assert.ok(f * STEP <= 0.12, `Bremsen dauert ${f * STEP} s`);
  assert.ok(p.x - x0 < 20, 'kurzer Bremsweg');

  // Umkehr in der Bewegung
  ticks(s, 10, input({ move: 1 }));
  let g2 = 0;
  while (p.vx > -MOVE && g2 < 60) {
    tick(s, input({ move: -1 }));
    g2++;
  }
  assert.ok(g2 * STEP <= 0.2, `Umkehr dauert ${g2 * STEP} s`);
  assert.equal(p.face, -1);
});

test('in der Luft wirkt AIR_ACCEL und AIR_DECEL, der Schwung bleibt etwas erhalten', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  ticks(s, 12, input({ move: 1 }));
  tick(s, input({ move: 1, jumpPressed: true, jumpHeld: true }));
  assert.equal(p.onGround, false);
  const v0 = p.vx;
  tick(s, input({ jumpHeld: true }));
  assert.ok(Math.abs(v0 - p.vx - PHYS.AIR_DECEL * STEP) < 1e-6, 'Luftbremse');
  assert.ok(p.vx > 0);
});

// ---------- Sprünge und reach.js ----------

test('Sprunghöhe 121,7 px, Doppelsprung passt zu reach.js', () => {
  const s = world();
  const g = addGround(s);
  standOn(s, g, 0);
  const rise = peakRise(s);
  assert.ok(Math.abs(rise - 121.7) < 1.5, `Sprunghöhe ${rise}`);
  assert.ok(Math.abs(rise / maxRise(false) - 1) < 0.04);

  // Doppelsprung im höchsten Punkt der ersten Bahn
  const s2 = world();
  const g2 = addGround(s2);
  const p = standOn(s2, g2, 0);
  const y0 = p.y;
  let minY = y0;
  tick(s2, input({ jumpPressed: true, jumpHeld: true }));
  let pressed = false;
  for (let i = 0; i < 120; i++) {
    const press = !pressed && p.vy > -25;
    if (press) pressed = true;
    tick(s2, input({ jumpPressed: press, jumpHeld: true }));
    minY = Math.min(minY, p.y);
  }
  assert.ok(pressed);
  const total = y0 - minY;
  assert.ok(Math.abs(total / maxRise(true) - 1) < 0.04, `Doppelsprung gesamt ${total}, reach ${maxRise(true)}`);
});

// Versucht einen Sprung von der Kante auf eine Plattform, die gap weiter rechts und dy tiefer liegt.
// Gibt true zurück, wenn der Spieler auf der Zielplattform landet.
function crossing(gap, dy, { phase = 0, secondAt = -1 } = {}) {
  const s = world();
  const A = createStaticPlatform(s, -4000, GROUND_Y, 4000, { ground: true }); // rechte Kante bei 0
  const B = createStaticPlatform(s, gap, GROUND_Y + dy, 4000, { ground: true });
  s.platforms.push(A, B);
  const p = s.player;
  p.x = -900 + phase;
  p.y = GROUND_Y - p.h;
  p.vx = MOVE;
  tick(s, input({ move: 1, jumpHeld: true }));
  let jumpedAt = -1;
  for (let i = 0; i < 400; i++) {
    const inp = input({ move: 1, jumpHeld: true });
    if (jumpedAt < 0 && p.onGround && p.x + p.vx * STEP >= 0) {
      inp.jumpPressed = true; // letzter Schritt mit Boden unter den Füßen
      jumpedAt = i;
    } else if (jumpedAt >= 0 && secondAt >= 0 && i - jumpedAt === secondAt && p.jumps === 1) {
      inp.jumpPressed = true;
    }
    tick(s, inp);
    if (jumpedAt >= 0 && p.onGround) return p.groundId === B.id;
    if (p.y > KILL_Y) return false;
  }
  return false;
}

function bestCrossing(gap, dy, dbl) {
  for (let phase = 0; phase < 5; phase++) {
    if (!dbl) {
      if (crossing(gap, dy, { phase })) return true;
    } else {
      for (let k = 5; k < 70; k += 1) if (crossing(gap, dy, { phase, secondAt: k })) return true;
    }
  }
  return false;
}

// größte machbare Lücke (Kante zu Kante) per Bisektion
function simMaxGap(dy, dbl) {
  let lo = 40;
  let hi = 700;
  assert.ok(bestCrossing(lo, dy, dbl), 'kleine Lücke muss gehen');
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bestCrossing(mid, dy, dbl)) lo = mid;
    else hi = mid;
  }
  return lo;
}

test('Sprungweite aus der Simulation passt zu reach.js (Anlauf, Sprung von der Kante)', () => {
  for (const dy of [-80, 0, 70]) {
    const simGap = simMaxGap(dy, false);
    const simRange = simGap - PHYS.W;
    const reachRange = maxGap(GROUND_Y, GROUND_Y + dy, { safe: 1 }) - PHYS.W;
    const ratio = simRange / reachRange;
    assert.ok(ratio >= 0.94 && ratio <= 1.04, `dy ${dy}: Simulation ${simRange}, reach ${reachRange}, Verhältnis ${ratio.toFixed(3)}`);
    // Der Generator rechnet mit hopRatio: die größte machbare Lücke ist dort ungefähr genau am Limit
    const hr = hopRatio({ x: -4000, y: GROUND_Y, w: 4000 }, { x: simGap, y: GROUND_Y + dy, w: 200 });
    assert.ok(hr >= 0.96 && hr <= 1.06, `dy ${dy}: hopRatio der größten machbaren Lücke ${hr.toFixed(3)}`);
  }
});

test('Weite mit Doppelsprung passt zu reach.js', () => {
  const simRange = simMaxGap(0, true) - PHYS.W;
  const reachRange = PHYS.MOVE_SPEED * airTime(0, true);
  const ratio = simRange / reachRange;
  assert.ok(ratio >= 0.94 && ratio <= 1.04, `Simulation ${simRange}, reach ${reachRange}, Verhältnis ${ratio.toFixed(3)}`);
});

test('variable Sprunghöhe: früh loslassen macht den Sprung deutlich niedriger', () => {
  const s = world();
  const g = addGround(s);
  standOn(s, g, 0);
  const full = peakRise(s, true);
  const s2 = world();
  const g2 = addGround(s2);
  standOn(s2, g2, 0);
  const tap = peakRise(s2, false);
  assert.ok(tap < full * 0.65 && tap > full * 0.3, `Tipp ${tap}, voll ${full}`);
});

test('Doppelsprung hat 0,85 fache Kraft, ein dritter Sprung gibt es nicht', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.jumps, 1);
  assert.ok(p.vy < -640);
  ticks(s, 12, input({ jumpHeld: true }));
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.jumps, 2);
  assert.ok(Math.abs(p.vy + (PHYS.DOUBLE_JUMP_SPEED - PHYS.GRAVITY * STEP)) < 1, `vy ${p.vy}`);
  assert.ok(Math.abs(PHYS.DOUBLE_JUMP_SPEED / PHYS.JUMP_SPEED - 0.85) < 1e-9);
  ticks(s, 6, input({ jumpHeld: true }));
  const before = p.vy;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.vy > before, 'kein dritter Sprung, die Schwerkraft zieht weiter');
  assert.equal(p.jumps, 2);
});

test('Traumfeder: zusätzliche Luftsprünge nach dem Doppelsprung, jeder kostet eine Ladung', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.power.feather = 2;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  ticks(s, 8, input({ jumpHeld: true }));
  // erster Luftsprung ist der normale Doppelsprung und kostet keine Feder
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.power.feather, 2);
  assert.equal(p.jumps, 2);
  ticks(s, 10, input({ jumpHeld: true }));
  // jetzt kosten weitere Sprünge Federn
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.power.feather, 1);
  assert.ok(p.vy < -540, 'Federsprung trägt nach oben');
  ticks(s, 10, input({ jumpHeld: true }));
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.power.feather, 0);
  assert.ok(p.vy < -540);
  ticks(s, 10, input({ jumpHeld: true }));
  const v = p.vy;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.vy > v, 'ohne Ladung kein weiterer Sprung');
  assert.equal(p.power.feather, 0);
});

test('Traumfeder ersetzt den Doppelsprung nicht', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.power.feather = 1;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  ticks(s, 8, input({ jumpHeld: true }));
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.power.feather, 1, 'der normale Doppelsprung kommt zuerst');
});

test('Coyote Time: kurz nach dem Verlassen der Kante gilt der Sprung noch als Bodensprung', () => {
  for (const [after, full] of [[3, true], [9, false]]) {
    const s = world();
    const A = createStaticPlatform(s, -4000, GROUND_Y, 4000, { ground: true });
    s.platforms.push(A);
    const p = s.player;
    p.x = -300;
    p.y = GROUND_Y - p.h;
    p.vx = MOVE;
    let airborne = 0;
    for (let i = 0; i < 200; i++) {
      tick(s, input({ move: 1, jumpHeld: true }));
      if (!p.onGround && i > 2) {
        airborne++;
        if (airborne === after) break;
      }
    }
    assert.equal(p.onGround, false);
    tick(s, input({ move: 1, jumpPressed: true, jumpHeld: true }));
    assert.ok(p.vy < 0, 'der Sprung wurde ausgeführt');
    if (full) {
      assert.ok(p.vy < -640, `Bodensprung ${p.vy}`);
      assert.equal(p.jumps, 1);
    } else {
      assert.ok(p.vy > -600 && p.vy < -540, `Doppelsprung ${p.vy}`);
      assert.equal(p.jumps, 2);
    }
  }
});

test('Sprungpuffer: Drücken kurz vor der Landung löst den Sprung bei der Landung aus', () => {
  for (const [pressAt, expectJump] of [[2, false], [15, true]]) {
    const s = world();
    addGround(s);
    const p = s.player;
    p.x = 0;
    p.y = GROUND_Y - p.h - 100;
    p.jumps = 2;
    let landed = false;
    let jumped = false;
    for (let i = 0; i < 60; i++) {
      tick(s, input({ jumpPressed: i === pressAt, jumpHeld: true }));
      if (p.onGround) landed = true;
      if (landed && p.vy < 0) jumped = true;
    }
    assert.ok(landed || jumped);
    assert.equal(jumped, expectJump, `Druck bei ${pressAt}`);
  }
});

test('Squash und Stretch: Sprung streckt, Landung staucht nach Aufprall, Rückkehr zu 1 in etwa 0,15 s', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.squashX < 0.9 && p.squashX >= 0.84, `squashX ${p.squashX}`);
  assert.ok(p.squashY > 1.12 && p.squashY <= 1.2, `squashY ${p.squashY}`);
  // Landung
  let landSquash = null;
  for (let i = 0; i < 90 && !landSquash; i++) {
    tick(s, input({ jumpHeld: true }));
    if (p.onGround) landSquash = { x: p.squashX, y: p.squashY };
  }
  assert.ok(landSquash.x > 1.1 && landSquash.x <= 1.25, `Landung x ${landSquash.x}`);
  assert.ok(landSquash.y < 0.9 && landSquash.y >= 0.75, `Landung y ${landSquash.y}`);
  ticks(s, 9); // 0,15 s
  assert.ok(Math.abs(p.squashX - 1) < 0.03 && Math.abs(p.squashY - 1) < 0.03, `nach 0,15 s ${p.squashX}, ${p.squashY}`);
  ticks(s, 30);
  assert.ok(Math.abs(p.squashX - 1) < 1e-3);

  // Aufprallstärke: hoher Fall staucht stärker als ein kleiner Hüpfer
  const hop = world();
  const gh = addGround(hop);
  const ph = hop.player;
  ph.x = 0;
  ph.y = gh.y - ph.h - 8;
  let sq = null;
  for (let i = 0; i < 30 && !sq; i++) {
    tick(hop);
    if (ph.onGround) sq = ph.squashX;
  }
  assert.ok(sq < landSquash.x, 'kleiner Fall staucht weniger');
  const big = world();
  const gb = addGround(big);
  const pb = big.player;
  pb.x = 0;
  pb.y = gb.y - pb.h - 1500;
  let sqb = null;
  for (let i = 0; i < 200 && !sqb; i++) {
    tick(big);
    if (pb.onGround) sqb = { x: pb.squashX, y: pb.squashY };
  }
  assert.ok(Math.abs(sqb.x - 1.25) < 1e-6 && Math.abs(sqb.y - 0.75) < 1e-6, 'maximaler Aufprall gibt 1,25 und 0,75');
});

test('bouncePlayer: Abprall nach oben, Doppelsprung bleibt möglich', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.y = GROUND_Y - p.h - 40;
  p.vy = 300;
  p.jumps = 2;
  p.onGround = false;
  bouncePlayer(s, PHYS.STOMP_BOUNCE_HELD);
  assert.equal(p.vy, -PHYS.STOMP_BOUNCE_HELD);
  assert.equal(p.onGround, false);
  assert.equal(p.jumps, 1);
  assert.ok(p.squashY > 1.1);
  const y0 = p.y;
  let minY = y0;
  for (let i = 0; i < 90; i++) {
    tick(s, input({ jumpHeld: true }));
    minY = Math.min(minY, p.y);
  }
  assert.ok(Math.abs((y0 - minY) / ((PHYS.STOMP_BOUNCE_HELD ** 2) / (2 * PHYS.GRAVITY)) - 1) < 0.05);
  // jumps war 0: bleibt 0
  p.jumps = 0;
  bouncePlayer(s, NaN);
  assert.equal(p.vy, -PHYS.STOMP_BOUNCE);
  assert.equal(p.jumps, 0);
});

// ---------- Plattformen ----------

test('Landung nur von oben: von unten springt der Spieler durch die Plattform', () => {
  const s = world();
  const low = addGround(s);
  const high = createStaticPlatform(s, -100, GROUND_Y - 80, 300);
  s.platforms.push(high);
  const p = standOn(s, low, 0);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  let landedOnHigh = false;
  for (let i = 0; i < 100; i++) {
    tick(s, input({ jumpHeld: true }));
    if (p.onGround && p.groundId === high.id) landedOnHigh = true;
    if (p.vy < 0) assert.equal(p.onGround, false, 'beim Aufsteigen nie Boden');
  }
  assert.ok(landedOnHigh, 'nach dem Durchfliegen von unten landet er oben');
});

test('bewegliche Plattform trägt den Spieler waagerecht in beide Richtungen', () => {
  const s = world();
  const m = createMovingPlatform(s, 0, 300, 200, { ax: 150, period: 4 });
  s.platforms.push(m);
  tick(s);
  const p = standOn(s, m, m.x + 78);
  const off = p.x - m.x;
  let left = false;
  let right = false;
  for (let i = 0; i < 60 * 9; i++) {
    tick(s);
    assert.equal(p.onGround, true);
    assert.equal(p.groundId, m.id);
    assert.ok(Math.abs(p.x - m.x - off) < 1e-6, `Versatz ${p.x - m.x - off}`);
    assert.ok(Math.abs(bottom(p) - m.y) < 1e-6);
    if (m.dx < -0.5) left = true;
    if (m.dx > 0.5) right = true;
  }
  assert.ok(left && right, 'beide Richtungen kamen vor');
});

test('senkrechte Plattform trägt den Spieler auch nach unten, ohne dass er abhebt', () => {
  for (const [ay, period] of [[120, 3], [200, 1.2]]) {
    const s = world();
    const m = createMovingPlatform(s, 100, 280, 160, { ay, period });
    s.platforms.push(m);
    tick(s);
    const p = standOn(s, m, m.x + 60);
    let down = false;
    let up = false;
    for (let i = 0; i < 60 * 8; i++) {
      tick(s);
      assert.equal(p.onGround, true, `Schritt ${i}, Plattform dy ${m.dy}`);
      assert.equal(p.groundId, m.id);
      assert.ok(Math.abs(bottom(p) - m.y) < 1e-6);
      if (m.dy > 0.5) down = true;
      if (m.dy < -0.5) up = true;
    }
    assert.ok(down && up);
  }
});

test('Springen von einer sinkenden Plattform funktioniert wie sonst', () => {
  const s = world();
  const m = createMovingPlatform(s, 100, 280, 160, { ay: 100, period: 3 });
  s.platforms.push(m);
  tick(s);
  const p = standOn(s, m, m.x + 60);
  ticks(s, 5);
  assert.ok(m.dy > 0, 'Plattform sinkt');
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.onGround, false);
  assert.equal(p.groundId, 0);
  assert.ok(p.vy < -640);
});

test('Wechsel zwischen Plattformen führt groundId richtig: gehen über Nachbarn', () => {
  const s = world();
  const A = createStaticPlatform(s, 0, GROUND_Y, 200);
  const B = createStaticPlatform(s, 200, GROUND_Y, 200);
  s.platforms.push(A, B);
  const p = standOn(s, A, 20);
  const seq = [];
  for (let i = 0; i < 60; i++) {
    tick(s, input({ move: 1 }));
    assert.equal(p.onGround, true, 'kein Abheben an der Nahtstelle');
    if (seq[seq.length - 1] !== p.groundId) seq.push(p.groundId);
  }
  assert.deepEqual(seq, [A.id, B.id]);
});

test('Wechsel von einer beweglichen Plattform auf die nächste per Sprung', () => {
  const s = world();
  const A = createMovingPlatform(s, 0, 320, 200, { ay: 30, period: 4, phase: 0 });
  const B = createMovingPlatform(s, 300, 320, 200, { ay: 30, period: 4, phase: Math.PI });
  s.platforms.push(A, B);
  tick(s);
  const p = standOn(s, A, 40);
  const seq = [A.id];
  let jumped = false;
  for (let i = 0; i < 200; i++) {
    const inp = input({ move: 1, jumpHeld: true });
    if (!jumped && p.onGround && p.x + p.vx * STEP >= A.x + A.w - 6) {
      inp.jumpPressed = true;
      jumped = true;
    }
    tick(s, inp);
    if (p.onGround && seq[seq.length - 1] !== p.groundId) seq.push(p.groundId);
    if (seq.length === 2) break;
  }
  assert.deepEqual(seq, [A.id, B.id]);
  // danach wird er von B getragen
  for (let i = 0; i < 100; i++) {
    tick(s);
    assert.equal(p.groundId, B.id);
    assert.ok(Math.abs(bottom(p) - B.y) < 1e-6);
  }
});

test('beim Hinübergehen auf eine brüchige Nachbarplattform wird sie scharf', () => {
  const s = world();
  const A = createStaticPlatform(s, 0, GROUND_Y, 200);
  const B = createBreakablePlatform(s, 200, GROUND_Y, 200);
  s.platforms.push(A, B);
  const p = standOn(s, A, 20);
  assert.equal(B.state, 'idle');
  for (let i = 0; i < 40; i++) tick(s, input({ move: 1 }));
  assert.equal(p.groundId, B.id);
  assert.notEqual(B.state, 'idle');
});

test('brüchige Plattform: Spieler fällt nach dem Bruch, Coyote läuft normal ab', () => {
  const s = world();
  const B = createBreakablePlatform(s, 0, GROUND_Y, 300);
  s.platforms.push(B);
  const p = dropOnto(s, B, 100);
  assert.equal(B.state, 'armed');
  let frames = 0;
  while (B.state !== 'broken' && frames < 100) {
    tick(s);
    frames++;
    if (B.state !== 'broken') assert.equal(p.onGround, true, 'bis zum Bruch trägt sie');
  }
  assert.ok(Math.abs(frames * STEP - 0.8) < 3 * STEP, `Bruch nach ${frames * STEP} s`);
  assert.equal(isSolid(B), false);
  // In dem Schritt, in dem sie bricht, steht der Spieler schon nicht mehr
  assert.equal(p.onGround, false);
  assert.equal(p.groundId, 0);
  assert.equal(p.coyote, PHYS.COYOTE, 'das Fenster beginnt jetzt');
  const yBreak = p.y;
  tick(s);
  tick(s);
  assert.ok(p.coyote > 0 && p.coyote < PHYS.COYOTE, `Coyote ${p.coyote}`);
  ticks(s, 8);
  assert.ok(p.y > yBreak + 30, 'er fällt');
  assert.equal(p.coyote, 0, 'Coyote ist abgelaufen');

  // Im Coyote Fenster ist noch ein Bodensprung möglich
  const s2 = world();
  const B2 = createBreakablePlatform(s2, 0, GROUND_Y, 300);
  s2.platforms.push(B2);
  const p2 = dropOnto(s2, B2, 100);
  while (B2.state !== 'broken') tick(s2);
  tick(s2, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p2.vy < -640, `Bodensprung im Coyote Fenster ${p2.vy}`);
});

test('Spieler fällt nach dem Bruch in den Abgrund, verliert ein Leben und landet auf sicherem Boden', () => {
  const s = world();
  const B = createBreakablePlatform(s, 0, GROUND_Y, 300);
  const safe = createStaticPlatform(s, 900, GROUND_Y, 600, { ground: true });
  s.platforms.push(B, safe);
  s.camX = 200;
  const p = dropOnto(s, B, 250);
  for (let i = 0; i < 400 && s.lives === MAX_LIVES; i++) tick(s);
  assert.equal(s.lives, MAX_LIVES - 1);
  assert.equal(p.groundId, safe.id);
  assert.equal(p.onGround, true);
  assert.deepEqual(s.deathCause, { kind: 'fall', label: 'In den Abgrund gefallen' });
  assert.equal(s.mode, 'playing');
});

// ---------- Schaden ----------

test('hurtPlayer ignoriert tote, unverwundbare und dashende Spieler', () => {
  const src = { kind: 'enemy', label: 'Hüpfer', x: 0, y: 0 };
  const s = createState({ seed: 1 });
  s.player.invuln = 0.5;
  assert.equal(hurtPlayer(s, src), 'ignored');
  s.player.invuln = 0;
  s.player.dash.t = 0.1;
  assert.equal(hurtPlayer(s, src), 'ignored');
  s.player.dash.t = 0;
  s.player.dead = true;
  assert.equal(hurtPlayer(s, src), 'ignored');
  assert.equal(s.lives, MAX_LIVES);
});

test('hurtPlayer mit Schild: absorbiert, kurze Unverwundbarkeit, kein Lebensverlust', () => {
  const s = createState({ seed: 1 });
  s.player.power.shield = true;
  s.combo.count = 3;
  assert.equal(hurtPlayer(s, { kind: 'spike', label: 'Stachelwolke', x: 100, y: 300 }), 'absorbed');
  assert.equal(s.player.power.shield, false);
  assert.equal(s.player.invuln, PHYS.INVULN_SHIELD);
  assert.equal(s.lives, MAX_LIVES);
  assert.equal(s.run.hits, 0);
  assert.equal(s.combo.count, 3);
  assert.equal(hurtPlayer(s, { kind: 'spike', label: 'Stachelwolke', x: 100, y: 300 }), 'ignored');
});

test('hurtPlayer: Leben, Combo, Zähler, Ursache, Unverwundbarkeit, Rückstoß, Betäubung, Effekte', () => {
  for (const [srcX, dir] of [[400, -1], [0, 1]]) {
    const s = createState({ seed: 1 });
    const p = s.player;
    p.x = 200;
    p.onGround = true;
    p.groundId = 5;
    s.combo.count = 4;
    s.combo.timer = 2;
    const r = hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: srcX, y: 300 });
    assert.equal(r, 'hurt');
    assert.equal(s.lives, MAX_LIVES - 1);
    assert.equal(s.combo.count, 0);
    assert.equal(s.run.hits, 1);
    assert.deepEqual(s.deathCause, { kind: 'enemy', label: 'Hüpfer' });
    assert.equal(p.invuln, PHYS.INVULN_HURT);
    assert.equal(p.vx, dir * PHYS.KNOCKBACK_VX, 'Rückstoß weg von der Quelle');
    assert.equal(p.vy, -PHYS.KNOCKBACK_VY);
    assert.equal(p.onGround, false);
    assert.equal(p.stun, PHYS.STUN);
    assert.ok(s.fx.hitstop >= 0.06 - 1e-9 && s.fx.shake > 0 && s.fx.flash > 0);
    assert.ok(s.popups.some((q) => q.text === 'Aua!'));
    assert.equal(s.mode, 'playing');
  }
});

test('Betäubung: Eingabe wirkt nach dem Treffer erst nach STUN, Springen bleibt möglich', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: -100, y: 300 });
  tick(s, input({ move: -1 }));
  assert.ok(p.vx > 0, 'Rückstoß gewinnt in der Betäubung');
  ticks(s, 30, input({ move: -1 }));
  assert.ok(p.vx < 0, 'danach steuert der Spieler wieder');
});

test('letztes Leben: Tod, Spielmodus dying, Todesursache', () => {
  const s = createState({ seed: 1 });
  s.lives = 1;
  const r = hurtPlayer(s, { kind: 'lightning', label: 'Blitz', x: 100, y: 0 });
  assert.equal(r, 'dead');
  assert.equal(s.lives, 0);
  assert.equal(s.mode, 'dying');
  assert.equal(s.player.dead, true);
  assert.equal(s.deathT, 0);
  assert.deepEqual(s.deathCause, { kind: 'lightning', label: 'Blitz' });
  assert.equal(hurtPlayer(s, { kind: 'enemy', label: 'x', x: 0, y: 0 }), 'ignored');
  assert.equal(s.lives, 0);
});

test('toter Spieler taumelt und fällt, hat keine Steuerung und keine Kollision', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  s.lives = 1;
  hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: 100, y: 300 });
  assert.equal(p.dead, true);
  assert.ok(p.vy < 0, 'taumelt nach oben');
  const y0 = p.y;
  const vx0 = p.vx;
  let minY = y0;
  for (let i = 0; i < 240; i++) {
    tick(s, input({ move: 1, jumpPressed: i % 5 === 0, jumpHeld: true, dashPressed: true }));
    minY = Math.min(minY, p.y);
    assert.equal(p.onGround, false);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.vx <= Math.abs(vx0) + 1e-9, 'keine Beschleunigung durch Eingabe');
  }
  assert.ok(minY < y0 - 10, 'erst nach oben');
  assert.ok(p.y > g.y + 200, 'dann durch den Boden gefallen, keine Kollision');
  assert.equal(p.dash.t, 0);
  assert.equal(s.mode, 'dying');
});

// ---------- Fallen ----------

function fallWorld() {
  const s = world();
  s.camX = 500;
  const far = createStaticPlatform(s, 900, GROUND_Y, 500, { ground: true });
  s.platforms.push(far);
  const p = s.player;
  p.x = 600;
  p.y = KILL_Y + 5;
  p.vy = 200;
  return { s, far, p };
}

test('Sturz in den Abgrund: Leben weg, Respawn ohne Rückstoß', () => {
  const { s, far, p } = fallWorld();
  tick(s);
  assert.equal(s.lives, MAX_LIVES - 1);
  assert.deepEqual(s.deathCause, { kind: 'fall', label: 'In den Abgrund gefallen' });
  assert.equal(p.groundId, far.id);
  assert.equal(p.vx, 0);
  assert.equal(p.vy, 0);
  assert.ok(p.invuln >= PHYS.INVULN_RESPAWN - 1e-9);
});

test('Sturz mit Schild: Schild weg, Respawn, kein Leben verloren', () => {
  const { s, far, p } = fallWorld();
  p.power.shield = true;
  tick(s);
  assert.equal(s.lives, MAX_LIVES);
  assert.equal(p.power.shield, false);
  assert.equal(p.groundId, far.id);
});

test('Sturz im letzten Leben ist der Tod', () => {
  const { s, p } = fallWorld();
  s.lives = 1;
  tick(s);
  assert.equal(s.mode, 'dying');
  assert.equal(p.dead, true);
  assert.equal(s.deathCause.kind, 'fall');
});

test('Sturz bei Unverwundbarkeit zählt nicht, der Spieler wird trotzdem gerettet', () => {
  const { s, far, p } = fallWorld();
  p.invuln = 1;
  tick(s);
  assert.equal(s.lives, MAX_LIVES);
  assert.equal(p.groundId, far.id);
  assert.ok(p.y < KILL_Y);
});

// ---------- Respawn ----------

test('respawnPlayer belebt niemanden wieder', () => {
  const s = world();
  s.camX = 1000;
  s.platforms.push(createStaticPlatform(s, 1100, 360, 800, { ground: true }));
  s.lives = 1;
  hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: 0, y: 0 });
  const before = JSON.stringify(s.player);
  respawnPlayer(s);
  assert.equal(JSON.stringify(s.player), before);
  assert.equal(s.player.dead, true);
});

test('respawnPlayer wählt die erste sichere Plattform vor dem Spieler und setzt ihn mittig darauf', () => {
  const s = world();
  s.camX = 1000;
  const wrongNear = createStaticPlatform(s, 500, 330, 300); // rechte Kante 800 liegt links der Grenze
  const moving = createMovingPlatform(s, 1300, 330, 300, { ax: 20 });
  const breakable = createBreakablePlatform(s, 1100, 330, 300);
  const narrow = createStaticPlatform(s, 1150, 340, 150);
  const good = createStaticPlatform(s, 1500, 350, 250);
  const later = createStaticPlatform(s, 1900, 330, 400);
  s.platforms.push(later, wrongNear, moving, breakable, narrow, good); // Reihenfolge absichtlich gemischt
  const p = s.player;
  p.x = 900;
  p.y = 700;
  p.vx = 123;
  p.vy = 800;
  p.jumps = 2;
  p.stun = 0.2;
  p.dash.t = 0.1;
  respawnPlayer(s);
  assert.equal(p.groundId, good.id);
  assert.equal(p.onGround, true);
  assert.equal(p.y, good.y - p.h);
  assert.equal(p.x + p.w / 2, good.x + good.w / 2, 'mittig');
  assert.equal(p.vx, 0);
  assert.equal(p.vy, 0);
  assert.equal(p.jumps, 0);
  assert.equal(p.stun, 0);
  assert.equal(p.dash.t, 0);
  assert.ok(p.invuln >= PHYS.INVULN_RESPAWN - 1e-9);
  assert.deepEqual(s.respawn, { x: p.x, y: p.y });
  // und er bleibt dort stehen
  ticks(s, 30);
  assert.equal(p.groundId, good.id);
  assert.equal(p.y, good.y - p.h);
});

test('respawnPlayer bleibt im sichtbaren Bereich, auch bei sehr breiten Plattformen', () => {
  const s = world();
  s.camX = 1000;
  const wide = createStaticPlatform(s, 100, 360, 3000, { ground: true });
  s.platforms.push(wide);
  respawnPlayer(s);
  const p = s.player;
  assert.ok(p.x >= s.camX + PHYS.LEFT_MARGIN);
  assert.ok(p.x + p.w <= s.camX + W);
  assert.equal(p.groundId, wide.id);
});

test('respawnPlayer ohne passende Plattform nimmt eine schmalere, zur Not entsteht eine Notplattform', () => {
  const s = world();
  s.camX = 1000;
  const small = createStaticPlatform(s, 1300, 360, 120);
  s.platforms.push(small);
  respawnPlayer(s);
  assert.equal(s.player.groundId, small.id);

  const s2 = world();
  s2.camX = 1000;
  respawnPlayer(s2);
  assert.equal(s2.platforms.length, 1);
  assert.equal(s2.player.groundId, s2.platforms[0].id);
  assert.equal(s2.player.onGround, true);
  ticks(s2, 30);
  assert.equal(s2.player.groundId, s2.platforms[0].id);
  assert.deepEqual(invariants(s2), []);
});

// Gibt true zurück, wenn clearEnemiesNear und clearHazardsNear schon echt umgesetzt sind
function clearersReady() {
  const s = createState({ seed: 1 });
  const g = createStaticPlatform(s, 0, 360, 400);
  s.platforms.push(g);
  s.enemies.push(createWalker(s, g, 0.5));
  s.hazards.push(createSpike(s, g, 0.5));
  clearEnemiesNear(s, 0, 400);
  clearHazardsNear(s, 0, 400);
  return s.enemies.length === 0 && s.hazards.length === 0;
}

test('respawnPlayer räumt Gegner und Hindernisse im Bereich 260 links bis 420 rechts', (t) => {
  if (!clearersReady()) {
    t.skip('enemies.js oder obstacles.js sind noch Stubs');
    return;
  }
  const s = world();
  s.camX = 1000;
  const good = createStaticPlatform(s, 1100, 360, 800, { ground: true });
  s.platforms.push(good);
  respawnPlayer(s);
  const p = s.player;
  const near = createWalker(s, good, 0.3);
  const spike = createSpike(s, good, 0.35);
  const bolt = createLightning(s, p.x + 40, { idle: 0.5 });
  const farWalker = createWalker(s, good, 0.99);
  s.enemies.push(near, farWalker);
  s.hazards.push(spike, bolt);
  s.camX = 1000;
  respawnPlayer(s);
  assert.ok(!s.enemies.includes(near) || near.x < p.x - 260 || near.x > p.x + p.w + 420);
  assert.ok(!s.hazards.includes(spike));
  assert.ok(bolt.phase === 'idle' && bolt.timer >= bolt.idleTime + 2 - 1e-9);
});

test('nach respawnPlayer verliert der Spieler zwei Sekunden lang kein Leben, auch wenn er stillsteht', () => {
  for (const seed of [1, 2, 3, 4]) {
    const s = newGame(seed);
    const p = s.player;
    // einige Sekunden laufen, damit Kamera und Welt in Bewegung sind
    for (let i = 0; i < 120; i++) stepSim(s, input({ move: 1, jumpPressed: i % 25 === 0, jumpHeld: i % 25 < 15 }), STEP);
    if (s.mode !== 'playing') continue;
    const lives = s.lives;
    const hits = s.run.hits;
    // Gegner und Hindernisse genau auf dem Spieler und rundherum
    respawnPlayer(s);
    const host = platformUnder(s);
    const spots = [-200, -120, -60, 0, 60, 150, 300];
    for (const dx of spots) {
      if (host && p.x + dx > host.x && p.x + dx < host.x + host.w - 60) {
        const w = createWalker(s, host, (p.x + dx - host.x) / host.w);
        w.dir = dx > 0 ? -1 : 1;
        s.enemies.push(w);
        s.hazards.push(createSpike(s, host, (p.x + dx + 30 - host.x) / host.w));
      }
    }
    s.hazards.push(createLightning(s, p.x + p.w / 2, { idle: 0.1 }));
    s.hazards.push(createLightning(s, p.x + 200, { idle: 0.1 }));
    respawnPlayer(s);
    for (let i = 0; i < 120; i++) {
      stepSim(s, input(), STEP);
      assert.ok(p.invuln > 0 || i >= 119, `unverwundbar in Schritt ${i}`);
      assert.equal(s.lives, lives, `Seed ${seed}, Schritt ${i}`);
    }
    assert.equal(s.run.hits, hits);
    assert.equal(s.mode, 'playing');
  }
});

function platformUnder(s) {
  return s.platforms.find((pl) => pl.id === s.player.groundId) || null;
}

// ---------- Dash ----------

test('Dash braucht das Powerup und wirkt nur bei abgelaufener Abklingzeit', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.equal(p.dash.t, 0, 'ohne Powerup kein Dash');
  p.power.dashT = 5;
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.ok(p.dash.t > 0);
});

test('Dash: Dauer, Strecke, Unverwundbarkeit und Abklingzeit', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.power.dashT = 5;
  p.face = 1;
  const x0 = p.x;
  const y0 = p.y;
  tick(s, input({ dashPressed: true }));
  let frames = 1; // der Schritt mit dem Tastendruck ist der erste Dashschritt
  let endX = p.x;
  while (p.dash.t > 0 && frames < 60) {
    assert.equal(hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: p.x, y: p.y }), 'ignored', 'unverwundbar im Dash');
    assert.equal(p.trail, 1);
    assert.equal(p.y, y0, 'Schwerkraft aus');
    endX = p.x;
    tick(s);
    if (p.dash.t > 0) frames++;
  }
  assert.equal(frames, Math.round(PHYS.DASH_TIME / STEP), `Dauer ${frames} Schritte`);
  const dist = endX - x0;
  assert.ok(Math.abs(dist - PHYS.DASH_SPEED * PHYS.DASH_TIME) < PHYS.DASH_SPEED * STEP * 1.01, `Strecke ${dist}`);
  assert.ok(p.dash.cd > 0 && p.dash.cd <= PHYS.DASH_COOLDOWN);
  // nach dem Dash wieder verwundbar
  assert.equal(hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: p.x, y: p.y }), 'hurt');
  s.player.invuln = 0;

  // Abklingzeit: zu früh gedrückt wirkt nicht, später schon
  ticks(s, 15);
  tick(s, input({ dashPressed: true }));
  assert.equal(p.dash.t, 0, 'noch in der Abklingzeit');
  ticks(s, 36); // zusammen mehr als 0,55 s seit Ende des Dashs
  tick(s, input({ dashPressed: true }));
  assert.ok(p.dash.t > 0, 'wieder bereit');
});

test('Dash in der Luft geht geradeaus, folgt der Eingaberichtung und endet mit normalem Tempo', () => {
  const s = world();
  addGround(s);
  const p = s.player;
  p.x = 100;
  p.y = 100;
  p.vy = 300;
  p.power.dashT = 5;
  p.face = 1;
  tick(s, input({ dashPressed: true, move: -1 }));
  assert.equal(p.dash.dir, -1);
  assert.equal(p.face, -1);
  assert.equal(p.vy, 0);
  const y0 = p.y;
  tick(s);
  while (p.dash.t > 0) {
    assert.equal(p.y, y0);
    tick(s);
  }
  assert.ok(p.vx < -250 && p.vx >= -MOVE, `danach normales Tempo statt Dashtempo (${p.vx})`);
  assert.ok(p.vy > 0, 'danach wirkt die Schwerkraft wieder');
});

test('Dash über eine Lücke', () => {
  const s = world();
  const A = createStaticPlatform(s, -4000, GROUND_Y, 4000, { ground: true });
  const B = createStaticPlatform(s, 140, GROUND_Y, 2000, { ground: true });
  s.platforms.push(A, B);
  const p = s.player;
  p.x = -40;
  p.y = GROUND_Y - p.h;
  p.power.dashT = 5;
  tick(s);
  tick(s, input({ dashPressed: true, move: 1 }));
  ticks(s, 30, input({ move: 1 }));
  assert.equal(p.groundId, B.id, 'am Rand gestartet, die Lücke ist mit dem Dash überwunden');
});

// ---------- Wind und Regen ----------

function obstaclesReady() {
  const s = createState({ seed: 1 });
  s.zones.push(createWind(s, -100, -100, 200, 600, { vx: 100, ay: -300 }));
  const r = createRain(s, -100, 200, { y: 0 });
  r.intensity = 1;
  s.zones.push(r);
  return windAt(s, 0, 200).vx !== 0 && rainAt(s, 0, 200) > 0;
}

test('Wind schiebt sanft, die Eingabe gewinnt', (t) => {
  if (!obstaclesReady()) {
    t.skip('obstacles.js ist noch ein Stub');
    return;
  }
  const s = world();
  const g = addGround(s);
  s.zones.push(createWind(s, -3000, 0, 6000, 450, { vx: 100 }));
  const p = standOn(s, g, 0);
  const x0 = p.x;
  ticks(s, 60);
  assert.ok(p.windVx > 80 && p.windVx <= 100, `windVx ${p.windVx}`);
  assert.ok(p.x - x0 > 60, 'er driftet nach rechts');
  // gegen den Wind laufen bringt ihn trotzdem voran
  const x1 = p.x;
  ticks(s, 60, input({ move: -1 }));
  assert.ok(p.x < x1 - 100, 'gegen den Wind vorwärts');
  assert.ok(p.vx + p.windVx < 0);
});

test('Aufwind verringert die Schwerkraft', (t) => {
  if (!obstaclesReady()) {
    t.skip('obstacles.js ist noch ein Stub');
    return;
  }
  const s = world();
  const g = addGround(s);
  s.zones.push(createWind(s, -3000, 0, 6000, 450, { ay: -600 }));
  standOn(s, g, 0);
  const rise = peakRise(s);
  assert.ok(rise > 150, `Sprunghöhe im Aufwind ${rise}`);
});

test('Regen macht den Boden rutschig: langsamere Beschleunigung, langer Bremsweg', (t) => {
  if (!obstaclesReady()) {
    t.skip('obstacles.js ist noch ein Stub');
    return;
  }
  const s = world();
  const g = addGround(s);
  const r = createRain(s, -3000, 6000, { y: 0 });
  r.intensity = 1;
  r.active = true;
  s.zones.push(r);
  const p = standOn(s, g, 0);
  ticks(s, 40); // p.wet nähert sich 1
  assert.ok(p.wet > 0.95, `wet ${p.wet}`);
  let acc = 0;
  while (p.vx < MOVE && acc < 120) {
    tick(s, input({ move: 1 }));
    acc++;
  }
  const accTime = acc * STEP;
  const expected = MOVE / (PHYS.GROUND_ACCEL * PHYS.RAIN_ACCEL_MULT);
  assert.ok(Math.abs(accTime - expected) < 0.05, `Beschleunigung ${accTime}, erwartet ${expected}`);
  const x0 = p.x;
  let brake = 0;
  while (p.vx > 0 && brake < 200) {
    tick(s);
    brake++;
  }
  assert.ok(p.x - x0 > 60, `Bremsweg ${p.x - x0}`);
  assert.ok(brake * STEP > 0.4);
});

// ---------- Ränder und Randfälle ----------

test('linker Rand: der Spieler bleibt rechts von camX plus LEFT_MARGIN', () => {
  const s = world();
  s.camX = 500;
  const g = addGround(s);
  const p = standOn(s, g, 560);
  for (let i = 0; i < 200; i++) {
    tick(s, input({ move: -1 }));
    assert.ok(p.x >= s.camX + PHYS.LEFT_MARGIN - 1e-9);
  }
  assert.equal(p.x, s.camX + PHYS.LEFT_MARGIN);
  assert.equal(p.vx, 0);
  // Rückstoß nach links am Rand
  hurtPlayer(s, { kind: 'enemy', label: 'Hüpfer', x: p.x + 100, y: p.y });
  ticks(s, 30);
  assert.ok(p.x >= s.camX + PHYS.LEFT_MARGIN - 1e-9);
  // Eine nach links laufende Plattform schiebt ihn ebenfalls nicht hinaus
  const s2 = world();
  s2.camX = 0;
  const m = createMovingPlatform(s2, 100, 330, 200, { ax: 90, period: 3 });
  s2.platforms.push(m);
  tick(s2);
  const p2 = standOn(s2, m, m.x + 60);
  for (let i = 0; i < 400; i++) {
    tick(s2);
    assert.ok(p2.x >= s2.camX + PHYS.LEFT_MARGIN - 1e-9);
  }
});

test('ungültige Eingaben: dt null oder NaN, move NaN, fehlende Felder', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  const snap = JSON.stringify(p);
  updatePlayer(s, input({ move: 1 }), 0);
  updatePlayer(s, input({ move: 1 }), NaN);
  updatePlayer(s, input({ move: 1 }), -1);
  assert.equal(JSON.stringify(p), snap, 'keine Wirkung');
  tick(s, { move: NaN });
  assert.equal(p.vx, 0);
  tick(s, {});
  tick(s, input({ move: 5 }));
  assert.ok(p.vx > 0 && p.vx <= MOVE);
  updatePlayer(s, input(), 5); // sehr großer Schritt wird gekappt
  assert.deepEqual(invariants(s), []);
});

// ---------- Fuzz und Einfrieren ----------

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('Fuzz: 20 Seeds mit zufälligen Eingaben über 30 Sekunden, Invarianten bleiben leer', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame(seed);
    const rnd = mulberry(seed * 7919);
    let move = 1;
    let held = false;
    let holdLeft = 0;
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 25 === 0) move = rnd() < 0.15 ? -1 : rnd() < 0.2 ? 0 : 1;
      let jumpPressed = false;
      if (holdLeft <= 0 && rnd() < 0.05) {
        jumpPressed = true;
        held = true;
        holdLeft = Math.floor(rnd() * 28);
      }
      if (holdLeft > 0) holdLeft--;
      else held = false;
      if (i % 240 === 0) {
        s.player.power.dashT = rnd() < 0.5 ? 6 : 0;
        s.player.power.feather = Math.floor(rnd() * 3);
        s.player.power.shield = rnd() < 0.3;
      }
      const p = s.player;
      if (rnd() < 0.002) hurtPlayer(s, { kind: 'enemy', label: 'Test', x: p.x + (rnd() < 0.5 ? -30 : 30), y: p.y });
      stepSim(s, { move, jumpPressed, jumpHeld: held, dashPressed: rnd() < 0.03 }, STEP);
      if (!p.dead) {
        assert.ok(p.x >= s.camX + PHYS.LEFT_MARGIN - 1e-6, `Seed ${seed} Schritt ${i}: links vom Rand (${p.x} gegen ${s.camX})`);
        if (p.onGround) {
          const g = s.platforms.find((pl) => pl.id === p.groundId);
          assert.ok(g && isSolid(g), `Seed ${seed} Schritt ${i}: Boden fehlt`);
          assert.ok(Math.abs(bottom(p) - g.y) < 1e-6, `Seed ${seed} Schritt ${i}: steckt in der Plattform`);
          assert.ok(p.x + p.w > g.x - 1e-6 && p.x < g.x + g.w + 1e-6);
        }
        assert.ok(p.y < KILL_Y + 400, 'fällt nicht ewig');
      }
      if (i % 60 === 0) assert.deepEqual(invariants(s), [], `Seed ${seed} Schritt ${i}`);
      if (s.mode === 'over') break;
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
  }
});

test('deterministisch: gleiche Eingaben ergeben exakt denselben Zustand', () => {
  const play = () => {
    const s = newGame(11);
    const rnd = mulberry(5);
    for (let i = 0; i < 60 * 12; i++) {
      stepSim(s, { move: rnd() < 0.8 ? 1 : -1, jumpPressed: rnd() < 0.05, jumpHeld: rnd() < 0.6, dashPressed: rnd() < 0.02 }, STEP);
    }
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test('Einfrieren: ein einfacher Läufer kommt voran, solange das Spiel läuft', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = newGame(seed);
    let bestX = s.player.x;
    let lastProgress = 0;
    let lastLives = s.lives;
    for (let i = 0; i < 60 * 40; i++) {
      const p = s.player;
      // läuft nach rechts und springt, wenn vor ihm Boden fehlt oder regelmäßig
      const ahead = s.platforms.some((pl) => p.x + p.w + 40 > pl.x && p.x + 40 < pl.x + pl.w && Math.abs(pl.y - (p.y + p.h)) < 60);
      const press = p.onGround && (!ahead || i % 45 === 0);
      stepSim(s, { move: 1, jumpPressed: press, jumpHeld: true, dashPressed: false }, STEP);
      if (p.x > bestX + 1 || s.lives !== lastLives) {
        bestX = Math.max(bestX, p.x);
        lastLives = s.lives;
        lastProgress = i;
      }
      if (s.mode !== 'playing') break;
      assert.ok(i - lastProgress < 60 * 6, `Seed ${seed}: seit 6 Sekunden kein Fortschritt bei x ${p.x}`);
    }
  }
});
