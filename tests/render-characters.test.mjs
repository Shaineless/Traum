// Tests für game/render/characters.js ohne Browser.
// Der strenge Kontext verhält sich wie ein echter Canvas: er kennt nur echte Methoden und
// Eigenschaften, wirft bei unmöglichen Argumenten (negative Radien, NaN) und prüft save und restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { H, LIMITS, W } from '../game/constants.js';
import { createState } from '../game/state.js';
import { createCharger, createFlyer, createJumper, createStaticPlatform, createWalker } from '../game/entities.js';
import { drawCharacters } from '../game/render/characters.js';
import { PRESET_NAMES, emit } from '../game/particles.js';
import { input, newGame, run } from './helpers.mjs';

// ---------- strenger Kontext ----------

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

function checkColor(c, where) {
  assert.ok(typeof c === 'string' && (HEX.test(c) || RGBA.test(c)), `${where}: ungültige Farbe ${String(c)}`);
}

// without: Namen, die der "Browser" nicht kennt (ältere Browser)
function strictCtx({ without = [] } = {}) {
  const missing = new Set(without);
  const log = [];
  const alphas = []; // globalAlpha bei jedem Füllen oder Zeichnen
  const props = { globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, fillStyle: '#000000', strokeStyle: '#000000', lineCap: 'butt', lineJoin: 'miter', lineDashOffset: 0 };
  const stack = [];
  const stats = { gradients: 0, maxDepth: 0 };
  const gradient = () => ({
    isGradient: true,
    addColorStop(offset, color) {
      assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1, `Farbstopp ${offset}`);
      checkColor(color, 'Farbstopp');
    },
  });
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
    if (name === 'save') {
      stack.push({ ...props });
      stats.maxDepth = Math.max(stats.maxDepth, stack.length);
    } else if (name === 'restore') {
      assert.ok(stack.length > 0, 'restore ohne save');
      Object.assign(props, stack.pop());
    } else if (name === 'fill' || name === 'stroke' || name === 'fillRect' || name === 'strokeRect') {
      alphas.push(props.globalAlpha);
    }
    if (name === 'createLinearGradient' || name === 'createRadialGradient' || name === 'createConicGradient') {
      stats.gradients++;
      return gradient();
    }
    if (name === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (name === 'measureText') return { width: 10 };
    if (name === 'getLineDash') return [];
    return undefined;
  };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (typeof k === 'symbol') return undefined;
      if (METHODS.has(k)) return missing.has(k) ? undefined : method(k);
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
  return { ctx, log, props, stack, stats, alphas };
}

const count = (log, name) => log.filter((c) => c[0] === name).length;
const calls = (log) => log.filter((c) => !c[0].startsWith('=')).length;

// ---------- Szenen ----------

const KINDS = ['walker', 'jumper', 'flyer', 'charger'];

function makeEnemy(s, kind, i = 0) {
  const plat = s.platforms[0];
  let e;
  if (kind === 'walker') e = createWalker(s, plat, 0.2);
  else if (kind === 'jumper') e = createJumper(s, plat, 0.2);
  else if (kind === 'charger') e = createCharger(s, plat, 0.2);
  else e = createFlyer(s, s.camX + 150 + i * 90, 250);
  if (kind !== 'flyer') e.x = s.camX + 40 + i * 90;
  e.anim = 0.7 + i;
  return e;
}

// Zustand mit Plattform, Spieler mittig im Bild. cfg.enemies: Liste von { kind, ...Felder }
function scene({ enemies = [], player = {}, camX = 1000 } = {}) {
  const s = createState({ seed: 2 });
  s.camX = camX;
  s.platforms.push(createStaticPlatform(s, camX - 400, 330, 1800, { ground: true }));
  enemies.forEach((o, i) => {
    const { kind, ...rest } = o;
    const e = makeEnemy(s, kind, i);
    Object.assign(e, rest);
    s.enemies.push(e);
  });
  const p = s.player;
  p.x = camX + 300;
  p.y = 330 - p.h;
  p.onGround = true;
  for (const [k, v] of Object.entries(player)) {
    if (k === 'power' || k === 'dash') Object.assign(p[k], v);
    else p[k] = v;
  }
  return s;
}

const viewOf = (s, o = {}) => ({ W, H, camX: s.camX, time: 3, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });
const offscreen = (s) => { s.player.x = s.camX + 9000; return s; };

function draw(s, o = {}, ctxOpts) {
  const c = strictCtx(ctxOpts);
  drawCharacters(c.ctx, s, viewOf(s, o));
  assert.equal(c.stack.length, 0, 'save und restore sind nicht ausgeglichen');
  return c;
}

// ---------- Tests ----------

