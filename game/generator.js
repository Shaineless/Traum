// Chunk Sequenzer: baut die Welt aus bewusst gestalteten Chunks (game/chunks/*.js).
// Nichts hier ist freier Zufall. Jeder Schritt folgt der Schwierigkeitskurve aus constants.js.
//
// Ablauf der Chunk Wahl (buildNext):
//  1. Der Meter am Ende des letzten Ausstiegs bestimmt Abschnitt, Zieldifficulty (difficultyAt, dazu eine
//     kleine Welle zwischen zwei Ruhepausen) und die freigeschalteten Mechaniken (mechsAt).
//  2. Rolle des nächsten Chunks: erster Chunk nach der Startplattform (ruhig), Ruhepause (alle REST.EVERY
//     Meter mit Jitter), Traumtor bei gateMeter(n) mit einem ruhigen Chunk davor und danach, sonst normal.
//  3. Kandidaten: min <= Meter < max, alle mech Tags freigeschaltet, diff höchstens Kurve plus 0,6, nicht
//     unter den letzten drei Chunks. In den ersten 250 Metern nur diff 1 ohne Gegner. Ruhige Rollen nehmen
//     nur Chunks mit rest: true, normale Rollen keine. Ist die Liste leer, wird die Wiederholungsregel
//     gelockert, dann dürfen auch Ruhechunks ran, zuletzt greift der Fallback flat.
//  4. Gewicht: weight mal Nähe zur Zieldifficulty, doppelt bei s.events.enemyBoost und Gegnern, etwas
//     weniger, wenn die Mechanik dieselbe wie im letzten Chunk ist, deutlich mehr für Chunks, die eine frisch
//     freigeschaltete Mechanik zum ersten Mal zeigen (Einführung). Ziehung mit pickWeighted.
//  5. Platzierung: Messlauf (builder mit measure) liefert die Höhen. Der Einstieg wird in der Höhe
//     verschoben, bis alle Plattformen in [Y_MIN, Y_MAX] liegen und der Sprung vom letzten Ausstieg mit EINEM
//     Sprung und Sicherheit safeFor(diff) mal 0,9 machbar ist (maxGap). Danach der echte Bau mit echten IDs.
//  6. validateStaged prüft den Chunk. Fehler oder Ausnahmen zählen als Reject. Bis zu 5 Wiederholungen mit
//     anderem Chunk, dann flat. Nur ein geprüfter Chunk kommt in den Spielzustand, und nur wenn die LIMITS
//     halten. Sonst wird ein anderer Chunk versucht oder gewartet (die Welt reicht GEN_AHEAD voraus).
//
// Zufall: Der Generator hat einen eigenen Strom (s.gen.rng) und tauscht ihn nur während der Erzeugung in
// s.rng ein. So hängt die Welt eines Seeds nicht davon ab, wann andere Module würfeln.

import {
  H, HINTS, LIMITS, METER, REST, SECTIONS, START_X, W, WIND, Y_MAX, Y_MIN, difficultyAt, gateMeter, mechsAt,
} from './constants.js';
import { createBuilder } from './builder.js';
import { DEAD_TIME } from './enemies.js';
import { createStaticPlatform } from './entities.js';
import { hopOk, maxGap } from './reach.js';
import { pickWeighted, rand, range } from './rng.js';
import { banner } from './scoring.js';
import { safeFor, validateStaged } from './validate.js';
import { CHUNKS, FLAT, GATE } from './chunks/index.js';

const START = { X: -200, Y: 360, W: 900 }; // Startplattform

