// Tests für game/particles.js ohne Browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, STEP } from '../game/constants.js';
import { PRESET_NAMES, emit, updateParticles } from '../game/particles.js';
import { createState } from '../game/state.js';
import { initGenerator } from '../game/generator.js';
import { stepSim } from '../game/sim.js';
import { invariants } from './helpers.mjs';

const CONTRACT = ['land', 'jump', 'doublejump', 'star', 'stomp', 'break', 'hurt', 'spark', 'shield', 'shieldbreak', 'gate', 'magnet', 'confetti', 'poof', 'dash', 'rain', 'windline', 'meteor'];
const SHAPES = new Set(['dot', 'star', 'cloud', 'line', 'drop', 'ring']);
const FIELDS = ['x', 'y', 'vx', 'vy', 'life', 'max', 'size', 'g', 'drag', 'rot', 'vr', 'alpha'];

const fresh = (seed = 7) => createState({ seed });
const allFinite = (p) => FIELDS.every((k) => Number.isFinite(p[k]));

function simulate(s, seconds, dt = STEP) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) updateParticles(s, dt);
}

test('alle Presets aus dem Vertrag sind vorhanden', () => {
  assert.deepEqual([...PRESET_NAMES].sort(), [...CONTRACT].sort());
});

test('jedes Preset erzeugt Partikel mit gültigen Feldern und Formen', () => {
  for (const name of CONTRACT) {
    const s = fresh();
    const n = emit(s, name, 300, 200);
    assert.ok(n >= 1, `${name} erzeugt nichts`);
    assert.equal(s.particles.length, n, name);
    for (const p of s.particles) {
      assert.ok(SHAPES.has(p.shape), `${name}: Form ${p.shape}`);
      assert.ok(allFinite(p), `${name}: Feld nicht endlich`);
      assert.ok(typeof p.color === 'string' && p.color.length >= 4, `${name}: Farbe`);
      assert.ok(p.life > 0 && p.max === p.life, `${name}: Leben`);
      assert.ok(p.size > 0, `${name}: Größe`);
      assert.ok(p.alpha >= 0 && p.alpha <= 1, `${name}: Alpha ${p.alpha}`);
    }
  }
});

test('die Anzahl pro Preset ist moderat', () => {
  for (const name of CONTRACT) {
    const s = fresh();
    const n = emit(s, name, 0, 0);
    assert.ok(n <= 14, `${name}: ${n} Partikel`);
    // Dauerpresets (jeden Schritt oder Takt aufgerufen) dürfen kleiner sein
    const sparse = ['magnet', 'rain', 'dash', 'windline'];
    assert.ok(n >= (sparse.includes(name) ? 1 : 3), `${name}: nur ${n} Partikel`);
  }
});

test('emit verändert s.rng nie, auch nicht bei vielen Aufrufen', () => {
  const s = fresh();
  const before = s.rng;
  for (let i = 0; i < 400; i++) emit(s, CONTRACT[i % CONTRACT.length], i, i * 0.5, { color: '#ff0000', dir: i % 2 ? 1 : -1 });
  updateParticles(s, STEP);
  assert.equal(s.rng, before);
  assert.ok(Number.isInteger(s.particleSeq) && s.particleSeq > 0, 'eigener Zähler zählt hoch');
});

test('der Zufall hängt nur von particleSeq ab: gleiche Aufrufe, gleiche Partikel', () => {
  const a = fresh(1);
  const b = fresh(999);
  for (const s of [a, b]) {
    for (const name of CONTRACT) emit(s, name, 123, 45);
    simulate(s, 0.2);
  }
  assert.deepEqual(a.particles, b.particles);
  assert.equal(a.particleSeq, b.particleSeq);
  const c = structuredClone(a);
  emit(a, 'confetti', 5, 5);
  emit(c, 'confetti', 5, 5);
  assert.deepEqual(a.particles, c.particles, 'nach structuredClone geht es identisch weiter');
});

test('Partikel zu erzeugen ändert den Spielverlauf nicht', () => {
  const play = (withFx) => {
    const s = createState({ seed: 5 });
    initGenerator(s);
    for (let i = 0; i < 240; i++) {
      if (withFx && i % 3 === 0) emit(s, CONTRACT[i % CONTRACT.length], s.camX + 100, 200);
      stepSim(s, { move: 1, jumpPressed: i % 50 === 0, jumpHeld: i % 50 < 20, dashPressed: false }, STEP);
    }
    return [s.rng, s.player.x, s.player.y, s.platforms.length, s.enemies.length, s.stars.length, s.run.maxX];
  };
  assert.deepEqual(play(true), play(false));
});

test('das Limit MAX_PARTICLES wird nie überschritten', () => {
  const s = fresh();
  for (let i = 0; i < 300; i++) {
    emit(s, CONTRACT[i % CONTRACT.length], i, 100);
    assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES, `Schritt ${i}: ${s.particles.length}`);
  }
  assert.equal(s.particles.length, LIMITS.MAX_PARTICLES, 'die Liste ist voll, aber nicht darüber');
});

