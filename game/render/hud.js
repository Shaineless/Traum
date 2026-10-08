// STUB: wird von einem Agenten umgesetzt.
// ui: { state, time, debug, fps, touch, held, stats, ... }
export function drawHud(ctx, s, ui, view) {
  ctx.fillStyle = '#fff';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(s.run.meters), 16, 30);
}
