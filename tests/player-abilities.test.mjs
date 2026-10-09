// Fähigkeiten von Nimbus: Wolkenstoß, Gleiten, Stampfen, Sternenwurf (Einbindung), Sprungwolke, Eiswolke, Blinkwolke, Töne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY, ICE, KILL_Y, MAX_LIVES, PHYS, SPRING, STEP } from '../game/constants.js';
import {
  createBlinkPlatform, createBreakablePlatform, createFlyer, createHail, createRain, createSpringPlatform,
  createStaticPlatform, createWalker,
} from '../game/entities.js';
import { damageEnemy, playerVsEnemies } from '../game/enemies.js';
import { PRESET_NAMES } from '../game/particles.js';
import { bouncePlayer, hurtPlayer, respawnPlayer, updatePlayer } from '../game/player.js';
import { updatePlatforms } from '../game/platforms.js';
import { updateShots } from '../game/shots.js';
import { createState } from '../game/state.js';
import { stepSim } from '../game/sim.js';
import { input, invariants, newGame } from './helpers.mjs';

const GROUND_Y = 360;
const MOVE = PHYS.MOVE_SPEED;
const { GLIDE, SLAM, SHOT } = ABILITY;

// ---------- Hilfen ----------

function world() {
  const s = createState({ seed: 1 });
  s.camX = -5000; // der linke Rand stört nicht
  return s;
}

function addGround(s, opts = {}, x = -3000, w = 6000, y = GROUND_Y) {
  const g = createStaticPlatform(s, x, y, w, { ground: true, ...opts });
  s.platforms.push(g);
  return g;
}

// Ein Schritt wie in sim.js (ohne Generator und Kamera)
function tick(s, inp = input()) {
  s.t += STEP;
  s.realT += STEP;
  updatePlatforms(s, STEP);
  updatePlayer(s, inp, STEP);
  updateShots(s, STEP);
}

function ticks(s, n, inp = input()) {
  for (let i = 0; i < n; i++) tick(s, typeof inp === 'function' ? inp(i) : inp);
}

// Wie tick, mit Kollision gegen Gegner (für Stomp und Dash)
function tickFight(s, inp = input()) {
  tick(s, inp);
  playerVsEnemies(s);
}

function standOn(s, plat, x) {
  const p = s.player;
  p.x = x;
  p.y = plat.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
  p.groundId = plat.id;
  tick(s);
  assert.equal(p.onGround, true, 'steht nach dem Aufsetzen');
  return p;
}

// Setzt den Spieler h Pixel (Füße bis Oberkante) über die Plattform, in der Luft und ruhig
function hang(s, plat, h, x = 0) {
  const p = s.player;
  p.x = x;
  p.y = plat.y - p.h - h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.groundId = 0;
  p.coyote = 0;
  return p;
}

const sfxCount = (s, name) => s.sfx.filter((e) => e.n === name).length;
const noGlide = (p, pressed = false) => pressed || p.vy <= GLIDE.MIN_VY; // Taste nur beim Steigen halten

// Ist damageEnemy in enemies.js schon umgesetzt? Sonst werden die Tests übersprungen, die Kills prüfen.
function damageReady() {
  const s = createState({ seed: 1 });
  const g = createStaticPlatform(s, 0, 360, 400);
  s.platforms.push(g);
  const e = createWalker(s, g, 0.5);
  s.enemies.push(e);
  return damageEnemy(s, e, 'slam') === true && e.dead > 0;
}
const DAMAGE = damageReady();
const needsDamage = (name, fn) => test(name, { skip: DAMAGE ? false : 'damageEnemy in enemies.js ist noch ein Stub' }, fn);

// ---------- Wolkenstoß ----------

test('Basis Dash: einmal pro Luftphase, die Landung setzt das Limit zurück', () => {
  const s = world();
  addGround(s);
  const p = s.player;
  p.x = 0;
  p.y = GROUND_Y - 700;
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.ok(p.dash.t > 0, 'erster Dash in der Luft geht');
  assert.equal(p.dash.air, true);
  assert.equal(p.dash.rainbow, false);
  while (p.dash.t > 0) tick(s, input({ move: 1 }));
  p.dash.cd = 0; // die Abklingzeit allein wäre kein Grund
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.equal(p.dash.t, 0, 'in dieser Luftphase schon benutzt');
  for (let i = 0; i < 200 && !p.onGround; i++) tick(s, input({ move: 1 }));
  assert.equal(p.onGround, true);
  assert.equal(p.dash.air, false, 'die Landung setzt zurück');
  p.dash.cd = 0;
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.ok(p.dash.t > 0, 'am Boden wieder möglich');
});

test('Dash am Boden verbraucht das Luftlimit nicht', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.equal(p.dash.air, false);
  while (p.dash.t > 0) tick(s);
  p.dash.cd = 0;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  ticks(s, 10, input({ jumpHeld: true }));
  assert.equal(p.onGround, false);
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.ok(p.dash.t > 0, 'in der Luft noch frei');
  assert.equal(p.dash.air, true);
});

test('Regenbogen Dash: kein Luftlimit, kurze Abklingzeit, p.dash.rainbow', () => {
  const s = world();
  addGround(s);
  const p = s.player;
  p.x = 0;
  p.y = GROUND_Y - 3000;
  p.power.dashT = 60;
  let started = 0;
  let wasDashing = false;
  for (let i = 0; i < 160 && started < 3; i++) {
    tick(s, input({ dashPressed: true, move: 1 }));
    const dashing = p.dash.t > 0;
    if (dashing && !wasDashing) {
      started++;
      assert.equal(p.dash.rainbow, true);
      assert.equal(p.dash.air, true, 'wird vermerkt, begrenzt aber nichts');
    }
    wasDashing = dashing;
    assert.equal(p.onGround, false);
  }
  assert.equal(started, 3, 'drei Dashs in einer Luftphase');
});

