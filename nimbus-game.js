// Nimbus Jump'n'Run: öffentliche API und Spielschleife.
//
//   import { createNimbusGame } from './nimbus-game.js';
//   const game = createNimbusGame(document.querySelector('#game'), {
//     onGameOver: (score, result) => console.log('Punkte:', score, result),
//     debug: false,
//   });
//   // game.pause(); game.resume(); game.restart(); game.destroy();
//
// Die eigentliche Spiellogik liegt in game/ (sim.js ist der Einstieg).
// Dieses Modul kümmert sich nur um Canvas, Schleife, Eingabe und Bildschirmzustände.

import { H, STEP, STORAGE, W } from './game/constants.js';
import { createState } from './game/state.js';
import { initGenerator } from './game/generator.js';
import { stepSim } from './game/sim.js';
import { meters, totalScore } from './game/scoring.js';
import { createInput } from './game/input.js';
import { loadStats, recordRun, saveStats } from './game/stats.js';
import { drawBackground } from './game/render/background.js';
import { drawWorld } from './game/render/world.js';
import { drawCharacters } from './game/render/characters.js';
import { drawHud } from './game/render/hud.js';
import { drawGameOver, drawPause, drawTitle } from './game/render/screens.js';

const MIN_OVER_TIME = 0.7; // so lange ignoriert der Game Over Bildschirm Tastendrücke

function newRun(seed, debug) {
  const s = createState({ seed, debug });
  initGenerator(s);
  return s;
}

const randomSeed = () => (Math.random() * 0xffffffff) >>> 0;

export function createNimbusGame(container, options = {}) {
  const { onGameOver, onStar, onStats, storageKey = STORAGE.KEY, debug = false, seed } = options;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Nimbus Jump and Run. Pfeiltasten oder A und D zum Laufen, Leertaste zum Springen, Shift für den Regenbogen Dash, P für Pause.',
  );
  canvas.tabIndex = 0;
  Object.assign(canvas.style, {
    width: '100%',
    aspectRatio: `${W} / ${H}`,
    display: 'block',
    touchAction: 'none',
    userSelect: 'none',
    webkitUserSelect: 'none',
    borderRadius: '12px',
    outline: 'none',
  });
  container.append(canvas);
  const ctx = canvas.getContext('2d');

  const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const ui = {
    state: 'ready', // 'ready' | 'playing' | 'paused' | 'over'
    time: 0,
    debug,
    fps: 60,
    touch: false,
    held: {},
    stats: loadStats(storageKey),
    records: {},
    result: null,
    overT: 0,
  };
  let s = newRun(seed ?? randomSeed(), debug);
  let reportedStars = 0;

  // ---------- Ablauf ----------
  function start() {
    s = newRun(seed ?? randomSeed(), ui.debug);
    reportedStars = 0;
    ui.state = 'playing';
    ui.result = null;
    ui.records = {};
    ui.overT = 0;
    canvas.focus({ preventScroll: true });
  }

  function finishRun() {
    const result = {
      score: totalScore(s),
      distance: meters(s),
      stars: s.run.stars,
      kills: s.run.kills,
      bestCombo: s.run.bestCombo,
      time: s.t,
      cause: s.deathCause,
    };
    const { stats, records } = recordRun(ui.stats, result);
    ui.stats = stats;
    ui.records = records;
    ui.result = result;
    ui.state = 'over';
    ui.overT = 0;
    saveStats(storageKey, stats);
    onStats?.(stats);
    onGameOver?.(result.score, result);
  }

  function pause() {
    if (ui.state === 'playing') ui.state = 'paused';
  }
  function resume() {
    if (ui.state === 'paused') {
      ui.state = 'playing';
      last = performance.now();
    }
  }

  const input = createInput(canvas, {
    onTouch: () => { ui.touch = true; },
    onAction(name) {
      if (name === 'press') {
        if (ui.state === 'ready') start();
        else if (ui.state === 'over' && ui.overT > MIN_OVER_TIME) start();
        else if (ui.state === 'paused') resume();
      } else if (name === 'pause') {
        ui.state === 'playing' ? pause() : resume();
      } else if (name === 'debug' && options.debug) {
        ui.debug = !ui.debug;
        s.debug = ui.debug;
      }
    },
  });

  const onVisibility = () => document.hidden && pause();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', pause);

  // ---------- Größe ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * H * dpr) / W);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ---------- Zeichnen ----------
  function render() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    const reduce = !!(reduceMotionQuery && reduceMotionQuery.matches);
    const amp = reduce ? 0 : s.fx.shake;
    const view = {
      W, H, camX: s.camX, time: ui.time, reduceMotion: reduce, debug: ui.debug,
      shakeX: amp ? Math.sin(ui.time * 91) * amp : 0,
      shakeY: amp ? Math.cos(ui.time * 77) * amp : 0,
    };
    ctx.save();
    ctx.translate(view.shakeX, view.shakeY);
    drawBackground(ctx, s, view);
    drawWorld(ctx, s, view);
    drawCharacters(ctx, s, view);
    ctx.restore();

    // Darstellung des Schadens: kurzer Farbblitz über dem ganzen Bild
    if (s.fx.flash > 0 && !reduce) {
      ctx.globalAlpha = Math.min(0.45, s.fx.flash * 0.6);
      ctx.fillStyle = s.fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // Beim Sterben wird das Bild langsam dunkler
    if (s.mode === 'dying' || s.mode === 'over') {
      ctx.fillStyle = `rgba(8,4,24,${Math.min(0.5, s.deathT * 0.4)})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (ui.state !== 'ready') drawHud(ctx, s, ui, view);
    if (ui.state === 'ready') drawTitle(ctx, ui, view);
    else if (ui.state === 'paused') drawPause(ctx, ui, view);
    else if (ui.state === 'over') drawGameOver(ctx, s, ui, view);
  }

  // ---------- Schleife ----------
  let raf = 0;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ui.time += dt;
    ui.fps += (1 / Math.max(dt, 0.001) - ui.fps) * 0.05;
    ui.held = input.held();

    if (ui.state === 'playing') {
      acc += dt;
      let polled = input.poll();
      while (acc >= STEP) {
        stepSim(s, polled, STEP);
        polled = { ...polled, jumpPressed: false, dashPressed: false };
        acc -= STEP;
      }
      if (onStar && s.run.stars > reportedStars) {
        for (; reportedStars < s.run.stars; reportedStars++) onStar();
      }
      if (s.mode === 'over') finishRun();
    } else {
      acc = 0;
      if (ui.state === 'over') ui.overT += dt;
      if (ui.state === 'ready') s.realT += dt;
    }
    render();
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    input.destroy();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', pause);
    canvas.remove();
  }

  return {
    pause,
    resume,
    restart: start,
    destroy,
    setDebug(v) { ui.debug = !!v; s.debug = ui.debug; },
    getState: () => s,
  };
}
