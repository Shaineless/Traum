// Dream Events: Sternschnuppen, Supermond, Traumsturm und Sternschauer.
// Geplant wird nach Metern, nie nahe an einem Traumtor und nie zwei Ereignisse gleichzeitig.
// Alle Zufallswerte kommen aus s.rng. In s.events.active.data liegen nur Zahlen.

import { EVENTS, GATE, LIMITS, METER, SCORE, START_X, W, gateMeter } from './constants.js';
import { createStar } from './entities.js';
import { emit } from './particles.js';
import { chance, pickWeighted, range } from './rng.js';
import { banner, meters } from './scoring.js';

const TYPES = ['meteor', 'supermoon', 'storm', 'shower'];
const WEIGHTS = { meteor: 3, supermoon: 2, shower: 2, storm: 2 };
const STORM_FROM = 800; // Meter: erst ab hier kommt der Traumsturm
const GATE_CLEAR = 120; // Meter Abstand zu jedem Traumtor
const RETRY = 0.3; // gelingt der Wurf nicht, wird nach diesem Anteil der Pause neu gewürfelt
const FADE = 1.5; // Sekunden für Ein und Ausblendung
const MAX_EVENT_STARS = 14; // so viele Ereignissterne dürfen gleichzeitig liegen oder fallen

const TEXT = {
  meteor: 'Sterne fallen vom Himmel. Fang sie auf.',
  supermoon: 'Der Mond leuchtet hell und bringt mehr Sterne.',
  storm: 'Böen schieben dich. Die Wolken werden wilder.',
  shower: 'Ein Schauer aus Sternen wartet vor dir.',
};
const BANNER_TIME = 3;

// Traumsturm: Böen aus zwei Sinuswellen, Summe der Gewichte ist 1
const STORM = { WIND: 70, A: 0.62, B: 0.38, PERIOD_A: 5.3, PERIOD_B: 2.1, LINES: 0.4, LINES_MIN: 25 };

// Sternschnuppen: Sterne fallen vom oberen Bildrand, vor dem Spieler und im Bild
const METEOR = { EVERY: 0.6, SKY: 0.35, AHEAD: [160, 460], EDGE: 30, TOP: -16, FALL: [90, 130], STOP: 0.5 };

// Sternschauer: ruhende Sterne über der nächsten Plattform hinter dem rechten Bildrand
const SHOWER = { EVERY: 0.35, MARGIN: 30, SPACING: 70, JITTER: 40, LOOKAHEAD: 900, EDGE: 14, LIFT: [50, 85], STOP: 0.5 };

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- Hüllkurve ----------

// 0 bis 1: blendet in FADE Sekunden ein und am Ende in FADE Sekunden aus, weich wie ein Smoothstep
function envelope(t, dur) {
  if (!(dur > 0) || !(t > 0)) return 0;
  const k = clamp(Math.min(t, dur - t) / FADE, 0, 1);
  return k * k * (3 - 2 * k);
}

export function eventEnvelope(s) {
  const a = s.events.active;
  if (!a) return null;
  return { type: a.type, env: envelope(a.t, a.dur), t: a.t, dur: a.dur };
}

// Sanfte Böen mit wechselndem Vorzeichen, höchstens STORM.WIND px pro Sekunde
export function eventWindVx(s) {
  const a = s.events.active;
  if (!a || a.type !== 'storm') return 0;
  const d = a.data || {};
  const gust = STORM.A * Math.sin((a.t * 2 * Math.PI) / STORM.PERIOD_A + num(d.pa)) + STORM.B * Math.sin((a.t * 2 * Math.PI) / STORM.PERIOD_B + num(d.pb));
  return clamp(STORM.WIND * envelope(a.t, a.dur) * gust, -STORM.WIND, STORM.WIND) + 0; // plus 0 macht aus minus 0 eine 0
}

// ---------- Start und Ende ----------

function endEvent(s) {
  const ev = s.events;
  ev.active = null;
  ev.starBoost = false;
  ev.enemyBoost = false;
}

export function startEvent(s, type) {
  if (!TYPES.includes(type)) return false;
  const ev = s.events;
  if (ev.active) endEvent(s);
  const data = {};
  if (type === 'meteor') {
    data.timer = METEOR.EVERY;
    data.sky = 0;
  } else if (type === 'shower') {
    data.timer = SHOWER.EVERY;
  } else if (type === 'storm') {
    data.pa = range(s, 0, 2 * Math.PI);
    data.pb = range(s, 0, 2 * Math.PI);
    data.lines = 0;
  }
  ev.active = { type, t: 0, dur: EVENTS[type].dur, data };
  ev.count += 1;
  ev.starBoost = type === 'supermoon';
  ev.enemyBoost = type === 'storm';
  banner(s, EVENTS[type].name, TEXT[type], BANNER_TIME);
  return true;
}

// ---------- Planung ----------

// Bis zu welchem Meter ist bei Meter m wegen eines Traumtors gesperrt? 0, wenn nichts sperrt.
// Sowohl die Sollmeter des Generators als auch tatsächlich vorhandene Tore zählen, davor und danach.
function gateBlockedUntil(s, m) {
  let end = 0;
  const n = Math.round((m - GATE.FIRST) / GATE.INTERVAL) + 1;
  for (let k = Math.max(1, n - 1); k <= n + 1; k++) {
    const g = gateMeter(k);
    if (Math.abs(g - m) <= GATE_CLEAR) end = Math.max(end, g + GATE_CLEAR);
  }
  for (const gate of s.gates) {
    const g = (gate.x - START_X) / METER;
    if (Math.abs(g - m) <= GATE_CLEAR) end = Math.max(end, g + GATE_CLEAR);
  }
  return end;
}