test('Regenbogen Dash: Abklingzeit 0,45 s gegen 1,6 s im Basis Dash', () => {
  const wait = (rainbow) => {
    const s = world();
    const g = addGround(s);
    const p = standOn(s, g, 0);
    if (rainbow) p.power.dashT = 60;
    tick(s, input({ dashPressed: true, move: 1 }));
    let n = 0;
    while (p.dash.t > 0) tick(s, input({ move: 1 }));
    // zählt die Schritte seit dem Ende, bis der Dash wieder geht
    for (; n < 400; n++) {
      tick(s, input({ dashPressed: true, move: 1 }));
      if (p.dash.t > 0) break;
    }
    return (n + 1) * STEP;
  };
  const basic = wait(false);
  const rainbow = wait(true);
  assert.ok(Math.abs(basic - ABILITY.DASH_BASIC.COOLDOWN) < 3 * STEP, `Basis ${basic}`);
  assert.ok(Math.abs(rainbow - ABILITY.DASH_RAINBOW.COOLDOWN) < 3 * STEP, `Regenbogen ${rainbow}`);
});

test('Das Regenbogen Powerup kürzt eine laufende Abklingzeit des Basis Dashs', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ dashPressed: true, move: 1 }));
  while (p.dash.t > 0) tick(s);
  assert.ok(p.dash.cd > 1.4);
  p.power.dashT = 8;
  tick(s);
  assert.ok(p.dash.cd <= ABILITY.DASH_RAINBOW.COOLDOWN + 1e-9, `Abklingzeit ${p.dash.cd}`);
});

test('Dash geht nicht gestunnt, nicht tot und nicht im Sturzflug', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.stun = 0.2;
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.equal(p.dash.t, 0);

  const s2 = world();
  const g2 = addGround(s2);
  const p2 = hang(s2, g2, 200);
  tick(s2, input({ slamPressed: true }));
  assert.equal(p2.slam.active, true);
  tick(s2, input({ dashPressed: true, move: 1 }));
  assert.equal(p2.dash.t, 0, 'Sturzflug bleibt Sturzflug');
  assert.equal(p2.slam.active, true);

  const s3 = world();
  addGround(s3);
  s3.lives = 1;
  hurtPlayer(s3, { kind: 'enemy', label: 'Test', x: 0, y: 0 });
  tick(s3, input({ dashPressed: true }));
  assert.equal(s3.player.dash.t, 0);
});

test('Dash besiegt Gegner (Zustände für playerVsEnemies) und macht unverwundbar', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  const w = createWalker(s, g, 0.5);
  w.x = p.x + 80;
  w.minX = w.maxX = w.x;
  s.enemies.push(w);
  tick(s, input({ dashPressed: true, move: 1 }));
  playerVsEnemies(s);
  for (let i = 0; i < 12 && !(w.dead > 0); i++) tickFight(s, input({ move: 1 }));
  assert.ok(w.dead > 0, 'berührter Gegner im Dash besiegt');
  assert.equal(s.lives, MAX_LIVES);
});

// ---------- Gleiten ----------

test('Gleiten: Fallgeschwindigkeit höchstens GLIDE.FALL, glide true, glideT wächst um dt', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 330, 0);
  let glidFrames = 0;
  let t0 = null;
  for (let i = 0; i < 90; i++) {
    tick(s, input({ jumpHeld: true }));
    assert.equal(p.onGround, false);
    if (p.glide) {
      glidFrames++;
      assert.ok(p.vy <= GLIDE.FALL + 1e-9, `vy ${p.vy}`);
      if (t0 === null) t0 = p.glideT;
      else assert.ok(Math.abs(p.glideT - (t0 + (glidFrames - 1) * STEP)) < 1e-9, 'glideT wächst um dt');
    }
  }
  assert.ok(glidFrames > 60, `gleitet ${glidFrames} Schritte`);
  assert.ok(p.glideT <= GLIDE.MAX + 1e-9);
});

test('Gleiten endet nach GLIDE.MAX, danach fällt der Spieler wieder schneller', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 330, 0);
  p.y -= 3000; // genug Höhe
  let frames = 0;
  for (let i = 0; i < 200; i++) {
    tick(s, input({ jumpHeld: true }));
    if (p.glide) frames++;
  }
  assert.ok(Math.abs(frames * STEP - GLIDE.MAX) < 4 * STEP, `Gleitdauer ${frames * STEP}`);
  assert.equal(p.glide, false);
  assert.ok(Math.abs(p.glideT - GLIDE.MAX) < 1e-9);
  assert.ok(p.vy > GLIDE.FALL + 100, `danach normaler Fall (${p.vy})`);
});

test('Gleiten verlängert die Luftzeit eines Sprungs messbar', () => {
  const airTime = (glide) => {
    const s = world();
    const g = addGround(s);
    const p = standOn(s, g, 0);
    tick(s, input({ jumpPressed: true, jumpHeld: true }));
    let n = 1;
    while (!p.onGround && n < 400) {
      tick(s, input({ jumpHeld: glide ? true : noGlide(p) }));
      n++;
    }
    return n * STEP;
  };
  const plain = airTime(false);
  const glided = airTime(true);
  assert.ok(Math.abs(plain - 0.72) < 0.05, `ohne Gleiten ${plain}`);
  assert.ok(glided > plain + 0.35, `mit Gleiten ${glided}, ohne ${plain}`);
});

// Größte machbare Lücke eines einzelnen Sprungs vom Rand, mit oder ohne Gleiten
function crossing(gap, glide) {
  const s = world();
  const A = createStaticPlatform(s, -4000, GROUND_Y, 4000, { ground: true });
  const B = createStaticPlatform(s, gap, GROUND_Y, 4000, { ground: true });
  s.platforms.push(A, B);
  const p = s.player;
  p.x = -900;
  p.y = GROUND_Y - p.h;
  p.vx = MOVE;
  tick(s, input({ move: 1, jumpHeld: true }));
  let jumped = false;
  for (let i = 0; i < 400; i++) {
    const inp = input({ move: 1, jumpHeld: glide || noGlide(p) });
    if (!jumped && p.onGround && p.x + p.vx * STEP >= 0) {
      inp.jumpPressed = true;
      inp.jumpHeld = true;
      jumped = true;
    }
    tick(s, inp);
    if (jumped && p.onGround) return p.groundId === B.id;
    if (p.y > KILL_Y) return false;
  }
  return false;
}

function maxGap(glide) {
  let lo = 40;
  let hi = 900;
  assert.ok(crossing(lo, glide));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (crossing(mid, glide)) lo = mid;
    else hi = mid;
  }
  return lo;
}

test('Gleiten verlängert die Sprungweite, aber nur begrenzt', () => {
  const plain = maxGap(false);
  const glided = maxGap(true);
  const gain = glided - plain;
  assert.ok(gain > 80, `Gewinn nur ${gain} px (ohne ${plain}, mit ${glided})`);
  assert.ok(gain <= MOVE * GLIDE.MAX, `Gewinn ${gain} px übersteigt Tempo mal Gleitzeit`);
});

