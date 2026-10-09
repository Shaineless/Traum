// Chunk Layouts der Albtraum Phase (Schwierigkeit 7 bis 9), ab etwa 1650 Metern.
// Jeder Chunk: { id, name, diff, weight, min, max, mech, rest, build(b) }. Siehe docs/ARCHITEKTUR.md.
// Koordinaten in build(b) sind lokal: x = 0 ist die linke Kante der ersten Plattform, y = 0 deren Oberkante.
// Die Layouts sind für Spieler gedacht, die Springen, Doppelsprung, Gleiten, Stampfen, Wurfstern und Wolkenstoß beherrschen.
// Sie sind dicht und schnell (enge Wolken, Lücken nahe am Limit, mehrere Gefahren gleichzeitig, drei und mehr Mechaniken),
// bleiben aber fair: jede Gefahr kündigt sich an, die Route braucht nur Sprung und Doppelsprung, und jedes Layout hat
// sichere Inseln zum Atmen. Stampfen, Wurfstern und Wolkenstoß sind Abkürzungen und Auswege, nie Pflicht.
// Gegner stehen nie in den ersten 220 px, Hindernisse nie auf dem einzigen Landeplatz einer Lücke.
// Alle Lücken rechnen mit etwas Gegenwind (Sturmereignis) und leiten ihre Größe aus b.diff ab.

import { ENEMY, PHYS, SPIKE, SPRING } from '../constants.js';
import { airTime, maxGap } from '../reach.js';
import { safeFor } from '../validate.js';

const PW = PHYS.W; // Spielerbreite: Lücken bis zu dieser Breite brauchen keinen Anlauf
const TAU = Math.PI * 2;
const STORM = 50; // Gegenwind in px/s, mit dem jede Lücke mindestens gerechnet wird (Sturm bis 40)
const ICE_HEAD = 70; // Absprung von Eis: validate.js rechnet mit diesem Gegenwind
const AIR = PHYS.GRAVITY / 2; // halbe Schwerkraft für die Flugbahn y = y0 + v t + AIR t²

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Schwierigkeit des Builders, mindestens 1 (auch wenn sie fehlt)
const diffOf = (b) => Math.max(1, Number.isFinite(b.diff) ? b.diff : 1);
// Fortschritt 0 bis 1 im Spiel ab Meter from über span Meter: Chunks werden mit der Zeit etwas strenger
const ramp = (b, from, span = 1500) => clamp(((Number.isFinite(b.meter) ? b.meter : from) - from) / span, 0, 1);
const wrap = (v) => v - Math.floor(v);

// Lücke (Kante zu Kante) für einen Sprung von Höhe y1 nach y2. frac ist der Anteil dessen, was die Schwierigkeit erlaubt.
// dbl rechnet mit dem Doppelsprung (Lücken weit über dem einfachen Sprung, nur mit dem zweiten Sprung machbar).
function gapFor(b, y1, y2, frac, wind = STORM, dbl = false) {
  const room = maxGap(y1, y2, { safe: safeFor(diffOf(b)), wind, dbl });
  return Math.round(Number.isFinite(room) ? PW + (room - PW) * frac : 0);
}

// Lücke hinter einer Sprungwolke: sie schleudert mit SPRING.SPEED hoch, der Spieler fliegt mit vollem Lauftempo weiter.
// Der Spieler landet meist nicht an der rechten Kante der Wolke, darum bleibt frac unter 0,85.
function springGap(b, dy, frac, wind = STORM) {
  const t = airTime(dy, false, SPRING.SPEED);
  if (!(t > 0)) return 0;
  return Math.round(PW + safeFor(diffOf(b)) * frac * Math.max(40, PHYS.MOVE_SPEED - wind) * t);
}

// Sternbogen über einer Lücke von x1 (rechte Kante links, Höhe y1) bis x2 (linke Kante rechts, Höhe y2)
function gapArc(b, x1, y1, x2, y2, n = 3) {
  b.starArc(x1 - 6, x2 + 6, Math.min(y1, y2) - 30, clamp((x2 - x1) * 0.35, 38, 72), n);
}

// Flugbahn nach dem Start von einer Sprungwolke (Mitte x0, Oberkante y0) bei vollem Lauftempo vx: Sterne im Takt
function springTrail(b, x0, y0, vx, n, t0 = 0.14, t1 = 0.86) {
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
    b.star(x0 + vx * t, y0 - PHYS.H / 2 - SPRING.SPEED * t + AIR * t * t);
  }
}

// Begrenzt die Streifzone eines Bodengegners auf x0 bis x1 (lokal zur Plattform).
// So bleiben Landung und Absprung der Plattform frei von Gegnern.
function patrol(e, plat, x0, x1, t = 0.5) {
  e.minX = plat.x + x0;
  e.maxX = Math.max(e.minX, plat.x + x1 - e.w);
  e.x = e.minX + (e.maxX - e.minX) * t;
  e.spawnX = e.x;
}

// Bodengegner (walker, jumper, charger) in der Zone x0 bis x1 der Plattform, Blickrichtung und Startpunkt zufällig
function guard(b, kind, plat, x0, x1, o = {}) {
  const e = b[kind](plat, 0.5, { dir: o.dir ?? b.pick([-1, 1]) });
  patrol(e, plat, x0, x1, o.t ?? b.rand(0.2, 0.8));
  return e;
}

// Stachelwolke im Abstand off von der linken Kante der Plattform
const spikeAt = (b, plat, off) => b.spike(plat, off / (plat.w - SPIKE.w));

// Brüchige Plattform: Breite nie unter dem Mindestmaß von validate.js
const crumbleW = (b, lo, hi, tightness = 0) => Math.max(92, b.int(lo, hi) - Math.round(tightness));

// Oberkante der höchsten Plattform (lokal) im Bereich x0 bis x1, so wie validate.js sie für Flieger und Hagelwolken prüft
function surfaceIn(b, x0, x1) {
  let top = Infinity;
  for (const p of b.st.platforms) {
    const px = p.x - b.ox;
    if (px + p.w <= x0 || px >= x1) continue;
    top = Math.min(top, (p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y) - b.oy);
  }
  return top;
}

// Schwebende Gegner halten 165 px Abstand zur höchsten Fläche in der Nähe (normale Sprünge treffen sie nie).
// Über jedem hängt ein Stern: er hält den Chunk unter dem Bildrand und belohnt den Stampfer mit dem Abprall.
const FLYER_AMP = 6;
function flyerAbove(b, cx, o = {}) {
  const range = o.range ?? 110;
  const half = range / 2 + ENEMY.FLYER.w / 2;
  const y = surfaceIn(b, cx - half - 200, cx + half + 200) - (o.lift ?? 183) - FLYER_AMP;
  const e = b.flyer(cx, y, { range, amp: FLYER_AMP, dir: o.dir ?? 1, phase: o.phase ?? 0 });
  if (o.star !== false) b.star(cx, y - 40);
  return e;
}
const HAIL_AMP = 8;
function hailAbove(b, cx, o = {}) {
  const range = o.range ?? 100;
  const half = range / 2 + ENEMY.HAILCLOUD.w / 2;
  const y = surfaceIn(b, cx - half - 200, cx + half + 200) - (o.lift ?? 183) - HAIL_AMP;
  const e = b.hailcloud(cx, y, { range, amp: HAIL_AMP, dir: o.dir ?? -1, phase: o.phase ?? 0 });
  if (o.star !== false) b.star(cx, y - 40);
  return e;
}

// Welle aus Blinkwolken: jede erscheint so viel später als die vorige, wie der Spieler für den Weg dazwischen braucht
// (etwa 230 px pro Sekunde mit Absprüngen). Gibt die Optionen für die nächste Blinkwolke mit Mitte cx zurück.
function blinkWave(b, period) {
  let phase = b.rand(0, 1);
  let last = null;
  return (cx) => {
    if (last !== null) phase -= (cx - last) / 230 / period;
    last = cx;
    return { period, phase: wrap(phase) };
  };
}

const POWER_TYPES = ['shield', 'magnet', 'feather', 'double'];

