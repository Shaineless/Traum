// Tests für game/render/screens.js (Titel, Pause, Game Over) ohne Browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { H, W } from '../game/constants.js';
import { drawGameOver, drawPause, drawTitle } from '../game/render/screens.js';
import { createState } from '../game/state.js';

// Zeichnet auch Zuweisungen ('=name') und merkt sich jeden Text mit Schrift, Ausrichtung und Alpha.
// translate, scale, save und restore werden mitgerechnet, damit die Textposition absolut im Bild steht.
function recCtx() {
  const base = createMockCtx();
  const cur = {};
  const texts = [];
  let m = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const stack = [];
  return new Proxy(base, {
    get(t, k) {
      if (k === 'texts') return texts;
      if (k === 'fillText') {
        return (str, x, y) => {
          texts.push({ str, x: m.tx + m.sx * x, y: m.ty + m.sy * y, font: cur.font, align: cur.textAlign, alpha: cur.globalAlpha ?? 1 });
          base.calls.push(['fillText', str, x, y]);
        };
      }
      if (k === 'save') return () => { stack.push(m); base.calls.push(['save']); };
      if (k === 'restore') return () => { m = stack.pop() || m; base.calls.push(['restore']); };
      if (k === 'translate') return (x, y) => { m = { ...m, tx: m.tx + m.sx * x, ty: m.ty + m.sy * y }; base.calls.push(['translate', x, y]); };
      if (k === 'scale') return (x, y) => { m = { ...m, sx: m.sx * x, sy: m.sy * y }; base.calls.push(['scale', x, y]); };
      return t[k];
    },
    set(t, k, v) { base.calls.push([`=${k}`, v]); cur[k] = v; t[k] = v; return true; },
  });
}

const view = (o = {}) => ({ W, H, camX: 0, time: 3.2, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });
const strs = (ctx) => ctx.texts.map((t) => t.str);
const count = (ctx) => ctx.calls.filter((c) => !c[0].startsWith('=')).length;
const assigned = (ctx, key) => ctx.calls.filter((c) => c[0] === `=${key}`).map((c) => c[1]);

const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

