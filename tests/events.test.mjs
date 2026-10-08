import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, H, LIMITS, METER, SCORE, START_X, STEP, W, gateMeter } from '../game/constants.js';
import { createGate, createMovingPlatform, createStar, createStaticPlatform } from '../game/entities.js';
import { createState } from '../game/state.js';
import { meters } from '../game/scoring.js';
import { updateCollectibles } from '../game/collectibles.js';
import { eventEnvelope, eventWindVx, startEvent, updateEvents } from '../game/events.js';
import { input, invariants, newGame, run } from './helpers.mjs';

// ---------- Hilfen ----------

const TYPES = ['meteor', 'supermoon', 'storm', 'shower'];

function world({ seed = 11, m = 0 } = {}) {
  const s = createState({ seed });
  s.camX = 0;
  s.player.x = 300;
  s.player.y = 300;
  atMeter(s, m);
  s.events.nextMeter = 0;
  return s;
}

// Setzt die Distanz so, dass meters(s) genau m ergibt
function atMeter(s, m) {
  s.run.maxX = START_X + m * METER + 1;
  assert.equal(meters(s), m);
}

function tick(s, n = 1) {
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateEvents(s, STEP);
  }
}

// Zeit in Sekunden, mit oder ohne Sammeln und Fallen der Sterne
function runFor(s, sec, collect = false) {
  const n = Math.round(sec / STEP);
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateEvents(s, STEP);
    if (collect) updateCollectibles(s, STEP);
  }
}

