import test from 'node:test';
import assert from 'node:assert/strict';
import { H, POWERUPS, SCORE, STEP } from '../game/constants.js';
import { createPowerup, createStar } from '../game/entities.js';
import { createState } from '../game/state.js';
import { emit } from '../game/particles.js';
import { addBonus, registerKill } from '../game/scoring.js';
import { givePowerup, updateCollectibles } from '../game/collectibles.js';
import { stepSim } from '../game/sim.js';
import { input, invariants, newGame } from './helpers.mjs';

// ---------- Hilfen ----------

// Partikel kommen aus einem anderen Modul. Solange dort noch ein Stub liegt, entfallen nur diese Prüfungen.
const REAL_PARTICLES = (() => {
  const s = createState();
  emit(s, 'poof', 0, 0);
  return s.particles.length > 0;
})();
const needsParticles = REAL_PARTICLES ? false : 'particles.js ist noch ein Stub (emit)';

// Leere Welt, Spieler steht bei Mittelpunkt (322, 317)
function world() {
  const s = createState({ seed: 3 });
  s.camX = 0;
  s.player.x = 300;
  s.player.y = 300;
  return s;
}

const cx = (s) => s.player.x + s.player.w / 2;
const cy = (s) => s.player.y + s.player.h / 2;

function star(s, dx, dy, o) {
  const st = createStar(s, cx(s) + dx, cy(s) + dy, o);
  s.stars.push(st);
  return st;
}

function powerup(s, type, dx, dy) {
  const pu = createPowerup(s, type, cx(s) + dx, cy(s) + dy);
  s.powerups.push(pu);
  return pu;
}

function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateCollectibles(s, STEP);
  }
}

// ---------- Sterne einsammeln ----------

test('Stern wird innerhalb von 26 px in x und 30 px in y eingesammelt', () => {
  const s = world();
  const near = star(s, 25.9, 29.9);
  tick(s);
  assert.equal(near.got, true);
  assert.equal(s.run.stars, 1);
  assert.equal(s.run.bonus, SCORE.STAR);
  assert.equal(s.stars.includes(near), false, 'eingesammelte Sterne werden entfernt');
});

test('Stern knapp außerhalb des Radius bleibt liegen', () => {
  const s = world();
  const a = star(s, 26, 0);
  const b = star(s, 0, 30);
  const c = star(s, -26.5, -10);
  tick(s, 10);
  assert.deepEqual(s.stars, [a, b, c]);
  assert.equal(s.run.stars, 0);
  assert.equal(s.run.bonus, 0);
});

test('Sterne links, rechts, oben und unten vom Spieler zählen gleich', () => {
  const s = world();
  star(s, -20, 0);
  star(s, 20, 0);
  star(s, 0, -25);
  star(s, 0, 25);
  tick(s);
  assert.equal(s.run.stars, 4);
  assert.equal(s.stars.length, 0);
});

test('Risikostern bringt 25 und Ereignisstern 5 Punkte', () => {
  const s = world();
  star(s, 0, 0, { value: SCORE.RISK_STAR, bonus: 'risk', falling: true });
  star(s, 10, 0, { value: SCORE.EVENT_STAR, bonus: 'event' });
  tick(s);
  assert.equal(s.run.bonus, SCORE.RISK_STAR + SCORE.EVENT_STAR);
  assert.equal(s.run.stars, 2);
});

test('bereits eingesammelte Sterne werden ohne Punkte entfernt', () => {
  const s = world();
  const gone = star(s, 500, 0);
  gone.got = true;
  const keep = star(s, 500, 0);
  tick(s);
  assert.deepEqual(s.stars, [keep]);
  assert.equal(s.run.stars, 0);
});

test('ein Stern wird nur einmal gezählt', () => {
  const s = world();
  star(s, 0, 0);
  tick(s, 30);
  assert.equal(s.run.stars, 1);
  assert.equal(s.run.bonus, SCORE.STAR);
});

