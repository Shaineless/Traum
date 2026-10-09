// Tests für game/render/world.js ohne Browser, mit dem aufzeichnenden Kontext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { input, newGame } from './helpers.mjs';
import { BLINK, COMET, H, HAIL, LIMITS, POWERUPS, W } from '../game/constants.js';
import {
  createBlinkPlatform, createBreakablePlatform, createComet, createGate, createHail, createHailcloud, createLightning,
  createMovingPlatform, createPowerup, createRain, createSpike, createSpringPlatform, createStar, createStaticPlatform, createWind,
} from '../game/entities.js';
import { cleanup, ensureAhead } from '../game/generator.js';
import { cometHitbox, cometPosition, hailHitbox, lightningColumn, spikeHitbox } from '../game/obstacles.js';
import { createState } from '../game/state.js';
import { stepSim } from '../game/sim.js';
import { themeAt } from '../game/theme.js';
import { drawWorld } from '../game/render/world.js';

// Wie createMockCtx, zeichnet aber auch Zuweisungen auf (Eintrag '=name') und zählt Verläufe.
function recCtx() {
  const base = createMockCtx();
  const stats = { gradients: 0 };
  const wrap = (name) => (...args) => { stats.gradients++; return base[name](...args); };
  return new Proxy(base, {
    get(t, k) {
      if (k === 'stats') return stats;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return wrap(k);
      return t[k];
    },
    set(t, k, v) { base.calls.push([`=${k}`, v]); t[k] = v; return true; },
  });
}

// Verlauf Objekte sind Funktionen, deshalb vergleichen wir die Aufrufe als Text
const sig = (ctx) => JSON.stringify(ctx.calls);
const ops = (ctx) => ctx.calls.filter((c) => !c[0].startsWith('='));
const shapes = (ctx) => ops(ctx).filter((c) => c[0] !== 'save' && c[0] !== 'restore');
const named = (ctx, n) => ctx.calls.filter((c) => c[0] === n);
const assigned = (ctx, key) => named(ctx, `=${key}`).map((c) => c[1]);
const maxOf = (a) => a.reduce((m, v) => Math.max(m, v), -Infinity);

const view = (o = {}) => ({ W, H, camX: 0, time: 5, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });

function blank(world = 0) {
  const s = createState({ seed: 7 });
  s.world = { index: world, from: world, to: world, blend: 1, gatesPassed: 0 };
  s.player.x = 100;
  return s;
}

// Zeichnet einen Frame, prüft nebenbei: kein Fehler, save und restore ausgeglichen, Zustand unverändert.
function draw(s, o = {}) {
  const before = structuredClone(s);
  const ctx = recCtx();
  drawWorld(ctx, s, view(o));
  assert.equal(named(ctx, 'save').length, named(ctx, 'restore').length, 'save und restore sind ausgeglichen');
  assert.deepStrictEqual(s, before, 'drawWorld verändert den Zustand nicht');
  return ctx;
}

function allArgsFinite(ctx) {
  for (const c of ops(ctx)) {
    for (const a of c.slice(1)) if (typeof a === 'number' && !Number.isFinite(a)) return `${c[0]}(${c.slice(1).join(', ')})`;
  }
  return true;
}

const ground = (s, x = -100, y = 360, w = 700) => { const p = createStaticPlatform(s, x, y, w, { ground: true }); s.platforms.push(p); return p; };
const floater = (s, x, y, w = 120) => { const p = createStaticPlatform(s, x, y, w); s.platforms.push(p); return p; };

// ---------- Grundverhalten ----------

test('leerer Zustand, fehlende Listen und ungültige Aufrufe zeichnen nichts und werfen nicht', () => {
  const s = blank();
  assert.equal(ops(draw(s)).length, 0, 'leere Listen: keine Aufrufe');
  for (const k of ['platforms', 'hazards', 'zones', 'stars', 'powerups', 'gates']) delete s[k];
  assert.doesNotThrow(() => drawWorld(createMockCtx(), s, view()));
  assert.doesNotThrow(() => drawWorld(createMockCtx(), blank(), {}));
  assert.doesNotThrow(() => drawWorld(null, blank(), view()));
  assert.doesNotThrow(() => drawWorld(createMockCtx(), null, view()));
  assert.doesNotThrow(() => drawWorld(createMockCtx(), blank(), null));
  const noWorld = blank();
  delete noWorld.world;
  ground(noWorld);
  assert.doesNotThrow(() => drawWorld(createMockCtx(), noWorld, view()));
});