const eventStars = (s) => s.stars.filter((st) => st.bonus === 'event' && !st.got);
// Bindestrich, Halbgeviert und Geviertstrich sind als Satzzeichen verboten
const DASHES = ['-', String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
const hasDash = (text) => DASHES.some((d) => text.includes(d));

// ---------- Start, Ende, Flags ----------

test('startEvent legt das Ereignis an, zählt mit und zeigt das Banner', () => {
  for (const type of TYPES) {
    const s = world();
    assert.equal(startEvent(s, type), true);
    const a = s.events.active;
    assert.equal(a.type, type);
    assert.equal(a.t, 0);
    assert.equal(a.dur, EVENTS[type].dur);
    assert.equal(typeof a.data, 'object');
    assert.equal(s.events.count, 1);
    assert.equal(s.banner.text, EVENTS[type].name);
    assert.ok(s.banner.sub.length > 10 && s.banner.sub.length < 60, `Satz ${type}: ${s.banner.sub}`);
    assert.ok(!hasDash(s.banner.text + s.banner.sub), 'keine Striche in Spieltexten');
    assert.ok(s.banner.sub.endsWith('.'));
  }
});

test('unbekannte Typen werden ignoriert', () => {
  const s = world();
  for (const bad of ['nope', 'constructor', '', undefined, null, 3]) assert.equal(startEvent(s, bad), false);
  assert.equal(s.events.active, null);
  assert.equal(s.events.count, 0);
  assert.equal(s.banner, null);
});

test('Flags: Supermond setzt starBoost, Traumsturm setzt enemyBoost, sonst keines', () => {
  const flags = {};
  for (const type of TYPES) {
    const s = world();
    startEvent(s, type);
    flags[type] = [s.events.starBoost, s.events.enemyBoost];
  }
  assert.deepEqual(flags, {
    meteor: [false, false],
    supermoon: [true, false],
    storm: [false, true],
    shower: [false, false],
  });
});

test('nach Ablauf ist active null und die Flags sind zurückgesetzt', () => {
  for (const type of TYPES) {
    const s = world();
    startEvent(s, type);
    const dur = EVENTS[type].dur;
    runFor(s, dur - 0.1);
    assert.equal(s.events.active.type, type, `${type} läuft noch`);
    assert.equal(s.events.starBoost || s.events.enemyBoost, type === 'supermoon' || type === 'storm');
    runFor(s, 0.2);
    assert.equal(s.events.active, null, `${type} ist vorbei`);
    assert.equal(s.events.starBoost, false);
    assert.equal(s.events.enemyBoost, false);
    assert.equal(eventEnvelope(s), null);
    assert.equal(eventWindVx(s), 0);
  }
});

test('ein Ereignis dauert genau EVENTS dur Sekunden', () => {
  const s = world();
  startEvent(s, 'supermoon');
  let steps = 0;
  while (s.events.active && steps < 5000) {
    tick(s);
    steps++;
  }
  assert.ok(Math.abs(steps * STEP - EVENTS.supermoon.dur) < 3 * STEP, `${steps} Schritte`);
});

test('ein neuer Start ersetzt das laufende Ereignis, es gibt nie zwei', () => {
  const s = world();
  startEvent(s, 'storm');
  tick(s, 100);
  startEvent(s, 'supermoon');
  assert.equal(s.events.active.type, 'supermoon');
  assert.equal(s.events.active.t, 0);
  assert.equal(s.events.enemyBoost, false);
  assert.equal(s.events.starBoost, true);
  assert.equal(s.events.count, 2);
});

test('kaputte Ereignisse werden beendet statt Fehler zu werfen', () => {
  for (const active of [{ type: 'nope', t: 0, dur: 5, data: {} }, { type: 'storm', t: 0, dur: NaN, data: {} }, { type: 'meteor', t: 0, dur: 5 }]) {
    const s = world();
    s.events.active = active;
    s.events.starBoost = true;
    assert.doesNotThrow(() => tick(s));
    assert.equal(s.events.active, null);
    assert.equal(s.events.starBoost, false);
  }
});

test('Schritte ohne Zeit verändern nichts', () => {
  const s = world({ m: 700 });
  startEvent(s, 'meteor');
  const before = structuredClone(s);
  for (const dt of [0, -1, NaN, undefined]) updateEvents(s, dt);
  assert.deepEqual(s, before);
});

// ---------- Hüllkurve ----------

test('Hüllkurve: null ohne Ereignis, sonst Typ, t und dur', () => {
  const s = world();
  assert.equal(eventEnvelope(s), null);
  startEvent(s, 'shower');
  tick(s, 30);
  const e = eventEnvelope(s);
  assert.equal(e.type, 'shower');
  assert.equal(e.dur, EVENTS.shower.dur);
  assert.ok(Math.abs(e.t - 0.5) < 1e-9);
});

test('Hüllkurve blendet in 1,5 Sekunden ein und aus', () => {
  const s = world();
  startEvent(s, 'supermoon');
  const dur = EVENTS.supermoon.dur;
  const at = (t) => { s.events.active.t = t; return eventEnvelope(s).env; };
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(0.75) - 0.5) < 1e-9);
  assert.equal(at(1.5), 1);
  assert.equal(at(dur / 2), 1);
  assert.equal(at(dur - 1.5), 1);
  assert.ok(Math.abs(at(dur - 0.75) - 0.5) < 1e-9);
  assert.equal(at(dur), 0);
  let last = -1;
  for (let t = 0; t <= 1.5; t += 0.05) {
    const v = at(t);
    assert.ok(v >= last && v >= 0 && v <= 1);
    last = v;
  }
  for (let t = 0; t <= dur; t += 0.1) {
    const v = at(t);
    assert.ok(v >= 0 && v <= 1, `env ${v} bei t ${t}`);
  }
});

// ---------- Sturm und Wind ----------

test('Traumsturm: Wind höchstens 70, wechselndes Vorzeichen, ohne Sprünge', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = world({ seed });
    startEvent(s, 'storm');
    let min = 0;
    let max = 0;
    let last = eventWindVx(s);
    assert.equal(last, 0, 'beginnt ohne Wind');
    for (let i = 0; i < EVENTS.storm.dur * 60; i++) {
      tick(s);
      const v = eventWindVx(s);
      assert.ok(Number.isFinite(v));
      assert.ok(Math.abs(v) <= 70, `Wind ${v}`);
      assert.ok(Math.abs(v - last) < 3, `Sprung ${v - last}`);
      last = v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    assert.ok(min < -5 && max > 5, `Seed ${seed}: Wind ${min} bis ${max}`);
  }
});