test('Gleiten braucht Fallen: beim Steigen, gestunnt und mit gedrückter Abwärtstaste nicht', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  while (p.vy < 0) {
    assert.equal(p.glide, false, 'beim Steigen nie');
    tick(s, input({ jumpHeld: true }));
  }
  // jetzt fällt er und gleitet
  ticks(s, 6, input({ jumpHeld: true }));
  assert.equal(p.glide, true);
  // Abwärtstaste beendet das Gleiten
  tick(s, input({ jumpHeld: true, downHeld: true }));
  assert.equal(p.glide, false);
  tick(s, input({ jumpHeld: true }));
  assert.equal(p.glide, true);
  // Taste loslassen beendet es
  tick(s, input({ jumpHeld: false }));
  assert.equal(p.glide, false);
  // gestunnt
  p.stun = 0.15;
  const v = p.vy;
  tick(s, input({ jumpHeld: true }));
  assert.equal(p.glide, false);
  assert.ok(p.vy > v, 'fällt weiter beschleunigend');
});

test('Gleiten: ein neuer Druck löst zuerst den Doppelsprung aus, danach wird gegleitet', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  while (p.vy < 100) tick(s, input({ jumpHeld: noGlide(p) }));
  assert.equal(p.jumps, 1);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.jumps, 2, 'Doppelsprung ausgelöst');
  assert.ok(p.vy < -500, `Doppelsprung ${p.vy}`);
  assert.equal(p.glide, false);
  while (p.vy < 100) tick(s, input({ jumpHeld: noGlide(p) }));
  // kein Luftsprung mehr übrig: der Druck wird zum Gleiten
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.glide, true);
  assert.ok(p.vy <= GLIDE.FALL + 1e-9);
});

test('Gleiten: Ton nur beim Beginn, Landung und Sprungwolke setzen glideT zurück', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 300, 0);
  ticks(s, 30, input({ jumpHeld: true }));
  assert.equal(p.glide, true);
  assert.equal(sfxCount(s, 'glide'), 1, 'ein Ton für das ganze Gleiten');
  assert.ok(p.glideT > 0.3);
  for (let i = 0; i < 200 && !p.onGround; i++) tick(s, input({ jumpHeld: true }));
  assert.equal(p.onGround, true);
  assert.equal(p.glideT, 0, 'Landung');
  assert.equal(p.glide, false);

  // Sprungwolke
  const s2 = world();
  const sp = createSpringPlatform(s2, -200, GROUND_Y, 400);
  s2.platforms.push(sp);
  const p2 = hang(s2, sp, 200, 0);
  ticks(s2, 25, input({ jumpHeld: true }));
  assert.ok(p2.glideT > 0.2);
  for (let i = 0; i < 100 && p2.glideT > 0; i++) tick(s2, input({ jumpHeld: true }));
  assert.equal(p2.glideT, 0, 'Sprungwolke setzt zurück');
});

test('Dash und Treffer beenden das Gleiten', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 300, 0);
  ticks(s, 15, input({ jumpHeld: true }));
  assert.equal(p.glide, true);
  tick(s, input({ jumpHeld: true, dashPressed: true, move: 1 }));
  assert.equal(p.glide, false);
  assert.equal(p.vy, 0);

  const s2 = world();
  const g2 = addGround(s2);
  const p2 = hang(s2, g2, 300, 0);
  ticks(s2, 15, input({ jumpHeld: true }));
  assert.equal(p2.glide, true);
  hurtPlayer(s2, { kind: 'enemy', label: 'Test', x: 100, y: 100 });
  assert.equal(p2.glide, false);
});

// ---------- Stampfen ----------

test('Stampfen nur in der Luft und nur, wenn der Boden mehr als MIN_HEIGHT entfernt ist', () => {
  for (const [h, expected] of [[SLAM.MIN_HEIGHT - 6, false], [SLAM.MIN_HEIGHT, false], [SLAM.MIN_HEIGHT + 4, true], [200, true]]) {
    const s = world();
    const g = addGround(s);
    const p = hang(s, g, h, 0);
    tick(s, input({ slamPressed: true }));
    assert.equal(p.slam.active, expected, `Höhe ${h}`);
  }
  // am Boden nicht
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, input({ slamPressed: true }));
  assert.equal(p.slam.active, false);
  // über dem Abgrund (keine Plattform unter ihm) nicht, auch nicht neben der Plattform
  const s2 = world();
  const far = createStaticPlatform(s2, 500, GROUND_Y, 400);
  s2.platforms.push(far);
  const p2 = hang(s2, far, 200, 0);
  tick(s2, input({ slamPressed: true }));
  assert.equal(p2.slam.active, false, 'kein Boden darunter');
  // eine zerbrochene Plattform zählt nicht als Boden
  const s3 = world();
  const br = createBreakablePlatform(s3, -200, GROUND_Y, 400);
  br.state = 'broken';
  s3.platforms.push(br);
  const p3 = hang(s3, br, 200, 0);
  tick(s3, input({ slamPressed: true }));
  assert.equal(p3.slam.active, false, 'zerbrochen');
});

test('Sturzflug: vy gleich SLAM.SPEED über MAX_FALL, horizontal stark gedämpft, Landung nach kurzer Zeit', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 300, 0);
  p.vx = MOVE;
  p.vy = -100;
  const x0 = p.x;
  tick(s, input({ slamPressed: true, move: 1 }));
  assert.equal(p.slam.active, true);
  assert.equal(p.vy, SLAM.SPEED);
  assert.ok(SLAM.SPEED > PHYS.MAX_FALL);
  assert.ok(p.vx < MOVE * 0.4, `stark gedämpft schon im ersten Schritt (${p.vx})`);
  tick(s, input({ move: 1 }));
  tick(s, input({ move: 1 }));
  assert.equal(p.vx, 0, 'nach drei Schritten steht er waagerecht still');
  let frames = 3;
  while (p.slam.active && frames < 60) {
    tick(s, input({ move: 1 }));
    frames++;
    if (p.slam.active) assert.equal(p.vy, SLAM.SPEED);
  }
  assert.ok(frames >= 12 && frames <= 16, `Sturzflug dauert ${frames} Schritte`);
  assert.ok(p.x - x0 < 25, `bleibt fast senkrecht (${p.x - x0} px)`);
});