test('ein toter Spieler sammelt nichts ein', () => {
  const s = world();
  s.player.dead = true;
  const st = star(s, 0, 0);
  const pu = powerup(s, 'shield', 0, 0);
  tick(s, 5);
  assert.equal(st.got, false);
  assert.equal(pu.got, false);
  assert.equal(s.player.power.shield, false);
  assert.equal(s.stars.length, 1);
  assert.equal(s.powerups.length, 1);
});

test('die Reihenfolge der übrigen Sterne bleibt erhalten', () => {
  const s = world();
  const a = star(s, 300, 0);
  star(s, 0, 0);
  const b = star(s, 400, 0);
  star(s, 5, 5);
  const c = star(s, -300, 0);
  tick(s);
  assert.deepEqual(s.stars, [a, b, c]);
});

// ---------- Magnet ----------

test('Magnet: Sterne im Radius 170 fliegen mit 420 px pro Sekunde zum Spieler', () => {
  const s = world();
  s.player.power.magnetT = 5;
  const st = star(s, 150, 0);
  tick(s, 10);
  assert.ok(Math.abs(150 - (st.x - cx(s)) - 420 * (10 / 60)) < 0.5, `x ${st.x - cx(s)}`);
  assert.equal(st.y, cy(s));
  tick(s, 20);
  assert.equal(st.got, true, 'wird auf dem Weg eingesammelt');
  assert.equal(s.run.stars, 1);
});

test('Magnet: der Radius gilt für den echten Abstand, nicht nur für x', () => {
  const s = world();
  s.player.power.magnetT = 5;
  const inside = star(s, 100, 130); // Abstand etwa 164
  const outside = star(s, 120, 125); // Abstand etwa 173
  const beyond = star(s, 171, 0);
  const x0 = inside.x;
  tick(s);
  assert.notEqual(inside.x, x0);
  assert.equal(outside.x, cx(s) + 120);
  assert.equal(outside.y, cy(s) + 125);
  assert.equal(beyond.x, cx(s) + 171);
});

test('Magnet: ohne Magnet bewegt sich kein Stern', () => {
  const s = world();
  const st = star(s, 100, 0);
  tick(s, 30);
  assert.equal(st.x, cx(s) + 100);
});

test('Magnet: nach Ablauf der Zeit wirkt er nicht mehr', () => {
  const s = world();
  s.player.power.magnetT = 0.1;
  const st = star(s, 165, 0);
  tick(s, 8);
  const moved = st.x;
  assert.ok(moved < cx(s) + 165 - 35 && moved > cx(s) + 165 - 60);
  tick(s, 30);
  assert.equal(s.player.power.magnetT, 0);
  assert.equal(st.x, moved);
});

test('Magnet: zieht auch fallende Sterne, die dabei nicht fallen', () => {
  const s = world();
  s.player.power.magnetT = 5;
  const st = star(s, 100, -80, { value: SCORE.RISK_STAR, bonus: 'risk', falling: true });
  tick(s, 2);
  const dy = st.y - (cy(s) - 80);
  assert.ok(dy > 0 && dy < 12, 'bewegt sich zum Spieler, aber nicht mit der Fallgeschwindigkeit dazu');
  tick(s, 30);
  assert.equal(st.got, true);
  assert.equal(s.run.bonus, SCORE.RISK_STAR);
});

test('Magnet: bei einem Sprung in den Spieler landet der Stern genau auf ihm', () => {
  const s = world();
  s.player.power.magnetT = 5;
  const st = star(s, 160, 0);
  // große Schrittweite: der Stern darf nicht über den Spieler hinausschießen
  s.t += 0.5;
  updateCollectibles(s, 0.5);
  assert.equal(st.got, true);
});

// ---------- Timer ----------