test('Traumsturm: am Ende wieder ohne Wind, vor und nach dem Ereignis 0', () => {
  const s = world();
  assert.equal(eventWindVx(s), 0);
  startEvent(s, 'storm');
  s.events.active.t = EVENTS.storm.dur;
  assert.equal(eventWindVx(s), 0);
  runFor(s, EVENTS.storm.dur + 1);
  assert.equal(eventWindVx(s), 0);
});

test('Böen unterscheiden sich von Sturm zu Sturm, gleicher Seed gibt gleichen Wind', () => {
  const sample = (seed) => {
    const s = world({ seed });
    startEvent(s, 'storm');
    s.events.active.t = 6;
    return eventWindVx(s);
  };
  assert.equal(sample(5), sample(5));
  const values = new Set([1, 2, 3, 4, 5, 6].map(sample));
  assert.ok(values.size >= 5);
});

test('andere Ereignisse haben keinen Wind', () => {
  for (const type of ['meteor', 'supermoon', 'shower']) {
    const s = world();
    startEvent(s, type);
    for (let t = 0; t < EVENTS[type].dur; t += 0.5) {
      s.events.active.t = t;
      assert.equal(eventWindVx(s), 0);
    }
  }
});

// ---------- Planung ----------

test('vor EVENTS.FIRST_METER und vor nextMeter wird nicht gewürfelt', () => {
  const early = world({ m: EVENTS.FIRST_METER - 1 });
  const rng = early.rng;
  tick(early, 10);
  assert.equal(early.events.active, null);
  assert.equal(early.rng, rng);

  const wait = world({ m: 700 });
  wait.events.nextMeter = 701;
  const rng2 = wait.rng;
  tick(wait, 10);
  assert.equal(wait.events.active, null);
  assert.equal(wait.rng, rng2);
  assert.equal(wait.events.nextMeter, 701);
});

test('ein frischer Spielstand startet frühestens bei state.nextMeter', () => {
  const s = createState({ seed: 3 });
  atMeter(s, 449);
  tick(s, 10);
  assert.equal(s.events.active, null);
  assert.equal(s.events.count, 0);
});

test('Planung: Wurf mit CHANCE, danach nextMeter nach EVERY', () => {
  let started = 0;
  const runs = 200;
  for (let seed = 1; seed <= runs; seed++) {
    const s = world({ seed, m: 700 });
    tick(s);
    if (s.events.active) {
      started++;
      const next = s.events.nextMeter - 700;
      assert.ok(next >= EVENTS.EVERY[0] && next <= EVENTS.EVERY[1], `nextMeter +${next}`);
      assert.equal(s.events.count, 1);
      assert.ok(s.banner);
    } else {
      const next = s.events.nextMeter - 700;
      assert.ok(next > 0 && next < EVENTS.EVERY[0], `Wiederholung +${next}`);
      assert.equal(s.events.count, 0);
      assert.equal(s.banner, null);
    }
  }
  const share = started / runs;
  assert.ok(Math.abs(share - EVENTS.CHANCE) < 0.12, `Anteil ${share}`);
});

test('nach einem Wurf wird bis nextMeter nicht erneut gewürfelt', () => {
  const s = world({ m: 700 });
  tick(s);
  const next = s.events.nextMeter;
  const rng = s.rng;
  s.events.active = null;
  tick(s, 100);
  assert.equal(s.rng, rng);
  assert.equal(s.events.nextMeter, next);
});

