// Tests für game/render/screenfx.js ohne Browser.
// Der strenge Kontext verhält sich wie ein echter Canvas: er kennt nur echte Methoden und Eigenschaften,
// wirft bei unmöglichen Argumenten (NaN, negative Radien), prüft save und restore und merkt sich Verläufe samt Farbstopps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { H, W } from '../game/constants.js';
import { createState } from '../game/state.js';
import { createGate, createStaticPlatform } from '../game/entities.js';
import { drawScreenFx } from '../game/render/screenfx.js';
import { startEvent } from '../game/events.js';
import { input, newGame, run } from './helpers.mjs';

const METHODS = new Set([
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
  'createLinearGradient', 'createRadialGradient', 'createConicGradient', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip',
  'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'measureText', 'setLineDash', 'getLineDash', 'getTransform',
]);
const PROPS = new Set([
  'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha', 'globalCompositeOperation',
  'lineDashOffset', 'font', 'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter',
]);
const NUMERIC = new Set([
  'scale', 'rotate', 'translate', 'transform', 'setTransform', 'createLinearGradient', 'createRadialGradient', 'createConicGradient',
  'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'clearRect',
]);
const COMPOSITES = new Set(['source-over', 'lighter', 'destination-out', 'multiply', 'screen']);
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const RGBA = /^rgba?\(\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*(,\s*\d*\.?\d+\s*)?\)$/;

const checkColor = (c, where) => assert.ok(typeof c === 'string' && (HEX.test(c) || RGBA.test(c)), `${where}: ungültige Farbe ${String(c)}`);

function strictCtx() {
  const log = [];
  const grads = []; // { kind, args, stops: [[offset, color]] }
  const fills = []; // bei jedem Füllen oder Zeichnen: { op, alpha, style, comp }
  const props = { globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, fillStyle: '#000000', strokeStyle: '#000000', lineCap: 'butt', lineJoin: 'miter', lineDashOffset: 0 };
  const stack = [];
  const gradient = (kind, args) => {
    const g = { isGradient: true, kind, args, stops: [] };
    g.addColorStop = (offset, color) => {
      assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1, `Farbstopp ${offset}`);
      checkColor(color, 'Farbstopp');
      g.stops.push([offset, color]);
    };
    grads.push(g);
    return g;
  };
  const method = (name) => (...args) => {
    if (NUMERIC.has(name)) {
      args.forEach((a, i) => {
        if (typeof a === 'boolean') return;
        assert.ok(typeof a === 'number' && Number.isFinite(a), `${name}: Argument ${i} ist ${a}`);
      });
    }
    if (name === 'arc') assert.ok(args[2] >= 0, `arc mit Radius ${args[2]}`);
    if (name === 'ellipse') assert.ok(args[2] >= 0 && args[3] >= 0, `ellipse mit Radius ${args[2]}, ${args[3]}`);
    if (name === 'createRadialGradient') assert.ok(args[2] >= 0 && args[5] >= 0, 'Verlauf mit negativem Radius');
    if (name !== 'getTransform') log.push([name, ...args]);
    if (name === 'save') stack.push({ ...props });
    else if (name === 'restore') {
      assert.ok(stack.length > 0, 'restore ohne save');
      Object.assign(props, stack.pop());
    } else if (name === 'fill' || name === 'stroke' || name === 'fillRect' || name === 'strokeRect') {
      fills.push({ op: name, alpha: props.globalAlpha, style: name === 'stroke' || name === 'strokeRect' ? props.strokeStyle : props.fillStyle, comp: props.globalCompositeOperation, width: props.lineWidth });
    }
    if (name === 'createLinearGradient') return gradient('linear', args);
    if (name === 'createRadialGradient') return gradient('radial', args);
    if (name === 'createConicGradient') return gradient('conic', args);
    if (name === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (name === 'measureText') return { width: 10 };
    if (name === 'getLineDash') return [];
    return undefined;
  };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (typeof k === 'symbol') return undefined;
      if (METHODS.has(k)) return method(k);
      if (PROPS.has(k)) return props[k];
      throw new Error(`Der Kontext hat keine Eigenschaft ${k}`);
    },
    set(_, k, v) {
      assert.ok(PROPS.has(k), `Der Kontext hat keine Eigenschaft ${String(k)}`);
      if (k === 'globalAlpha') assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `globalAlpha ${v}`);
      if (k === 'lineWidth') assert.ok(Number.isFinite(v) && v > 0, `lineWidth ${v}`);
      if (k === 'fillStyle' || k === 'strokeStyle') assert.ok(typeof v === 'object' && v ? v.isGradient : typeof v === 'string' && !/NaN|undefined|Infinity/.test(v), `${k} ${String(v)}`);
      if (k === 'globalCompositeOperation') assert.ok(COMPOSITES.has(v), `Mischung ${v}`);
      props[k] = v;
      log.push([`=${k}`, typeof v === 'object' ? '<Verlauf>' : v]);
      return true;
    },
  });
  return { ctx, log, props, stack, grads, fills };
}