const GEN = {
  DIFF_SLACK: 0.6, // ein Chunk darf höchstens so viel schwerer sein als die Kurve
  RECENT: 3, // so viele Chunks lang darf sich ein Chunk nicht wiederholen
  RETRIES: 5, // Wiederholungen nach einem Fehler, danach flat
  SKIPS: 14, // Chunks, die nur nicht zur Verbindung passen
  LIMIT_TRIES: 4, // Chunks, die nur wegen der Limits nicht passen
  SLEEP_DIFF: SECTIONS[0].diff[1], // Einschlafen: nur Chunks bis zu dieser Schwierigkeit
  GAP_MIN: 60, // kleinste Lücke zwischen Ausstieg und Einstieg
  CONN_SAFE: 0.9, // Faktor auf safeFor(diff) für die Lücke zwischen Chunks
  OVERLAP: 24, // Abstand zur rechten Kante des vorigen Chunks
  GATE_LEAD: 26, // so viele Meter vor dem Tor beginnt der ruhige Chunk davor
  GATE_REST_SKIP: 60, // nahe vor einem Tor wird keine zusätzliche Ruhepause eingeschoben
  ARC: 0.6, // Hub der Spannungswelle zwischen zwei Ruhepausen
  CLOSE: 0.8, // Breite der Gewichtung nach Abstand zur Zieldifficulty
  FLOOR: 0.004, // kleinstes Gewicht nach Abstand
  SAME_MECH: 0.5, // Gewicht, wenn die Mechanik wie im letzten Chunk ist
  INTRO: 4, // Gewicht für Chunks, die eine frisch freigeschaltete Mechanik zum ersten Mal zeigen
  LITE: 0.1, // Gewicht für Chunks mit Gegnern oder Hindernissen, wenn deren Limit schon knapp ist
  WANDER: 40, // Höhenschwankung zwischen zwei Chunks
  MID_Y: 320, // Höhe, zu der die Welt langsam zurückkehrt
  TEST_Y: 330, // Einstiegshöhe, mit der tests/chunk-harness.mjs die Chunks prüft
  PULL: 0.25,
  STAR_RESERVE: 16, // Platz im Sternlimit für Ereignissterne
  ENEMY_WIN: W + 520, // Zählfenster aktiver Gegner wie activeEnemies in sim.js
  URGENT: 100, // Rand hinter dem Bild, ab dem nicht mehr gewartet wird
  HOLD: 40, // so weit muss die Kamera nach einem Warten kommen, bevor es neu versucht wird
  WIND_REACH: 40, // Windzonen so nah an einer Lücke zählen als Gegenwind für den Sprung (wie in validate.js)
  EVENT_WIND: 40, // Gegenwind, mit dem im Traumsturm geprüft wird (Böen bis 70, der Spieler kann sie abwarten)
  PER_CALL: 5000,
  SPANS: 8,
  HINT_LEAD: 260, // Hinweis erscheint, wenn der Spieler so nah an der Mechanik ist
  HINT_STALE: 700, // danach lohnt der Hinweis nicht mehr
  HINT_TIME: 3.4,
  ERRORS: 40,
};

const ENEMY_TAGS = ['walker', 'jumper', 'flyer', 'charger'];
const HAZARD_TAGS = ['spike', 'lightning'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);
const mechOf = (c) => (Array.isArray(c.mech) ? c.mech : []);
const hasTag = (c, tags) => mechOf(c).some((m) => tags.includes(m));
const mechKey = (c) => mechOf(c).slice().sort().join('|');
const toMeter = (x) => (x - START_X) / METER;
const stormWind = (s) => (s.events.active && s.events.active.type === 'storm' ? GEN.EVENT_WIND : 0);
const pushAll = (dst, src) => { for (let i = 0; i < src.length; i++) dst.push(src[i]); };

// ---------- Start ----------

export function initGenerator(s, chunks = CHUNKS) {
  const keepLog = !!(s.gen && s.gen.keepLog); // Tests dürfen das Protokoll schon vor dem Start einschalten
  const start = createStaticPlatform(s, START.X, START.Y, START.W, { ground: true });
  s.platforms.push(start);
  s.gen = {
    nextX: START.X + START.W, // rechte Kante des letzten Ausstiegs
    lastY: START.Y, // Oberkante des letzten Ausstiegs
    lastW: START.W,
    endX: START.X + START.W, // rechteste Plattformkante des letzten Chunks
    chunkId: 'start',
    spans: [],
    dropped: 0,
    stats: { chunks: 0, rejects: 0, fallbacks: 0 },
    rng: (rand(s) * 4294967296) >>> 0 || 1,
    recent: [],
    lastKey: '',
    gateN: 1, // Nummer des nächsten Tors
    gateStage: 0, // 0 nichts offen, 1 ruhiger Chunk vor dem Tor steht, 2 Tor steht
    nextRest: REST.FIRST,
    restStart: 0,
    hold: 0,
    tailWind: 0, // Gegenwind einer Windzone, die über den letzten Ausstieg hinausreicht
    hinted: {},
  };
  const g = s.gen;
  const play = s.rng;
  s.rng = g.rng;
  g.nextRest = REST.FIRST + range(s, -REST.JITTER, REST.JITTER);
  g.rng = s.rng;
  s.rng = play;
  if (keepLog) {
    g.keepLog = true;
    g.routeLog = [{ id: start.id, kind: 'static', x: start.x, y: start.y, w: start.w, chunk: 'start', conn: false, diff: 1 }];
    g.chunkLog = [];
    g.errors = [];
  }
  ensureAhead(s, chunks);
}

