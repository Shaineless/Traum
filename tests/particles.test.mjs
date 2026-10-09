// Tests für game/particles.js ohne Browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, STEP } from '../game/constants.js';
import { PRESET_NAMES, emit, updateParticles } from '../game/particles.js';
import { createState } from '../game/state.js';
import { initGenerator } from '../game/generator.js';
import { stepSim } from '../game/sim.js';
import { invariants } from './helpers.mjs';

const BASE = ['land', 'jump', 'doublejump', 'star', 'stomp', 'break', 'hurt', 'spark', 'shield', 'shieldbreak', 'gate', 'magnet', 'confetti', 'poof', 'dash', 'rain', 'windline', 'meteor'];
const NEW = ['slam', 'spring', 'glide', 'throw', 'shotTrail', 'comet', 'hail', 'ice', 'blink', 'starcharge', 'combo', 'crit'];
const CONTRACT = [...BASE, ...NEW];
// Dauereffekte, die jeden Schritt oder Takt aufgerufen werden und darum klein sind (und bei vollem Speicher still bleiben)
const SPARSE = ['magnet', 'rain', 'dash', 'windline', 'glide', 'shotTrail', 'combo', 'ice'];
const AMBIENT_NAMES = ['rain', 'windline', 'magnet', 'glide', 'shotTrail', 'ice', 'combo'];
// Große Wirkungseffekte dürfen mehr Partikel haben als die kleinen (Obergrenze pro Aufruf)
const BIG = { stomp: 24, slam: 26, comet: 22, crit: 26, hail: 14, spring: 14, blink: 12, starcharge: 12, throw: 12 };
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
    assert.ok(n <= (BIG[name] || 14), `${name}: ${n} Partikel`);
    // Dauerpresets (jeden Schritt oder Takt aufgerufen) dürfen kleiner sein
    assert.ok(n >= (SPARSE.includes(name) ? 1 : 3), `${name}: nur ${n} Partikel`);
  }
  // Slam, Stomp, Komet und Crit sind kräftig
  for (const name of ['slam', 'stomp', 'comet', 'crit']) {
    const s = fresh();
    assert.ok(emit(s, name, 0, 0) >= 16, `${name} soll kräftig sein`);
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
  for (const name of AMBIENT_NAMES) assert.equal(emit(s, name, 5, 5), 0, name);
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

// ---------- neue Presets ----------

const emitted = (name, opts, x = 400, y = 300, s = fresh()) => {
  emit(s, name, x, y, opts);
  return s.particles;
};
const mean = (list, key) => list.reduce((a, p) => a + p[key], 0) / list.length;

test('land: ohne strength wie bisher, mit strength mehr Staub und ein flacher Ring', () => {
  const soft = emitted('land');
  assert.equal(soft.length, 6);
  assert.ok(soft.every((p) => p.shape === 'cloud'));
  assert.equal(emitted('land', { strength: 0 }).length, 6, 'strength 0 ist die weiche Landung');
  let last = 6;
  for (const k of [0.25, 0.5, 0.75, 1]) {
    const n = emitted('land', { strength: k }).length;
    assert.ok(n >= last, `strength ${k}: ${n} nach ${last}`);
    last = n;
  }
  const hard = emitted('land', { strength: 1 });
  assert.ok(hard.length > 10 && hard.length <= 14, `${hard.length}`);
  const ring = hard.filter((p) => p.shape === 'ring');
  assert.equal(ring.length, 1);
  assert.ok(ring[0].sq > 0 && ring[0].sq < 1, 'flacher Ring am Boden');
  assert.ok(ring[0].grow > 100, 'der Ring breitet sich aus');
  assert.ok(Math.max(...hard.map((p) => Math.abs(p.vx))) > Math.max(...soft.map((p) => Math.abs(p.vx))), 'harte Landung wirft den Staub weiter');
  // ungültige Werte werden geklemmt oder ignoriert
  assert.equal(emitted('land', { strength: 7 }).length, hard.length, 'über 1 zählt als 1');
  assert.equal(emitted('land', { strength: -3 }).length, 6, 'unter 0 zählt als 0');
  assert.equal(emitted('land', { strength: NaN }).length, 6);
  assert.equal(emitted('land', { strength: 'stark' }).length, 6);
});

test('Ringe mit sq sind flache Ellipsen, sq liegt immer zwischen 0 und 1 und gehört nur zu Ringen', () => {
  const s = fresh();
  for (const name of CONTRACT) emit(s, name, 100, 100, { strength: 1, dir: 1 });
  emit(s, 'blink', 100, 100, { dir: -1 });
  const withSq = s.particles.filter((p) => p.sq !== undefined);
  assert.ok(withSq.length >= 6, 'mehrere Presets legen Ringe flach');
  for (const p of withSq) {
    assert.equal(p.shape, 'ring');
    assert.ok(p.sq > 0 && p.sq < 1, `sq ${p.sq}`);
  }
  assert.ok(s.particles.filter((p) => p.shape === 'ring' && p.sq === undefined).length >= 4, 'runde Ringe bleiben rund');
});

test('slam: Schockwelle als Ringe, Staub nach links und rechts, Funken nach oben', () => {
  const list = emitted('slam');
  assert.ok(list.length >= 18 && list.length <= BIG.slam, `${list.length}`);
  const rings = list.filter((p) => p.shape === 'ring');
  assert.ok(rings.length >= 2 && rings.every((p) => p.sq < 0.4 && p.grow > 150), 'flache, schnell wachsende Ringe');
  const dust = list.filter((p) => p.shape === 'cloud');
  assert.ok(dust.filter((p) => p.vx < -120).length >= 4 && dust.filter((p) => p.vx > 120).length >= 4, 'Staub in beide Richtungen');
  assert.ok(dust.every((p) => p.size >= 8 && p.grow > 20), 'große weiche Wolken');
  const sparks = list.filter((p) => p.shape === 'line' || p.shape === 'star');
  assert.ok(sparks.filter((p) => p.vy < -100).length >= 4, 'Funken schießen nach oben');
  // der Ring reicht etwa so weit wie die Schockwelle (SLAM.RADIUS 112)
  const main = rings.reduce((a, p) => (p.grow * p.life > a.grow * a.life ? p : a));
  assert.ok(main.size + main.grow * main.life > 100 && main.size + main.grow * main.life < 160);
  assert.ok(list.length > emitted('land', { strength: 1 }).length, 'kräftiger als eine harte Landung');
});

test('stomp ist stärker als zuvor: mehr Fetzen, Funken, Strichfunken und ein Stoßring', () => {
  const list = emitted('stomp');
  assert.ok(list.length >= 18);
  assert.ok(list.some((p) => p.shape === 'ring'));
  assert.ok(list.filter((p) => p.shape === 'cloud').length >= 8);
  assert.ok(list.filter((p) => p.shape === 'line').length >= 4);
  assert.ok(list.filter((p) => p.shape === 'star').length >= 4);
});

test('spring: flache Ringe und Funken, die nach oben schießen', () => {
  const list = emitted('spring');
  const rings = list.filter((p) => p.shape === 'ring');
  assert.equal(rings.length, 3, 'drei federnde Ringe');
  assert.ok(rings.every((p) => p.sq < 1 && p.grow > 100));
  assert.ok(rings[1].life > rings[0].life && rings[2].life > rings[1].life, 'nacheinander');
  const up = list.filter((p) => (p.shape === 'star' || p.shape === 'line') && p.vy < -250);
  assert.ok(up.length >= 5, `${up.length} schnelle Funken nach oben`);
});

test('glide: genau zwei weiche Wolkenpuffer, hinter Nimbus wenn dir gesetzt ist', () => {
  assert.equal(emitted('glide').length, 2);
  const behind = (dir) => {
    const s = fresh();
    for (let i = 0; i < 80; i++) emit(s, 'glide', 400, 300, { dir });
    return mean(s.particles, 'vx');
  };
  assert.ok(behind(1) < -15, 'Flug nach rechts: Puffer bleiben links');
  assert.ok(behind(-1) > 15, 'Flug nach links: Puffer bleiben rechts');
  assert.ok(emitted('glide').every((p) => p.shape === 'cloud' && p.size < 7 && p.a0 <= 0.6), 'klein und blass');
});

test('throw: Sternchen und Strichfunken in Wurfrichtung', () => {
  for (const dir of [1, -1]) {
    const list = emitted('throw', { dir });
    assert.ok(list.length >= 8 && list.length <= BIG.throw);
    const fast = list.filter((p) => p.shape === 'star' || p.shape === 'line');
    assert.ok(fast.every((p) => p.vx * dir > 50), `Richtung ${dir}`);
    assert.ok(list.filter((p) => p.shape === 'line').every((p) => Math.abs(Math.cos(p.rot) * dir - 1) < 0.25), 'Striche zeigen in Wurfrichtung');
    const puff = list.filter((p) => p.shape === 'cloud');
    assert.ok(puff.length >= 1 && puff.every((p) => p.vx * dir < 0), 'Rückstoß Wölkchen fliegt nach hinten');
  }
});

test('shotTrail: zwei kleine Funken, die hinter dem Stern zurückbleiben', () => {
  assert.equal(emitted('shotTrail', { dir: 1 }).length, 2);
  const s = fresh();
  for (let i = 0; i < 100; i++) emit(s, 'shotTrail', 400, 300, { dir: 1 });
  assert.ok(mean(s.particles, 'vx') < -3, 'bleibt hinter einem Stern zurück, der nach rechts fliegt');
  const t = fresh();
  for (let i = 0; i < 100; i++) emit(t, 'shotTrail', 400, 300, { dir: -1 });
  assert.ok(mean(t.particles, 'vx') > 3);
  assert.ok(s.particles.every((p) => p.size < 4 && p.life < 0.55), 'kurzlebig und klein');
  assert.ok(s.particles.some((p) => p.glow === 1), 'leuchtet leicht');
});

test('comet: Glutringe, Glut mit Schwerkraft, Funken und dunkler Rauch', () => {
  const list = emitted('comet');
  assert.ok(list.length >= 16 && list.length <= BIG.comet);
  const rings = list.filter((p) => p.shape === 'ring');
  assert.equal(rings.length, 2);
  assert.ok(rings.every((p) => p.sq < 0.5));
  const embers = list.filter((p) => p.shape === 'dot');
  assert.ok(embers.length >= 6 && embers.every((p) => p.g > 400 && p.vy < 0), 'Glut fliegt nach oben und fällt zurück');
  assert.ok(list.filter((p) => p.shape === 'cloud').length >= 3, 'Rauch');
  assert.ok(list.some((p) => p.shape === 'star' && p.glow === 1));
  assert.ok(list.every((p) => p.life <= 1.4), 'vorbei in unter eineinhalb Sekunden');
});

test('hail: kleine Eissplitter in kühlen Farben, ein Schneepuff', () => {
  const list = emitted('hail');
  assert.ok(list.length >= 8 && list.length <= BIG.hail);
  assert.ok(list.filter((p) => p.shape === 'line').length >= 5, 'Splitter');
  const cold = (c) => { const n = parseInt(c.slice(5, 7), 16); const r = parseInt(c.slice(1, 3), 16); return n >= r; }; // Blau mindestens so stark wie Rot
  assert.ok(list.every((p) => /^#[0-9a-f]{6}$/i.test(p.color) && cold(p.color)), 'alle Farben sind weiß bis eisblau');
  assert.ok(list.some((p) => p.shape === 'cloud'), 'Schneepuff');
  assert.ok(list.every((p) => p.life < 0.8), 'schnell vorbei');
});

test('ice: wenige kleine Eiskristall Sterne, die leicht schweben', () => {
  const list = emitted('ice');
  assert.ok(list.length >= 3 && list.length <= 6);
  assert.ok(list.filter((p) => p.shape === 'star').length >= 3);
  assert.ok(list.every((p) => p.size <= 4.2 && p.vy < 0), 'steigen leicht');
});

test('blink: Auftauchen dehnt sich aus, Verschwinden zieht sich zusammen', () => {
  const appear = emitted('blink', { dir: 1 });
  const vanish = emitted('blink', { dir: -1 });
  for (const list of [appear, vanish]) {
    assert.ok(list.length >= 8 && list.length <= BIG.blink);
    assert.equal(list.filter((p) => p.shape === 'ring').length, 1);
    assert.ok(list.filter((p) => p.shape === 'cloud').length >= 6);
  }
  assert.ok(appear.find((p) => p.shape === 'ring').grow > 0);
  assert.ok(vanish.find((p) => p.shape === 'ring').grow < 0, 'der Ring schrumpft');
  // Beim Verschwinden zeigen die Staubwolken zur Mitte, beim Auftauchen sind sie zufällig verteilt
  const inward = vanish.filter((p) => p.shape === 'cloud').every((p) => (p.x - 400) * p.vx < 0);
  assert.ok(inward, 'Staub fließt nach innen');
  for (const p of vanish) assert.ok(p.size > 0);
  // Ohne dir: wie Auftauchen
  assert.ok(emitted('blink').find((p) => p.shape === 'ring').grow > 0);
});

test('starcharge: Ringe ziehen sich zusammen, goldenes Aufleuchten in der Mitte', () => {
  const list = emitted('starcharge');
  assert.ok(list.length >= 8 && list.length <= BIG.starcharge);
  const rings = list.filter((p) => p.shape === 'ring');
  assert.equal(rings.length, 2);
  assert.ok(rings.every((p) => p.grow < 0 && p.size + p.grow * p.life > 0), 'schrumpfen, ohne negativ zu werden');
  const flash = list.find((p) => p.shape === 'star' && p.size >= 6);
  assert.ok(flash && flash.glow === 1 && flash.x === 400 && flash.y === 300, 'großer leuchtender Stern im Zentrum');
});

test('combo: zwei Sterne, bei strength über 0,66 drei, sie bleiben hinter Nimbus zurück', () => {
  assert.equal(emitted('combo').length, 2);
  assert.equal(emitted('combo', { strength: 0.5 }).length, 2);
  assert.equal(emitted('combo', { strength: 1 }).length, 3);
  const s = fresh();
  for (let i = 0; i < 100; i++) emit(s, 'combo', 400, 300, { dir: 1 });
  assert.ok(mean(s.particles, 'vx') < -20);
  assert.ok(s.particles.every((p) => p.shape === 'star' && p.glow === 1));
  const colors = new Set(s.particles.map((p) => p.color));
  assert.ok(colors.size >= 3, 'bunt: Gold, Rosa, Weiß');
});

test('crit: Ringe, Sterne und Strichfunken, ab strength 0,5 drei Ringe', () => {
  const full = emitted('crit');
  assert.ok(full.length >= 20 && full.length <= BIG.crit, `${full.length}`);
  assert.equal(full.filter((p) => p.shape === 'ring').length, 3);
  assert.ok(full.filter((p) => p.shape === 'star').length >= 8);
  assert.ok(full.filter((p) => p.shape === 'line').length >= 5);
  assert.equal(emitted('crit', { strength: 0.3 }).filter((p) => p.shape === 'ring').length, 2);
  assert.equal(emitted('crit', { strength: 0.51 }).filter((p) => p.shape === 'ring').length, 3);
  assert.ok(full.filter((p) => p.shape === 'ring').every((p) => p.sq === undefined), 'runde Ringe');
  assert.ok(full.every((p) => p.life < 1.3));
});

test('bei vollem Speicher werden die Hauptringe der großen Effekte nie ausgedünnt', () => {
  for (const name of ['slam', 'comet', 'crit', 'spring', 'starcharge', 'blink']) {
    let rings = 0;
    for (let trial = 0; trial < 20; trial++) {
      const s = fresh(trial + 1);
      while (s.particles.length < Math.ceil(LIMITS.MAX_PARTICLES * 0.8)) emit(s, 'confetti', 1, 1);
      const before = s.particles.length;
      const n = emit(s, name, 500, 500);
      assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES);
      const fresh_ = s.particles.slice(-n);
      assert.ok(fresh_.some((p) => p.shape === 'ring'), `${name}: der Hauptring fehlt (Versuch ${trial})`);
      rings++;
      assert.ok(n >= 1 && s.particles.length >= before - n);
    }
    assert.equal(rings, 20);
  }
  // Der Rest wird bei vollem Speicher dünner: im Mittel weniger Partikel als bei leerem Speicher
  const avg = (fill) => {
    let sum = 0;
    for (let trial = 0; trial < 30; trial++) {
      const s = fresh(trial + 5);
      while (s.particles.length < fill) emit(s, 'confetti', 1, 1);
      sum += emit(s, 'slam', 500, 500);
    }
    return sum / 30;
  };
  assert.ok(avg(Math.ceil(LIMITS.MAX_PARTICLES * 0.8)) < avg(0) - 4, 'dünner bei vollem Speicher');
});

test('neue Presets mit wilden Optionen bleiben endlich und im Limit', () => {
  const s = fresh();
  const wild = [undefined, null, {}, { dir: NaN }, { dir: -Infinity }, { strength: NaN }, { strength: -5 }, { strength: 1e9 }, { color: '' }, { color: 7 }, { dir: 'x', strength: 'y' }, { color: '#123456', dir: -1, strength: 0.5 }];
  for (let round = 0; round < 40; round++) {
    for (const name of NEW) {
      for (const o of wild) emit(s, name, round * 7, 100 + round, o);
      assert.ok(s.particles.length <= LIMITS.MAX_PARTICLES);
    }
    updateParticles(s, STEP);
  }
  assert.ok(s.particles.every(allFinite));
  assert.ok(s.particles.every((p) => p.size >= 0 && p.alpha >= 0 && p.alpha <= 1));
});

test('alle neuen Presets sind deterministisch und verändern s.rng nie', () => {
  const run = () => {
    const s = fresh(42);
    const rng = s.rng;
    for (const name of NEW) emit(s, name, 123, 45, { dir: -1, strength: 0.8 });
    simulate(s, 0.3);
    assert.equal(s.rng, rng);
    return s;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.particles, b.particles);
  assert.equal(a.particleSeq, b.particleSeq);
});

test('opts.color färbt auch die neuen Presets überwiegend', () => {
  for (const name of ['throw', 'spring', 'crit', 'blink', 'starcharge', 'hail', 'ice']) {
    const s = fresh();
    for (let i = 0; i < 8; i++) emit(s, name, 0, 0, { color: '#123456' });
    const own = s.particles.filter((p) => p.color === '#123456').length;
    assert.ok(own >= s.particles.length * 0.5, `${name}: ${own} von ${s.particles.length}`);
  }
});

test('Stimmungs Presets bleiben bei vollem Speicher still, Wirkungs Presets nicht', () => {
  const s = fresh();
  while (s.particles.length < Math.ceil(LIMITS.MAX_PARTICLES * 0.85)) emit(s, 'confetti', 1, 1);
  for (const name of AMBIENT_NAMES) assert.equal(emit(s, name, 0, 0), 0, name);
  for (const name of ['slam', 'crit', 'comet', 'hail', 'throw', 'spring', 'blink', 'starcharge']) assert.ok(emit(s, name, 0, 0) > 0, name);
});