const count = (log, name) => log.filter((c) => c[0] === name).length;
const calls = (log) => log.filter((c) => !c[0].startsWith('=')).length;

// ---------- Szenen ----------

function scene(mod = () => {}) {
  const s = createState({ seed: 4 });
  s.camX = 1000;
  s.platforms.push(createStaticPlatform(s, 600, 340, 1800, { ground: true }));
  const p = s.player;
  p.x = 1300;
  p.y = 340 - p.h;
  p.onGround = true;
  mod(s, p);
  return s;
}
const viewOf = (s, o = {}) => ({ W, H, camX: s.camX, time: 3, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });
const ui = { state: 'playing', time: 3, debug: false };

function draw(s, o = {}) {
  const c = strictCtx();
  drawScreenFx(c.ctx, s, ui, viewOf(s, o));
  assert.equal(c.stack.length, 0, 'save und restore sind nicht ausgeglichen');
  return c;
}

// Stärke des Randverlaufs: Alpha des letzten Farbstopps (außen)
const edgeAlpha = (g) => +g.stops[g.stops.length - 1][1].match(/,([\d.]+)\)$/)[1];
const rgbOf = (g) => g.stops[g.stops.length - 1][1].match(/^rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number);

const slammed = (k = 1) => (s, p) => {
  p.onGround = false;
  p.y = 300;
  p.vy = -320 * k;
  p.squashX = 1 + 0.25 * k;
  p.squashY = 1 - 0.25 * k;
};
const gatePassed = (blend, index = 1, dx = 250) => (s) => {
  const g = createGate(s, s.camX + dx, 340, index);
  g.passed = true;
  g.anim = 2;
  s.gates.push(g);
  s.world.blend = blend;
};

// ---------- Tests ----------

test('ein ruhiger Zustand zeichnet nichts außer dem Rahmen', () => {
  const c = draw(scene());
  assert.ok(calls(c.log) <= 2, `${calls(c.log)} Aufrufe`);
  assert.equal(c.grads.length, 0);
});

test('fehlende Argumente und kaputte Zustände werfen nie', () => {
  const s = scene();
  assert.doesNotThrow(() => drawScreenFx(null, s, ui, viewOf(s)));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, null, ui, viewOf(s)));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, s, ui, null));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, s, undefined, viewOf(s)));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, s, null, { time: 1 }));
  assert.doesNotThrow(() => drawScreenFx(createMockCtx(), s, ui, viewOf(s)));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, { player: null }, ui, { W, H, camX: 0, time: 0 }));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, {}, ui, viewOf(s)));
  assert.doesNotThrow(() => drawScreenFx(strictCtx().ctx, { lives: 1 }, ui, viewOf(s)));
});

test('Herzschlag Vignette nur bei einem Leben, rot, mit zwei Schlägen pro Takt', () => {
  const at = (lives, o, mod) => draw(scene((s, p) => { s.lives = lives; if (mod) mod(s, p); }), o);
  for (const lives of [0.5, 2, 3, 5]) assert.equal(at(lives).grads.length, 0, `lives ${lives}`);
  const c = at(1);
  assert.equal(c.grads.length, 1);
  assert.equal(c.grads[0].kind, 'radial');
  assert.equal(count(c.log, 'fillRect'), 1);
  const f = c.fills[0];
  assert.equal(f.op, 'fillRect');
  assert.deepEqual(c.log.find((x) => x[0] === 'fillRect').slice(1), [0, 0, W, H], 'über das ganze Bild');
  const [r, g, b] = rgbOf(c.grads[0]);
  assert.ok(r > 200 && g < 90 && b < 140, `rot: ${r},${g},${b}`);
  assert.equal(c.grads[0].stops[0][1].match(/,([\d.]+)\)$/)[1], '0', 'innen durchsichtig');
  // Takt: zwei Maxima pro Herzschlag (dumpf, dumpf), dazwischen Ruhe
  const alpha = (time) => edgeAlpha(at(1, { time }).grads[0]);
  const series = [];
  for (let t = 0; t < 0.95; t += 0.01) series.push(alpha(t));
  let peaks = 0;
  for (let i = 1; i < series.length - 1; i++) if (series[i] > series[i - 1] && series[i] >= series[i + 1] && series[i] > 0.2) peaks++;
  assert.equal(peaks, 2, `zwei Schläge, Verlauf: ${series.map((v) => v.toFixed(2)).join(' ')}`);
  assert.ok(Math.max(...series) <= 0.3, 'dezent');
  assert.ok(Math.min(...series) >= 0.1 && Math.min(...series) < 0.14, 'zwischen den Schlägen ein dünner Rand');
  assert.ok(Math.abs(alpha(0.3) - alpha(0.3 + 0.95)) < 1e-9, 'wiederholt sich im Takt');
  // Zustände ohne Vignette
  assert.equal(at(1, {}, (s) => { s.mode = 'over'; }).grads.length, 0);
  assert.equal(at(1, {}, (s, p) => { p.dead = true; }).grads.length, 0);
  assert.equal(at(1, {}, (s) => { s.mode = 'dying'; }).grads.length, 1, 'beim Sterben mit einem Leben bleibt der Rand');
});

