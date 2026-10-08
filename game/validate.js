// Fairness Regeln für frisch gebaute Chunks. Der Generator übernimmt einen Chunk nur,
// wenn validateStaged() keine Fehler meldet. Die Tests prüfen mit denselben Regeln nach.

import { ENEMY, H, LIMITS, WIND, Y_MAX, Y_MIN } from './constants.js';
import { hopOkMoving } from './reach.js';

// Sicherheitsanteil der maximalen Sprungweite: Tutorial großzügig, später knapper
export const safeFor = (diff) => Math.min(0.82, 0.58 + (Math.max(1, diff) - 1) * 0.06);
// Ein Doppelsprung darf erst ab Schwierigkeit 2,5 für Chunk Routen nötig sein
export const dblAllowed = (diff) => diff >= 2.5;

const MECH_TAGS = ['moving', 'breakable', 'walker', 'spike', 'jumper', 'flyer', 'charger', 'lightning', 'wind', 'rain', 'fallingstar', 'powerup'];

// ctx: { ox, diff, mechs: Set, eventWind: px/s Zusatzgegenwind durch Ereignisse, fixedStart: true, isRest }
export function validateStaged(st, ctx) {
  const err = [];
  const { ox, diff, mechs } = ctx;
  const route = st.route;
  if (!route.length) return ['keine Route angegeben'];

  const entry = route[0];
  const exit = route[route.length - 1];
  if (entry.kind !== 'static' || entry.w < 160) err.push('Einstieg muss eine statische Plattform mit mindestens 160 px Breite sein');
  if (Math.abs(entry.x - ox) > 0.5) err.push('Einstieg muss bei lokalem x = 0 beginnen');
  if (exit.kind !== 'static' || exit.w < 140) err.push('Ausstieg muss eine statische Plattform mit mindestens 140 px Breite sein');

  for (const p of st.platforms) {
    if (p.kind === 'breakable' && p.w < 90) err.push(`brüchige Plattform ${p.id} zu schmal`);
    if (p.kind === 'moving' && (Math.abs(p.ax) > 170 || Math.abs(p.ay) > 120)) err.push(`bewegliche Plattform ${p.id} schwingt zu weit`);
    if (p.kind === 'moving' && (Math.PI * 2) / p.omega < 2.2) err.push(`bewegliche Plattform ${p.id} zu schnell`);
  }
  for (const p of route) {
    const top = p.kind === 'moving' ? Math.min(p.oy - Math.abs(p.ay), p.oy + Math.abs(p.ay)) : p.y;
    const bottom = p.kind === 'moving' ? p.oy + Math.abs(p.ay) : p.y;
    if (top < Y_MIN - 1 || bottom > Y_MAX + 1) err.push(`Routenplattform ${p.id} außerhalb des Höhenbereichs (${Math.round(top)} bis ${Math.round(bottom)})`);
  }

  // Sprünge entlang der Route
  const safe = safeFor(diff);
  const dbl = dblAllowed(diff);
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    let headwind = ctx.eventWind || 0;
    for (const z of st.zones) {
      if (z.kind !== 'wind') continue;
      const gx0 = a.x + a.w;
      const gx1 = b.x;
      if (z.x < gx1 + 40 && z.x + z.w > gx0 - 40) headwind = Math.max(headwind, Math.max(0, -z.vx));
    }
    if (!hopOkMoving(a, b, { safe, dbl, wind: Math.min(headwind, WIND.MAX_VX + 100), minLand: 56 })) {
      err.push(`Sprung ${i} (Plattform ${a.id} nach ${b.id}) ist zu schwer für Schwierigkeit ${diff.toFixed(1)}`);
    }
  }

  // Sicherer Anfang
  const safeX = ox + LIMITS.SAFE_START;
  const danger = [];
  for (const e of st.enemies) {
    danger.push({ x0: e.minX, x1: e.maxX + e.w, what: e.kind });
    if (e.kind === 'flyer') continue;
    const host = st.platforms.find((p) => p.id === e.hostId);
    if (!host || host.kind !== 'static') err.push(`${e.kind} ${e.id} braucht eine statische Plattform als Host`);
    else {
      const need = e.kind === 'charger' ? 220 : e.kind === 'jumper' ? 150 : 110;
      if (host.w < need) err.push(`${e.kind} ${e.id}: Host zu schmal (${host.w} < ${need})`);
      if (st.hazards.some((h) => h.kind === 'spike' && h.hostId === host.id)) err.push(`${e.kind} ${e.id} teilt sich eine Plattform mit einer Stachelwolke`);
    }
  }
  for (const h of st.hazards) {
    if (h.kind === 'spike') {
      danger.push({ x0: h.x, x1: h.x + h.w, what: 'spike' });
      const host = st.platforms.find((p) => p.id === h.hostId);
      if (!host || host.kind !== 'static') err.push(`Stachelwolke ${h.id} braucht eine statische Plattform`);
      else {
        if (host.w < 150) err.push(`Stachelwolke ${h.id}: Plattform zu schmal`);
        if (h.x - host.x < 56 || host.x + host.w - (h.x + h.w) < 56) err.push(`Stachelwolke ${h.id} zu nah am Rand (Anlauf und Landung brauchen 56 px)`);
      }
    } else if (h.kind === 'lightning') {
      danger.push({ x0: h.x - h.w / 2, x1: h.x + h.w / 2, what: 'lightning' });
    }
  }
  for (const d of danger) if (d.x0 < safeX) err.push(`${d.what} liegt im sicheren Anfangsbereich (x ${Math.round(d.x0 - ox)} < ${LIMITS.SAFE_START})`);

  const lights = st.hazards.filter((h) => h.kind === 'lightning').sort((p, q) => p.x - q.x);
  for (let i = 1; i < lights.length; i++) if (lights[i].x - lights[i - 1].x < 150) err.push('zwei Blitzzonen liegen zu dicht beieinander');
  if (lights.length > (diff >= 4 ? 3 : 2)) err.push('zu viele Blitzzonen');

  // Gefahrenobjekte dürfen sich nicht überlappen
  const sorted = danger.filter((d) => d.what !== 'flyer').sort((p, q) => p.x0 - q.x0);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.what === 'lightning' || b.what === 'lightning') continue;
    if (b.x0 < a.x1 + 40 && !(a.what === 'walker' && b.what === 'walker')) err.push(`${a.what} und ${b.what} liegen zu dicht beieinander`);
  }

  // Flieger bleiben über normalen Sprungbögen
  for (const e of st.enemies) {
    if (e.kind !== 'flyer') continue;
    let surface = Infinity;
    for (const p of st.platforms) if (p.x + p.w > e.minX - 200 && p.x < e.maxX + e.w + 200) surface = Math.min(surface, p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y);
    if (Number.isFinite(surface) && e.baseY + e.h + e.amp > surface - 165) err.push(`Flieger ${e.id} schwebt zu tief (kollidiert mit normalen Sprüngen)`);
    if (e.baseY - e.amp < 30) err.push(`Flieger ${e.id} liegt über dem Bildrand`);
  }

  // Risikosterne
  for (const star of st.stars) {
    if (star.falling && star.x < safeX - 60) err.push('Risikostern im Anfangsbereich');
    if (star.y < -20 || star.y > H) err.push(`Stern außerhalb des Bildes (y ${Math.round(star.y)})`);
  }

  // Mechaniken nur, wenn freigeschaltet
  for (const tag of st.tags) if (MECH_TAGS.includes(tag) && !mechs.has(tag)) err.push(`Mechanik ${tag} ist an dieser Stelle noch nicht freigeschaltet`);

  // Mengen
  if (st.enemies.length > 6) err.push('zu viele Gegner im Chunk');
  if (st.hazards.length > 5) err.push('zu viele Hindernisse im Chunk');
  if (st.stars.length > 48) err.push('zu viele Sterne im Chunk');
  if (st.platforms.length > 14) err.push('zu viele Plattformen im Chunk');
  void ENEMY;
  return err;
}