test('Typen: Gewichte, und der Traumsturm erst ab 800 Metern', () => {
  const count = (m, n) => {
    const c = { meteor: 0, supermoon: 0, storm: 0, shower: 0 };
    for (let seed = 1; seed <= n; seed++) {
      const s = world({ seed, m });
      tick(s);
      if (s.events.active) c[s.events.active.type]++;
    }
    return c;
  };
  const early = count(700, 400);
  assert.equal(early.storm, 0, 'kein Sturm vor 800 Metern');
  assert.ok(early.meteor > 0 && early.supermoon > 0 && early.shower > 0);
  const late = count(1000, 900);
  for (const type of TYPES) assert.ok(late[type] > 0, `${type} kommt vor`);
  assert.ok(late.meteor > late.supermoon && late.meteor > late.shower && late.meteor > late.storm, JSON.stringify(late));
  assert.equal(count(799, 200).storm, 0);
});

test('nie zwei Ereignisse gleichzeitig: ein laufendes wird nicht überschrieben', () => {
  const s = world({ m: 700 });
  startEvent(s, 'supermoon');
  const active = s.events.active;
  for (let i = 0; i < 100; i++) {
    s.events.nextMeter = 0;
    tick(s);
  }
  assert.equal(s.events.active, active);
  assert.equal(s.events.count, 1);
});

test('während der Spieler stirbt, wird kein Ereignis geplant', () => {
  const s = world({ m: 700 });
  s.player.dead = true;
  const rng = s.rng;
  tick(s, 20);
  assert.equal(s.events.active, null);
  assert.equal(s.rng, rng);
});

// ---------- Abstand zu Toren ----------

// Versucht es mit vielen Seeds bei Meter m. Gibt zurück, ob irgendein Ereignis gestartet wurde
// und den kleinsten nextMeter Wert aller Läufe ohne Start.
function tryMeter(m, { gates = [], seeds = 40 } = {}) {
  let started = 0;
  let minNext = Infinity;
  let maxNext = -Infinity;
  for (let seed = 1; seed <= seeds; seed++) {
    const s = world({ seed, m });
    for (const meter of gates) s.gates.push(createGate(s, START_X + meter * METER, 360, 1));
    tick(s);
    if (s.events.active) started++;
    else {
      minNext = Math.min(minNext, s.events.nextMeter);
      maxNext = Math.max(maxNext, s.events.nextMeter);
    }
  }
  return { started, minNext, maxNext };
}

test('120 Meter um ein Sollmeter eines Tors wird nie ein Ereignis gestartet', () => {
  for (const n of [1, 2, 3]) {
    const g = gateMeter(n);
    for (const m of [g - 120, g - 60, g, g + 60, g + 120]) {
      if (m < EVENTS.FIRST_METER) continue;
      const r = tryMeter(m);
      assert.equal(r.started, 0, `Meter ${m} nahe Tor ${n}`);
      assert.ok(r.minNext >= g + 120, `Meter ${m}: der nächste Versuch kommt erst nach der Sperre (${r.minNext})`);
    }
    // gleich daneben ist es erlaubt
    assert.ok(tryMeter(g + 121).started > 0, `Meter ${g + 121}`);
    if (g - 121 >= EVENTS.FIRST_METER) assert.ok(tryMeter(g - 121).started > 0, `Meter ${g - 121}`);
  }
});

test('nach der Sperre kommt der nächste Versuch mit Streuung, nicht immer gleich nach dem Tor', () => {
  const g = gateMeter(2);
  const r = tryMeter(g, { seeds: 60 });
  assert.ok(r.minNext >= g + 120 && r.maxNext <= g + 120 + EVENTS.EVERY[0]);
  assert.ok(r.maxNext - r.minNext > 100, `Streuung ${r.maxNext - r.minNext}`);
});

