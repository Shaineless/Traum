// STUB: wird von einem Agenten umgesetzt. Zeichnet Gegner, Spieler (mit Effekten) und Partikel.
export function drawCharacters(ctx, s, view) {
  const p = s.player;
  ctx.fillStyle = '#fff';
  ctx.fillRect(p.x - view.camX, p.y, p.w, p.h);
}
