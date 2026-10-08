// Tests für game/render/hud.js ohne Browser: nichts wirft, Texte, Positionen, Zustände, Aufwand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx } from './mock-ctx.mjs';
import { input, newGame, run } from './helpers.mjs';
import { COMBO, H, MAX_LIVES, W } from '../game/constants.js';
import { TOUCH_LAYOUT } from '../game/input.js';
import { drawHud } from '../game/render/hud.js';
import { banner, popup } from '../game/scoring.js';
import { createState } from '../game/state.js';

// Zeichnet Zuweisungen mit, merkt sich jeden Text samt Schrift, Alpha und absoluter Position
// (translate, scale, save und restore werden mitgerechnet) und zählt Farbverläufe.
function recCtx() {
  const base = createMockCtx();
  const cur = {};
  const texts = [];
  const scales = [];
  const stats = { gradients: 0, saves: 0, restores: 0 };
  let m = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const stack = [];
  return new Proxy(base, {
    get(t, k) {
      if (k === 'texts') return texts;
      if (k === 'scales') return scales;
      if (k === 'stats') return stats;
      if (k === 'fillText') {
        return (str, x, y) => {
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(cur.font || '')?.[1] || 0);
          texts.push({ str, x: m.tx + m.sx * x, y: m.ty + m.sy * y, font: cur.font, size, align: cur.textAlign, alpha: cur.globalAlpha ?? 1 });
          base.calls.push(['fillText', str, x, y]);
        };
      }
      if (k === 'measureText') {
        return (str) => ({ width: String(str).length * Number(/(\d+(?:\.\d+)?)px/.exec(cur.font || '')?.[1] || 10) * 0.55 });
      }
      if (k === 'save') return () => { stats.saves++; stack.push(m); base.calls.push(['save']); };
      if (k === 'restore') return () => { stats.restores++; m = stack.pop() || m; base.calls.push(['restore']); };
      if (k === 'translate') return (x, y) => { m = { ...m, tx: m.tx + m.sx * x, ty: m.ty + m.sy * y }; base.calls.push(['translate', x, y]); };
      if (k === 'scale') return (x, y) => { scales.push([x, y]); m = { ...m, sx: m.sx * x, sy: m.sy * y }; base.calls.push(['scale', x, y]); };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return (...a) => { stats.gradients++; return t[k](...a); };
      }
      return t[k];
    },
    set(t, k, v) { base.calls.push([`=${k}`, v]); cur[k] = v; t[k] = v; return true; },
  });
}

const view = (o = {}) => ({ W, H, camX: 0, time: 12, shakeX: 0, shakeY: 0, reduceMotion: false, debug: false, ...o });
const ui = (o = {}) => ({ state: 'playing', time: 12, debug: false, fps: 60, touch: false, held: {}, stats: { bestScore: 0 }, records: {}, ...o });
const strs = (ctx) => ctx.texts.map((t) => t.str);
const callsOf = (ctx, name) => ctx.calls.filter((c) => c[0] === name);
const hearts = (ctx) => callsOf(ctx, 'bezierCurveTo').length / 4; // jedes Herz besteht aus vier Kurven

const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