// ---------- Welt erzeugen ----------

export function ensureAhead(s, chunks = CHUNKS) {
  const g = s.gen;
  if (!g) return;
  cleanup(s);
  const target = s.camX + LIMITS.GEN_AHEAD;
  if (!(g.nextX < target)) return;
  if (g.hold > 0 && g.hold > s.camX) return; // wartet auf Platz im Limit
  const lib = Array.isArray(chunks) ? chunks : CHUNKS;
  const play = s.rng;
  s.rng = g.rng;
  try {
    for (let n = 0; g.nextX < target && n < GEN.PER_CALL; n++) {
      if (n > 0) cleanup(s); // nach einem großen Kamerasprung zuerst Altes wegräumen
      if (!buildNext(s, lib)) {
        g.hold = s.camX + GEN.HOLD;
        break;
      }
    }
  } finally {
    g.rng = s.rng;
    s.rng = play;
  }
}

// Rolle des nächsten Chunks: 'first', 'rest', 'preGate', 'gate', 'postGate' oder 'normal'
function nextStep(g, meter) {
  if (g.gateStage === 1) return 'gate';
  if (g.gateStage === 2) return 'postGate';
  if (g.stats.chunks === 0) return 'first';
  const gm = gateMeter(g.gateN);
  if (meter >= gm - GEN.GATE_LEAD) return 'preGate';
  if (meter >= g.nextRest && meter < gm - GEN.GATE_LEAD - GEN.GATE_REST_SKIP) return 'rest';
  return 'normal';
}

// Spannungswelle: kurz nach einer Ruhepause etwas leichter, davor etwas schwerer
function arc(g, meter) {
  const span = g.nextRest - g.restStart;
  if (!(span > 1)) return 0;
  return (clamp((meter - g.restStart) / span, 0, 1) - 0.5) * GEN.ARC;
}

function buildNext(s, lib) {
  const g = s.gen;
  const meter = toMeter(g.nextX);
  const step = nextStep(g, meter);
  const mechs = mechsAt(meter);
  const curve = difficultyAt(meter);
  const plan = { meter, mechs, gateIndex: g.gateN, wind: stormWind(s), relax: false };
  const ctx = {
    meter, mechs, calm: step !== 'normal', sleeping: meter < SECTIONS[0].to,
    maxDiff: curve + GEN.DIFF_SLACK, target: curve + arc(g, meter),
    recent: g.recent, lastKey: g.lastKey, hinted: g.hinted, enemyBoost: !!s.events.enemyBoost, lite: '',
  };

  const tried = [];
  let hit = null;
  let chunk = null;
  let rejects = 0;
  let skips = 0;
  let limits = 0;
  while (!hit) {
    chunk = step === 'gate' ? (tried.length ? null : GATE) : pickChunk(s, lib, ctx, tried);
    if (!chunk) break;
    const r = tryChunk(s, chunk, plan);
    if (r.ok) {
      hit = r;
      break;
    }
    tried.push(chunk);
    if (r.kind === 'reject') {
      g.stats.rejects++;
      rejects++;
      noteError(g, chunk, r.why);
    } else if (r.kind === 'skip') skips++;
    else {
      limits++;
      ctx.lite = r.why;
    }
    if (rejects > GEN.RETRIES || skips > GEN.SKIPS || limits > GEN.LIMIT_TRIES) break;
  }

  let fallback = false;
  if (!hit) {
    // Limits: warten, solange das Bild nicht leer läuft. Sonst der Fallback flat.
    const urgent = g.nextX < s.camX + W + GEN.URGENT;
    if (limits > 0 && !urgent) return false;
    chunk = FLAT;
    hit = tryChunk(s, FLAT, { ...plan, relax: true });
    if (!hit.ok) {
      if (hit.kind === 'limit') return false;
      noteError(g, FLAT, hit.why);
      hit = emergency(s);
    }
    fallback = true;
    g.stats.fallbacks++;
  }

  adopt(s, chunk, hit, step, fallback);

  // Fahrplan der Ruhepausen und Tore
  const end = toMeter(g.nextX);
  if (step === 'preGate') g.gateStage = 1;
  else if (step === 'gate') g.gateStage = 2;
  else if (step === 'postGate') {
    g.gateStage = 0;
    g.gateN++;
  }
  if (step === 'rest' || step === 'preGate' || step === 'postGate') {
    g.restStart = end;
    g.nextRest = end + REST.EVERY + range(s, -REST.JITTER, REST.JITTER);
  }
  return true;
}