test('bei Überlauf fliegen die ältesten raus, die neuesten bleiben', () => {
  const s = fresh();
  while (s.particles.length < LIMITS.MAX_PARTICLES) emit(s, 'confetti', 1, 1);
  const oldest = s.particles[0];
  const n = emit(s, 'hurt', 777, 777);
  assert.ok(n > 0);
  assert.equal(s.particles.length, LIMITS.MAX_PARTICLES);
  assert.ok(!s.particles.includes(oldest), 'der älteste Partikel ist weg');
  const tail = s.particles.slice(-n);
  assert.ok(tail.every((p) => p.x >= 700), 'die neuen stehen am Ende');
});

test('Stimmungseffekte drängen bei vollem Speicher keine anderen Effekte raus', () => {
  const s = fresh();
  while (s.particles.length < LIMITS.MAX_PARTICLES) emit(s, 'confetti', 1, 1);
  const first = s.particles[0];
  for (const name of ['rain', 'windline', 'magnet']) assert.equal(emit(s, name, 5, 5), 0, name);
  assert.equal(s.particles[0], first);
  assert.equal(s.particles.length, LIMITS.MAX_PARTICLES);
});

test('Spam: tausende Aufrufe pro Schritt bleiben im Limit, endlich und schnell', () => {
  const s = fresh();
  const t0 = performance.now();
  for (let frame = 0; frame < 30; frame++) {
    for (let i = 0; i < 1000; i++) emit(s, CONTRACT[(i * 7 + frame) % CONTRACT.length], i % 800, (i * 3) % 450, { color: i % 5 === 0 ? '#abcdef' : undefined });
    assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES);
    updateParticles(s, STEP);
    assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES);
  }
  assert.ok(s.particles.every(allFinite));
  assert.ok(performance.now() - t0 < 2000, 'Spam darf nicht langsam werden');
});

test('updateParticles bewegt: Schwerkraft, Dämpfung, Rotation und Wachstum', () => {
  const s = fresh();
  s.particles.push({ x: 0, y: 0, vx: 100, vy: 0, life: 2, max: 2, size: 4, color: '#fff', shape: 'dot', g: 500, drag: 0, rot: 0, vr: 3, alpha: 1 });
  s.particles.push({ x: 0, y: 0, vx: 100, vy: 0, life: 2, max: 2, size: 4, color: '#fff', shape: 'dot', g: 0, drag: 4, rot: 0, vr: 0, alpha: 1, grow: 10 });
  simulate(s, 0.5);
  const [a, b] = s.particles;
  assert.ok(a.vy > 200 && a.y > 20, 'fällt');
  assert.ok(Math.abs(a.vx - 100) < 1e-6, 'ohne Dämpfung bleibt vx');
  assert.ok(Math.abs(a.rot - 1.5) < 0.05, `dreht sich ${a.rot}`);
  assert.ok(b.vx < 30 && b.x > 10 && b.x < 25, `gedämpft ${b.vx} ${b.x}`);
  assert.ok(Math.abs(b.size - 9) < 0.2, `wächst ${b.size}`);
});

test('abgelaufene Partikel werden entfernt, die Liste bleibt dieselbe', () => {
  const s = fresh();
  emit(s, 'poof', 10, 10);
  emit(s, 'spark', 10, 10);
  const list = s.particles;
  const start = list.length;
  assert.ok(start > 8);
  simulate(s, 0.45);
  assert.ok(s.particles.length < start, 'kurzlebige sind weg');
  assert.equal(s.particles, list, 'keine neue Liste pro Schritt');
  simulate(s, 3);
  assert.equal(s.particles.length, 0, 'nach drei Sekunden ist alles verschwunden');
});

test('alle Presets bleiben über ihre ganze Lebensdauer endlich und Alpha liegt in 0 bis 1', () => {
  for (const name of CONTRACT) {
    const s = fresh();
    emit(s, name, 400, 100, { dir: -1 });
    for (let i = 0; i < 200 && s.particles.length; i++) {
      updateParticles(s, STEP);
      for (const p of s.particles) {
        assert.ok(allFinite(p), `${name} Schritt ${i}`);
        assert.ok(p.alpha >= 0 && p.alpha <= 1, `${name} alpha ${p.alpha}`);
        assert.ok(p.size >= 0, `${name} size ${p.size}`);
      }
    }
    assert.equal(s.particles.length, 0, `${name} lebt zu lange`);
  }
});

test('Alpha steigt am Anfang an und fällt am Ende auf fast 0', () => {
  const s = fresh();
  emit(s, 'land', 0, 0);
  const p = s.particles[0];
  const a0 = p.alpha;
  updateParticles(s, 0.05);
  assert.ok(p.alpha > a0, 'blendet ein');
  let last = p.alpha;
  while (p.life > 0.06) {
    updateParticles(s, 0.01);
    if (!s.particles.includes(p)) break;
    last = p.alpha;
  }
  assert.ok(last < 0.25, `blendet aus ${last}`);
});

