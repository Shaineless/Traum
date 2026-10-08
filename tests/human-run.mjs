// Aufruf: node tests/human-run.mjs <skill> <Meter> <Seed von> <Seed bis>
// Zeigt Treffer pro 250 Meter Abschnitt. Gewünschtes Bild für einen normalen Spieler:
// Anfang kaum Treffer, später steigend, aber nie unfair viele.
import { playHuman } from './bot-human.mjs';

const skill = process.argv[2] || 'normal';
const maxMeters = Number(process.argv[3] || 1500);
const from = Number(process.argv[4] || 1);
const to = Number(process.argv[5] || from);
const buckets = {};
const chunks = {};
let runs = 0;
for (let seed = from; seed <= to; seed++) {
  const r = playHuman(seed, { skill, maxMeters });
  runs++;
  for (const h of r.hits) {
    const b = Math.floor(h.meter / 250) * 250;
    buckets[b] = (buckets[b] || 0) + 1;
    chunks[h.chunk] = (chunks[h.chunk] || 0) + 1;
  }
}
const lines = [];
for (let m = 0; m < maxMeters; m += 250) lines.push(`${String(m).padStart(5)} bis ${String(m + 250).padStart(5)} m: ${((buckets[m] || 0) / runs).toFixed(2)} Treffer pro Lauf`);
console.log(`Bot ${skill}, ${runs} Läufe bis ${maxMeters} m`);
console.log(lines.join('\n'));
console.log('JSON:' + JSON.stringify({ skill, runs, buckets, chunks }));
const worst = Object.entries(chunks).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} ${n}`).join(', ');
console.log('meiste Treffer in Abschnitten: ' + worst);