// ---------- Auswahl ----------

function allowed(c, ctx, tier) {
  if (!c || typeof c.build !== 'function' || c.special) return false;
  const m = ctx.meter;
  if (!(m >= num(c.min, 0)) || !(m < (c.max === undefined ? Infinity : c.max))) return false;
  const diff = num(c.diff, 1);
  if (diff > ctx.maxDiff) return false;
  for (const t of mechOf(c)) if (!ctx.mechs.has(t)) return false;
  if (ctx.sleeping && (diff > GEN.SLEEP_DIFF || hasTag(c, ENEMY_TAGS))) return false;
  if (ctx.calm) {
    if (!c.rest) return false;
  } else if (c.rest && tier < 2) return false;
  if (tier === 0 && ctx.recent.includes(c.id)) return false;
  if (tier === 1 && ctx.recent[ctx.recent.length - 1] === c.id) return false;
  return true;
}

function weightOf(c, ctx) {
  let w = num(c.weight, 1);
  if (w <= 0) return 0;
  if (!ctx.calm) {
    const d = (num(c.diff, 1) - ctx.target) / GEN.CLOSE;
    w *= Math.max(GEN.FLOOR, Math.exp(-d * d));
    if (ctx.enemyBoost && hasTag(c, ENEMY_TAGS)) w *= 2;
    const key = mechKey(c);
    if (key && key === ctx.lastKey) w *= GEN.SAME_MECH;
    if (mechOf(c).some((t) => HINTS[t] && !ctx.hinted[t])) w *= GEN.INTRO;
  }
  if (ctx.lite === 'enemies' && hasTag(c, ENEMY_TAGS)) w *= GEN.LITE;
  if (ctx.lite === 'hazards' && hasTag(c, HAZARD_TAGS)) w *= GEN.LITE;
  return w;
}

// Sucht in drei Stufen (streng, Wiederholung nur gegen den letzten Chunk, ohne Wiederholungsregel)
function pickChunk(s, lib, ctx, tried) {
  for (let tier = 0; tier < 3; tier++) {
    const list = [];
    for (const c of lib) if (!tried.includes(c) && allowed(c, ctx, tier)) list.push(c);
    if (!list.length) continue;
    const c = pickWeighted(s, list, (x) => weightOf(x, ctx));
    if (c) return c;
  }
  return null;
}

// ---------- Bauen, Messen, Prüfen ----------