test('Landung im Sturzflug: Rückprall, Erschütterung, Hitstop, Ton, Partikel, Lebenspunkte unverändert', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 250, 0);
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  assert.equal(p.slam.active, false);
  assert.equal(p.vy, -SLAM.BOUNCE, 'Rückprall');
  assert.equal(p.onGround, false);
  assert.ok(s.fx.shake >= 6, `Shake ${s.fx.shake}`);
  assert.ok(s.fx.hitstop >= 0.06 - 1e-9, `Hitstop ${s.fx.hitstop}`);
  assert.equal(sfxCount(s, 'slam'), 1);
  assert.equal(s.lives, MAX_LIVES, 'die eigene Schockwelle schadet nicht');
  if (PRESET_NAMES.includes('slam')) assert.ok(s.particles.length > 0, 'Partikel slam');
  assert.ok(p.squashX > 1.2 && p.squashY < 0.8, 'kräftig gestaucht');
  // der Rückprall ist ein kleiner Hüpfer, danach steht er wieder
  for (let i = 0; i < 40 && !p.onGround; i++) tick(s);
  assert.equal(p.onGround, true);
  assert.equal(p.slam.active, false);
});

test('Nach dem Stampfen zählt ein Sprung kurz noch als Bodensprung', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 250, 0);
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.vy < -640, `voller Sprung ${p.vy}`);
  assert.equal(p.jumps, 1);
});

needsDamage('Schockwelle besiegt Gegner im Radius, nicht außerhalb', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 200, 0);
  const cx = p.x + p.w / 2;
  const place = (dx, kind = 'walker', up = 0) => {
    // dx: waagerechter Abstand der Mitten
    let e;
    if (kind === 'flyer') e = createFlyer(s, cx + dx, GROUND_Y - up);
    else {
      e = createWalker(s, g, 0.5);
      e.x = cx + dx - e.w / 2;
      e.minX = e.maxX = e.x;
    }
    s.enemies.push(e);
    return e;
  };
  const near = [place(60), place(-95), place(100), place(30, 'flyer', 70)];
  const far = [place(130), place(-170), place(400), place(30, 'flyer', 130)];
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  for (const e of near) assert.ok(e.dead > 0, `im Radius ${e.kind} bei ${e.x}`);
  for (const e of far) assert.ok(!(e.dead > 0), `außerhalb ${e.kind} bei ${e.x}`);
  assert.equal(s.run.kills, near.length);
  assert.equal(s.combo.count, near.length);
  assert.equal(s.lives, MAX_LIVES);
});

needsDamage('Schockwelle ignoriert schon tote Gegner und mehrere Treffer im selben Schritt sind sauber', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 200, 0);
  const cx = p.x + p.w / 2;
  const dead = createWalker(s, g, 0.5);
  dead.x = cx - 20;
  dead.dead = 0.2;
  const a = createWalker(s, g, 0.5);
  a.x = cx + 40;
  const b = createWalker(s, g, 0.5);
  b.x = cx - 70;
  s.enemies.push(dead, a, b);
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  assert.equal(dead.dead, 0.2, 'unverändert');
  assert.ok(a.dead > 0 && b.dead > 0);
  assert.equal(s.run.kills, 2);
});

test('Schockwelle zerstört Hagelkörner im Radius, die weiter entfernten bleiben', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 200, 0);
  const cx = p.x + p.w / 2;
  const fy = GROUND_Y;
  const near = createHail(s, cx + 50, fy - 30, 0, 0);
  const near2 = createHail(s, cx - 90, fy - 10, 0, 0);
  const far = createHail(s, cx + 300, fy - 30, 0, 0);
  s.hazards.push(near, near2, far);
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  assert.ok(!s.hazards.includes(near), 'nahes Korn zerstört');
  assert.ok(!s.hazards.includes(near2));
  assert.ok(s.hazards.includes(far), 'fernes Korn bleibt');
});

needsDamage('Abprall von einem Gegner im Sturzflug löst die Schockwelle aus und beendet ihn', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 220, 0);
  const cx = p.x + p.w / 2;
  const under = createWalker(s, g, 0.5);
  under.x = cx - under.w / 2;
  under.minX = under.maxX = under.x;
  const beside = createWalker(s, g, 0.5);
  beside.x = cx + 70;
  beside.minX = beside.maxX = beside.x;
  s.enemies.push(under, beside);
  tickFight(s, input({ slamPressed: true, jumpHeld: false }));
  for (let i = 0; i < 40 && p.slam.active; i++) tickFight(s);
  assert.equal(p.slam.active, false);
  assert.ok(under.dead > 0, 'Gegner unter ihm besiegt');
  assert.ok(beside.dead > 0, 'Gegner daneben von der Schockwelle');
  assert.equal(p.vy, -PHYS.STOMP_BOUNCE + 0, 'Abprall mit Stomp Stärke');
  assert.equal(sfxCount(s, 'slam'), 1);
  assert.equal(s.lives, MAX_LIVES);
});

test('bouncePlayer im Sturzflug beendet ihn mit Schockwelle, sonst bleibt alles wie vorher', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 200, 0);
  tick(s, input({ slamPressed: true }));
  assert.equal(p.slam.active, true);
  bouncePlayer(s, PHYS.STOMP_BOUNCE);
  assert.equal(p.slam.active, false);
  assert.equal(p.vy, -PHYS.STOMP_BOUNCE);
  assert.equal(sfxCount(s, 'slam'), 1);
  // ohne Sturzflug keine Schockwelle
  const s2 = world();
  addGround(s2);
  bouncePlayer(s2, PHYS.STOMP_BOUNCE);
  assert.equal(sfxCount(s2, 'slam'), 0);
});

