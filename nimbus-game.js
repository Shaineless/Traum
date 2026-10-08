// Nimbus Jump'n'Run – eigenständiges ES-Modul ohne Abhängigkeiten.
//
//   import { createNimbusGame } from './nimbus-game.js';
//   const game = createNimbusGame(document.querySelector('#game'), {
//     onGameOver: (score) => console.log('Punkte:', score),
//   });
//   // game.pause(); game.resume(); game.destroy();

const W = 800;
const H = 450;
const STEP = 1 / 60;
const GRAVITY = 1900;
const MOVE_SPEED = 300;
const JUMP_SPEED = 680;
const MAX_FALL = 900;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createNimbusGame(container, options = {}) {
  const { onGameOver, onStar, storageKey = 'nimbus-highscore' } = options;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Nimbus Jump and Run. Pfeiltasten oder A/D zum Laufen, Leertaste zum Springen, P für Pause.',
  );
  canvas.tabIndex = 0;
  Object.assign(canvas.style, {
    width: '100%',
    aspectRatio: `${W} / ${H}`,
    display: 'block',
    touchAction: 'none',
    userSelect: 'none',
    borderRadius: '12px',
  });
  container.append(canvas);
  const ctx = canvas.getContext('2d');

  let highScore = 0;
  try {
    highScore = Number(localStorage.getItem(storageKey)) || 0;
  } catch {
    /* Speicher nicht verfügbar – egal */
  }

  // ---------- Zustand ----------
  let state = 'ready'; // ready | playing | paused | over
  let player, platforms, stars, enemies, camX, genX, lastY, score, lives, time;
  let touchUI = false;

  function reset() {
    player = { x: 120, y: 200, vx: 0, vy: 0, w: 44, h: 34, onGround: false, coyote: 0, buffer: 0, jumps: 0, face: 1, invuln: 0 };
    platforms = [];
    stars = [];
    enemies = [];
    camX = 0;
    score = 0;
    lives = 3;
    time = 0;
    lastY = 360;
    platforms.push({ x: -200, y: 360, w: 700, h: 200 });
    genX = 500;
    generate();
  }

  function generate() {
    while (genX < camX + W * 2) {
      const diff = Math.min(1, camX / 6000);
      const gap = rand(70, 130 + diff * 70);
      const w = rand(220, 460 - diff * 120);
      const y = clamp(lastY + rand(-70, 70), 250, 390);
      const x = genX + gap;
      platforms.push({ x, y, w, h: 200 });
      lastY = y;
      genX = x + w;

      for (let sx = x + 40; sx < x + w - 30; sx += 46) {
        if (Math.random() < 0.55) stars.push({ x: sx, y: y - 50, got: false });
      }
      if (Math.random() < 0.4) {
        const fw = rand(100, 150);
        const fx = x + rand(0, w - fw);
        const fy = y - rand(110, 140);
        platforms.push({ x: fx, y: fy, w: fw, h: 16 });
        for (let sx = fx + 16; sx < fx + fw - 10; sx += 36) stars.push({ x: sx, y: fy - 36, got: false });
      }
      if (w > 280 && Math.random() < 0.35 + diff * 0.3) {
        enemies.push({ x: x + w / 2, y: y - 30, w: 40, h: 30, minX: x + 20, maxX: x + w - 20, dir: Math.random() < 0.5 ? -1 : 1, dead: 0 });
      }
    }
    // Alles weit links der Kamera wegwerfen.
    const cut = camX - 300;
    platforms = platforms.filter((p) => p.x + p.w > cut);
    stars = stars.filter((s) => s.x > cut);
    enemies = enemies.filter((e) => e.x > cut);
  }

  // ---------- Eingabe ----------
  const keys = new Set();
  const pointers = new Map(); // pointerId -> 'left' | 'right' | 'jump'
  let jumpHeld = false;

  function press(action) {
    if (state === 'ready' || state === 'over') {
      start();
      return;
    }
    if (state === 'paused') return;
    if (action === 'jump') {
      player.buffer = JUMP_BUFFER;
      jumpHeld = true;
    }
  }

  const onKeyDown = (e) => {
    if (document.activeElement !== canvas && !canvas.matches(':hover')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', ' '].includes(e.key) || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      state === 'playing' ? pause() : state === 'paused' && resume();
      return;
    }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(e.code)) press('jump');
    else press('move');
  };
  const onKeyUp = (e) => {
    keys.delete(e.code);
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) jumpHeld = false;
  };

  function zoneAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 0.25 ? 'left' : x < 0.5 ? 'right' : 'jump';
  }
  const onPointerDown = (e) => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') touchUI = true;
    canvas.setPointerCapture(e.pointerId);
    const zone = zoneAt(e);
    pointers.set(e.pointerId, zone);
    press(zone === 'jump' ? 'jump' : 'move');
  };
  const onPointerUp = (e) => {
    if (pointers.get(e.pointerId) === 'jump') jumpHeld = false;
    pointers.delete(e.pointerId);
  };
  const onVisibility = () => document.hidden && state === 'playing' && pause();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('visibilitychange', onVisibility);

  function axis() {
    const l = keys.has('ArrowLeft') || keys.has('KeyA') || [...pointers.values()].includes('left');
    const r = keys.has('ArrowRight') || keys.has('KeyD') || [...pointers.values()].includes('right');
    return (r ? 1 : 0) - (l ? 1 : 0);
  }

  // ---------- Spiellogik ----------
  function start() {
    reset();
    state = 'playing';
  }

  function hurt() {
    if (player.invuln > 0) return;
    lives -= 1;
    player.invuln = 1.5;
    if (lives <= 0) return gameOver();
  }

  function respawn() {
    // Auf die nächste Plattform vor der Kamera-Mitte setzen.
    const target = platforms.find((p) => p.h > 100 && p.x + p.w > camX + 120 + 60);
    player.x = Math.max(camX + 120, target ? target.x + 30 : camX + 120);
    player.y = (target ? target.y : 300) - player.h - 4;
    player.vx = player.vy = 0;
  }

  function gameOver() {
    state = 'over';
    const final = Math.floor(score);
    if (final > highScore) {
      highScore = final;
      try {
        localStorage.setItem(storageKey, String(final));
      } catch {
        /* ignorieren */
      }
    }
    onGameOver?.(final);
  }

  function update(dt) {
    time += dt;
    const p = player;
    const dir = axis();
    p.vx = dir * MOVE_SPEED;
    if (dir) p.face = dir;

    p.buffer = Math.max(0, p.buffer - dt);
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    // Springen: Boden/Coyote, danach ein Schwebesprung in der Luft (Wolken können das).
    if (p.buffer > 0) {
      if (p.coyote > 0) {
        p.vy = -JUMP_SPEED;
        p.jumps = 1;
        p.coyote = p.buffer = 0;
        p.onGround = false;
      } else if (p.jumps < 2) {
        p.vy = -JUMP_SPEED * 0.85;
        p.jumps = 2;
        p.buffer = 0;
      }
    }
    // Variable Sprunghöhe: Taste loslassen = früher fallen.
    if (!jumpHeld && p.vy < -200) p.vy += GRAVITY * 1.5 * dt;

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    p.x = Math.max(camX + 4, p.x + p.vx * dt);
    const prevBottom = p.y + p.h;
    p.y += p.vy * dt;

    // Plattformen sind „one-way“: Landung nur von oben.
    p.onGround = false;
    if (p.vy >= 0) {
      for (const pl of platforms) {
        if (p.x + p.w > pl.x && p.x < pl.x + pl.w && prevBottom <= pl.y + 2 && p.y + p.h >= pl.y) {
          p.y = pl.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.jumps = 0;
          break;
        }
      }
    }

    if (p.y > H + 120) {
      lives -= 1;
      if (lives <= 0) return gameOver();
      p.invuln = 1.5;
      respawn();
    }

    // Kamera folgt (nur vorwärts).
    camX = Math.max(camX, p.x - W * 0.35);
    score = Math.max(score, (p.x - 120) / 10) ;
    generate();

    for (const s of stars) {
      if (!s.got && Math.abs(s.x - (p.x + p.w / 2)) < 26 && Math.abs(s.y - (p.y + p.h / 2)) < 30) {
        s.got = true;
        score += 10;
        onStar?.();
      }
    }

    for (const e of enemies) {
      if (e.dead) {
        e.dead += dt;
        continue;
      }
      e.x += e.dir * 60 * dt;
      if (e.x < e.minX || e.x + e.w > e.maxX) e.dir *= -1;
      const overlap = p.x + p.w > e.x && p.x < e.x + e.w && p.y + p.h > e.y && p.y < e.y + e.h;
      if (!overlap) continue;
      if (p.vy > 0 && p.y + p.h - e.y < 18) {
        e.dead = 0.001;
        p.vy = -JUMP_SPEED * 0.7;
        p.jumps = 1;
        score += 25;
      } else {
        hurt();
      }
    }
    enemies = enemies.filter((e) => e.dead < 0.4);
  }

  // ---------- Zeichnen ----------
  const bgStars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.7, r: rand(0.6, 1.8), t: Math.random() * 6 }));

  function cloud(x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h * 0.65, w * 0.5, h * 0.35, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.3, y + h * 0.45, w * 0.26, h * 0.34, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.58, y + h * 0.35, w * 0.3, h * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.78, y + h * 0.55, w * 0.2, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStar(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawNimbus(p) {
    if (p.invuln > 0 && Math.floor(time * 12) % 2) return;
    const bob = p.onGround ? 0 : Math.sin(time * 14) * 1.5;
    const x = p.x - camX;
    const y = p.y + bob;
    cloud(x - 4, y - 6, p.w + 8, p.h + 10, '#fff');
    ctx.fillStyle = '#2b2150';
    const ex = p.face > 0 ? 4 : -4;
    ctx.beginPath();
    ctx.arc(x + p.w * 0.38 + ex, y + p.h * 0.5, 2.6, 0, Math.PI * 2);
    ctx.arc(x + p.w * 0.66 + ex, y + p.h * 0.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,140,170,.55)';
    ctx.beginPath();
    ctx.arc(x + p.w * 0.3 + ex, y + p.h * 0.66, 3.4, 0, Math.PI * 2);
    ctx.arc(x + p.w * 0.74 + ex, y + p.h * 0.66, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function text(str, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0f0a2e');
    g.addColorStop(0.6, '#3a2a7a');
    g.addColorStop(1, '#7a4fa8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (const s of bgStars) {
      const px = (((s.x - camX * 0.05) % W) + W) % W;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 1.5 + s.t);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f5ecc8';
    ctx.beginPath();
    ctx.arc(660, 90, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a7a';
    ctx.beginPath();
    ctx.arc(676, 82, 32, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      const cx = (((i * 260 - camX * 0.2) % (W + 300)) + W + 300) % (W + 300) - 150;
      cloud(cx, 250 + (i % 3) * 30, 150, 60, 'rgba(255,255,255,.08)');
    }

    if (!player) return;

    for (const pl of platforms) {
      const x = pl.x - camX;
      if (x > W || x + pl.w < 0) continue;
      ctx.fillStyle = pl.h > 100 ? '#5b3f9e' : '#8a6fd6';
      ctx.fillRect(x, pl.y, pl.w, Math.min(pl.h, H - pl.y + 10));
      ctx.fillStyle = '#b9a4ff';
      ctx.fillRect(x, pl.y, pl.w, 6);
    }
    for (const s of stars) {
      if (s.got) continue;
      drawStar(s.x - camX, s.y + Math.sin(time * 4 + s.x) * 3, 10, '#ffd966');
    }
    for (const e of enemies) {
      const squash = e.dead ? Math.max(0.1, 1 - e.dead * 4) : 1;
      const x = e.x - camX;
      ctx.save();
      ctx.translate(x, e.y + e.h);
      ctx.scale(1, squash);
      cloud(0, -e.h, e.w, e.h, '#4a4a68');
      ctx.fillStyle = '#ffd966';
      ctx.fillRect(e.w * 0.4, -e.h * 0.2, 5, 12);
      ctx.fillStyle = '#fff';
      ctx.fillRect(e.w * 0.3, -e.h * 0.62, 5, 5);
      ctx.fillRect(e.w * 0.58, -e.h * 0.62, 5, 5);
      ctx.restore();
    }
    drawNimbus(player);

    // HUD
    text(`★ ${Math.floor(score)}`, 16, 32, 22, '#fff', 'left');
    text(`Rekord ${highScore}`, 16, 58, 14, 'rgba(255,255,255,.7)', 'left');
    text('♥'.repeat(Math.max(0, lives)), W - 16, 32, 22, '#ff8aa8', 'right');

    if (touchUI && state === 'playing') {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, H - 90, W * 0.25, 90);
      ctx.fillRect(W * 0.25, H - 90, W * 0.25, 90);
      ctx.fillRect(W * 0.5, H - 90, W * 0.5, 90);
      ctx.globalAlpha = 1;
      text('◀', W * 0.125, H - 38, 30, '#2b2150');
      text('▶', W * 0.375, H - 38, 30, '#2b2150');
      text('Springen', W * 0.75, H - 38, 24, '#2b2150');
    }

    if (state !== 'playing') {
      ctx.fillStyle = 'rgba(10,6,30,.6)';
      ctx.fillRect(0, 0, W, H);
      if (state === 'ready') {
        text('Nimbus', W / 2, 170, 56);
        text('Sammle Traumsterne und hüpf auf Gewitterwolken', W / 2, 215, 18, 'rgba(255,255,255,.85)');
        text('← → / A D laufen · Leertaste springen (2× in der Luft) · P Pause', W / 2, 250, 15, 'rgba(255,255,255,.7)');
        text('Tippen oder Taste drücken zum Starten', W / 2, 300, 20, '#ffd966');
      } else if (state === 'paused') {
        text('Pause', W / 2, H / 2, 48);
        text('P drücken zum Weiterspielen', W / 2, H / 2 + 36, 18, 'rgba(255,255,255,.8)');
      } else {
        text('Aufgewacht!', W / 2, 160, 48);
        text(`Punkte: ${Math.floor(score)}   Rekord: ${highScore}`, W / 2, 210, 22);
        text('Tippen oder Taste drücken für einen neuen Traum', W / 2, 270, 20, '#ffd966');
      }
    }
  }

  // ---------- Schleife & Größe ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * H * dpr) / W);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      if (state === 'playing') update(STEP);
      else time += STEP;
      acc -= STEP;
    }
    draw();
  }
  reset();
  raf = requestAnimationFrame(frame);

  function pause() {
    if (state === 'playing') state = 'paused';
  }
  function resume() {
    if (state === 'paused') {
      state = 'playing';
      last = performance.now();
    }
  }
  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.remove();
  }

  return { pause, resume, destroy };
}
