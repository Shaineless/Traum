// STUB: wird von einem Agenten umgesetzt.
export function drawTitle(ctx, ui, view) {
  ctx.fillStyle = 'rgba(10,6,30,.6)'; ctx.fillRect(0, 0, view.W, view.H);
  ctx.fillStyle = '#fff'; ctx.font = '600 48px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Nimbus', view.W / 2, 180);
}
export function drawPause(ctx, ui, view) {}
// result: { score, distance, stars, kills, bestCombo, time, cause }. ui.records: Rekordflags. ui.overT: Sekunden seit Game Over.
export function drawGameOver(ctx, s, ui, view) {
  ctx.fillStyle = 'rgba(10,6,30,.6)'; ctx.fillRect(0, 0, view.W, view.H);
  ctx.fillStyle = '#fff'; ctx.font = '600 40px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Du bist aufgewacht.', view.W / 2, 180);
}
