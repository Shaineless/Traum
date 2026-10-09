// Eingabe: Tastatur und Touch (Pointer Events). Neben game/render ist das die einzige Datei mit DOM Zugriff.
// poll() liefert pro Bild { move, jumpPressed, jumpHeld, dashPressed }, held() die gedrückten Touch Flächen.
import { H, W } from './constants.js';

// Touch Flächen in logischen Koordinaten (800 x 450). Das HUD zeichnet genau diese Rechtecke.
// Alle Flächen sind mindestens 56 Pixel groß, die Daumen Tasten deutlich größer.
export const TOUCH_LAYOUT = {
  left: { x: 16, y: H - 106, w: 104, h: 90 },
  right: { x: 128, y: H - 106, w: 104, h: 90 },
  jump: { x: W - 168, y: H - 120, w: 152, h: 104 },
  dash: { x: W - 288, y: H - 106, w: 112, h: 90 },
  pause: { x: W - 70, y: 100, w: 56, h: 56 },
};

const ROLES = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyK'],
  slam: ['ArrowDown', 'KeyS'], // Stampfen
  throw: ['KeyJ', 'KeyF', 'KeyZ', 'KeyC'], // Sternenwurf
  start: ['Enter'], // Enter startet nur, springt aber nicht
  pause: ['KeyP', 'Escape'],
  debug: ['F3'],
};
const ROLE_OF = {};
for (const role of Object.keys(ROLES)) for (const code of ROLES[role]) ROLE_OF[code] = role;

// Diese Tasten würden sonst die Seite scrollen oder die Browser Suche öffnen
const NO_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);

// Wenn event.code fehlt (manche virtuelle Tastaturen), hilft event.key
const BY_KEY = {
  ' ': 'Space', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  a: 'KeyA', d: 'KeyD', w: 'KeyW', x: 'KeyX', k: 'KeyK', p: 'KeyP', enter: 'Enter', escape: 'Escape', f3: 'F3', shift: 'ShiftLeft',
};

const ZONES = ['jump', 'dash', 'left', 'right', 'pause'];
const HIT_PAD = 8; // Finger treffen knapp daneben, das zählt noch
const STICKY = 26; // wer eine Fläche hält, darf ein Stück abrutschen
const FLANK_MAX_AGE = 250; // ms, ältere Tastendrücke (z. B. aus dem Titelbild) verfallen

const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function inside(r, x, y, pad) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

// Welche Fläche liegt unter dem Punkt? current ist die bisherige Fläche des Fingers (oder null).
function zoneAt(x, y, current) {
  for (const z of ZONES) if (inside(TOUCH_LAYOUT[z], x, y, 0)) return z;
  for (const z of ZONES) if (inside(TOUCH_LAYOUT[z], x, y, HIT_PAD)) return z;
  if (current && current !== 'pause' && inside(TOUCH_LAYOUT[current], x, y, STICKY)) return current;
  return null;
}

