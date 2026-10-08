// STUB: wird von einem Agenten umgesetzt.
import { H, W } from './constants.js';

// Touch Flächen in logischen Koordinaten (800 x 450). Das HUD zeichnet genau diese Rechtecke.
export const TOUCH_LAYOUT = {
  left: { x: 14, y: H - 96, w: 96, h: 82 },
  right: { x: 122, y: H - 96, w: 96, h: 82 },
  jump: { x: W - 150, y: H - 110, w: 136, h: 96 },
  dash: { x: W - 150, y: H - 214, w: 96, h: 80 },
  pause: { x: W - 54, y: 46, w: 40, h: 40 },
};

// onAction(name): 'press' (irgendeine Spielaktion, zum Starten), 'pause', 'debug'
// getRect(): aktuelle Bildschirmposition des Canvas (getBoundingClientRect)
export function createInput(canvas, { onAction = () => {}, onTouch = () => {} } = {}) {
  const keys = new Set();
  const down = (e) => { keys.add(e.code); onAction('press'); };
  const up = (e) => keys.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return {
    // Liefert { move, jumpPressed, jumpHeld, dashPressed } und löscht die Flanken
    poll() {
      return { move: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), jumpPressed: false, jumpHeld: keys.has('Space'), dashPressed: false };
    },
    // Welche Touch Flächen gerade gedrückt sind, für die Darstellung: { left, right, jump, dash }
    held: () => ({}),
    destroy() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    },
  };
}
