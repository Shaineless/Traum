// Unabhängige Prüfung der erzeugten Welt: Sind alle Sprünge machbar?
// Die Welt entsteht ohne Spieler (Kamera wird künstlich vorangetrieben). Geprüft wird mit s.gen.keepLog und
// routeLog, mit den physischen Grenzen aus game/reach.js, mit einer eigenen Flugbahn Rechnung aus PHYS und
// mit der echten Spielerphysik (stepSim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { H, KILL_Y, METER, PHYS, START_X, STEP } from '../game/constants.js';
import { ensureAhead, initGenerator } from '../game/generator.js';
import { hopOk, hopOkMoving, maxGap } from '../game/reach.js';
import { createState } from '../game/state.js';
import { createStaticPlatform } from '../game/entities.js';
import { stepSim } from '../game/sim.js';
import { safeFor } from '../game/validate.js';
import { CHUNKS } from '../game/chunks/index.js';

// ---------- Test Chunks (eigene kleine Bibliothek mit allen Plattformarten) ----------

const hop = (b, y1, y2, k = 0.8, o = {}) => Math.max(60, Math.floor(maxGap(y1, y2, { safe: safeFor(b.diff) * k, ...o })));

const TEST_LIB = [
  {
    id: 'r-meadow', name: 'Wiese', diff: 1, weight: 3, min: 0, max: Infinity, mech: [], rest: true,
    build(b) { const g = b.ground(0, 0, b.int(520, 680)); b.starsOver(g, 6, 55); b.route(g); },
  },
  {
    id: 'r-pause', name: 'Pause', diff: 2, weight: 2, min: 500, max: Infinity, mech: [], rest: true,
    build(b) {
      const a = b.ground(0, 0, 300);
      const x = 300 + hop(b, 0, -20, 0.6);
      const c = b.cloud(x, -20, 200);
      const e = b.ground(x + 200 + hop(b, -20, 0, 0.6), 0, 340);
      b.starsOver(e, 5, 55);
      b.route(a, c, e);
    },
  },
  {
    id: 'r-hops', name: 'Hüpfer', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -20);
      const c = b.cloud(x1, -20, 170);
      const e = b.ground(x1 + 170 + hop(b, -20, 0), 0, 320);
      b.starsOver(e, 4, 55);
      b.route(a, c, e);
    },
  },
  {
    id: 'r-wave', name: 'Welle', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 240);
      const x1 = 240 + hop(b, 0, 25);
      const c1 = b.cloud(x1, 25, 150);
      const x2 = x1 + 150 + hop(b, 25, -10);
      const c2 = b.cloud(x2, -10, 150);
      const e = b.ground(x2 + 150 + hop(b, -10, 20), 20, 300);
      b.starsOver(e, 4, 50);
      b.route(a, c1, c2, e);
    },
  },
  {
    id: 'r-bumps', name: 'Hügel', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, -15);
      const c = b.cloud(x1, -15, 200);
      const e = b.ground(x1 + 200 + hop(b, -15, -15), -15, 280);
      b.starsOver(e, 3, 50);
      b.route(a, c, e);
    },
  },
  {
    id: 'r-long', name: 'Weg', diff: 1, weight: 2, min: 0, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 400);
      const e = b.ground(400 + hop(b, 0, 0, 0.6), 0, 480);
      b.starsOver(e, 5, 55);
      b.route(a, e);
    },
  },
  {
    id: 'r-tall', name: 'Turm', diff: 2.5, weight: 2, min: 250, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -55, 0.55);
      const c1 = b.cloud(x1, -55, 150);
      const x2 = x1 + 150 + hop(b, -55, -110, 0.55);
      const c2 = b.cloud(x2, -110, 150);
      const e = b.ground(x2 + 150 + 120, 70, 300);
      b.starsOver(e, 3, 50);
      b.route(a, c1, c2, e);
    },
  },
  {
    id: 'r-walker', name: 'Gewitter', diff: 1.5, weight: 2, min: 250, max: Infinity, mech: ['walker'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const h = b.ground(300 + hop(b, 0, 0), 0, 560);
      b.walker(h, 0.55);
      b.starsOver(h, 4, 80);
      b.route(a, h);
    },
  },
  {
    id: 'r-moving', name: 'Wolke', diff: 2.3, weight: 2, min: 500, max: Infinity, mech: ['moving'],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -20, 0.6);
      const m = b.moving(x1, -20, 150, { ay: 35, period: 3.6 });
      const e = b.ground(x1 + 150 + hop(b, -20, 0, 0.6), 0, 320);
      b.starsOver(e, 4, 55);
      b.route(a, m, e);
    },
  },
  {
    id: 'r-crumble', name: 'Brösel', diff: 3, weight: 2, min: 800, max: Infinity, mech: ['breakable'],
    build(b) {
      const a = b.ground(0, 0, 300);
      const x1 = 300 + hop(b, 0, -15, 0.7);
      const br1 = b.breakable(x1, -15, 130);
      const x2 = x1 + 130 + hop(b, -15, -15, 0.7);
      const br2 = b.breakable(x2, -15, 130);
      const e = b.ground(x2 + 130 + hop(b, -15, 0, 0.7), 0, 320);
      b.starsOver(e, 3, 50);
      b.route(a, br1, br2, e);
    },
  },
  {
    id: 'r-wind', name: 'Wind', diff: 3.2, weight: 2, min: 1200, max: Infinity, mech: ['wind'],
    build(b) {
      const a = b.ground(0, 0, 280);
      const x1 = 280 + hop(b, 0, 0, 0.6);
      const e = b.ground(x1, 0, 340);
      b.wind(200, -220, x1 + 100, 300, { vx: -40 });
      b.starsOver(e, 4, 55);
      b.route(a, e);
    },
  },
  {
    id: 'r-double', name: 'Weitsprung', diff: 5, weight: 2, min: 1700, max: Infinity, mech: [],
    build(b) {
      const a = b.ground(0, 0, 260);
      const x1 = 260 + hop(b, 0, -40, 0.8, { dbl: true });
      const c = b.cloud(x1, -40, 160);
      const e = b.ground(x1 + 160 + hop(b, -40, 0, 0.8, { dbl: true }), 0, 300);
      b.starsOver(e, 3, 55);
      b.route(a, c, e);
    },
  },
];

