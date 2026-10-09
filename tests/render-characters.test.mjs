// Tests für game/render/characters.js ohne Browser.
// Der strenge Kontext verhält sich wie ein echter Canvas: er kennt nur echte Methoden und
// Eigenschaften, wirft bei unmöglichen Argumenten (negative Radien, NaN) und prüft save und restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { ENEMY, H, LIMITS, W } from '../game/constants.js';

const ENEMY_HAIL = ENEMY.HAILCLOUD;
import { createState } from '../game/state.js';
import { createCharger, createFlyer, createHailcloud, createJumper, createShot, createStaticPlatform, createWalker } from '../game/entities.js';
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

const KINDS = ['walker', 'jumper', 'flyer', 'charger', 'hailcloud'];

function makeEnemy(s, kind, i = 0) {
  const plat = s.platforms[0];
  let e;
  if (kind === 'walker') e = createWalker(s, plat, 0.2);
  else if (kind === 'jumper') e = createJumper(s, plat, 0.2);
  else if (kind === 'charger') e = createCharger(s, plat, 0.2);
  else if (kind === 'hailcloud') e = createHailcloud(s, s.camX + 150 + i * 90, 230);
  else e = createFlyer(s, s.camX + 150 + i * 90, 250);
  if (kind !== 'flyer' && kind !== 'hailcloud') e.x = s.camX + 40 + i * 90;
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
    if (rnd() < 0.5) { s.player.slam.active = true; s.player.glide = true; s.player.throwCd = 0.3; s.player.ammo = 2; s.player.power.double = 3; }
    messUp(s.player, ['x', 'y', 'w', 'h', 'vx', 'vy', 'face', 'squashX', 'squashY', 'invuln', 'stun', 'wet', 'trail', 'dead', 'blink', 'onGround', 'power', 'dash', 'ammo', 'glide', 'glideT', 'throwCd', 'slam']);
    s.combo.count = 5;
    messUp(s.combo, ['count', 'timer']);
    if (rnd() < 0.1) s.combo = pickJunk();
    if (rnd() < 0.5) {
      s.player.x = s.camX + 300;
      s.player.y = 296;
    }
    const objOr = (o) => (o && typeof o === 'object' ? o : {});
    if (rnd() < 0.3) messUp(objOr(s.player.power), ['shield', 'dashT', 'magnetT', 'feather', 'double']);
    if (rnd() < 0.3) messUp(objOr(s.player.slam), ['active', 't']);
    if (rnd() < 0.3) messUp(objOr(s.player.dash), ['t', 'dir', 'cd', 'rainbow']);
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
        kind, telegraph: active ? 0.8 : 0, state: active ? { walker: 'turn', jumper: 'crouch', flyer: 'fly', charger: 'windup', hailcloud: 'windup' }[kind] : undefined,
      })),
      player: { wet: 1, trail: 1, dash: { t: 0.1, dir: 1 }, power: { shield: true, dashT: 5, magnetT: 5, feather: 2 } },
    });
    for (const e of s.enemies) e.state = e.state || (e.kind === 'flyer' || e.kind === 'hailcloud' ? 'fly' : 'patrol');
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
  s.enemies[4].y = -3000;
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
  assert.equal(rects({ dash: { t: 0.1, dir: 1, rainbow: true } }) - base, 6, 'im Dash sechs Farbbänder');
  assert.equal(rects({ dash: { t: 0, dir: 1, rainbow: true }, trail: 0.5 }) - base, 6, 'die Spur bleibt nach dem Dash kurz stehen');
  assert.equal(rects({ dash: { t: 0, dir: 1, rainbow: true }, trail: 0 }) - base, 0, 'ohne Spur keine Bänder');
  const sign = (dir) => {
    const log = draw(scene({ player: { dash: { t: 0.1, dir, rainbow: true }, trail: 1 } })).log;
    const band = log.filter((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 30)[0];
    return Math.sign(band[1]);
  };
  assert.equal(sign(1), -1, 'nach rechts gedasht, Spur links');
  assert.equal(sign(-1), 1, 'nach links gedasht, Spur rechts');
  // Länger bei frischer Spur
  const len = (trail) => draw(scene({ player: { dash: { t: 0, dir: 1, rainbow: true }, trail } })).log.filter((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 30)[0];
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
      const log = draw(offscreen(scene({ enemies: [{ kind, dir, state: kind === 'flyer' || kind === 'hailcloud' ? 'fly' : 'patrol' }] }))).log;
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
  assert.equal(new Set(edges).size, KINDS.length, 'jeder Typ hat eigene Farben');
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

// ============================================================
// Runde 2: Hagelwolke, Wurfsterne, Posen und Auren von Nimbus
// ============================================================

const bodyScale = (log, s) => {
  const p = s.player;
  const feet = p.y + p.h + 2;
  const i = log.findIndex((c) => c[0] === 'translate' && Math.abs(c[2] - feet) < 1e-9);
  assert.ok(i >= 0, 'Körper Translation gefunden');
  const sc = log.slice(i).find((c) => c[0] === 'scale');
  return [sc[1], sc[2]];
};
const bodyShift = (log, s) => {
  const p = s.player;
  const feet = p.y + p.h + 2;
  return log.find((c) => c[0] === 'translate' && Math.abs(c[2] - feet) < 1e-9)[1] - (p.x + p.w / 2 - s.camX);
};
const air = { onGround: false, y: 240, vy: 100 };
// Fünfzackige Sterne im Log: ein moveTo, neun lineTo, ein closePath. Gibt die zehn Eckpunkte je Stern zurück.
function starPaths(log) {
  const out = [];
  for (let k = 0; k + 10 < log.length; k++) {
    if (log[k][0] !== 'moveTo') continue;
    let ok = log[k + 10][0] === 'closePath';
    for (let j = 1; j <= 9 && ok; j++) ok = log[k + j][0] === 'lineTo';
    if (ok) out.push(log.slice(k, k + 10).map((c) => [c[1], c[2]]));
  }
  return out;
}
const centerOf = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
const hail = (o, view, extra = {}) => draw(offscreen(scene({ enemies: [{ kind: 'hailcloud', state: 'fly', ...o }], ...extra })), view);

test('Hagelwolke: in Ruhe ein Eisbrocken mit Schneehaube, Mündung und Augen, ohne Schatten', () => {
  const c = hail({});
  assert.ok(calls(c.log) > 40, 'mehr als ein paar Striche');
  assert.equal(c.alphas.every((a) => a === 1), true);
  const shadowOf = (kind) => draw(offscreen(scene({ enemies: [{ kind, state: kind === 'hailcloud' ? 'fly' : 'patrol' }] }))).log.filter((x) => x[0] === 'ellipse' && x[4] === 3.3).length;
  assert.equal(shadowOf('walker'), 1, 'Bodengegner haben einen Schatten');
  assert.equal(shadowOf('hailcloud'), 0, 'die Hagelwolke schwebt');
  // Schneehaube: weiße Kuppen, sechs Ellipsen
  const white = c.log.filter((x) => x[0] === 'ellipse' && x[3] > 8 && x[3] < 10 && x[4] > 5 && x[4] < 6.5);
  assert.ok(white.length >= 3, 'Schneekuppen');
  // Gegner sind spiegelsymmetrisch gebaut: Blick nach links und rechts zeichnet gleich viele Befehle
  assert.equal(calls(hail({ dir: 1 }).log), calls(hail({ dir: -1 }).log));
});

test('Hagelwolke: Telegraph lässt die Mündung glühen und zeigt den Fächer mit drei Hagelkörnern', () => {
  const calm = hail({ state: 'fly', telegraph: 0 }, { reduceMotion: true });
  const wind = (t, o) => hail({ state: 'windup', telegraph: t }, o);
  const w1 = wind(1, { reduceMotion: true });
  assert.ok(calls(w1.log) > calls(calm.log) + 8, 'Vorwarnung zeichnet mehr');
  assert.ok(count(w1.log, 'fillRect') > count(calm.log, 'fillRect'), 'Leuchten um den Brocken');
  assert.equal(count(w1.log, 'lineTo') - count(calm.log, 'lineTo'), ENEMY_HAIL.balls, 'ein Strahl pro Hagelkorn');
  // Länge der Strahlen wächst mit dem Telegraph
  const tips = (log) => log.filter((x) => x[0] === 'lineTo' && x[2] > 3);
  const reach = (t) => Math.max(...tips(wind(t, { reduceMotion: true }).log).map((x) => x[2]));
  assert.ok(reach(1) > reach(0.5) + 4 && reach(0.5) > reach(0.1), `${reach(0.1)} ${reach(0.5)} ${reach(1)}`);
  // Fächer: symmetrisch um die Senkrechte, äußerer Winkel gleich spread
  const t1 = tips(w1.log);
  assert.equal(t1.length, ENEMY_HAIL.balls);
  assert.ok(Math.abs(t1.reduce((a, x) => a + x[1], 0)) < 1e-9, 'symmetrisch');
  const outer = t1.reduce((a, x) => (Math.abs(x[1]) > Math.abs(a[1]) ? x : a));
  assert.ok(Math.abs(Math.atan2(Math.abs(outer[1]), outer[2] + 0.4) - ENEMY_HAIL.spread) < 0.01, 'Winkel wie im Schuss');
  // Telegraph ohne Windup Zustand wirkt trotzdem (die Zeichnung folgt nur dem Wert), tote Wolken zeigen nie einen Fächer
  const dead = hail({ state: 'dead', dead: 0.1, telegraph: 1 }, { reduceMotion: true });
  const dead0 = hail({ state: 'dead', dead: 0.1, telegraph: 0 }, { reduceMotion: true });
  assert.equal(count(dead.log, 'lineTo'), count(dead0.log, 'lineTo'), 'kein Fächer bei toten Wolken');
  assert.equal(tips(dead.log).length, 0);
});

test('Hagelwolke zittert über shakeX, bei reduceMotion nur gedämpft und ohne Drehen', () => {
  const shift = (shakeX, o) => hail({ state: 'windup', telegraph: 1, shakeX }, o).log.find((c) => c[0] === 'translate')[1];
  assert.ok(Math.abs(shift(2) - shift(0) - 2) < 1e-9, 'verschiebt die Figur');
  assert.ok(Math.abs(shift(2, { reduceMotion: true }) - shift(0, { reduceMotion: true }) - 0.7) < 1e-9, 'bei reduceMotion nur ein Drittel');
  const rot = (time, o) => hail({ state: 'windup', telegraph: 1, anim: time }, o).log.filter((c) => c[0] === 'rotate').map((c) => c[1]);
  assert.notDeepEqual(rot(0.01), rot(0.02), 'Zittern dreht leicht');
  assert.equal(rot(0.01, { reduceMotion: true }).length, 0, 'bei reduceMotion kein Drehen');
  // Der Charger zittert ebenfalls nur gedämpft bei reduceMotion
  const cshift = (shakeX, o) => draw(offscreen(scene({ enemies: [{ kind: 'charger', state: 'windup', telegraph: 1, shakeX }] })), o).log.find((c) => c[0] === 'translate')[1];
  assert.ok(Math.abs(cshift(2, { reduceMotion: true }) - cshift(0, { reduceMotion: true }) - 0.7) < 1e-9);
});

test('Treffer: jeder Gegner blitzt weiß, auch beim Besiegen, danach nicht mehr', () => {
  for (const kind of KINDS) {
    const whites = (o) => draw(offscreen(scene({ enemies: [{ kind, state: 'dead', ...o }] }))).log.filter((c) => c[0] === '=fillStyle' && /^rgba\(255,255,255,/.test(c[1])).length;
    assert.ok(whites({ dead: 0.02 }) >= 1, `${kind}: Aufblitzen beim Besiegen`);
    assert.equal(whites({ dead: 0.3 }), 0, `${kind}: später nicht mehr`);
    assert.equal(whites({ dead: 0 }), 0);
    // das Aufblitzen klingt ab
    const strength = (d) => Math.max(0, ...draw(offscreen(scene({ enemies: [{ kind, state: 'dead', dead: d }] }))).log.filter((c) => c[0] === '=fillStyle' && /^rgba\(255,255,255,/.test(c[1])).map((c) => +c[1].match(/,([\d.]+)\)$/)[1]));
    assert.ok(strength(0.02) > strength(0.12) && strength(0.12) > strength(0.19), kind);
  }
});

// ---------- Wurfsterne ----------

const withShots = (list, o = {}) => {
  const s = offscreen(scene(o));
  for (const sh of list) s.shots.push(sh);
  return s;
};
const shotAt = (s, dx, dy = 200, vx = 640, o = {}) => Object.assign(createShot(s, s.camX + dx, dy, vx, 0), o);

test('Wurfstern: leuchtender fünfzackiger Stern mit Schweif, Nachbildern und Kern', () => {
  const s = withShots([]);
  s.shots.push(shotAt(s, 300));
  const c = draw(s);
  assert.ok(calls(c.log) > 20 && calls(c.log) < 80, `${calls(c.log)} Aufrufe`);
  assert.equal(count(c.log, 'lineTo'), 9 * 4 + 2, 'vier Sterne mit je neun Kanten plus die Schweifspitze');
  assert.equal(count(c.log, 'closePath'), 5, 'vier Sterne und die Spitze');
  assert.equal(count(c.log, 'fillRect'), 1, 'ein Leuchten');
  assert.ok(c.log.some((x) => x[0] === '=fillStyle' && x[1] === '#ffe27a'), 'goldene Füllung');
  assert.equal(c.stats.gradients, 3 + 0, 'Schweif, Kern des Schweifs und Leuchten');
  assert.equal(c.props.globalAlpha, 1);
});

test('Wurfstern: Schweif liegt entgegen der Flugrichtung, bei reduceMotion kürzer', () => {
  for (const dir of [1, -1]) {
    const s = withShots([]);
    s.shots.push(shotAt(s, 300, 200, dir * 640));
    const tail = (o) => draw(s, o).log.find((c) => c[0] === 'scale' && c[2] > 5 && c[2] < 12);
    const t = tail();
    assert.equal(Math.sign(t[1]), -dir, 'Schweif zeigt nach hinten');
    assert.ok(Math.abs(t[1]) > 50);
    assert.ok(Math.abs(tail({ reduceMotion: true })[1]) < Math.abs(t[1]), 'kürzer bei reduceMotion');
    const move = draw(s).log.find((c) => c[0] === 'translate');
    assert.ok(Math.abs(move[1] - (s.shots[0].x + s.shots[0].w / 2 - s.camX - dir * 11 * 0.4)) < 1e-9);
    assert.ok(Math.abs(move[2] - (s.shots[0].y + s.shots[0].h / 2)) < 1e-9);
  }
});

test('Wurfstern: dreht sich mit seiner Zeit, ruhiger bei reduceMotion, gleiche Zeit gleiches Bild', () => {
  const log = (anim, o) => {
    const s = withShots([]);
    s.shots.push(shotAt(s, 300, 200, 640, { anim }));
    return draw(s, o).log;
  };
  assert.notDeepEqual(log(0.1), log(0.2));
  assert.deepEqual(log(0.1), log(0.1));
  // Hauptstern: der dritte Stern im Log (zwei Nachbilder davor, der Kern danach), Mitte bei (300, 200)
  const spin = (anim, o) => {
    const stars = starPaths(log(anim, o));
    assert.equal(stars.length, 4);
    const [sx, sy] = stars[2][0];
    return Math.atan2(sy - 200, sx - 300) + Math.PI / 2;
  };
  assert.ok(Math.abs(spin(0.1) - 0.1 * 15) < 1e-9, 'Drehung ist Zeit mal 15 im Bogenmaß');
  assert.ok(Math.abs(spin(0.12) - spin(0.1) - 0.3) < 1e-9);
  assert.ok(Math.abs(spin(0.12, { reduceMotion: true }) - spin(0.1, { reduceMotion: true }) - 0.14) < 1e-9, 'bei reduceMotion mehr als doppelt so langsam');
});

test('Wurfstern blendet kurz vor dem Ende der Lebensdauer aus', () => {
  const maxAlpha = (life) => {
    const s = withShots([]);
    s.shots.push(shotAt(s, 300, 200, 640, { life }));
    return Math.max(...draw(s).alphas);
  };
  assert.equal(maxAlpha(0.5), 1);
  assert.ok(maxAlpha(0.05) <= 0.5 + 1e-9 && maxAlpha(0.05) > 0.3);
  assert.ok(maxAlpha(0.01) < 0.2);
  assert.equal(maxAlpha(undefined), 1, 'ohne life volle Deckkraft');
});

test('Wurfsterne außerhalb des Bildes werden nicht gezeichnet, höchstens acht auf einmal', () => {
  const s = withShots([]);
  for (const [dx, dy] of [[-400, 200], [1400, 200], [300, -300], [300, 900]]) s.shots.push(shotAt(s, dx, dy));
  assert.ok(calls(draw(s).log) <= 2, 'nur der leere Rahmen');
  const many = withShots([]);
  for (let i = 0; i < 8; i++) many.shots.push(shotAt(many, 40 + i * 80, 100 + i * 20));
  const eight = calls(draw(many).log);
  for (let i = 0; i < 12; i++) many.shots.push(shotAt(many, 40 + i * 60, 300));
  assert.equal(calls(draw(many).log), eight, 'mehr als acht werden nicht gezeichnet');
  assert.ok(eight < 8 * 80);
  assert.ok(calls(draw(withShots([])).log) <= 2);
});

test('Wurfsterne liegen über Nimbus und unter den Partikeln, auch wenn Nimbus nicht im Bild ist', () => {
  const s = scene();
  const base = draw(s).log.slice(1, -1);
  s.shots.push(shotAt(s, 100));
  const withShot = draw(s).log.slice(1, -1);
  assert.deepEqual(withShot.slice(0, base.length), base, 'Nimbus kommt zuerst');
  assert.ok(withShot.length > base.length);
  emit(s, 'star', s.camX + 500, 150);
  const withParticles = draw(s).log.slice(1, -1);
  assert.deepEqual(withParticles.slice(0, withShot.length), withShot, 'Partikel ganz zuletzt');
  assert.ok(calls(draw(withShots([shotAt(offscreen(scene()), 200)])).log) > 20, 'auch ohne Nimbus im Bild');
});

test('Wurfsterne mit Unsinn in den Feldern werfen nicht und erzeugen gültige Befehle', () => {
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', -1, 0, 1e9, -1e9, true, {}, []];
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 400; i++) {
    const s = offscreen(scene());
    for (let k = 0; k < 4; k++) {
      const sh = shotAt(s, 100 + k * 150, 200);
      for (const key of ['x', 'y', 'w', 'h', 'vx', 'vy', 'life', 'anim']) if (rnd() < 0.3) sh[key] = junk[Math.floor(rnd() * junk.length)];
      s.shots.push(sh);
    }
    s.shots.push(null, undefined, 5, 'x');
    const c = strictCtx();
    drawCharacters(c.ctx, s, viewOf(s, { reduceMotion: rnd() < 0.5, time: rnd() * 30 }));
    assert.equal(c.stack.length, 0);
  }
  const s = offscreen(scene());
  s.shots = 'kaputt';
  assert.doesNotThrow(() => draw(s));
  s.shots = undefined;
  assert.doesNotThrow(() => draw(s));
});

// ---------- Posen ----------

test('Gleiten: Nimbus wird flach und breit, bekommt Armpuffer und kleine Wolken Puffer', () => {
  const base = draw(scene({ player: air })).log;
  const sBase = scene({ player: air });
  const sGlide = scene({ player: { ...air, glide: true, glideT: 0.5 } });
  const glide = draw(sGlide).log;
  const [bx, by] = bodyScale(base, sBase);
  const [gx, gy] = bodyScale(glide, sGlide);
  assert.ok(gx > bx * 1.12 && gy < by * 0.9, `breit und flach: ${gx} ${gy}`);
  assert.equal(count(glide, 'ellipse') - count(base, 'ellipse'), 2, 'zwei Armpuffer');
  assert.equal(count(glide, 'fillRect') - count(base, 'fillRect'), 3, 'drei weiche Wolken Puffer');
  assert.equal(count(draw(sGlide, { reduceMotion: true }).log, 'fillRect') - count(base, 'fillRect'), 2, 'bei reduceMotion nur zwei');
  // Anlauf: kurz nach dem Start noch nicht ganz flach
  const early = scene({ player: { ...air, glide: true, glideT: 0.01 } });
  const [ex] = bodyScale(draw(early).log, early);
  assert.ok(ex < gx && ex > bx, 'weicher Übergang');
  // Nur gleiten, wenn p.glide gesetzt ist, und nicht im Tod, Dash oder Sturzflug
  for (const o of [{ glide: false, glideT: 0.5 }, { glide: true, dead: true }, { glide: true, dash: { t: 0.1, dir: 1 } }, { glide: true, slam: { active: true, t: 0.1 } }]) {
    const s = scene({ player: { ...air, ...o } });
    assert.equal(count(draw(s).log, 'fillRect') - count(draw(scene({ player: { ...air, ...o, glide: false } })).log, 'fillRect'), 0, JSON.stringify(o));
  }
  // Puffer bleiben hinter Nimbus (face 1: links), bei face minus 1 rechts
  const puffX = (face) => {
    const s = scene({ player: { ...air, glide: true, glideT: 0.5, face } });
    const cx = s.player.x + s.player.w / 2 - s.camX;
    return draw(s).log.filter((c) => c[0] === 'translate' && Math.abs(c[1] - cx) > 20 && Math.abs(c[2] - (s.player.y + s.player.h)) < 40).map((c) => c[1] - cx);
  };
  assert.ok(puffX(1).length >= 3 && puffX(1).every((d) => d < 0), 'links hinter Nimbus');
  assert.ok(puffX(-1).every((d) => d > 0), 'rechts hinter Nimbus');
});

test('Sturzflug: gestreckt, Geschwindigkeitslinien über dem Kopf, entschlossenes Gesicht', () => {
  const sBase = scene({ player: air });
  const sSlam = scene({ player: { ...air, vy: 1250, slam: { active: true, t: 0.12 } } });
  const base = draw(sBase).log;
  const slam = draw(sSlam).log;
  const [bx, by] = bodyScale(base, sBase);
  const [sx, sy] = bodyScale(slam, sSlam);
  assert.ok(sx < bx * 0.9 && sy > by * 1.1, `schmal und lang: ${sx} ${sy}`);
  assert.ok(count(slam, 'lineTo') - count(base, 'lineTo') >= 5 + 2, 'fünf Linien und zwei Brauen');
  assert.ok(count(slam, 'fillRect') - count(base, 'fillRect') >= 1, 'heller Schein');
  assert.ok(slam.some((c) => c[0] === 'ellipse' && Math.abs(c[3] - 2.4) < 1e-9 && Math.abs(c[4] - 3) < 1e-9), 'Mund offen');
  // Linien liegen über dem Kopf und sind senkrecht
  const lines = slam.map((c, i) => [c, slam[i - 1]]).filter(([c, p]) => c[0] === 'lineTo' && p && p[0] === 'moveTo' && Math.abs(c[1] - p[1]) < 1e-9 && c[2] < p[2] - 10);
  assert.equal(lines.length, 5);
  const top = sSlam.player.y + sSlam.player.h + 2 - 40;
  assert.ok(lines.every(([c, p]) => p[2] < top + 2), 'beginnen am Kopf und gehen nach oben');
  // Länge wächst mit der Zeit im Sturz, Flackern nur ohne reduceMotion
  const len = (t, time, o) => {
    const s = scene({ player: { ...air, slam: { active: true, t } } });
    const l = draw(s, { time, ...o }).log;
    return l.map((c, i) => [c, l[i - 1]]).filter(([c, p]) => c[0] === 'lineTo' && p && p[0] === 'moveTo' && Math.abs(c[1] - p[1]) < 1e-9 && c[2] < p[2] - 5).map(([c, p]) => p[2] - c[2]);
  };
  assert.ok(Math.max(...len(0.2, 1)) > Math.max(...len(0, 1)), 'Linien wachsen am Anfang');
  assert.notDeepEqual(len(0.2, 1), len(0.2, 1.04), 'Flackern');
  assert.deepEqual(len(0.2, 1, { reduceMotion: true }), len(0.2, 1.04, { reduceMotion: true }), 'bei reduceMotion ruhig');
  // Im Tod gibt es keine Pose und keine Linien
  const dead = scene({ player: { ...air, dead: true, slam: { active: true, t: 0.1 } } });
  const dead0 = scene({ player: { ...air, dead: true } });
  assert.equal(count(draw(dead).log, 'lineTo'), count(draw(dead0).log, 'lineTo'), 'keine Linien im Tod');
  assert.equal(count(draw(dead).log, 'fillRect'), count(draw(dead0).log, 'fillRect'), 'und kein Schein');
});

test('Basis Dash: kurzer weißer Schweif, Regenbogen Dash bleibt bunt', () => {
  const rects = (o) => count(draw(scene({ player: o })).log, 'fillRect');
  const base = rects({});
  assert.equal(rects({ dash: { t: 0.1, dir: 1, rainbow: false } }) - base, 0, 'keine Farbbänder');
  assert.equal(rects({ dash: { t: 0.1, dir: 1 } }) - base, 0, 'ohne rainbow Angabe zählt als Basis');
  const fills = (o) => count(draw(scene({ player: o })).log, 'fill');
  assert.equal(fills({ dash: { t: 0.1, dir: 1, rainbow: false }, trail: 1 }) - fills({}), 3, 'drei Schichten');
  assert.equal(fills({ dash: { t: 0, dir: 1, rainbow: false }, trail: 0.5 }) - fills({}), 3, 'Spur bleibt nach dem Dash kurz stehen');
  assert.equal(fills({ dash: { t: 0, dir: 1, rainbow: false }, trail: 0 }) - fills({}), 0);
  const tail = (o) => draw(scene({ player: o })).log.find((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 20);
  assert.equal(Math.sign(tail({ dash: { t: 0.1, dir: 1 }, trail: 1 })[1]), -1, 'nach rechts, Schweif links');
  assert.equal(Math.sign(tail({ dash: { t: 0.1, dir: -1 }, trail: 1 })[1]), 1);
  const len = (o) => Math.abs(tail(o)[1]);
  assert.ok(len({ dash: { t: 0, dir: 1 }, trail: 1 }) > len({ dash: { t: 0, dir: 1 }, trail: 0.3 }), 'frisch länger');
  const rainbowLen = Math.abs(draw(scene({ player: { dash: { t: 0, dir: 1, rainbow: true }, trail: 1 } })).log.find((c) => c[0] === 'scale' && c[2] === 1 && Math.abs(c[1]) > 30)[1]);
  assert.ok(len({ dash: { t: 0, dir: 1 }, trail: 1 }) < rainbowLen, 'der Basis Schweif ist kürzer');
  // weiß, nicht bunt
  const cols = draw(scene({ player: { dash: { t: 0.1, dir: 1 }, trail: 1 } })).log.filter((c) => c[0] === '=fillStyle' && typeof c[1] === 'string');
  assert.ok(!cols.some((c) => /#ff7a9c|#9dffc8/.test(c[1])));
  // Im Dash ist Nimbus gestreckt wie bisher
  const s = scene({ player: { dash: { t: 0.1, dir: 1 } } });
  assert.ok(bodyScale(draw(s).log, s)[0] > 1.1);
});

test('Wurf Rückstoß: Nimbus federt kurz nach hinten, Aufblitzen an der Hand', () => {
  const COOL = 0.35;
  const shift = (since, face = 1, o) => {
    const s = scene({ player: { throwCd: COOL - since, face } });
    return bodyShift(draw(s, o).log, s);
  };
  assert.ok(Math.abs(shift(0) + 3.5) < 1e-9, 'sofort voll zurück');
  assert.ok(Math.abs(shift(0, -1) - 3.5) < 1e-9, 'bei Blick nach links nach rechts');
  assert.ok(shift(0.05) > shift(0) && shift(0.05) < 0, 'klingt ab');
  assert.equal(shift(0.19), 0, 'nach 0,18 s vorbei');
  assert.equal(shift(0.3), 0);
  assert.ok(Math.abs(shift(0, 1, { reduceMotion: true }) + 3.5 * 0.5) < 1e-9, 'bei reduceMotion halb so stark');
  const none = scene({ player: { throwCd: 0 } });
  assert.equal(bodyShift(draw(none).log, none), 0);
  // Aufblitzen: ein Funkelstern mehr (vier Kurven), nur kurz nach dem Wurf
  const quad = (since) => count(draw(scene({ player: { throwCd: COOL - since } })).log, 'quadraticCurveTo');
  assert.equal(quad(0) - quad(0.3), 4);
  assert.equal(quad(0.13) - quad(0.3), 0, 'später kein Aufblitzen mehr');
  // Staucht leicht in x
  const sx = (since) => { const s = scene({ player: { throwCd: COOL - since } }); return bodyScale(draw(s).log, s)[0]; };
  assert.ok(sx(0) < sx(0.3));
  // Nicht gesetzte oder unsinnige Abklingzeit löst nichts aus
  for (const cd of [NaN, undefined, -1, 5, COOL + 0.2, 'x']) {
    const s = scene({ player: { throwCd: cd } });
    assert.equal(bodyShift(draw(s).log, s), 0, String(cd));
  }
});

test('Ammo: Wurfsterne kreisen als kleine Sterne um Nimbus, vorn und hinten', () => {
  const lines = (ammo, o) => count(draw(scene({ player: { ammo } }), o).log, 'lineTo');
  const none = lines(0);
  for (const n of [1, 2, 3]) assert.equal(lines(n) - none, 9 * n, `${n} Sterne mit je neun Kanten`);
  assert.equal(lines(9) - none, 27, 'höchstens drei');
  for (const bad of [-2, NaN, undefined, 0.9, 'x']) assert.equal(lines(bad) - none, 0, String(bad));
  assert.equal(lines(2.7) - none, 18, 'ganze Sterne');
  // Bahn: alle Sterne innerhalb der Ellipse um die Wolkenmitte
  const s = scene({ player: { ammo: 3 } });
  const cx = s.player.x + s.player.w / 2 - s.camX;
  const mid = s.player.y + s.player.h + 2 - 20;
  const log = draw(s).log;
  const centers = starPaths(log).map(centerOf);
  assert.equal(centers.length, 3);
  const phases = centers.map(([x, y]) => {
    assert.ok(Math.abs(((x - cx) / 38) ** 2 + ((y - (mid - 4)) / 21) ** 2 - 1) < 1e-6, 'Sterne liegen auf der Bahn um Nimbus');
    return Math.atan2((y - (mid - 4)) / 21, (x - cx) / 38);
  }).sort((a, b) => a - b);
  assert.ok(Math.abs(phases[1] - phases[0] - (2 * Math.PI) / 3) < 1e-6 && Math.abs(phases[2] - phases[1] - (2 * Math.PI) / 3) < 1e-6, 'gleichmäßig verteilt');
  // Sterne dahinter vor dem Körper, davor danach
  const iBody = log.findIndex((c) => c[0] === 'translate' && Math.abs(c[2] - (s.player.y + s.player.h + 2)) < 1e-9);
  const before = log.slice(0, iBody).filter((c) => c[0] === 'lineTo').length;
  const after = log.slice(iBody).filter((c) => c[0] === 'lineTo').length;
  assert.ok(before >= 9 && after >= 9, `hinten ${before}, vorn ${after}`);
  assert.equal(before + after - none, 27);
  // Drehen: andere Zeit andere Lage, bei reduceMotion langsamer
  // Anfangspunkt jedes Sterns: ein moveTo, auf das neun lineTo folgen
  const pos = (time, o) => {
    const l = draw(scene({ player: { ammo: 1 } }), { time, ...o }).log;
    const i = l.findIndex((c, k) => c[0] === 'moveTo' && l.slice(k + 1, k + 10).every((x) => x[0] === 'lineTo') && l[k + 10][0] === 'closePath');
    assert.ok(i >= 0, 'Stern gefunden');
    return l[i];
  };
  assert.notDeepEqual(pos(1), pos(1.3));
  const move = (o) => { const a = pos(1, o); const b = pos(1.15, o); return Math.hypot(a[1] - b[1], a[2] - b[2]); };
  assert.ok(move({}) > move({ reduceMotion: true }), 'ruhiger bei reduceMotion');
  // nur lebendiger Nimbus
  assert.equal(starPaths(draw(scene({ player: { ammo: 3, dead: true } })).log).length, 0);
});

test('Doppelpunkte Aura: goldene Sternchen steigen um Nimbus auf, am Ende blinkt sie nur ohne reduceMotion', () => {
  const quad = (power, o) => count(draw(scene({ player: { power } }), o).log, 'quadraticCurveTo');
  assert.equal(quad({ double: 6 }) - quad({}), 28, 'sieben Sternchen');
  assert.equal(count(draw(scene({ player: { power: { double: 6 } } })).log, 'fillRect') - count(draw(scene()).log, 'fillRect'), 1, 'warmer Schein');
  assert.equal(quad({ double: 0 }) - quad({}), 0);
  assert.equal(quad({ double: NaN }) - quad({}), 0);
  assert.equal(quad({ double: -3 }) - quad({}), 0);
  const gold = draw(scene({ player: { power: { double: 6 } } })).log.filter((c) => c[0] === '=fillStyle').map((c) => c[1]);
  assert.ok(gold.includes('#ffd24a'));
  // Sternchen steigen: andere Zeit, andere Höhe
  const ys = (time) => draw(scene({ player: { power: { double: 6 } } }), { time }).log.filter((c) => c[0] === 'moveTo').map((c) => Math.round(c[2]));
  assert.notDeepEqual(ys(1), ys(1.4));
  const alphasAt = (o) => JSON.stringify(draw(scene({ player: { power: { double: 0.5 } } }), o).alphas.map((a) => +a.toFixed(3)));
  const seen = new Set();
  for (let t = 0; t < 1; t += 0.037) seen.add(alphasAt({ time: t }));
  assert.ok(seen.size > 3, 'die Aura pulsiert am Ende');
  // Die Sternchen wiederholen sich bei reduceMotion nach vier Sekunden genau: dann muss die Deckkraft gleich sein
  assert.equal(alphasAt({ time: 1, reduceMotion: true }), alphasAt({ time: 5, reduceMotion: true }), 'bei reduceMotion ruhig');
  assert.notEqual(alphasAt({ time: 1 }), alphasAt({ time: 5 }));
});

test('Combo Aura ab x3: warmer Schein, Schwanz und Funkenschweif, wächst mit der Combo', () => {
  const withCombo = (count, player = {}, o) => {
    const s = scene({ player });
    s.combo.count = count;
    s.combo.timer = 2;
    return draw(s, o);
  };
  const quad = (n, p, o) => count(withCombo(n, p, o).log, 'quadraticCurveTo');
  const none = quad(0);
  assert.equal(quad(2) - none, 0, 'bis x2 nichts');
  assert.equal(quad(3) - none, 20);
  assert.equal(quad(4) - none, 24);
  assert.equal(quad(5) - none, 28);
  assert.equal(quad(6) - none, 32);
  assert.equal(quad(40) - none, 32, 'oben begrenzt');
  for (const bad of [NaN, -4, undefined, 'x']) assert.equal(quad(bad) - none, 0, String(bad));
  assert.equal(count(withCombo(3).log, 'fillRect') - count(withCombo(0).log, 'fillRect'), 1, 'Schein');
  // Schwanz liegt hinter der Laufrichtung
  const tail = (vx, face) => withCombo(5, { vx, face }).log.find((c) => c[0] === 'scale' && c[2] > 5 && c[2] < 15 && Math.abs(c[1]) > 30);
  assert.equal(Math.sign(tail(300, 1)[1]), -1, 'läuft nach rechts, Schwanz links');
  assert.equal(Math.sign(tail(-300, -1)[1]), 1);
  assert.equal(Math.sign(tail(0, 1)[1]), -1, 'steht: hinter dem Blick');
  assert.equal(Math.sign(tail(0, -1)[1]), 1);
  assert.ok(Math.abs(tail(300, 1)[1]) < Math.abs(withCombo(8, { vx: 300 }).log.find((c) => c[0] === 'scale' && c[2] > 5 && c[2] < 15 && Math.abs(c[1]) > 30)[1]), 'länger bei höherer Combo');
  // Funken bewegen sich, wackeln aber nur ohne reduceMotion
  const ys = (time, o) => withCombo(5, {}, { time, ...o }).log.filter((c) => c[0] === 'moveTo').map((c) => +c[2].toFixed(3));
  assert.notDeepEqual(ys(1), ys(1.2));
  // Mitte der Funkelsterne: Kontrollpunkt der Kurven, weit genug von Gesicht und Körper entfernt
  const wobble = (o) => {
    const s0 = scene();
    const cx = s0.player.x + s0.player.w / 2 - s0.camX;
    const pick = (t) => withCombo(5, {}, { time: t, ...o }).log.filter((c) => c[0] === 'quadraticCurveTo' && Math.abs(c[1] - cx) > 20).map((c) => c[2]);
    const a = pick(1);
    const b = pick(1.0001);
    assert.ok(a.length >= 20);
    return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  };
  assert.ok(wobble({}) > 0.001, 'wackelt');
  assert.equal(wobble({ reduceMotion: true }), 0, 'ohne Wackeln bei reduceMotion');
  // kein s.combo
  const s = scene();
  delete s.combo;
  assert.doesNotThrow(() => draw(s));
  s.combo = 5;
  assert.doesNotThrow(() => draw(s));
  // tot: keine Aura
  assert.equal(quad(6, { dead: true }) - count(draw(scene({ player: { dead: true } })).log, 'quadraticCurveTo'), 0);
});

test('Ring Partikel mit sq werden als flache Ellipse gezeichnet, ohne sq als Kreis', () => {
  const ring = (sq) => {
    const s = offscreen(scene());
    s.particles.push({ x: s.camX + 400, y: 300, vx: 0, vy: 0, life: 1, max: 1, size: 40, color: '#ffffff', shape: 'ring', g: 0, drag: 0, rot: 0, vr: 0, alpha: 0.8, ...(sq === undefined ? {} : { sq }) });
    return draw(s).log;
  };
  const flat = ring(0.3);
  const e = flat.find((c) => c[0] === 'ellipse');
  assert.ok(e && Math.abs(e[3] - 40) < 1e-9 && Math.abs(e[4] - 12) < 1e-9, 'Breite 40, Höhe 12');
  assert.equal(count(flat, 'arc'), 0);
  assert.equal(count(ring(), 'arc'), 1, 'rund bleibt rund');
  assert.equal(count(ring(1), 'ellipse'), 0);
  for (const bad of [0, -1, NaN, 'x', 5]) assert.equal(count(ring(bad), 'ellipse'), 0, String(bad));
});

test('neue Partikel Presets zeichnen sich gültig, bei voller Liste im Budget', () => {
  const s = scene({
    enemies: KINDS.concat(KINDS).slice(0, LIMITS.MAX_ENEMIES_ACTIVE).map((kind) => ({ kind, telegraph: 0.7, state: kind === 'flyer' || kind === 'hailcloud' ? 'windup' : 'patrol' })),
    player: { ammo: 3, wet: 1, trail: 1, glide: true, glideT: 0.3, onGround: false, y: 220, power: { shield: true, dashT: 5, magnetT: 5, feather: 2, double: 5 } },
  });
  s.combo.count = 7;
  s.combo.timer = 2;
  for (let i = 0; i < 4; i++) s.shots.push(shotAt(s, 100 + i * 120, 150 + i * 30));
  let i = 0;
  const names = PRESET_NAMES;
  while (s.particles.length < LIMITS.MAX_PARTICLES) emit(s, names[i++ % names.length], s.camX + 40 + ((i * 37) % 720), 60 + ((i * 53) % 330), { dir: i % 2 ? 1 : -1, strength: (i % 5) / 4 });
  assert.equal(s.particles.length, LIMITS.MAX_PARTICLES);
  const c = draw(s);
  // Schlimmster Fall: neun Gegner, vier Wurfsterne, alle Auren und 260 Partikel
  assert.ok(calls(c.log) < 2500, `${calls(c.log)} Aufrufe`);
  assert.ok(c.stats.gradients < 70, `${c.stats.gradients} Verläufe`);
  const m = createMockCtx();
  drawCharacters(m, s, viewOf(s));
  assert.ok(m.calls.length < 2500, `${m.calls.length} Aufrufe mit dem Mock Kontext`);
  const calm = draw(s, { reduceMotion: true });
  assert.ok(calls(calm.log) <= calls(c.log), 'bei reduceMotion nicht mehr');
});

test('alle neuen Nimbus Zustände zusammen zeichnen ohne Fehler, mit ausgeglichenem save und restore', () => {
  let n = 0;
  for (const glide of [false, true]) {
    for (const slam of [false, true]) {
      for (const dashing of [false, true]) {
        for (const rainbow of [false, true]) {
          for (const ammo of [0, 1, 3]) {
            for (const dbl of [0, 0.5, 8]) {
              for (const combo of [0, 3, 9]) {
                for (const throwCd of [0, 0.34, 0.2]) {
                  for (const dead of [false, true]) {
                    for (const reduceMotion of [false, true]) {
                      const s = scene({
                        player: {
                          dead, glide, glideT: 0.4, onGround: n % 3 === 0, face: n % 2 ? -1 : 1, ammo, throwCd, vx: n % 4 === 0 ? 300 : -120, vy: n % 5 ? 200 : -300,
                          slam: { active: slam, t: 0.1 }, dash: { t: dashing ? 0.1 : 0, dir: n % 2 ? 1 : -1, rainbow }, trail: dashing ? 1 : 0.2,
                          power: { double: dbl, shield: n % 7 === 0, feather: n % 3 },
                        },
                      });
                      s.combo.count = combo;
                      s.combo.timer = 1;
                      s.deathT = (n % 5) * 0.3;
                      const c = draw(s, { reduceMotion, time: n * 0.173 });
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
    }
  }
  assert.ok(n >= 3000);
});

test('die Zeichnung der neuen Teile verändert den Zustand nicht', () => {
  const s = scene({
    enemies: KINDS.map((kind) => ({ kind, telegraph: 0.6, state: kind === 'hailcloud' ? 'windup' : kind === 'flyer' ? 'fly' : 'patrol' })),
    player: { ammo: 2, glide: true, glideT: 0.2, throwCd: 0.3, power: { double: 4 }, onGround: false, y: 240 },
  });
  s.combo.count = 5;
  s.shots.push(shotAt(s, 300), shotAt(s, 400));
  for (let i = 0; i < 40; i++) emit(s, PRESET_NAMES[i % PRESET_NAMES.length], s.camX + 100 + i * 10, 150);
  const before = structuredClone(s);
  const a = draw(s, { debug: true, time: 5.5 });
  const b = draw(s, { debug: true, time: 5.5 });
  assert.deepEqual(s, before);
  assert.deepEqual(a.log, b.log);
});

test('im echten Spiel mit allen Fähigkeiten: Zeichnen bleibt gültig', () => {
  const s = newGame(31);
  s.player.ammo = 3;
  s.combo.count = 4;
  s.combo.timer = 3;
  let drawn = 0;
  for (let chunk = 0; chunk < 30; chunk++) {
    run(s, 25, (st, i) => input({ move: 1, jumpPressed: i % 25 === 0, jumpHeld: i % 25 < 20, dashPressed: i === 12, slamPressed: chunk % 4 === 3 && i === 8, throwPressed: i === 3 && chunk % 2 === 0 }));
    s.combo.timer = 3;
    s.combo.count = 3 + (chunk % 5);
    s.player.ammo = Math.max(s.player.ammo, 1);
    const c = strictCtx();
    drawCharacters(c.ctx, s, viewOf(s, { time: chunk * 0.31, reduceMotion: chunk % 5 === 0, debug: chunk % 6 === 0 }));
    assert.equal(c.stack.length, 0);
    drawn++;
    if (s.mode === 'over') break;
  }
  assert.ok(drawn >= 8);
});