// Gibt { ok: true, ... } oder { ok: false, kind: 'reject' | 'skip' | 'limit', why } zurück.
// reject: der Chunk selbst ist fehlerhaft. skip: er passt nicht zur Verbindung. limit: gerade kein Platz.
function tryChunk(s, chunk, plan) {
  const g = s.gen;
  const diff = clamp(num(chunk.diff, 1), 1, 5);
  // Zufall für die Platzierung zuerst ziehen, damit Messlauf und echter Bau denselben Strom sehen
  const uWander = rand(s);
  const uGap = rand(s);
  const nextId = s.nextId;
  const fail = (kind, why) => {
    s.nextId = nextId;
    return { ok: false, kind, why };
  };

  // Messlauf mit oy = 0. s.rng wird gesichert und zurückgesetzt.
  let probe;
  try {
    probe = createBuilder(s, { ox: 0, oy: 0, diff, meter: plan.meter, mechs: plan.mechs, measure: true, gateIndex: plan.gateIndex });
    const saved = s.rng;
    try {
      chunk.build(probe);
    } finally {
      s.rng = saved;
    }
  } catch (err) {
    return fail('reject', `Messlauf: ${err && err.message}`);
  }
  const rngAt = s.rng; // diesen Zufallsstand sieht jeder echte Bau, genau wie der Messlauf
  const m = probe.st;
  if (!m.route.length) return fail('reject', 'keine Route angegeben');
  if (![m.minY, m.maxY, m.platMinY, m.platMaxY].every(Number.isFinite)) return fail('reject', 'Chunk ist leer');
  const entry = m.route[0];
  const exit = m.route[m.route.length - 1];
  if (!entry || !exit || !Number.isFinite(entry.y) || !Number.isFinite(exit.x + exit.w) || !(exit.x + exit.w > entry.x + 100)) {
    return fail('reject', 'Route unbrauchbar');
  }
  const lo = Math.max(Y_MIN - m.platMinY, 24 - m.minY);
  const hi = Math.min(Y_MAX - m.platMaxY, H - 12 - m.maxY);
  if (lo > hi) return fail('reject', `passt nicht in den Höhenbereich (Plattformen ${Math.round(m.platMinY)} bis ${Math.round(m.platMaxY)})`);
  let extent = exit.x + exit.w;
  for (const p of m.platforms) extent = Math.max(extent, p.kind === 'moving' ? p.ox + Math.abs(p.ax) + p.w : p.x + p.w);

  // Höhe und Lücke: ein Sprung ohne Doppelsprung mit der Sicherheit des Spiels.
  // Gegenwind zählt: Ereignis, Windzone am Ende des vorigen Chunks, Windzone am Anfang dieses Chunks.
  let headwind = Math.max(plan.wind, g.tailWind);
  for (const z of m.zones) if (z.kind === 'wind' && z.x < GEN.WIND_REACH) headwind = Math.max(headwind, -z.vx);
  const wind = clamp(headwind, 0, WIND.MAX_VX + 100);
  const safe = safeFor(diff) * GEN.CONN_SAFE;
  const opts = { safe, dbl: false, wind };
  const gapMin = Math.max(GEN.GAP_MIN, g.endX + GEN.OVERLAP - g.nextX);
  const soft = 0.4 + 0.6 * clamp((diff - 1) / 3, 0, 1);
  const wish = g.lastY + (uWander - 0.5) * 2 * GEN.WANDER * soft + (GEN.MID_Y - g.lastY) * GEN.PULL - entry.y;
  const first = clamp(Math.round(wish), lo, hi);
  // Zweiter Versuch auf der Höhe, mit der die Chunks in tests/chunk-harness.mjs geprüft werden
  const alt = clamp(GEN.TEST_Y, lo, hi);

  let miss = { kind: 'skip', why: 'Verbindung nicht machbar' };
  const note = (m) => { if (miss.kind !== 'reject' || m.kind !== 'skip') miss = m; }; // ein Fehler im Chunk bleibt sichtbar
  for (const start of first === alt ? [first] : [first, alt]) {
    let oy = start;
    let gapMax = maxGap(g.lastY, oy + entry.y, opts);
    for (let k = 0; !(gapMax >= gapMin) && oy < hi && k < 80; k++) {
      oy = Math.min(hi, oy + 3); // zu hoher Anstieg: den Einstieg tiefer setzen
      gapMax = maxGap(g.lastY, oy + entry.y, opts);
    }
    if (!(gapMax >= gapMin) || Math.ceil(gapMin) > Math.floor(gapMax)) continue;
    const base = 0.55 + 0.35 * clamp((diff - 1) / 4, 0, 1);
    const frac = clamp(base + (uGap - 0.5) * 0.3, 0.3, 0.95);
    const gap = clamp(Math.round(gapMax * frac), Math.ceil(gapMin), Math.floor(gapMax));
    const ox = g.nextX + gap;
    const from = { kind: 'static', x: g.nextX - g.lastW, y: g.lastY, w: g.lastW };
    const to = { kind: 'static', x: ox, y: oy + entry.y, w: entry.w };
    if (!hopOk(from, to, { ...opts, minLand: 56 })) {
      note({ kind: 'skip', why: 'Sprung zum Einstieg zu schwer' });
      continue;
    }
    s.rng = rngAt;
    const r = buildAt(s, chunk, plan, diff, ox, oy);
    if (r.ok) return { ok: true, st: r.st, ox, oy, gap, diff, extent: ox + extent };
    s.nextId = nextId; // IDs des gescheiterten Baus verwerfen
    note(r);
    if (r.kind !== 'reject') break;
  }
  return fail(miss.kind, miss.why);
}

