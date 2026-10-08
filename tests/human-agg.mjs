// Fasst die JSON Zeilen mehrerer human-run Ausgaben zusammen: node tests/human-agg.mjs <Datei>...
import { readFileSync } from 'node:fs';
const by = {};
for (const f of process.argv.slice(2)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('JSON:')) continue;
    const j = JSON.parse(line.slice(5));
    const e = (by[j.skill] ||= { runs: 0, buckets: {}, chunks: {} });
    e.runs += j.runs;
    for (const [k, v] of Object.entries(j.buckets)) e.buckets[k] = (e.buckets[k] || 0) + v;
    for (const [k, v] of Object.entries(j.chunks)) e.chunks[k] = (e.chunks[k] || 0) + v;
  }
}
for (const [skill, e] of Object.entries(by)) {
  const per = (m) => ((e.buckets[m] || 0) / e.runs);
  const rows = Object.keys(e.buckets).map(Number).sort((a, b) => a - b).map((m) => `${m}:${per(m).toFixed(2)}`);
  const after = Object.entries(e.buckets).filter(([m]) => Number(m) >= 250).reduce((a, [, v]) => a + v, 0) / e.runs;
  console.log(`${skill}: ${e.runs} Läufe, Treffer pro Lauf ab 250 m: ${after.toFixed(2)}`);
  console.log('  pro 250 m: ' + rows.join('  '));
}