test('auch tatsächlich vorhandene Tore sperren 120 Meter davor und danach', () => {
  const gates = [900];
  for (const m of [780, 900, 1020]) {
    const r = tryMeter(m, { gates });
    assert.equal(r.started, 0, `Meter ${m}`);
    assert.ok(r.minNext >= 1020, `Meter ${m}: nextMeter ${r.minNext}`);
  }
  for (const m of [779, 1021]) assert.ok(tryMeter(m, { gates }).started > 0, `Meter ${m}`);
});

// ---------- Sternschnuppen ----------

test('Sternschnuppen: Ereignissterne fallen schon gestartet vor dem Spieler vom oberen Rand', () => {
  const s = world({ m: 700 });
  startEvent(s, 'meteor');
  runFor(s, EVENTS.meteor.dur + 0.1);
  const stars = eventStars(s);
  assert.ok(stars.length >= 12 && stars.length <= 14, `${stars.length} Sterne`);
  const cx = s.player.x + s.player.w / 2;
  for (const st of stars) {
    assert.equal(st.bonus, 'event');
    assert.equal(st.value, SCORE.EVENT_STAR);
    assert.equal(st.value, 5);
    assert.equal(st.falling, true);
    assert.equal(st.started, true);
    assert.ok(st.vy > 0 && st.vy === st.fallSpeed);
    assert.ok(st.y < 0, 'starten über dem Bild');
    assert.ok(st.x > cx, 'vor dem Spieler');
    assert.ok(st.x >= s.camX && st.x <= s.camX + W, 'im Bild');
  }
});

test('Sternschnuppen: alle 0,6 Sekunden ein Stern', () => {
  const s = world();
  startEvent(s, 'meteor');
  runFor(s, 0.55);
  assert.equal(eventStars(s).length, 0);
  runFor(s, 0.1);
  assert.equal(eventStars(s).length, 1);
  runFor(s, 0.6);
  assert.equal(eventStars(s).length, 2);
  runFor(s, 1.8);
  assert.equal(eventStars(s).length, 5);
});

test('Sternschnuppen: nie mehr als 14 Ereignissterne gleichzeitig', () => {
  const s = world();
  startEvent(s, 'meteor');
  s.events.active.dur = 200;
  let peak = 0;
  for (let i = 0; i < 60 * 60; i++) {
    tick(s);
    peak = Math.max(peak, eventStars(s).length);
  }
  assert.equal(peak, 14);
});

test('Sternschnuppen: LIMITS.MAX_STARS wird nie überschritten', () => {
  const s = world();
  for (let i = 0; i < LIMITS.MAX_STARS - 3; i++) s.stars.push(createStar(s, 2000 + i * 10, 300));
  startEvent(s, 'meteor');
  s.events.active.dur = 100;
  runFor(s, 60);
  assert.equal(s.stars.length, LIMITS.MAX_STARS);
  assert.equal(eventStars(s).length, 3);
});

test('Sternschnuppen: nie hinter der Kamera, auch weit rechts in der Welt', () => {
  const s = world();
  s.camX = 12000;
  s.player.x = 12310;
  startEvent(s, 'meteor');
  runFor(s, 9);
  const stars = eventStars(s);
  assert.ok(stars.length > 5);
  for (const st of stars) assert.ok(st.x > s.player.x + s.player.w / 2 && st.x >= s.camX && st.x <= s.camX + W);
});

test('Sternschnuppen: ganz am rechten Bildrand entstehen keine Sterne hinter dem Spieler', () => {
  const s = world();
  s.player.x = s.camX + W - 10;
  startEvent(s, 'meteor');
  runFor(s, 9);
  assert.equal(eventStars(s).length, 0);
});