test('reduceMotion: die Herzschlag Vignette bleibt, aber ohne Puls', () => {
  const alpha = (time) => edgeAlpha(draw(scene((s) => { s.lives = 1; }), { time, reduceMotion: true }).grads[0]);
  const seen = new Set();
  for (let t = 0; t < 2; t += 0.07) seen.add(alpha(t));
  assert.equal(seen.size, 1, 'immer gleich');
  const peak = Math.max(...Array.from({ length: 100 }, (_, i) => edgeAlpha(draw(scene((s) => { s.lives = 1; }), { time: i * 0.0095 }).grads[0])));
  assert.ok([...seen][0] < peak && [...seen][0] > 0.1, 'ruhiger als der Höhepunkt des Pulses');
  // Radius ändert sich nicht
  const inner = (time) => draw(scene((s) => { s.lives = 1; }), { time, reduceMotion: true }).grads[0].args[2];
  assert.equal(inner(0.05), inner(0.6));
});

test('Geschwindigkeitslinien im Dash gegen die Flugrichtung, Nimbus bleibt frei', () => {
  const dash = (dir, o = {}, mod) => draw(scene((s, p) => { p.dash.t = 0.1; p.dash.dir = dir; if (mod) mod(s, p); }), o);
  const none = draw(scene((s, p) => { p.dash.t = 0; }));
  assert.equal(calls(none.log), 2);
  for (const dir of [1, -1]) {
    const c = dash(dir);
    const strokes = c.fills.filter((f) => f.op === 'stroke');
    assert.equal(strokes.length, 2, 'zwei Stärken, weiß');
    assert.ok(strokes.every((f) => f.style === '#ffffff' && f.alpha > 0.1 && f.alpha <= 0.4), 'dezent');
    const pairs = [];
    c.log.forEach((x, i) => { if (x[0] === 'lineTo' && c.log[i - 1][0] === 'moveTo') pairs.push([c.log[i - 1], x]); });
    assert.ok(pairs.length >= 8 && pairs.length <= 14, `${pairs.length} Linien`);
    for (const [a, b] of pairs) {
      assert.equal(b[2], a[2], 'waagerecht');
      assert.ok((a[1] - b[1]) * dir > 80 && (a[1] - b[1]) * dir < 270, 'Linie zieht sich gegen die Flugrichtung nach hinten');
    }
    // Der Streifen auf Höhe von Nimbus bleibt frei
    const s = scene();
    const py = s.player.y + s.player.h / 2;
    assert.ok(pairs.every(([a]) => Math.abs(a[2] - py) >= 30), 'keine Linie über Nimbus');
  }
  // Regenbogen: sechs Farben
  const r = dash(1, {}, (s, p) => { p.dash.rainbow = true; });
  const colors = new Set(r.fills.filter((f) => f.op === 'stroke').map((f) => f.style));
  assert.equal(colors.size, 6);
  // Linien bewegen sich mit der Zeit, gleiche Zeit gleiches Bild
  assert.notDeepEqual(dash(1, { time: 1 }).log, dash(1, { time: 1.2 }).log);
  assert.deepEqual(dash(1, { time: 1 }).log, dash(1, { time: 1 }).log);
  // Blendet am Ende des Dashes aus
  const strong = (t) => Math.max(...dash(1, {}, (s, p) => { p.dash.t = t; }).fills.filter((f) => f.op === 'stroke').map((f) => f.alpha));
  assert.ok(strong(0.1) > strong(0.02) && strong(0.02) > 0);
  // Tot: keine Linien
  assert.equal(calls(dash(1, {}, (s, p) => { p.dead = true; }).log), 2);
  // Bei reduceMotion gar keine Linien
  assert.equal(calls(dash(1, { reduceMotion: true }).log), 2);
});