// ---------- Werkzeug ----------

const meterOf = (x) => (x - START_X) / METER;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

// Erzeugt die Welt bis meters Meter und merkt sich alle Plattformen und das Protokoll
function build(seed, lib, { meters = 8000, step = 100 } = {}) {
  const s = createState({ seed });
  s.gen = { keepLog: true };
  initGenerator(s, lib);
  const platforms = new Map();
  const respawn = { steps: 0, noWide: 0, noAny: 0 };
  const grab = () => { for (const p of s.platforms) if (!platforms.has(p.id)) platforms.set(p.id, p); };
  grab();
  const endX = START_X + meters * METER;
  for (let cam = step; s.gen.nextX < endX; cam += step) {
    s.camX = cam;
    ensureAhead(s, lib);
    grab();
    // Respawn (player.js): am liebsten eine statische Plattform mit mindestens 200 Breite, deren rechte Kante
    // nach camX + 200 liegt, notfalls eine mit Spielerbreite plus 40, deren rechte Kante nach camX + 52 liegt
    respawn.steps++;
    if (!s.platforms.some((p) => p.kind === 'static' && p.w >= 200 && p.x + p.w > cam + 200)) respawn.noWide++;
    if (!s.platforms.some((p) => p.kind === 'static' && p.w >= PHYS.W + 40 && p.x + p.w > cam + PHYS.LEFT_MARGIN + PHYS.W)) respawn.noAny++;
  }
  return { s, platforms: [...platforms.values()], log: s.gen.routeLog, chunks: s.gen.chunkLog, respawn };
}

// Flugbahn aus PHYS: Zeit in der Luft, bis die Füße bei Absprung aus Ruhehöhe die Höhe dy (nach unten positiv)
// absteigend erreichen. 0 bedeutet: das Ziel liegt über dem Scheitel.
function airTimeSim(dy) {
  if (-dy > APEX) return 0;
  const dt = 1 / 960;
  let y = 0;
  let vy = -PHYS.JUMP_SPEED;
  for (let t = dt; t < 5; t += dt) {
    vy += PHYS.GRAVITY * dt;
    y += vy * dt;
    if (vy > 0 && y >= dy) return t;
  }
  return 0;
}
const APEX = (PHYS.JUMP_SPEED * PHYS.JUMP_SPEED) / (2 * PHYS.GRAVITY);

const strip = (p) => ({ ...p });

// Verbindungen und Hops entlang des Protokolls
function hops(log) {
  const out = [];
  for (let i = 1; i < log.length; i++) out.push({ a: log[i - 1], b: log[i], conn: log[i].conn });
  return out;
}

const PHYSICAL = { safe: 1, dbl: true, minLand: 56 };

// ---------- Route ----------