test('dashT und magnetT zählen herunter und werden nie negativ', () => {
  const s = world();
  s.player.power.dashT = 8;
  s.player.power.magnetT = 2;
  tick(s, 60);
  assert.ok(Math.abs(s.player.power.dashT - 7) < 1e-9);
  assert.ok(Math.abs(s.player.power.magnetT - 1) < 1e-9);
  tick(s, 61);
  assert.equal(s.player.power.magnetT, 0);
  assert.ok(s.player.power.dashT > 5.9 && s.player.power.dashT < 6);
  tick(s, 60 * 8);
  assert.equal(s.player.power.dashT, 0);
});

test('kaputte Timerwerte werden zu 0', () => {
  const s = world();
  s.player.power.dashT = NaN;
  s.player.power.magnetT = -3;
  s.player.power.double = NaN;
  tick(s);
  assert.equal(s.player.power.dashT, 0);
  assert.equal(s.player.power.magnetT, 0);
  assert.equal(s.player.power.double, 0);
  s.player.power.double = -2;
  tick(s);
  assert.equal(s.player.power.double, 0);
  delete s.player.power.double; // ältere Zustände kennen das Feld noch nicht
  assert.doesNotThrow(() => tick(s));
  assert.equal(s.player.power.double, 0);
});

test('Schritte ohne Zeit verändern nichts', () => {
  const s = world();
  s.player.power.dashT = 4;
  s.player.power.double = 6;
  star(s, 0, 0);
  powerup(s, 'dash', 0, 0);
  const before = structuredClone(s);
  for (const dt of [0, -1, NaN, undefined]) updateCollectibles(s, dt);
  assert.deepEqual(s, before);
});

test('im Spiel zählt nur collectibles.js die Zeit herunter', () => {
  const s = newGame(5);
  s.player.power.dashT = 8;
  s.player.power.magnetT = 8;
  s.player.power.double = 8;
  for (let i = 0; i < 60; i++) stepSim(s, input(), STEP);
  assert.ok(Math.abs(s.player.power.dashT - 7) < 0.1, `dashT ${s.player.power.dashT}`);
  assert.ok(Math.abs(s.player.power.magnetT - 7) < 0.1, `magnetT ${s.player.power.magnetT}`);
  assert.ok(Math.abs(s.player.power.double - 7) < 0.1, `double ${s.player.power.double}`);
});

// ---------- Powerups ----------

test('Powerup wird bei Abstand unter 30 eingesammelt', () => {
  const s = world();
  const inside = powerup(s, 'shield', 29, 0);
  const diag = powerup(s, 'dash', 20, 20); // Abstand etwa 28,3
  const edge = powerup(s, 'magnet', 30, 0);
  const diagOut = powerup(s, 'feather', 22, 22); // Abstand etwa 31,1
  tick(s);
  assert.equal(inside.got, true);
  assert.equal(diag.got, true);
  assert.equal(edge.got, false);
  assert.equal(diagOut.got, false);
  assert.deepEqual(s.powerups, [edge, diagOut], 'eingesammelte Powerups werden entfernt');
});

test('Schild setzt power.shield', () => {
  const s = world();
  powerup(s, 'shield', 0, 0);
  tick(s);
  assert.equal(s.player.power.shield, true);
});

test('Dash setzt dashT auf die volle Dauer und addiert nicht', () => {
  const s = world();
  powerup(s, 'dash', 0, 0);
  tick(s);
  assert.equal(s.player.power.dashT, POWERUPS.dash.duration);
  tick(s, 120);
  assert.ok(s.player.power.dashT < 6.1);
  powerup(s, 'dash', 0, 0);
  tick(s);
  assert.equal(s.player.power.dashT, POWERUPS.dash.duration);
});

test('Magnet Powerup setzt magnetT auf die volle Dauer', () => {
  const s = world();
  powerup(s, 'magnet', 0, 0);
  tick(s);
  assert.equal(s.player.power.magnetT, POWERUPS.magnet.duration);
});