test('Wellenring beim Traumtor: wächst, blendet aus und liegt auf dem Tor', () => {
  const wave = (blend, o, mod = gatePassed(blend)) => draw(scene(mod), o);
  const arcs = (c) => c.log.filter((x) => x[0] === 'arc');
  assert.equal(arcs(wave(1)).length, 0, 'nach drei Sekunden vorbei');
  assert.equal(arcs(wave(0.5)).length, 0, 'schon nach 1,5 Sekunden vorbei');
  const early = arcs(wave(0.04));
  assert.ok(early.length >= 1 && early.length <= 2);
  const g = scene(gatePassed(0.04)).gates[0];
  for (const a of early) {
    assert.ok(Math.abs(a[1] - (g.x - 1000)) < 1e-9, 'Mitte über dem Tor');
    assert.ok(Math.abs(a[2] - (g.y - g.h / 2)) < 1e-9);
  }
  // Der Radius wächst, die Deckkraft sinkt
  const radius = (blend) => Math.max(...arcs(wave(blend)).map((a) => a[3]));
  assert.ok(radius(0.04) < radius(0.1) && radius(0.1) < radius(0.25), 'wächst');
  assert.ok(radius(0.04) >= 26 && radius(0.25) <= 400);
  const alpha = (blend) => Math.max(...wave(blend).fills.filter((f) => f.op === 'stroke').map((f) => f.alpha));
  assert.ok(alpha(0.04) > alpha(0.15) && alpha(0.15) > alpha(0.3), 'blendet aus');
  assert.ok(alpha(0.04) <= 0.62 + 1e-9, 'dezent');
  // Zwei Ringe, der zweite folgt später
  assert.equal(arcs(wave(0.1)).length, 2);
  assert.equal(arcs(wave(0.01)).length, 1, 'der zweite startet erst nach 0,14 s');
  // Der Ring bleibt am Tor, wenn die Kamera weiterläuft
  const moved = scene(gatePassed(0.1));
  moved.camX += 80;
  assert.ok(Math.abs(arcs(draw(moved).log.length ? draw(moved) : draw(moved))[0][1] - (g.x - 1080)) < 1e-9);
  // Noch nicht durchquert: kein Ring
  assert.equal(arcs(draw(scene((s) => { gatePassed(0.1)(s); s.gates[0].passed = false; }))).length, 0);
  // Mehrere Tore: der Ring gehört zum zuletzt durchquerten
  const two = draw(scene((s) => { gatePassed(0.1, 1, 150)(s); gatePassed(0.1, 2, 350)(s); }));
  assert.ok(arcs(two).every((a) => Math.abs(a[1] - 350) < 1e-9));
  // Weit außerhalb des Bildes nichts
  assert.equal(arcs(draw(scene(gatePassed(0.1, 1, 2500)))).length, 0);
  assert.equal(arcs(draw(scene(gatePassed(0.1, 1, -2500)))).length, 0);
  // reduceMotion: kein Ring
  assert.equal(arcs(wave(0.1, { reduceMotion: true })).length, 0);
});

test('Stampf Blitz: nur direkt nach dem Sturzflug, am Boden zentriert, dezent', () => {
  const flash = (mod, o) => draw(scene(mod), o);
  assert.equal(flash(slammed(0)).grads.length, 0, 'ohne Rückprall nichts');
  const c = flash(slammed(1));
  assert.equal(c.grads.length, 1);
  assert.equal(c.grads[0].kind, 'radial');
  assert.equal(count(c.log, 'fillRect'), 2, 'ein Hauch über dem Bild, dazu ein heller Fleck');
  const s = scene(slammed(1));
  assert.ok(Math.abs(c.grads[0].args[0] - (s.player.x + s.player.w / 2 - s.camX)) < 1e-9, 'Fleck an den Füßen');
  assert.ok(Math.abs(c.grads[0].args[1] - (s.player.y + s.player.h)) < 1e-9);
  assert.ok(c.fills.every((f) => f.alpha <= 0.5 + 1e-9), 'dezent');
  assert.ok(c.fills.every((f) => f.style === '#ffffff' || f.style.isGradient));
  // klingt ab, wenn die Stauchung nachlässt
  const power = (k) => Math.max(0, ...flash(slammed(k)).fills.map((f) => f.alpha));
  assert.ok(power(1) > power(0.6) && power(0.6) > power(0.3), `${power(0.3)} ${power(0.6)} ${power(1)}`);
  assert.equal(power(0.1), 0);
  // Nicht bei anderen Zuständen
  assert.equal(flash((s2, p) => { slammed(1)(s2, p); p.onGround = true; }).grads.length, 0, 'am Boden');
  assert.equal(flash((s2, p) => { slammed(1)(s2, p); p.slam.active = true; }).grads.length, 0, 'im Sturzflug selbst');
  assert.equal(flash((s2, p) => { slammed(1)(s2, p); p.dead = true; }).grads.length, 0, 'tot');
  assert.equal(flash((s2, p) => { slammed(1)(s2, p); p.vy = 300; }).grads.length, 0, 'fällt wieder');
  assert.equal(flash((s2, p) => { slammed(1)(s2, p); p.squashX = 0.85; }).grads.length, 0, 'ein Sprung streckt statt zu stauchen');
  assert.equal(flash(slammed(1), { reduceMotion: true }).grads.length, 0, 'bei reduceMotion kein Blitz');
});