function assertSane(ctx) {
  for (const t of ctx.texts) {
    assert.ok(!DASHES.some((d) => t.str.includes(d)), `Gedankenstrich in "${t.str}"`);
    assert.ok(!/(^|\s)-(\s|$)/.test(t.str), `Strich als Satzzeichen in "${t.str}"`);
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), `ungültige Position für "${t.str}"`);
    assert.ok(typeof t.str === 'string' && t.str.length > 0);
  }
  for (const c of ctx.calls) {
    for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} bekam ${a}`);
  }
  assert.equal(ctx.stats.saves, ctx.stats.restores, 'save und restore nicht ausgeglichen');
}

function draw(s, u = ui(), v = view()) {
  const ctx = recCtx();
  drawHud(ctx, s, u, v);
  assertSane(ctx);
  return ctx;
}

const fresh = () => createState({ seed: 3 }); // leere Welt ohne Generator

// ---------- Grundzustände ----------

test('leere Welt zeichnet Punkte, Distanz und volle Herzen', () => {
  const s = fresh();
  const ctx = draw(s);
  assert.deepEqual(strs(ctx).slice(0, 2), ['0', '0 m']);
  assert.equal(hearts(ctx), MAX_LIVES);
  assert.ok(!strs(ctx).some((t) => t.startsWith('x')), 'ohne Combo kein x');
});

test('Punkte bestehen aus Distanz plus Bonus, mit Punkt als Tausendertrenner', () => {
  const s = fresh();
  s.run.bonus = 12000;
  s.run.maxX = 120 + 50 * 128;
  const ctx = draw(s);
  assert.ok(strs(ctx).includes('12.128'));
  assert.ok(strs(ctx).includes('128 m'));
});

test('Rekord: kleine Anzeige, bei Übertreffen "Neuer Rekord", ohne Rekord nichts', () => {
  const s = fresh();
  s.run.bonus = 100;
  assert.ok(strs(draw(s, ui({ stats: { bestScore: 5200 } }))).includes('Rekord 5.200'));
  assert.ok(strs(draw(s, ui({ stats: { bestScore: 50 } }))).includes('Neuer Rekord'));
  const none = strs(draw(s, ui({ stats: { bestScore: 0 } })));
  assert.ok(!none.some((t) => t.includes('Rekord')));
  assert.ok(!strs(draw(s, { state: 'playing' })).some((t) => t.includes('Rekord')), 'ui ohne stats');
});

test('Herzen: immer MAX_LIVES Plätze, Verlust und Gewinn lassen kurz ein Herz pulsieren', () => {
  const s = fresh();
  const u = ui();
  assert.equal(hearts(draw(s, u, view({ time: 10 }))), MAX_LIVES);
  s.lives = 2;
  const lost = draw(s, u, view({ time: 10.1 }));
  assert.equal(hearts(lost), MAX_LIVES + 1, 'das verlorene Herz löst sich auf');
  assert.equal(hearts(draw(s, u, view({ time: 10.3 }))), MAX_LIVES + 1);
  assert.ok(draw(s, u, view({ time: 10.3 })).scales.some(([x]) => x > 1.1), 'verlorenes Herz wächst');
  assert.equal(hearts(draw(s, u, view({ time: 12 }))), MAX_LIVES, 'Puls ist vorbei');
  s.lives = 3;
  draw(s, u, view({ time: 12.1 }));
  assert.ok(draw(s, u, view({ time: 12.2 })).scales.some(([x]) => x > 1.1), 'neues Herz poppt');
  assert.equal(hearts(draw(s, u, view({ time: 14 }))), MAX_LIVES);
  s.lives = 0;
  assert.equal(hearts(draw(s, u, view({ time: 20 }))), MAX_LIVES * 2, 'alle drei lösen sich auf');
  assert.equal(hearts(draw(s, u, view({ time: 25 }))), MAX_LIVES);
});

test('Herzen: leiser Herzschlag beim letzten Leben, ruhiger Modus ohne Wachsen', () => {
  const s = fresh();
  s.lives = 1;
  const peak = Math.PI / 12 + Math.PI; // sin(6 * t) ist 1
  const beat = draw(s, ui(), view({ time: peak }));
  assert.ok(beat.scales.some(([x]) => x > 1.05 && x < 1.1), 'Herzschlag');
  const calm = draw(s, ui(), view({ time: peak, reduceMotion: true }));
  assert.ok(calm.scales.every(([x]) => x <= 1));

  const u = ui();
  const s2 = fresh();
  draw(s2, u, view({ time: 10 }));
  s2.lives = 2;
  const lost = draw(s2, u, view({ time: 10.1, reduceMotion: true }));
  assert.equal(hearts(lost), MAX_LIVES + 1, 'das Herz löst sich auch ruhig auf');
  assert.ok(lost.scales.every(([x]) => x <= 1), 'nichts wächst');
});

test('neuer Spielzustand setzt das Gedächtnis zurück (kein Puls aus dem alten Lauf)', () => {
  const u = ui();
  const a = fresh();
  draw(a, u, view({ time: 10 }));
  a.lives = 1;
  draw(a, u, view({ time: 10.1 }));
  const b = fresh();
  b.lives = 3;
  assert.equal(hearts(draw(b, u, view({ time: 10.2 }))), MAX_LIVES);
  assert.equal(u.hudMem.ref, b);
});

test('schreibgeschütztes ui wirft nicht', () => {
  const s = fresh();
  assert.doesNotThrow(() => draw(s, Object.freeze(ui())));
});

// ---------- Combo ----------

test('Combo: erst ab 2 sichtbar, Anzeige x2 bis x4, danach bleibt es bei x4', () => {
  const seen = [];
  for (let count = 0; count <= 8; count++) {
    const s = fresh();
    s.combo.count = count;
    s.combo.timer = 2;
    const t = strs(draw(s));
    const x = t.find((v) => /^x\d+$/.test(v));
    seen.push(x || null);
    if (count >= 2) assert.ok(t.includes('Combo'));
    else assert.ok(!t.includes('Combo'));
  }
  assert.deepEqual(seen, [null, null, 'x2', 'x3', 'x4', 'x4', 'x4', 'x4', 'x4']);
});

test('Combo: pulsiert nach einem Treffer, später und im ruhigen Modus nicht', () => {
  const s = fresh();
  s.combo.count = 3;
  s.combo.timer = COMBO.WINDOW; // gerade erhöht
  const pop = draw(s);
  assert.ok(pop.scales.some(([x]) => x > 1.25), 'Zahl pulsiert');
  const calm = draw(s, ui(), view({ reduceMotion: true }));
  assert.ok(calm.scales.every(([x]) => x <= 1), 'ruhiger Modus ohne Pulsieren');
  s.combo.timer = 1;
  assert.ok(draw(s).scales.every(([x]) => x <= 1.0001), 'später kein Pulsieren mehr');
});

test('Combo: Zeitbalken folgt dem Timer', () => {
  // Der Balken beginnt bei x = 28 und ist 80 breit. Die rechte Kante jedes Rechtecks steht im ersten arcTo.
  const edges = (s) => callsOf(draw(s), 'arcTo').filter((c) => c[2] === 126 && c[1] === c[3]).map((c) => c[1]);
  const s = fresh();
  s.combo.count = 2;
  s.combo.timer = COMBO.WINDOW;
  assert.deepEqual(edges(s), [108, 108], 'Spur und voller Balken');
  s.combo.timer = COMBO.WINDOW / 2;
  assert.deepEqual(edges(s), [108, 68]);
  s.combo.timer = 0.1;
  assert.deepEqual(edges(s), [108, 34], 'ein kleiner Rest bleibt sichtbar');
  s.combo.timer = 0.01;
  assert.deepEqual(edges(s), [108], 'praktisch leer');
});

test('Combo: kaputte Werte werfen nicht', () => {
  const s = fresh();
  s.combo.count = 3;
  s.combo.timer = NaN;
  assert.doesNotThrow(() => draw(s));
  s.combo.timer = -5;
  assert.doesNotThrow(() => draw(s));
  s.combo.timer = 1e9;
  assert.doesNotThrow(() => draw(s));
});

// ---------- Powerups ----------

test('Powerups: nur aktive werden angezeigt, Shift Hinweis nur bei Dash', () => {
  const s = fresh();
  const none = draw(s);
  assert.ok(!strs(none).includes('Shift'));
  assert.equal(callsOf(none, 'ellipse').filter((c) => c[3] === 4.6).length, 0, 'kein Dash Symbol');

  s.player.power.dashT = 5;
  const dash = draw(s);
  assert.ok(strs(dash).includes('Shift'));
  assert.ok(callsOf(dash, 'ellipse').some((c) => c[3] === 4.6), 'Dash Symbol');
  assert.ok(!strs(draw(s, ui({ touch: true }))).includes('Shift'), 'mit Touch gibt es die Taste, keinen Tastenhinweis');
  s.player.power.dashT = 0;
  assert.ok(!strs(draw(s)).includes('Shift'), 'nach Ablauf kein Hinweis mehr');

  s.player.power.feather = 2;
  assert.ok(strs(draw(s)).includes('2'), 'Feder als Zähler');
  s.player.power.feather = 0;
  assert.ok(!strs(draw(s)).includes('2'));
});

test('Powerups: Anzahl der Blasen und Restzeit Ringe', () => {
  const bubbles = (ctx) => callsOf(ctx, 'arc').filter((c) => c[3] === 17).length;
  const s = fresh();
  assert.equal(bubbles(draw(s)), 0);
  s.player.power.shield = true;
  assert.equal(bubbles(draw(s)), 1);
  s.player.power.magnetT = 4;
  s.player.power.dashT = 4;
  s.player.power.feather = 1;
  assert.equal(bubbles(draw(s)), 4);
  const arcs = callsOf(draw(s), 'arc').filter((c) => c[3] === 15.5);
  assert.ok(arcs.length >= 8, 'je Blase Spur und Ring');
});

test('Powerups: blinken kurz vor dem Ende, ruhig im ruhigen Modus', () => {
  const s = fresh();
  s.player.power.magnetT = 1;
  const alphas = (v) => {
    const c = draw(s, ui(), v);
    return new Set(c.calls.filter((x) => x[0] === '=globalAlpha').map((x) => x[1].toFixed(3)));
  };
  const a1 = alphas(view({ time: 1 }));
  const a2 = alphas(view({ time: 1.17 }));
  assert.notDeepEqual([...a1].sort(), [...a2].sort(), 'Alpha ändert sich mit der Zeit');
  assert.deepEqual([...alphas(view({ time: 1, reduceMotion: true }))].sort(), [...alphas(view({ time: 1.17, reduceMotion: true }))].sort());
});

test('Dash im Abklingen wird abgedunkelt gezeichnet', () => {
  const s = fresh();
  s.player.power.dashT = 5;
  const ready = draw(s);
  s.player.dash.cd = 0.4;
  const cooling = draw(s);
  const set = (c) => new Set(c.calls.filter((x) => x[0] === '=globalAlpha').map((x) => +x[1].toFixed(2)));
  assert.ok(!set(ready).has(0.55));
  assert.ok(set(cooling).has(0.55));
});

// ---------- Popups ----------

test('Popups in Weltkoordinaten werden um die Kamera verschoben, Bildschirm Popups nicht', () => {
  const s = fresh();
  popup(s, 500, 200, '+25');
  popup(s, 120, 90, 'Aua!', { screen: true });
  for (const p of s.popups) p.t = p.dur * 0.4;
  const ctx = draw(s, ui(), view({ camX: 300 }));
  const world = ctx.texts.find((t) => t.str === '+25');
  const screen = ctx.texts.find((t) => t.str === 'Aua!');
  assert.equal(Math.round(world.x), 200);
  assert.equal(Math.round(world.y), 200);
  assert.equal(Math.round(screen.x), 120);
  assert.equal(Math.round(screen.y), 90);
});

test('Popups: Alpha Verlauf ein und aus, außerhalb des Bildes nichts', () => {
  const s = fresh();
  popup(s, 300, 200, 'mitte', { dur: 1 });
  const at = (t) => {
    s.popups[0].t = t;
    return draw(s).texts.find((x) => x.str === 'mitte');
  };
  assert.equal(at(0), undefined, 'ganz am Anfang unsichtbar');
  assert.ok(at(0.04).alpha < at(0.3).alpha, 'blendet ein');
  assert.equal(at(0.3).alpha, 1);
  assert.ok(at(0.8).alpha < 1 && at(0.8).alpha > at(0.97).alpha, 'blendet aus');
  assert.equal(at(1), undefined, 'am Ende unsichtbar');
  s.popups[0].t = 0.4;
  assert.equal(draw(s, ui(), view({ camX: 5000 })).texts.find((x) => x.str === 'mitte'), undefined, 'weit außerhalb');
});

test('Popups: größtes Limit mit gefüllter Liste und Müll Einträge werfen nicht', () => {
  const s = fresh();
  for (let i = 0; i < 14; i++) popup(s, 100 + i * 40, 200, `+${i}`);
  s.popups.push({ x: NaN, y: 3, t: 0.2, dur: 1, text: 'nan', color: '#fff', size: 18 });
  s.popups.push({ x: 10, y: 10, t: 0.2, dur: 1, text: 42 });
  s.popups.push(null);
  for (const p of s.popups) if (p) p.t = 0.3;
  const ctx = draw(s);
  assert.ok(ctx.texts.length >= 8);
});

// ---------- Banner ----------

test('Banner: Titel und Untertitel, sanft ein und ausgeblendet', () => {
  const s = fresh();
  banner(s, 'Traumwelt 2', 'Lila Traumhimmel', 2.6);
  const at = (t) => {
    s.banner.t = t;
    return draw(s).texts;
  };
  assert.equal(at(0).find((x) => x.str === 'Traumwelt 2'), undefined);
  const early = at(0.2).find((x) => x.str === 'Traumwelt 2');
  const mid = at(1.3);
  const late = at(2.3).find((x) => x.str === 'Traumwelt 2');
  assert.ok(early && late);
  assert.equal(mid.find((x) => x.str === 'Traumwelt 2').alpha, 1);
  assert.ok(mid.some((x) => x.str === 'Lila Traumhimmel'));
  assert.ok(early.alpha < 1 && late.alpha < 1);
  assert.equal(mid.find((x) => x.str === 'Traumwelt 2').x, W / 2);
  assert.equal(at(2.6).find((x) => x.str === 'Traumwelt 2'), undefined);
});

test('Banner: lange Hinweise werden verkleinert oder umbrochen und passen in die Breite', () => {
  const s = fresh();
  const cases = [
    ['Brüchige Plattformen nicht zu lange betreten', 2],
    ['Spring von oben auf Gewitterwolken', 1],
    ['Blitze kündigen sich an. Geh aus der Zone', 2],
    ['Traumwelt 2', 1],
    ['Wort'.repeat(30), 1],
  ];
  for (const [text, lines] of cases) {
    banner(s, text, '', 3);
    s.banner.t = 1.5;
    const ctx = draw(s);
    const rows = ctx.texts.filter((x) => x.align === 'center' && x.size >= 13 && /800/.test(x.font));
    assert.equal(rows.length, lines, text);
    assert.equal(rows.map((r) => r.str).join(' '), text);
    for (const r of rows) {
      assert.ok(r.str.length * r.size * 0.55 <= 450.5 || r.size <= 13.01, `"${r.str}" ist zu breit`);
      assert.ok(r.y > 60 && r.y < 175, `"${r.str}" liegt nicht oben in der Mitte (${r.y})`);
    }
  }
  banner(s, 'Titel', 'Untertitel', 3);
  s.banner.t = 1.5;
  const sub = draw(s).texts.find((x) => x.str === 'Untertitel');
  assert.ok(sub && sub.size < 20, 'Untertitel kleiner als der Titel');
});

test('Banner ohne Text, kaputter Banner und kaputte Dauer werfen nicht', () => {
  const s = fresh();
  for (const b of [{ text: '', sub: '', t: 0.5, dur: 2 }, { text: 'x', sub: null, t: NaN, dur: NaN }, { text: 5, sub: 6, t: 1, dur: 2 }, { text: 'ok', sub: 'ok', t: -3, dur: 0 }]) {
    s.banner = b;
    assert.doesNotThrow(() => draw(s));
  }
});

test('Banner im ruhigen Modus gleitet nicht', () => {
  const s = fresh();
  banner(s, 'Hallo', 'Welt', 2.6);
  s.banner.t = 0.15;
  const moving = draw(s).texts.find((x) => x.str === 'Hallo');
  const calm = draw(s, ui(), view({ reduceMotion: true })).texts.find((x) => x.str === 'Hallo');
  s.banner.t = 1.3;
  const rest = draw(s).texts.find((x) => x.str === 'Hallo');
  assert.ok(moving.y < rest.y, 'gleitet von oben herein');
  assert.equal(calm.y, rest.y);
});

// ---------- Touch ----------

test('Touch Tasten nur mit ui.touch und im Zustand playing', () => {
  const s = fresh();
  const base = draw(s).stats.gradients;
  assert.equal(draw(s, ui({ touch: true, state: 'paused' })).stats.gradients, base);
  assert.equal(draw(s, ui({ touch: true, state: 'over' })).stats.gradients, base);
  assert.equal(draw(s, ui({ touch: true, state: 'ready' })).stats.gradients, base);
  assert.equal(draw(s, ui({ touch: false })).stats.gradients, base);
  assert.equal(draw(s, ui({ touch: true })).stats.gradients, base + 4, 'links, rechts, Sprung, Pause');
});

test('Dash Taste nur solange dashT größer 0 ist', () => {
  const s = fresh();
  const base = draw(s, ui({ touch: true })).stats.gradients;
  s.player.power.dashT = 3;
  const withDash = draw(s, ui({ touch: true }));
  // eine zusätzliche Taste, kein weiterer Aufwand pro Frame
  assert.equal(withDash.stats.gradients, base + 1);
  s.player.power.dashT = 0;
  assert.equal(draw(s, ui({ touch: true })).stats.gradients, base);
});

test('Gedrückte Tasten werden hervorgehoben', () => {
  const s = fresh();
  s.player.power.dashT = 3;
  const glowCount = (u) => draw(s, u).calls.filter((c) => c[0] === '=shadowBlur' && c[1] === 14).length;
  assert.equal(glowCount(ui({ touch: true, held: {} })), 0);
  assert.equal(glowCount(ui({ touch: true, held: { left: true } })), 1);
  assert.equal(glowCount(ui({ touch: true, held: { left: true, jump: true, dash: true } })), 3);
  assert.equal(glowCount(ui({ touch: true, held: undefined })), 0, 'ohne held');
});

test('Touch Tasten liegen genau auf den Flächen aus TOUCH_LAYOUT', () => {
  const s = fresh();
  s.player.power.dashT = 3;
  const ctx = draw(s, ui({ touch: true }));
  const moves = callsOf(ctx, 'moveTo').map((c) => [c[1], c[2]]);
  for (const name of ['left', 'right', 'jump', 'dash', 'pause']) {
    const r = TOUCH_LAYOUT[name];
    const inRect = moves.some(([x, y]) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    assert.ok(inRect, `${name} wird nicht in seiner Fläche gezeichnet`);
  }
});

// ---------- Debug ----------

test('Debug Anzeige nur bei ui.debug, mit allen Werten und Monospace Schrift', () => {
  const s = newGame(4);
  run(s, 120, () => input({ move: 1 }));
  const off = draw(s);
  assert.ok(!strs(off).some((t) => t.startsWith('FPS')));
  const on = draw(s, ui({ debug: true, fps: 59.6 }));
  const t = strs(on);
  for (const prefix of ['FPS 60', 'Schwierigkeit', 'Chunk ', 'Gegner', 'Plattformen', 'vx', 'Ereignis', 'Welt', 'Chunks']) {
    assert.ok(t.some((x) => x.startsWith(prefix) || x.includes(prefix)), `Zeile "${prefix}" fehlt`);
  }
  assert.ok(t.some((x) => /Distanz \d+ m/.test(x)));
  assert.ok(t.some((x) => /Partikel \d+/.test(x)));
  const dbg = on.texts.find((x) => x.str.startsWith('Schwierigkeit'));
  assert.ok(/monospace/.test(dbg.font), 'Monospace Schrift');
  assert.ok(dbg.x < 100 && dbg.y > H / 2, 'unten links');
});

test('Debug: leere Welt ohne Generator, aktives Ereignis, mit Touch über den Tasten', () => {
  const s = fresh();
  const t = strs(draw(s, ui({ debug: true })));
  assert.ok(t.includes('Chunk keiner'));
  assert.ok(t.includes('Generator aus'));
  assert.ok(t.includes('Ereignis keins'));
  s.events.active = { type: 'meteor', t: 2, dur: 9, data: {} };
  assert.ok(strs(draw(s, ui({ debug: true }))).includes('Ereignis meteor 7.0 s'));
  const touch = draw(s, ui({ debug: true, touch: true }));
  const lines = touch.texts.filter((x) => x.font && /monospace/.test(x.font));
  for (const l of lines) assert.ok(l.y < TOUCH_LAYOUT.left.y, 'liegt über den Touch Tasten');
});

// ---------- Robustheit und Aufwand ----------

test('kaputte Eingaben werfen nicht', () => {
  const s = fresh();
  s.lives = NaN;
  s.run.bonus = NaN;
  s.run.maxX = Infinity;
  s.player.power.dashT = NaN;
  s.player.power.feather = undefined;
  s.camX = NaN;
  assert.doesNotThrow(() => draw(s, ui({ debug: true, touch: true, fps: NaN }), view({ camX: NaN, time: NaN, W: undefined })));
  assert.doesNotThrow(() => drawHud(recCtx(), fresh(), undefined, undefined));
  assert.doesNotThrow(() => drawHud(recCtx(), fresh(), {}, {}));
  assert.doesNotThrow(() => drawHud(null, fresh(), ui(), view()));
  s.lives = 99;
  assert.equal(hearts(draw(s)), MAX_LIVES);
  s.lives = -4;
  assert.equal(hearts(draw(s)), MAX_LIVES);
});

test('viele Zustände: Zustand und Oberfläche in allen Kombinationen', () => {
  const s = newGame(9);
  for (let step = 0; step < 14; step++) {
    run(s, 90, (st, i) => input({ move: 1, jumpPressed: i % 40 === 0, jumpHeld: i % 40 < 24 }));
    s.combo.count = step;
    s.combo.timer = (step % 4) * 0.9;
    s.player.power.dashT = step % 3 === 0 ? 4 : 0;
    s.player.power.magnetT = step % 2 ? 2 : 0;
    s.player.power.shield = step % 5 === 0;
    s.player.power.feather = step % 3;
    s.lives = step % (MAX_LIVES + 1);
    if (step % 2) banner(s, 'Traumwelt', 'Sternennebel', 2.6);
    popup(s, s.player.x + 60, s.player.y - 20, `+${step}`);
    for (const state of ['playing', 'paused', 'over', 'ready']) {
      for (const touch of [false, true]) {
        for (const debug of [false, true]) {
          for (const reduceMotion of [false, true]) {
            const u = ui({ state, touch, debug, held: { left: touch && step % 2 === 0, jump: touch && step % 3 === 0 } });
            assert.doesNotThrow(() => draw(s, u, view({ camX: s.camX, reduceMotion, time: 5 + step * 0.37 })));
          }
        }
      }
    }
  }
});

test('Aufwand: wenige Farbverläufe und Texte, auch im vollsten Zustand', () => {
  const s = newGame(2);
  run(s, 60, () => input({ move: 1 }));
  s.combo.count = 5;
  s.combo.timer = 2;
  s.player.power = { shield: true, dashT: 5, magnetT: 5, feather: 2 };
  banner(s, 'Traumwelt 3', 'Sternennebel', 2.6);
  s.banner.t = 1;
  for (let i = 0; i < 12; i++) popup(s, s.camX + 100 + i * 50, 200, `+${i}`);
  for (const p of s.popups) p.t = 0.3;
  const ctx = draw(s, ui({ debug: true, touch: true, held: { left: true }, stats: { bestScore: 3000 } }));
  assert.ok(ctx.stats.gradients <= 14, `zu viele Farbverläufe: ${ctx.stats.gradients}`);
  assert.ok(ctx.texts.length <= 50, `zu viele Texte: ${ctx.texts.length}`);
  assert.ok(ctx.calls.length < 1500, `zu viele Aufrufe: ${ctx.calls.length}`);
  assert.equal(ctx.calls.filter((c) => c[0] === 'createPattern' || c[0] === 'drawImage').length, 0, 'keine Bilder');
});

test('Texte nutzen nur system-ui oder die Monospace Schrift', () => {
  const s = newGame(6);
  run(s, 30, () => input({ move: 1 }));
  s.combo.count = 3;
  s.combo.timer = 2;
  s.player.power.dashT = 4;
  banner(s, 'Test', 'Untertitel', 3);
  s.banner.t = 1;
  popup(s, s.player.x, s.player.y, '+5');
  s.popups[0].t = 0.3;
  const ctx = draw(s, ui({ debug: true }));
  for (const t of ctx.texts) assert.ok(/system-ui|monospace/.test(t.font || ''), `Schrift von "${t.str}": ${t.font}`);
});
