// STUB: wird von einem Agenten umgesetzt.
import { themeAt } from '../theme.js';
// view: { W, H, camX, time, shakeX, shakeY, reduceMotion, debug }
export function drawBackground(ctx, s, view) {
  const t = themeAt(s.world);
  const g = ctx.createLinearGradient(0, 0, 0, view.H);
  g.addColorStop(0, t.sky[0]); g.addColorStop(0.6, t.sky[1]); g.addColorStop(1, t.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.W, view.H);
}