test('der Stampf Blitz folgt dem echten Spiel: Sturzflug, Aufprall, Nachklang', () => {
  const s = newGame(5);
  run(s, 60, () => input({ move: 1 }));
  // hoch springen, dann stampfen
  s.player.onGround = false;
  s.player.y = 120;
  s.player.vy = 0;
  s.player.groundId = 0;
  let sawSlam = false;
  let flashFrames = 0;
  let anyBefore = 0;
  for (let i = 0; i < 120; i++) {
    run(s, 1, () => input({ slamPressed: i === 2 }));
    const c = draw(s);
    if (s.player.slam.active) {
      sawSlam = true;
      anyBefore += c.grads.length;
    } else if (sawSlam && c.grads.length) flashFrames++;
  }
  assert.ok(sawSlam, 'der Sturzflug hat stattgefunden');
  assert.equal(anyBefore, 0, 'im Flug kein Blitz');
  assert.ok(flashFrames >= 1 && flashFrames <= 12, `Blitz an ${flashFrames} Bildern`);
});

test('Combo Leuchten ab x3, wärmer und stärker mit höherer Combo, mit dem Timer ausblendend', () => {
  const glow = (count, timer = 2, o) => draw(scene((s) => { s.combo.count = count; s.combo.timer = timer; }), o);
  for (const n of [0, 1, 2, NaN, -3]) assert.equal(glow(n).grads.length, 0, `count ${n}`);
  const c = glow(3);
  assert.equal(c.grads.length, 1);
  const [r, g, b] = rgbOf(c.grads[0]);
  assert.ok(r > 230 && g > 120 && g < 200 && b < 120, `warm: ${r},${g},${b}`);
  assert.equal(count(c.log, 'fillRect'), 1);
  assert.ok(c.log.some((x) => x[0] === '=globalCompositeOperation' && x[1] === 'screen'), 'hellt auf statt zu vergrauen');
  assert.equal(c.props.globalCompositeOperation, 'source-over', 'Mischung zurückgesetzt');
  const a = (n, t, o) => edgeAlpha(glow(n, t, o).grads[0]);
  assert.ok(a(3) < a(5) && a(5) < a(8), `${a(3)} ${a(5)} ${a(8)}`);
  assert.equal(a(8), a(30), 'oben begrenzt');
  assert.ok(a(8) <= 0.4, 'dezent');
  assert.ok(a(5, 0.2) < a(5, 2) && a(5, 0.2) > 0, 'blendet mit dem Timer aus');
  assert.ok(a(5, 0.6) === a(5, 2) || Math.abs(a(5, 0.6) - a(5, 2)) < 1e-9, 'erst die letzten 0,6 s');
  // Pulsiert leicht, bei reduceMotion nicht und nur halb so stark
  assert.notEqual(a(5, 2, { time: 1 }), a(5, 2, { time: 1.4 }));
  assert.equal(a(5, 2, { time: 1, reduceMotion: true }), a(5, 2, { time: 1.4, reduceMotion: true }));
  assert.ok(a(5, 2, { reduceMotion: true }) < a(5, 2) * 0.6);
  // Kaputte Combo
  assert.equal(calls(draw(scene((s) => { s.combo = null; })).log), 2);
  assert.equal(calls(draw(scene((s) => { s.combo = 7; })).log), 2);
  assert.equal(calls(draw(scene((s) => { s.combo = { count: 5 }; })).log) > 2, true, 'ohne Timer volle Stärke');
});

test('Randverdunklung beim Gleiten: dunkelblau, wächst mit der Gleitzeit', () => {
  const shade = (mod, o) => draw(scene((s, p) => { p.onGround = false; p.y = 220; p.glide = true; p.glideT = 0.5; if (mod) mod(s, p); }), o);
  const c = shade();
  assert.equal(c.grads.length, 1);
  const [r, g, b] = rgbOf(c.grads[0]);
  assert.ok(r < 40 && g < 40 && b < 90, `dunkel: ${r},${g},${b}`);
  const a = (t, o) => edgeAlpha(shade((s, p) => { p.glideT = t; }, o).grads[0]);
  assert.ok(a(0.01) < a(0.1) && a(0.1) < a(0.5), `${a(0.01)} ${a(0.1)} ${a(0.5)}`);
  assert.equal(a(0.5), a(1.2), 'oben begrenzt');
  assert.ok(a(0.5) <= 0.3 + 1e-9, 'leicht');
  assert.ok(a(0.5, { reduceMotion: true }) < a(0.5), 'bei reduceMotion schwächer');
  assert.equal(a(0.5, { time: 1 }), a(0.5, { time: 2 }), 'kein Puls');
  assert.equal(shade((s, p) => { p.glide = false; }).grads.length, 0);
  assert.equal(shade((s, p) => { p.dead = true; }).grads.length, 0);
  assert.equal(shade((s, p) => { p.glideT = NaN; }).grads.length, 1, 'kaputte Zeit zählt als null');
});