test('opts.color färbt das Preset, opts.dir dreht die Windlinie', () => {
  const s = fresh();
  emit(s, 'star', 0, 0, { color: '#123456' });
  const own = s.particles.filter((p) => p.color === '#123456').length;
  assert.ok(own >= s.particles.length * 0.5, 'überwiegend die gewünschte Farbe');
  const r = fresh();
  emit(r, 'windline', 100, 100, { dir: 1 });
  emit(r, 'windline', 100, 100, { dir: -1 });
  const [a, b] = [r.particles.slice(0, 2), r.particles.slice(2)];
  assert.ok(a.every((p) => p.vx > 0) && b.every((p) => p.vx < 0));
  assert.ok(a.every((p) => p.sky === 1), 'Windlinien hängen am Bildschirm');
});

test('Sternschnuppen hängen am Bildschirm und zeigen schräg nach links unten', () => {
  const s = fresh();
  s.camX = 1000;
  emit(s, 'meteor', 1400, 50);
  assert.ok(s.particles.every((p) => p.sky === 1 && p.cam === 1000));
  const head = s.particles.find((p) => p.shape === 'star');
  assert.ok(head.vx < 0 && head.vy > 0);
  const lines = s.particles.filter((p) => p.shape === 'line');
  assert.ok(lines.length >= 4);
  assert.ok(lines.every((p) => Math.abs(p.rot - Math.atan2(head.vy, head.vx)) < 1e-9), 'Schweif liegt in Flugrichtung');
});

test('Regentropfen fallen schräg nach unten', () => {
  const s = fresh();
  emit(s, 'rain', 10, 90);
  assert.equal(s.particles.length, 1);
  const p = s.particles[0];
  assert.equal(p.shape, 'drop');
  assert.ok(p.vy > 250 && p.vx > 0 && p.vx < p.vy * 0.3);
});

test('ungültige Eingaben werfen nicht und ändern nichts', () => {
  const s = fresh();
  for (const bad of [NaN, Infinity, undefined, null, 'x']) {
    assert.equal(emit(s, 'star', bad, 5), 0);
    assert.equal(emit(s, 'star', 5, bad), 0);
  }
  assert.equal(emit(s, 'gibt-es-nicht', 1, 1), 0);
  assert.equal(emit(s, 'constructor', 1, 1), 0);
  assert.equal(emit(s, 'toString', 1, 1), 0);
  assert.equal(emit(s, undefined, 1, 1), 0);
  assert.equal(s.particles.length, 0);
  assert.equal(s.particleSeq, undefined, 'ohne Erzeugung kein Zähler');
  assert.doesNotThrow(() => emit(s, 'star', 1, 1, null));
  assert.doesNotThrow(() => emit(s, 'star', 1, 1, { color: 5, dir: 'x' }));
  s.particleSeq = NaN;
  assert.doesNotThrow(() => emit(s, 'poof', 1, 1));
  assert.ok(Number.isInteger(s.particleSeq));
  s.particles = undefined;
  assert.doesNotThrow(() => emit(s, 'poof', 1, 1));
  assert.ok(Array.isArray(s.particles));
  for (const dt of [0, -1, NaN, undefined]) {
    const n = s.particles.length;
    updateParticles(s, dt);
    assert.equal(s.particles.length, n);
  }
  assert.doesNotThrow(() => updateParticles({}, STEP));
  assert.doesNotThrow(() => updateParticles({ particles: [] }, STEP));
});

test('kaputte Partikel in der Liste werden entfernt, handgemachte Partikel laufen normal', () => {
  const s = fresh();
  s.particles.push({ x: NaN, y: 0, vx: 0, vy: 0, life: 1, max: 1, size: 3, color: '#fff', shape: 'dot', g: 0, drag: 0, rot: 0, vr: 0, alpha: 1 });
  s.particles.push(null);
  s.particles.push({ x: 1, y: 1, vx: 10, vy: 0, life: 1, size: 3, color: '#fff', shape: 'dot', alpha: 0.8 });
  updateParticles(s, STEP);
  assert.equal(s.particles.length, 1);
  const p = s.particles[0];
  assert.ok(Number.isFinite(p.alpha) && p.alpha > 0 && p.alpha <= 0.8, `alpha ${p.alpha}`);
  assert.ok(p.x > 1);
});

test('ein riesiger Zeitschritt wird gekappt und bleibt endlich', () => {
  const s = fresh();
  emit(s, 'stomp', 0, 0);
  updateParticles(s, 1e9);
  assert.ok(s.particles.every(allFinite));
});

test('der Zustand bleibt kopierbar und besteht nur aus Daten', () => {
  const s = fresh();
  for (const name of CONTRACT) emit(s, name, 50, 50);
  const copy = structuredClone(s);
  assert.deepEqual(copy.particles, s.particles);
  for (const p of s.particles) for (const v of Object.values(p)) assert.ok(['number', 'string', 'boolean'].includes(typeof v));
});

test('ein langer Lauf mit dem echten Spiel hält das Limit ein', () => {
  const s = createState({ seed: 11 });
  initGenerator(s);
  for (let i = 0; i < 1500; i++) {
    stepSim(s, { move: 1, jumpPressed: i % 40 === 0, jumpHeld: i % 40 < 18, dashPressed: false }, STEP);
    if (s.mode === 'over') break;
    assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES);
  }
  assert.deepEqual(invariants(s), []);
});