// Echter Bau mit echten IDs, Prüfung und Limits. Übernommen wird hier noch nichts.
function buildAt(s, chunk, plan, diff, ox, oy) {
  let b;
  let errors;
  try {
    b = createBuilder(s, { ox, oy, diff, meter: plan.meter, mechs: plan.mechs, gateIndex: plan.gateIndex });
    chunk.build(b);
    errors = sanity(b.st, oy);
    if (!errors.length) {
      errors = validateStaged(b.st, { ox, diff, mechs: plan.mechs, eventWind: plan.wind, isRest: !!chunk.rest });
    }
  } catch (err) {
    return { ok: false, kind: 'reject', why: `Bau: ${err && err.message}` };
  }
  if (errors.length) return { ok: false, kind: 'reject', why: errors[0] };
  const over = overLimits(s, b.st, plan.relax);
  if (over) return { ok: false, kind: 'limit', why: over };
  return { ok: true, st: b.st };
}

// Zahlen endlich, Route gehört zum Chunk, Plattformen im Höhenbereich
function sanity(st, oy) {
  const bad = (o, keys) => keys.some((k) => !Number.isFinite(o[k]));
  for (const p of st.platforms) if (bad(p, ['x', 'y', 'w'])) return ['Plattform mit ungültigen Zahlen'];
  for (const list of [st.enemies, st.hazards, st.zones, st.stars, st.powerups, st.gates]) {
    for (const o of list) if (bad(o, ['x', 'y'])) return [`${o.kind} mit ungültigen Zahlen`];
  }
  for (const p of st.route) if (!st.platforms.includes(p)) return ['Route enthält eine fremde Plattform'];
  if (oy + st.platMinY < Y_MIN - 0.5 || oy + st.platMaxY > Y_MAX + 0.5) return ['Plattformen außerhalb des Höhenbereichs'];
  return [];
}

// Gibt den Namen des überschrittenen Limits zurück oder ''
function overLimits(s, st, relax) {
  if (s.platforms.length + st.platforms.length > LIMITS.MAX_PLATFORMS) return 'platforms';
  if (s.hazards.length + st.hazards.length > LIMITS.MAX_HAZARDS) return 'hazards';
  const stars = relax ? LIMITS.MAX_STARS : LIMITS.MAX_STARS - GEN.STAR_RESERVE;
  if (s.stars.length + st.stars.length > stars) return 'stars';
  if (st.enemies.length && !enemiesFit(s, st.enemies)) return 'enemies';
  return '';
}

// Kein Fenster der Breite ENEMY_WIN darf mehr als MAX_ENEMIES_ACTIVE lebende Gegner enthalten.
// Jeder Gegner zählt über seine ganze Patrouille, das ist die vorsichtige Rechnung.
function enemiesFit(s, add) {
  const lo = [];
  const hi = [];
  const take = (e) => {
    if (e.dead > 0) return;
    lo.push(e.minX - GEN.ENEMY_WIN);
    hi.push(e.maxX);
  };
  for (const e of s.enemies) take(e);
  for (const e of add) take(e);
  for (let i = 0; i < lo.length; i++) {
    const a = lo[i] + 1e-3;
    let n = 0;
    for (let j = 0; j < lo.length; j++) if (lo[j] < a && a < hi[j]) n++;
    if (n > LIMITS.MAX_ENEMIES_ACTIVE) return false;
  }
  return true;
}