test('Der Sturzflug endet bei Treffer, Tod und Respawn', () => {
  const s = world();
  const g = addGround(s);
  const p = hang(s, g, 250, 0);
  tick(s, input({ slamPressed: true }));
  assert.equal(p.slam.active, true);
  assert.equal(hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 100, y: 100 }), 'hurt');
  assert.equal(p.slam.active, false);
  tick(s);
  assert.ok(p.vy <= PHYS.MAX_FALL, 'danach gilt MAX_FALL wieder');

  const s2 = world();
  const g2 = addGround(s2);
  const p2 = hang(s2, g2, 250, 0);
  s2.lives = 1;
  tick(s2, input({ slamPressed: true }));
  assert.equal(hurtPlayer(s2, { kind: 'enemy', label: 'Test', x: 100, y: 100 }), 'dead');
  assert.equal(p2.slam.active, false);
  ticks(s2, 5, input({ slamPressed: true }));
  assert.equal(p2.slam.active, false, 'ein toter Spieler stürzt nicht');

  // Stun allein (zum Beispiel von außen gesetzt) beendet ihn ebenfalls
  const s3 = world();
  const g3 = addGround(s3);
  const p3 = hang(s3, g3, 250, 0);
  tick(s3, input({ slamPressed: true }));
  p3.stun = 0.1;
  tick(s3);
  assert.equal(p3.slam.active, false);

  // Respawn
  const s4 = world();
  const g4 = addGround(s4);
  const p4 = hang(s4, g4, 250, 0);
  s4.camX = -3000;
  tick(s4, input({ slamPressed: true }));
  respawnPlayer(s4);
  assert.equal(p4.slam.active, false);
  assert.equal(p4.glide, false);
  assert.equal(p4.dash.air, false);
});

test('Verschwindet der Boden im Sturzflug, endet er und der Spieler kann sich retten', () => {
  const s = world();
  const br = createBreakablePlatform(s, -200, GROUND_Y, 400);
  s.platforms.push(br);
  const p = hang(s, br, 300, 0);
  tick(s, input({ slamPressed: true }));
  assert.equal(p.slam.active, true);
  br.state = 'broken'; // bricht unter ihm weg
  tick(s);
  assert.equal(p.slam.active, false);
  assert.ok(p.vy <= PHYS.MAX_FALL);
  // der Doppelsprung rettet ihn
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.vy < -500, `Luftsprung ${p.vy}`);
});

test('Stampfen auf einer Sprungwolke: Schockwelle und volle Sprungwolke', () => {
  const s = world();
  const sp = createSpringPlatform(s, -200, GROUND_Y, 400);
  s.platforms.push(sp);
  const p = hang(s, sp, 200, 0);
  tick(s, input({ slamPressed: true }));
  for (let i = 0; i < 40 && p.slam.active; i++) tick(s);
  assert.equal(sfxCount(s, 'slam'), 1);
  assert.equal(sfxCount(s, 'spring'), 1);
  assert.equal(p.vy, -SPRING.SPEED, 'die Sprungwolke bestimmt den Abflug');
});

// ---------- Sprungwolke ----------

function springWorld(launch) {
  const s = world();
  const sp = createSpringPlatform(s, -300, GROUND_Y, 600);
  if (launch) sp.launch = launch;
  s.platforms.push(sp);
  return { s, sp };
}

test('Sprungwolke: Höhe etwa 233 px, auch ohne gehaltene Taste', () => {
  for (const held of [true, false]) {
    const { s, sp } = springWorld();
    const p = hang(s, sp, 12, 0);
    let launched = false;
    let minY = Infinity;
    const yLand = sp.y - p.h;
    for (let i = 0; i < 160; i++) {
      tick(s, input({ jumpHeld: held }));
      if (!launched && p.vy < 0) {
        launched = true;
        assert.equal(p.vy, -SPRING.SPEED);
        assert.equal(p.jumps, 1);
        assert.equal(p.glideT, 0);
        assert.equal(p.dash.air, false);
        assert.equal(p.onGround, false);
        assert.equal(p.groundId, 0);
        assert.equal(sp.press, 1);
        assert.ok(p.squashX < 0.9 && p.squashY > 1.1, 'Stretch');
        assert.equal(sfxCount(s, 'spring'), 1);
      }
      if (launched) minY = Math.min(minY, p.y);
      if (launched && p.vy > 0) break;
    }
    assert.ok(launched);
    const rise = yLand - minY;
    const expected = SPRING.SPEED ** 2 / (2 * PHYS.GRAVITY);
    assert.ok(Math.abs(rise - 233) < 3, `Höhe ${rise} (gehalten ${held})`);
    assert.ok(Math.abs(rise - expected) < 1.5, `Höhe ${rise} gegen ${expected}`);
  }
});

test('Sprungwolke: waagerechte Geschwindigkeit bleibt, Gehen auf die Wolke löst aus, wiederholt sich', () => {
  const s = world();
  const A = createStaticPlatform(s, -400, GROUND_Y, 400, { ground: true });
  const sp = createSpringPlatform(s, 0, GROUND_Y, 300);
  s.platforms.push(A, sp);
  const p = standOn(s, A, -200);
  let launchedAt = -1;
  for (let i = 0; i < 200 && launchedAt < 0; i++) {
    tick(s, input({ move: 1 }));
    if (p.vy < -900) launchedAt = i;
  }
  assert.ok(launchedAt >= 0, 'zu Fuß auf die Sprungwolke geschleudert');
  assert.ok(p.vx > 0.95 * MOVE, `behält Tempo ${p.vx}`);
  // Er fällt zurück und wird wieder hochgeworfen
  let second = false;
  for (let i = 0; i < 200 && !second; i++) {
    tick(s, input({ move: 0 }));
    if (p.vy < -900 && i > 20) second = true;
  }
  assert.ok(second, 'zweiter Abwurf');
  assert.equal(sfxCount(s, 'spring'), 2);
});

test('Sprungwolke: eigener Wert launch, Sprungdruck kurz vor der Landung ersetzt den Abwurf nicht', () => {
  const { s, sp } = springWorld(700);
  const p = hang(s, sp, 12, 0);
  tick(s, input());
  while (p.vy >= 0) tick(s);
  assert.equal(p.vy, -700);

  const { s: s2, sp: sp2 } = springWorld();
  const p2 = hang(s2, sp2, 40, 0);
  p2.jumps = 2; // kein Luftsprung mehr, der Druck bleibt im Puffer
  tick(s2, input({ jumpPressed: true, jumpHeld: true }));
  for (let i = 0; i < 40 && p2.vy >= 0; i++) tick(s2, input({ jumpHeld: true }));
  assert.ok(p2.vy <= -SPRING.SPEED, `voller Abwurf ${p2.vy}`);
  tick(s2, input({ jumpHeld: true }));
  assert.ok(p2.vy < -900, `kein Luftsprung danach (${p2.vy})`);
  assert.equal(p2.power.feather, 0);
});