function assertTextOk(ctx) {
  for (const t of ctx.texts) {
    assert.ok(!DASHES.some((d) => t.str.includes(d)), `Gedankenstrich in "${t.str}"`);
    assert.ok(!/(^|\s)-(\s|$)/.test(t.str), `Strich als Satzzeichen in "${t.str}"`);
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), `ungültige Position für "${t.str}"`);
    assert.ok(t.y > 0 && t.y < H + 1, `"${t.str}" liegt außerhalb in y (${t.y})`);
    assert.ok(t.x >= 0 && t.x <= W, `"${t.str}" liegt außerhalb in x (${t.x})`);
    assert.ok(/system-ui/.test(t.font || ''), 'nur system-ui als Schrift');
  }
  for (const c of ctx.calls) {
    for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} bekam ${a}`);
  }
}

const RESULT = { score: 4821, distance: 4123, stars: 87, kills: 14, bestCombo: 6, time: 251, cause: { kind: 'enemy', label: 'Gewitterwolke' } };
const RECORDS_ALL = { score: true, distance: true, stars: true, combo: true, time: true };

function overUi(o = {}) {
  return { state: 'over', time: 3.2, stats: { bestScore: 4821 }, records: {}, result: { ...RESULT }, overT: 3, touch: false, held: {}, debug: false, ...o };
}

function over(uiOpts = {}, viewOpts = {}) {
  const ctx = recCtx();
  drawGameOver(ctx, createState({ seed: 1 }), overUi(uiOpts), view(viewOpts));
  return ctx;
}

// ---------- Titel ----------

test('Titel: Name, Untertitel, Steuerung, Hinweis und Rekord', () => {
  const ctx = recCtx();
  drawTitle(ctx, { state: 'ready', time: 3, stats: { bestScore: 12345 }, touch: false }, view());
  const s = strs(ctx);
  for (const text of ['Nimbus', 'Ein Traum aus Wolken', 'Tippe oder drücke eine Taste', 'Laufen', 'Springen', 'Dash', 'Pause', 'Leertaste', 'Shift', 'A', 'D', 'P', 'Rekord: 12.345']) {
    assert.ok(s.includes(text), `"${text}" fehlt`);
  }
  assert.ok(s.some((x) => x.startsWith('Touch')), 'Hinweis für Touch');
  assertTextOk(ctx);
  // Nimbus ist groß
  const name = ctx.texts.find((t) => t.str === 'Nimbus');
  assert.ok(parseInt(/(\d+)px/.exec(name.font)[1], 10) >= 70);
});

test('Titel: Rekord nur bei bestScore größer 0, auch mit leeren oder fehlenden Statistiken', () => {
  for (const stats of [undefined, null, {}, { bestScore: 0 }, { bestScore: NaN }, { bestScore: -5 }]) {
    const ctx = recCtx();
    drawTitle(ctx, { state: 'ready', time: 1, stats }, view());
    assert.ok(!strs(ctx).some((x) => x.startsWith('Rekord')), JSON.stringify(stats));
    assertTextOk(ctx);
  }
  const ctx = recCtx();
  drawTitle(ctx, { state: 'ready', stats: { bestScore: 987654321 } }, view());
  assert.ok(strs(ctx).includes('Rekord: 987.654.321'));
});

test('Titel: Hinweis blinkt weich, im ruhigen Modus nicht, und die Figur schwebt nur mit Bewegung', () => {
  const hintAlpha = (time, reduceMotion) => {
    const ctx = recCtx();
    drawTitle(ctx, { stats: {} }, view({ time, reduceMotion }));
    return ctx.texts.find((t) => t.str === 'Tippe oder drücke eine Taste').alpha;
  };
  const moving = [];
  for (let t = 0; t < 4; t += 0.1) moving.push(hintAlpha(t, false));
  assert.ok(Math.max(...moving) - Math.min(...moving) > 0.4, 'blinkt');
  assert.ok(Math.max(...moving) <= 1 && Math.min(...moving) > 0.2, 'bleibt lesbar');
  for (let i = 1; i < moving.length; i++) assert.ok(Math.abs(moving[i] - moving[i - 1]) < 0.2, 'weich, kein hartes Blinken');
  assert.equal(hintAlpha(0.3, true), hintAlpha(2.9, true));
  assert.ok(hintAlpha(0.3, true) > 0.8);
  // ruhiger Modus: die ganze Zeichnung hängt nicht von der Zeit ab
  const draw = (time) => { const c = recCtx(); drawTitle(c, { stats: { bestScore: 5 } }, view({ time, reduceMotion: true })); return JSON.stringify(c.calls); };
  assert.equal(draw(1), draw(7.31));
  const drawMoving = (time) => { const c = recCtx(); drawTitle(c, { stats: { bestScore: 5 } }, view({ time })); return JSON.stringify(c.calls); };
  assert.notEqual(drawMoving(1), drawMoving(1.5));
});

test('Titel und Pause: wenige Zeichenaufrufe, ausgeglichenes save und restore, kein Zustandsverbrauch', () => {
  for (const fn of [drawTitle, drawPause]) {
    for (const reduceMotion of [false, true]) {
      const ctx = recCtx();
      const ui = { stats: { bestScore: 100 }, touch: true };
      const before = JSON.stringify(ui);
      fn(ctx, ui, view({ reduceMotion }));
      assert.ok(count(ctx) < 400, `${fn.name}: ${count(ctx)} Aufrufe`);
      assert.equal(ctx.calls.filter((c) => c[0] === 'save').length, ctx.calls.filter((c) => c[0] === 'restore').length);
      assert.equal(JSON.stringify(ui), before);
    }
  }
});

// ---------- Pause ----------

test('Pause: dunkles Overlay, Titel und Hinweis zum Fortsetzen', () => {
  const ctx = recCtx();
  drawPause(ctx, { state: 'paused' }, view());
  const s = strs(ctx);
  assert.ok(s.includes('Pause'));
  assert.ok(s.includes('Drücke P oder tippe, um weiterzuträumen'));
  assertTextOk(ctx);
  // das Overlay deckt das ganze Bild ab
  assert.ok(ctx.calls.some((c) => c[0] === 'fillRect' && c[1] === 0 && c[2] === 0 && c[3] === W && c[4] === H));
  const dark = assigned(ctx, 'fillStyle').find((v) => typeof v === 'string' && v.startsWith('rgba(10,6,30,'));
  assert.ok(dark && parseFloat(dark.split(',')[3]) >= 0.4, 'dunkel genug');
});

test('Pause: ruhiger Modus ohne Bewegung, normal mit schwebenden z', () => {
  const draw = (time, reduceMotion) => { const c = recCtx(); drawPause(c, {}, view({ time, reduceMotion })); return JSON.stringify(c.calls); };
  assert.equal(draw(0.4, true), draw(5.9, true));
  assert.notEqual(draw(0.4, false), draw(5.9, false));
  assert.doesNotThrow(() => drawPause(recCtx(), undefined, { time: NaN }));
});

// ---------- Game Over ----------

test('Game Over: Überschrift, alle Werte, Ursache und Knopf nach der Einblendung', () => {
  const ctx = over({ records: {} });
  const s = strs(ctx);
  for (const text of ['Du bist aufgewacht.', 'Punkte', 'Distanz', 'Zeit', 'Sterne', 'Gegner', 'Beste Combo', 'Rekord', '4.821', '4.123 m', '4:11', '87', '14', '6', 'Getroffen von: Gewitterwolke', 'Nochmal träumen']) {
    assert.ok(s.includes(text), `"${text}" fehlt`);
  }
  assert.equal(s.filter((x) => x === '4.821').length, 2, 'Punkte und Rekord');
  assert.ok(!s.some((x) => x.includes('Neuer Traumrekord')));
  assertTextOk(ctx);
});

test('Game Over: Zeilen erscheinen gestaffelt in der Reihenfolge des Auftrags, der Knopf nach etwa 0,7 Sekunden', () => {
  const order = ['Punkte', 'Distanz', 'Zeit', 'Sterne', 'Gegner', 'Beste Combo', 'Rekord'];
  const first = {};
  for (let T = 0; T <= 3; T = Math.round((T + 0.01) * 100) / 100) {
    const s = strs(over({ overT: T }));
    for (const key of [...order, 'Du bist aufgewacht.', 'Nochmal träumen']) if (s.includes(key) && first[key] === undefined) first[key] = T;
  }
  for (let i = 1; i < order.length; i++) assert.ok(first[order[i]] > first[order[i - 1]], `${order[i]} nach ${order[i - 1]}`);
  assert.ok(first['Du bist aufgewacht.'] < first.Punkte, 'Überschrift zuerst');
  assert.ok(first.Punkte < 0.3, 'erste Zeile früh');
  assert.ok(first.Rekord < 1.2, 'alles in gut einer Sekunde');
  assert.ok(first['Nochmal träumen'] >= 0.7 && first['Nochmal träumen'] < 0.8, `Knopf bei ${first['Nochmal träumen']}`);
  // ganz am Anfang ist nichts Sichtbares außer dem Schleier
  assert.equal(strs(over({ overT: 0 })).length, 0);
});

test('Game Over: Zahlen zählen hoch und enden beim Endwert', () => {
  const value = (T, reduceMotion = false) => {
    const ctx = over({ overT: T, stats: { bestScore: 0 } }, { reduceMotion });
    const t = ctx.texts.filter((x) => x.str !== 'Punkte' && /^[\d.]+$/.test(x.str) && parseInt(/(\d+)px/.exec(x.font)[1], 10) >= 30);
    return t.length ? parseInt(t[0].str.replace(/\./g, ''), 10) : null;
  };
  let last = -1;
  let seen = 0;
  for (let T = 0.2; T <= 1.2; T += 0.05) {
    const v = value(T);
    if (v === null) continue;
    assert.ok(v >= last, 'steigt nur');
    last = v;
    seen++;
  }
  assert.ok(seen > 5);
  assert.equal(value(3), 4821);
  assert.ok(value(0.35) < 4821, 'noch nicht fertig');
  assert.equal(value(0.35, true), 4821, 'ruhiger Modus zählt nicht ein');
});

test('Game Over: Neuer Traumrekord in Gold nur bei records.score', () => {
  const withRec = over({ records: { score: true } });
  const banner = withRec.texts.find((t) => t.str === '✨ Neuer Traumrekord!');
  assert.ok(banner, 'Text vorhanden');
  assert.equal(banner.x, W / 2, 'mittig');
  assert.equal(over({ records: { distance: true } }).texts.some((t) => t.str.includes('Traumrekord')), false);
  assert.equal(over({ records: undefined }).texts.some((t) => t.str.includes('Traumrekord')), false);
  // Goldton: der Füllwert vor dem Text ist gelblich
  const idx = withRec.calls.findIndex((c) => c[0] === 'fillText' && c[1] === '✨ Neuer Traumrekord!');
  const fill = withRec.calls.slice(0, idx).reverse().find((c) => c[0] === '=fillStyle');
  assert.match(fill[1], /^#ffd2|^#ffd9|^#ffe0/);
  // leichter Puls: der Maßstab wechselt mit der Zeit, im ruhigen Modus nicht
  const scales = (reduceMotion) => {
    const out = [];
    for (let time = 0; time < 2; time += 0.1) {
      const ctx = over({ records: { score: true } }, { time, reduceMotion });
      const i = ctx.calls.findIndex((c) => c[0] === 'fillText' && c[1] === '✨ Neuer Traumrekord!');
      const sc = ctx.calls.slice(0, i).reverse().find((c) => c[0] === 'scale');
      out.push(sc[1]);
    }
    return out;
  };
  const moving = scales(false);
  assert.ok(Math.max(...moving) > 1.02 && Math.max(...moving) < 1.1 && Math.min(...moving) < 1, 'pulsiert leicht');
  assert.ok(scales(true).every((v) => v === 1));
});

test('Game Over: Rekordmarkierungen neben den passenden Zeilen', () => {
  const tags = (records) => over({ records }).texts.filter((t) => t.str === 'Rekord');
  assert.equal(tags({}).length, 1, 'nur die Zeile Rekord');
  assert.equal(tags(RECORDS_ALL).length, 1 + 5);
  assert.equal(tags({ distance: true }).length, 2);
  // die Markierung steht in der Zeile des Rekords
  const ctx = over({ records: { distance: true } });
  const rowY = ctx.texts.find((t) => t.str === '4.123 m').y;
  const tag = ctx.texts.filter((t) => t.str === 'Rekord').find((t) => t.align === 'left' && t.x > 400);
  assert.ok(tag && Math.abs(tag.y - rowY) < 8, 'in der Zeile der Distanz');
  // vor der Zeile ist auch die Markierung noch nicht da
  assert.equal(over({ records: RECORDS_ALL, overT: 0.1 }).texts.filter((t) => t.str === 'Rekord').length, 0);
});

test('Game Over: Ursache aus ui.result.cause', () => {
  const cause = (c) => strs(over({ result: { ...RESULT, cause: c } })).filter((x) => /^Getroffen|^In den Abgrund/.test(x));
  assert.deepEqual(cause({ kind: 'enemy', label: 'Hüpfer' }), ['Getroffen von: Hüpfer']);
  assert.deepEqual(cause({ kind: 'spike', label: 'Stachelwolke' }), ['Getroffen von: Stachelwolke']);
  assert.deepEqual(cause({ kind: 'fall', label: 'In den Abgrund gefallen' }), ['In den Abgrund gefallen']);
  assert.deepEqual(cause({ kind: 'fall' }), ['In den Abgrund gefallen']);
  assert.deepEqual(cause({ kind: 'lightning' }), ['Getroffen']);
  assert.deepEqual(cause(null), []);
  assert.deepEqual(cause(undefined), []);
});

test('Game Over: leere Statistiken, fehlendes Ergebnis und ungültige Zahlen', () => {
  for (const stats of [undefined, null, {}]) {
    const ctx = over({ stats });
    assertTextOk(ctx);
    // der Rekord ist nie kleiner als die erreichte Punktzahl
    assert.equal(strs(ctx).filter((x) => x === '4.821').length, 2);
  }
  // ohne ui.result aus dem Zustand ableiten
  const s = createState({ seed: 1 });
  s.run.bonus = 700;
  s.run.stars = 12;
  s.run.kills = 3;
  s.run.bestCombo = 2;
  s.run.maxX = 120 + 50 * 40;
  s.deathCause = { kind: 'enemy', label: 'Sturmwolke' };
  s.t = 75;
  const ctx = recCtx();
  drawGameOver(ctx, s, overUi({ result: null, stats: {} }), view());
  const str = strs(ctx);
  assert.ok(str.includes('740'), 'Punkte aus Meter und Bonus');
  assert.ok(str.includes('40 m'));
  assert.ok(str.includes('1:15'));
  assert.ok(str.includes('Getroffen von: Sturmwolke'));
  assertTextOk(ctx);
  // ungültige Zahlen
  const bad = recCtx();
  drawGameOver(bad, s, overUi({ result: { score: NaN, distance: Infinity, stars: undefined, kills: 'x', bestCombo: -3, time: NaN, cause: 5 }, overT: NaN }), view({ time: NaN }));
  assertTextOk(bad);
  assert.doesNotThrow(() => drawGameOver(recCtx(), undefined, undefined, { time: 1 }));
  assert.doesNotThrow(() => drawGameOver(recCtx(), s, { overT: 5 }, view()));
});

test('Game Over: viele Zustände ohne Fehler, Aufrufe begrenzt, Texte ohne Gedankenstriche', () => {
  let worst = 0;
  const causes = [null, { kind: 'enemy', label: 'Fliegende Wolke' }, { kind: 'fall', label: 'In den Abgrund gefallen' }];
  const recordSets = [undefined, {}, { score: true }, RECORDS_ALL];
  for (const overT of [0, 0.05, 0.2, 0.45, 0.69, 0.7, 0.71, 1, 1.5, 4, 60]) {
    for (const cause of causes) {
      for (const records of recordSets) {
        for (const reduceMotion of [false, true]) {
          for (const stats of [{}, { bestScore: 99999 }]) {
            const ctx = over({ overT, records, stats, result: { ...RESULT, cause } }, { reduceMotion, time: overT * 3 });
            assertTextOk(ctx);
            worst = Math.max(worst, count(ctx));
            assert.equal(ctx.calls.filter((c) => c[0] === 'save').length, ctx.calls.filter((c) => c[0] === 'restore').length);
          }
        }
      }
    }
  }
  assert.ok(worst < 400, `${worst} Aufrufe`);
});

test('Game Over: Knopf pulsiert sanft nur mit Bewegung und bleibt im Bild', () => {
  const scales = (reduceMotion) => {
    const out = [];
    for (let T = 0.8; T < 2.8; T += 0.1) {
      const ctx = over({ overT: T }, { reduceMotion, time: T });
      const i = ctx.calls.findIndex((c) => c[0] === 'fillText' && c[1] === 'Nochmal träumen');
      const sc = ctx.calls.slice(0, i).reverse().find((c) => c[0] === 'scale');
      out.push(sc[1]);
    }
    return out;
  };
  const moving = scales(false);
  assert.ok(Math.max(...moving) - Math.min(...moving) > 0.03 && Math.max(...moving) < 1.06, 'sanft');
  assert.ok(scales(true).every((v) => v === 1));
  const ctx = over({ overT: 3, records: RECORDS_ALL });
  const btn = ctx.texts.find((t) => t.str === 'Nochmal träumen');
  assert.ok(btn.y > 0 && btn.y < H - 20);
});

test('Game Over ruhiger Modus: die Zeichnung hängt nach der Einblendung nicht von der Zeit ab', () => {
  const draw = (time) => { const c = over({ overT: 4, records: RECORDS_ALL }, { reduceMotion: true, time }); return JSON.stringify(c.calls); };
  assert.equal(draw(1), draw(9.37));
});

test('Texte der Bildschirme enthalten keine Gedankenstriche und verwenden echte Umlaute', () => {
  const all = [];
  const t = recCtx();
  drawTitle(t, { stats: { bestScore: 10 } }, view());
  const p = recCtx();
  drawPause(p, {}, view());
  const g = over({ records: RECORDS_ALL });
  all.push(...strs(t), ...strs(p), ...strs(g));
  for (const text of all) {
    assert.ok(!DASHES.some((d) => text.includes(d)), text);
  }
  assert.ok(all.includes('Nochmal träumen'));
  assert.ok(all.includes('Tippe oder drücke eine Taste'));
  assert.ok(all.includes('Drücke P oder tippe, um weiterzuträumen'));
});