// Protokolle für Tests. Das Flag darf auch später gesetzt werden, die Listen entstehen dann bei Bedarf.
function logs(g) {
  if (!g.routeLog) g.routeLog = [];
  if (!g.chunkLog) g.chunkLog = [];
  if (!g.errors) g.errors = [];
  return g;
}

function noteError(g, chunk, why) {
  if (!g.keepLog) return;
  logs(g).errors.push({ chunk: chunk.id, why });
  if (g.errors.length > GEN.ERRORS) g.errors.shift();
}

// Letzter Ausweg, falls sogar flat scheitert: eine schlichte Plattform, damit die Welt weitergeht
function emergency(s) {
  const g = s.gen;
  const y = clamp(g.lastY, Y_MIN, Y_MAX);
  const x = g.nextX + GEN.GAP_MIN + 20;
  const plat = createStaticPlatform(s, x, y, 520, { ground: true });
  const st = {
    platforms: [plat], enemies: [], hazards: [], zones: [], stars: [], powerups: [], gates: [], route: [plat],
    maxX: 520, tags: new Set(),
  };
  return { ok: true, st, ox: x, oy: y, gap: GEN.GAP_MIN + 20, diff: 1, extent: x + plat.w };
}

// ---------- Übernahme in den Zustand ----------

function adopt(s, chunk, r, step, fallback) {
  const g = s.gen;
  const st = r.st;
  pushAll(s.platforms, st.platforms);
  pushAll(s.enemies, st.enemies);
  pushAll(s.hazards, st.hazards);
  pushAll(s.zones, st.zones);
  pushAll(s.stars, st.stars);
  pushAll(s.powerups, st.powerups);
  pushAll(s.gates, st.gates);

  const exit = st.route[st.route.length - 1];
  const id = chunk.id;
  g.nextX = exit.x + exit.w;
  g.tailWind = 0;
  for (const z of st.zones) if (z.kind === 'wind' && z.x + z.w > g.nextX - GEN.WIND_REACH) g.tailWind = Math.max(g.tailWind, -z.vx);
  g.lastY = exit.y;
  g.lastW = exit.w;
  g.endX = Math.max(r.extent, g.nextX);
  g.chunkId = id;
  g.lastKey = mechKey(chunk);
  g.recent.push(id);
  if (g.recent.length > GEN.RECENT) g.recent.shift();
  g.stats.chunks++;
  g.spans.push({ id, x0: r.ox, x1: g.endX, diff: r.diff });
  if (g.spans.length > GEN.SPANS) {
    g.spans.shift();
    g.dropped++;
  }
  queueHints(s, st, r.ox);

  if (g.keepLog) {
    logs(g);
    for (let i = 0; i < st.route.length; i++) {
      const p = st.route[i];
      const e = { id: p.id, kind: p.kind, x: p.x, y: p.y, w: p.w, chunk: id, conn: i === 0, diff: r.diff };
      if (p.kind === 'moving') Object.assign(e, { ox: p.ox, oy: p.oy, ax: p.ax, ay: p.ay, omega: p.omega, phase: p.phase });
      g.routeLog.push(e);
    }
    let idMin = Infinity;
    let idMax = -Infinity;
    for (const list of [st.platforms, st.enemies, st.hazards, st.zones, st.stars, st.powerups, st.gates]) {
      for (const o of list) {
        idMin = Math.min(idMin, o.id);
        idMax = Math.max(idMax, o.id);
      }
    }
    g.chunkLog.push({
      id, name: chunk.name, step, fallback, rest: !!chunk.rest, x0: r.ox, x1: g.endX, ox: r.ox, oy: r.oy, gap: r.gap,
      meter: toMeter(r.ox), diff: r.diff, tags: Array.from(st.tags), gate: st.gates.length ? st.gates[0].index : 0,
      gateX: st.gates.length ? st.gates[0].x : 0, stars: st.stars.length, enemies: st.enemies.length, idMin, idMax,
    });
  }
}

// ---------- Hinweise ----------