test('Sprungwolke: nur Landung von oben, von unten fliegt er hindurch', () => {
  const { s, sp } = springWorld();
  const p = hang(s, sp, -60, 0); // 60 px unter der Oberkante
  p.vy = -400;
  ticks(s, 6);
  assert.equal(p.onGround, false);
  assert.equal(sfxCount(s, 'spring'), 0);
});

test('Sprungwolke im Dash: kein Abwurf mitten im Dash, gleich danach schon', () => {
  const s = world();
  const A = createStaticPlatform(s, -400, GROUND_Y, 400, { ground: true });
  const sp = createSpringPlatform(s, 0, GROUND_Y, 400);
  s.platforms.push(A, sp);
  const p = standOn(s, A, -60);
  tick(s, input({ dashPressed: true, move: 1 }));
  let guard = 0;
  while (p.dash.t > 0 && guard++ < 30) {
    assert.equal(sfxCount(s, 'spring'), 0, 'im Dash noch kein Abwurf');
    assert.ok(p.vy >= 0, 'im Dash nie nach oben');
    tick(s, input({ move: 1 }));
  }
  assert.equal(p.dash.t, 0);
  assert.ok(p.x > 0, 'steht schon auf der Wolke');
  assert.equal(sfxCount(s, 'spring'), 1, 'gleich nach dem Dash geworfen, genau einmal');
  assert.equal(p.vy, -SPRING.SPEED);
});

// ---------- Eiswolke ----------

// Läuft auf Volltempo, lässt los und misst den Bremsweg bis zum Stillstand
function brakeDistance(plat, prep) {
  const s = world();
  const g = createStaticPlatform(s, -3000, GROUND_Y, 6000, { ground: true, slick: plat.slick });
  s.platforms.push(g);
  if (prep) prep(s);
  const p = standOn(s, g, 0);
  ticks(s, 60, input({ move: 1 }));
  assert.equal(p.vx, MOVE);
  const x0 = p.x;
  let n = 0;
  while (p.vx > 0 && n < 600) {
    tick(s);
    n++;
  }
  return { dist: p.x - x0, time: n * STEP, s, p };
}

test('Eiswolke: Bremsweg deutlich länger als auf normalem Boden, p.slick', () => {
  const normal = brakeDistance({ slick: false });
  const ice = brakeDistance({ slick: true });
  const expected = (MOVE * MOVE) / (2 * PHYS.GROUND_DECEL * ICE.DECEL_MULT);
  assert.ok(normal.dist < 20, `normal ${normal.dist}`);
  assert.ok(Math.abs(ice.dist - expected) < 12, `Eis ${ice.dist}, erwartet ${expected}`);
  assert.ok(ice.dist > normal.dist * 8, 'Eis rutscht viel weiter');
  assert.ok(Math.abs(ice.time - MOVE / (PHYS.GROUND_DECEL * ICE.DECEL_MULT)) < 0.08, `Bremszeit ${ice.time}`);
});

test('Eiswolke: Beschleunigung langsamer, Umkehr dauert länger', () => {
  const accel = (slick) => {
    const s = world();
    const g = addGround(s, { slick });
    const p = standOn(s, g, 0);
    let n = 0;
    while (p.vx < MOVE && n < 200) {
      tick(s, input({ move: 1 }));
      n++;
    }
    const t = n * STEP;
    let m = 0;
    while (p.vx > -MOVE && m < 400) {
      tick(s, input({ move: -1 }));
      m++;
    }
    return { accel: t, turn: m * STEP };
  };
  const normal = accel(false);
  const ice = accel(true);
  assert.ok(Math.abs(ice.accel - MOVE / (PHYS.GROUND_ACCEL * ICE.ACCEL_MULT)) < 0.05, `Eis Beschleunigung ${ice.accel}`);
  assert.ok(ice.accel > normal.accel * 2.5);
  assert.ok(Math.abs(ice.turn - (2 * MOVE) / (PHYS.GROUND_ACCEL * ICE.ACCEL_MULT)) < 0.06, `Eis Umkehr ${ice.turn}`);
  assert.ok(ice.turn > normal.turn * 2.5);
});

test('p.slick gilt nur auf Eis und am Boden', () => {
  const s = world();
  const ice = createStaticPlatform(s, -300, GROUND_Y, 300, { ground: true, slick: true });
  const dry = createStaticPlatform(s, 0, GROUND_Y, 300, { ground: true });
  s.platforms.push(ice, dry);
  const p = standOn(s, ice, -200);
  assert.equal(p.slick, true);
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(p.slick, false, 'in der Luft nicht');
  const q = standOn(world2(dry), dry, 100);
  assert.equal(q.slick, false);
  function world2(plat) {
    const w = world();
    w.platforms.push(plat);
    return w;
  }
});

test('Eis und Regen kombinieren sich über das Minimum, die Luft bleibt unverändert', () => {
  const dry = brakeDistance({ slick: true });
  const wet = brakeDistance({ slick: true }, (s) => {
    const r = createRain(s, -3000, 6000, { y: 0 });
    r.intensity = 1;
    r.active = true;
    s.zones.push(r);
  });
  assert.ok(wet.p.wet > 0.95, `nass ${wet.p.wet}`);
  assert.ok(Math.abs(wet.dist - dry.dist) < 12, `Eis allein ${dry.dist}, mit Regen ${wet.dist}`);
  // Regen allein ist weniger rutschig als Eis
  const rain = (() => {
    const s = world();
    const g = addGround(s);
    const r = createRain(s, -3000, 6000, { y: 0 });
    r.intensity = 1;
    r.active = true;
    s.zones.push(r);
    const p = standOn(s, g, 0);
    ticks(s, 60, input({ move: 1 }));
    const x0 = p.x;
    let n = 0;
    while (p.vx > 0 && n < 600) {
      tick(s);
      n++;
    }
    return p.x - x0;
  })();
  assert.ok(rain < dry.dist, `Regen ${rain} gegen Eis ${dry.dist}`);

  // Luft: Abbremsen mit AIR_DECEL wie auf normalem Boden
  const s = world();
  const g = addGround(s, { slick: true });
  const p = standOn(s, g, 0);
  ticks(s, 60, input({ move: 1 }));
  tick(s, input({ move: 1, jumpPressed: true, jumpHeld: true }));
  const v0 = p.vx;
  tick(s, input({ jumpHeld: true }));
  assert.ok(Math.abs(v0 - p.vx - PHYS.AIR_DECEL * STEP) < 1e-6, 'Luftbremse unverändert');
});