// onAction(name): 'press' (irgendeine Spielaktion, zum Starten), 'pause', 'debug'
// onTouch(): einmal beim ersten Touch
// now(): Uhr in Millisekunden, nur für Tests austauschbar
export function createInput(canvas, { onAction = () => {}, onTouch = () => {}, now = defaultNow } = {}) {
  const keys = new Set(); // gedrückte Tastencodes (nur Codes mit Rolle left, right, jump, dash)
  const pointers = new Map(); // pointerId -> Fläche ('left', 'right', 'jump', 'dash', 'pause') oder null
  let jumpAt = null; // Zeitpunkt der letzten Sprung Flanke, null wenn keine offen ist
  let dashAt = null;
  let slamAt = null;
  let throwAt = null;
  let touchSeen = false;
  let dead = false;
  const diag = { last: '', lastAt: 0, jumpDowns: 0, jumpTaken: 0 }; // nur für die Debug Anzeige
  const bound = [];

  const on = (target, type, fn) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn);
    bound.push([target, type, fn]);
  };

  const heldKey = (role) => ROLES[role].some((c) => keys.has(c));

  function zonesHeld() {
    const z = { left: false, right: false, jump: false, dash: false };
    for (const zone of pointers.values()) if (zone && zone in z) z[zone] = true;
    return z;
  }

  function releaseAll() {
    keys.clear();
    pointers.clear();
    jumpAt = null;
    dashAt = null;
    slamAt = null;
    throwAt = null;
  }

  // ---------- Tastatur ----------
  function active() {
    const doc = typeof document !== 'undefined' ? document : null;
    const ae = doc && doc.activeElement;
    if (ae === canvas) return true;
    // Wer gerade in ein Textfeld tippt, bekommt seine Tasten
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || ''))) return false;
    try {
      return !!(canvas.matches && canvas.matches(':hover'));
    } catch {
      return false;
    }
  }

  function codeOf(e) {
    if (e.code && e.code !== 'Unidentified') return e.code;
    const k = typeof e.key === 'string' ? e.key : '';
    return BY_KEY[k] || BY_KEY[k.toLowerCase()] || '';
  }

  function onKeyDown(e) {
    if (e.metaKey) keys.clear(); // unter macOS kommt bei gehaltener Cmd Taste kein keyup
    if (e.ctrlKey || e.metaKey || e.altKey || !active()) return;
    const code = codeOf(e);
    const role = ROLE_OF[code];
    if (!role) {
      if (NO_DEFAULT.has(code)) e.preventDefault();
      return;
    }
    if (NO_DEFAULT.has(code)) e.preventDefault();
    if (role === 'pause' || role === 'debug' || role === 'start') {
      if (!e.repeat) onAction(role === 'start' ? 'press' : role);
      return;
    }
    // Echtes Halten erkennt man an repeat UND daran, dass die Taste schon als gedrückt gilt. Ging ein
    // keyup verloren (Fokuswechsel, Tastaturtreiber), zählt der nächste Druck trotz repeat als neuer Druck.
    const wasDown = keys.has(code);
    keys.add(code);
    diag.last = code;
    diag.lastAt = now();
    if (e.repeat && wasDown) return;
    if (role === 'jump') {
      jumpAt = now();
      diag.jumpDowns++;
    } else if (role === 'dash') dashAt = now();
    else if (role === 'slam') slamAt = now();
    else if (role === 'throw') throwAt = now();
    onAction('press');
  }

  // Loslassen gilt immer, auch wenn der Fokus inzwischen woanders liegt
  function onKeyUp(e) {
    keys.delete(codeOf(e));
  }

  // ---------- Touch ----------
  function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    const x = ((e.clientX - r.left) * W) / r.width;
    const y = ((e.clientY - r.top) * H) / r.height;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function enter(zone) {
    if (zone === 'jump') jumpAt = now();
    else if (zone === 'dash') dashAt = now();
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button > 0) return; // Rechtsklick ist keine Spielaktion
    const touch = e.pointerType !== 'mouse';
    if (touch && !touchSeen) {
      touchSeen = true;
      onTouch();
    }
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      /* Fokus nicht möglich, egal */
    }
    let zone = null;
    // Die Mausklicks treffen die Touch Flächen erst, wenn sie sichtbar sind (nach dem ersten Touch)
    if (touch || touchSeen) {
      const pt = localPoint(e);
      zone = pt ? zoneAt(pt.x, pt.y, null) : null;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* Zeiger schon weg, egal */
      }
      pointers.set(e.pointerId, zone);
    }
    if (zone === 'pause') {
      onAction('pause');
      return;
    }
    enter(zone);
    onAction('press');
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const pt = localPoint(e);
    if (!pt) return;
    const prev = pointers.get(e.pointerId);
    const hit = zoneAt(pt.x, pt.y, prev);
    if (hit === prev) return;
    // Auf die Pause Fläche zu gleiten pausiert nicht, das passiert nur durch Antippen
    const next = hit === 'pause' ? null : hit;
    if (next === prev) return;
    pointers.set(e.pointerId, next);
    enter(next);
  }

  const onPointerEnd = (e) => { pointers.delete(e.pointerId); };
  const onContextMenu = (e) => e.preventDefault(); // langes Drücken öffnet sonst ein Menü

  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  on(win, 'keydown', onKeyDown);
  on(win, 'keyup', onKeyUp);
  on(win, 'blur', releaseAll);
  on(win, 'pointerup', onPointerEnd);
  on(win, 'pointercancel', onPointerEnd);
  on(doc, 'visibilitychange', () => {
    if (doc.hidden) releaseAll();
  });
  on(canvas, 'blur', () => keys.clear());
  on(canvas, 'pointerdown', onPointerDown);
  on(canvas, 'pointermove', onPointerMove);
  on(canvas, 'pointerup', onPointerEnd);
  on(canvas, 'pointercancel', onPointerEnd);
  on(canvas, 'lostpointercapture', onPointerEnd);
  on(canvas, 'contextmenu', onContextMenu);

  return {
    // Liefert { move, jumpPressed, jumpHeld, dashPressed } und löscht die Flanken
    poll() {
      const t = now();
      const jumpPressed = jumpAt !== null && t - jumpAt <= FLANK_MAX_AGE;
      if (jumpPressed) diag.jumpTaken++;
      const dashPressed = dashAt !== null && t - dashAt <= FLANK_MAX_AGE;
      const slamPressed = slamAt !== null && t - slamAt <= FLANK_MAX_AGE;
      const throwPressed = throwAt !== null && t - throwAt <= FLANK_MAX_AGE;
      jumpAt = null;
      dashAt = null;
      slamAt = null;
      throwAt = null;
      if (dead) return { move: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, slamPressed: false, throwPressed: false, downHeld: false };
      const z = zonesHeld();
      const l = heldKey('left') || z.left;
      const r = heldKey('right') || z.right;
      // Ein Tipp, der zwischen zwei Bildern endet, zählt trotzdem als ein Bild gehalten
      const jumpHeld = heldKey('jump') || z.jump || jumpPressed;
      return { move: (r ? 1 : 0) - (l ? 1 : 0), jumpPressed, jumpHeld, dashPressed, slamPressed, throwPressed, downHeld: heldKey('slam') };
    },
    // Welche Touch Flächen gerade gedrückt sind, für die Darstellung: { left, right, jump, dash }
    held: () => zonesHeld(),
    // Für die Debug Anzeige: gedrückte Tasten, zuletzt gesehene Taste, Zähler für Sprungtasten
    diag: () => ({ down: [...keys], last: diag.last, lastAgo: diag.lastAt ? now() - diag.lastAt : -1, jumpDowns: diag.jumpDowns, jumpTaken: diag.jumpTaken }),
    destroy() {
      dead = true;
      for (const [target, type, fn] of bound) target.removeEventListener(type, fn);
      bound.length = 0;
      releaseAll();
    },
  };
}