test('gleiche Eingabe gibt gleiche Zeichenaufrufe, andere Zeit andere Bewegung', () => {
  const s = blank();
  ground(s);
  s.zones.push(createWind(s, 100, 120, 200, 200, { vx: 100 }));
  const r = createRain(s, 400, 250, { y: 80 });
  r.active = true;
  r.intensity = 1;
  s.zones.push(r);
  s.stars.push(createStar(s, 300, 300, { bonus: 'risk' }));
  s.hazards.push(createSpike(s, s.platforms[0], 0.5));
  const a = sig(draw(s, { time: 3.3 }));
  const b = sig(draw(s, { time: 3.3 }));
  const c = sig(draw(s, { time: 4.7 }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ---------- Plattformen ----------

test('Plattformfarben kommen aus themeAt, auch mitten in der Überblendung', () => {
  for (const [from, to, blend] of [[0, 0, 1], [1, 1, 1], [2, 2, 1], [3, 3, 1], [0, 1, 0.5], [3, 0, 0.3]]) {
    const s = blank();
    s.world = { index: to, from, to, blend, gatesPassed: 0 };
    ground(s);
    floater(s, 100, 250);
    const ctx = draw(s);
    assert.ok(shapes(ctx).length > 20);
    const top = themeAt(s.world).groundTop;
    assert.ok(assigned(ctx, 'fillStyle').includes(top), `Randfarbe ${top} bei ${from}/${to}/${blend}`);
  }
  const a = blank(0);
  const b = blank(2);
  ground(a);
  ground(b);
  assert.notEqual(themeAt(a.world).groundTop, themeAt(b.world).groundTop);
});

test('statische Plattformen: Boden und schwebende Wolke unterscheiden sich', () => {
  const g = blank();
  ground(g, 100, 360, 300);
  const f = blank();
  floater(f, 100, 360, 300);
  const cg = draw(g);
  const cf = draw(f);
  assert.ok(shapes(cg).length > 0 && shapes(cf).length > 0);
  assert.notEqual(sig(cg), sig(cf));
  // Der Boden ist ein hoher Körper mit Beschnitt, die Wolke eine dünne Platte
  assert.ok(named(cg, 'clip').length > 0);
  assert.equal(named(cf, 'clip').length, 0);
});

test('bewegliche Plattform wird an der aktuellen Position gezeichnet und zeigt ihre Bahn', () => {
  const s = blank();
  const m = createMovingPlatform(s, 400, 220, 110, { ax: 60, ay: 0, period: 3, phase: 0 });
  m.x = 437.5;
  m.y = 222.25;
  s.platforms.push(m);
  const ctx = draw(s, { camX: 50 });
  assert.ok(named(ctx, 'translate').some((c) => c[1] === 437.5 - 50 && c[2] === 222.25), 'Körper bei (x, y) der Plattform');
  assert.ok(named(ctx, 'setLineDash').some((c) => c[1].length > 0), 'gestrichelte Bahn');

  // Ohne Bewegung keine Bahn
  const still = blank();
  still.platforms.push(createMovingPlatform(still, 400, 220, 110, { ax: 0, ay: 0 }));
  assert.ok(!named(draw(still), 'setLineDash').some((c) => c[1].length > 0));

  // Senkrechte Bahn: Plattform wird mit Pfeilen nach oben und unten gezeichnet, ohne Fehler
  const v = blank();
  v.platforms.push(createMovingPlatform(v, 400, 220, 110, { ax: 0, ay: 50, period: 3, phase: 1 }));
  assert.ok(shapes(draw(v)).length > 10);
  assert.notEqual(sig(draw(v)), sig(draw(s)));
});

test('brüchige Plattform: idle, armed, shaking, broken und Wiederkehr', () => {
  const make = (state, o = {}) => {
    const s = blank();
    const p = createBreakablePlatform(s, 200, 250, 120, { respawn: 3 });
    Object.assign(p, { state }, o);
    s.platforms.push(p);
    return s;
  };
  const idle = draw(make('idle'));
  const armed = draw(make('armed', { timer: 0.2 }));
  const shaking = draw(make('shaking', { timer: 0.6, shakeX: 3, alpha: 0.7 }));
  const broken = draw(make('broken', { alpha: 0 }));
  const back = draw(make('idle', { alpha: 0.4 }));

  assert.ok(shapes(idle).length > 10);
  assert.equal(shapes(broken).length, 0, 'gebrochene Plattform ist unsichtbar');
  assert.ok(shapes(armed).length > shapes(idle).length, 'armed zeigt leuchtende Risse');
  assert.ok(shapes(back).length > shapes(idle).length, 'Wiederkehr schimmert');

  // Seitliches Wackeln über shakeX, sinkendes alpha
  const xOf = (ctx) => named(ctx, 'translate')[0][1];
  assert.equal(xOf(shaking) - xOf(idle), 3);
  assert.equal(assigned(shaking, 'globalAlpha')[0], 0.7);
  assert.equal(assigned(back, 'globalAlpha')[0], 0.4);
  const calm = draw(make('shaking', { timer: 0.6, shakeX: 3, alpha: 0.7 }), { reduceMotion: true });
  assert.ok(xOf(calm) - xOf(idle) < 3 && xOf(calm) - xOf(idle) > 0, 'bei reduceMotion weniger Wackeln');

  // Unbekannter Zustand und fehlende Felder werfen nicht
  assert.doesNotThrow(() => draw(make('seltsam', { alpha: undefined, shakeX: undefined, timer: NaN })));
});

// ---------- Sprungwolke, Eiswolke, Blinkwolke ----------

const spring = (press = 0, o = {}) => {
  const s = blank();
  const p = createSpringPlatform(s, 200, 250, 120);
  p.press = press;
  Object.assign(p, o);
  s.platforms.push(p);
  return s;
};

// Die Skalierung des Körpers (Eindrücken): erster scale Aufruf, der nur den Körper staucht
const squash = (ctx) => named(ctx, 'scale').find((c) => c[1] >= 1 && c[1] < 1.2 && c[2] <= 1 && c[2] > 0.5 && (c[1] > 1 || c[2] < 1) ) || ['scale', 1, 1];

test('Sprungwolke: korallenfarben, Feder Symbol, Pfeile nach oben, klar anders als eine normale Wolke', () => {
  const plain = blank();
  floater(plain, 200, 250, 120);
  const cp = draw(plain, { reduceMotion: true });
  const cs = draw(spring(0), { reduceMotion: true });
  assert.ok(shapes(cs).length > shapes(cp).length + 15, 'Sprungwolke hat deutlich mehr Form');
  assert.notEqual(sig(cs), sig(cp));
  assert.ok(assigned(cs, 'fillStyle').includes('#e8694f'), 'koralle Federbauch');
  assert.ok(!assigned(cp, 'fillStyle').includes('#e8694f'));
  // Die Feder ist ein Zickzack: fünf kurze Linien abwechselnd nach links und rechts, dunkel unterlegt und hell gezeichnet
  const zig = named(cs, 'lineTo').filter((c) => c[2] > 16); // lokale Koordinaten: unter der Platte (Höhe 16)
  assert.ok(zig.length >= 5, `Feder aus Linien, ${zig.length}`);
  assert.ok(named(cs, 'stroke').length >= 2 && assigned(cs, 'strokeStyle').includes('#a63a2c') && assigned(cs, 'strokeStyle').includes('#fff3da'), 'dunkel unterlegt, hell darüber');
  const xs = new Set(zig.map((c) => Math.round(c[1])));
  assert.ok(xs.size >= 3, 'die Feder pendelt nach links und rechts');
  // Pfeilspitzen über der Platte zeigen: hier geht es hoch (Form statt Farbe). Sie liegen oberhalb der Oberkante (y 0)
  const arrows = named(cs, 'lineTo').filter((c) => c[2] < -2);
  assert.ok(arrows.length >= 4, 'Pfeilspitzen über der Platte');
  // Das leichte Leuchten: ein Verlauf, der als Fläche über die Wolke gezogen wird
  assert.ok(named(cs, 'fillRect').length >= 1);
  // Fernab gezeichnet bleibt dieselbe Form (nur verschoben)
  const moved = blank();
  moved.platforms.push(createSpringPlatform(moved, 640, 250, 120));
  assert.equal(shapes(draw(moved, { reduceMotion: true })).length, shapes(cs).length);
});

test('Sprungwolke: press drückt sie zusammen, bei reduceMotion weniger, kaputte Werte werfen nicht', () => {
  const sy = (press, o) => squash(draw(spring(press), o))[2];
  const sx = (press, o) => squash(draw(spring(press), o))[1];
  assert.equal(sy(0), 1, 'ohne Druck keine Stauchung');
  assert.ok(sy(0.5) < sy(0.25) && sy(1) < sy(0.5), 'tiefer eingedrückt, flacher');
  assert.ok(sx(1) > sx(0.5) && sx(0.5) > sx(0), 'dabei breiter');
  assert.ok(sy(1) < 0.75 && sy(1) > 0.5, 'Stauchung sichtbar, aber nicht flach');
  assert.ok(sy(1, { reduceMotion: true }) > sy(1) + 0.1, 'ruhiger bei reduceMotion');
  assert.ok(sy(1, { reduceMotion: true }) < 1);

  // Beim Abprall kommen Ring und Strahlen über der Platte dazu
  const strokes = (press) => named(draw(spring(press), { reduceMotion: true }), 'stroke').length;
  assert.ok(strokes(0.9) > strokes(0), 'Abprall Ring');
  const ring = (press) => named(draw(spring(press), { reduceMotion: true }), 'ellipse').filter((c) => c[2] === -1);
  assert.equal(ring(0).length, 0);
  assert.equal(ring(0.9).length, 1);
  // Der Ring weitet sich, solange press abklingt
  assert.ok(ring(0.3)[0][3] > ring(0.9)[0][3], 'Ring wird weiter, je weiter der Abprall ist');

  for (const press of [NaN, undefined, null, -3, 7, Infinity, '0.5']) {
    const ctx = draw(spring(press), {});
    assert.equal(allArgsFinite(ctx), true, `press ${press}`);
    assert.ok(shapes(ctx).length > 20);
  }
  const wide = blank();
  wide.platforms.push(createSpringPlatform(wide, 100, 250, 400), createSpringPlatform(wide, 600, 250, 40));
  assert.equal(allArgsFinite(draw(wide)), true);
});

test('Sprungwolke: schwebende Pfeile und Leuchten nur ohne reduceMotion', () => {
  const s = spring(0);
  assert.ok(new Set([0.2, 0.9, 1.7, 3.3].map((time) => sig(draw(s, { time })))).size > 1, 'Pfeile steigen auf');
  assert.equal(new Set([0.2, 0.9, 1.7, 3.3, 9.1].map((time) => sig(draw(s, { time, reduceMotion: true })))).size, 1);
});

const iceFloater = (w = 160, o = {}) => {
  const s = blank();
  const p = createStaticPlatform(s, 200, 250, w, { slick: true });
  Object.assign(p, o);
  s.platforms.push(p);
  return s;
};
const iceGround = (w = 300) => {
  const s = blank();
  s.platforms.push(createStaticPlatform(s, 100, 360, w, { ground: true, slick: true }));
  return s;
};

test('Eiswolke: bläulich weiß, kristallin, Glanzstreifen und Glitzer, klar anders als eine normale Wolke', () => {
  const plain = blank();
  floater(plain, 200, 250, 160);
  const cp = draw(plain, { reduceMotion: true });
  const ci = draw(iceFloater(), { reduceMotion: true });
  assert.notEqual(sig(ci), sig(cp));
  assert.ok(shapes(ci).length > shapes(cp).length + 40, 'Eis hat Zapfen, Streifen, Kristalle');
  assert.ok(assigned(ci, 'fillStyle').includes('#f6fdff'), 'Eisweiß');
  assert.ok(assigned(ci, 'fillStyle').includes('#9ccaf4'), 'Eiszapfen');
  assert.ok(!assigned(cp, 'fillStyle').includes('#f6fdff'));
  assert.ok(assigned(ci, 'strokeStyle').includes('#ffffff'), 'weißer Glanz an der Oberkante');
  // Eiszapfen unter dem Körper: Dreiecke, die nach unten über die Unterkante (lokal y 16) hinausragen
  assert.ok(named(ci, 'lineTo').filter((c) => c[2] > 16 + 4).length >= 4, 'Zapfen hängen nach unten');
  // Kristalline Platte: nur Linien, keine runde Pillenform (der Körper ist ein Polygon mit abgeschrägten Ecken)
  assert.equal(named(ci, 'roundRect').length, 0);
  assert.ok(named(cp, 'roundRect').length > 0);
  // Glanzstreifen sind Parallelogramme innerhalb der Platte (schräg: oben rechts weiter als unten)
  const clipped = named(ci, 'clip').length;
  assert.ok(clipped >= 1, 'Streifen werden an der Platte beschnitten');
  // Glitzer: vierzackige Sterne aus Kurven
  assert.ok(named(ci, 'quadraticCurveTo').length >= 4, 'mindestens ein Glitzerstern');
  assert.equal(allArgsFinite(ci), true);
});

test('Eiswolke: hohe Fläche (ground) ist erkennbar rutschig und anders als der Boden', () => {
  const g = blank();
  ground(g, 100, 360, 300);
  const cg = draw(g, { reduceMotion: true });
  const ci = draw(iceGround(), { reduceMotion: true });
  assert.notEqual(sig(ci), sig(cg));
  assert.ok(assigned(ci, 'fillStyle').includes('#f9feff'), 'glänzende Eisfläche oben');
  assert.ok(named(ci, 'clip').length > 0, 'wie der Boden mit Beschnitt');
  assert.ok(named(ci, 'quadraticCurveTo').length >= 4, 'Glitzer an der Oberkante');
  // Auch eine hohe Platte ohne ground Flag (h über 60) wird als Eisfläche gezeichnet
  const tall = iceFloater(300, { h: 120 });
  assert.ok(assigned(draw(tall, { reduceMotion: true }), 'fillStyle').includes('#f9feff'));
  // Hohe Fläche reicht nur bis zum unteren Bildrand
  const maxY = maxOf(named(ci, 'lineTo').map((c) => c[2]).concat(named(ci, 'moveTo').map((c) => c[2])));
  assert.ok(maxY <= 360 + 200 + 1);
  // Nur der sichtbare Teil bekommt Details: eine sehr lange Fläche braucht nicht viel mehr Aufrufe
  const long = ops(draw(iceGround(6000), { reduceMotion: true })).length;
  assert.ok(long < ops(draw(iceGround(300), { reduceMotion: true })).length * 3, `${long} Aufrufe bei 6000 px`);
});

test('Eiswolke: Lichtband und Glitzer bewegen sich, bei reduceMotion bleibt ein ruhiges Glitzern', () => {
  for (const make of [() => iceFloater(), () => iceGround()]) {
    const s = make();
    assert.ok(new Set([0.3, 1.1, 2.6, 5.2].map((time) => sig(draw(s, { time })))).size > 1);
    const calm = [0.3, 1.1, 2.6, 5.2].map((time) => draw(s, { time, reduceMotion: true }));
    assert.equal(new Set(calm.map(sig)).size, 1);
    assert.ok(named(calm[0], 'quadraticCurveTo').length >= 4, 'ruhig bleibt mindestens ein Stern stehen');
  }
  // Jede Eiswolke glitzert zu ihrer Zeit (id)
  const two = blank();
  two.platforms.push(createStaticPlatform(two, 100, 250, 160, { slick: true }), createStaticPlatform(two, 400, 250, 160, { slick: true }));
  assert.equal(allArgsFinite(draw(two, { time: 2 })), true);
});

const blink = (o = {}, t = 0, w = 110) => {
  const s = blank();
  s.t = t;
  const p = createBlinkPlatform(s, 200, 250, w, { period: 4, on: 0.62, phase: 0 });
  Object.assign(p, o);
  s.platforms.push(p);
  return s;
};
// Takt Ring: Bogen von oben im Uhrzeigersinn, Länge = Restzeit der Phase
const clockArc = (ctx) => named(ctx, 'arc').filter((c) => c[4] === -Math.PI / 2);
const arcLen = (ctx) => { const a = clockArc(ctx); return a.length ? a[0][5] + Math.PI / 2 : 0; };

test('Blinkwolke: solid als Wolke mit Takt Ring, nicht solid nur als schwacher Umriss mit gestricheltem Gerüst', () => {
  const solid = draw(blink({ solid: true, alpha: 1 }, 1), { reduceMotion: true });
  const off = draw(blink({ solid: false, alpha: 0.15 }, 3), { reduceMotion: true });
  const plain = blank();
  floater(plain, 200, 250, 110);
  const cp = draw(plain, { reduceMotion: true });

  assert.notEqual(sig(solid), sig(cp));
  assert.ok(assigned(solid, 'strokeStyle').includes('#23857c'), 'Mint Rand');
  assert.ok(clockArc(solid).length === 1, 'Takt Ring');
  assert.equal(maxOf(assigned(solid, 'globalAlpha')), 1);
  assert.ok(named(solid, 'roundRect').length > 0, 'fester Körper');

  // Aus: nichts Festes, Alpha höchstens ein Hauch, aber das Gerüst bleibt (gestrichelter Rand, Eckmarken)
  assert.equal(named(off, 'roundRect').filter((c) => c[3] > 100).length, 1, 'nur der Umriss als Pille');
  assert.ok(maxOf(assigned(off, 'globalAlpha')) <= 0.6, `Alpha aus ${maxOf(assigned(off, 'globalAlpha'))}`);
  assert.ok(named(off, 'setLineDash').some((c) => c[1].length > 0), 'gestrichelt');
  assert.ok(!assigned(off, 'fillStyle').some((v) => typeof v === 'string' && v.startsWith('#') && v === '#f4fffa'));
  // Der feste Zustand hat viele Alpha 1 Flächen, der aus Zustand nicht: weder Körper noch Bäuche
  assert.ok(named(solid, 'fill').length > named(off, 'fill').length, 'weniger gefüllte Flächen');
  // Das Gerüst (Eckmarken) steht auch beim festen Zustand, damit die Form gleich bleibt
  const corners = (ctx) => named(ctx, 'lineTo').filter((c) => c[1] < 200 - 2 || c[1] > 310 + 2).length;
  assert.ok(corners(off) >= 4 && corners(solid) >= 4, 'Eckmarken');
  // Die Platte liegt an der richtigen Stelle
  assert.ok(named(solid, 'translate').some((c) => c[1] === 200 && c[2] === 250));
});

test('Blinkwolke: warn flackert über alpha und wird gelb, ohne Farbe am gestrichelten Ring erkennbar', () => {
  const warnAt = (alpha, o) => draw(blink({ solid: true, warn: true, alpha }, 2.2), o);
  const calm = draw(blink({ solid: true, warn: false, alpha: 1 }, 2.2), { reduceMotion: true });
  const w1 = warnAt(0.9, {});
  const w2 = warnAt(0.45, {});
  assert.ok(assigned(w1, 'strokeStyle').includes('#ffc83d'), 'Warnfarbe am Rand');
  assert.ok(!assigned(calm, 'strokeStyle').includes('#ffc83d'));
  // Das Flackern kommt als alpha aus der Simulation: zwei Werte, zwei Bilder
  assert.notEqual(sig(w1), sig(w2));
  assert.ok(assigned(w1, 'globalAlpha').includes(0.9) && assigned(w2, 'globalAlpha').includes(0.45));
  // Ohne Farbe lesbar: der Takt Ring ist gestrichelt, nur in der Vorwarnung
  const dashedArc = (ctx) => named(ctx, 'setLineDash').some((c) => c[1].length > 0);
  assert.ok(dashedArc(w1) && !dashedArc(calm));
  // reduceMotion: kein Flackern, ruhig mit festem Alpha, die Warnung bleibt sichtbar (Farbe und Strichelung)
  const q1 = warnAt(0.9, { reduceMotion: true });
  const q2 = warnAt(0.45, { reduceMotion: true });
  assert.equal(sig(q1), sig(q2), 'bei reduceMotion kein Flackern');
  assert.ok(assigned(q1, 'strokeStyle').includes('#ffc83d') && dashedArc(q1));
  // Der Ring pulsiert in der Warnung (Größe aus dem Takt), ruhig nicht
  const ringR = (s, o) => clockArc(draw(s, o))[0][3];
  const radii = new Set([1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4].map((t) => ringR(blink({ solid: true, warn: true, alpha: 1 }, t), {}).toFixed(3)));
  assert.ok(radii.size > 3, 'Ring pulsiert');
  assert.equal(new Set([1.9, 2.1, 2.3].map((t) => ringR(blink({ solid: true, warn: true, alpha: 1 }, t), { reduceMotion: true }))).size, 1);
});

test('Blinkwolke: der Ring zeigt die Restzeit aus s.t, auch in der Pause bis zur Rückkehr', () => {
  // Takt 4 s, fest bis ph 0,62 (2,48 s), danach weg bis 4 s
  const left = (t, solid) => arcLen(draw(blink({ solid, alpha: solid ? 1 : 0.15 }, t), { reduceMotion: true }));
  const a = left(0.2, true);
  const b = left(1.2, true);
  const c = left(2.3, true);
  assert.ok(a > b && b > c && c > 0, `fest: Ring schrumpft ${a} ${b} ${c}`);
  assert.ok(Math.abs(a / (Math.PI * 2) - (0.62 - 0.05) / 0.62) < 1e-9, 'Anteil der festen Zeit');
  const d = left(2.6, false);
  const e = left(3.4, false);
  const f = left(3.9, false);
  assert.ok(d > e && e > f && f > 0, `weg: Ring schrumpft bis zur Rückkehr ${d} ${e} ${f}`);
  // Phase verschiebt den Takt
  const shifted = blink({ solid: true, alpha: 1, phase: 0.25 }, 0.2);
  assert.ok(Math.abs(arcLen(draw(shifted, { reduceMotion: true })) - left(1.2, true)) < 1e-9);
  // Vor der Rückkehr wird der Umriss deutlicher (das Gerüst leuchtet stärker auf)
  const lineAlpha = (t) => maxOf(assigned(draw(blink({ solid: false, alpha: 0.15 }, t), { reduceMotion: true }), 'globalAlpha'));
  assert.ok(lineAlpha(3.9) >= lineAlpha(2.6), 'der Umriss wird vor dem Erscheinen deutlicher');
  // Takt Punkte nur bei breiten Wolken
  const dots = (w) => named(draw(blink({ solid: true }, 1, w), { reduceMotion: true }), 'arc').filter((c) => c[3] < 2).length;
  assert.ok(dots(110) >= 2 && dots(50) === 0);
});

test('Blinkwolke: kaputte Felder, fehlende Uhr und Sonderfälle werfen nicht', () => {
  for (const o of [{ period: 0 }, { period: NaN }, { period: -2 }, { on: NaN }, { on: 0 }, { on: 1 }, { on: 7 }, { phase: NaN }, { phase: -3.3 }, { alpha: NaN }, { alpha: undefined }, { alpha: 5 }, { solid: undefined }, { warn: true, solid: false }]) {
    for (const t of [0, 1.7, 3.99, NaN, -5, 1e9]) {
      const s = blink(o, t);
      assert.equal(allArgsFinite(draw(s)), true, JSON.stringify(o));
    }
  }
  const noClock = blink({}, 0);
  delete noClock.t;
  assert.doesNotThrow(() => draw(noClock));
  // warn ohne solid gilt nicht als Warnung (Umriss bleibt ein Hauch)
  const odd = draw(blink({ warn: true, solid: false, alpha: 0.15 }, 3), { reduceMotion: true });
  assert.ok(!assigned(odd, 'strokeStyle').includes('#ffc83d'));
  assert.ok(maxOf(assigned(odd, 'globalAlpha')) <= 0.6);
  // Konstanten sind wirksam: Vorwarnung nutzt BLINK.WARN, die Standardperiode kommt aus BLINK.PERIOD
  assert.ok(BLINK.WARN > 0 && BLINK.PERIOD[0] > 0);
});

// ---------- Zonen ----------

function windStreaks(ctx) {
  const list = ops(ctx);
  const out = [];
  for (let i = 1; i < list.length; i++) {
    if (list[i][0] === 'quadraticCurveTo' && list[i - 1][0] === 'moveTo') {
      out.push({ tail: { x: list[i - 1][1], y: list[i - 1][2] }, head: { x: list[i][3], y: list[i][4] } });
    }
  }
  return out;
}

test('Windzone: Schlieren strömen in Windrichtung und bleiben im Feld', () => {
  const dirs = [
    ['rechts', 100, 0, 1, 0],
    ['links', -100, 0, -1, 0],
    ['auf', 0, -700, 0, -1],
    ['schräg', 80, -300, 1, -1],
  ];
  for (const [name, vx, ay, sx, sy] of dirs) {
    const s = blank();
    const z = createWind(s, 100, 100, 220, 200, { vx, ay });
    s.zones.push(z);
    let n = 0;
    for (const time of [0.3, 1.9, 4.4, 8.2]) {
      const ctx = draw(s, { time });
      for (const k of windStreaks(ctx)) {
        n++;
        if (sx) assert.ok((k.head.x - k.tail.x) * sx > 5, `${name}: Kopf in x Richtung`);
        if (sy) assert.ok((k.head.y - k.tail.y) * sy > 5, `${name}: Kopf in y Richtung`);
        for (const p of [k.head, k.tail]) {
          assert.ok(p.x >= z.x - 8 && p.x <= z.x + z.w + 8 && p.y >= z.y - 8 && p.y <= z.y + z.h + 8, `${name}: Schliere im Feld (${p.x}, ${p.y})`);
        }
      }
      assert.equal(allArgsFinite(ctx), true);
    }
    assert.ok(n >= 12, `${name}: es gibt Schlieren`);
  }
});

test('Windzone: Stärke ist sichtbar, ohne Wind nur die weiche Fläche', () => {
  const zone = (vx, ay) => {
    const s = blank();
    s.zones.push(createWind(s, 100, 100, 220, 200, { vx, ay }));
    return s;
  };
  const alphaMax = (s) => maxOf([0.3, 1.1, 2.4, 3.9, 5.2, 6.6].flatMap((time) => assigned(draw(s, { time }), 'globalAlpha')));
  assert.ok(alphaMax(zone(120, 0)) > alphaMax(zone(25, 0)) + 0.1, 'starker Wind deckender');
  assert.ok(alphaMax(zone(0, -800)) > alphaMax(zone(0, -150)) + 0.1, 'starker Aufwind deckender');
  const none = draw(zone(0, 0));
  assert.equal(windStreaks(none).length, 0);
  assert.ok(shapes(none).length > 0 && shapes(none).length < shapes(draw(zone(100, 0))).length);
  // Wind ohne Tempo oder mit kaputten Werten wirft nicht
  assert.doesNotThrow(() => draw(zone(NaN, NaN)));
});

test('Regenzone: ruhende Wolke, Tropfen schräg nach unten, Stärke zeigt sich in der Menge', () => {
  const make = (active, intensity) => {
    const s = blank();
    const r = createRain(s, 200, 300, { y: 90 });
    r.active = active;
    r.intensity = intensity;
    s.zones.push(r);
    return s;
  };
  const drops = (ctx) => {
    const list = ops(ctx);
    const out = [];
    for (let i = 0; i + 1 < list.length; i++) {
      if (list[i][0] === 'moveTo' && list[i + 1][0] === 'lineTo') out.push({ from: list[i], to: list[i + 1] });
    }
    return out;
  };
  const calm = draw(make(false, 0));
  assert.ok(shapes(calm).length > 5, 'ruhende Wolke ist da');
  assert.equal(named(calm, 'stroke').length, 0, 'ohne Regen keine Tropfen');
  assert.equal(drops(calm).length, 0);

  const full = draw(make(true, 1));
  const half = draw(make(true, 0.5));
  const dFull = drops(full);
  assert.ok(dFull.length > 20, 'Regen hat Tropfen');
  assert.ok(drops(half).length < dFull.length, 'schwächerer Regen weniger Tropfen');
  for (const d of dFull) {
    assert.ok(d.from[1] > d.to[1] && d.from[2] > d.to[2], 'Tropfen fallen schräg nach unten rechts');
    assert.ok(d.from[2] <= H + 16 && d.to[2] >= 90 - 20, 'Tropfen im Bereich von der Wolke bis unten');
    assert.ok(d.from[1] >= 200 - 10 && d.from[1] <= 500 + 10, 'Tropfen unter der Wolke');
  }
  // active ohne intensity (Beginn des Regens) und intensity ohne active zeichnen beide
  assert.ok(named(draw(make(true, 0)), 'stroke').length > 0);
  assert.ok(named(draw(make(false, 0.4)), 'stroke').length > 0);
  // Regen fällt mit der Zeit
  assert.notEqual(sig(draw(make(true, 1), { time: 1 })), sig(draw(make(true, 1), { time: 1.2 })));
});

// ---------- Hindernisse ----------

test('Stachelwolke: Gefahr erkennbar, Knistern nur ohne reduceMotion, Debug Hitbox stimmt', () => {
  const s = blank();
  const p = floater(s, 200, 300, 200);
  const h = createSpike(s, p, 0.5);
  s.hazards.push(h);
  const base = draw(s);
  assert.ok(shapes(base).length > 25);
  assert.ok(assigned(base, 'fillStyle').includes('#ffe94a'), 'elektrisch gelbe Stacheln');
  assert.ok(assigned(base, 'fillStyle').includes('#2b2a3c'), 'dunkler Körper');
  assert.equal(named(base, 'strokeRect').length, 0);
  assert.equal(named(base, 'fillText').length, 0);

  let moreSparks = false;
  for (let i = 0; i < 30; i++) {
    const time = i * 0.13;
    if (shapes(draw(s, { time })).length > shapes(draw(s, { time, reduceMotion: true })).length) moreSparks = true;
  }
  assert.ok(moreSparks, 'es knistert');
  const calmLogs = new Set([0.2, 1.7, 3.1, 9.9].map((time) => sig(draw(s, { time, reduceMotion: true }))));
  assert.equal(calmLogs.size, 1, 'bei reduceMotion bleibt die Stachelwolke ruhig');

  const dbg = draw(s, { debug: true });
  const hb = spikeHitbox(h);
  assert.ok(named(dbg, 'strokeRect').some((c) => c[1] === hb.x + 0.5 && c[2] === hb.y + 0.5 && c[3] === hb.w - 1 && c[4] === hb.h - 1), 'Hitbox wie in obstacles.js');
});

function bolt(phase, { charge = 0, x = 400, timer = 0.3 } = {}) {
  const s = blank();
  ground(s);
  const h = createLightning(s, x);
  Object.assign(h, { phase, charge, timer });
  s.hazards.push(h);
  return s;
}

test('Blitz: jede Phase zeichnet, Vorwarnung hat Form und Markierung statt nur Farbe', () => {
  const dashed = (ctx) => named(ctx, 'setLineDash').filter((c) => c[1].length > 0).length;
  const idle = draw(bolt('idle'));
  const glow = draw(bolt('glow', { charge: 0.4 }));
  const flicker = draw(bolt('flicker', { charge: 0.9 }));
  const strike = draw(bolt('strike', { charge: 1 }));
  const cool = draw(bolt('cooldown', { timer: 0.7 }));
  for (const c of [idle, glow, flicker, strike, cool]) {
    assert.ok(shapes(c).length > 15);
    assert.equal(allArgsFinite(c), true);
  }
  assert.equal(dashed(idle), 0, 'idle ruhig und ohne Markierung');
  for (const [name, c] of [['glow', glow], ['flicker', flicker], ['strike', strike]]) assert.ok(dashed(c) > 0, `${name}: gestrichelte Säule`);
  assert.ok(named(glow, 'ellipse').length > named(idle, 'ellipse').length, 'Zielring am Boden');

  // Die Säule steht bei x plus minus w/2, wie in obstacles.js
  const col = lightningColumn(bolt('strike').hazards[0]);
  assert.ok(named(strike, 'moveTo').some((c) => c[1] === col.x) && named(strike, 'moveTo').some((c) => c[1] === col.x + col.w), 'Säulenränder');

  // Markierung wird mit der Aufladung kräftiger
  const markAlpha = (ctx) => {
    const i = ctx.calls.findIndex((c) => c[0] === 'ellipse' && c[3] === 28 && c[4] === 6); // Zielring am Boden
    for (let k = i; k >= 0; k--) if (ctx.calls[k][0] === '=globalAlpha') return ctx.calls[k][1];
    return 0;
  };
  assert.ok(markAlpha(draw(bolt('glow', { charge: 0.7 }))) > markAlpha(draw(bolt('glow', { charge: 0.05 }))));
  assert.ok(markAlpha(flicker) > markAlpha(glow));

  // Einschlag: Zickzack von der Wolke bis zum Boden, mit Glow
  const ys = named(strike, 'lineTo').map((c) => c[2]);
  assert.ok(maxOf(ys) >= 355, 'Blitz reicht bis zum Boden');
  assert.ok(assigned(strike, 'shadowBlur').some((v) => v > 0), 'Glow');
  assert.ok(named(strike, 'lineTo').length > named(idle, 'lineTo').length + 5);
  // Zickzack zwischen Wolke und Boden: Punkte innerhalb der Säule, nur beim Einschlag
  const zigzag = (ctx) => named(ctx, 'lineTo').filter((c) => c[1] > col.x + 1 && c[1] < col.x + col.w - 1 && c[2] > 60 && c[2] < 300).length;
  assert.ok(zigzag(strike) >= 5);
  assert.equal(zigzag(flicker) + zigzag(glow) + zigzag(idle), 0, 'in den Warnphasen gibt es keinen Blitz');
});

test('Blitz: Flackern nur ohne reduceMotion, Wolke bei x und cloudY', () => {
  const times = [0.1, 0.37, 0.8, 1.3, 2.9];
  const logs = (o) => new Set(times.map((time) => sig(draw(bolt('flicker', { charge: 0.9 }), { time, ...o }))));
  assert.ok(logs({}).size > 1, 'flackert');
  assert.equal(logs({ reduceMotion: true }).size, 1, 'bei reduceMotion ruhig');
  const s = bolt('idle', { x: 450 });
  const cloud = named(draw(s, { camX: 100 }), 'translate').find((c) => c[2] === s.hazards[0].cloudY);
  assert.ok(cloud && cloud[1] === 350, 'Wolke bei x minus camX');
});

// ---------- Sammelobjekte ----------

// Oberste Spitze des ersten Sterns: moveTo des Pentagramms
const starTop = (ctx) => named(ctx, 'moveTo')[0];

test('Sterne: normal, Risiko, Event, fallend, eingesammelt', () => {
  const one = (o, st = {}) => {
    const s = blank();
    const star = createStar(s, 300, 200, o);
    Object.assign(star, st);
    s.stars.push(star);
    return s;
  };
  const normal = draw(one({}), { reduceMotion: true });
  const risk = draw(one({ bonus: 'risk', value: 25 }), { reduceMotion: true });
  const event = draw(one({ bonus: 'event', value: 5 }), { reduceMotion: true });
  const radius = (ctx) => 200 - starTop(ctx)[2];
  assert.ok(radius(risk) > radius(normal) && radius(normal) > radius(event), 'Risiko größer, Event kleiner');
  assert.ok(shapes(risk).length > shapes(normal).length, 'Risikostern hat eine Aura');
  assert.ok(assigned(risk, 'fillStyle').includes('#ffbe2e'), 'Risikostern goldener');
  assert.ok(assigned(event, 'fillStyle').includes('#fffbe6'), 'Eventstern heller');

  const falling = draw(one({ falling: true }), { reduceMotion: true });
  const started = draw(one({ falling: true }, { started: true, vy: 120 }), { reduceMotion: true });
  assert.ok(shapes(falling).length > shapes(normal).length, 'fallender Stern hat eine Spur');
  assert.ok(shapes(started).length >= shapes(falling).length);

  const got = draw(one({}, { got: true }));
  assert.equal(ops(got).length, 0, 'eingesammelte Sterne werden nicht gezeichnet');

  // Pulsieren und Schweben: andere Zeit, andere Größe, bei reduceMotion nicht
  const at = (time, o = {}) => starTop(draw(one({}), { time, ...o }))[2];
  const swing = (o) => Math.max(...[0.1, 0.4, 0.8, 1.1, 1.6, 2.2].map((time) => at(time, o))) - Math.min(...[0.1, 0.4, 0.8, 1.1, 1.6, 2.2].map((time) => at(time, o)));
  assert.ok(swing({}) > 3, 'Stern schwebt und pulsiert');
  assert.ok(swing({ reduceMotion: true }) < swing({}) / 3, 'bei reduceMotion deutlich weniger');
  // Die Phase des Sterns verschiebt das Pulsieren
  const a = one({}, { phase: 0 });
  const b = one({}, { phase: 2 });
  assert.notDeepEqual(starTop(draw(a)), starTop(draw(b)));
});

test('Powerups: vier unterscheidbare Symbole, Farben aus POWERUPS', () => {
  const logs = {};
  for (const type of ['shield', 'dash', 'magnet', 'feather']) {
    const s = blank();
    s.powerups.push(createPowerup(s, type, 300, 250));
    const ctx = draw(s, { reduceMotion: true });
    logs[type] = sig(ctx);
    assert.ok(shapes(ctx).length > 15, type);
    assert.ok(assigned(ctx, 'strokeStyle').includes(POWERUPS[type].color), `${type}: Blase in der Farbe`);
  }
  assert.equal(new Set(Object.values(logs)).size, 4, 'alle vier sehen verschieden aus');

  const s = blank();
  s.powerups.push(createPowerup(s, 'unbekannt', 300, 250));
  assert.ok(shapes(draw(s)).length > 5, 'unbekannter Typ zeichnet nur die Blase');
  const taken = blank();
  const u = createPowerup(taken, 'shield', 300, 250);
  u.got = true;
  taken.powerups.push(u);
  assert.equal(ops(draw(taken)).length, 0);

  // Schweben: andere Zeit, andere Höhe, bei reduceMotion nicht
  const yAt = (time, o = {}) => named(draw(s, { time, ...o }), 'translate')[0][2];
  assert.notEqual(yAt(0.3), yAt(1.4));
  assert.equal(yAt(0.3, { reduceMotion: true }), yAt(1.4, { reduceMotion: true }));
});

test('Traumtor: Mondring von gate.y nach oben, nach dem Durchlaufen verblasst es', () => {
  const make = (passed, playerX = 300) => {
    const s = blank();
    const g = createGate(s, 400, 360, 2);
    g.passed = passed;
    s.gates.push(g);
    s.player.x = playerX;
    return s;
  };
  const open = draw(make(false));
  assert.ok(shapes(open).length > 40);
  const ring = named(open, 'ellipse').find((c) => c[7] === Math.PI * 2 && c[3] > 40 && c[4] > 80);
  assert.ok(ring, 'großer Ring');
  assert.equal(ring[1], 400);
  assert.equal(ring[2], 360 - 95, 'Mitte des Rings liegt h/2 über gate.y');
  assert.ok(Math.abs(ring[4] * 2 + 12 - 190) < 1e-9, 'Höhe des Rings entspricht gate.h');

  const alpha = (ctx) => maxOf(assigned(ctx, 'globalAlpha'));
  const near = draw(make(true, 400));
  const far = draw(make(true, 900));
  assert.ok(alpha(far) < alpha(near) - 0.3, 'verblasst mit dem Abstand');
  assert.ok(alpha(near) >= alpha(open) - 0.1, 'direkt nach dem Durchlaufen noch hell');
  assert.ok(shapes(far).length > 0, 'bleibt als schwacher Schein sichtbar');
  // Tor ohne Spieler im Zustand
  const noPlayer = make(true);
  delete noPlayer.player;
  assert.doesNotThrow(() => draw(noPlayer));
  // Pulsieren: andere Zeit, anderer Glanz
  assert.notEqual(sig(draw(make(false), { time: 0.5 })), sig(draw(make(false), { time: 1.4 })));
});

// ---------- Reihenfolge ----------

test('Reihenfolge von hinten nach vorn: Regen, Wind, Plattformen, Tor, Stachelwolken, Blitze, Powerups, Tor vorn', () => {
  const s = blank();
  const rain = createRain(s, 10, 120, { y: 70 });
  rain.active = true;
  rain.intensity = 1;
  s.zones.push(createWind(s, 150, 100, 100, 100, { vx: 100 }), rain);
  const plat = floater(s, 300, 311, 200);
  s.gates.push(createGate(s, 600, 330, 1));
  s.hazards.push(createSpike(s, plat, 0.1));
  s.hazards.push(createLightning(s, 700));
  s.powerups.push(createPowerup(s, 'dash', 650, 123));
  s.stars.push(createStar(s, 520, 150));
  const ctx = draw(s, { reduceMotion: true });
  const list = ctx.calls;
  const idx = (pred) => list.findIndex(pred);
  const translateAt = (x, y) => idx((c) => c[0] === 'translate' && c[1] === x && Math.abs(c[2] - y) < 1e-6);
  const iRain = translateAt(70, 70 + (H - 70) / 2);
  const iWind = translateAt(200, 150);
  const iPlat = translateAt(300, 311);
  const iGateBack = translateAt(600, 330);
  const iSpike = translateAt(plat.x + 0.1 * (plat.w - 36), plat.y - 28);
  const iBolt = translateAt(700, 52);
  const iPower = translateAt(650, 123);
  const iGateFront = idx((c) => c[0] === 'ellipse' && c[6] === Math.PI * 0.62);
  const order = [iRain, iWind, iPlat, iGateBack, iSpike, iBolt, iPower, iGateFront];
  assert.ok(order.every((i) => i >= 0), `alle Objekte gezeichnet: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `Reihenfolge ${order}`);
});

// ---------- Sichtbarkeit ----------

test('Objekte außerhalb des Bildes erzeugen keine Aufrufe, Objekte im Randbereich schon', () => {
  const adders = {
    boden: (s, x) => { s.platforms.push(createStaticPlatform(s, x, 360, 200, { ground: true })); },
    wolke: (s, x) => { s.platforms.push(createStaticPlatform(s, x, 300, 120)); },
    beweglich: (s, x) => { const m = createMovingPlatform(s, x, 250, 100, { ax: 20 }); s.platforms.push(m); },
    brüchig: (s, x) => { s.platforms.push(createBreakablePlatform(s, x, 300, 100)); },
    stachel: (s, x) => { s.hazards.push(createSpike(s, createStaticPlatform(s, x, 300, 100), 0.5)); },
    blitz: (s, x) => { const l = createLightning(s, x); l.phase = 'strike'; s.hazards.push(l); },
    wind: (s, x) => { s.zones.push(createWind(s, x, 100, 150, 150, { vx: 100 })); },
    regen: (s, x) => { const r = createRain(s, x, 300); r.active = true; r.intensity = 1; s.zones.push(r); },
    stern: (s, x) => { s.stars.push(createStar(s, x, 200)); },
    powerup: (s, x) => { s.powerups.push(createPowerup(s, 'shield', x, 200)); },
    tor: (s, x) => { s.gates.push(createGate(s, x, 360, 1)); },
  };
  for (const [name, add] of Object.entries(adders)) {
    for (const camX of [0, 5000]) {
      for (const x of [camX - 900, camX + W + 900, camX - 5000, camX + 1e6]) {
        const s = blank();
        add(s, x);
        assert.equal(ops(draw(s, { camX })).length, 0, `${name} bei ${x - camX} ist außerhalb`);
      }
      const inside = blank();
      add(inside, camX + 400);
      assert.ok(shapes(draw(inside, { camX })).length > 0, `${name} im Bild`);
    }
  }
  // Knapp am Rand (150 px Spielraum)
  const edge = blank();
  edge.platforms.push(createStaticPlatform(edge, W + 120, 300, 100));
  assert.ok(shapes(draw(edge)).length > 0);
  const out = blank();
  out.platforms.push(createStaticPlatform(out, W + 170, 300, 100));
  assert.equal(ops(draw(out)).length, 0);

  // Ein Objekt weit weg ändert nichts an dem, was im Bild gezeichnet wird
  const a = blank();
  a.stars.push(createStar(a, 300, 200));
  const b = blank();
  b.stars.push(createStar(b, 300, 200));
  b.platforms.push(createStaticPlatform(b, 3000, 300, 100));
  b.hazards.push(createSpike(b, b.platforms[0], 0.5));
  b.zones.push(createWind(b, -3000, 0, 100, 100, { vx: 50 }));
  assert.equal(sig(draw(a)), sig(draw(b)));
});

test('Debug: Hitboxen und IDs der Plattformen, nur wenn view.debug gesetzt ist', () => {
  const s = blank();
  const g = ground(s);
  const f = floater(s, 200, 250);
  const far = floater(s, 5000, 250);
  const gone = createBreakablePlatform(s, 400, 250, 100);
  gone.state = 'broken';
  s.platforms.push(gone);
  const plain = draw(s);
  assert.equal(named(plain, 'strokeRect').length, 0);
  assert.equal(named(plain, 'fillText').length, 0);
  const dbg = draw(s, { debug: true });
  const texts = named(dbg, 'fillText').map((c) => c[1]);
  assert.ok(texts.includes(`#${g.id}`) && texts.includes(`#${f.id}`));
  assert.ok(!texts.includes(`#${far.id}`), 'weit entfernte Plattform ohne Debug Anzeige');
  assert.ok(!texts.includes(`#${gone.id}`), 'gebrochene Plattform ohne Debug Anzeige');
  assert.ok(named(dbg, 'strokeRect').some((c) => c[1] === f.x + 0.5 && c[2] === f.y + 0.5 && c[3] === f.w - 1));

  const z = blank();
  const col = bolt('idle').hazards[0];
  z.hazards.push(col);
  const hb = lightningColumn(col);
  assert.ok(named(draw(z, { debug: true }), 'strokeRect').some((c) => c[1] === hb.x + 0.5 && c[2] === hb.y + 0.5 && c[3] === hb.w - 1 && c[4] === hb.h - 1));
});

// ---------- reduceMotion ----------

test('reduceMotion: ruhige Szene ändert sich mit der Zeit nicht mehr', () => {
  const s = blank();
  ground(s);
  floater(s, 150, 250);
  const m = createMovingPlatform(s, 300, 200, 100, { ax: 40, ay: 0 });
  s.platforms.push(m);
  const b = createBreakablePlatform(s, 450, 220, 100);
  b.state = 'shaking';
  b.timer = 0.6;
  b.shakeX = 2;
  b.alpha = 0.7;
  s.platforms.push(b);
  s.hazards.push(createSpike(s, s.platforms[0], 0.3));
  const l = createLightning(s, 560);
  l.phase = 'flicker';
  l.charge = 0.9;
  s.hazards.push(l);
  for (const bonus of ['normal', 'risk', 'event']) s.stars.push(createStar(s, 150 + s.stars.length * 40, 300, { bonus }));
  s.powerups.push(createPowerup(s, 'feather', 700, 250));
  const set = (o) => new Set([0.2, 1.7, 3.1, 9.9, 20.5].map((time) => sig(draw(s, { time, ...o }))));
  assert.ok(set({}).size > 1, 'ohne reduceMotion bewegt sich etwas');
  assert.equal(set({ reduceMotion: true }).size, 1, 'mit reduceMotion steht alles ruhig');

  // Wetter und Tor bewegen sich weiter, aber langsamer
  const w = blank();
  w.zones.push(createWind(w, 100, 100, 200, 200, { vx: 100 }));
  const at = (time, o) => windStreaks(draw(w, { time, ...o }))[0].head.x;
  const fast = Math.abs(at(1.0, {}) - at(1.05, {}));
  const slow = Math.abs(at(1.0, { reduceMotion: true }) - at(1.05, { reduceMotion: true }));
  assert.ok(slow < fast, 'Wind langsamer bei reduceMotion');
});

// ---------- Robustheit ----------

test('kaputte Objekte (NaN, Infinity, fehlende Felder) werden übersprungen', () => {
  const s = blank();
  ground(s);
  const bad = { id: 900, kind: 'static', x: NaN, y: 300, w: 100, h: 16 };
  s.platforms.push(bad, { id: 901, kind: 'static', x: 100, y: Infinity, w: 100, h: 16 }, { id: 902, kind: 'moving', x: 100, y: 200, w: -5 });
  s.platforms.push({ id: 903, kind: 'static', x: 100, y: 200, w: 1e12, h: 16 });
  s.platforms.push(null, undefined, {});
  s.stars.push({ id: 904, kind: 'star', x: NaN, y: 100 }, { id: 905, kind: 'star', x: 100, y: undefined }, null);
  s.powerups.push({ id: 906, kind: 'powerup', type: 'shield', x: Infinity, y: 100 }, null);
  s.hazards.push({ id: 907, kind: 'spike', x: NaN, y: 100, w: 36, h: 28 }, { id: 908, kind: 'lightning', x: 300 }, null, { kind: 'unbekannt', x: 100 });
  s.zones.push({ id: 909, kind: 'wind', x: 100, y: 100, w: NaN, h: 50, vx: 5, ay: 0 }, { id: 910, kind: 'rain', x: 100, y: NaN, w: 100 }, null);
  s.gates.push({ id: 911, kind: 'gate', x: NaN, y: 300 }, null);
  let ctx;
  assert.doesNotThrow(() => { ctx = draw(s); });
  assert.equal(allArgsFinite(ctx), true);
  // Der Blitz ohne Phase und Wolke ohne Felder wird mit Standardwerten gezeichnet
  assert.ok(shapes(ctx).length > 0);
  // Gleiche Szene mit sauberen Zahlen im Debug Modus
  assert.doesNotThrow(() => draw(s, { debug: true }));
  assert.doesNotThrow(() => draw(s, { camX: NaN, time: NaN }));
  assert.doesNotThrow(() => draw(s, { camX: Infinity }));
});

// ---------- Aufwand ----------

// Alle Listen an ihrer Grenze, verteilt wie im Spiel über rund 2300 px (von 320 hinter der Kamera bis 1600 davor)
function fullWorld(spread) {
  const s = blank();
  const at = (i, n) => -320 + (spread * i) / n;
  for (let i = 0; i < LIMITS.MAX_PLATFORMS; i++) {
    const x = at(i, LIMITS.MAX_PLATFORMS);
    const y = 150 + ((i * 37) % 200);
    if (i % 5 === 0) s.platforms.push(createStaticPlatform(s, x, 330, 260, { ground: true }));
    else if (i % 5 === 1) s.platforms.push(createMovingPlatform(s, x + 40, y, 100, { ax: i % 2 ? 40 : 0, ay: i % 2 ? 0 : 30 }));
    else if (i % 5 === 2) {
      const p = createBreakablePlatform(s, x, y, 100);
      p.state = ['idle', 'armed', 'shaking'][i % 3];
      p.timer = 0.6;
      p.alpha = 0.8;
      s.platforms.push(p);
    } else s.platforms.push(createStaticPlatform(s, x, y, 120));
  }
  const bonus = ['normal', 'risk', 'event'];
  for (let i = 0; i < LIMITS.MAX_STARS; i++) s.stars.push(createStar(s, at(i, LIMITS.MAX_STARS), 60 + ((i * 53) % 280), { bonus: bonus[i % 3], falling: i % 7 === 0 }));
  const phases = ['idle', 'glow', 'flicker', 'strike', 'cooldown'];
  for (let i = 0; i < LIMITS.MAX_HAZARDS; i++) {
    const x = at(i, LIMITS.MAX_HAZARDS);
    if (i % 2) {
      const l = createLightning(s, x);
      l.phase = phases[i % 5];
      l.charge = 0.9;
      l.timer = 0.4;
      s.hazards.push(l);
    } else s.hazards.push(createSpike(s, s.platforms[(i * 3) % s.platforms.length], 0.5));
  }
  for (let i = 0; i < 5; i++) {
    const x = at(i, 5);
    if (i % 2) {
      const r = createRain(s, x, 300);
      r.active = true;
      r.intensity = 1;
      s.zones.push(r);
    } else s.zones.push(createWind(s, x, 100, 220, 220, { vx: 100, ay: i % 4 ? 0 : -300 }));
  }
  ['shield', 'dash', 'magnet', 'feather'].forEach((t, i) => s.powerups.push(createPowerup(s, t, at(i, 4), 200)));
  s.gates.push(createGate(s, at(1, 3), 360, 1));
  s.gates.push(createGate(s, at(2, 3), 360, 2));
  return s;
}

test('voller Spielzustand (alle Listen an der Grenze) bleibt unter 2500 Zeichenaufrufen', () => {
  let worst = 0;
  for (const camX of [0, 150, 400, 900, 1400]) {
    for (const debug of [false, true]) {
      const ctx = draw(fullWorld(2300), { camX, debug });
      worst = Math.max(worst, ops(ctx).length);
      assert.ok(ops(ctx).length < 2500, `${ops(ctx).length} Aufrufe bei camX ${camX}`);
      assert.ok(ctx.stats.gradients <= 30, `${ctx.stats.gradients} Verläufe`);
      assert.equal(allArgsFinite(ctx), true);
    }
  }
  assert.ok(worst > 300, 'der Test zeichnet wirklich etwas');
});

test('alles auf einmal im Bild: Detailstufen halten den Aufwand begrenzt', () => {
  const s = fullWorld(800);
  const ctx = draw(s);
  const n = ops(ctx).length;
  assert.ok(n < 4000, `${n} Aufrufe`);
  assert.ok(ctx.stats.gradients <= 40, `${ctx.stats.gradients} Verläufe`);
  // Ohne Detailstufen wäre es viel mehr: jedes Objekt einzeln gezeichnet ergibt deutlich mehr als im vollen Bild
  let sum = 0;
  for (const key of ['platforms', 'stars', 'hazards', 'zones', 'powerups', 'gates']) {
    for (const o of s[key]) {
      const single = blank();
      single[key] = [o];
      if (key === 'hazards' && o.kind === 'spike') single.platforms = s.platforms.filter((p) => p.id === o.hostId);
      sum += ops(draw(single)).length;
    }
  }
  assert.ok(n < sum * 0.75, `volles Bild ${n}, Summe der Einzelbilder ${sum}`);
  // Grundformen bleiben erhalten: alle Sterne und Plattformen werden weiter gezeichnet
  assert.ok(named(ctx, 'closePath').length >= s.stars.length);
});

test('echte Spielwelten aus dem Generator: kein Fehler, endliche Werte, unter 2500 Aufrufen', () => {
  let drawn = 0;
  for (const seed of [1, 2, 3]) {
    const s = newGame(seed);
    for (let x = 0; x < 60000; x += 400) {
      s.camX = x;
      s.player.x = x + 200;
      s.t = x / 300;
      ensureAhead(s);
      cleanup(s);
      if (x % 2000 !== 0) continue;
      const blend = (x / 2000) % 3 === 0 ? 0.5 : 1;
      s.world = { index: (x / 2000) % 4, from: (x / 2000) % 4, to: ((x / 2000) + 1) % 4, blend, gatesPassed: 0 };
      for (const o of [{}, { debug: true }, { reduceMotion: true }]) {
        const ctx = draw(s, { camX: x, time: x / 97, ...o });
        assert.ok(ops(ctx).length < 2500, `seed ${seed} x ${x}: ${ops(ctx).length} Aufrufe`);
        assert.equal(allArgsFinite(ctx), true);
        drawn += shapes(ctx).length > 0 ? 1 : 0;
      }
    }
  }
  assert.ok(drawn > 50, 'die meisten Frames zeigen etwas');
});

test('keine Gedankenstriche in den Texten der Datei', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../game/render/world.js', import.meta.url), 'utf8');
  assert.ok(!src.includes(String.fromCharCode(0x2013)) && !src.includes(String.fromCharCode(0x2014)));
});