test('Dream Events färben das Bild sanft: je Typ eine eigene Farbe, die Hüllkurve bestimmt die Stärke', () => {
  const tint = (type, t, o) => draw(scene((s) => { s.events.active = { type, t, dur: 12, data: {} }; }), o);
  const colors = new Set();
  for (const type of ['meteor', 'supermoon', 'storm', 'shower']) {
    const c = tint(type, 6);
    assert.equal(c.grads.length, 1, type);
    assert.equal(c.grads[0].kind, 'linear');
    assert.equal(count(c.log, 'fillRect'), 1);
    colors.add(rgbOfLinear(c.grads[0]).join(','));
    // Oben stärker als unten
    assert.ok(alphaAt(c.grads[0], 0) > alphaAt(c.grads[0], 1), `${type}: oben stärker`);
    assert.ok(alphaAt(c.grads[0], 0) <= 0.25, `${type}: dezent`);
  }
  assert.equal(colors.size, 4, 'jede Art hat ihre Farbe');
  // Einblenden und Ausblenden folgen eventEnvelope (1,5 s)
  const a = (t, o) => alphaAt(tint('storm', t, o).grads[0], 0);
  assert.equal(tint('storm', 0).grads.length, 0, 'ganz am Anfang nichts');
  assert.ok(a(0.5) < a(1) && a(1) < a(1.5), 'blendet ein');
  assert.equal(a(1.5), a(6), 'volle Stärke in der Mitte');
  assert.equal(a(10.5), a(6), 'die Hüllkurve ist bis 1,5 s vor dem Ende voll');
  assert.ok(a(11.5) < a(11) && a(11) < a(10.5), 'blendet aus');
  assert.equal(tint('storm', 12).grads.length, 0, 'am Ende nichts');
  // Halbe Stärke bei reduceMotion
  assert.ok(Math.abs(a(6, { reduceMotion: true }) - a(6) / 2) < 0.005);
  // Unbekannte oder kaputte Ereignisse
  assert.equal(tint('unbekannt', 6).grads.length, 0);
  assert.equal(draw(scene((s) => { s.events.active = { type: 'storm', t: NaN, dur: NaN }; })).grads.length, 0);
  assert.equal(draw(scene((s) => { s.events = null; })).grads.length, 0);
  assert.equal(draw(scene((s) => { s.events.active = 5; })).grads.length, 0);
  // Mit dem echten Start eines Ereignisses
  const s = scene();
  startEvent(s, 'supermoon');
  s.events.active.t = 6;
  assert.equal(draw(s).grads.length, 1);
});
function rgbOfLinear(g) { return g.stops[0][1].match(/^rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number); }
function alphaAt(g, i) { return +g.stops[i][1].match(/,([\d.]+)\)$/)[1]; }

test('Reihenfolge: Tönung, Combo, Gleiten, Linien, Ring, Blitz, ganz oben die Herzschlag Vignette', () => {
  const s = scene((st, p) => {
    st.events.active = { type: 'storm', t: 6, dur: 12, data: {} };
    st.combo.count = 6;
    st.combo.timer = 2;
    p.glide = true;
    p.glideT = 0.5;
    p.onGround = false;
    p.y = 300;
    p.vy = -320;
    p.squashX = 1.25;
    p.dash.t = 0.1;
    st.lives = 1;
    gatePassed(0.08)(st);
  });
  const c = draw(s);
  assert.equal(c.grads.length, 5, 'Tönung, Combo, Gleiten, Blitz, Vignette');
  assert.deepEqual(c.grads.map((g) => g.kind), ['linear', 'radial', 'radial', 'radial', 'radial']);
  // Strichreihenfolge: erst Linien, dann der Ring
  const iLine = c.log.findIndex((x) => x[0] === 'lineTo');
  const iArc = c.log.findIndex((x) => x[0] === 'arc');
  const iLast = c.log.map((x) => x[0]).lastIndexOf('fillRect');
  assert.ok(iLine > 0 && iArc > iLine && iLast > iArc, 'Linien vor Ring vor den letzten Flächen');
  assert.ok(rgbOf(c.grads[4])[0] > 200, 'die Vignette ist rot und kommt zuletzt');
  assert.ok(calls(c.log) < 80, `${calls(c.log)} Aufrufe`);
  const mock = createMockCtx();
  drawScreenFx(mock, s, ui, viewOf(s));
  assert.ok(mock.calls.length < 80);
});

