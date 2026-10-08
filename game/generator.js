// STUB: wird von einem Agenten umgesetzt.
import { createStaticPlatform } from './entities.js';
import { LIMITS } from './constants.js';
export function initGenerator(s) {
  s.platforms.push(createStaticPlatform(s, -200, 360, 800, { ground: true }));
  s.gen = { nextX: 600, lastY: 360, chunkId: 'start', spans: [], stats: { chunks: 0, rejects: 0, fallbacks: 0 } };
  ensureAhead(s);
}
export function ensureAhead(s) {
  while (s.gen.nextX < s.camX + LIMITS.GEN_AHEAD) {
    s.platforms.push(createStaticPlatform(s, s.gen.nextX + 80, 360, 400, { ground: true }));
    s.gen.nextX += 480;
  }
  s.platforms = s.platforms.filter((p) => p.x + p.w > s.camX - LIMITS.CLEAN_BEHIND);
}
export function updateHints(s) {}
export function chunkAt(s, x) { return s.gen ? s.gen.chunkId : ''; }
