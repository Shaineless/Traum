// Tests für game/render/background.js ohne Browser, mit dem aufzeichnenden Kontext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMockCtx } from './mock-ctx.mjs';
import { EVENTS as EVENT_DEFS, H, W } from '../game/constants.js';
import { drawBackground } from '../game/render/background.js';
import { eventEnvelope } from '../game/events.js';
import { createComet } from '../game/entities.js';
import { createState } from '../game/state.js';
import { themeAt } from '../game/theme.js';

// Wie createMockCtx, zeichnet aber auch Zuweisungen auf (Eintrag '=name'), zählt Verläufe samt Farbstopps
// und merkt sich jeden Verlauf mit seinen Argumenten und Stopps (ctx.gradients).
// matrix: Ausgangsmatrix, die getTransform liefert.
function recCtx(matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  const base = createMockCtx();
  const stats = { gradients: 0, stops: 0 };
  const gradients = [];
  const wrap = (name) => (...args) => {
    stats.gradients++;
    base[name](...args);
    const rec = { name, args, stops: [] };
    gradients.push(rec);
    return { addColorStop(o, c) { stats.stops++; rec.stops.push([o, c]); } };
  };
  const ctx = new Proxy(base, {
    get(t, k) {
      if (k === 'stats') return stats;
      if (k === 'gradients') return gradients;
      if (k === 'getTransform') return () => matrix;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return wrap(k);
      return t[k];
    },
    set(t, k, v) { base.calls.push([`=${k}`, v]); t[k] = v; return true; },
  });
  return ctx;
}

const names = (ctx, n) => ctx.calls.filter((c) => c[0] === n);
const assigned = (ctx, key) => ctx.calls.filter((c) => c[0] === `=${key}`).map((c) => c[1]);
const drawCalls = (ctx) => ctx.calls.filter((c) => !c[0].startsWith('=')).length;

const view = (o = {}) => ({ W, H, camX: 0, time: 5, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });

function state({ world = 0, to = world, blend = 1, event = null, env = 1 } = {}) {
  const s = createState({ seed: 3 });
  s.world = { index: to, from: world, to, blend, gatesPassed: 0 };
  if (event) {
    const dur = 14;
    // t so wählen, dass die Hüllkurve den gewünschten Wert liefert: 0, 0,5 (t = 0,75) oder 1 (Mitte)
    const t = env <= 0 ? 0 : env >= 1 ? dur / 2 : 0.75;
    s.events.active = { type: event, t, dur, data: {} };
  }
  return s;
}

const EVENTS = ['meteor', 'supermoon', 'storm', 'shower'];
const draw = (s, v, matrix) => { const ctx = recCtx(matrix); drawBackground(ctx, s, v); return ctx; };

// Zeichnet den Zustand und gibt die Zahl der Aufrufe zurück, die zu einer Kennung passen
const count = (ctx, name, pred = () => true) => names(ctx, name).filter(pred).length;

// Kennungen der weltspezifischen Elemente
const petals = (ctx) => count(ctx, 'ellipse'); // Blütenblätter (Welt 2)
const rainStreaks = (ctx) => count(ctx, 'fillRect', (c) => c[3] === 1.1); // feine Regenstriche (Welt 4)
const auroraGradients = (ctx) => ctx.gradients.filter((g) => g.name === 'createRadialGradient' && g.args.join() === '0,1,0,0,0,1').length;
const lighter = (ctx) => assigned(ctx, 'globalCompositeOperation').filter((v) => v === 'lighter').length;
const washAlpha = (ctx) => {
  const a = assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string' && v.startsWith('rgba(170,190,255,')).map((v) => parseFloat(v.split(',')[3]));
  return a.length ? Math.max(...a) : 0;
};
const dimAlpha = (ctx, prefix) => {
  const a = assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string' && v.startsWith(prefix)).map((v) => parseFloat(v.split(',')[3]));
  return a.length ? Math.max(...a) : 0;
};

// Zeit mit dem stärksten Wetterleuchten in Welt 4 (Suche in 0,05 Schritten)
function peakFlashTime(reduceMotion = false) {
  let best = 0;
  let bestA = -1;
  for (let t = 0; t < 40; t += 0.05) {
    const a = washAlpha(draw(state({ world: 3 }), view({ time: t, reduceMotion })));
    if (a > bestA) { bestA = a; best = t; }
  }
  return best;
}

test('Hüllkurve der Testzustände liefert die erwarteten Werte', () => {
  assert.equal(eventEnvelope(state({ event: 'storm', env: 0 })).env, 0);
  assert.ok(Math.abs(eventEnvelope(state({ event: 'storm', env: 0.5 })).env - 0.5) < 1e-9);
  assert.equal(eventEnvelope(state({ event: 'storm', env: 1 })).env, 1);
});

test('zeichnet alle Welten, Überblendungen, Events und Bewegungsmodi ohne Fehler, unter 700 Aufrufen und mit wenigen Verläufen', () => {
  let worst = 0;
  let worstGrad = 0;
  const worlds = [[0, 0, 1], [1, 1, 1], [2, 2, 1], [3, 3, 1], [0, 1, 0.5], [1, 2, 0.5], [2, 3, 0.5], [3, 0, 0.5], [3, 0, 0.3], [2, 3, 0.8], [3, 3, 0]];
  const evs = [[null, 0], ...EVENTS.flatMap((e) => [[e, 0], [e, 0.5], [e, 1]])];
  for (const [from, to, blend] of worlds) {
    for (const [event, env] of evs) {
      for (const reduceMotion of [false, true]) {
        for (const time of [0, 3.3, 34.32, 77.7]) {
          const s = state({ world: from, to, blend, event, env });
          const ctx = draw(s, view({ time, camX: time * 311, reduceMotion }));
          const n = drawCalls(ctx);
          worst = Math.max(worst, n);
          worstGrad = Math.max(worstGrad, ctx.stats.gradients);
          assert.ok(n > 20, 'es wird etwas gezeichnet');
          assert.ok(n < 700, `zu viele Aufrufe: ${n} (${from}/${to}/${blend}, ${event}, ${env}, ${reduceMotion})`);
          assert.ok(n + ctx.stats.gradients < 700, `Aufrufe plus Verläufe: ${n + ctx.stats.gradients}`);
          assert.ok(ctx.stats.gradients <= 40, `${ctx.stats.gradients} Verläufe (${from}/${to}/${blend}, ${event})`);
          assert.equal(names(ctx, 'save').length, names(ctx, 'restore').length, 'save und restore sind ausgeglichen');
          assert.equal(assigned(ctx, 'shadowBlur').length, 0, 'kein shadowBlur');
          assert.ok(assigned(ctx, 'globalCompositeOperation').length <= 10, 'additive Mischung nur sparsam');
        }
      }
    }
  }
  assert.ok(worst < 700 && worstGrad <= 40);
});

test('Zustand und Ansicht bleiben unverändert, gleiche Eingabe gibt gleiche Aufrufe', () => {
  for (const s of [state({ world: 1, to: 2, blend: 0.4, event: 'meteor', env: 1 }), state({ world: 3, event: 'storm', env: 1 })]) {
    const before = structuredClone(s);
    const v = view({ camX: 1234.5, time: 17.25 });
    const vBefore = { ...v };
    const a = recCtx();
    const b = recCtx();
    drawBackground(a, s, v);
    drawBackground(b, s, v);
    assert.deepEqual(s, before);
    assert.deepEqual(v, vBefore);
    assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls));
  }
});