test('Feder erhöht die Ladungen bis maxCharges und verbraucht sich auch am Maximum', () => {
  const s = world();
  for (let i = 0; i < 3; i++) {
    powerup(s, 'feather', 0, 0);
    tick(s);
    assert.equal(s.player.power.feather, Math.min(POWERUPS.feather.maxCharges, i + 1));
  }
  assert.equal(s.powerups.length, 0);
});

test('Popup zeigt das Label des Powerups', () => {
  for (const type of ['shield', 'dash', 'magnet', 'feather', 'double']) {
    const s = world();
    powerup(s, type, 0, 0);
    tick(s);
    const last = s.popups[s.popups.length - 1];
    assert.equal(last.text, POWERUPS[type].label);
    assert.equal(last.color, POWERUPS[type].color);
  }
});

test('Powerup erzeugt Partikel', { skip: needsParticles }, () => {
  const s = world();
  powerup(s, 'shield', 0, 0);
  tick(s);
  assert.ok(s.particles.length > 0);
});

test('givePowerup wirkt direkt und kennt nur die fünf Typen', () => {
  const s = world();
  assert.equal(givePowerup(s, 'shield'), true);
  assert.equal(givePowerup(s, 'dash'), true);
  assert.equal(givePowerup(s, 'magnet'), true);
  assert.equal(givePowerup(s, 'feather'), true);
  assert.equal(givePowerup(s, 'double'), true);
  const p = s.player.power;
  assert.deepEqual(p, { shield: true, dashT: 8, magnetT: 8, feather: 1, double: 10 });
  const before = structuredClone(s);
  for (const bad of ['nope', 'constructor', '', undefined, null, 7]) assert.equal(givePowerup(s, bad), false);
  assert.deepEqual(s, before);
});

test('ein Powerup mit unbekanntem Typ wird entfernt, ohne etwas zu bewirken', () => {
  const s = world();
  powerup(s, 'banane', 0, 0);
  tick(s);
  assert.equal(s.powerups.length, 0);
  assert.deepEqual(s.player.power, { shield: false, dashT: 0, magnetT: 0, feather: 0, double: 0 });
});

test('Powerup im Spiel: einsammeln, Wirkung, Zeitablauf', () => {
  const s = newGame(6);
  const p = s.player;
  const pu = createPowerup(s, 'dash', p.x + p.w / 2, p.y + p.h / 2);
  s.powerups.push(pu);
  stepSim(s, input(), STEP);
  assert.equal(pu.got, true);
  assert.equal(s.powerups.includes(pu), false);
  assert.ok(p.power.dashT > 7.9 && p.power.dashT <= 8);
});

// ---------- Doppelpunkte ----------

test('Doppelpunkte: das Powerup setzt power.double auf die volle Dauer und addiert nicht', () => {
  const s = world();
  assert.equal(s.player.power.double, 0);
  powerup(s, 'double', 0, 0);
  tick(s);
  assert.equal(s.player.power.double, POWERUPS.double.duration);
  assert.equal(POWERUPS.double.duration, 10);
  tick(s, 120);
  assert.ok(Math.abs(s.player.power.double - 8) < 1e-6, `double ${s.player.power.double}`);
  powerup(s, 'double', 0, 0);
  tick(s);
  assert.equal(s.player.power.double, POWERUPS.double.duration, 'wird aufgefüllt, nicht addiert');
  assert.equal(s.powerups.length, 0);
});

test('Doppelpunkte: der Timer zählt herunter und wird nie negativ', () => {
  const s = world();
  s.player.power.double = 2;
  tick(s, 60);
  assert.ok(Math.abs(s.player.power.double - 1) < 1e-9);
  let last = s.player.power.double;
  for (let i = 0; i < 200; i++) {
    tick(s);
    assert.ok(s.player.power.double >= 0 && s.player.power.double <= last);
    last = s.player.power.double;
  }
  assert.equal(s.player.power.double, 0);
});