test('Sternschnuppen: die Sterne fallen herunter und verschwinden, die Zahl bleibt begrenzt', () => {
  const s = world();
  startEvent(s, 'meteor');
  let peak = 0;
  const n = Math.round((EVENTS.meteor.dur + 8) / STEP);
  for (let i = 0; i < n; i++) {
    s.t += STEP;
    updateEvents(s, STEP);
    updateCollectibles(s, STEP);
    peak = Math.max(peak, eventStars(s).length);
    for (const st of s.stars) assert.ok(st.y <= H + 41);
  }
  assert.ok(peak >= 5 && peak <= 14, `Spitze ${peak}`);
  assert.equal(s.events.active, null);
  assert.equal(s.stars.length, 0, 'alle Sterne sind unten aus dem Bild');
});

test('Sternschnuppen: ein Stern bleibt nach dem Auftauchen im Bild mehrere Sekunden erreichbar', () => {
  const s = world();
  startEvent(s, 'meteor');
  runFor(s, 0.7, true);
  const st = eventStars(s)[0];
  assert.ok(st);
  let visibleSteps = 0;
  while (s.stars.includes(st)) {
    s.t += STEP;
    updateCollectibles(s, STEP);
    if (st.y > 0 && st.y < H) visibleSteps++;
    assert.ok(visibleSteps < 1000);
  }
  assert.ok(visibleSteps * STEP > 3, `${visibleSteps * STEP} Sekunden im Bild`);
});

test('Sternschnuppen: ein Spieler fängt Sterne und bekommt 5 Punkte pro Stern', () => {
  const s = world();
  startEvent(s, 'meteor');
  runFor(s, 1.3);
  const st = eventStars(s)[0];
  // der Spieler stellt sich unter den Stern und wartet
  s.player.x = st.x - s.player.w / 2;
  s.player.y = 300;
  for (let i = 0; i < 400 && !st.got; i++) {
    s.t += STEP;
    updateCollectibles(s, STEP);
  }
  assert.equal(st.got, true);
  assert.ok(s.run.bonus >= SCORE.EVENT_STAR);
  assert.equal(s.run.bonus % SCORE.EVENT_STAR, 0);
});

// ---------- Sternschauer ----------

function platformRow(s, n = 12) {
  const list = [];
  for (let k = 0; k < n; k++) {
    const p = createStaticPlatform(s, 900 + k * 330, 330 - (k % 3) * 25, 260);
    s.platforms.push(p);
    list.push(p);
  }
  return list;
}

test('Sternschauer: ruhende Ereignissterne über der nächsten Plattform hinter dem Bildrand', () => {
  const s = world();
  const plats = platformRow(s);
  startEvent(s, 'shower');
  runFor(s, EVENTS.shower.dur + 0.1);
  const stars = eventStars(s);
  assert.ok(stars.length >= 8 && stars.length <= 14, `${stars.length} Sterne`);
  for (const st of stars) {
    assert.equal(st.bonus, 'event');
    assert.equal(st.value, 5);
    assert.equal(st.falling, false);
    assert.ok(st.x > s.camX + W, 'hinter dem rechten Bildrand');
    assert.ok(st.x < s.camX + W + 1200);
    const above = plats.find((p) => st.x >= p.x && st.x <= p.x + p.w);
    assert.ok(above, `Stern ${Math.round(st.x)} liegt über einer Plattform`);
    assert.ok(st.y <= above.y - 49 && st.y >= above.y - 86, `Höhe ${above.y - st.y}`);
  }
  const xs = stars.map((st) => st.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 69.9, 'mit Abstand');
});

test('Sternschauer: alle 0,35 Sekunden ein Stern, nie mehr als 14', () => {
  const s = world();
  platformRow(s, 40);
  startEvent(s, 'shower');
  s.events.active.dur = 300;
  runFor(s, 0.3);
  assert.equal(eventStars(s).length, 0);
  runFor(s, 0.1);
  assert.equal(eventStars(s).length, 1);
  runFor(s, 0.7);
  assert.equal(eventStars(s).length, 3);
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) {
    tick(s);
    peak = Math.max(peak, eventStars(s).length);
  }
  assert.ok(peak <= 14);
});