function routeProblems(r, label) {
  const bad = [];
  const log = r.log;
  if (log[0].chunk !== 'start' || log[0].conn) bad.push(`${label}: Protokoll beginnt nicht mit der Startplattform`);
  const entries = log.filter((p) => p.conn);
  if (entries.length !== r.chunks.length) bad.push(`${label}: ${entries.length} Einstiege bei ${r.chunks.length} Chunks`);
  for (const { a, b, conn } of hops(log)) {
    const what = `${a.chunk}/${a.id} nach ${b.chunk}/${b.id}`;
    if (!(b.x + b.w > a.x + a.w) && !b.ox) bad.push(`${label}: ${what} führt nicht nach rechts`);
    // Physische Grenzen: Doppelsprung erlaubt, keine Sicherheit
    if (!hopOkMoving(a, b, PHYSICAL)) bad.push(`${label}: ${what} ist physisch nicht machbar`);
    if (conn) {
      // Verbindung zwischen Chunks: beide statisch, mit der Sicherheit des Spiels ohne Doppelsprung
      if (a.kind !== 'static' || b.kind !== 'static') bad.push(`${label}: Verbindung ${what} nicht statisch`);
      if (!hopOk(a, b, { safe: safeFor(b.diff), dbl: false, minLand: 56 })) bad.push(`${label}: Verbindung ${what} braucht einen Doppelsprung oder ist zu knapp`);
      const gap = b.x - (a.x + a.w);
      if (gap < 59 || gap > 280) bad.push(`${label}: Lücke ${gap.toFixed(0)} px bei ${what}`);
      if (b.w < 160) bad.push(`${label}: Einstieg ${b.id} nur ${b.w} breit`);
      if (b.y < 214 || b.y > 401) bad.push(`${label}: Einstieg ${b.id} auf Höhe ${b.y}`);
    } else if (a.chunk === b.chunk) {
      // Sprünge im Chunk: Doppelsprung nur ab Schwierigkeit 2,5, wie validate.js es erlaubt
      if (!hopOkMoving(a, b, { safe: safeFor(b.diff), dbl: b.diff >= 2.5, minLand: 56 }, 0.3)) {
        bad.push(`${label}: Sprung im Chunk ${a.chunk} von ${a.id} nach ${b.id} zu schwer für diff ${b.diff}`);
      }
    }
    if (bad.length > 6) break;
  }
  return bad;
}

// Eigene Flugbahn: jede Verbindung mit einem Sprung, mit mindestens 20 Prozent Reserve
function trajectoryProblems(r, label) {
  const bad = [];
  for (const { a, b, conn } of hops(r.log)) {
    if (!conn) continue;
    const dy = b.y - a.y;
    const needed = Math.max(0, b.x - PHYS.W - (a.x + a.w));
    if (dy < 0 && -dy > APEX * 0.85) {
      bad.push(`${label}: Anstieg ${(-dy).toFixed(0)} px bei ${a.id} nach ${b.id} (Scheitel ${APEX.toFixed(0)})`);
      continue;
    }
    const t = airTimeSim(dy);
    const reach = PHYS.MOVE_SPEED * t;
    if (!(t > 0) || needed > reach * 0.8) bad.push(`${label}: Lücke ${needed.toFixed(0)} px bei Reichweite ${reach.toFixed(0)} px (${a.id} nach ${b.id}, dy ${dy.toFixed(0)})`);
    if (bad.length > 6) break;
  }
  return bad;
}

// ---------- Graphsuche ----------