export const NIGHTMARE = [
  // Wolkenleiter: drei Stufen steigen an, auf jeder wartet etwas anderes (Gewitterwolke, Stachelwolke, Gewitterwolke),
  // über den Lücken kreisen Flieger. Wer zu früh abspringt, trifft die Flieger im Doppelsprung von unten, wer sie sieht,
  // stampft sie im Abstieg und springt im Abprall zur nächsten Stufe. Der Abstieg zum Ausstieg ist die Belohnung.
  {
    id: 'cloud-ladder',
    name: 'Wolkenleiter',
    diff: 7,
    weight: 3,
    min: 1650,
    max: Infinity,
    mech: ['spike', 'walker', 'flyer'],
    rest: false,
    build(b) {
      const k = ramp(b, 1650);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const route = [a];
      const plan = b.pick([['walker', 'spike', 'walker'], ['spike', 'walker', 'spike']]);
      const gaps = [];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const ny = y - b.int(30, 40);
        const gap = gapFor(b, y, ny, b.rand(0.76, 0.86) + 0.04 * k);
        const w = b.int(206, 220) - Math.round(8 * k);
        const p = b.cloud(x + gap, ny, w);
        if (plan[i] === 'walker') guard(b, 'walker', p, 66, w - 66);
        else spikeAt(b, p, (w - SPIKE.w) / 2);
        gapArc(b, x, y, x + gap, ny, 2);
        b.starArc(x + gap + 50, x + gap + w - 50, ny - 30, 58, 3);
        gaps.push(x + gap / 2);
        route.push(p);
        x += gap + w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x + gap, 0, b.int(230, 250));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      // Flieger über der zweiten Lücke und über dem Abstieg, gegenläufig
      flyerAbove(b, gaps[1], { range: 110, dir: 1, phase: 0 });
      flyerAbove(b, x + gap / 2, { range: 110, dir: -1, phase: Math.PI });
      b.route(...route);
    },
  },

  // Gewitterkorridor: Blitz, Komet und Wind in Folge. Auf der ersten Strecke schlagen zwei Blitze versetzt ein, eine kleine
  // sichere Insel gibt Luft, dann bläst der Wind dem Spieler entgegen, und auf der zweiten Strecke wechseln Komet und Blitz.
  // Alles kündigt sich über eine Sekunde an. Die Sterne in den Zonen sind Köder: erst nach dem Einschlag holen.
  {
    id: 'storm-corridor',
    name: 'Gewitterkorridor',
    diff: 7,
    weight: 2,
    min: 1700,
    max: Infinity,
    mech: ['lightning', 'comet', 'wind'],
    rest: false,
    build(b) {
      const k = ramp(b, 1700);
      const head = Math.round(70 + 26 * k + b.rand(0, 10)); // Gegenwind über der mittleren Lücke
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      // Erste Strecke: zwei Blitze, zeitlich versetzt
      const g1 = gapFor(b, 0, 0, b.rand(0.78, 0.9));
      const r1x = a.w + g1;
      const w1 = b.int(340, 370);
      const r1 = b.ground(r1x, 0, w1);
      gapArc(b, a.w, 0, r1x, 0, 2);
      const l1 = r1x + b.int(110, 124);
      const l2 = l1 + b.int(160, 180);
      const idle = b.rand(0.9, 1.2);
      b.lightning(l1, { idle });
      b.lightning(l2, { idle: idle + b.rand(1.1, 1.5) });
      b.starArc(l1 - 40, l1 + 40, -30, 80, 3);
      b.starArc(l2 - 40, l2 + 40, -30, 80, 3);
      // Sichere Insel, danach Gegenwind über der Lücke
      const g2 = gapFor(b, 0, 0, b.rand(0.78, 0.9));
      const ix = r1x + w1 + g2;
      const iw = b.int(150, 170);
      const island = b.cloud(ix, 0, iw);
      b.starsOver(island, 2, 44, 34);
      gapArc(b, r1x + w1, 0, ix, 0, 2);
      const g3 = gapFor(b, 0, 0, b.rand(0.7, 0.82), Math.max(STORM, head + 6));
      const r2x = ix + iw + g3;
      const w2 = b.int(340, 370);
      const r2 = b.ground(r2x, 0, w2);
      b.wind(ix + iw * 0.5, -175, g3 + iw * 0.5 + 90, 240, { vx: -head });
      gapArc(b, ix + iw, 0, r2x, 0, 2);
      // Zweite Strecke: Komet, dann Blitz
      const c1 = r2x + b.int(110, 124);
      const l3 = c1 + b.int(160, 180);
      b.comet(c1, 0, { idle: b.rand(1.1, 1.4), dir: b.pick([-1, 1]) });
      b.lightning(l3, { idle: b.rand(1.2, 1.8) });
      b.starArc(c1 - 42, c1 + 42, -30, 80, 3);
      b.starArc(l3 - 40, l3 + 40, -30, 80, 3);
      const g4 = gapFor(b, 0, 0, b.rand(0.78, 0.9));
      const exit = b.ground(r2x + w2 + g4, 0, b.int(240, 260));
      gapArc(b, r2x + w2, 0, exit.x - b.ox, 0, 2);
      b.starsOver(exit, 2, 42, 30);
      b.route(a, r1, island, r2, exit);
    },
  },

  // Blink Eis Labyrinth: Eiswolken und Blinkwolken wechseln sich im Zickzack ab. Auf dem Eis rutscht der Spieler weit,
  // die Blinkwolken erscheinen als Welle in Laufrichtung. Auf der festen Insel in der Mitte lässt sich ruhig auf die
  // nächste Welle warten, denn das Flackern kündigt jedes Verschwinden an.
  {
    id: 'blink-ice-maze',
    name: 'Blink Eis Labyrinth',
    diff: 7,
    weight: 2,
    min: 1650,
    max: Infinity,
    mech: ['blink', 'ice'],
    rest: false,
    build(b) {
      const k = ramp(b, 1650);
      const next = blinkWave(b, b.rand(3.5, 4.0));
      const a = b.ground(0, 0, b.int(230, 250));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      let onIce = false;
      // kind: 'ice' | 'blink' | 'cloud'. Von Eis springt man mit weniger Anlauf, darum rechnet gapFor dort mit ICE_HEAD.
      const put = (kind, ny, frac, w) => {
        const gap = gapFor(b, y, ny, frac, onIce ? ICE_HEAD : STORM);
        const px = x + gap;
        let p;
        if (kind === 'ice') p = b.ice(px, ny, w);
        else if (kind === 'blink') p = b.blink(px, ny, w, next(px + w / 2));
        else p = b.cloud(px, ny, w);
        gapArc(b, x, y, px, ny, 2);
        route.push(p);
        onIce = kind === 'ice';
        x = px + w;
        y = ny;
        return p;
      };
      const ice1 = put('ice', b.pick([-6, 0, 8]), b.rand(0.8, 0.9), b.int(150, 164));
      b.starsOver(ice1, 2, 42, 40);
      const bl1 = put('blink', y - b.int(36, 54), b.rand(0.7, 0.82) + 0.04 * k, b.int(96, 106) - Math.round(4 * k));
      b.star(bl1.x - b.ox + bl1.w / 2, bl1.y - b.oy - 44);
      const isl = put('cloud', y + b.int(20, 38), b.rand(0.78, 0.9), b.int(138, 150));
      b.starsOver(isl, 2, 44, 40);
      const ice2 = put('ice', y + b.pick([-12, 0, 10]), b.rand(0.8, 0.9), b.int(150, 162));
      b.starsOver(ice2, 2, 42, 40);
      const bl2 = put('blink', y - b.int(30, 48), b.rand(0.7, 0.82) + 0.04 * k, b.int(96, 104) - Math.round(4 * k));
      b.star(bl2.x - b.ox + bl2.w / 2, bl2.y - b.oy - 44);
      const ey = Math.min(0, y + b.int(30, 50));
      const exit = b.ground(x + gapFor(b, y, ey, b.rand(0.78, 0.9)), ey, b.int(240, 260));
      gapArc(b, x, y, exit.x - b.ox, ey, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Hagel Gauntlet: zwei Inseln, auf jeder bewacht eine Sturmwolke die Mitte, und über den Lücken davor und dahinter
  // fächert je eine Hagelwolke nach unten. Die Salven sind getaktet: wer die Vorwarnung liest, springt, wenn der Fächer
  // unter dem Bogen vorbeigeht. Die Sturmwolke lädt erst auf, wenn der Spieler nahe ist, und bleibt in ihrer Zone.
  {
    id: 'hail-charger-gauntlet',
    name: 'Hagel Gauntlet',
    diff: 7.5,
    weight: 2,
    min: 1900,
    max: Infinity,
    mech: ['hailcloud', 'charger'],
    rest: false,
    build(b) {
      const k = ramp(b, 1900);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const mids = [];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 2; i++) {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -22, 22);
        const gap = gapFor(b, y, ny, b.rand(0.8, 0.9) + 0.04 * k);
        const w = b.int(320, 336);
        const p = b.cloud(x + gap, ny, w);
        const from = b.int(112, 124);
        guard(b, 'charger', p, from, from + b.int(122, 136), { dir: i % 2 === 0 ? -1 : 1 });
        gapArc(b, x, y, x + gap, ny, 2);
        b.starLine(x + gap + 36, ny - 42, x + gap + from - 20, ny - 42, 2);
        b.starArc(x + gap + from, x + gap + from + 140, ny - 30, 96, 4);
        mids.push(x + gap / 2);
        route.push(p);
        x += gap + w;
        y = ny;
      }
      const gap = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x + gap, 0, b.int(250, 270));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      // Hagelwolken über der ersten und der letzten Lücke, versetzt im Takt
      hailAbove(b, mids[0], { range: 90, dir: 1, phase: 0.1 });
      hailAbove(b, x + gap / 2, { range: 90, dir: -1, phase: 0.75 });
      b.route(...route);
    },
  },

  // Katapult Kette: drei Sprungwolken schleudern den Spieler über drei Abgründe, jede Landung ist ein kleiner Knoten mit dem
  // nächsten Katapult. Über den Flugbahnen schweben Flieger genau da, wo der Abstieg beginnt: wer wartet, bis sie weg sind,
  // fliegt frei, wer sie sieht, stampft sie im Abstieg und springt im Abprall weiter. Die Sterne zeigen jede Bahn.
  {
    id: 'catapult-chain',
    name: 'Katapult Kette',
    diff: 7.5,
    weight: 2,
    min: 1900,
    max: Infinity,
    mech: ['spring', 'flyer'],
    rest: false,
    build(b) {
      const k = ramp(b, 1900);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const flights = [];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const sgap = b.int(58, 76);
        const sw = b.int(78, 90);
        const sp = b.spring(x + sgap, y, sw);
        route.push(sp);
        const sx = x + sgap;
        const ny = i === 2 ? 0 : clamp(y + b.pick([-24, -12, 0, 12, 24]), -36, 36);
        const dgap = springGap(b, ny - y, b.rand(0.66, 0.78) + 0.04 * k);
        const nw = i === 2 ? b.int(250, 270) : b.int(150, 162) - Math.round(6 * k);
        const node = i === 2 ? b.ground(sx + sw + dgap, ny, nw) : b.cloud(sx + sw + dgap, ny, nw);
        springTrail(b, sx + sw / 2, y, PHYS.MOVE_SPEED, 4, 0.2, 0.8);
        flights.push(sx + sw / 2 + (sw / 2 + dgap) * 0.75);
        route.push(node);
        x = sx + sw + dgap + nw;
        y = ny;
      }
      b.starsOver(route[route.length - 1], 3, 42, 30);
      // Flieger über der zweiten und dritten Flugbahn, gegenläufig
      flyerAbove(b, flights[1], { range: 60, dir: 1, phase: 0 });
      flyerAbove(b, flights[2], { range: 60, dir: -1, phase: Math.PI });
      b.route(...route);
    },
  },

  // Regenbogen Strecke: gleich am Anfang liegt ein Regenbogen Dash. Danach reihen sich Wolken mit Gewitterwolken und
  // Stachelwolken, zum Schluss steht eine Wiese voll dicht an dicht patrouillierender Gewitterwolken. Mit dem Dash fegt der
  // Spieler über Lücken und durch ein bis zwei Gegner der Reihe, bevor die Abklingzeit ihn wieder springen lässt. Ohne ihn geht
  // es mit Springen, Stampfen und Doppelsprung.
  {
    id: 'rainbow-dash-run',
    name: 'Regenbogen Strecke',
    diff: 7.5,
    weight: 2,
    min: 1900,
    max: Infinity,
    mech: ['powerup', 'walker', 'spike'],
    rest: false,
    build(b) {
      const k = ramp(b, 1900);
      const a = b.ground(0, 0, b.int(280, 300));
      b.powerup('dash', 150, -40);
      b.starLine(190, -42, a.w - 40, -42, 3);
      const route = [a];
      const plan = b.pick([['walker', 'spike', 'walker'], ['spike', 'walker', 'spike']]);
      let x = a.w;
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const ny = clamp(y + b.pick([-18, -9, 0, 9, 18]), -30, 30);
        const gap = gapFor(b, y, ny, b.rand(0.8, 0.9) + 0.04 * k);
        const w = plan[i] === 'walker' ? b.int(214, 228) : b.int(212, 224);
        const p = b.cloud(x + gap, ny, w);
        if (plan[i] === 'walker') guard(b, 'walker', p, 66, w - 66);
        else spikeAt(b, p, (w - SPIKE.w) / 2);
        gapArc(b, x, y, x + gap, ny, 2);
        route.push(p);
        x += gap + w;
        y = ny;
      }
      // Finale: drei Gewitterwolken dicht an dicht auf einer Wiese
      const gap = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const fw = b.int(510, 526);
      const fin = b.ground(x + gap, 0, fw);
      gapArc(b, x, y, x + gap, 0, 2);
      for (let i = 0; i < 3; i++) {
        const z0 = 110 + i * 126;
        guard(b, 'walker', fin, z0, z0 + 92, { dir: i % 2 === 0 ? -1 : 1 });
        b.starArc(fin.x - b.ox + z0 - 4, fin.x - b.ox + z0 + 96, -30, 70, 3);
      }
      route.push(fin);
      b.route(...route);
    },
  },

  // Boss Arena: eine große Wiese, auf der eine Sturmwolke, eine Gewitterwolke und ein Hüpfer gleichzeitig wachen, jeder in
  // seiner Gasse und in wechselnder Reihenfolge. In der Mitte schwebt eine Terrasse mit einem Sternenschatz: wer hinaufspringt,
  // sieht die Sturmwolke nicht mehr, schaut den anderen beiden zu und holt sich die Sterne. Wer unten bleibt, stampft sich durch.
  {
    id: 'boss-arena',
    name: 'Boss Arena',
    diff: 8,
    weight: 1,
    min: 2200,
    max: Infinity,
    mech: ['charger', 'walker', 'jumper'],
    rest: false,
    build(b) {
      const k = ramp(b, 2200);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const ay = b.pick([-10, 0, 10]);
      const gap = gapFor(b, 0, ay, b.rand(0.8, 0.9));
      const ax = a.w + gap;
      const w = b.int(800, 840);
      const arena = b.ground(ax, ay, w);
      gapArc(b, a.w, 0, ax, ay, 2);
      const order = b.pick([['charger', 'walker', 'jumper'], ['jumper', 'charger', 'walker'], ['walker', 'jumper', 'charger'], ['charger', 'jumper', 'walker']]);
      const span = { charger: 150, walker: 104, jumper: 124 }; // Breite der Zone inklusive des Gegners
      let z = b.int(96, 112);
      const mids = [];
      for (const kind of order) {
        guard(b, kind, arena, z, z + span[kind], { dir: kind === 'charger' ? -1 : b.pick([-1, 1]) });
        mids.push(z + span[kind] / 2);
        z += span[kind] + b.int(70, 84);
      }
      // Terrasse über der mittleren Gasse: weit genug darüber, dass die Sturmwolke den Spieler dort nicht erkennt
      const cw = b.int(206, 224) - Math.round(10 * k);
      const cy = ay - b.int(92, 100);
      const cx = ax + mids[1] - cw / 2;
      const terrace = b.cloud(cx, cy, cw);
      b.starsOver(terrace, 4, 44, 30);
      b.starArc(cx - 6, cx + cw + 6, cy - 54, 40, 4);
      b.starLine(ax + 40, ay - 42, ax + 88, ay - 42, 2);
      const eg = gapFor(b, ay, 0, b.rand(0.8, 0.9));
      const exit = b.ground(ax + w + eg, 0, b.int(250, 270));
      gapArc(b, ax + w, ay, ax + w + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      b.route(a, arena, exit);
    },
  },

  // Sturzflug Schacht: oben führt eine Treppe aus drei Wolken über den Schacht. Unten liegt ein langer Boden, auf dem unter der
  // höchsten Wolke zwei Gewitterwolken und ein Hüpfer nebeneinander wachen. Die Hauptroute bleibt oben und braucht nur
  // Sprung und Doppelsprung. Wer neben der höchsten Wolke in den Schacht springt und im Fallen stampft, räumt mit der
  // Schockwelle die Wächter in Reichweite ab und läuft unten weiter. Der Boden endet kurz vor dem Ausstieg: wer hinunterfällt,
  // klettert wieder hoch.
  {
    id: 'slam-shaft',
    name: 'Sturzflug Schacht',
    diff: 8,
    weight: 2,
    min: 2200,
    max: Infinity,
    mech: ['walker', 'jumper'],
    rest: false,
    build(b) {
      const k = ramp(b, 2200);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      // Obere Treppe: steigt an, hält, fällt wieder
      const ys = [-b.int(56, 66), -b.int(88, 98), -b.int(56, 66)];
      let x = a.w;
      let y = 0;
      const tops = [];
      for (let i = 0; i < 3; i++) {
        const gap = gapFor(b, y, ys[i], b.rand(0.86, 0.95) + 0.03 * k);
        const w = b.int(140, 154) - Math.round(6 * k);
        const p = b.cloud(x + gap, ys[i], w);
        gapArc(b, x, y, x + gap, ys[i], 2);
        b.star(x + gap + w / 2, ys[i] - 44);
        tops.push(p);
        route.push(p);
        x += gap + w;
        y = ys[i];
      }
      const gap = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x + gap, 0, b.int(250, 270));
      gapArc(b, x, y, x + gap, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      // Schachtboden 66 px unter der Starthöhe, vom Einstieg bis 40 px vor den Ausstieg (zum Klettern genügt ein Sprung)
      const lx = a.w + 30;
      const lw = exit.x - b.ox - 40 - lx;
      const low = b.ground(lx, 66, lw);
      // Wächter unter der höchsten Wolke: Gewitterwolke, Hüpfer, Gewitterwolke, je 44 px Abstand wie validate.js ihn fordert.
      // Wer links oder rechts von der höchsten Wolke in den Schacht fällt, trifft mit der Schockwelle (Radius 112) die nahe
      // Gewitterwolke und den Hüpfer, die ferne bleibt für einen Stampfer oder Sprung übrig.
      const mid = tops[1].x - b.ox + tops[1].w / 2 - lx;
      guard(b, 'walker', low, mid - 144, mid - 84, { dir: -1 });
      guard(b, 'jumper', low, mid - 40, mid + 40);
      guard(b, 'walker', low, mid + 84, mid + 144, { dir: 1 });
      b.starLine(lx + 40, 66 - 42, lx + lw - 40, 66 - 42, 6);
      b.route(...route);
    },
  },

  // Wurfstern Galerie: eine Sprungwolke wirft den Spieler auf eine lange Wiese, über der eine Reihe Flieger in
  // Doppelsprunghöhe schwebt, dazwischen zwei Hagelwolken. Stachelwolken am Boden halten den Spieler in Bewegung. Wer Sterne
  // sammelt, lädt Wurfsterne und holt aus dem Doppelsprung links vor der Reihe je Sprung ein bis zwei Wolken herunter (Combo).
  // Wer unten bleibt, läuft unter ihnen durch, denn ein einfacher Sprung reicht nicht an sie heran.
  {
    id: 'shuriken-gallery',
    name: 'Wurfstern Galerie',
    diff: 8,
    weight: 2,
    min: 2200,
    max: Infinity,
    mech: ['spring', 'flyer', 'hailcloud', 'spike'],
    rest: false,
    build(b) {
      const k = ramp(b, 2200);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 3, 42, 30);
      const sgap = b.int(58, 74);
      const sw = b.int(80, 90);
      const sp = b.spring(a.w + sgap, 0, sw);
      const dgap = springGap(b, 0, b.rand(0.66, 0.78) + 0.04 * k);
      const lx = a.w + sgap + sw + dgap;
      const lw = b.int(830, 850);
      const lane = b.ground(lx, 0, lw);
      springTrail(b, a.w + sgap + sw / 2, 0, PHYS.MOVE_SPEED, 5, 0.2, 0.82);
      // Zwei Stachelwolken am Boden, Platz zum Landen davor. Ein Sternbogen zeigt jeden Sprung.
      const s1 = spikeAt(b, lane, b.int(150, 170));
      const s2 = spikeAt(b, lane, b.int(450, 470));
      for (const sk of [s1, s2]) b.starArc(sk.x - b.ox - 22, sk.x - b.ox + sk.w + 22, -30, 64, 3);
      const exit = b.ground(lx + lw + gapFor(b, 0, 0, b.rand(0.8, 0.9)), 0, b.int(250, 270));
      gapArc(b, lx + lw, 0, exit.x - b.ox, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      // Fliegerreihe in Doppelsprunghöhe, Hagelwolken dazwischen (ihre Zonen halten Abstand zu den Stachelwolken)
      const f0 = lx + b.int(216, 228);
      const step = b.int(106, 116);
      b.starLine(f0 - 20, -42, f0 + step * 5 + 20, -42, 6); // Sterne am Boden unter der Reihe laden die Wurfsterne
      flyerAbove(b, f0, { range: 70, dir: 1, lift: 192, star: false });
      hailAbove(b, f0 + step, { range: 60, dir: -1, phase: 0.2, lift: 196, star: false });
      flyerAbove(b, f0 + step * 2, { range: 70, dir: -1, lift: 206, phase: Math.PI, star: false });
      flyerAbove(b, f0 + step * 3, { range: 70, dir: 1, lift: 192, star: false });
      hailAbove(b, f0 + step * 4, { range: 60, dir: 1, phase: 0.6, lift: 196, star: false });
      flyerAbove(b, f0 + step * 5, { range: 70, dir: -1, lift: 202, phase: 1.5, star: false });
      b.route(a, sp, lane, exit);
    },
  },

  // Eishagel: drei Eiswolken, auf denen der Spieler weit rutscht, und über den Lücken fächern zwei Hagelwolken nach unten.
  // Auf dem Eis bremst man nicht, also lohnt sich jeder Absprung früh, und die Salve lässt sich nur mit Timing unterlaufen.
  // Die kleine feste Insel zwischen den Eiswolken ist der einzige Platz zum Stehen.
  {
    id: 'ice-hail-slide',
    name: 'Eishagel',
    diff: 8,
    weight: 2,
    min: 2200,
    max: Infinity,
    mech: ['ice', 'hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 2200);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const mids = [];
      let x = a.w;
      let y = 0;
      let onIce = false;
      const put = (kind, ny, frac, w) => {
        const gap = gapFor(b, y, ny, frac, onIce ? ICE_HEAD : STORM);
        const p = kind === 'ice' ? b.ice(x + gap, ny, w) : b.cloud(x + gap, ny, w);
        gapArc(b, x, y, x + gap, ny, 2);
        mids.push(x + gap / 2);
        route.push(p);
        onIce = kind === 'ice';
        x += gap + w;
        y = ny;
        return p;
      };
      const i1 = put('ice', b.pick([-10, 0, 10]), b.rand(0.74, 0.84), b.int(150, 164) - Math.round(6 * k));
      b.starsOver(i1, 2, 42, 36);
      const i2 = put('ice', clamp(y + b.pick([-18, 0, 18]), -26, 26), b.rand(0.74, 0.84), b.int(146, 158) - Math.round(6 * k));
      b.starsOver(i2, 2, 42, 36);
      const isl = put('cloud', clamp(y + b.pick([-14, 0, 14]), -26, 26), b.rand(0.76, 0.86), b.int(138, 152));
      b.starsOver(isl, 2, 44, 34);
      const i3 = put('ice', clamp(y + b.pick([-16, 0, 16]), -26, 26), b.rand(0.74, 0.84), b.int(150, 162) - Math.round(6 * k));
      b.starsOver(i3, 2, 42, 36);
      const ey = clamp(y + b.pick([-10, 0, 10]), -22, 22);
      const gap = gapFor(b, y, ey, b.rand(0.74, 0.84), ICE_HEAD);
      const exit = b.ground(x + gap, ey, b.int(240, 260));
      gapArc(b, x, y, x + gap, ey, 2);
      b.starsOver(exit, 3, 42, 30);
      mids.push(x + gap / 2);
      route.push(exit);
      // Hagelwolken über der Lücke zwischen den ersten beiden Eiswolken und über der Lücke vor dem Ausstieg, versetzt im Takt
      hailAbove(b, mids[1], { range: 80, dir: 1, phase: 0.15 });
      hailAbove(b, mids[mids.length - 1], { range: 80, dir: -1, phase: 0.8 });
      b.route(...route);
    },
  },

  // Fähre und Hüpfer: zwei schwingende Wolken tragen über breite Lücken. Dazwischen liegen Inseln, auf der ersten wacht ein
  // Hüpfer, auf der zweiten steht eine Stachelwolke. Die Fähren sind schnell, und jede Lücke ist nur in knapp der Hälfte des
  // Takts überspringbar: wer wartet, bis die Fähre nah ist, springt sicher, wer hetzt, fällt in den Abgrund.
  {
    id: 'ferry-hopper',
    name: 'Fähre und Hüpfer',
    diff: 8,
    weight: 2,
    min: 2250,
    max: Infinity,
    mech: ['moving', 'jumper', 'spike'],
    rest: false,
    build(b) {
      const k = ramp(b, 2250);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      let x = a.w; // rechte Kante der letzten festen Plattform, bei einer Fähre ihre linke Stellung
      let y = 0;
      let swing = 0; // Ausschlag der letzten Fähre
      // Lücke, die in der fernen Stellung der Fähre um etwa einen Ausschlag über dem sicheren Limit liegt und in der nahen
      // Stellung (2 Ausschläge näher) bequem ist
      const farGap = (dy, ax) => gapFor(b, y, y + dy, 1, 0) + Math.round(ax * b.rand(0.8, 1.0));
      const ferry = (dy) => {
        const wh = b.int(110, 122);
        const axh = b.int(52, 62);
        const far = farGap(dy, axh);
        const cx = x + far - axh;
        const f = b.moving(cx, y + dy, wh, { ax: axh, period: b.rand(3.0, 3.5) - 0.4 * k, phase: b.rand(0, TAU) });
        b.starArc(cx - axh, cx + axh + wh, y + dy - 34, 50, 4);
        route.push(f);
        x = cx - axh + wh;
        y += dy;
        swing = axh;
      };
      // Insel hinter einer Fähre: die Lücke wird von deren linker Stellung aus gerechnet, also bei der Rückkehr der Fähre kürzer
      const island = (dy, w) => {
        const gap = farGap(dy, swing);
        const p = b.cloud(x + gap, y + dy, w);
        route.push(p);
        x += gap + w;
        y += dy;
        swing = 0;
        return p;
      };
      // Fähre 1, Insel mit Hüpfer
      ferry(b.pick([-8, 0, 8]));
      const i1 = island(b.pick([-6, 0, 6]), b.int(244, 262));
      guard(b, 'jumper', i1, 80, 80 + 104);
      b.starArc(i1.x - b.ox + 90, i1.x - b.ox + 210, i1.y - b.oy - 30, 90, 4);
      // Fähre 2, Insel mit Stachelwolke
      ferry(b.pick([-14, -6, 6, 14]));
      const i2 = island(b.pick([-6, 0, 6]), b.int(196, 212));
      spikeAt(b, i2, (i2.w - SPIKE.w) / 2);
      b.starArc(i2.x - b.ox + 50, i2.x - b.ox + i2.w - 50, i2.y - b.oy - 30, 80, 4);
      const gap = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x + gap, 0, b.int(250, 270));
      gapArc(b, x, y, x + gap, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      b.route(...route);
    },
  },

  // Kometenhagel: eine lange Wiese, auf der nacheinander drei Kometen einschlagen, und zwischen den Einschlägen fächern zwei
  // Hagelwolken nach unten. Die Markierungen am Boden und das Zittern der Wolken verraten alles, nur gleichzeitig lesen muss
  // man es. Eine kleine Wolke über der Mitte ist der Fluchtpunkt, von dort sieht man die ganze Wiese.
  {
    id: 'comet-hail-run',
    name: 'Kometenhagel',
    diff: 8.5,
    weight: 2,
    min: 2500,
    max: Infinity,
    mech: ['comet', 'hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 2500);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.8, 0.9));
      const rx = a.w + gap;
      const w = b.int(880, 920);
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 2);
      const c1 = rx + b.int(170, 190);
      const c2 = c1 + b.int(250, 270);
      const c3 = c2 + b.int(250, 270);
      const idle = b.rand(1.1, 1.4);
      b.comet(c1, 0, { idle, dir: b.pick([-1, 1]) });
      b.comet(c2, 0, { idle: idle + b.rand(0.9, 1.3), dir: b.pick([-1, 1]) });
      b.comet(c3, 0, { idle: idle + b.rand(0.3, 0.7), dir: b.pick([-1, 1]) });
      b.starArc(c1 - 42, c1 + 42, -30, 80, 3);
      b.starArc(c2 - 42, c2 + 42, -30, 80, 3);
      b.starArc(c3 - 42, c3 + 42, -30, 80, 3);
      // Fluchtwolke zwischen dem ersten und zweiten Einschlag, einen Sprung über der Wiese
      const cw = b.int(106, 120) - Math.round(8 * k);
      const cm = (c1 + c2) / 2;
      const cover = b.cloud(cm - cw / 2, -b.int(70, 82), cw);
      b.starsOver(cover, 2, 40, 28);
      b.starLine(rx + 36, -42, c1 - 66, -42, 2);
      b.starLine(c3 + 66, -42, rx + w - 40, -42, 2);
      // Hagelwolken zwischen den Kometen, versetzt im Takt
      hailAbove(b, (c2 + c3) / 2, { range: 80, dir: 1, phase: 0.1 });
      hailAbove(b, c3 + b.int(130, 150), { range: 70, dir: -1, phase: 0.8 });
      const eg = gapFor(b, 0, 0, b.rand(0.8, 0.9));
      const exit = b.ground(rx + w + eg, 0, b.int(250, 270));
      gapArc(b, rx + w, 0, rx + w + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      b.route(a, run, exit);
    },
  },

  // Takt der Albträume: Blinkwolken in Wellen, dazwischen eine feste Insel mit einer Stachelwolke, über zwei Lücken kreisen
  // Flieger, und zwischen den Wolken hängen Risikosterne. Das Flackern verrät jedes Ende, die Welle läuft mit dem Spieler,
  // aber wer die Sterne will, muss aus dem Takt springen.
  {
    id: 'blink-flyer-rhythm',
    name: 'Takt der Albträume',
    diff: 8.5,
    weight: 2,
    min: 2500,
    max: Infinity,
    mech: ['blink', 'flyer', 'spike', 'fallingstar'],
    rest: false,
    build(b) {
      const k = ramp(b, 2500);
      const next = blinkWave(b, b.rand(3.5, 4.0));
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const mids = [];
      let x = a.w;
      let y = 0;
      const put = (kind, ny, frac, w, risk) => {
        const gap = gapFor(b, y, ny, frac);
        const px = x + gap;
        const p = kind === 'blink' ? b.blink(px, ny, w, next(px + w / 2)) : b.cloud(px, ny, w);
        if (risk) b.riskStar(x + gap / 2, Math.min(y, ny) - 54, { triggerDist: 150, fallSpeed: 55 });
        else gapArc(b, x, y, px, ny, 2);
        if (kind === 'blink') b.star(px + w / 2, ny - 44);
        mids.push(x + gap / 2);
        route.push(p);
        x = px + w;
        y = ny;
        return p;
      };
      const bw = () => b.int(94, 104) - Math.round(4 * k);
      put('blink', b.pick([-30, -20, -10]), b.rand(0.8, 0.9), bw());
      put('blink', y + b.pick([-24, 24, 28]), b.rand(0.8, 0.9), bw(), true);
      const isl = put('cloud', y + b.pick([-10, 0, 10]), b.rand(0.8, 0.9), b.int(176, 190));
      spikeAt(b, isl, (isl.w - SPIKE.w) / 2);
      put('blink', y - b.int(20, 40), b.rand(0.78, 0.88), bw());
      put('blink', y + b.pick([-26, 26, 30]), b.rand(0.8, 0.9), bw(), true);
      const ey = clamp(y + b.int(24, 44), -10, 14);
      const exit = b.ground(x + gapFor(b, y, ey, b.rand(0.78, 0.88)), ey, b.int(240, 260));
      gapArc(b, x, y, exit.x - b.ox, ey, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      flyerAbove(b, mids[2], { range: 100, dir: 1, phase: 0 });
      flyerAbove(b, mids[4], { range: 100, dir: -1, phase: Math.PI });
      b.route(...route);
    },
  },

  // Federturm: eine Sprungwolke wirft den Spieler auf eine hohe Terrasse, auf der eine Sturmwolke vor einem Powerup wacht.
  // Vor dem Katapult fächert eine Hagelwolke: wer die Salve abwartet, startet trocken. Von oben fällt der Spieler auf die
  // Sturmwolke herab und stampft sie im Anflug, oder er landet davor, wartet das Aufladen ab und springt über sie.
  {
    id: 'spring-tower',
    name: 'Federturm',
    diff: 8.5,
    weight: 2,
    min: 2500,
    max: Infinity,
    mech: ['spring', 'charger', 'powerup', 'hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 2500);
      const a = b.ground(0, 0, b.int(250, 266));
      b.starsOver(a, 2, 42, 30);
      const sgap = b.int(58, 72);
      const sw = b.int(80, 90);
      const sx = a.w + sgap;
      const spring = b.spring(sx, 0, sw);
      const rise = b.int(138, 150);
      const dgap = springGap(b, -rise, b.rand(0.68, 0.8) + 0.04 * k);
      const hx = sx + sw + dgap;
      const hw = b.int(316, 334);
      const tower = b.cloud(hx, -rise, hw);
      springTrail(b, sx + sw / 2, 0, PHYS.MOVE_SPEED, 5, 0.22, 0.86);
      const from = b.int(104, 118);
      guard(b, 'charger', tower, from, from + b.int(130, 144), { dir: -1 });
      b.powerup(b.pick(POWER_TYPES), hx + hw - 56, -rise - 38);
      b.starArc(hx + from - 8, hx + from + 150, -rise - 30, 90, 4);
      // Abstieg zum Ausstieg
      const eg = gapFor(b, -rise, 0, b.rand(0.8, 0.9));
      const exit = b.ground(hx + hw + eg, 0, b.int(250, 270));
      gapArc(b, hx + hw, -rise, hx + hw + eg, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      // Hagelwolke über dem rechten Ende des Einstiegs: ihr Fächer deckt den Weg zur Sprungwolke, die Wartestelle links davon bleibt frei
      hailAbove(b, 262, { range: 30, dir: 1, phase: 0.2, star: false });
      b.route(a, spring, tower, exit);
    },
  },

  // Gewitterlauf: auf einer langen Wiese schlagen drei Blitze ein, zwischen dem ersten und zweiten wacht eine Sturmwolke. Der
  // Regen setzt erst nach der trockenen Landezone ein und macht das Bremsen träge, darum lohnt es sich, früh abzuwarten. Eine
  // Terrasse über der Sturmwolke ist außer Sichtweite und trägt Sterne. Die Blitze schlagen zeitlich versetzt ein, und vor dem
  // ersten bleibt genug Platz, um auch auf nassem Boden noch zu bremsen.
  {
    id: 'thunder-rain-run',
    name: 'Gewitterlauf',
    diff: 8.5,
    weight: 2,
    min: 2500,
    max: Infinity,
    mech: ['rain', 'lightning', 'charger'],
    rest: false,
    build(b) {
      const k = ramp(b, 2500);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.8, 0.9));
      const rx = a.w + gap;
      const w = b.int(990, 1020);
      const run = b.ground(rx, 0, w);
      gapArc(b, a.w, 0, rx, 0, 2);
      const l1 = rx + b.int(230, 250); // vor dem ersten Blitz reicht der Platz zum Bremsen (auf nassem Boden gut 80 px)
      const cz = l1 + b.int(120, 136); // Beginn der Zone der Sturmwolke
      const cs = b.int(140, 156);
      const l2 = cz + cs + b.int(120, 136);
      const l3 = l2 + b.int(200, 220);
      const idle = b.rand(0.9, 1.2);
      b.lightning(l1, { idle });
      b.lightning(l2, { idle: idle + b.rand(1.2, 1.7) });
      b.lightning(l3, { idle: idle + b.rand(0.5, 0.9) });
      guard(b, 'charger', run, cz - rx, cz - rx + cs, { dir: -1 });
      b.rain(rx + 170, 520, { offset: b.rand(3.6, 5.8) }); // die ersten 170 px der Wiese bleiben trocken
      b.rain(rx + 520, w - 590, { offset: b.rand(0.5, 2.4) }); // endet 70 px vor dem Absprung zum Ausstieg
      // Terrasse über der Sturmwolke
      const tw = b.int(110, 124) - Math.round(8 * k);
      const terrace = b.cloud(cz + cs / 2 - tw / 2, -b.int(92, 100), tw);
      b.starsOver(terrace, 2, 42, 28);
      b.starArc(l1 - 40, l1 + 40, -30, 80, 3);
      b.starArc(l2 - 40, l2 + 40, -30, 80, 3);
      b.starArc(l3 - 40, l3 + 40, -30, 80, 3);
      b.starLine(l3 + 70, -42, rx + w - 40, -42, 2);
      const eg = gapFor(b, 0, 0, b.rand(0.8, 0.9));
      const exit = b.ground(rx + w + eg, 0, b.int(250, 270));
      gapArc(b, rx + w, 0, rx + w + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      b.route(a, run, exit);
    },
  },

  // Eissturm: drei Eiswolken unter einem kräftigen Gegenwind. Auf dem Eis bremst man kaum und der Wind drückt zurück, auf
  // der mittleren Eiswolke schlägt ein Blitz ein. Wer rechtzeitig loslässt, bleibt vor der Zone, wer nach dem Einschlag
  // rutscht, kommt durch. Die Lücken sind kurz, denn der Wind frisst Sprungweite.
  {
    id: 'ice-storm',
    name: 'Eissturm',
    diff: 8.5,
    weight: 2,
    min: 2550,
    max: Infinity,
    mech: ['ice', 'wind', 'lightning'],
    rest: false,
    build(b) {
      const k = ramp(b, 2550);
      const head = Math.round(88 + 20 * k + b.rand(0, 8));
      const fromStatic = Math.max(STORM, head + 6);
      const fromIce = Math.max(ICE_HEAD, head + 6);
      const a = b.ground(0, 0, b.int(240, 260));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      let top = 0;
      let bottom = 0;
      let boltX = 0;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const ny = clamp(y + b.pick([-20, -10, 0, 10, 20]), -30, 30);
        const gap = gapFor(b, y, ny, b.rand(0.86, 0.96), i === 0 ? fromStatic : fromIce);
        const w = Math.max(132, (i === 1 ? b.int(196, 210) : b.int(136, 148)) - Math.round(4 * k));
        const p = b.ice(x + gap, ny, w);
        gapArc(b, x, y, x + gap, ny, 2);
        if (i === 1) {
          boltX = x + gap + w / 2;
          b.starArc(boltX - 40, boltX + 40, ny - 30, 78, 3);
        } else b.starsOver(p, 2, 42, 36);
        route.push(p);
        x += gap + w;
        y = ny;
        top = Math.min(top, ny);
        bottom = Math.max(bottom, ny);
      }
      b.lightning(boltX, { idle: b.rand(1.0, 1.4) });
      const ey = clamp(y + b.pick([-10, 0, 10]), -22, 22);
      const eg = gapFor(b, y, ey, b.rand(0.84, 0.94), fromIce);
      const exit = b.ground(x + eg, ey, b.int(240, 260));
      gapArc(b, x, y, x + eg, ey, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      const zx = a.w * 0.5;
      b.wind(zx, top - 175, x + eg + 90 - zx, bottom - top + 240, { vx: -head });
      b.route(...route);
    },
  },

  // Hagelbrücke: vier brüchige Wolken tragen über einen Abgrund, in der Mitte liegt eine feste Insel, und genau darüber
  // fächert eine Hagelwolke. Die Brücke erlaubt kein langes Warten, der Fächer deckt die linke Hälfte der Insel: wer die
  // Salve vorher abgewartet hat oder die rechte Ecke nimmt, kommt trocken durch. Ein Risikostern lockt über der Lücke.
  {
    id: 'crumble-hail-bridge',
    name: 'Hagelbrücke',
    diff: 7.5,
    weight: 2,
    min: 1950,
    max: Infinity,
    mech: ['breakable', 'hailcloud', 'fallingstar'],
    rest: false,
    build(b) {
      const k = ramp(b, 1950);
      const a = b.ground(0, 0, b.int(240, 256));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      let x = a.w;
      let y = 0;
      let island = null;
      const crumble = (frac, risk) => {
        const ny = clamp(y + b.pick([-14, -7, 0, 7, 14]), -24, 24);
        const gap = gapFor(b, y, ny, frac + 0.04 * k);
        const p = b.breakable(x + gap, ny, crumbleW(b, 98, 108, 6 * k));
        if (risk) b.riskStar(x + gap / 2, Math.min(y, ny) - 40, { triggerDist: 150, fallSpeed: 60 });
        else gapArc(b, x, y, x + gap, ny, 2);
        b.star(x + gap + p.w / 2, ny - 46);
        route.push(p);
        x += gap + p.w;
        y = ny;
      };
      crumble(b.rand(0.78, 0.88), false);
      crumble(b.rand(0.78, 0.88), false);
      {
        const ny = clamp(y + b.pick([-10, 0, 10]), -20, 20);
        const gap = gapFor(b, y, ny, b.rand(0.8, 0.9));
        island = b.cloud(x + gap, ny, b.int(178, 190));
        gapArc(b, x, y, x + gap, ny, 2);
        b.starsOver(island, 2, 44, 40);
        route.push(island);
        x += gap + island.w;
        y = ny;
      }
      crumble(b.rand(0.8, 0.9), true);
      crumble(b.rand(0.78, 0.88), false);
      const eg = gapFor(b, y, 0, b.rand(0.78, 0.88));
      const exit = b.ground(x + eg, 0, b.int(240, 260));
      gapArc(b, x, y, x + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      // Hagelwolke über der linken Hälfte der Insel: rechts bleibt eine sichere Ecke
      hailAbove(b, island.x - b.ox + 46, { range: 40, dir: 1, phase: 0.3 });
      b.route(...route);
    },
  },

  // Abgrundsprint: fünf schmale Wolken über einem Abgrund, abwechselnd mit einem einfachen Sprung nahe am Limit und einem
  // Doppelsprung über eine breite Lücke, die der einfache Sprung nicht schafft. In den breiten Lücken hängen Risikosterne, über
  // den kurzen kreisen Flieger. Ohne Gegner am Boden, ohne Wiese: reine Sprungkunst. Die Sterne zeigen die Bahn, das Gleiten
  // rettet knappe Landungen.
  {
    id: 'abyss-sprint',
    name: 'Abgrundsprint',
    diff: 9,
    weight: 2,
    min: 2800,
    max: Infinity,
    mech: ['flyer', 'fallingstar'],
    rest: false,
    build(b) {
      const k = ramp(b, 2800);
      const a = b.ground(0, 0, b.int(240, 256));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const plan = b.pick([['s', 'd', 's', 'd', 's'], ['d', 's', 's', 'd', 's'], ['s', 's', 'd', 's', 'd']]);
      const shorts = [];
      let x = a.w;
      let y = 0;
      for (let i = 0; i < plan.length; i++) {
        const dbl = plan[i] === 'd';
        // Doppelsprung Lücken liegen waagerecht oder abwärts: nur dann rechnet reach.js den zweiten Sprung ein, und die Lücke
        // übersteigt den einfachen Sprung deutlich (mindestens 10 Prozent über seiner Reichweite)
        const ny = clamp(y + (dbl ? b.pick([0, 12, 24]) : b.pick([-30, -16, 0, 14, 28])), -44, 32);
        const frac = dbl ? b.rand(0.84, 0.9) + 0.02 * k : b.rand(0.94, 1.02);
        const gap = gapFor(b, y, ny, frac, STORM, dbl);
        const w = b.int(88, 98) - Math.round(4 * k);
        const p = b.cloud(x + gap, ny, w);
        if (dbl) b.riskStar(x + gap / 2, Math.min(y, ny) - 44, { triggerDist: 160, fallSpeed: 60 });
        else {
          gapArc(b, x, y, x + gap, ny, 2);
          shorts.push(x + gap / 2);
        }
        b.star(x + gap + w / 2, ny - 44);
        route.push(p);
        x += gap + w;
        y = ny;
      }
      const eg = gapFor(b, y, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x + eg, 0, b.int(240, 260));
      gapArc(b, x, y, x + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      flyerAbove(b, shorts[0], { range: 100, dir: 1, phase: 0 });
      flyerAbove(b, shorts[shorts.length - 1], { range: 100, dir: -1, phase: Math.PI });
      b.route(...route);
    },
  },

  // Traumfestung: der Höhepunkt. Im ersten Hof liegt eine Stachelwolke unter einer Hagelwolke, dahinter schleudert eine
  // Sprungwolke den Spieler auf den Turm, wo eine Sturmwolke ein Powerup bewacht. Vom Turm führt der Abstieg in den zweiten
  // Hof, in dem zwei Gewitterwolken patrouillieren. Wer alles stampft, baut eine lange Combo, wer es meidet, springt.
  {
    id: 'dream-fortress',
    name: 'Traumfestung',
    diff: 9,
    weight: 1,
    min: 2900,
    max: Infinity,
    mech: ['spike', 'hailcloud', 'spring', 'charger', 'powerup', 'walker'],
    rest: false,
    build(b) {
      const k = ramp(b, 2900);
      const a = b.ground(0, 0, b.int(240, 254));
      b.starsOver(a, 2, 42, 30);
      const g1 = gapFor(b, 0, 0, b.rand(0.82, 0.9));
      const f1x = a.w + g1;
      const f1w = b.int(344, 360);
      const court1 = b.ground(f1x, 0, f1w);
      gapArc(b, a.w, 0, f1x, 0, 2);
      spikeAt(b, court1, b.int(126, 140));
      b.starArc(f1x + 108, f1x + 200, -30, 76, 3);
      // Sprungwolke am Ende des ersten Hofs
      const sx = f1x + f1w + b.int(58, 68);
      const sw = b.int(80, 88);
      const sp = b.spring(sx, 0, sw);
      const rise = b.int(130, 144);
      const dgap = springGap(b, -rise, b.rand(0.6, 0.7) + 0.04 * k);
      const tx = sx + sw + dgap;
      const tw = b.int(326, 344);
      const tower = b.cloud(tx, -rise, tw);
      springTrail(b, sx + sw / 2, 0, PHYS.MOVE_SPEED, 5, 0.22, 0.86);
      const from = b.int(104, 116);
      guard(b, 'charger', tower, from, from + b.int(130, 142), { dir: -1 });
      b.powerup(b.pick(POWER_TYPES), tx + tw - 54, -rise - 38);
      b.starArc(tx + from - 6, tx + from + 148, -rise - 30, 90, 4);
      // Abstieg in den zweiten Hof (Ausstieg), zwei Gewitterwolken
      const g2 = gapFor(b, -rise, 0, b.rand(0.8, 0.9));
      const f2x = tx + tw + g2;
      const f2w = b.int(396, 412);
      const court2 = b.ground(f2x, 0, f2w);
      gapArc(b, tx + tw, -rise, f2x, 0, 3);
      guard(b, 'walker', court2, 88, 188);
      guard(b, 'walker', court2, 236, 336);
      b.starArc(f2x + 80, f2x + 200, -30, 76, 3);
      b.starArc(f2x + 226, f2x + 346, -30, 76, 3);
      // Hagelwolke über der rechten Hälfte des ersten Hofs
      hailAbove(b, f1x + f1w * 0.86, { range: 60, dir: -1, phase: 0.4 });
      b.route(a, court1, sp, tower, court2);
    },
  },

  // Sturmkrone: eine große Arena, in der alles auf einmal passiert. Ein Komet schlägt ein, dahinter wacht eine Sturmwolke
  // unter einer kleinen Terrasse, ein Blitz folgt, dann eine Gewitterwolke und zum Schluss der nächste Komet. Jede Zone ist
  // getrennt und kündigt sich an. Wer zügig läuft, liest die Reihe von links nach rechts, die Terrasse nimmt der Sturmwolke die Sicht.
  {
    id: 'storm-crown',
    name: 'Sturmkrone',
    diff: 9,
    weight: 1,
    min: 2900,
    max: Infinity,
    mech: ['comet', 'charger', 'lightning', 'walker'],
    rest: false,
    build(b) {
      const k = ramp(b, 2900);
      const a = b.ground(0, 0, b.int(240, 254));
      b.starsOver(a, 2, 42, 30);
      const gap = gapFor(b, 0, 0, b.rand(0.82, 0.9));
      const ax = a.w + gap;
      const w = b.int(960, 980);
      const arena = b.ground(ax, 0, w);
      gapArc(b, a.w, 0, ax, 0, 2);
      const c1 = ax + b.int(120, 134);
      const cz = c1 + b.int(104, 116); // Beginn der Zone der Sturmwolke
      const cs = b.int(140, 152);
      const l1 = cz + cs + b.int(104, 116);
      const wz = l1 + b.int(96, 108); // Beginn der Zone der Gewitterwolke
      const ws = b.int(96, 104);
      const c2 = wz + ws + b.int(104, 116);
      const idle = b.rand(1.1, 1.4);
      b.comet(c1, 0, { idle, dir: b.pick([-1, 1]) });
      b.lightning(l1, { idle: idle + b.rand(1.2, 1.6) });
      b.comet(c2, 0, { idle: idle + b.rand(0.4, 0.8), dir: b.pick([-1, 1]) });
      guard(b, 'charger', arena, cz - ax, cz - ax + cs, { dir: -1 });
      guard(b, 'walker', arena, wz - ax, wz - ax + ws);
      // Terrasse über der Sturmwolke
      const tw = b.int(108, 120) - Math.round(8 * k);
      const terrace = b.cloud(cz + cs / 2 - tw / 2, -b.int(92, 100), tw);
      b.starsOver(terrace, 2, 42, 28);
      b.starArc(c1 - 40, c1 + 40, -30, 78, 3);
      b.starArc(l1 - 40, l1 + 40, -30, 78, 3);
      b.starArc(c2 - 40, c2 + 40, -30, 78, 3);
      const eg = gapFor(b, 0, 0, b.rand(0.8, 0.9));
      const exit = b.ground(ax + w + eg, 0, b.int(250, 266));
      gapArc(b, ax + w, 0, ax + w + eg, 0, 2);
      b.starsOver(exit, 3, 42, 30);
      b.route(a, arena, exit);
    },
  },

  // Zwillingskatapult: eine Sprungwolke wirft den Spieler auf eine hohe Blinkwolke, die nur im Takt fest ist, dann geht es
  // über eine zweite Blinkwolke wieder hinab. Über der Lücke zwischen beiden kreist ein Flieger. Wer auf der Starthöhe wartet,
  // sieht das Geisterbild der Blinkwolke erscheinen und startet, kurz nachdem sie fest wird.
  {
    id: 'twin-catapult',
    name: 'Zwillingskatapult',
    diff: 9,
    weight: 1,
    min: 2900,
    max: Infinity,
    mech: ['spring', 'blink', 'flyer'],
    rest: false,
    build(b) {
      const k = ramp(b, 2900);
      const next = blinkWave(b, b.rand(3.6, 4.2));
      const a = b.ground(0, 0, b.int(244, 258));
      b.starsOver(a, 3, 42, 30);
      const sgap = b.int(58, 70);
      const sw = b.int(80, 88);
      const sx = a.w + sgap;
      const spring = b.spring(sx, 0, sw);
      const rise = b.int(100, 114);
      const dgap = springGap(b, -rise, b.rand(0.56, 0.68) + 0.03 * k);
      const w1 = b.int(98, 106) - Math.round(4 * k);
      const x1 = sx + sw + dgap;
      const hi1 = b.blink(x1, -rise, w1, next(x1 + w1 / 2));
      springTrail(b, sx + sw / 2, 0, PHYS.MOVE_SPEED, 5, 0.22, 0.86);
      const y2 = -rise + b.pick([-14, 0, 14]);
      const g2 = gapFor(b, -rise, y2, b.rand(0.8, 0.9));
      const w2 = b.int(96, 104) - Math.round(4 * k);
      const x2 = x1 + w1 + g2;
      const hi2 = b.blink(x2, y2, w2, next(x2 + w2 / 2));
      b.star(x1 + w1 / 2, -rise - 44);
      gapArc(b, x1 + w1, -rise, x2, y2, 2);
      b.star(x2 + w2 / 2, y2 - 44);
      const eg = gapFor(b, y2, 0, b.rand(0.8, 0.9));
      const exit = b.ground(x2 + w2 + eg, 0, b.int(250, 266));
      gapArc(b, x2 + w2, y2, x2 + w2 + eg, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      flyerAbove(b, x1 + w1 + g2 / 2, { range: 90, dir: 1, phase: 0 });
      b.route(a, spring, hi1, hi2, exit);
    },
  },

  // Schwebende Gärten: drei schwingende Wolken tragen über den Abgrund, die mittlere hebt und senkt sich. Über der ersten
  // Lücke kreist ein Flieger, über der zweiten fächert eine Hagelwolke. Jede Lücke ist nur zu einem Teil des Takts
  // überspringbar: wer auf der Wolke mitfährt und den Moment abpasst, kommt durch, wer hetzt, fällt.
  {
    id: 'floating-gardens',
    name: 'Schwebende Gärten',
    diff: 9,
    weight: 1,
    min: 2850,
    max: Infinity,
    mech: ['moving', 'flyer', 'hailcloud'],
    rest: false,
    build(b) {
      const k = ramp(b, 2850);
      const a = b.ground(0, 0, b.int(240, 254));
      b.starsOver(a, 2, 42, 30);
      const route = [a];
      const defs = [{ ax: b.int(44, 54), ay: 0 }, { ax: 0, ay: b.int(30, 40) }, { ax: b.int(44, 54), ay: 0 }];
      const mids = [];
      let right = a.w; // mittlere rechte Kante der letzten Plattform
      const y = 0;
      for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        const w = b.int(108, 118) - Math.round(6 * k);
        const gap = gapFor(b, y, y, b.rand(0.6, 0.7) + 0.03 * k);
        const cx = right + gap;
        const p = b.moving(cx, y, w, { ax: d.ax, ay: d.ay, period: b.rand(2.9, 3.5), phase: b.rand(0, TAU) });
        mids.push(right + gap / 2);
        b.starArc(cx - d.ax, cx + d.ax + w, y - 34, 56, 3);
        route.push(p);
        right = cx + w;
      }
      const eg = gapFor(b, y, 0, b.rand(0.68, 0.78));
      const exit = b.ground(right + eg, 0, b.int(250, 266));
      gapArc(b, right, y, right + eg, 0, 3);
      b.starsOver(exit, 3, 42, 30);
      route.push(exit);
      flyerAbove(b, mids[1], { range: 90, dir: 1, phase: 0 });
      hailAbove(b, mids[2], { range: 80, dir: -1, phase: 0.5 });
      b.route(...route);
    },
  },
];
