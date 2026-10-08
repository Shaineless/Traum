// Aufruf: node tests/bot-run.mjs <Meter> <Seed von> <Seed bis>
// Spielt mehrere Seeds und fasst Treffer pro Chunk zusammen (Hinweis auf unfaire Stellen).
import { playBot } from './bot.mjs';

const meters = Number(process.argv[2] || 600);
const from = Number(process.argv[3] || 1);
const to = Number(process.argv[4] || from);
const perChunk = {};
const runs = [];
for (let seed = from; seed <= to; seed++) {
  const t0 = Date.now();
  const r = playBot(seed, { maxMeters: meters });
  runs.push(r);
  for (const h of r.hits) {
    const e = (perChunk[h.chunk] ||= { hits: 0, unavoidable: 0, causes: {} });
    e.hits++;
    if (h.unavoidable) e.unavoidable++;
    e.causes[h.cause] = (e.causes[h.cause] || 0) + 1;
  }
  console.log(`seed ${seed}: ${r.reached} m, ${r.hits.length} Treffer, ${r.died ? 'tot' : 'ok'}, ${r.seconds}s Spielzeit, ${(Date.now() - t0) / 1000}s echt`);
}
console.log(JSON.stringify({ perChunk, died: runs.filter((r) => r.died).length, runs: runs.length }, null, 1));
