// Tests für game/render/background.js ohne Browser, mit dem aufzeichnenden Kontext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { H, W } from '../game/constants.js';
import { drawBackground } from '../game/render/background.js';
import { eventEnvelope } from '../game/events.js';
import { createState } from '../game/state.js';

// Wie createMockCtx, zeichnet aber auch Zuweisungen auf (Eintrag '=name') und zählt Verläufe.
// matrix: Ausgangsmatrix, die getTransform liefert.
function recCtx(matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  const base = createMockCtx();
  const stats = { gradients: 0 };
  const wrap = (name) => (...args) => { stats.gradients++; return base[name](...args); };
  const ctx = new Proxy(base, {
    get(t, k) {
      if (k === 'stats') return stats;
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

test('Hüllkurve der Testzustände liefert die erwarteten Werte', () => {
  assert.equal(eventEnvelope(state({ event: 'storm', env: 0 })).env, 0);
  assert.ok(Math.abs(eventEnvelope(state({ event: 'storm', env: 0.5 })).env - 0.5) < 1e-9);
  assert.equal(eventEnvelope(state({ event: 'storm', env: 1 })).env, 1);
});

test('zeichnet alle Welten, Überblendungen, Events und Bewegungsmodi ohne Fehler und unter 600 Aufrufen', () => {
  let worst = 0;
  const worlds = [[0, 0, 1], [1, 1, 1], [2, 2, 1], [3, 3, 1], [0, 1, 0.5], [3, 0, 0.3], [2, 3, 0.8], [3, 3, 0]];
  const evs = [[null, 0], ...EVENTS.flatMap((e) => [[e, 0], [e, 0.5], [e, 1]])];
  for (const [from, to, blend] of worlds) {
    for (const [event, env] of evs) {
      for (const reduceMotion of [false, true]) {
        for (const time of [0, 3.3, 34.32, 77.7]) {
          const s = state({ world: from, to, blend, event, env });
          const ctx = recCtx();
          drawBackground(ctx, s, view({ time, camX: time * 311, reduceMotion }));
          const n = ctx.calls.filter((c) => !c[0].startsWith('=')).length;
          worst = Math.max(worst, n);
          assert.ok(n > 20, 'es wird etwas gezeichnet');
          assert.ok(n < 600, `zu viele Aufrufe: ${n} (${from}/${to}/${blend}, ${event}, ${env}, ${reduceMotion})`);
          assert.equal(names(ctx, 'save').length, names(ctx, 'restore').length, 'save und restore sind ausgeglichen');
        }
      }
    }
  }
  assert.ok(worst < 600);
});

test('es entstehen nur wenige Verläufe pro Frame', () => {
  for (const event of [null, ...EVENTS]) {
    const ctx = recCtx();
    drawBackground(ctx, state({ world: 3, event, env: 1 }), view({ time: 34.32 }));
    assert.ok(ctx.stats.gradients <= 40, `${ctx.stats.gradients} Verläufe bei ${event}`);
  }
});

test('Zustand und Ansicht bleiben unverändert, gleiche Eingabe gibt gleiche Aufrufe', () => {
  const s = state({ world: 1, to: 2, blend: 0.4, event: 'meteor', env: 1 });
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
});

test('keine ungültigen Zahlen an den Kontext, auch bei sehr großer Kamera und Zeit', () => {
  for (const [camX, time] of [[0, 0], [1e7, 5e5], [-12345.5, 0.001], [123456.789, 99999.9]]) {
    for (const event of [null, ...EVENTS]) {
      const ctx = recCtx();
      drawBackground(ctx, state({ world: 3, event, env: 1 }), view({ camX, time }));
      for (const c of ctx.calls) {
        for (const a of c.slice(1)) {
          if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} bekam ${a}`);
        }
      }
    }
  }
});

test('ungültige Eingaben (NaN, fehlende Felder, unbekannte Welt) werfen nicht', () => {
  const s = state();
  s.world = { from: -1, to: 7, blend: NaN };
  assert.doesNotThrow(() => drawBackground(recCtx(), s, view({ camX: NaN, time: NaN })));
  const noEvents = state();
  delete noEvents.events;
  assert.doesNotThrow(() => drawBackground(recCtx(), noEvents, view()));
  const badEvent = state();
  badEvent.events.active = { type: 'meteor', t: NaN, dur: 0, data: {} };
  assert.doesNotThrow(() => drawBackground(recCtx(), badEvent, view()));
  assert.doesNotThrow(() => drawBackground(recCtx(), state(), { W, H }));
});

test('nichts außerhalb des Bildes: Kreise, Flecken und Sterne liegen im sichtbaren Bereich', () => {
  for (const camX of [0, 777, 5000, 123456]) {
    for (const event of [null, 'shower', 'storm', 'supermoon', 'meteor']) {
      const ctx = recCtx();
      drawBackground(ctx, state({ event, env: 1 }), view({ camX, time: 9 }));
      for (const c of ctx.calls) {
        if (c[0] === 'setTransform' && c[3] === 0) {
          // Fleck mit Radius a: er muss das Bild berühren (kleine Toleranz für Glühwürmchen)
          assert.ok(c[5] + c[1] > -12 && c[5] - c[1] < W + 12, `Fleck bei x ${c[5]} mit Radius ${c[1]}`);
        } else if (c[0] === 'arc') {
          assert.ok(c[1] + c[3] > -10 && c[1] - c[3] < W + 10, `Kreis bei x ${c[1]} mit Radius ${c[3]}`);
        } else if (c[0] === 'fillRect' && c[3] < 20) {
          assert.ok(c[1] > -30 && c[1] < W + 30, `Stern bei x ${c[1]}`);
        }
      }
    }
  }
});

test('Matrix: jede Ebene stellt die Ausgangsmatrix wieder her und rechnet mit ihr', () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const scaled = { a: 1.5, b: 0, c: 0, d: 1.5, e: 3, f: -2 };
  for (const event of [null, 'storm']) {
    const a = recCtx(identity);
    const b = recCtx(scaled);
    drawBackground(a, state({ event, env: 1 }), view({ camX: 400 }));
    drawBackground(b, state({ event, env: 1 }), view({ camX: 400 }));
    const ta = names(a, 'setTransform');
    const tb = names(b, 'setTransform');
    assert.equal(ta.length, tb.length);
    assert.ok(ta.length > 10);
    // letzter Aufruf stellt die Ausgangsmatrix her
    assert.deepEqual(ta[ta.length - 1].slice(1), [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(tb[tb.length - 1].slice(1), [1.5, 0, 0, 1.5, 3, -2]);
    ta.forEach((c, i) => {
      const d = tb[i];
      assert.ok(Math.abs(d[1] - 1.5 * c[1]) < 1e-9, 'a skaliert');
      assert.ok(Math.abs(d[4] - 1.5 * c[4]) < 1e-9, 'd skaliert');
      assert.ok(Math.abs(d[5] - (1.5 * c[5] + 3)) < 1e-9, 'e verschoben');
      assert.ok(Math.abs(d[6] - (1.5 * c[6] - 2)) < 1e-9, 'f verschoben');
    });
  }
});

test('Parallax: Sterne 0,03, Wolken 0,12, Nebel 0,18, Glühwürmchen 0,5', () => {
  // Gleiche Zeit und ruhige Bewegung, nur die Kamera ändert sich. Elemente wandern um camX mal Faktor.
  const cam = 1000;
  const draw = (camX) => {
    const ctx = recCtx();
    drawBackground(ctx, state(), view({ camX, time: 0, reduceMotion: true }));
    return ctx;
  };
  const a = draw(0);
  const b = draw(cam);

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
  const far = recCtx();
  drawBackground(far, state(), view({ camX: 5e6, reduceMotion: true }));
  const halo = names(far, 'fillRect').find((c) => c[3] > 150 && c[3] < 500 && c[3] === c[4]);
  assert.ok(halo && halo[1] > 0 && halo[1] + halo[3] < W + 200, 'Mond bleibt im Bild');
});

test('Supermond: der Mond wächst mit der Hüllkurve bis etwa Faktor 1,7', () => {
  // Mondscheibe: größter Kreis im oberen Bildteil (Kreise der Berge liegen weit unten)
  const moonR = (event, env) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ event, env }), view({ reduceMotion: true }));
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

test('Sternschnuppen: Streifen mit Schweif nur bei meteor und env größer 0', () => {
  const strokes = (event, env, time, reduceMotion = false) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ event, env }), view({ time, reduceMotion }));
    return names(ctx, 'stroke').length;
  };
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
  assert.ok(max <= 6, 'höchstens drei Streifen gleichzeitig (jeweils Glanz und Kern)');
  // ruhiger Modus: weniger Streifen gleichzeitig
  let maxReduced = 0;
  for (let time = 0; time < 40; time += 0.1) maxReduced = Math.max(maxReduced, strokes('meteor', 1, time, true));
  assert.ok(maxReduced <= 4);
});

test('Traumsturm dunkelt ab und zeichnet schräge Schleier, mit der Hüllkurve zunehmend', () => {
  const dim = (env) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ event: 'storm', env }), view({ time: 6 }));
    const fills = assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string' && v.startsWith('rgba(6,8,24,'));
    return { alpha: fills.length ? parseFloat(fills[0].split(',')[3]) : 0, ctx };
  };
  assert.equal(dim(0).alpha, 0);
  const half = dim(0.5);
  const full = dim(1);
  assert.ok(half.alpha > 0 && half.alpha < full.alpha, 'dunkler bei höherer Hüllkurve');
  assert.ok(full.alpha > 0.1 && full.alpha < 0.4, 'dezent');
  // Schleier sind geschert: c (dritter Wert der Matrix) ist ungleich 0 und neigt sich nach links
  const sheared = names(full.ctx, 'setTransform').filter((c) => Math.abs(c[3]) > 50);
  assert.ok(sheared.length >= 3, 'mindestens drei Schleier');
  assert.ok(sheared.every((c) => c[3] < 0));
  // ohne Sturm gibt es keine Schleier
  const calm = recCtx();
  drawBackground(calm, state(), view({ time: 6 }));
  assert.equal(names(calm, 'setTransform').filter((c) => Math.abs(c[3]) > 50).length, 0);
});

test('Sternschauer: viele funkelnde Sterne, die mit der Hüllkurve erscheinen', () => {
  const count = (env, reduceMotion = false) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ event: 'shower', env }), view({ reduceMotion }));
    return ctx.calls.filter((c) => !c[0].startsWith('=')).length;
  };
  const plain = (() => { const c = recCtx(); drawBackground(c, state(), view()); return c.calls.filter((x) => !x[0].startsWith('=')).length; })();
  assert.equal(count(0), plain);
  assert.ok(count(0.5) > plain + 10);
  assert.ok(count(1) > count(0.5) + 10);
  assert.ok(count(1, true) < count(1), 'ruhiger Modus zeigt weniger');
});

test('Wetterleuchten nur in Welt 4, selten, sanft und im ruhigen Modus schwächer', () => {
  const flash = (world, time, reduceMotion = false) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ world }), view({ time, reduceMotion }));
    const a = assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string' && v.startsWith('rgba(170,190,255,'));
    return a.length ? Math.max(...a.map((v) => parseFloat(v.split(',')[3]))) : 0;
  };
  let active = 0;
  let max = 0;
  let maxReduced = 0;
  const steps = 1200;
  for (let i = 0; i < steps; i++) {
    const t = i * 0.1;
    const a = flash(3, t);
    if (a > 0) active++;
    max = Math.max(max, a);
    maxReduced = Math.max(maxReduced, flash(3, t, true));
    for (const w of [0, 1, 2]) assert.equal(flash(w, t), 0, `Welt ${w + 1} hat kein Wetterleuchten`);
  }
  assert.ok(active > 20, 'es leuchtet überhaupt');
  assert.ok(active < steps * 0.25, 'aber selten');
  assert.ok(max > 0 && max <= 0.06, `sanft (${max})`);
  assert.ok(maxReduced < max * 0.6, 'ruhiger Modus ist schwächer');
  // deterministisch aus der Zeit
  assert.equal(flash(3, 34.32), flash(3, 34.32));
  // beim Überblenden von Welt 4 nimmt die Stärke weich ab
  const mid = (blend) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ world: 3, to: 0, blend }), view({ time: 34.32 }));
    const a = assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string' && v.startsWith('rgba(170,190,255,'));
    return a.length ? parseFloat(a[0].split(',')[3]) : 0;
  };
  assert.ok(mid(0) > mid(0.4));
  assert.ok(mid(0.4) > mid(0.9));
  assert.equal(mid(1), 0);
});

test('ruhiger Modus: kein Funkeln und kein Schweben, Alphawerte hängen nicht von der Zeit ab', () => {
  const alphas = (time, reduceMotion) => {
    const ctx = recCtx();
    drawBackground(ctx, state(), view({ time, reduceMotion }));
    return assigned(ctx, 'globalAlpha');
  };
  assert.deepEqual(alphas(1, true), alphas(8.7, true));
  assert.notDeepEqual(alphas(1, false), alphas(8.7, false));
  // Wolken, Nebel und Sterne stehen im ruhigen Modus still (nur Glühwürmchen schweben leicht)
  const pos = (time) => {
    const ctx = recCtx();
    drawBackground(ctx, state(), view({ time, reduceMotion: true }));
    return names(ctx, 'fillRect').filter((c) => c[3] === 1.2).map((c) => c[1]);
  };
  assert.deepEqual(pos(1), pos(40));
});

test('Himmelsverlauf und Mond folgen dem Thema der Welt', () => {
  const sky = (world) => {
    const ctx = recCtx();
    drawBackground(ctx, state({ world }), view());
    return assigned(ctx, 'fillStyle').filter((v) => typeof v === 'string');
  };
  // verschiedene Welten ergeben verschiedene Zeichnungen (Farben der Sterne)
  const sets = [0, 1, 2, 3].map((w) => sky(w).join('|'));
  assert.equal(new Set(sets).size, 4);
});

test('nur system-ui und keine externen Ressourcen: der Hintergrund setzt keine Schrift und lädt nichts', () => {
  const ctx = recCtx();
  drawBackground(ctx, state({ event: 'storm', env: 1 }), view());
  assert.equal(assigned(ctx, 'font').length, 0);
  assert.equal(names(ctx, 'drawImage').length, 0);
  assert.equal(names(ctx, 'fillText').length, 0);
});