test('Doppelpunkte: Sterne zählen doppelt, solange Zeit da ist, danach wieder einfach', () => {
  const s = world();
  s.player.power.double = 1;
  star(s, 0, 0);
  star(s, 5, 0, { value: SCORE.RISK_STAR, bonus: 'risk' });
  star(s, -5, 0, { value: SCORE.EVENT_STAR, bonus: 'event' });
  tick(s);
  assert.equal(s.run.bonus, 2 * (SCORE.STAR + SCORE.RISK_STAR + SCORE.EVENT_STAR));
  assert.equal(s.run.stars, 3, 'die Zahl der Sterne bleibt einfach');
  tick(s, 61);
  assert.equal(s.player.power.double, 0);
  const before = s.run.bonus;
  star(s, 0, 0);
  tick(s);
  assert.equal(s.run.bonus - before, SCORE.STAR);
});

test('Doppelpunkte: im letzten Schritt mit Restzeit zählt noch doppelt, danach nicht mehr', () => {
  const s = world();
  s.player.power.double = STEP;
  star(s, 0, 0);
  tick(s);
  assert.equal(s.run.bonus, 2 * SCORE.STAR);
  assert.equal(s.player.power.double, 0);
  star(s, 0, 0);
  tick(s);
  assert.equal(s.run.bonus, 3 * SCORE.STAR);
});

test('Doppelpunkte: addBonus verdoppelt jeden Bonus, kaputte Werte zählen einfach', () => {
  const s = world();
  addBonus(s, 7);
  assert.equal(s.run.bonus, 7);
  s.player.power.double = 3;
  addBonus(s, 7);
  assert.equal(s.run.bonus, 21);
  for (const bad of [0, -1, NaN, undefined]) {
    s.player.power.double = bad;
    addBonus(s, 1);
  }
  assert.equal(s.run.bonus, 25);
});

test('Doppelpunkte: nach dem Einsammeln zählen die nächsten Sterne doppelt', () => {
  const s = world();
  powerup(s, 'double', 0, 0);
  tick(s);
  assert.equal(s.run.bonus, 0);
  star(s, 0, 0);
  tick(s);
  assert.equal(s.run.bonus, 2 * SCORE.STAR);
});

test('Doppelpunkte: auch vom Magnet gezogene Sterne und Gegner Treffer zählen doppelt', () => {
  const s = world();
  s.player.power.double = 5;
  s.player.power.magnetT = 5;
  star(s, 150, 0);
  tick(s, 30);
  assert.equal(s.run.stars, 1);
  assert.equal(s.run.bonus, 2 * SCORE.STAR);
  const before = s.run.bonus;
  const pts = registerKill(s, { x: 0, y: 0, w: 10, h: 10 }, 'stomp');
  assert.equal(s.run.bonus - before, 2 * pts);
});

test('Doppelpunkte: im echten Simulationsschritt', () => {
  const s = newGame(6);
  const p = s.player;
  p.power.double = 5;
  s.stars.push(createStar(s, p.x + p.w / 2, p.y + p.h / 2));
  stepSim(s, input(), STEP);
  assert.equal(s.run.bonus, 2 * SCORE.STAR);
  assert.ok(Math.abs(p.power.double - (5 - STEP)) < 1e-6);
});

// ---------- Ton und Typen ----------

test('jedes eingesammelte Powerup spielt den Ton powerup, ein Stern nicht', () => {
  const s = world();
  star(s, 0, 0);
  tick(s);
  assert.equal(s.sfx.filter((e) => e.n === 'powerup').length, 0);
  powerup(s, 'shield', 0, 0);
  powerup(s, 'double', 5, 0);
  tick(s);
  assert.equal(s.sfx.filter((e) => e.n === 'powerup').length, 2);
  givePowerup(s, 'feather');
  assert.equal(s.sfx.filter((e) => e.n === 'powerup').length, 3);
  const n = s.sfx.length;
  givePowerup(s, 'nope');
  assert.equal(s.sfx.length, n, 'unbekannte Typen bleiben stumm');
});

