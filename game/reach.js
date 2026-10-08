// Erreichbarkeit von Sprüngen. Dieselben Konstanten wie die Spielerphysik,
// damit der Generator nie einen unmöglichen Sprung erzeugt.

import { PHYS } from './constants.js';

const { GRAVITY: G, JUMP_SPEED: V1, DOUBLE_JUMP_SPEED: V2, MOVE_SPEED, W: PW } = PHYS;

const DT = 1 / 120;
const cache = new Map();

// Zeit in Sekunden, die der Spieler nach dem Absprung in der Luft sein kann, bis seine Füße
// beim Fallen die Höhe dy erreichen. dy > 0: Ziel liegt tiefer, dy < 0: Ziel liegt höher.
// 0 bedeutet unerreichbar. dbl: erlaubt einen zweiten Sprung in der Luft (günstigster Zeitpunkt).
export function airTime(dy, dbl = false, v1 = V1) {
  const key = `${Math.round(dy / 2)}|${dbl ? 1 : 0}|${v1}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  const disc = v1 * v1 + 2 * G * dy;
  if (disc >= 0) best = (v1 + Math.sqrt(disc)) / G;
  if (dbl) {
    for (let t1 = 0; t1 < 1.2; t1 += DT) {
      const y1 = -v1 * t1 + 0.5 * G * t1 * t1; // nach unten positiv
      if (y1 > dy) break; // schon auf Zielhöhe oder tiefer gefallen
      const d2 = V2 * V2 + 2 * G * (dy - y1);
      if (d2 < 0) continue;
      const total = t1 + (V2 + Math.sqrt(d2)) / G;
      if (total > best) best = total;
    }
  }
  cache.set(key, best);
  return best;
}

// Maximale Sprunghöhe in Pixeln
export function maxRise(dbl = false, v1 = V1) {
  const single = (v1 * v1) / (2 * G);
  return dbl ? single + (V2 * V2) / (2 * G) : single;
}

// Platten sind { x, y, w }, y = Oberkante. Gibt zurück, welchen Anteil der maximalen Sprungweite
// der Sprung braucht (0 = trivial, 1 = genau am Limit, Infinity = unmöglich).
export function hopRatio(from, to, { dbl = false, wind = 0 } = {}) {
  const v1 = from.launch || V1; // Sprungwolke schleudert stärker nach oben
  const dy = to.y - from.y;
  if (dy < 0 && -dy > maxRise(dbl, v1)) return Infinity;
  const needed = Math.max(0, to.x - PW - (from.x + from.w));
  const ratioY = dy < 0 ? (-dy / maxRise(dbl, v1)) * 0.9 : 0;
  if (needed === 0) return ratioY;
  const t = airTime(dy, dbl, v1);
  if (t <= 0) return Infinity;
  const range = Math.max(40, MOVE_SPEED - wind) * t;
  return Math.max(needed / range, ratioY);
}

// safe: erlaubter Anteil des Limits. Kleine Zahl = großzügiger Sicherheitsabstand.
export function hopOk(from, to, { safe = 0.8, dbl = false, wind = 0, minLand = 56 } = {}) {
  if (to.w < minLand) return false;
  return hopRatio(from, to, { dbl, wind }) <= safe;
}

// Position einer Plattform zum Zeitpunkt t (Sinusbewegung, wie platforms.js sie umsetzt)
export function platformAt(p, t) {
  if (p.kind !== 'moving') return { x: p.x, y: p.y, w: p.w };
  const a = p.omega * t + p.phase;
  return { x: p.ox + p.ax * Math.sin(a), y: p.oy + p.ay * Math.sin(a), w: p.w };
}

// Wie hopOk, berücksichtigt aber bewegliche Plattformen: der Sprung muss in mindestens
// minFrac aller Zeitpunkte eines Umlaufs machbar sein (der Spieler kann warten).
export function hopOkMoving(from, to, opts = {}, minFrac = 0.3) {
  // Blinkwolken stehen still, sind aber nur im Takt fest. Der Spieler wartet, also genügt ein genug großer fester Anteil.
  if (to.kind === 'blink' && to.on < 0.5) return false;
  if (from.kind === 'blink' && from.period * from.on < 2) return false; // zu kurz zum Anlauf und Absprung
  if (from.kind !== 'moving' && to.kind !== 'moving') return hopOk(from, to, opts);
  const omega = from.kind === 'moving' ? from.omega : to.omega;
  const period = (Math.PI * 2) / omega;
  const N = 16;
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const t = (period * i) / N;
    if (hopOk(platformAt(from, t), platformAt(to, t), opts)) ok++;
  }
  return ok / N >= minFrac;
}

// Größte Lücke zwischen zwei Plattformkanten, die für einen Sprung von Höhe fromY nach toY erlaubt ist.
// Negativ unendlich, wenn die Höhe allein schon nicht erreichbar ist.
export function maxGap(fromY, toY, { safe = 0.8, dbl = false, wind = 0 } = {}) {
  const dy = toY - fromY;
  if (dy < 0 && -dy * 0.9 > safe * maxRise(dbl)) return -Infinity;
  const t = airTime(dy, dbl);
  if (t <= 0) return -Infinity;
  return safe * Math.max(40, MOVE_SPEED - wind) * t + PW;
}