test('alle Gegnertypen in allen Zuständen zeichnen ohne Fehler und mit gültigen Argumenten', () => {
  const states = ['patrol', 'turn', 'crouch', 'air', 'windup', 'dash', 'cooldown', 'fly', 'dead'];
  let n = 0;
  for (const kind of KINDS) {
    for (const state of states) {
      for (const dir of [-1, 1]) {
        for (const telegraph of [0, 0.5, 1]) {
          for (const dead of [0, 0.001, 0.2, 0.39, 0.4, 0.9]) {
            for (const flash of [0, 0.1, 1]) {
              for (const reduceMotion of [false, true]) {
                const s = offscreen(scene({ enemies: [{ kind, state, dir, telegraph, dead, flash, vx: dir * 50, shakeX: 1.2 }] }));
                const c = draw(s, { reduceMotion, time: n * 0.37 });
                assert.equal(c.props.globalAlpha, 1);
                n++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n > 1000);
});

test('der Spieler in allen Zuständen zeichnet ohne Fehler', () => {
  let n = 0;
  for (const dead of [false, true]) {
    for (const dashT of [0, 0.5, 5]) {
      for (const shield of [false, true]) {
        for (const feather of [0, 1, 2, 3]) {
          for (const wet of [0, 0.3, 0.31, 1]) {
            for (const invuln of [0, 1.5]) {
              for (const dashing of [false, true]) {
                for (const reduceMotion of [false, true]) {
                  const s = scene({
                    player: {
                      dead, wet, invuln, stun: n % 3 === 0 ? 0.2 : 0, trail: dashing ? 1 : n % 2 ? 0.4 : 0, face: n % 2 ? -1 : 1,
                      onGround: n % 4 !== 0, vx: n % 5 === 0 ? 300 : 0, vy: n % 3 ? -400 : 500,
                      squashX: n % 2 ? 1.25 : 0.85, squashY: n % 2 ? 0.75 : 1.2,
                      power: { shield, dashT, magnetT: dashT, feather },
                      dash: { t: dashing ? 0.1 : 0, dir: n % 2 ? -1 : 1 },
                    },
                  });
                  s.deathT = (n % 7) * 0.4;
                  const c = draw(s, { reduceMotion, time: n * 0.21 });
                  assert.equal(c.props.globalAlpha, 1);
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
  assert.ok(n > 1000);
});

test('Unsinn im Zustand wirft nie und erzeugt nur gültige Zeichenbefehle', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', -1, 0, 1, 0.5, 1e9, -1e9, 7, true, {}, []];
  const pickJunk = () => junk[Math.floor(rnd() * junk.length)];
  const messUp = (o, keys) => { for (const k of keys) if (rnd() < 0.3) o[k] = pickJunk(); };
  for (let i = 0; i < 1500; i++) {
    const s = scene({ enemies: KINDS.map((kind) => ({ kind })) });
    for (const e of s.enemies) {
      e.x += 100;
      messUp(e, ['x', 'y', 'w', 'h', 'vx', 'vy', 'dir', 'state', 'timer', 'anim', 'dead', 'telegraph', 'flash', 'shakeX', 'kind']);
    }
    s.enemies.push(null, undefined);
    messUp(s.player, ['x', 'y', 'w', 'h', 'vx', 'vy', 'face', 'squashX', 'squashY', 'invuln', 'stun', 'wet', 'trail', 'dead', 'blink', 'onGround', 'power', 'dash']);
    if (rnd() < 0.5) {
      s.player.x = s.camX + 300;
      s.player.y = 296;
    }
    const objOr = (o) => (o && typeof o === 'object' ? o : {});
    if (rnd() < 0.3) messUp(objOr(s.player.power), ['shield', 'dashT', 'magnetT', 'feather']);
    if (rnd() < 0.3) messUp(objOr(s.player.dash), ['t', 'dir', 'cd']);
    s.deathT = pickJunk();
    for (let k = 0; k < 20; k++) {
      s.particles.push({ x: s.camX + rnd() * 800, y: rnd() * 450, vx: 0, vy: 0, life: 1, max: 1, size: 1 + rnd() * 6, color: '#ffd966', shape: ['dot', 'star', 'cloud', 'line', 'drop', 'ring', 'xyz'][k % 7], g: 0, drag: 0, rot: rnd() * 6, vr: 0, alpha: rnd() });
      messUp(s.particles[s.particles.length - 1], ['x', 'y', 'size', 'color', 'shape', 'rot', 'alpha', 'sky', 'cam', 'glow']);
    }
    s.particles.push(null);
    const c = strictCtx();
    drawCharacters(c.ctx, s, viewOf(s, { time: pickJunk() === 1 ? 0 : rnd() * 50, reduceMotion: rnd() < 0.5, debug: rnd() < 0.5, camX: rnd() < 0.2 ? pickJunk() : s.camX }));
    assert.equal(c.stack.length, 0);
  }
});

test('leere Welt, fehlende Listen und fehlende Argumente werfen nicht', () => {
  const s = createState({ seed: 1 });
  assert.doesNotThrow(() => drawCharacters(strictCtx().ctx, s, viewOf(s)));
  assert.doesNotThrow(() => drawCharacters(createMockCtx(), s, viewOf(s)));
  const bare = { player: null };
  assert.doesNotThrow(() => drawCharacters(strictCtx().ctx, bare, { W, H, camX: 0, time: 0 }));
  assert.doesNotThrow(() => drawCharacters(strictCtx().ctx, { player: s.player }, { time: 1 }));
  assert.doesNotThrow(() => drawCharacters(null, s, viewOf(s)));
  assert.doesNotThrow(() => drawCharacters(strictCtx().ctx, null, viewOf(s)));
  assert.doesNotThrow(() => drawCharacters(strictCtx().ctx, s, null));
});

test('Zeichenaufrufe bei 8 Gegnern und 260 Partikeln bleiben unter etwa 2000', () => {
  for (const active of [false, true]) {
    const s = scene({
      enemies: KINDS.concat(KINDS).map((kind) => ({
        kind, telegraph: active ? 0.8 : 0, state: active ? { walker: 'turn', jumper: 'crouch', flyer: 'fly', charger: 'windup' }[kind] : undefined,
      })),
      player: { wet: 1, trail: 1, dash: { t: 0.1, dir: 1 }, power: { shield: true, dashT: 5, magnetT: 5, feather: 2 } },
    });
    for (const e of s.enemies) e.state = e.state || (e.kind === 'flyer' ? 'fly' : 'patrol');
    let i = 0;
    while (s.particles.length < LIMITS.MAX_PARTICLES) emit(s, PRESET_NAMES[i++ % PRESET_NAMES.length], s.camX + 40 + ((i * 37) % 720), 60 + ((i * 53) % 330));
    assert.equal(s.particles.length, LIMITS.MAX_PARTICLES);
    const c = draw(s);
    assert.ok(calls(c.log) < 2000, `${calls(c.log)} Aufrufe (aktiv: ${active})`);
    const m = createMockCtx();
    drawCharacters(m, s, viewOf(s));
    assert.ok(m.calls.length < 2000, `${m.calls.length} Aufrufe mit dem Mock Kontext`);
  }
});

test('auch 260 gleiche Partikel bleiben bei einer Handvoll Gegner im Rahmen', () => {
  for (const shape of ['dot', 'star', 'cloud', 'line', 'drop', 'ring']) {
    const s = scene({ enemies: KINDS.map((kind) => ({ kind })) });
    for (let k = 0; k < LIMITS.MAX_PARTICLES; k++) {
      s.particles.push({ x: s.camX + (k * 3) % 800, y: 40 + (k * 7) % 380, vx: 0, vy: 0, life: 1, max: 1, size: 4, color: '#ffd966', shape, g: 0, drag: 0, rot: k, vr: 0, alpha: 0.8, glow: 1 });
    }
    const c = draw(s);
    assert.ok(calls(c.log) < 1900, `${shape}: ${calls(c.log)} Aufrufe`);
  }
});

test('Verläufe entstehen höchstens einmal pro Frame und Art, nicht pro Figur', () => {
  const one = scene({ enemies: [{ kind: 'walker' }], player: { power: { shield: true } } });
  const many = scene({ enemies: Array.from({ length: 8 }, () => ({ kind: 'walker' })), player: { power: { shield: true } } });
  const g1 = draw(one).stats.gradients;
  const g8 = draw(many).stats.gradients;
  assert.equal(g8, g1, 'acht Walker brauchen nicht mehr Verläufe als einer');
  const busy = scene({
    enemies: KINDS.concat(KINDS).map((kind) => ({ kind })),
    player: { wet: 1, trail: 1, dash: { t: 0.1, dir: 1 }, power: { shield: true, dashT: 5, magnetT: 5, feather: 2 } },
  });
  let i = 0;
  while (busy.particles.length < LIMITS.MAX_PARTICLES) emit(busy, PRESET_NAMES[i++ % PRESET_NAMES.length], busy.camX + 40 + ((i * 37) % 720), 60 + ((i * 53) % 330));
  assert.ok(draw(busy).stats.gradients < 60, `${draw(busy).stats.gradients} Verläufe`);
});

test('zeichnet nur, was im Bild liegt', () => {
  const baseline = calls(draw(offscreen(scene())).log);
  assert.ok(baseline <= 2, `leeres Bild: ${baseline} Aufrufe`);
  // Gegner weit links, weit rechts, weit unten
  const s = offscreen(scene({ enemies: KINDS.map((kind) => ({ kind })) }));
  s.enemies[0].x = s.camX - 900;
  s.enemies[1].x = s.camX + 2000;
  s.enemies[2].y = 3000;
  s.enemies[3].x = s.camX + 5000;
  assert.ok(calls(draw(s).log) <= 2, 'Gegner außerhalb zeichnen nichts');
  // Partikel außerhalb
  const p = offscreen(scene());
  for (let k = 0; k < 100; k++) p.particles.push({ x: p.camX + 2000 + k, y: 100, vx: 0, vy: 0, life: 1, max: 1, size: 5, color: '#fff', shape: 'star', g: 0, drag: 0, rot: 0, vr: 0, alpha: 1, glow: 1 });
  for (let k = 0; k < 100; k++) p.particles.push({ x: p.camX + 100, y: -500 - k, vx: 0, vy: 0, life: 1, max: 1, size: 5, color: '#fff', shape: 'dot', g: 0, drag: 0, rot: 0, vr: 0, alpha: 1 });
  assert.ok(calls(draw(p).log) <= 4, `Partikel außerhalb: ${calls(draw(p).log)} Aufrufe`);
  // Ein Spieler weit unten (gefallen) wird nicht mehr gezeichnet
  const f = scene({ player: { y: 2000 } });
  assert.ok(calls(draw(f).log) <= 2);
});

test('Partikel am Bildschirm (sky) folgen der Kamera nicht', () => {
  const mk = (sky) => {
    const s = offscreen(scene());
    s.particles.push({ x: 5400, y: 100, vx: 0, vy: 0, life: 1, max: 1, size: 5, color: '#fff', shape: 'dot', g: 0, drag: 0, rot: 0, vr: 0, alpha: 1, sky, cam: 5000 });
    return s;
  };
  assert.ok(calls(draw(mk(1)).log) >= 6, 'mit sky liegt er bei x 400 im Bild');
  assert.ok(calls(draw(mk(0)).log) <= 4, 'ohne sky liegt er weit rechts außerhalb');
});

test('jede Partikelform wird gezeichnet, auch eine unbekannte', () => {
  for (const shape of ['dot', 'star', 'cloud', 'line', 'drop', 'ring', 'unbekannt']) {
    const s = offscreen(scene());
    s.particles.push({ x: s.camX + 400, y: 200, vx: 0, vy: 0, life: 1, max: 1, size: 6, color: '#ffd966', shape, g: 0, drag: 0, rot: 0.5, vr: 0, alpha: 0.9 });
    const n = calls(draw(s).log);
    assert.ok(n >= 3, `${shape}: ${n} Aufrufe`);
  }
});

test('fast unsichtbare oder winzige Partikel werden übersprungen', () => {
  const s = offscreen(scene());
  s.particles.push({ x: s.camX + 400, y: 200, vx: 0, vy: 0, life: 1, max: 1, size: 6, color: '#fff', shape: 'dot', alpha: 0.01 });
  s.particles.push({ x: s.camX + 400, y: 200, vx: 0, vy: 0, life: 1, max: 1, size: 0.1, color: '#fff', shape: 'dot', alpha: 1 });
  assert.ok(calls(draw(s).log) <= 4, 'nur der leere Durchlauf');
});

test('die neuesten Partikel bekommen alle Details, ältere nur einfache Formen', () => {
  const s = offscreen(scene());
  for (let k = 0; k < 260; k++) s.particles.push({ x: s.camX + 20 + (k * 3) % 760, y: 40 + (k * 7) % 380, vx: 0, vy: 0, life: 1, max: 1, size: 4, color: '#fff', shape: 'star', rot: 0, alpha: 0.8 });
  const c = draw(s);
  assert.equal(count(c.log, 'quadraticCurveTo'), 4 * 100, 'nur 100 Funkelsterne mit Spitzen');
  assert.equal(count(c.log, 'arc'), 160, 'der Rest sind einfache Punkte');
});

test('Leuchtkränze sind pro Frame begrenzt und bei reduceMotion noch stärker', () => {
  const mk = () => {
    const s = offscreen(scene());
    for (let k = 0; k < 260; k++) s.particles.push({ x: s.camX + 20 + (k * 3) % 760, y: 40 + (k * 7) % 380, vx: 0, vy: 0, life: 1, max: 1, size: 4, color: '#ffd966', shape: 'dot', alpha: 0.8, glow: 1 });
    return s;
  };
  const normal = draw(mk());
  const calm = draw(mk(), { reduceMotion: true });
  const halos = (c) => count(c.log, 'fillRect');
  assert.ok(halos(normal) > 0 && halos(normal) <= 32, `${halos(normal)} Kränze`);
  assert.ok(halos(calm) > 0 && halos(calm) <= 12, `${halos(calm)} Kränze bei reduceMotion`);
  assert.ok(normal.log.some((c) => c[0] === '=globalCompositeOperation' && c[1] === 'lighter'));
  assert.equal(normal.props.globalCompositeOperation, 'source-over');
});

test('die Reihenfolge ist Gegner, dann Spieler, dann Partikel', () => {
  const inner = (log) => log.slice(1, -1); // ohne das äußere save und restore
  const s = offscreen(scene({ enemies: [{ kind: 'walker' }, { kind: 'charger' }] }));
  const onlyEnemies = inner(draw(s).log);
  assert.ok(onlyEnemies.length > 40);
  s.player.x = s.camX + 300;
  const withPlayer = inner(draw(s).log);
  assert.ok(withPlayer.length > onlyEnemies.length);
  assert.deepEqual(withPlayer.slice(0, onlyEnemies.length), onlyEnemies, 'der Spieler kommt nach allen Gegnern');
  emit(s, 'star', s.camX + 400, 200);
  emit(s, 'confetti', s.camX + 500, 200);
  const withParticles = inner(draw(s).log);
  assert.ok(withParticles.length > withPlayer.length);
  assert.deepEqual(withParticles.slice(0, withPlayer.length), withPlayer, 'Partikel kommen ganz zuletzt');
});

test('Schildblase, Federn und Auren liegen über dem Körper', () => {
  const body = (power) => draw(scene({ player: { power } })).log;
  const plain = body({});
  const shield = body({ shield: true });
  assert.ok(shield.length > plain.length + 8, 'die Blase zeichnet etwas');
  // Alles vor dem letzten restore des Spielers ist gleich, die Blase hängt hinten an
  const cut = plain.length - 2; // letztes restore des Spielers und des Rahmens
  assert.deepEqual(shield.slice(0, cut), plain.slice(0, cut));
  const feathers = body({ feather: 2 });
  assert.deepEqual(feathers.slice(0, cut), plain.slice(0, cut), 'Federn kommen nach dem Körper');
  assert.equal(count(feathers, 'quadraticCurveTo') - count(plain, 'quadraticCurveTo'), 4, 'zwei Federn mit je zwei Kurven');
  assert.equal(count(body({ feather: 1 }), 'quadraticCurveTo') - count(plain, 'quadraticCurveTo'), 2);
  assert.equal(count(body({ feather: 9 }), 'quadraticCurveTo') - count(plain, 'quadraticCurveTo'), 4, 'höchstens zwei Federn');
  // Schildblase hat einen Umriss mit etwa 35 mal 31 Pixeln
  const bubble = shield.filter((c) => c[0] === 'ellipse' && c[3] > 30 && c[3] < 40);
  assert.ok(bubble.length >= 1, 'die Blase ist ein Oval um die Wolke');
});

test('Magnet Aura und Dash Schimmer erscheinen nur mit Vorrat, am Ende blinkt die Aura nur ohne reduceMotion', () => {
  const quad = (power, o) => count(draw(scene({ player: { power } }), o).log, 'quadraticCurveTo');
  const none = quad({});
  assert.equal(quad({ magnetT: 5 }) - none, 12, 'drei Funken mit je vier Kurven');
  const shimmer = (power, o) => draw(scene({ player: { power } }), o).log.filter((c) => c[0] === 'ellipse' && c[3] > 30 && c[3] < 32).length;
  assert.equal(shimmer({}), 0);
  assert.equal(shimmer({ dashT: 5 }), 2, 'zwei Ringe, breit und dünn');
  // Kurz vor Ende blinkt die Aura, bei reduceMotion bleibt sie ruhig
  const alphasAt = (o) => JSON.stringify(draw(scene({ player: { power: { magnetT: 0.5 } } }), o).alphas.map((a) => +a.toFixed(3)));
  const seen = new Set();
  for (let t = 0; t < 1; t += 0.037) seen.add(alphasAt({ time: t }));
  assert.ok(seen.size > 3, 'die Aura pulsiert am Ende');
  assert.equal(alphasAt({ time: 0.1, reduceMotion: true }), alphasAt({ time: 0.9, reduceMotion: true }), 'bei reduceMotion ruhig');
});

test('Regenbogen Dash zeichnet sechs Bänder hinter Nimbus, gegen die Laufrichtung', () => {
  const rects = (o) => count(draw(scene({ player: o })).log, 'fillRect');
  const base = rects({});
  assert.equal(rects({ dash: { t: 0.1, dir: 1 } }) - base, 6, 'im Dash sechs Farbbänder');
  assert.equal(rects({ dash: { t: 0, dir: 1 }, trail: 0.5 }) - base, 6, 'die Spur bleibt nach dem Dash kurz stehen');
  assert.equal(rects({ dash: { t: 0, dir: 1 }, trail: 0 }) - base, 0, 'ohne Spur keine Bänder');
  const sign = (dir) => {
    const log = draw(scene({ player: { dash: { t: 0.1, dir }, trail: 1 } })).log;
    const band = log.filter((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 30)[0];
    return Math.sign(band[1]);
  };
  assert.equal(sign(1), -1, 'nach rechts gedasht, Spur links');
  assert.equal(sign(-1), 1, 'nach links gedasht, Spur rechts');
  // Länger bei frischer Spur
  const len = (trail) => draw(scene({ player: { dash: { t: 0, dir: 1 }, trail } })).log.filter((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 30)[0];
  assert.ok(Math.abs(len(1)[1]) > Math.abs(len(0.3)[1]));
});

test('Squash und Stretch haben den Anker am Boden', () => {
  const p = { squashX: 1.25, squashY: 0.75, onGround: false };
  const s = scene({ player: p });
  const log = draw(s).log;
  const i = log.findIndex((c) => c[0] === 'scale' && Math.abs(c[1] - 1.25) < 1e-9 && Math.abs(c[2] - 0.75) < 1e-9);
  assert.ok(i > 0, 'scale mit den Werten des Spielers');
  const move = log.slice(0, i).reverse().find((c) => c[0] === 'translate');
  assert.ok(Math.abs(move[1] - (s.player.x + s.player.w / 2 - s.camX)) < 1e-9, 'x ist die Mitte');
  assert.ok(Math.abs(move[2] - (s.player.y + s.player.h + 2)) < 1e-9, 'y ist die Unterkante');
  // Werte außerhalb werden begrenzt
  const wild = log.length;
  const big = draw(scene({ player: { squashX: 50, squashY: -3, onGround: false } })).log.find((c) => c[0] === 'scale' && c[1] > 1 && c[2] > 0 && c[2] < 1);
  assert.ok(big && big[1] <= 1.7 && big[2] >= 0.5, `begrenzt: ${big}`);
  assert.ok(wild > 0);
});

test('Nimbus blinzelt alle paar Sekunden, rein aus view.time', () => {
  const closed = (time) => count(draw(scene({ player: {} }), { time }).log, 'quadraticCurveTo');
  const open = closed(1.0);
  let blinkFrames = 0;
  let events = 0;
  let was = false;
  const N = 3900;
  for (let k = 0; k < N; k++) {
    const t = k * 0.01;
    const b = closed(t) > open;
    if (b) blinkFrames++;
    if (b && !was) events++;
    was = b;
  }
  assert.ok(events >= 9 && events <= 11, `${events} Blinzler in 39 Sekunden`);
  assert.ok(blinkFrames / N > 0.01 && blinkFrames / N < 0.06, `Anteil ${blinkFrames / N}`);
  assert.equal(closed(2.68), open + 2, 'zwei Bögen statt zwei Augen');
  assert.equal(closed(2.68 + 3.9), open + 2, 'wiederholt sich im Takt');
  // Gleiche Zeit, gleiches Bild
  assert.deepEqual(draw(scene({ player: {} }), { time: 7.77 }).log, draw(scene({ player: {} }), { time: 7.77 }).log);
});

test('Blinken bei Unverwundbarkeit mit 10 Hz, bei reduceMotion ruhig', () => {
  const maxAlpha = (o) => Math.max(...draw(scene({ player: { invuln: 1 } }), o).alphas);
  let toggles = 0;
  let last = maxAlpha({ time: 0.01 });
  const seen = new Set([last]);
  for (let k = 1; k < 40; k++) {
    const a = maxAlpha({ time: k * 0.05 + 0.01 });
    seen.add(a);
    if (a !== last) toggles++;
    last = a;
  }
  assert.equal(seen.size, 2, 'zwei Zustände: sichtbar und blass');
  assert.ok(toggles >= 18 && toggles <= 20, `${toggles} Wechsel in 2 Sekunden`);
  assert.ok(Math.min(...seen) >= 0.3, 'nie ganz unsichtbar');
  const calm = new Set();
  for (let k = 0; k < 40; k++) calm.add(maxAlpha({ time: k * 0.05 + 0.01, reduceMotion: true }));
  assert.equal(calm.size, 1, 'bei reduceMotion ohne Blinken');
  assert.ok([...calm][0] > 0.5);
  assert.equal(Math.max(...draw(scene({ player: { invuln: 0 } })).alphas), 1);
});

test('reduceMotion macht Funkeln und Wackeln ruhiger', () => {
  const mk = () => {
    const s = offscreen(scene());
    s.particles.push({ x: s.camX + 400, y: 200, vx: 0, vy: 0, life: 1, max: 1, size: 6, color: '#fff', shape: 'star', rot: 0, alpha: 1 });
    return s;
  };
  const star = (time, reduceMotion) => draw(mk(), { time, reduceMotion }).log.filter((c) => c[0] === 'quadraticCurveTo').map((c) => c[3]);
  assert.notDeepEqual(star(0, false), star(0.045, false), 'der Stern funkelt');
  assert.deepEqual(star(0, true), star(0.045, true), 'bei reduceMotion nicht');
  // Dash Schimmer dreht sich nur ohne reduceMotion
  const spin = (time, reduceMotion) => draw(scene({ player: { power: { dashT: 5 } } }), { time, reduceMotion }).log.find((c) => c[0] === 'rotate' && Math.abs(c[1]) > 0 || (c[0] === 'rotate' && c[1] === 0));
  assert.notEqual(spin(1, false)[1], spin(2, false)[1]);
  assert.equal(spin(1, true)[1], spin(2, true)[1]);
});

test('Sterben: Nimbus dreht sich, wird durchsichtig und hat keine Effekte mehr', () => {
  const s = scene({ player: { dead: true, onGround: false, power: { shield: true, feather: 2, magnetT: 5, dashT: 5 }, wet: 1, trail: 1 } });
  s.deathT = 0.2;
  const early = draw(s);
  s.deathT = 1.3;
  const late = draw(s);
  assert.ok(Math.max(...late.alphas) < Math.max(...early.alphas), 'wird durchsichtiger');
  assert.ok(Math.max(...late.alphas) >= 0.15, 'verschwindet nicht ganz');
  const spin = (c) => c.log.find((x) => x[0] === 'rotate')[1];
  assert.ok(Math.abs(spin(late) - spin(early)) > 1, 'dreht sich');
  const alive = draw(scene({ player: { onGround: false, power: { shield: true, feather: 2, magnetT: 5, dashT: 5 }, wet: 1, trail: 1 } }));
  assert.ok(calls(late.log) < calls(alive.log) - 40, 'keine Blase, Federn, Auren und Tropfen mehr');
  // X Augen sind zwei Kreuze: vier Linien
  assert.ok(count(late.log, 'lineTo') >= 4);
});

test('nasse Optik ab 0,3 mit kleinen Tropfen', () => {
  const arcs = (wet) => count(draw(scene({ player: { wet } })).log, 'arc');
  const dry = arcs(0);
  assert.equal(arcs(0.3), dry);
  assert.equal(arcs(0.5) - dry, 3);
  assert.equal(arcs(1) - dry, 4);
});

test('Gegner sind gespiegelt nach dir', () => {
  for (const kind of KINDS) {
    const sign = (dir) => {
      const log = draw(offscreen(scene({ enemies: [{ kind, dir, state: kind === 'flyer' ? 'fly' : 'patrol' }] }))).log;
      return Math.sign(log.find((c) => c[0] === 'scale')[1]);
    };
    assert.equal(sign(1), 1, kind);
    assert.equal(sign(-1), -1, kind);
  }
});

test('tote Gegner werden platt gedrückt und durchsichtig, nach 0,4 Sekunden ist nichts mehr zu sehen', () => {
  for (const kind of KINDS) {
    const at = (dead) => draw(offscreen(scene({ enemies: [{ kind, dead, state: 'dead' }] })));
    const alive = at(0);
    const mid = at(0.2);
    const sy = (c) => c.log.find((x) => x[0] === 'scale')[2];
    assert.equal(sy(alive), 1, kind);
    assert.ok(sy(mid) < 0.5 && sy(mid) > 0.05, `${kind}: Höhe ${sy(mid)}`);
    assert.ok(Math.max(...mid.alphas) < 0.8 && Math.max(...mid.alphas) > 0.3, `${kind}: durchsichtig ${Math.max(...mid.alphas)}`);
    assert.equal(Math.max(...alive.alphas), 1);
    // Höhe schrumpft stetig
    const heights = [0.001, 0.1, 0.2, 0.3, 0.39].map((d) => sy(at(d)));
    for (let i = 1; i < heights.length; i++) assert.ok(heights[i] < heights[i - 1], `${kind}: ${heights}`);
    assert.ok(calls(at(0.4).log) <= 2, `${kind}: nach 0,4 s unsichtbar`);
    assert.ok(calls(at(2).log) <= 2);
  }
});

test('e.flash lässt den Gegner weiß aufblitzen', () => {
  for (const kind of KINDS) {
    const whites = (flash) => draw(offscreen(scene({ enemies: [{ kind, flash }] }))).log.filter((c) => c[0] === '=fillStyle' && /^rgba\(255,255,255,/.test(c[1])).length;
    assert.equal(whites(0), 0, kind);
    assert.ok(whites(0.2) >= 1, kind);
    assert.ok(whites(0.2) > whites(0));
  }
});

test('Telegraphs sind sichtbar', () => {
  // Walker schaut beim Wenden zur Seite: die Pupillen wandern nach hinten
  const pupils = (telegraph) => draw(offscreen(scene({ enemies: [{ kind: 'walker', state: 'turn', telegraph, dir: 1 }] }))).log.filter((c) => c[0] === 'arc' && Math.abs(c[3] - 2.852) < 0.01);
  const mean = (list) => list.reduce((a, c) => a + c[1], 0) / list.length;
  assert.equal(pupils(0).length, 2);
  assert.ok(mean(pupils(1)) < mean(pupils(0)) - 4, 'Blick nach hinten');
  // Jumper glüht und zieht sich zusammen
  const jumper = (telegraph) => draw(offscreen(scene({ enemies: [{ kind: 'jumper', state: 'crouch', telegraph }] }))).log;
  assert.ok(count(jumper(1), 'fillRect') > count(jumper(0), 'fillRect'), 'Glühen');
  const squash = (log) => log.filter((c) => c[0] === 'scale').pop();
  assert.ok(squash(jumper(1))[2] < squash(jumper(0))[2] - 0.15, 'wird flacher');
  assert.ok(squash(jumper(1))[1] > squash(jumper(0))[1], 'und breiter');
  // Charger lädt auf: Glühen, Rotfärbung und Ausrufezeichen
  const charger = (state, telegraph) => draw(offscreen(scene({ enemies: [{ kind: 'charger', state, telegraph }] }))).log;
  const calm = charger('patrol', 0);
  const windup = charger('windup', 0.8);
  assert.ok(calls(windup) > calls(calm) + 20);
  assert.ok(windup.some((c) => c[0] === 'arc' && Math.abs(c[3] - 2.9) < 1e-9), 'Punkt des Ausrufezeichens');
  assert.ok(!calm.some((c) => c[0] === 'arc' && Math.abs(c[3] - 2.9) < 1e-9));
  assert.ok(windup.some((c) => c[0] === '=fillStyle' && /^rgba\(255,60,50,/.test(c[1])), 'rote Färbung');
  // Zittern über e.shakeX verschiebt die Figur
  const shiftOf = (shakeX) => draw(offscreen(scene({ enemies: [{ kind: 'charger', state: 'windup', telegraph: 1, shakeX }] }))).log.find((c) => c[0] === 'translate')[1];
  assert.ok(Math.abs(shiftOf(2) - shiftOf(0) - 2) < 1e-9);
  // Im Dash Speedlinien
  const dash = charger('dash', 0);
  assert.ok(count(dash, 'lineTo') >= count(calm, 'lineTo') + 4);
  // Flyer schlägt mit den Flügeln
  const wings = (time) => draw(offscreen(scene({ enemies: [{ kind: 'flyer', state: 'fly', anim: time }] }))).log.filter((c) => c[0] === 'quadraticCurveTo' && Math.abs(c[3]) > 20);
  assert.notDeepEqual(wings(0.05), wings(0.17));
});

test('Gegner sehen verschieden aus und deutlich anders als Nimbus', () => {
  const colors = (kind) => new Set(draw(offscreen(scene({ enemies: [{ kind }] }))).log.filter((c) => c[0] === '=strokeStyle' && typeof c[1] === 'string').map((c) => c[1]));
  const edges = KINDS.map((k) => [...colors(k)].join('|'));
  assert.equal(new Set(edges).size, 4, 'jeder Typ hat eigene Farben');
  const nimbus = draw(scene()).log.filter((c) => c[0] === '=strokeStyle').map((c) => c[1]);
  for (const kind of KINDS) for (const c of colors(kind)) assert.ok(!nimbus.includes(c) || /^rgba\(255,/.test(c) || c === '#ffffff' || c === '#161226', `${kind} teilt die Farbe ${c} mit Nimbus`);
});

test('Debug zeigt die Hitboxen von Spieler und Gegnern als dünne Rechtecke', () => {
  const s = scene({ enemies: KINDS.map((kind) => ({ kind })) });
  const off = draw(s, { debug: false });
  const on = draw(s, { debug: true });
  assert.equal(count(off.log, 'strokeRect'), 0);
  assert.equal(count(on.log, 'strokeRect'), 2 + 2 * KINDS.length);
  const rect = on.log.filter((c) => c[0] === 'strokeRect');
  const p = s.player;
  assert.ok(rect.some((c) => Math.abs(c[1] - (p.x - s.camX + 0.5)) < 1e-9 && Math.abs(c[2] - (p.y + 0.5)) < 1e-9 && c[3] === p.w && c[4] === p.h), 'Rahmen um die Spielerbox');
  assert.ok(rect.some((c) => c[3] === p.w - 8 && c[4] === p.h - 8), 'und um die wirksame Hitbox');
  let width = 0;
  for (const c of on.log) {
    if (c[0] === '=lineWidth') width = c[1];
    if (c[0] === 'strokeRect') assert.ok(width <= 1.5, `Rahmen mit Strichstärke ${width}`);
  }
  // Gegner weit außerhalb bekommen keinen Rahmen
  s.enemies[0].x = s.camX + 5000;
  assert.equal(count(draw(s, { debug: true }).log, 'strokeRect'), 2 + 2 * (KINDS.length - 1));
});

test('Zeichnen verändert den Zustand nicht und ist rein', () => {
  const s = scene({
    enemies: KINDS.map((kind) => ({ kind, telegraph: 0.5, dead: kind === 'walker' ? 0.2 : 0 })),
    player: { power: { shield: true, feather: 1 }, wet: 1, trail: 0.5 },
  });
  for (let i = 0; i < 40; i++) emit(s, PRESET_NAMES[i % PRESET_NAMES.length], s.camX + 100 + i * 10, 150);
  const before = structuredClone(s);
  const a = draw(s, { debug: true, time: 4.2 });
  const b = draw(s, { debug: true, time: 4.2 });
  assert.deepEqual(s, before);
  assert.deepEqual(a.log, b.log);
});

test('mit View Verschiebung der Kamera wandern alle Figuren mit', () => {
  const s = scene({ enemies: [{ kind: 'walker' }] });
  const a = draw(s).log.find((c) => c[0] === 'translate');
  s.camX += 25;
  const b = draw(s).log.find((c) => c[0] === 'translate');
  assert.ok(Math.abs(a[1] - b[1] - 25) < 1e-9);
});

test('der Kontext des Aufrufers bleibt unverändert', () => {
  const c = strictCtx();
  c.ctx.globalAlpha = 0.5;
  c.ctx.globalCompositeOperation = 'lighter';
  c.ctx.lineWidth = 3;
  c.ctx.fillStyle = '#123456';
  const s = scene({ enemies: KINDS.map((kind) => ({ kind })), player: { power: { shield: true, dashT: 5 }, dash: { t: 0.1, dir: 1 } } });
  for (let i = 0; i < 30; i++) emit(s, PRESET_NAMES[i % PRESET_NAMES.length], s.camX + 100 + i * 20, 150);
  drawCharacters(c.ctx, s, viewOf(s, { debug: true }));
  assert.equal(c.stack.length, 0);
  assert.equal(c.props.globalAlpha, 0.5);
  assert.equal(c.props.globalCompositeOperation, 'lighter');
  assert.equal(c.props.lineWidth, 3);
  assert.equal(c.props.fillStyle, '#123456');
});

test('läuft auch in älteren Browsern ohne getTransform und Kegelverlauf', () => {
  const s = scene({
    enemies: KINDS.map((kind) => ({ kind })),
    player: { power: { shield: true, dashT: 5, magnetT: 5, feather: 2 }, dash: { t: 0.1, dir: 1 }, trail: 1, wet: 1 },
  });
  for (let i = 0; i < 80; i++) emit(s, PRESET_NAMES[i % PRESET_NAMES.length], s.camX + 40 + (i * 37) % 700, 100 + (i * 53) % 300);
  const modern = draw(s);
  const legacy = draw(s, {}, { without: ['getTransform', 'createConicGradient'] });
  assert.ok(calls(legacy.log) > 100);
  assert.equal(count(legacy.log, 'setTransform'), 0, 'ohne getTransform kein setTransform');
  assert.ok(count(modern.log, 'setTransform') > 0);
  assert.ok(calls(legacy.log) < 2000);
});

test('im echten Spiel: Zeichnen in jeder Phase eines Laufs bleibt gültig', () => {
  const s = newGame(21);
  let drawn = 0;
  for (let chunk = 0; chunk < 24; chunk++) {
    run(s, 40, (st, i) => input({ move: 1, jumpPressed: i % 25 === 0, jumpHeld: i % 25 < 14, dashPressed: i % 70 === 0 }));
    if (chunk === 6) s.player.power.shield = true;
    if (chunk === 8) { s.player.power.dashT = 6; s.player.power.magnetT = 6; s.player.power.feather = 2; }
    const c = strictCtx();
    drawCharacters(c.ctx, s, viewOf(s, { time: chunk * 0.7, debug: chunk % 2 === 0, reduceMotion: chunk % 3 === 0 }));
    assert.equal(c.stack.length, 0);
    drawn++;
    if (s.mode === 'over') break;
  }
  assert.ok(drawn >= 8);
  // Sterbephase
  const d = newGame(22);
  run(d, 30);
  d.lives = 1;
  d.player.invuln = 0;
  d.mode = 'dying';
  d.player.dead = true;
  d.player.vy = -300;
  for (let i = 0; i < 90; i++) {
    run(d, 1, () => input());
    const c = strictCtx();
    drawCharacters(c.ctx, d, viewOf(d, { time: i * 0.016 }));
    assert.equal(c.stack.length, 0);
    if (d.mode === 'over') break;
  }
});