test('kein verstecktes Gedächtnis: dieselbe Eingabe zeichnet nach anderen Bildern genauso', () => {
  for (const world of [0, 1, 2, 3]) {
    const s = state({ world, event: 'shower', env: 1 });
    const first = JSON.stringify(draw(s, view({ time: 12.5, camX: 900 })).calls);
    for (const t of [0, 3, 99.9]) draw(state({ world: (world + 1) % 4 }), view({ time: t, camX: t * 40, reduceMotion: t === 3 }));
    assert.equal(JSON.stringify(draw(s, view({ time: 12.5, camX: 900 })).calls), first, `Welt ${world + 1}`);
  }
});

test('frisch geladenes Modul zeichnet dasselbe: Tabellen kommen aus festem Seed', async () => {
  const fresh = await import('../game/render/background.js?neu');
  for (const world of [0, 1, 2, 3]) {
    const s = state({ world, event: 'meteor', env: 1 });
    const a = recCtx();
    const b = recCtx();
    drawBackground(a, s, view({ time: 21.7, camX: 444 }));
    fresh.drawBackground(b, s, view({ time: 21.7, camX: 444 }));
    assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls));
  }
});

test('Quelltext: kein Math.random, keine Uhr, kein shadowBlur, keine Bilder', () => {
  const src = readFileSync(new URL('../game/render/background.js', import.meta.url), 'utf8');
  for (const bad of ['Math.random', 'Date.now', 'performance.now', 'new Date', 'shadowBlur', 'new Image', 'drawImage', 'fillText']) {
    assert.ok(!src.includes(bad), `enthält ${bad}`);
  }
});

