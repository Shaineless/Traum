// Tests für game/input.js mit kleinen Fakes für window, document und canvas (ohne jsdom).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { H, W } from '../game/constants.js';
import { TOUCH_LAYOUT, createInput } from '../game/input.js';

// Ziel mit addEventListener, das Aufrufe zählt und Ereignisse direkt auslösen kann
function target() {
  const map = new Map();
  const t = {
    adds: 0,
    removes: 0,
    addEventListener(type, fn) {
      t.adds++;
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      t.removes++;
      if (map.has(type)) map.get(type).delete(fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of [...(map.get(type) || [])]) fn(ev);
    },
    listeners() {
      let n = 0;
      for (const set of map.values()) n += set.size;
      return n;
    },
  };
  return t;
}

let installed = false;

function setup() {
  const win = target();
  const doc = Object.assign(target(), { activeElement: null, hidden: false });
  const canvas = Object.assign(target(), {
    hover: false,
    rect: { left: 0, top: 0, width: W, height: H },
    captured: [],
    focusCalls: 0,
    matches(q) { return q === ':hover' && canvas.hover; },
    focus() { canvas.focusCalls++; doc.activeElement = canvas; },
    getBoundingClientRect() { return canvas.rect; },
    setPointerCapture(id) { canvas.captured.push(id); },
  });
  globalThis.window = win;
  globalThis.document = doc;
  installed = true;
  const actions = [];
  let touches = 0;
  const clock = { t: 0 };
  const input = createInput(canvas, { onAction: (a) => actions.push(a), onTouch: () => { touches++; }, now: () => clock.t });
  return {
    win, doc, canvas, input, actions, clock,
    touches: () => touches,
  };
}

afterEach(() => {
  if (installed) {
    delete globalThis.window;
    delete globalThis.document;
    installed = false;
  }
});

const key = (code, o = {}) => ({ code, repeat: false, prevented: false, preventDefault() { this.prevented = true; }, ...o });
const down = (env, code, o) => { const e = key(code, o); env.win.dispatch('keydown', e); return e; };
const up = (env, code) => env.win.dispatch('keyup', key(code));

// Zeiger: Mitte einer Fläche des Layouts in logischen Pixeln, umgerechnet auf Bildschirmkoordinaten
const center = (name) => ({ x: TOUCH_LAYOUT[name].x + TOUCH_LAYOUT[name].w / 2, y: TOUCH_LAYOUT[name].y + TOUCH_LAYOUT[name].h / 2 });
function ptr(env, x, y, o = {}) {
  const r = env.canvas.rect;
  return { pointerId: 1, pointerType: 'touch', button: 0, clientX: r.left + (x * r.width) / W, clientY: r.top + (y * r.height) / H, ...o };
}
const touchDown = (env, name, id = 1) => { const c = center(name); env.canvas.dispatch('pointerdown', ptr(env, c.x, c.y, { pointerId: id })); };
const touchMove = (env, name, id = 1) => { const c = center(name); env.canvas.dispatch('pointermove', ptr(env, c.x, c.y, { pointerId: id })); };
const touchUp = (env, id = 1) => env.canvas.dispatch('pointerup', { pointerId: id, pointerType: 'touch' });

// ---------- Layout ----------