test('Respawn wählt keine Eiswolke', () => {
  const s = world();
  s.camX = 1000;
  const ice = createStaticPlatform(s, 1100, 360, 400, { slick: true });
  const dry = createStaticPlatform(s, 1600, 360, 300);
  s.platforms.push(ice, dry);
  respawnPlayer(s);
  assert.equal(s.player.groundId, dry.id);
  assert.equal(s.player.slick, false);
});

// ---------- Blinkwolke ----------

test('Blinkwolke trägt, solange sie fest ist; verschwindet sie, fällt der Spieler mit Coyote Time', () => {
  const s = world();
  const b = createBlinkPlatform(s, -200, GROUND_Y, 400, { period: 3.4, on: 0.62, phase: 0 });
  s.platforms.push(b);
  tick(s);
  const p = standOn(s, b, 0);
  let gone = -1;
  for (let i = 0; i < 400 && gone < 0; i++) {
    tick(s);
    if (!b.solid) gone = i;
    else assert.equal(p.onGround, true, 'trägt, solange sie fest ist');
  }
  assert.ok(gone >= 0, 'sie verschwindet');
  assert.equal(p.onGround, false, 'er steht nicht mehr drauf');
  assert.equal(p.coyote, PHYS.COYOTE, 'Coyote Fenster beginnt jetzt');
  const y0 = p.y;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.ok(p.vy < -640, `Bodensprung im Coyote Fenster ${p.vy}`);
  assert.ok(p.y < y0 + 1);

  // ohne Sprung fällt er einfach
  const s2 = world();
  const b2 = createBlinkPlatform(s2, -200, GROUND_Y, 400, { period: 3.4, on: 0.62, phase: 0 });
  s2.platforms.push(b2);
  tick(s2);
  const p2 = standOn(s2, b2, 0);
  for (let i = 0; i < 400 && b2.solid; i++) tick(s2);
  const yGone = p2.y;
  ticks(s2, 20);
  assert.ok(p2.y > yGone + 30, 'fällt');
});

test('Blinkwolke: im ausgeblendeten Zustand keine Landung', () => {
  const s = world();
  const b = createBlinkPlatform(s, -200, GROUND_Y, 400, { period: 3.4, on: 0.62, phase: 0.7 });
  s.platforms.push(b);
  tick(s);
  assert.equal(b.solid, false, 'Testaufbau: Phase liegt im Aus');
  const p = hang(s, b, 20, 0);
  ticks(s, 10);
  assert.equal(p.onGround, false);
  assert.ok(p.y > b.y - p.h, 'fällt hindurch');
});

// ---------- Sternenwurf aus dem Spieler ----------

test('throwPressed wirft einen Stern in Blickrichtung, nicht im Dash und nicht gestunnt', () => {
  const s = world();
  s.camX = -200;
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.ammo = 3;
  p.face = -1;
  tick(s, input({ throwPressed: true }));
  assert.equal(s.shots.length, 1);
  assert.ok(s.shots[0].vx < 0, 'nach links');
  assert.equal(p.ammo, 2);
  assert.ok(Math.abs(p.throwCd - (SHOT.COOLDOWN - 0)) < STEP * 2);
  assert.equal(sfxCount(s, 'throw'), 1);

  // Dash
  const s2 = world();
  const g2 = addGround(s2);
  const p2 = standOn(s2, g2, 0);
  p2.ammo = 2;
  tick(s2, input({ dashPressed: true, throwPressed: true, move: 1 }));
  assert.equal(s2.shots.length, 0, 'im Dash nicht');
  assert.equal(p2.ammo, 2);

  // gestunnt
  const s3 = world();
  const g3 = addGround(s3);
  const p3 = standOn(s3, g3, 0);
  p3.ammo = 2;
  p3.stun = 0.2;
  tick(s3, input({ throwPressed: true }));
  assert.equal(s3.shots.length, 0);
  assert.equal(p3.ammo, 2);

  // tot
  const s4 = world();
  addGround(s4);
  s4.player.ammo = 2;
  s4.lives = 1;
  hurtPlayer(s4, { kind: 'enemy', label: 'Test', x: 0, y: 0 });
  tick(s4, input({ throwPressed: true }));
  assert.equal(s4.shots.length, 0);
});

test('Die Abklingzeit des Wurfs zählt im Spieler herunter', () => {
  const s = world();
  s.camX = -200;
  const g = addGround(s);
  const p = standOn(s, g, 0);
  p.ammo = 3;
  tick(s, input({ throwPressed: true }));
  const first = s.shots.length;
  tick(s, input({ throwPressed: true }));
  assert.equal(s.shots.length, first, 'zu früh');
  ticks(s, Math.ceil(SHOT.COOLDOWN / STEP) + 1);
  tick(s, input({ throwPressed: true }));
  assert.equal(p.ammo, 1, 'nach der Abklingzeit wieder');
});

// ---------- Töne ----------

test('Töne: jump, doublejump, land, dash, hurt, shieldbreak, die', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  s.sfx.length = 0;
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(sfxCount(s, 'jump'), 1);
  ticks(s, 10, input({ jumpHeld: true }));
  tick(s, input({ jumpPressed: true, jumpHeld: true }));
  assert.equal(sfxCount(s, 'doublejump'), 1);
  for (let i = 0; i < 200 && !p.onGround; i++) tick(s, input({ jumpHeld: noGlide(p) }));
  assert.equal(sfxCount(s, 'land'), 1, 'Landung nach hohem Sprung');
  p.dash.cd = 0;
  tick(s, input({ dashPressed: true, move: 1 }));
  assert.equal(sfxCount(s, 'dash'), 1);
  while (p.dash.t > 0) tick(s);
  p.invuln = 0;

  s.sfx.length = 0;
  p.power.shield = true;
  hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 });
  assert.equal(sfxCount(s, 'shieldbreak'), 1);
  assert.equal(sfxCount(s, 'hurt'), 0, 'Schild: kein Schmerzton');
  p.invuln = 0;
  hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 });
  assert.equal(sfxCount(s, 'hurt'), 1);
  p.invuln = 0;
  s.lives = 1;
  s.sfx.length = 0;
  hurtPlayer(s, { kind: 'enemy', label: 'Test', x: 0, y: 0 });
  assert.equal(sfxCount(s, 'die'), 1);
  assert.equal(sfxCount(s, 'hurt'), 0);
});