test('keine ungültigen Zahlen an den Kontext, auch bei sehr großer Kamera und Zeit', () => {
  for (const [camX, time] of [[0, 0], [1e7, 5e5], [-12345.5, 0.001], [123456.789, 99999.9], [-1e9, -3.5]]) {
    for (const world of [0, 1, 2, 3]) {
      for (const event of [null, ...EVENTS]) {
        for (const reduceMotion of [false, true]) {
          const ctx = draw(state({ world, to: (world + 1) % 4, blend: 0.5, event, env: 1 }), view({ camX, time, reduceMotion }));
          for (const c of ctx.calls) {
            for (const a of c.slice(1)) {
              if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} bekam ${a}`);
            }
          }
          for (const g of ctx.gradients) for (const a of g.args) assert.ok(Number.isFinite(a), `Verlauf bekam ${a}`);
        }
      }
    }
  }
});

test('ungültige Eingaben (NaN, fehlende Felder, unbekannte Welt, kaputte Hindernisse) werfen nicht', () => {
  const s = state();
  s.world = { from: -1, to: 7, blend: NaN };
  assert.doesNotThrow(() => drawBackground(recCtx(), s, view({ camX: NaN, time: NaN })));
  const frac = state();
  frac.world = { from: 1.7, to: 2.2, blend: 0.5 };
  assert.doesNotThrow(() => drawBackground(recCtx(), frac, view()));
  const noWorld = state();
  delete noWorld.world;
  assert.doesNotThrow(() => drawBackground(recCtx(), noWorld, view()));
  const noEvents = state();
  delete noEvents.events;
  assert.doesNotThrow(() => drawBackground(recCtx(), noEvents, view()));
  const badEvent = state();
  badEvent.events.active = { type: 'meteor', t: NaN, dur: 0, data: {} };
  assert.doesNotThrow(() => drawBackground(recCtx(), badEvent, view()));
  const unknownEvent = state();
  unknownEvent.events.active = { type: 'komisch', t: 3, dur: 9, data: {} };
  assert.doesNotThrow(() => drawBackground(recCtx(), unknownEvent, view()));
  assert.doesNotThrow(() => drawBackground(recCtx(), state(), { W, H }));
  assert.doesNotThrow(() => drawBackground(recCtx(), state(), {}));
  assert.doesNotThrow(() => drawBackground(recCtx(), state(), undefined));
  assert.doesNotThrow(() => drawBackground(recCtx(), state(), view({ W: '800', H: -5 })));
  assert.doesNotThrow(() => drawBackground(recCtx(), null, view()));
  assert.doesNotThrow(() => drawBackground(recCtx(), undefined, view()));
  assert.doesNotThrow(() => drawBackground(recCtx(), {}, view()));
  // Kometen mit kaputten Feldern
  const bad = state();
  const ok = createComet(bad, 400, 340);
  bad.hazards = [null, 7, 'x', { kind: 'comet' }, { kind: 'comet', x: NaN, y: 3, phase: 'warn', charge: 1 }, { ...ok, phase: 'warn', charge: NaN }, { ...ok, phase: 'warn', charge: 0.7, dir: NaN, y: -50 }, { ...ok, phase: 'strike', progress: NaN }];
  assert.doesNotThrow(() => drawBackground(recCtx(), bad, view()));
  bad.hazards = 'kaputt';
  assert.doesNotThrow(() => drawBackground(recCtx(), bad, view()));
  // ein Kontext ohne getTransform oder mit kaputter Matrix
  const noMatrix = createMockCtx();
  noMatrix.getTransform = undefined;
  assert.doesNotThrow(() => drawBackground(recCtx({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 }), state({ world: 2 }), view()));
});

// Wandelt ein Rechteck unter der Matrix [a b c d e f] in seinen Bereich auf der x Achse um
function xRange(m, x, y, w, h) {
  const xs = [m[0] * x + m[2] * y + m[4], m[0] * (x + w) + m[2] * y + m[4], m[0] * x + m[2] * (y + h) + m[4], m[0] * (x + w) + m[2] * (y + h) + m[4]];
  return [Math.min(...xs), Math.max(...xs)];
}

test('nichts außerhalb des Bildes: jede Füllung, jeder Kreis und jedes Blütenblatt berührt den sichtbaren Bereich', () => {
  for (const camX of [0, 777, 5000, 123456, -3000]) {
    for (const world of [0, 1, 2, 3]) {
      for (const event of [null, 'shower', 'storm', 'supermoon', 'meteor']) {
        for (const reduceMotion of [false, true]) {
          const ctx = draw(state({ world, event, env: 1 }), view({ camX, time: 9 + camX / 100, reduceMotion }));
          let m = [1, 0, 0, 1, 0, 0];
          for (const c of ctx.calls) {
            if (c[0] === 'setTransform') {
              m = c.slice(1);
            } else if (c[0] === 'fillRect') {
              const [lo, hi] = xRange(m, c[1], c[2], c[3], c[4]);
              assert.ok(hi > -30 && lo < W + 30, `Füllung bei x ${lo} bis ${hi} (Welt ${world + 1}, Kamera ${camX})`);
            } else if (c[0] === 'arc') {
              assert.ok(c[1] + c[3] > -10 && c[1] - c[3] < W + 10, `Kreis bei x ${c[1]} mit Radius ${c[3]}`);
            } else if (c[0] === 'ellipse') {
              assert.ok(c[1] > -14 && c[1] < W + 14, `Blütenblatt bei x ${c[1]}`);
            }
          }
        }
      }
    }
  }
});

test('Matrix: jede Ebene stellt die Ausgangsmatrix wieder her und rechnet mit ihr', () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const scaled = { a: 1.5, b: 0, c: 0, d: 1.5, e: 3, f: -2 };
  for (const world of [0, 1, 2, 3]) {
    for (const event of [null, 'storm', 'supermoon', 'meteor']) {
      const a = recCtx(identity);
      const b = recCtx(scaled);
      drawBackground(a, state({ world, event, env: 1 }), view({ camX: 400, time: 15.75 }));
      drawBackground(b, state({ world, event, env: 1 }), view({ camX: 400, time: 15.75 }));
      const ta = names(a, 'setTransform');
      const tb = names(b, 'setTransform');
      assert.equal(ta.length, tb.length);
      assert.ok(ta.length > 8);
      // letzter Aufruf stellt die Ausgangsmatrix her
      assert.deepEqual(ta[ta.length - 1].slice(1), [1, 0, 0, 1, 0, 0]);
      assert.deepEqual(tb[tb.length - 1].slice(1), [1.5, 0, 0, 1.5, 3, -2]);
      ta.forEach((c, i) => {
        const d = tb[i];
        assert.ok(Math.abs(d[1] - 1.5 * c[1]) < 1e-9, 'a skaliert');
        assert.ok(Math.abs(d[2] - 1.5 * c[2]) < 1e-9, 'b skaliert');
        assert.ok(Math.abs(d[3] - 1.5 * c[3]) < 1e-9, 'c skaliert');
        assert.ok(Math.abs(d[4] - 1.5 * c[4]) < 1e-9, 'd skaliert');
        assert.ok(Math.abs(d[5] - (1.5 * c[5] + 3)) < 1e-9, 'e verschoben');
        assert.ok(Math.abs(d[6] - (1.5 * c[6] - 2)) < 1e-9, 'f verschoben');
      });
    }
  }
});

test('Parallax: Sterne 0,03, Wolken 0,12, Nebel 0,18, Glühwürmchen 0,5', () => {
  // Gleiche Zeit und ruhige Bewegung, nur die Kamera ändert sich. Elemente wandern um camX mal Faktor.
  const cam = 1000;
  const drawAt = (camX) => draw(state(), view({ camX, time: 0, reduceMotion: true }));
  const a = drawAt(0);
  const b = drawAt(cam);

  // Sterne: winzige Quadrate 1,2 mal 1,2
  const tiny = (ctx) => names(ctx, 'fillRect').filter((c) => c[3] === 1.2 && c[4] === 1.2).map((c) => c[1]);
  const ta = tiny(a);
  const tb = tiny(b);
  assert.ok(ta.length > 10);
  const starMatches = ta.filter((x) => tb.some((y) => Math.abs(y - (x - cam * 0.03)) < 1e-6)).length;
  assert.ok(starMatches >= ta.length * 0.6, `Sterne wandern um 30 Pixel (${starMatches} von ${ta.length})`);

  // Flecken: setTransform e Werte. Wolken (Faktor 0,12), Nebel (0,18), Glühwürmchen (0,5)
  const es = (ctx) => names(ctx, 'setTransform').map((c) => c[5]);
  const ea = es(a);
  const eb = es(b);
  const shifted = (f) => ea.filter((x) => eb.some((y) => Math.abs(y - (x - cam * f)) < 1e-6)).length;
  assert.ok(shifted(0.12) >= 3, 'Wolkenbänder 0,12');
  assert.ok(shifted(0.18) >= 1, 'Nebel 0,18');
  assert.ok(shifted(0.5) >= 3, 'Glühwürmchen 0,5');
  // der Mond schwankt nur begrenzt: der Halo bleibt auch bei sehr weit entfernter Kamera im Bild
  const far = draw(state(), view({ camX: 5e6, reduceMotion: true }));
  const halo = names(far, 'fillRect').find((c) => c[3] > 150 && c[3] < 500 && c[3] === c[4]);
  assert.ok(halo && halo[1] > 0 && halo[1] + halo[3] < W + 200, 'Mond bleibt im Bild');
});

test('Parallax der Welt 3 und 4: Aurora 0,02, Nebelschwaden 0,07, Front 0,1, Wolkenfetzen 0,14', () => {
  const cam = 1000;
  const es = (ctx) => names(ctx, 'setTransform').map((c) => c[5]);
  for (const [world, f] of [[2, 0.02], [2, 0.07], [3, 0.1], [3, 0.14]]) {
    const a = es(draw(state({ world }), view({ camX: 0, time: 0, reduceMotion: true })));
    const b = es(draw(state({ world }), view({ camX: cam, time: 0, reduceMotion: true })));
    const n = a.filter((x) => b.some((y) => Math.abs(y - (x - cam * f)) < 1e-6)).length;
    assert.ok(n >= 2, `Welt ${world + 1}, Faktor ${f}: ${n} Treffer`);
  }
});

test('Supermond: der Mond wächst mit der Hüllkurve bis etwa Faktor 1,7', () => {
  // Mondscheibe: größter Kreis im oberen Bildteil (Kreise der Berge liegen weit unten)
  const moonR = (event, env) => {
    const ctx = draw(state({ event, env }), view({ reduceMotion: true }));
    const arcs = names(ctx, 'arc').filter((c) => c[2] < 130 && c[3] >= 30);
    assert.equal(arcs.length, 1);
    return arcs[0][3];
  };
  const base = moonR(null, 0);
  assert.equal(base, 40);
  assert.equal(moonR('supermoon', 0), base);
  const half = moonR('supermoon', 0.5);
  const full = moonR('supermoon', 1);
  assert.ok(half > base && half < full);
  assert.ok(Math.abs(full / base - 1.7) < 0.05, `Faktor ${full / base}`);
  // andere Events lassen den Mond unverändert
  for (const e of ['meteor', 'storm', 'shower']) assert.equal(moonR(e, 1), base);
});

test('Supermond: heller mit Strahlenkranz, der mit der Hüllkurve einsetzt und im ruhigen Modus still steht', () => {
  // gedrehte Flecken (b und c ungleich 0) gibt es im ruhigen Modus der Welt 1 nur bei den Strahlen
  const rotated = (ctx) => names(ctx, 'setTransform').filter((c) => Math.abs(c[2]) > 1e-6 && Math.abs(c[3]) > 1e-6).length;
  const calm = (event, env, time = 5) => draw(state({ event, env }), view({ reduceMotion: true, time }));
  assert.equal(rotated(calm(null, 0)), 0);
  assert.equal(rotated(calm('supermoon', 0)), 0);
  assert.equal(rotated(calm('meteor', 1)), 0);
  assert.ok(rotated(calm('supermoon', 0.5)) >= 7, 'sieben Strahlen mit je zwei Zacken');
  assert.ok(rotated(calm('supermoon', 1)) >= 7);
  // ruhig: Strahlen drehen sich nicht
  assert.equal(JSON.stringify(names(calm('supermoon', 1, 1), 'setTransform')), JSON.stringify(names(calm('supermoon', 1, 40), 'setTransform')));
  // im normalen Modus drehen sie sich langsam
  const live = (time) => JSON.stringify(names(draw(state({ event: 'supermoon', env: 1 }), view({ time })), 'setTransform').filter((c) => Math.abs(c[2]) > 1e-6 && Math.abs(c[3]) > 1e-6).slice(0, 7));
  assert.notEqual(live(1), live(2));
  // heller: der Halo des Mondes ist mit Supermond stärker als sonst
  const haloAlpha = (event, env) => {
    const ctx = draw(state({ event, env }), view({ reduceMotion: true }));
    const g = ctx.gradients.find((x) => x.name === 'createRadialGradient' && x.args.length === 6 && x.args[2] > 0 && x.args[5] > 100);
    return parseFloat(g.stops[0][1].split(',')[3]);
  };
  assert.ok(haloAlpha('supermoon', 1) > haloAlpha(null, 0) * 1.6);
  assert.ok(haloAlpha('supermoon', 0.5) > haloAlpha(null, 0));
});

test('Sternschnuppen: Streifen mit Schweif nur bei meteor und env größer 0', () => {
  // Welt 2 hat selbst keine Streifen, so zählen hier nur die des Ereignisses
  const strokes = (event, env, time, reduceMotion = false) => names(draw(state({ world: 1, event, env }), view({ time, reduceMotion })), 'stroke').length;
  let seen = 0;
  let max = 0;
  for (let time = 0; time < 40; time += 0.1) {
    const n = strokes('meteor', 1, time);
    if (n > 0) seen++;
    max = Math.max(max, n);
    assert.equal(strokes('meteor', 0, time), 0, 'ohne Hüllkurve keine Streifen');
    assert.equal(strokes('storm', 1, time), 0);
    assert.equal(strokes(null, 0, time), 0);
  }
  assert.ok(seen > 100, `Streifen sind oft zu sehen (${seen} von 400)`);
  assert.ok(seen < 380, 'es gibt auch Pausen');
  assert.ok(max <= 8, 'höchstens vier Streifen gleichzeitig (jeweils Glanz und Kern)');
  assert.ok(max >= 4, 'es sind auch mehrere gleichzeitig zu sehen');
  // ruhiger Modus: weniger Streifen gleichzeitig
  let maxReduced = 0;
  for (let time = 0; time < 40; time += 0.1) maxReduced = Math.max(maxReduced, strokes('meteor', 1, time, true));
  assert.ok(maxReduced <= 4);
  // mit der Hüllkurve werden sie heller
  const bright = (env) => {
    for (let time = 0; time < 30; time += 0.1) {
      const ctx = draw(state({ world: 1, event: 'meteor', env }), view({ time }));
      const g = ctx.gradients.find((x) => x.name === 'createLinearGradient');
      if (names(ctx, 'stroke').length && g) return parseFloat(g.stops[1][1].split(',')[3]);
    }
    return 0;
  };
  assert.ok(bright(1) > bright(0.5) && bright(0.5) > 0);
});

test('Welt 1: gelegentlich eine einzelne Sternschnuppe, nur im normalen Modus und nicht in anderen Welten', () => {
  const streaks = (world, time, reduceMotion = false) => names(draw(state({ world }), view({ time, reduceMotion })), 'stroke').length;
  let seen = 0;
  let max = 0;
  const steps = 2400;
  for (let i = 0; i < steps; i++) {
    const n = streaks(0, i * 0.05);
    if (n > 0) seen++;
    max = Math.max(max, n);
    for (const w of [1, 2, 3]) if (i % 40 === 0) assert.equal(streaks(w, i * 0.05), 0, `Welt ${w + 1} hat keine Sternschnuppe`);
    if (i % 10 === 0) assert.equal(streaks(0, i * 0.05, true), 0, 'ruhiger Modus ohne schnelle Streifen');
  }
  assert.ok(seen > 40, `sie kommt vor (${seen} von ${steps})`);
  assert.ok(seen < steps * 0.2, `aber selten (${seen} von ${steps})`);
  assert.equal(max, 2, 'immer nur eine (Glanz und Kern)');
  // beim Überblenden verschwindet sie mit dem Gewicht der Welt
  const faint = (blend) => {
    let best = 0;
    for (let i = 0; i < steps; i++) {
      const ctx = draw(state({ world: 0, to: 1, blend }), view({ time: i * 0.05 }));
      if (!names(ctx, 'stroke').length) continue;
      const g = ctx.gradients.find((x) => x.name === 'createLinearGradient');
      best = Math.max(best, parseFloat(g.stops[1][1].split(',')[3]));
    }
    return best;
  };
  assert.ok(faint(0) > faint(0.4) && faint(0.4) > faint(0.7), `${faint(0)} ${faint(0.4)} ${faint(0.7)}`);
  assert.equal(faint(1), 0);
});

test('Traumsturm dunkelt ab und zeichnet schräge Schleier und Windlinien, mit der Hüllkurve zunehmend', () => {
  const dim = (env, o = {}) => {
    const ctx = draw(state({ event: 'storm', env }), view({ time: 6, ...o }));
    return { alpha: dimAlpha(ctx, 'rgba(6,8,24,'), ctx };
  };
  assert.equal(dim(0).alpha, 0);
  const half = dim(0.5);
  const full = dim(1);
  assert.ok(half.alpha > 0 && half.alpha < full.alpha, 'dunkler bei höherer Hüllkurve');
  assert.ok(full.alpha > 0.1 && full.alpha < 0.4, 'dezent');
  // Schleier sind geschert (c ist groß) und lehnen wie der Regen nach rechts
  const sheared = names(full.ctx, 'setTransform').filter((c) => Math.abs(c[3]) > 50);
  assert.ok(sheared.length >= 3, 'mindestens drei Schleier');
  assert.ok(sheared.every((c) => c[3] > 0));
  // ohne Sturm gibt es keine Schleier
  const calm = draw(state(), view({ time: 6 }));
  assert.equal(names(calm, 'setTransform').filter((c) => Math.abs(c[3]) > 50).length, 0);
  // Windlinien: flache lange Flecken, die schnell wandern und mit der Hüllkurve zahlreicher werden
  const lines = (env, time, reduceMotion = false) => names(draw(state({ event: 'storm', env }), view({ time, reduceMotion })), 'setTransform').filter((c) => c[1] > 40 && Math.abs(c[4]) < 4 && Math.abs(c[4]) > 0.5 && Math.abs(c[2]) < c[1] * 0.25);
  assert.ok(lines(1, 6).length >= 6, 'Windlinien sind da');
  assert.ok(lines(0.5, 6).length < lines(1, 6).length);
  assert.equal(lines(0, 6).length, 0);
  assert.ok(lines(1, 6, true).length < lines(1, 6).length, 'ruhiger Modus mit weniger Linien');
  const xs = (time) => lines(1, time).map((c) => c[5]).sort((a, b) => a - b).slice(0, 4);
  assert.notDeepEqual(xs(6), xs(6.5), 'sie ziehen schnell durchs Bild');
  // die dunkle Front des Sturms erscheint auch in Welten ohne eigene Front
  const darkCloud = (ctx) => ctx.gradients.filter((g) => g.name === 'createRadialGradient' && g.stops.some((s) => s[1].startsWith('rgba(5,8,22,'))).length;
  assert.equal(darkCloud(draw(state({ world: 0 }), view())), 0);
  assert.equal(darkCloud(draw(state({ world: 0, event: 'storm', env: 0 }), view())), 0);
  assert.equal(darkCloud(draw(state({ world: 0, event: 'storm', env: 1 }), view())), 1);
});

test('Sternschauer: viele funkelnde Sterne, die mit der Hüllkurve erscheinen', () => {
  const calls = (env, reduceMotion = false, world = 0) => drawCalls(draw(state({ world, event: 'shower', env }), view({ reduceMotion })));
  const plain = drawCalls(draw(state(), view()));
  assert.equal(calls(0), plain);
  assert.ok(calls(0.5) > plain + 10);
  assert.ok(calls(1) > calls(0.5) + 10);
  assert.ok(calls(1, true) < calls(1), 'ruhiger Modus zeigt weniger');
  for (const world of [1, 2, 3]) assert.ok(calls(1, false, world) > drawCalls(draw(state({ world }), view())) + 20, `Welt ${world + 1}`);
  // Funkeln: die Helligkeit der Sterne schwankt stärker als ohne Ereignis, im ruhigen Modus gar nicht
  const alphaSpread = (event, env, reduceMotion) => {
    const all = [];
    for (let t = 0; t < 6; t += 0.37) all.push(...assigned(draw(state({ event, env }), view({ time: t, reduceMotion })), 'globalAlpha'));
    return Math.max(...all) - Math.min(...all);
  };
  assert.ok(alphaSpread('shower', 1, false) > 0.3);
  assert.ok(alphaSpread('shower', 1, true) <= alphaSpread('shower', 1, false));
});

test('Wetterleuchten nur in Welt 4, selten, sanft, stärker als früher und im ruhigen Modus gedämpft', () => {
  const series = (world, reduceMotion = false, dt = 0.1, span = 120) => {
    const out = [];
    for (let t = 0; t < span; t += dt) out.push(washAlpha(draw(state({ world }), view({ time: t, reduceMotion }))));
    return out;
  };
  const w4 = series(3);
  const w4calm = series(3, true);
  for (const w of [0, 1, 2]) assert.ok(series(w, false, 0.5, 60).every((a) => a === 0), `Welt ${w + 1} hat kein Wetterleuchten`);
  const active = w4.filter((a) => a > 0).length;
  const max = Math.max(...w4);
  assert.ok(active > w4.length * 0.1, 'es leuchtet überhaupt, öfter als früher');
  assert.ok(active < w4.length * 0.4, 'aber nicht dauernd');
  assert.ok(max > 0.05 && max <= 0.075, `sichtbar und sanft (${max})`);
  assert.ok(max >= 0.06, 'stärker als der frühere Höchstwert von 0,05');
  assert.ok(Math.max(...w4calm) < max * 0.4, 'ruhiger Modus ist stark gedämpft');
  assert.ok(Math.max(...w4calm) > 0, 'aber nicht ganz weg');
  // deterministisch aus der Zeit
  assert.equal(washAlpha(draw(state({ world: 3 }), view({ time: 34.32 }))), washAlpha(draw(state({ world: 3 }), view({ time: 34.32 }))));
  // beim Überblenden von Welt 4 nimmt die Stärke weich ab
  const t0 = peakFlashTime();
  const mid = (blend) => washAlpha(draw(state({ world: 3, to: 0, blend }), view({ time: t0 })));
  assert.ok(mid(0) > mid(0.4));
  assert.ok(mid(0.4) > mid(0.9));
  assert.equal(mid(1), 0);
  // beim Überblenden in Welt 4 nimmt sie zu
  const into = (blend) => washAlpha(draw(state({ world: 0, to: 3, blend }), view({ time: t0 })));
  assert.equal(into(0), 0);
  assert.ok(into(0.4) < into(0.9) && into(0.9) <= into(1));
});

test('Wetterleuchten ist kein Blitzlichtgewitter: höchstens drei Schläge pro Sekunde und keine harten Sprünge', () => {
  const dt = 1 / 60;
  const a = [];
  for (let t = 0; t < 90; t += dt) a.push(washAlpha(draw(state({ world: 3 }), view({ time: t }))));
  const max = Math.max(...a);
  // größter Sprung zwischen zwei Bildern
  let step = 0;
  for (let i = 1; i < a.length; i++) step = Math.max(step, Math.abs(a[i] - a[i - 1]));
  assert.ok(step < max * 0.1, `Sprung ${step} bei Höchstwert ${max}`);
  // Schläge: Aufstieg über die halbe Stärke, gezählt im gleitenden Fenster von einer Sekunde
  const hi = a.map((x) => x > max * 0.5);
  const rises = [];
  for (let i = 1; i < hi.length; i++) if (hi[i] && !hi[i - 1]) rises.push(i * dt);
  assert.ok(rises.length > 5, 'es gibt Schläge');
  for (let i = 0; i < rises.length; i++) {
    const inSecond = rises.filter((r) => r >= rises[i] && r < rises[i] + 1).length;
    assert.ok(inSecond <= 3, `${inSecond} Schläge in einer Sekunde bei ${rises[i].toFixed(2)}`);
  }
  // im ruhigen Modus langsamer: kein Schlag in kürzerer Zeit als eine Sekunde
  const calm = [];
  for (let t = 0; t < 60; t += dt) calm.push(washAlpha(draw(state({ world: 3 }), view({ time: t, reduceMotion: true }))));
  let calmStep = 0;
  for (let i = 1; i < calm.length; i++) calmStep = Math.max(calmStep, Math.abs(calm[i] - calm[i - 1]));
  assert.ok(calmStep < step, 'im ruhigen Modus noch sanfter');
});

test('Welt 4: ferne Blitzadern nur beim Wetterleuchten, dünn, mit Ast und nicht im ruhigen Modus', () => {
  const t0 = peakFlashTime();
  const peak = draw(state({ world: 3 }), view({ time: t0 }));
  assert.ok(names(peak, 'stroke').length >= 2, 'Ader zeichnet Glanz und Kern');
  assert.ok(names(peak, 'moveTo').length >= 3 && names(peak, 'lineTo').length >= 8, 'mit Ast');
  const widths = assigned(peak, 'lineWidth');
  assert.ok(widths.length >= 2 && Math.max(...widths) <= 6 && Math.min(...widths) <= 1.5, `dünn (${widths})`);
  // die Ader bleibt hoch über dem Boden
  const ys = names(peak, 'lineTo').map((c) => c[2]);
  assert.ok(Math.max(...ys) < 220, `endet bei y ${Math.max(...ys)}`);
  // ohne Wetterleuchten keine Ader
  const quiet = [];
  for (let t = 0; t < 40; t += 0.25) if (washAlpha(draw(state({ world: 3 }), view({ time: t }))) === 0) quiet.push(t);
  assert.ok(quiet.length > 20);
  for (const t of quiet) assert.equal(names(draw(state({ world: 3 }), view({ time: t })), 'stroke').length, 0);
  // ruhiger Modus: keine Ader, auch nicht im Höhepunkt
  assert.equal(names(draw(state({ world: 3 }), view({ time: t0, reduceMotion: true })), 'stroke').length, 0);
  // andere Welten: keine
  for (const w of [0, 1, 2]) assert.equal(names(draw(state({ world: w }), view({ time: t0 })), 'stroke').filter(() => false).length, 0);
  // gleiche Zeit gibt dieselbe Ader
  assert.equal(JSON.stringify(names(draw(state({ world: 3 }), view({ time: t0 })), 'lineTo')), JSON.stringify(names(peak, 'lineTo')));
});

test('ruhiger Modus: kein Funkeln und kein Schweben, Alphawerte hängen nicht von der Zeit ab', () => {
  const alphas = (time, reduceMotion) => assigned(draw(state(), view({ time, reduceMotion })), 'globalAlpha');
  assert.deepEqual(alphas(1, true), alphas(8.7, true));
  assert.notDeepEqual(alphas(1, false), alphas(8.7, false));
  // Wolken, Nebel und Sterne stehen im ruhigen Modus still (nur Glühwürmchen schweben leicht)
  const pos = (time) => names(draw(state(), view({ time, reduceMotion: true })), 'fillRect').filter((c) => c[3] === 1.2).map((c) => c[1]);
  assert.deepEqual(pos(1), pos(40));
});

test('ruhiger Modus in allen Welten: Helligkeit ändert sich von Bild zu Bild kaum, im normalen Modus schon', () => {
  const dt = 1 / 60;
  const jump = (world, reduceMotion, event = null) => {
    let worst = 0;
    for (let t = 1.3; t < 60; t += 3.7) {
      const a = assigned(draw(state({ world, event, env: 1 }), view({ time: t, reduceMotion })), 'globalAlpha');
      const b = assigned(draw(state({ world, event, env: 1 }), view({ time: t + dt, reduceMotion })), 'globalAlpha');
      if (a.length !== b.length) continue; // ein Element tritt gerade ins Bild
      a.forEach((x, i) => { worst = Math.max(worst, Math.abs(x - b[i])); });
    }
    return worst;
  };
  for (const world of [0, 1, 2, 3]) {
    for (const event of [null, 'storm', 'shower', 'meteor', 'supermoon']) {
      assert.ok(jump(world, true, event) < 0.03, `Welt ${world + 1}, ${event}: Sprung ${jump(world, true, event)}`);
    }
  }
  // zur Kontrolle: ohne ruhigen Modus gibt es deutlich schnellere Änderungen
  assert.ok(jump(0, false) > jump(0, true));
  assert.ok(jump(2, false, 'shower') > jump(2, true, 'shower'));
  // ohne Wetterleuchten, ohne Funkeln: dieselbe Menge an Alphawerten zu verschiedenen Zeiten
  const quiet = (t) => washAlpha(draw(state({ world: 3 }), view({ time: t, reduceMotion: true }))) === 0;
  const times = [];
  for (let t = 0; t < 60 && times.length < 2; t += 1.1) if (quiet(t) && quiet(t + 0.5)) times.push(t);
  assert.equal(times.length, 2);
  const set = (t) => [...new Set(assigned(draw(state({ world: 3 }), view({ time: t, reduceMotion: true })), 'globalAlpha').map((v) => +v.toFixed(4)))].sort();
  assert.deepEqual(set(times[0]), set(times[1]));
});

test('ruhiger Modus: Wolken, Sterne, Mond und Front stehen still, nur die Kamera bewegt sie', () => {
  for (const world of [0, 1, 2, 3]) {
    const at = (time) => draw(state({ world }), view({ time, reduceMotion: true }));
    // Sterne und Staub sind Quadrate: ihre Lage hängt nicht von der Zeit ab
    const squares = (ctx) => names(ctx, 'fillRect').filter((c) => c[3] === c[4] && c[3] < 3).map((c) => c[1]);
    assert.deepEqual(squares(at(2)), squares(at(30)), `Welt ${world + 1}`);
    // Mond, Berge und Mondkrater: Kreise bewegen sich nicht
    assert.deepEqual(names(at(2), 'arc'), names(at(30), 'arc'));
  }
  // Aurora und Nebelschwaden stehen im ruhigen Modus ganz still
  const stamps = (time) => JSON.stringify(names(draw(state({ world: 2 }), view({ time, reduceMotion: true })), 'setTransform'));
  assert.equal(stamps(2), stamps(30));
});

test('Himmelsverlauf und Mond folgen dem Thema der Welt', () => {
  const sky = (world) => assigned(draw(state({ world }), view()), 'fillStyle').filter((v) => typeof v === 'string');
  // verschiedene Welten ergeben verschiedene Zeichnungen (Farben der Sterne)
  const sets = [0, 1, 2, 3].map((w) => sky(w).join('|'));
  assert.equal(new Set(sets).size, 4);
  // der Himmelsverlauf ist der erste Verlauf mit den Farben des Themas
  for (const world of [0, 1, 2, 3]) {
    const g = draw(state({ world }), view()).gradients[0];
    assert.equal(g.name, 'createLinearGradient');
    assert.deepEqual(g.stops.map((s) => s[1]), themeAt({ from: world, to: world, blend: 1 }).sky);
  }
  // beim Überblenden entsteht der weiche Verlauf aus themeAt
  for (const [from, to, blend] of [[0, 1, 0.3], [1, 2, 0.5], [2, 3, 0.8], [3, 0, 0.5]]) {
    const g = draw(state({ world: from, to, blend }), view()).gradients[0];
    assert.deepEqual(g.stops.map((s) => s[1]), themeAt({ from, to, blend }).sky);
  }
});

test('Welt 1: Glühwürmchen Schwärme leuchten additiv, ziehen eine Spur und blinken, ruhig ohne Spur', () => {
  const ctx = draw(state({ world: 0 }), view({ time: 7 }));
  assert.ok(lighter(ctx) >= 1, 'additive Mischung für die Leuchten');
  assert.equal(assigned(ctx, 'globalCompositeOperation').at(-1), 'source-over', 'Mischung wird zurückgesetzt');
  const glow = (c) => c[0] === 'setTransform' && Math.abs(c[2]) < 1e-9 && Math.abs(c[3]) < 1e-9 && c[1] > 8 && c[1] === c[4];
  const rot = (c) => c[0] === 'setTransform' && Math.abs(c[2]) > 1e-6 && Math.abs(c[3]) > 1e-6;
  const fireflyStamps = (o) => draw(state({ world: 0 }), view(o)).calls.filter(glow).length;
  // Spuren sind lang gezogene gedrehte Flecken
  const trails = (o) => draw(state({ world: 0 }), view(o)).calls.filter(rot).length;
  let withTrail = 0;
  for (let t = 3; t < 60; t += 4.1) withTrail = Math.max(withTrail, trails({ time: t }));
  assert.ok(withTrail >= 3, `Leuchtspuren (${withTrail})`);
  assert.equal(trails({ time: 7, reduceMotion: true }), 0, 'ruhig ohne Spur');
  // Schwärme: mehrere Tiere auf engem Raum, nicht gleichmäßig verteilt
  let best = 0;
  for (let t = 0; t < 30; t += 1.7) {
    const xs = draw(state({ world: 0 }), view({ time: t, reduceMotion: true })).calls.filter(glow).map((c) => c[5]).sort((a, b) => a - b);
    for (let i = 0; i + 2 < xs.length; i++) best = Math.max(best, xs[i + 2] - xs[i] < 120 ? 3 : 0);
  }
  assert.equal(best, 3, 'mindestens drei Tiere liegen eng beieinander');
  // Blinken: die Helligkeit der Leuchten wechselt mit der Zeit, ruhig nicht
  const alphas = (time, reduceMotion) => [...new Set(assigned(draw(state({ world: 0 }), view({ time, reduceMotion })), 'globalAlpha').map((v) => +v.toFixed(3)))].length;
  assert.ok(alphas(7, false) > alphas(7, true));
  assert.ok(fireflyStamps({ time: 7 }) > 3);
  // andere Welten: keine Schwärme (Welt 4 benutzt gar keine additive Mischung)
  assert.equal(lighter(draw(state({ world: 3 }), view({ time: 7 }))), 0);
});

test('Welt 2: Abendglühen, Schleierwolken, treibende Blütenblätter und Funken', () => {
  const ctx = draw(state({ world: 1 }), view({ time: 7 }));
  assert.ok(petals(ctx) >= 8, `Blütenblätter (${petals(ctx)})`);
  for (const w of [0, 2, 3]) assert.equal(petals(draw(state({ world: w }), view({ time: 7 }))), 0, `Welt ${w + 1} ohne Blütenblätter`);
  // Blütenblätter treiben: Lage ändert sich mit der Zeit, fallen langsam nach unten und kippen
  const pos = (t) => names(draw(state({ world: 1 }), view({ time: t })), 'ellipse').map((c) => [c[1], c[2], c[4], c[6]]);
  assert.notDeepEqual(pos(7), pos(7.5));
  const dy = (() => {
    const a = pos(7);
    const b = pos(7.2);
    return b.length === a.length ? a.map((p, i) => b[i][1] - p[1]).filter((d) => d > -50 && d < 50) : [];
  })();
  assert.ok(dy.length > 3 && dy.filter((d) => d > 0).length > dy.length * 0.7, 'sie fallen');
  // Schleierwolken: gedrehte lange Flecken im oberen Himmel
  const veils = names(ctx, 'setTransform').filter((c) => c[1] > 150 && Math.abs(c[2]) > 1 && Math.abs(c[2]) < c[1] * 0.4 && c[6] < 260);
  assert.ok(veils.length >= 4, `Schleierwolken (${veils.length})`);
  assert.ok(draw(state({ world: 0 }), view({ time: 7 })).calls.filter((c) => c[0] === 'setTransform' && c[1] > 150 && Math.abs(c[2]) > 1 && c[6] < 260).length < veils.length);
  // Abendglühen: warme Verläufe am Horizont (nur Welt 2)
  const warm = (c) => c.gradients.filter((g) => g.stops.some((s) => /^rgba\(255,(208|176),1[35]0/.test(s[1]))).length;
  assert.ok(warm(ctx) >= 2);
  for (const w of [0, 2, 3]) assert.equal(warm(draw(state({ world: w }), view({ time: 7 }))), 0);
  // Funken: additiv und golden
  assert.ok(lighter(ctx) >= 1);
  // ruhig: Blütenblätter fallen viel langsamer
  const meanFall = (reduceMotion) => {
    const at = (t) => names(draw(state({ world: 1 }), view({ time: t, reduceMotion })), 'ellipse').map((c) => c[2]);
    const a = at(7);
    const b = at(7.4);
    assert.equal(a.length, b.length);
    const d = a.map((y, i) => b[i] - y).filter((x) => x > -100);
    return d.reduce((sum, x) => sum + x, 0) / d.length;
  };
  assert.ok(meanFall(true) > 0 && meanFall(true) < meanFall(false) * 0.5, `${meanFall(true)} gegen ${meanFall(false)}`);
  assert.ok(petals(draw(state({ world: 1 }), view({ time: 7, reduceMotion: true }))) >= 5);
});

test('Welt 3: Aurora in Türkis und Grün, dichterer Sternenstaub und Nebelschwaden', () => {
  const ctx = draw(state({ world: 2 }), view({ time: 7 }));
  assert.equal(auroraGradients(ctx), 3, 'drei Lichtbänder');
  for (const w of [0, 1, 3]) assert.equal(auroraGradients(draw(state({ world: w }), view({ time: 7 }))), 0);
  // grün und türkis: Farbstopps mit überwiegendem Grün und Alpha größer 0,5
  const greens = ctx.gradients.filter((g) => g.stops.some((s) => { const m = s[1].match(/[\d.]+/g).map(Number); return m[1] > 240 && m[1] > m[0] + 40 && m[3] > 0.5; }));
  const turq = ctx.gradients.filter((g) => g.stops.some((s) => { const m = s[1].match(/[\d.]+/g).map(Number); return m[1] > 220 && m[2] > 220 && m[0] < 130 && m[3] > 0.4; }));
  assert.ok(greens.length >= 1, 'Grün');
  assert.ok(turq.length >= 1, 'Türkis');
  // wehend: die Form hängt nur von view.time ab und ändert sich laufend
  const stamps = (t) => JSON.stringify(names(draw(state({ world: 2 }), view({ time: t })), 'setTransform'));
  assert.notEqual(stamps(7), stamps(8));
  assert.equal(stamps(7), stamps(7));
  // der Vorhang bewegt sich glatt: die Lage der Flammen springt zwischen zwei Bildern nicht
  const ys = (t) => names(draw(state({ world: 2 }), view({ time: t })), 'setTransform').filter((c) => c[1] > 60 && c[6] > 20 && c[6] < 260 && c[4] > 30).map((c) => c[6]);
  const a = ys(7);
  const b = ys(7 + 1 / 60);
  assert.equal(a.length, b.length);
  a.forEach((y, i) => assert.ok(Math.abs(y - b[i]) < 1.5, `Sprung ${Math.abs(y - b[i])}`));
  // dichter Sternenstaub: mehr kleine Sterne als in den anderen Welten
  const dots = (c) => names(c, 'fillRect').filter((r) => r[3] === r[4] && r[3] < 2 && r[3] > 0.85 && r[3] !== 1.2).length;
  assert.ok(dots(ctx) >= 25, `Sterne (${dots(ctx)})`);
  for (const w of [0, 1, 3]) assert.equal(dots(draw(state({ world: w }), view({ time: 7 }))), 0);
  // Nebelschwaden: violette und türkise Schleier
  const nebula = (c) => c.gradients.filter((g) => g.stops.some((s) => /^rgba\((150,110,255|70,225,255|255,130,220),/.test(s[1]))).length;
  assert.equal(nebula(ctx), 3);
  for (const w of [0, 1, 3]) assert.equal(nebula(draw(state({ world: w }), view({ time: 7 }))), 0);
  // ruhig: Aurora steht
  assert.equal(JSON.stringify(names(draw(state({ world: 2 }), view({ time: 1, reduceMotion: true })), 'setTransform').slice(0, 30)), JSON.stringify(names(draw(state({ world: 2 }), view({ time: 9, reduceMotion: true })), 'setTransform').slice(0, 30)));
});

test('Welt 4: dunkle Front, schnelle Wolkenfetzen und feiner schräger Regenschleier', () => {
  const ctx = draw(state({ world: 3 }), view({ time: 7 }));
  assert.ok(rainStreaks(ctx) >= 30, `Regenstriche (${rainStreaks(ctx)})`);
  for (const w of [0, 1, 2]) assert.equal(rainStreaks(draw(state({ world: w }), view({ time: 7 }))), 0);
  // Regen ist geneigt wie der Regen in world.js (0,22) und fällt
  const slanted = names(ctx, 'setTransform').filter((c) => Math.abs(c[3] - 0.22) < 1e-9 && c[1] === 1 && c[4] === 1);
  assert.equal(slanted.length, 1);
  const fall = (t) => names(draw(state({ world: 3 }), view({ time: t })), 'fillRect').filter((c) => c[3] === 1.1).map((c) => c[2]);
  const a = fall(7);
  const b = fall(7.1);
  const moved = a.map((y, i) => b[i] - y).filter((d) => d > -400);
  assert.ok(moved.length > 20 && moved.every((d) => d > 10 && d < 60), `fällt ${moved.slice(0, 5)}`);
  // fein: dünne Striche, schwach
  const alphas = assigned(ctx, 'globalAlpha').filter((v) => v > 0 && v < 0.3);
  assert.ok(alphas.length > 20);
  // dunkle Front: ein dunkler Verlauf, Wolken im oberen Bild
  const dark = ctx.gradients.filter((g) => g.name === 'createRadialGradient' && g.stops.some((s) => s[1].startsWith('rgba(5,8,22,')));
  assert.equal(dark.length, 1);
  // Front und Fetzen driften schneller als die normalen Wolkenbänder (5 bis 12 px pro Sekunde)
  const drift = (world, pred) => {
    const e = (t) => names(draw(state({ world }), view({ time: t })), 'setTransform').filter(pred).map((c) => c[5]);
    const x0 = e(10);
    const x1 = e(11);
    return x0.length === x1.length ? Math.max(...x0.map((x, i) => Math.abs(x1[i] - x))) : 0;
  };
  const bands = drift(0, (c) => c[1] > 70 && c[1] < 200 && c[6] > 60 && c[6] < 250 && Math.abs(c[3]) < 1e-9);
  const scud = drift(3, (c) => Math.abs(c[3] - 0.05 * c[4]) < 1e-6 && c[1] > 50 && c[1] < 130 && c[4] < 20 && c[6] > 90);
  assert.ok(scud >= 55 && scud <= 100, `Wolkenfetzen ${scud} px pro Sekunde`);
  assert.ok(scud > bands * 4, `${scud} gegen ${bands}`);
  // ruhig: Front und Fetzen stehen, Regen fällt langsamer
  const calmShift = JSON.stringify(names(draw(state({ world: 3 }), view({ time: 3, reduceMotion: true })), 'setTransform').filter((c) => c[1] > 60).slice(0, 12));
  assert.equal(calmShift, JSON.stringify(names(draw(state({ world: 3 }), view({ time: 30, reduceMotion: true })), 'setTransform').filter((c) => c[1] > 60).slice(0, 12)));
  const fallCalm = (t) => names(draw(state({ world: 3 }), view({ time: t, reduceMotion: true })), 'fillRect').filter((c) => c[3] === 1.1).map((c) => c[2]);
  const ac = fallCalm(7);
  const bc = fallCalm(7.1);
  const movedCalm = ac.map((y, i) => bc[i] - y).filter((d) => d > -400);
  assert.ok(Math.max(...movedCalm) < Math.min(...moved) + 1, 'ruhig langsamer');
});

test('Überblenden: weltspezifische Elemente blenden mit world.blend ein und aus', () => {
  const t = 7;
  // Blütenblätter: Welt 2 nach Welt 3 (aus) und zurück (ein)
  const p = (from, to, blend) => petals(draw(state({ world: from, to, blend }), view({ time: t })));
  assert.equal(p(1, 2, 1), 0);
  const out = [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1].map((b) => p(1, 2, b));
  for (let i = 1; i < out.length; i++) assert.ok(out[i] <= out[i - 1], `monoton fallend: ${out}`);
  assert.ok(out[0] >= 8 && out[3] > 0 && out[3] < out[0] && out[6] === 0, `${out}`);
  const into = [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1].map((b) => p(0, 1, b));
  for (let i = 1; i < into.length; i++) assert.ok(into[i] >= into[i - 1], `monoton steigend: ${into}`);
  assert.equal(into[0], 0);
  assert.ok(into[3] > 0 && into[3] < into[6], `${into}`);
  // Regen: Welt 3 nach Welt 4 (ein) und Welt 4 nach Welt 1 (aus)
  const r = (from, to, blend) => rainStreaks(draw(state({ world: from, to, blend }), view({ time: t })));
  const rin = [0, 0.2, 0.5, 0.8, 1].map((b) => r(2, 3, b));
  for (let i = 1; i < rin.length; i++) assert.ok(rin[i] >= rin[i - 1], `Regen steigt: ${rin}`);
  assert.equal(rin[0], 0);
  assert.ok(rin[4] > rin[2] && rin[2] > 0);
  const rout = [0, 0.2, 0.5, 0.8, 1].map((b) => r(3, 0, b));
  for (let i = 1; i < rout.length; i++) assert.ok(rout[i] <= rout[i - 1], `Regen sinkt: ${rout}`);
  assert.equal(rout[4], 0);
  // Aurora: nur ab Gewicht größer 0
  const au = (from, to, blend) => auroraGradients(draw(state({ world: from, to, blend }), view({ time: t })));
  assert.equal(au(1, 2, 0), 0);
  assert.equal(au(1, 2, 0.5), 3);
  assert.equal(au(1, 2, 1), 3);
  assert.equal(au(2, 3, 1), 0);
  assert.equal(au(2, 3, 0.5), 3);
  // die Gewichte der Welten ergeben beim Überblenden eins: gleiche Welt auf beiden Seiten bleibt voll da
  for (const blend of [0, 0.3, 0.7, 1]) {
    assert.equal(au(2, 2, blend), 3);
    assert.equal(p(1, 1, blend), p(1, 1, 1));
    assert.equal(r(3, 3, blend), r(3, 3, 1));
  }
  // der Himmel und die Welt Gewichte folgen demselben glatten Verlauf: bei blend 0,5 sind beide Welten halb da
  const half = r(2, 3, 0.5);
  assert.ok(half > r(2, 3, 0.2) && half < r(2, 3, 0.8));
  // Aufruf Budget bleibt beim Überblenden im Rahmen
  for (let from = 0; from < 4; from++) {
    for (const blend of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const ctx = draw(state({ world: from, to: (from + 1) % 4, blend }), view({ time: 15.75 }));
      assert.ok(drawCalls(ctx) < 600, `${from}/${blend}: ${drawCalls(ctx)}`);
    }
  }
});

test('Komet in der Warnphase: Himmel dunkelt leicht ab und ein feiner Schweif zeigt die Anflugrichtung', () => {
  const sceneWith = (o = {}, world = 0) => {
    const s = state({ world });
    const h = createComet(s, o.x ?? 400, o.y ?? 340, { dir: o.dir ?? 1 });
    h.phase = o.phase ?? 'warn';
    h.charge = o.charge ?? 0.8;
    h.progress = o.progress ?? 0;
    s.hazards.push(h);
    return s;
  };
  const dim = (o, world, v) => dimAlpha(draw(sceneWith(o, world), view(v)), 'rgba(6,8,22,');
  const none = dimAlpha(draw(state(), view()), 'rgba(6,8,22,');
  assert.equal(none, 0);
  // wächst mit der Ladung und bleibt dezent
  const series = [0, 0.25, 0.5, 0.75, 1].map((c) => dim({ charge: c }));
  for (let i = 1; i < series.length; i++) assert.ok(series[i] >= series[i - 1], `${series}`);
  assert.equal(series[0], 0);
  assert.ok(series[4] > 0.05 && series[4] <= 0.16, `dezent: ${series[4]}`);
  // nur in der Warnphase (und beim Einschlag sanft ausklingend)
  assert.equal(dim({ phase: 'idle', charge: 1 }), 0);
  assert.equal(dim({ phase: 'cooldown', charge: 1, progress: 1 }), 0);
  const strike = [0, 0.3, 0.6, 1].map((p) => dim({ phase: 'strike', charge: 1, progress: p }));
  for (let i = 1; i < strike.length; i++) assert.ok(strike[i] <= strike[i - 1], `klingt ab: ${strike}`);
  assert.ok(strike[0] > 0 && strike[3] < strike[0] * 0.2);
  // sehr weit entfernte Kometen zählen nicht
  assert.equal(dim({ x: 5000 }), 0);
  assert.equal(dim({ x: -5000 }), 0);
  // in allen Welten, auch ruhig
  for (const world of [0, 1, 2, 3]) {
    assert.ok(dim({ charge: 0.9 }, world) > 0.05, `Welt ${world + 1}`);
    assert.ok(dim({ charge: 0.9 }, world, { reduceMotion: true }) > 0.05);
  }
  // mehrere Kometen: der stärkste gilt, nicht die Summe
  const two = sceneWith({ charge: 0.5 });
  const h2 = createComet(two, 600, 340, { dir: -1 });
  h2.phase = 'warn';
  h2.charge = 1;
  two.hazards.push(h2);
  const a2 = dimAlpha(draw(two, view()), 'rgba(6,8,22,');
  assert.ok(Math.abs(a2 - dim({ charge: 1 })) < 1e-9 && a2 <= 0.16);
  // Schweif: ein langer weicher Fleck, der in Flugrichtung liegt (von rechts oben nach links unten bei dir 1)
  const tail = (o) => {
    const ctx = draw(sceneWith(o), view({ reduceMotion: true }));
    const without = draw(state(), view({ reduceMotion: true }));
    const a = names(ctx, 'setTransform');
    const b = names(without, 'setTransform');
    assert.equal(a.length, b.length + 1, 'ein zusätzlicher Fleck');
    return a.find((c, i) => JSON.stringify(c) !== JSON.stringify(b[i]));
  };
  const right = tail({ dir: 1, charge: 1 });
  const left = tail({ dir: -1, charge: 1 });
  assert.ok(right[1] < 0 && right[2] > 0, 'von rechts oben nach links unten');
  assert.ok(left[1] > 0 && left[2] > 0, 'von links oben nach rechts unten');
  assert.ok(right[6] < 200 && left[6] < 200, 'beginnt am oberen Bildrand');
  assert.ok(right[5] > 400 && left[5] < 400, 'liegt auf der Anflugseite des Einschlagpunkts');
  // dezent: Alpha des Schweifs klein
  const ctx = draw(sceneWith({ charge: 1 }), view({ reduceMotion: true }));
  const alphas = assigned(ctx, 'globalAlpha');
  assert.ok(alphas.includes(0.34) || alphas.some((x) => x > 0.2 && x <= 0.36));
  // kein Kometen Hinweis ohne Komet, auch mit anderen Hindernissen
  const other = state();
  other.hazards.push({ id: 1, kind: 'lightning', x: 400, phase: 'glow', charge: 1 });
  assert.equal(dimAlpha(draw(other, view()), 'rgba(6,8,22,'), 0);
});