// Alle Plattformen der erzeugten Welt als Knoten. Kante a nach b, wenn ein Sprung mit physischen Grenzen
// (Doppelsprung, volle Reichweite) reicht. Bewegliche Plattformen zählen über hopOkMoving.
function bfs(platforms, startId, wantIds) {
  const left = (p) => (p.kind === 'moving' ? p.ox - Math.abs(p.ax) : p.x);
  const right = (p) => (p.kind === 'moving' ? p.ox + Math.abs(p.ax) + p.w : p.x + p.w);
  const nodes = platforms.slice().sort((p, q) => left(p) - left(q));
  const index = new Map(nodes.map((p, i) => [p.id, i]));
  const seen = new Uint8Array(nodes.length);
  const queue = [index.get(startId)];
  seen[queue[0]] = 1;
  const REACH = 520; // weiter als jede Lücke
  for (let h = 0; h < queue.length; h++) {
    const a = nodes[queue[h]];
    for (let j = queue[h] + 1; j < nodes.length && left(nodes[j]) - right(a) < REACH; j++) {
      if (seen[j]) continue;
      const b = nodes[j];
      if (hopOkMoving(a, b, PHYSICAL)) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  const missing = wantIds.filter((id) => !seen[index.get(id)]);
  return { reached: queue.length, total: nodes.length, missing };
}

// ---------- Echte Spielerphysik ----------

// Läuft auf a nach rechts, springt an der Kante (Taste hold Schritte lang gehalten, kein Doppelsprung) und meldet,
// ob der Spieler auf b landet. brakeAt: nach so vielen Schritten in der Luft wird die Richtung losgelassen.
// Die Welt besteht nur aus a und b.
function realHop(a, b, { hold = 45, brakeAt = Infinity } = {}) {
  const s = createState({ seed: 1 });
  const pa = createStaticPlatform(s, a.x, a.y, a.w);
  const pb = createStaticPlatform(s, b.x, b.y, b.w);
  s.platforms.push(pa, pb);
  s.camX = a.x - 200;
  const p = s.player;
  p.x = Math.max(a.x + 2, a.x + a.w - 160);
  p.y = a.y - p.h;
  p.onGround = true;
  p.groundId = pa.id;
  s.respawn = { x: p.x, y: p.y };
  let jumped = -1;
  for (let f = 0; f < 240; f++) {
    const press = jumped < 0 && p.x >= a.x + a.w - 4;
    if (press) jumped = f;
    const move = jumped >= 0 && f - jumped >= brakeAt ? 0 : 1;
    stepSim(s, { move, jumpPressed: press, jumpHeld: jumped >= 0 && f - jumped < hold, dashPressed: false }, STEP);
    if (s.run.hits > 0 || s.lives < 3 || p.y > H || p.y > KILL_Y) return { ok: false, why: 'gefallen' };
    if (jumped >= 0 && p.onGround && p.groundId === pb.id) return { ok: true };
    if (jumped >= 0 && p.onGround && p.groundId === pa.id && f - jumped > 3) return { ok: false, why: 'wieder auf der Startplattform' };
  }
  return { ok: false, why: 'Zeit abgelaufen' };
}

// Wie ein Mensch mit Steuerung: Sprunghöhe und Bremsen dürfen variieren. Gelingt eine Spielweise, ist der Sprung machbar.
function realHopAny(a, b) {
  let last = null;
  for (const hold of [45, 28, 18, 12, 8]) {
    for (const brakeAt of [Infinity, 22, 14]) {
      last = realHop(a, b, { hold, brakeAt });
      if (last.ok) return last;
    }
  }
  return last;
}

// ---------- Tests ----------

for (const [name, lib] of [['Test Chunks', TEST_LIB], [`echte Bibliothek (${CHUNKS.length} Chunks)`, CHUNKS]]) {
  test(`${name}: Routenplattformen sind physisch erreichbar, Verbindungen ohne Doppelsprung (40 Seeds, 8000 m)`, () => {
    const bad = [];
    for (const seed of SEEDS) {
      const r = build(seed, lib);
      bad.push(...routeProblems(r, `Seed ${seed}`));
      if (bad.length > 8) break;
    }
    assert.deepEqual(bad.slice(0, 8), []);
  });

  test(`${name}: eigene Flugbahn Rechnung bestätigt jede Verbindung mit Reserve`, () => {
    const bad = [];
    for (const seed of SEEDS.slice(0, 20)) {
      bad.push(...trajectoryProblems(build(seed, lib), `Seed ${seed}`));
      if (bad.length > 8) break;
    }
    assert.deepEqual(bad.slice(0, 8), []);
  });

  test(`${name}: Breitensuche über alle Plattformen vom Start bis zum Ende`, () => {
    const bad = [];
    for (const seed of SEEDS) {
      const r = build(seed, lib);
      const route = r.log.map((p) => p.id);
      const res = bfs(r.platforms, r.log[0].id, route);
      if (res.missing.length) bad.push(`Seed ${seed}: ${res.missing.length} Routenplattformen nicht erreichbar, zuerst ${res.missing[0]}`);
      const end = r.log[r.log.length - 1];
      if (res.missing.includes(end.id)) bad.push(`Seed ${seed}: Ende nicht erreichbar`);
      if (res.reached < route.length) bad.push(`Seed ${seed}: nur ${res.reached} von ${route.length} Knoten`);
    }
    assert.deepEqual(bad.slice(0, 8), []);
  });

  test(`${name}: Respawn findet fast immer eine breite statische Plattform voraus, immer irgendeine feste`, () => {
    const bad = [];
    let steps = 0;
    let noWide = 0;
    for (const seed of SEEDS) {
      const r = build(seed, lib, { step: 25 });
      steps += r.respawn.steps;
      noWide += r.respawn.noWide;
      if (r.respawn.noAny) bad.push(`Seed ${seed}: an ${r.respawn.noAny} Stellen gar keine feste Plattform für den Respawn`);
    }
    assert.deepEqual(bad.slice(0, 8), []);
    assert.ok(noWide <= steps * 0.001, `${noWide} von ${steps} Kamerapositionen ohne Plattform von 200 Breite`);
  });

  test(`${name}: mit der echten Spielerphysik gelingt jede Verbindung mit einem Sprung`, () => {
    const bad = [];
    let tried = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const r = build(seed, lib, { meters: 8000 });
      for (const { a, b, conn } of hops(r.log)) {
        if (!conn) continue;
        tried++;
        const res = realHop(strip(a), strip(b));
        if (!res.ok) bad.push(`Seed ${seed}: ${a.chunk} nach ${b.chunk} (${res.why}), Lücke ${(b.x - a.x - a.w).toFixed(0)}, dy ${(b.y - a.y).toFixed(0)}, diff ${b.diff}`);
      }
    }
    assert.ok(tried > 500, `nur ${tried} Verbindungen geprüft`);
    assert.deepEqual(bad.slice(0, 8), []);
  });
}

for (const [name, lib] of [['Test Chunks', TEST_LIB], [`echte Bibliothek (${CHUNKS.length} Chunks)`, CHUNKS]]) {
  test(`${name}: Sprünge zwischen festen Plattformen in leichten Chunks gelingen mit der echten Spielerphysik`, () => {
    const bad = [];
    let tried = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const r = build(seed, lib, { meters: 4000 });
      for (const { a, b, conn } of hops(r.log)) {
        if (conn || a.chunk !== b.chunk || a.kind !== 'static' || b.kind !== 'static' || b.diff >= 2.5) continue;
        tried++;
        const res = realHopAny(strip(a), strip(b));
        if (!res.ok) bad.push(`Seed ${seed}: ${a.chunk} von ${a.id} nach ${b.id} (${res.why}), Lücke ${(b.x - a.x - a.w).toFixed(0)}, dy ${(b.y - a.y).toFixed(0)}, Breite ${b.w}`);
      }
    }
    assert.ok(tried > 100, `nur ${tried} Sprünge geprüft`);
    assert.deepEqual(bad.slice(0, 8), []);
  });
}