// Kleinster x Wert, an dem die Mechanik im Chunk zum ersten Mal vorkommt
function mechX(tag, st, fallback) {
  let x = Infinity;
  const take = (v) => { if (v < x) x = v; };
  switch (tag) {
    case 'walker': case 'jumper': case 'flyer': case 'charger':
      for (const e of st.enemies) if (e.kind === tag) take(e.x);
      break;
    case 'spike':
      for (const h of st.hazards) if (h.kind === 'spike') take(h.x);
      break;
    case 'lightning':
      for (const h of st.hazards) if (h.kind === 'lightning') take(h.x - h.w / 2);
      break;
    case 'wind': case 'rain':
      for (const z of st.zones) if (z.kind === tag) take(z.x);
      break;
    case 'moving':
      for (const p of st.platforms) if (p.kind === 'moving') take(p.ox - Math.abs(p.ax));
      break;
    case 'breakable':
      for (const p of st.platforms) if (p.kind === 'breakable') take(p.x);
      break;
    case 'fallingstar':
      for (const star of st.stars) if (star.falling) take(star.x);
      break;
    default:
  }
  return Number.isFinite(x) ? x : fallback;
}

function queueHints(s, st, ox) {
  const g = s.gen;
  for (const tag of st.tags) {
    if (!HINTS[tag] || g.hinted[tag]) continue;
    g.hinted[tag] = true;
    s.hints.queue.push({ x: mechX(tag, st, ox), text: HINTS[tag], mech: tag });
  }
}

// Zeigt den nächsten Hinweis als Banner, sobald der Spieler nah an der neuen Mechanik ist.
// Ein anderes Banner hat Vorrang. Der Hinweis wartet dann, solange er noch etwas nützt.
export function updateHints(s) {
  const hints = s.hints;
  const q = hints && hints.queue;
  if (!q || !q.length) return;
  const p = s.player;
  if (!p || p.dead || s.mode !== 'playing' || !Number.isFinite(p.x)) return;
  for (let i = 0; i < q.length; i++) {
    const h = q[i];
    if (hints.shown[h.mech] || p.x > h.x + GEN.HINT_STALE) {
      hints.shown[h.mech] = true;
      q.splice(i--, 1);
      continue;
    }
    if (p.x > h.x - GEN.HINT_LEAD && !s.banner) {
      hints.shown[h.mech] = true;
      q.splice(i, 1);
      banner(s, h.text, '', GEN.HINT_TIME);
      return;
    }
  }
}

// ---------- Abfrage und Aufräumen ----------

// Id des Chunks, in dem x liegt (die Lücke vor einem Chunk gehört noch zum vorigen)
export function chunkAt(s, x) {
  const g = s.gen;
  if (!g) return '';
  const spans = g.spans;
  for (let i = spans.length - 1; i >= 0; i--) if (x >= spans[i].x0) return spans[i].id;
  return g.dropped ? '' : 'start';
}

function compact(list, drop, lim) {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (!drop(list[i], lim)) list[j++] = list[i];
  if (j !== list.length) list.length = j;
}

const dropPlatform = (p, lim) => (p.kind === 'moving' ? p.ox + Math.abs(p.ax) + p.w : p.x + p.w) < lim;
const dropHazard = (h, lim) => (h.kind === 'lightning' ? h.x + h.w / 2 : h.x + h.w) < lim;
const dropEnemy = (e, lim) => e.dead >= DEAD_TIME || Math.max(e.x, e.maxX) + e.w < lim;
const dropZone = (z, lim) => z.x + z.w < lim;
const dropStar = (st, lim) => st.got || st.x < lim || st.y > H + 80;
const dropPowerup = (pu, lim) => pu.got || pu.x < lim;
const dropGate = (gt, lim) => gt.x + gt.w / 2 < lim;

// Entfernt alles links von camX minus CLEAN_BEHIND sowie tote Gegner und eingesammelte Sterne.
// Die Listen werden an Ort und Stelle verkürzt, es entsteht kein neues Array.
export function cleanup(s) {
  const lim = s.camX - LIMITS.CLEAN_BEHIND;
  compact(s.platforms, dropPlatform, lim);
  compact(s.hazards, dropHazard, lim);
  compact(s.enemies, dropEnemy, lim);
  compact(s.zones, dropZone, lim);
  compact(s.stars, dropStar, lim);
  compact(s.powerups, dropPowerup, lim);
  compact(s.gates, dropGate, lim);
}