test('bei reduceMotion bleiben nur ruhige Flächen: keine Striche, keine Kreise, nichts pulsiert', () => {
  const mk = () => scene((st, p) => {
    st.events.active = { type: 'shower', t: 6, dur: 12, data: {} };
    st.combo.count = 6;
    st.combo.timer = 2;
    p.glide = true;
    p.glideT = 0.5;
    p.onGround = false;
    p.y = 300;
    p.vy = -320;
    p.squashX = 1.25;
    p.dash.t = 0.1;
    st.lives = 1;
    gatePassed(0.08)(st);
  });
  const calm = draw(mk(), { reduceMotion: true, time: 1 });
  assert.equal(count(calm.log, 'stroke'), 0);
  assert.equal(count(calm.log, 'arc'), 0);
  assert.equal(count(calm.log, 'lineTo'), 0);
  assert.ok(calm.fills.length >= 3 && calm.fills.every((f) => f.op === 'fillRect'));
  const normal = draw(mk(), { time: 1 });
  assert.ok(calls(calm.log) < calls(normal.log));
  // Zeit ändert nichts
  assert.deepEqual(draw(mk(), { reduceMotion: true, time: 1 }).log, draw(mk(), { reduceMotion: true, time: 77.7 }).log);
  // Kein Weißblitz, die Deckkraft aller Flächen ist begrenzt
  assert.ok(calm.fills.every((f) => f.alpha <= 1));
  assert.ok(calm.grads.every((g) => edgeAlpha(g) <= 0.3 || g.kind === 'linear'));
});

test('rein: verändert weder Zustand, UI noch View, ist deterministisch und nutzt weder Zufall noch Uhr', () => {
  const s = scene((st, p) => {
    st.events.active = { type: 'meteor', t: 5, dur: 12, data: { a: 1 } };
    st.combo.count = 5;
    st.combo.timer = 1;
    p.dash.t = 0.1;
    p.dash.rainbow = true;
    st.lives = 1;
    gatePassed(0.1)(st);
  });
  const u = { state: 'playing', time: 3, debug: false };
  const v = viewOf(s);
  const before = structuredClone([s, u, v]);
  const origRandom = Math.random;
  const origNow = Date.now;
  const origPerf = performance.now;
  Math.random = () => { throw new Error('Math.random im Rendern'); };
  Date.now = () => { throw new Error('Date.now im Rendern'); };
  performance.now = () => { throw new Error('performance.now im Rendern'); };
  let a;
  let b;
  try {
    const c1 = strictCtx();
    drawScreenFx(c1.ctx, s, u, v);
    const c2 = strictCtx();
    drawScreenFx(c2.ctx, s, u, v);
    a = c1.log;
    b = c2.log;
  } finally {
    Math.random = origRandom;
    Date.now = origNow;
    performance.now = origPerf;
  }
  assert.deepEqual([s, u, v], before);
  assert.deepEqual(a, b);
  assert.ok(a.length > 20);
});

test('der Kontext des Aufrufers bleibt unverändert', () => {
  const c = strictCtx();
  c.ctx.globalAlpha = 0.5;
  c.ctx.globalCompositeOperation = 'lighter';
  c.ctx.lineWidth = 3;
  c.ctx.lineCap = 'butt';
  c.ctx.fillStyle = '#123456';
  c.ctx.strokeStyle = '#654321';
  const s = scene((st, p) => {
    st.events.active = { type: 'storm', t: 6, dur: 12, data: {} };
    st.combo.count = 6;
    st.combo.timer = 2;
    p.dash.t = 0.1;
    p.glide = true;
    p.glideT = 0.4;
    st.lives = 1;
    gatePassed(0.1)(st);
  });
  drawScreenFx(c.ctx, s, ui, viewOf(s));
  assert.equal(c.stack.length, 0);
  assert.equal(c.props.globalAlpha, 0.5);
  assert.equal(c.props.globalCompositeOperation, 'lighter');
  assert.equal(c.props.lineWidth, 3);
  assert.equal(c.props.lineCap, 'butt');
  assert.equal(c.props.fillStyle, '#123456');
  assert.equal(c.props.strokeStyle, '#654321');
});