function plan(s) {
  const ev = s.events;
  const m = meters(s);
  if (m < EVENTS.FIRST_METER || m < num(ev.nextMeter)) return;
  const [lo, hi] = EVENTS.EVERY;
  // Am Tor wird nichts gestartet. Der nächste Versuch kommt etwas nach der Sperre, damit nicht jedes Tor das gleiche Ereignis nach sich zieht.
  const blocked = gateBlockedUntil(s, m);
  if (blocked > 0) {
    ev.nextMeter = blocked + range(s, 0, lo);
    return;
  }
  if (!chance(s, EVENTS.CHANCE)) {
    ev.nextMeter = m + range(s, lo, hi) * RETRY;
    return;
  }
  const type = pickWeighted(s, TYPES, (t) => (t === 'storm' && m < STORM_FROM ? 0 : WEIGHTS[t]));
  ev.nextMeter = m + range(s, lo, hi);
  startEvent(s, type);
}

// ---------- Sterne des Ereignisses ----------

// Zählt lebende Ereignissterne und merkt sich das rechteste ruhende Exemplar
function scanEventStars(s) {
  let n = 0;
  let lastX = -Infinity;
  for (const st of s.stars) {
    if (st.bonus !== 'event' || st.got) continue;
    n++;
    if (!st.falling && st.x > lastX) lastX = st.x;
  }
  return { n, lastX };
}

const hasRoom = (s, n) => n < MAX_EVENT_STARS && s.stars.length < LIMITS.MAX_STARS;

// Ein fallender Stern am oberen Bildrand, vor dem Spieler und nie hinter der Kamera
function spawnMeteorStar(s) {
  const { n } = scanEventStars(s);
  if (!hasRoom(s, n)) return;
  const p = s.player;
  const cx = p.x + p.w / 2;
  const x = clamp(cx + range(s, METEOR.AHEAD[0], METEOR.AHEAD[1]), s.camX + METEOR.EDGE, s.camX + W - METEOR.EDGE);
  const fallSpeed = range(s, METEOR.FALL[0], METEOR.FALL[1]);
  if (!(x > cx)) return;
  const star = createStar(s, x, METEOR.TOP, { value: SCORE.EVENT_STAR, bonus: 'event', falling: true, fallSpeed });
  star.started = true;
  star.vy = fallSpeed;
  s.stars.push(star);
  emit(s, 'meteor', x, 0);
}

// Ein ruhender Stern über der nächsten festen Plattform hinter dem rechten Bildrand
function spawnShowerStar(s) {
  const { n, lastX } = scanEventStars(s);
  if (!hasRoom(s, n)) return;
  const view = s.camX + W;
  const xMin = Math.max(view + SHOWER.MARGIN, lastX + SHOWER.SPACING);
  let best = null;
  for (const pl of s.platforms) {
    if (pl.kind === 'moving' || pl.x > view + SHOWER.LOOKAHEAD) continue;
    if (pl.x + pl.w - SHOWER.EDGE < xMin) continue;
    if (!best || pl.x < best.x) best = pl;
  }
  if (!best) return;
  const lo = Math.max(best.x + SHOWER.EDGE, xMin);
  const hi = Math.min(best.x + best.w - SHOWER.EDGE, lo + SHOWER.JITTER);
  const x = range(s, lo, Math.max(lo, hi));
  const y = Math.max(24, best.y - range(s, SHOWER.LIFT[0], SHOWER.LIFT[1]));
  s.stars.push(createStar(s, x, y, { value: SCORE.EVENT_STAR, bonus: 'event' }));
}

// ---------- Schritt ----------

// Zählt den Timer data[key] herunter. Wahr, wenn er abgelaufen ist (er läuft dann für den nächsten Takt weiter).
function due(d, key, dt, every) {
  d[key] = (Number.isFinite(d[key]) ? d[key] : every) - dt;
  if (d[key] > 0) return false;
  d[key] += every;
  return true;
}

function runEvent(s, a, dt) {
  const d = a.data;
  const left = a.dur - a.t;
  if (a.type === 'meteor') {
    if (due(d, 'sky', dt, METEOR.SKY)) emit(s, 'meteor', s.camX + range(s, W * 0.25, W - 20), range(s, 10, 110));
    if (due(d, 'timer', dt, METEOR.EVERY) && left > METEOR.STOP) spawnMeteorStar(s);
  } else if (a.type === 'shower') {
    if (due(d, 'timer', dt, SHOWER.EVERY) && left > SHOWER.STOP) spawnShowerStar(s);
  } else if (a.type === 'storm') {
    // Windlinien zeigen die Böe, solange sie spürbar ist
    if (due(d, 'lines', dt, STORM.LINES)) {
      const vx = eventWindVx(s);
      if (Math.abs(vx) > STORM.LINES_MIN) emit(s, 'windline', s.camX + range(s, 0, W), range(s, 40, 380), { dir: Math.sign(vx) });
    }
  }
}

export function updateEvents(s, dt) {
  if (!(dt > 0)) return;
  const ev = s.events;
  const a = ev.active;
  if (!a) {
    if (!s.player.dead) plan(s);
    return;
  }
  if (!TYPES.includes(a.type) || !(a.dur > 0) || !a.data) {
    endEvent(s);
    return;
  }
  a.t += dt;
  if (a.t >= a.dur) {
    endEvent(s);
    return;
  }
  ev.starBoost = a.type === 'supermoon';
  ev.enemyBoost = a.type === 'storm';
  if (!s.player.dead) runEvent(s, a, dt);
}