test('Sternschauer: bewegliche Plattformen und fehlende Plattformen erzeugen keine Sterne', () => {
  const s = world();
  startEvent(s, 'shower');
  runFor(s, 5);
  assert.equal(eventStars(s).length, 0);
  s.platforms.push(createMovingPlatform(s, 1200, 300, 300, { ax: 40 }));
  runFor(s, 5);
  assert.equal(eventStars(s).length, 0);
});

test('Sternschauer: Plattformen zu weit vor dem Bild werden noch nicht belegt', () => {
  const s = world();
  s.platforms.push(createStaticPlatform(s, W + 3000, 330, 300));
  startEvent(s, 'shower');
  runFor(s, 5);
  assert.equal(eventStars(s).length, 0);
});

test('Sternschauer: die Kamera läuft mit, neue Sterne entstehen immer vor ihr und werden eingesammelt', () => {
  const s = world();
  for (let k = 0; k < 80; k++) s.platforms.push(createStaticPlatform(s, 600 + k * 330, 330, 260));
  s.player.y = 253; // Mitte auf Höhe der Sterne
  startEvent(s, 'shower');
  const seen = new Set();
  const frames = Math.round(EVENTS.shower.dur / STEP);
  for (let i = 0; i < frames; i++) {
    s.player.x += 5;
    s.camX = s.player.x - 300;
    s.t += STEP;
    updateEvents(s, STEP);
    for (const st of s.stars) {
      if (seen.has(st.id)) continue;
      seen.add(st.id);
      assert.ok(st.x > s.camX + W, `neuer Stern bei ${Math.round(st.x - s.camX)} px im Bild`);
    }
    updateCollectibles(s, STEP);
  }
  assert.ok(seen.size >= 20, `${seen.size} Sterne`);
  assert.ok(s.run.stars >= 10, `${s.run.stars} eingesammelt`);
  assert.equal(s.run.bonus, s.run.stars * SCORE.EVENT_STAR);
});

// ---------- Supermond ----------

test('Supermond: starBoost nur während des Ereignisses, ohne Sterne zu erzeugen', () => {
  const s = world();
  startEvent(s, 'supermoon');
  runFor(s, 5);
  assert.equal(s.events.starBoost, true);
  assert.equal(s.stars.length, 0);
  runFor(s, EVENTS.supermoon.dur);
  assert.equal(s.events.starBoost, false);
});

// ---------- Lange Läufe: Abstand, Determinismus, Ordnung ----------

// Läuft mit 360 px pro Sekunde bis maxMeter und protokolliert alle Ereignisse
function longRun(seed, { maxMeter = 6000, gates = 'nominal' } = {}) {
  const s = createState({ seed });
  const log = [];
  s.player.y = 300;
  for (let n = 1; n <= 8; n++) {
    const meter = gateMeter(n) + (gates === 'shifted' ? 45 : 0);
    s.gates.push(createGate(s, START_X + meter * METER, 360, n));
  }
  let prevActive = null;
  let startT = 0;
  let prevCount = 0;
  while (meters(s) < maxMeter) {
    s.t += STEP;
    s.player.x += 6;
    s.camX = s.player.x - 300;
    if (s.player.x > s.run.maxX) s.run.maxX = s.player.x;
    updateCollectibles(s, STEP);
    updateEvents(s, STEP);
    const a = s.events.active;
    if (s.events.count !== prevCount) {
      assert.equal(prevActive, null, 'neues Ereignis nur, wenn keines lief');
      assert.equal(s.events.count, prevCount + 1);
      log.push({ type: a.type, meter: meters(s), dur: 0 });
      startT = s.t;
      prevCount = s.events.count;
    }
    if (prevActive && !a) log[log.length - 1].dur = s.t - startT;
    prevActive = a;
    assert.ok(eventStars(s).length <= 14);
    assert.ok(s.stars.length <= LIMITS.MAX_STARS);
  }
  return { log, rng: s.rng, events: s.events };
}