test('alle Effekte in vielen Zustandskombinationen: gültige Argumente, im Aufrufbudget', () => {
  let n = 0;
  let worst = 0;
  for (const lives of [1, 2, 3]) {
    for (const combo of [0, 3, 9]) {
      for (const dash of [0, 0.1]) {
        for (const rainbow of [false, true]) {
          for (const glide of [false, true]) {
            for (const slam of [false, true]) {
              for (const event of [null, 'meteor', 'supermoon', 'storm', 'shower']) {
                for (const blend of [1, 0.03, 0.2]) {
                  for (const reduceMotion of [false, true]) {
                    const s = scene((st, p) => {
                      st.lives = lives;
                      st.combo.count = combo;
                      st.combo.timer = combo ? 0.3 + (n % 3) : 0;
                      p.dash.t = dash;
                      p.dash.dir = n % 2 ? 1 : -1;
                      p.dash.rainbow = rainbow;
                      p.glide = glide;
                      p.glideT = glide ? (n % 4) * 0.3 : 0;
                      if (slam) slammed(0.5 + (n % 3) * 0.25)(st, p);
                      if (event) st.events.active = { type: event, t: (n % 12) + 0.2, dur: 12, data: {} };
                      gatePassed(blend, 1 + (n % 3), (n % 5) * 200 - 100)(st);
                      if (blend === 1) st.gates[0].passed = n % 2 === 0;
                    });
                    const c = draw(s, { reduceMotion, time: n * 0.137 });
                    worst = Math.max(worst, calls(c.log));
                    assert.ok(c.grads.length <= 5, `${c.grads.length} Verläufe`);
                    assert.equal(c.props.globalAlpha, 1, 'Deckkraft zurückgesetzt');
                    assert.equal(c.props.globalCompositeOperation, 'source-over');
                    n++;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n >= 3000);
  assert.ok(worst < 80, `schlimmster Fall ${worst} Aufrufe`);
});

test('Unsinn in Zustand und View wirft nie und erzeugt nur gültige Zeichenbefehle', () => {
  let seed = 4242;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', -1, 0, 1, 0.5, 1e9, -1e9, 7, true, {}, []];
  const pickJunk = () => junk[Math.floor(rnd() * junk.length)];
  const mess = (o, keys) => { if (o && typeof o === 'object') for (const k of keys) if (rnd() < 0.3) o[k] = pickJunk(); };
  for (let i = 0; i < 2500; i++) {
    const s = scene((st, p) => {
      st.lives = 1;
      st.combo.count = 6;
      st.combo.timer = 1;
      p.dash.t = 0.1;
      p.glide = true;
      p.glideT = 0.4;
      st.events.active = { type: 'storm', t: 5, dur: 12, data: {} };
      gatePassed(0.1)(st);
      slammed(1)(st, p);
    });
    mess(s, ['lives', 'mode', 'camX', 'combo', 'world', 'events', 'gates', 'player']);
    mess(s.player, ['x', 'y', 'w', 'h', 'vx', 'vy', 'squashX', 'squashY', 'glide', 'glideT', 'dead', 'onGround', 'dash', 'slam']);
    mess(s.player && s.player.dash, ['t', 'dir', 'rainbow']);
    mess(s.player && s.player.slam, ['active', 't']);
    mess(s.combo, ['count', 'timer']);
    mess(s.world, ['blend', 'index']);
    mess(s.events && s.events.active, ['type', 't', 'dur']);
    if (Array.isArray(s.gates)) for (const g of s.gates) mess(g, ['x', 'y', 'h', 'index', 'passed', 'anim']);
    const view = viewOf(s, { time: pickJunk() === 1 ? 0 : rnd() * 60, reduceMotion: rnd() < 0.5 });
    mess(view, ['W', 'H', 'camX', 'time']);
    const c = strictCtx();
    assert.doesNotThrow(() => drawScreenFx(c.ctx, s, ui, view));
    assert.equal(c.stack.length, 0);
  }
});

test('im echten Spiel: Zeichnen in jeder Phase eines Laufs mit allen Fähigkeiten bleibt gültig', () => {
  const s = newGame(8);
  let frames = 0;
  let sawCombo = 0;
  for (let chunk = 0; chunk < 40; chunk++) {
    run(s, 20, (st, i) => input({ move: 1, jumpPressed: i % 20 === 0, jumpHeld: i % 20 < 16, dashPressed: i === 7, slamPressed: chunk % 5 === 4 && i === 10, throwPressed: i === 2 }));
    if (chunk % 7 === 6) s.lives = 1;
    if (chunk % 9 === 8) s.combo.count = 5;
    const c = draw(s, { time: chunk * 0.41, reduceMotion: chunk % 4 === 0 });
    if (c.grads.length) sawCombo++;
    assert.ok(calls(c.log) < 80);
    frames++;
    if (s.mode === 'over') break;
  }
  assert.ok(frames >= 10);
  assert.ok(sawCombo >= 1, 'mindestens ein Effekt war zu sehen');
});