test('Harte Landung ist lauter als ein kleiner Hüpfer, kleine Hüpfer sind still', () => {
  const landVol = (h) => {
    const s = world();
    const g = addGround(s);
    const p = hang(s, g, h, 0);
    for (let i = 0; i < 200 && !p.onGround; i++) tick(s);
    const e = s.sfx.find((x) => x.n === 'land');
    return e ? e.v : 0;
  };
  assert.equal(landVol(6), 0, 'kleiner Hüpfer');
  const mid = landVol(80);
  const hard = landVol(900);
  assert.ok(mid > 0 && hard > mid, `mittel ${mid}, hart ${hard}`);
});

// ---------- Fuzz und Determinismus mit allen Tasten ----------

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

function fuzzInput(rnd, state) {
  if (state.i % 25 === 0) state.move = rnd() < 0.15 ? -1 : rnd() < 0.2 ? 0 : 1;
  let jumpPressed = false;
  if (state.holdLeft <= 0 && rnd() < 0.05) {
    jumpPressed = true;
    state.held = true;
    state.holdLeft = Math.floor(rnd() * 40);
  }
  if (state.holdLeft > 0) state.holdLeft--;
  else state.held = false;
  return {
    move: state.move,
    jumpPressed,
    jumpHeld: state.held,
    dashPressed: rnd() < 0.04,
    slamPressed: rnd() < 0.05,
    throwPressed: rnd() < 0.08,
    downHeld: rnd() < 0.1,
  };
}

test('Fuzz: zufällige Eingaben mit allen Tasten, Fähigkeiten bleiben in ihren Grenzen', () => {
  for (let seed = 1; seed <= 14; seed++) {
    const s = newGame(seed);
    const rnd = mulberry(seed * 4099);
    const st = { i: 0, move: 1, held: false, holdLeft: 0 };
    let slams = 0;
    let glides = 0;
    let throws = 0;
    let dashes = 0;
    for (let i = 0; i < 60 * 30; i++) {
      st.i = i;
      const p = s.player;
      if (i % 200 === 0) {
        p.ammo = 3;
        p.power.dashT = rnd() < 0.4 ? 6 : 0;
        p.power.feather = Math.floor(rnd() * 3);
        p.power.shield = rnd() < 0.3;
      }
      if (rnd() < 0.002) hurtPlayer(s, { kind: 'enemy', label: 'Test', x: p.x + (rnd() < 0.5 ? -30 : 30), y: p.y });
      const shotsBefore = s.shots.length;
      stepSim(s, fuzzInput(rnd, st), STEP);
      if (p.slam.active) slams++;
      if (p.glide) glides++;
      if (p.dash.t > 0) dashes++;
      throws += Math.max(0, s.shots.length - shotsBefore);
      if (!p.dead) {
        assert.ok(p.x >= s.camX + PHYS.LEFT_MARGIN - 1e-6, `Seed ${seed} Schritt ${i}: links vom Rand`);
        if (p.onGround) {
          const g = s.platforms.find((pl) => pl.id === p.groundId);
          assert.ok(g, `Seed ${seed} Schritt ${i}: Boden fehlt`);
          assert.ok(Math.abs(p.y + p.h - g.y) < 1e-6, `Seed ${seed} Schritt ${i}: steckt in der Plattform`);
        }
        if (p.slam.active) {
          assert.equal(p.onGround, false, 'Sturzflug nur in der Luft');
          assert.equal(p.dash.t > 0, false, 'nie Dash und Sturzflug zugleich');
          assert.equal(p.glide, false);
        }
        if (p.glide) {
          assert.equal(p.onGround, false);
          assert.ok(p.vy <= GLIDE.FALL + 1e-6, `Seed ${seed} Schritt ${i}: Gleiten zu schnell (${p.vy})`);
        }
        assert.ok(p.y < KILL_Y + 400, 'fällt nicht ewig');
      }
      assert.ok(p.glideT >= 0 && p.glideT <= GLIDE.MAX + 1e-9, `glideT ${p.glideT}`);
      assert.ok(p.ammo >= 0 && p.ammo <= ABILITY.AMMO.MAX, `Wurfsterne ${p.ammo}`);
      assert.ok(p.throwCd >= 0 && p.throwCd <= SHOT.COOLDOWN + 1e-9);
      assert.ok(p.dash.cd >= 0 && p.dash.t >= 0);
      assert.ok(s.shots.length <= 4, 'höchstens 4 Wurfsterne');
      assert.ok(s.sfx.length <= 16);
      if (i % 60 === 0) assert.deepEqual(invariants(s), [], `Seed ${seed} Schritt ${i}`);
      if (s.mode === 'over') break;
    }
    assert.deepEqual(invariants(s), [], `Seed ${seed}`);
    assert.ok(slams + glides + throws + dashes > 0, `Seed ${seed}: Fähigkeiten kamen vor`);
  }
});

test('deterministisch: gleiche Eingaben mit allen Tasten ergeben exakt denselben Zustand', () => {
  const play = () => {
    const s = newGame(21);
    const rnd = mulberry(77);
    const st = { i: 0, move: 1, held: false, holdLeft: 0 };
    for (let i = 0; i < 60 * 15; i++) {
      st.i = i;
      if (i % 150 === 0) s.player.ammo = 3;
      stepSim(s, fuzzInput(rnd, st), STEP);
    }
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test('Der Zustand bleibt kopierbar und enthält nur Daten, auch mit Wurfsternen in der Luft', () => {
  const s = newGame(5);
  s.player.ammo = 3;
  for (let i = 0; i < 90; i++) stepSim(s, input({ move: 1, throwPressed: i % 20 === 0, slamPressed: i % 33 === 0, jumpHeld: true }), STEP);
  const c = structuredClone(s);
  assert.equal(JSON.stringify(c), JSON.stringify(s));
});

test('ungültige Eingaben: Felder fehlen, NaN, null', () => {
  const s = world();
  const g = addGround(s);
  const p = standOn(s, g, 0);
  tick(s, { move: NaN, slamPressed: 'ja', throwPressed: undefined, downHeld: null });
  tick(s, null);
  tick(s, {});
  assert.deepEqual(invariants(s), []);
  assert.equal(p.slam.active, false);
});