test('lange Läufe: Ereignisse halten Abstand zu Toren und zueinander', () => {
  let total = 0;
  for (const gates of ['nominal', 'shifted']) {
    for (let seed = 1; seed <= 6; seed++) {
      const { log } = longRun(seed, { gates });
      total += log.length;
      for (let i = 0; i < log.length; i++) {
        const e = log[i];
        for (let n = 1; n <= 8; n++) {
          const nominal = Math.abs(gateMeter(n) - e.meter);
          const real = Math.abs(gateMeter(n) + (gates === 'shifted' ? 45 : 0) - e.meter);
          assert.ok(nominal > 120 && real > 120, `Seed ${seed} ${gates}: ${e.type} bei Meter ${e.meter} liegt nahe Tor ${n}`);
        }
        assert.ok(e.meter >= EVENTS.FIRST_METER);
        if (e.type === 'storm') assert.ok(e.meter >= 800, `Sturm bei Meter ${e.meter}`);
        if (i > 0) assert.ok(e.meter - log[i - 1].meter >= EVENTS.EVERY[0], `Abstand ${e.meter - log[i - 1].meter} Meter`);
        if (e.dur > 0) assert.ok(Math.abs(e.dur - EVENTS[e.type].dur) < 3 * STEP, `${e.type} dauert ${e.dur}`);
      }
    }
  }
  assert.ok(total >= 20, `nur ${total} Ereignisse in zwölf Läufen`);
});

test('lange Läufe: Ereignisse kommen regelmäßig vor und alle Typen erscheinen', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) for (const e of longRun(seed).log) seen.add(e.type);
  assert.deepEqual([...seen].sort(), [...TYPES].sort());
});

test('Determinismus: gleicher Seed gibt gleiche Ereignisse, anderer Seed andere', () => {
  const a = longRun(21);
  const b = longRun(21);
  assert.deepEqual(a, b);
  assert.ok(a.log.length >= 3);
  const c = longRun(22);
  assert.notDeepEqual(a.log, c.log);
});

test('Determinismus: ein kopierter Zustand erlebt dasselbe Ereignis', () => {
  const s = world({ seed: 8, m: 700 });
  startEvent(s, 'meteor');
  runFor(s, 2);
  const copy = structuredClone(s);
  runFor(s, 6, true);
  runFor(copy, 6, true);
  assert.deepEqual(s.stars, copy.stars);
  assert.deepEqual(s.events, copy.events);
  assert.equal(s.rng, copy.rng);
});

test('der Ereigniszustand besteht nur aus Daten', () => {
  for (const type of TYPES) {
    const s = world();
    platformRow(s, 5);
    startEvent(s, type);
    runFor(s, 4);
    assert.doesNotThrow(() => structuredClone(s));
    const check = (v, path) => {
      if (typeof v === 'function') assert.fail(`Funktion in ${path}`);
      if (v instanceof Set || v instanceof Map) assert.fail(`Set oder Map in ${path}`);
      if (v && typeof v === 'object') for (const k of Object.keys(v)) check(v[k], `${path}.${k}`);
    };
    check(s.events, 'events');
    assert.ok(Object.values(s.events.active.data).every(Number.isFinite));
  }
});

test('im Spiel: jedes Ereignis läuft durch den echten Simulationsschritt, Invarianten bleiben gültig', () => {
  for (const type of TYPES) {
    for (let seed = 1; seed <= 3; seed++) {
      const s = newGame(seed);
      startEvent(s, type);
      for (let i = 0; i < 60 * 14 && s.mode === 'playing'; i++) {
        run(s, 1, () => input({ move: 1, jumpPressed: i % 40 === 0, jumpHeld: i % 40 < 25 }));
        assert.ok(eventStars(s).length <= 14);
      }
      assert.deepEqual(invariants(s), [], `${type} Seed ${seed}`);
    }
  }
});