test('Touch Layout: alle Flächen im Bild, mindestens 44 Pixel, ohne Überlappung', () => {
  const names = Object.keys(TOUCH_LAYOUT);
  assert.deepEqual(names.sort(), ['dash', 'jump', 'left', 'pause', 'right']);
  for (const n of names) {
    const r = TOUCH_LAYOUT[n];
    assert.ok(r.w >= 44 && r.h >= 44, `${n} zu klein`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${n} liegt nicht im Bild`);
  }
  for (const a of names) {
    for (const b of names) {
      if (a >= b) continue;
      const p = TOUCH_LAYOUT[a];
      const q = TOUCH_LAYOUT[b];
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      assert.ok(!overlap, `${a} überlappt ${b}`);
    }
  }
});

// ---------- Tastatur ----------

test('Tasten wirken nur mit Fokus oder Maus über dem Canvas', () => {
  const env = setup();
  const e = down(env, 'ArrowRight');
  assert.equal(env.input.poll().move, 0);
  assert.equal(e.prevented, false);
  assert.deepEqual(env.actions, []);
  up(env, 'ArrowRight');

  env.canvas.hover = true;
  const e2 = down(env, 'ArrowRight');
  assert.equal(env.input.poll().move, 1);
  assert.equal(e2.prevented, true, 'Pfeiltaste darf die Seite nicht scrollen');
  up(env, 'ArrowRight');
  assert.equal(env.input.poll().move, 0);

  env.canvas.hover = false;
  env.doc.activeElement = env.canvas;
  down(env, 'KeyD');
  assert.equal(env.input.poll().move, 1);
});

test('Tasten gehen an Textfelder, auch wenn die Maus über dem Canvas liegt', () => {
  const env = setup();
  env.canvas.hover = true;
  env.doc.activeElement = { tagName: 'INPUT' };
  const e = down(env, 'Space');
  assert.equal(e.prevented, false);
  assert.equal(env.input.poll().jumpPressed, false);
  assert.deepEqual(env.actions, []);
});

test('Bewegung: Pfeile und WASD, beide Richtungen ergeben 0', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowLeft');
  assert.equal(env.input.poll().move, -1);
  down(env, 'KeyD');
  assert.equal(env.input.poll().move, 0);
  up(env, 'ArrowLeft');
  assert.equal(env.input.poll().move, 1);
  up(env, 'KeyD');
  down(env, 'KeyA');
  assert.equal(env.input.poll().move, -1);
  up(env, 'KeyA');
  down(env, 'ArrowRight');
  assert.equal(env.input.poll().move, 1);
});

test('Sprung: Flanke gilt genau bis zum nächsten poll, Halten bleibt', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'Space');
  assert.deepEqual(env.input.poll(), { move: 0, jumpPressed: true, jumpHeld: true, dashPressed: false });
  assert.deepEqual(env.input.poll(), { move: 0, jumpPressed: false, jumpHeld: true, dashPressed: false });
  down(env, 'Space', { repeat: true });
  assert.equal(env.input.poll().jumpPressed, false, 'Tastenwiederholung ist keine neue Flanke');
  up(env, 'Space');
  assert.deepEqual(env.input.poll(), { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false });
});

test('Sprungtasten: Space, ArrowUp und KeyW springen, Enter nur als Start', () => {
  for (const code of ['Space', 'ArrowUp', 'KeyW']) {
    const env = setup();
    env.doc.activeElement = env.canvas;
    down(env, code);
    const p = env.input.poll();
    assert.ok(p.jumpPressed && p.jumpHeld, code);
    assert.deepEqual(env.actions, ['press'], code);
    delete globalThis.window;
    delete globalThis.document;
  }
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'Enter');
  const p = env.input.poll();
  assert.equal(p.jumpPressed, false);
  assert.equal(p.jumpHeld, false);
  assert.deepEqual(env.actions, ['press']);
});

test('Ein Tipp, der zwischen zwei Bildern endet, zählt als Sprung mit einem Bild Halten', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'Space');
  up(env, 'Space');
  const p = env.input.poll();
  assert.equal(p.jumpPressed, true);
  assert.equal(p.jumpHeld, true);
  assert.equal(env.input.poll().jumpHeld, false);
});

test('Alte Flanken verfallen (z. B. Tastendruck im Titelbild)', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'Space');
  env.clock.t = 5000;
  assert.equal(env.input.poll().jumpPressed, false);
  env.clock.t = 5010;
  down(env, 'KeyX');
  env.clock.t = 5030;
  assert.equal(env.input.poll().dashPressed, true);
});

test('Dash: alle vier Tasten lösen eine Flanke aus', () => {
  for (const code of ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyK']) {
    const env = setup();
    env.doc.activeElement = env.canvas;
    down(env, code);
    assert.equal(env.input.poll().dashPressed, true, code);
    assert.equal(env.input.poll().dashPressed, false, code);
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('onAction: press für Spieltasten (einmal pro Druck), pause, debug, sonst nichts', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowRight');
  down(env, 'ArrowRight', { repeat: true });
  down(env, 'ArrowRight', { repeat: true });
  assert.deepEqual(env.actions, ['press']);
  env.actions.length = 0;
  down(env, 'KeyP');
  down(env, 'Escape');
  down(env, 'F3');
  assert.deepEqual(env.actions, ['pause', 'pause', 'debug']);
  env.actions.length = 0;
  down(env, 'KeyZ');
  down(env, 'Tab');
  assert.deepEqual(env.actions, []);
  assert.equal(env.input.poll().move, 1);
});

test('preventDefault für Leertaste, Pfeile und F3, nicht für andere Tasten', () => {
  const env = setup();
  env.canvas.hover = true;
  for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']) assert.equal(down(env, code).prevented, true, code);
  for (const code of ['KeyA', 'Tab', 'KeyP', 'ShiftLeft']) assert.equal(down(env, code).prevented, false, code);
});

test('Tasten mit Strg, Alt oder Meta werden ignoriert', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
    const e = down(env, 'ArrowRight', { [mod]: true });
    assert.equal(e.prevented, false);
  }
  assert.equal(env.input.poll().move, 0);
  assert.deepEqual(env.actions, []);
});

test('Tastencode fehlt: event.key hilft', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  env.win.dispatch('keydown', { code: '', key: 'ArrowLeft', repeat: false, preventDefault() {} });
  assert.equal(env.input.poll().move, -1);
  env.win.dispatch('keyup', { code: '', key: 'ArrowLeft' });
  assert.equal(env.input.poll().move, 0);
});

// ---------- Aufräumen ----------

test('Fokusverlust und blur räumen alle gedrückten Tasten auf', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowRight');
  down(env, 'Space');
  env.canvas.dispatch('blur');
  let p = env.input.poll();
  assert.equal(p.move, 0);
  assert.equal(p.jumpHeld, p.jumpPressed, 'nur die Flanke darf noch übrig sein');
  assert.equal(env.input.poll().jumpHeld, false);

  down(env, 'ArrowLeft');
  touchDown(env, 'right');
  env.win.dispatch('blur');
  p = env.input.poll();
  assert.deepEqual(p, { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false });
  assert.deepEqual(env.input.held(), { left: false, right: false, jump: false, dash: false });
});

test('Seite im Hintergrund räumt ebenfalls auf', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowRight');
  touchDown(env, 'jump');
  env.doc.hidden = true;
  env.doc.dispatch('visibilitychange');
  assert.equal(env.input.poll().move, 0);
  assert.equal(env.input.held().jump, false);
});

test('Loslassen zählt auch ohne Fokus, keine hängenden Tasten', () => {
  const env = setup();
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowRight');
  env.doc.activeElement = null;
  up(env, 'ArrowRight');
  assert.equal(env.input.poll().move, 0);
});

test('destroy entfernt alle Listener und macht poll neutral', () => {
  const env = setup();
  const targets = [env.win, env.doc, env.canvas];
  for (const t of targets) assert.ok(t.adds > 0);
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowRight');
  touchDown(env, 'left');
  env.input.destroy();
  for (const t of targets) {
    assert.equal(t.listeners(), 0, 'Listener übrig');
    assert.equal(t.adds, t.removes, 'add und remove nicht ausgeglichen');
  }
  const before = env.actions.length;
  down(env, 'ArrowRight');
  touchDown(env, 'right');
  assert.equal(env.actions.length, before);
  assert.deepEqual(env.input.poll(), { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false });
  env.input.destroy(); // zweimal ist harmlos
});

// ---------- Touch ----------

test('Touch: Zuordnung der Flächen, onTouch einmal, press bei jeder Aktion', () => {
  const env = setup();
  touchDown(env, 'left', 1);
  assert.equal(env.touches(), 1);
  assert.deepEqual(env.actions, ['press']);
  assert.deepEqual(env.input.held(), { left: true, right: false, jump: false, dash: false });
  assert.equal(env.input.poll().move, -1);
  assert.deepEqual(env.canvas.captured, [1]);
  assert.ok(env.canvas.focusCalls >= 1);

  touchDown(env, 'jump', 2);
  assert.equal(env.touches(), 1, 'onTouch nur beim ersten Mal');
  const p = env.input.poll();
  assert.equal(p.jumpPressed, true);
  assert.equal(p.jumpHeld, true);
  assert.equal(p.move, -1);
  assert.equal(env.input.poll().jumpPressed, false);
  assert.equal(env.input.poll().jumpHeld, true);

  touchDown(env, 'dash', 3);
  assert.equal(env.input.poll().dashPressed, true);
  assert.equal(env.input.poll().dashPressed, false);
  assert.deepEqual(env.actions, ['press', 'press', 'press']);

  touchUp(env, 1);
  touchUp(env, 2);
  touchUp(env, 3);
  assert.deepEqual(env.input.held(), { left: false, right: false, jump: false, dash: false });
  assert.equal(env.input.poll().move, 0);
});

test('Touch: links und rechts gleichzeitig ergibt 0, loslassen gibt die andere Richtung frei', () => {
  const env = setup();
  touchDown(env, 'left', 1);
  touchDown(env, 'right', 2);
  assert.equal(env.input.poll().move, 0);
  touchUp(env, 1);
  assert.equal(env.input.poll().move, 1);
  down(env, 'ArrowRight'); // ohne Fokus wirkungslos
  env.doc.activeElement = env.canvas;
  down(env, 'ArrowLeft');
  assert.equal(env.input.poll().move, 0, 'Tastatur links plus Touch rechts');
});

test('Touch: Gleiten von Fläche zu Fläche ändert die Zuordnung', () => {
  const env = setup();
  touchDown(env, 'left');
  env.input.poll();
  touchMove(env, 'right');
  assert.deepEqual(env.input.held(), { left: false, right: true, jump: false, dash: false });
  assert.equal(env.input.poll().move, 1);
  touchMove(env, 'jump');
  let p = env.input.poll();
  assert.equal(p.jumpPressed, true, 'Gleiten auf Sprung ist ein neuer Druck');
  assert.equal(p.move, 0);
  assert.equal(env.input.held().jump, true);
  touchMove(env, 'dash');
  p = env.input.poll();
  assert.equal(p.dashPressed, true);
  assert.equal(p.jumpHeld, false);
  touchMove(env, 'dash');
  assert.equal(env.input.poll().dashPressed, false, 'Bewegung innerhalb der Fläche ist keine Flanke');
  assert.deepEqual(env.actions, ['press'], 'Gleiten löst kein press aus');
});

test('Touch: etwas abrutschen hält die Fläche, weit weg lässt los', () => {
  const env = setup();
  touchDown(env, 'right');
  const r = TOUCH_LAYOUT.right;
  env.canvas.dispatch('pointermove', ptr(env, r.x + r.w / 2, r.y - 16));
  assert.equal(env.input.held().right, true);
  env.canvas.dispatch('pointermove', ptr(env, r.x + r.w / 2, 120));
  assert.equal(env.input.held().right, false);
  assert.equal(env.input.poll().move, 0);
});

test('Touch: Pause Fläche löst pause aus, hält nichts, Hineingleiten pausiert nicht', () => {
  const env = setup();
  touchDown(env, 'pause');
  assert.deepEqual(env.actions, ['pause']);
  assert.deepEqual(env.input.held(), { left: false, right: false, jump: false, dash: false });
  touchUp(env);
  env.actions.length = 0;

  touchDown(env, 'right', 5);
  touchMove(env, 'pause', 5);
  assert.deepEqual(env.actions, ['press']);
  assert.equal(env.input.held().right, false);
});

test('Touch: Fläche daneben zählt als press, hält aber nichts', () => {
  const env = setup();
  env.canvas.dispatch('pointerdown', ptr(env, 400, 150));
  assert.deepEqual(env.actions, ['press']);
  assert.equal(env.touches(), 1);
  assert.deepEqual(env.input.held(), { left: false, right: false, jump: false, dash: false });
  assert.equal(env.input.poll().jumpPressed, false);
});

test('Touch: pointercancel und lostpointercapture räumen auf', () => {
  const env = setup();
  touchDown(env, 'left', 1);
  touchDown(env, 'jump', 2);
  env.canvas.dispatch('pointercancel', { pointerId: 1 });
  assert.equal(env.input.held().left, false);
  assert.equal(env.input.held().jump, true);
  env.canvas.dispatch('lostpointercapture', { pointerId: 2 });
  assert.equal(env.input.held().jump, false);
  touchDown(env, 'right', 3);
  env.win.dispatch('pointerup', { pointerId: 3 });
  assert.equal(env.input.held().right, false);
});

test('Touch: Koordinaten werden aus dem Canvas Rechteck umgerechnet', () => {
  const env = setup();
  env.canvas.rect = { left: 120, top: 40, width: 400, height: 225 };
  touchDown(env, 'jump');
  assert.equal(env.input.held().jump, true);
  touchUp(env);
  env.canvas.rect = { left: 0, top: 0, width: 1600, height: 900 };
  touchDown(env, 'dash');
  assert.equal(env.input.held().dash, true);
  touchUp(env);
  env.canvas.rect = { left: 0, top: 0, width: 0, height: 0 };
  touchDown(env, 'left');
  assert.equal(env.input.held().left, false, 'Rechteck ohne Größe trifft nichts');
});

test('Touch: Fläche mit Rand wird auch knapp daneben getroffen', () => {
  const env = setup();
  const r = TOUCH_LAYOUT.jump;
  env.canvas.dispatch('pointerdown', ptr(env, r.x + r.w + 5, r.y + r.h / 2));
  assert.equal(env.input.held().jump, true);
});

test('Maus: Klick ist press, trifft Touch Flächen erst nach dem ersten Touch', () => {
  const env = setup();
  const c = center('left');
  env.canvas.dispatch('pointerdown', ptr(env, c.x, c.y, { pointerType: 'mouse', pointerId: 7 }));
  assert.deepEqual(env.actions, ['press']);
  assert.equal(env.touches(), 0);
  assert.equal(env.input.held().left, false);
  env.canvas.dispatch('pointerdown', ptr(env, c.x, c.y, { pointerType: 'mouse', pointerId: 7, button: 2 }));
  assert.deepEqual(env.actions, ['press'], 'Rechtsklick ist keine Aktion');

  touchDown(env, 'dash', 1);
  touchUp(env, 1);
  env.canvas.dispatch('pointerdown', ptr(env, c.x, c.y, { pointerType: 'mouse', pointerId: 7 }));
  assert.equal(env.input.held().left, true);
  env.canvas.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse' });
  assert.equal(env.input.held().left, false);
  assert.equal(env.touches(), 1, 'Maus löst onTouch nicht aus');
});

test('Kontextmenü auf dem Canvas wird unterdrückt', () => {
  const env = setup();
  const e = key('x');
  env.canvas.dispatch('contextmenu', e);
  assert.equal(e.prevented, true);
});

test('Pointer Capture Fehler bringt nichts zum Absturz', () => {
  const env = setup();
  env.canvas.setPointerCapture = () => { throw new Error('InvalidPointerId'); };
  env.canvas.focus = () => { throw new Error('kein Fokus'); };
  assert.doesNotThrow(() => touchDown(env, 'left'));
  assert.equal(env.input.held().left, true);
});