test('Die Startplattform und der erste Sprung sind für Anfänger großzügig', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = build(seed, TEST_LIB, { meters: 400 });
    const first = r.log[1];
    const start = r.log[0];
    assert.ok(first.conn && first.chunk);
    assert.ok(hopOk(start, first, { safe: 0.55, dbl: false }), `Seed ${seed}: erster Sprung zu knapp`);
    const gap = first.x - (start.x + start.w);
    assert.ok(gap >= 59 && gap <= 200);
  }
});

test('Verbindungen sind zu Beginn kürzer als später (die Kurve spiegelt sich in den Lücken)', () => {
  let early = 0;
  let late = 0;
  let ne = 0;
  let nl = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const r = build(seed, TEST_LIB);
    for (const { a, b, conn } of hops(r.log)) {
      if (!conn) continue;
      const gap = b.x - (a.x + a.w);
      if (meterOf(b.x) < 250) { early += gap; ne++; } else if (meterOf(b.x) > 3700) { late += gap; nl++; }
    }
  }
  assert.ok(late / nl > early / ne + 10, `früh ${(early / ne).toFixed(0)} px, spät ${(late / nl).toFixed(0)} px`);
});

test('Hilfsmittel der Prüfung: Sprung an der Grenze der Reichweite scheitert wirklich', () => {
  // Gegenprobe, damit die echten Sprungtests nicht immer bestehen: eine zu große Lücke wird erkannt
  const a = { x: 0, y: 360, w: 300 };
  const farGap = { x: 300 + 400, y: 360, w: 300 };
  assert.equal(realHop(a, farGap).ok, false);
  const nearGap = { x: 300 + 120, y: 360, w: 300 };
  assert.equal(realHop(a, nearGap).ok, true);
  const tooHigh = { x: 300 + 80, y: 360 - 160, w: 300 };
  assert.equal(realHop(a, tooHigh).ok, false);
  assert.ok(!hopOk(a, farGap, { safe: 1, dbl: false }));
  assert.ok(airTimeSim(0) > 0.7 && airTimeSim(-APEX - 5) === 0);
});
