// STUB: wird von einem Agenten umgesetzt. Zeichnet Plattformen, Zonen, Hindernisse, Sterne, Powerups, Traumtore.
import { themeAt } from '../theme.js';
export function drawWorld(ctx, s, view) {
  const t = themeAt(s.world);
  for (const p of s.platforms) {
    ctx.fillStyle = p.ground ? t.ground : t.float;
    ctx.fillRect(p.x - view.camX, p.y, p.w, Math.min(p.h, view.H - p.y + 10));
  }
}
