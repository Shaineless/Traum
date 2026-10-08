// Gedankenstriche (Halbgeviert und Geviertstrich) kommen in Spieltexten, Code und Doku nicht vor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git']);
const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(js|mjs|md|html|bat|json)$/.test(name)) out.push(p);
  }
  return out;
}

test('keine Halbgeviert oder Geviertstriche in Quelltexten und Doku', () => {
  const bad = [];
  for (const f of files(ROOT)) {
    const text = readFileSync(f, 'utf8');
    if (DASHES.some((d) => text.includes(d))) bad.push(f.replace(ROOT, ''));
  }
  assert.deepEqual(bad, []);
});