test('POWERUPS und collectibles.js kennen dieselben fünf Typen', () => {
  assert.deepEqual(Object.keys(POWERUPS).sort(), ['dash', 'double', 'feather', 'magnet', 'shield']);
  for (const type of Object.keys(POWERUPS)) {
    const s = world();
    assert.equal(givePowerup(s, type), true, type);
    assert.equal(s.popups[s.popups.length - 1].text, POWERUPS[type].label);
    if (REAL_PARTICLES) assert.ok(s.particles.length > 0, `${type} erzeugt Partikel`);
  }
});

test('Doppelpunkte: Label und Farbe stehen in den Konstanten, ohne Striche', () => {
  assert.equal(POWERUPS.double.label, 'Doppelpunkte');
  assert.match(POWERUPS.double.color, /^#[0-9a-f]{6}$/i);
  const dashes = ['-', String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  for (const def of Object.values(POWERUPS)) assert.ok(!dashes.some((d) => def.label.includes(d)), def.label);
});

// ---------- Fallende Sterne ----------

test('fallender Stern wartet, solange der Spieler weiter als triggerDist entfernt ist', () => {
  const s = world();
  const st = star(s, 500, -100, { falling: true, bonus: 'risk', value: SCORE.RISK_STAR });
  assert.equal(st.started, false);
  tick(s, 120);
  assert.equal(st.started, false);
  assert.equal(st.y, cy(s) - 100);
  assert.equal(st.vy, 0);
});

test('fallender Stern startet erst bei Abstand kleiner als triggerDist', () => {
  const s = world();
  const exact = star(s, 420, -100, { falling: true });
  const inside = star(s, 419.9, -100, { falling: true });
  tick(s);
  assert.equal(exact.started, false);
  assert.equal(inside.started, true);
  assert.equal(inside.vy, 70);
});

test('fallender Stern nutzt eigenes triggerDist und fallSpeed', () => {
  const s = world();
  const st = star(s, 200, -100, { falling: true, triggerDist: 150, fallSpeed: 140 });
  tick(s, 10);
  assert.equal(st.started, false);
  s.player.x += 60; // Abstand jetzt 140
  tick(s);
  assert.equal(st.started, true);
  assert.equal(st.vy, 140);
});

test('fallender Stern fällt linear mit fallSpeed', () => {
  const s = world();
  const st = star(s, 300, -100, { falling: true });
  const y0 = st.y;
  tick(s, 60);
  assert.ok(Math.abs(st.y - y0 - 70) < 1e-6, `Fall ${st.y - y0}`);
  tick(s, 60);
  assert.ok(Math.abs(st.y - y0 - 140) < 1e-6);
  assert.equal(st.x, cx(s) + 300, 'x bleibt gleich');
});

test('ein schon gestarteter Stern ohne Geschwindigkeit fällt trotzdem', () => {
  const s = world();
  const st = star(s, 300, -100, { falling: true });
  st.started = true;
  st.vy = 0;
  tick(s, 60);
  assert.ok(Math.abs(st.y - (cy(s) - 100) - 70) < 1e-6);
});

test('fallender Stern verschwindet unter H plus 40', () => {
  const s = world();
  const st = star(s, 300, 0, { falling: true });
  st.y = 150;
  const frames = Math.ceil(((H + 40 - 150) / 70) * 60);
  tick(s, frames - 5);
  assert.equal(s.stars.includes(st), true);
  assert.ok(st.y <= H + 40);
  tick(s, 10);
  assert.equal(s.stars.includes(st), false);
  assert.equal(s.run.stars, 0, 'verschwundene Sterne zählen nicht');
});

test('ein Stern am oberen Bildrand bleibt mehrere Sekunden erreichbar, bevor er verschwindet', () => {
  const s = world();
  const st = star(s, 300, 0, { falling: true });
  st.y = -10;
  tick(s, 60 * 4);
  assert.equal(s.stars.includes(st), true);
  assert.ok(st.y > 200 && st.y < H, `y ${st.y}`);
  // erst nach rund sieben Sekunden ist er unten aus dem Bild
  tick(s, 60 * 3.5);
  assert.equal(s.stars.includes(st), false);
});

test('fallender Stern kann im Fallen eingesammelt werden', () => {
  const s = world();
  const st = star(s, 0, -120, { falling: true, bonus: 'risk', value: SCORE.RISK_STAR });
  tick(s, 60);
  assert.equal(st.got, false);
  tick(s, 40);
  assert.equal(st.got, true);
  assert.equal(s.run.bonus, SCORE.RISK_STAR);
});

test('fallende Sterne starten auch, wenn der Spieler von rechts kommt', () => {
  const s = world();
  const st = star(s, -300, -100, { falling: true });
  tick(s);
  assert.equal(st.started, true);
});

test('normale Sterne fallen nie', () => {
  const s = world();
  const st = star(s, 100, -100);
  tick(s, 120);
  assert.equal(st.y, cy(s) - 100);
});

// ---------- Zusammenspiel ----------

test('Zustand bleibt kopierbar und kopierte Läufe verlaufen gleich', () => {
  const s = newGame(9);
  const p = s.player;
  for (let i = 0; i < 10; i++) {
    s.stars.push(createStar(s, p.x + 60 + i * 40, 300, { falling: i % 3 === 0, bonus: i % 3 === 0 ? 'risk' : 'normal' }));
  }
  s.powerups.push(createPowerup(s, 'magnet', p.x + 100, 320));
  const a = s;
  const b = structuredClone(s);
  const go = (x) => {
    for (let i = 0; i < 400; i++) stepSim(x, input({ move: 1, jumpPressed: i % 50 === 0, jumpHeld: i % 50 < 20 }), STEP);
  };
  go(a);
  go(b);
  assert.deepEqual(a.stars, b.stars);
  assert.deepEqual(a.powerups, b.powerups);
  assert.deepEqual(a.run, b.run);
  assert.deepEqual(a.player.power, b.player.power);
  assert.doesNotThrow(() => structuredClone(a));
});

// ---------- Fuzz ----------

// Kleiner eigener Zufall nur für die Tests (mulberry32), die Spiellogik bleibt unberührt
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Ein Fuzz Lauf. Prüft jeden Schritt gegen ein einfaches Modell der Regeln und gibt den Endzustand zurück.
function fuzzRun(seed, steps = 300) {
  const r = prng(seed);
  const rr = (a, b) => a + r() * (b - a);
  const s = world();
  const TYPES = ['shield', 'dash', 'magnet', 'feather', 'double', 'banane'];
  const pw = s.player.power;
  // Start mit kaputten oder echten Werten
  for (const k of ['dashT', 'magnetT', 'double']) pw[k] = r() < 0.2 ? [NaN, -3, undefined][Math.floor(r() * 3)] : rr(0, 4);
  const dts = [STEP, STEP, STEP, 1 / 30, 0.1, 0.5];

  for (let i = 0; i < steps; i++) {
    // Welt auffüllen: Sterne und Powerups rund um den Spieler
    if (r() < 0.5) {
      const kind = r();
      const o = kind < 0.6 ? {} : kind < 0.8 ? { falling: true, bonus: 'risk', value: SCORE.RISK_STAR } : { bonus: 'event', value: SCORE.EVENT_STAR, falling: r() < 0.5 };
      star(s, rr(-200, 200), rr(-120, 80), o);
    }
    if (r() < 0.12) powerup(s, TYPES[Math.floor(r() * TYPES.length)], rr(-60, 60), rr(-40, 40));
    if (r() < 0.05) s.player.dead = !s.player.dead;
    if (r() < 0.3) { s.player.x += rr(-40, 60); s.player.y = rr(150, 340); }
    if (r() < 0.08) pw.magnetT = rr(0, 3);
    if (r() < 0.04) pw.double = rr(0, 2);

    const dt = r() < 0.04 ? [0, -1, NaN][Math.floor(r() * 3)] : dts[Math.floor(r() * dts.length)];
    const validDt = dt > 0;
    const startStars = s.stars.filter((st) => !st.got);
    const startUps = s.powerups.filter((pu) => !pu.got);
    const t0 = { dashT: pw.dashT > 0 ? pw.dashT : 0, magnetT: pw.magnetT > 0 ? pw.magnetT : 0, double: pw.double > 0 ? pw.double : 0 };
    const bonus0 = s.run.bonus;
    const count0 = s.run.stars;
    const dead = s.player.dead;
    const frozen = validDt ? null : structuredClone(s);

    s.t += validDt ? dt : 0;
    updateCollectibles(s, dt);

    if (!validDt) {
      assert.deepEqual(s, frozen, 'ungültige Zeit verändert nichts');
      continue;
    }

    // Modell: Sterne zählen doppelt, wenn zu Beginn des Schritts Doppelpunkte Zeit hatten
    const got = startStars.filter((st) => st.got);
    const gotUps = startUps.filter((pu) => pu.got);
    assert.equal(s.run.stars - count0, got.length);
    assert.equal(s.run.bonus - bonus0, got.reduce((sum, st) => sum + st.value * (t0.double > 0 ? 2 : 1), 0), `Schritt ${i}`);
    if (dead) {
      assert.equal(got.length + gotUps.length, 0, 'ein toter Spieler sammelt nichts');
    }
    for (const st of s.stars) assert.equal(st.got, false);
    for (const pu of s.powerups) assert.equal(pu.got, false);
    for (const pu of gotUps) assert.ok(!s.powerups.includes(pu));

    // Modell der Timer: frisch eingesammelte Powerups haben die volle Dauer, sonst zählt die Zeit herunter
    const picked = (type) => gotUps.some((pu) => pu.type === type);
    const expect = (type, start) => (picked(type) ? POWERUPS[type].duration : Math.max(0, start - dt));
    assert.ok(Math.abs(pw.dashT - expect('dash', t0.dashT)) < 1e-9, `dashT Schritt ${i}`);
    assert.ok(Math.abs(pw.magnetT - expect('magnet', t0.magnetT)) < 1e-9, `magnetT Schritt ${i}`);
    assert.ok(Math.abs(pw.double - expect('double', t0.double)) < 1e-9, `double Schritt ${i}`);
    assert.ok(pw.double >= 0 && pw.double <= POWERUPS.double.duration);
    assert.ok(pw.feather >= 0 && pw.feather <= POWERUPS.feather.maxCharges);
    assert.ok(s.sfx.length <= 16);
    if (i % 25 === 0) assert.deepEqual(invariants(s), []);
  }
  assert.deepEqual(invariants(s), []);
  return s;
}

test('Fuzz: Sterne und Powerups gegen ein einfaches Modell, kaputte Werte und Zeiten inklusive', () => {
  for (let seed = 1; seed <= 40; seed++) fuzzRun(seed);
});

test('Fuzz: gleicher Zufall gibt gleichen Endzustand, ein Klon läuft gleich weiter', () => {
  const a = fuzzRun(77);
  const b = fuzzRun(77);
  assert.deepEqual(a, b);
  const c = structuredClone(a);
  for (const x of [a, c]) {
    x.player.power.double = 2;
    star(x, 0, 0);
    star(x, 10, 0);
    for (let i = 0; i < 20; i++) {
      x.t += STEP;
      updateCollectibles(x, STEP);
    }
  }
  assert.deepEqual(a, c);
});
