// Tests für game/stats.js: Laden, Speichern, Migration, kaputte Daten, Rekordflags, fehlender Speicher.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStats, loadStats, recordRun, saveStats } from '../game/stats.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function fakeStorage(initial = {}, { failGet = false, failSet = false } = {}) {
  const data = { ...initial };
  const store = {
    data,
    getItem(k) {
      if (failGet) throw new Error('gesperrt');
      return k in data ? data[k] : null;
    },
    setItem(k, v) {
      if (failSet) throw new Error('Quota');
      data[k] = String(v);
    },
    removeItem(k) { delete data[k]; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  return store;
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

const KEY = 'test-nimbus';
const RUN = { score: 500, distance: 300, stars: 20, kills: 4, bestCombo: 3, time: 95.5 };

test('defaultStats liefert jedes Mal ein neues Objekt mit allen Feldern', () => {
  const a = defaultStats();
  assert.deepEqual(a, { bestScore: 0, bestDistance: 0, mostStars: 0, bestCombo: 0, totalKills: 0, longestRun: 0, runs: 0 });
  a.bestScore = 5;
  assert.equal(defaultStats().bestScore, 0);
});

test('Laden ohne gespeicherte Daten gibt die Standardwerte', () => {
  fakeStorage();
  assert.deepEqual(loadStats(KEY), defaultStats());
});

test('Speichern und Laden ergibt dieselben Werte, Schlüssel mit Endung stats', () => {
  const store = fakeStorage();
  const stats = { bestScore: 1234, bestDistance: 800, mostStars: 55, bestCombo: 6, totalKills: 40, longestRun: 301.25, runs: 9 };
  assert.equal(saveStats(KEY, stats), true);
  assert.deepEqual(Object.keys(store.data), [`${KEY}-stats`]);
  assert.deepEqual(loadStats(KEY), stats);
});

test('Der alte Schlüssel mit nur einer Zahl wird als bestScore übernommen', () => {
  const store = fakeStorage({ [KEY]: '4321' });
  const stats = loadStats(KEY);
  assert.deepEqual(stats, { ...defaultStats(), bestScore: 4321 });
  assert.equal(store.data[KEY], '4321', 'der alte Schlüssel bleibt unangetastet');
});

test('Migration: Müll im alten Schlüssel ergibt Standardwerte', () => {
  for (const junk of ['abc', '', '-5', 'NaN', 'Infinity', '12abc']) {
    fakeStorage({ [KEY]: junk });
    assert.deepEqual(loadStats(KEY), defaultStats(), `"${junk}"`);
  }
});

test('Vorhandene Statistik hat Vorrang vor dem alten Schlüssel', () => {
  fakeStorage({ [KEY]: '9999', [`${KEY}-stats`]: JSON.stringify({ bestScore: 10, runs: 2 }) });
  assert.deepEqual(loadStats(KEY), { ...defaultStats(), bestScore: 10, runs: 2 });
});

test('Kaputtes JSON fällt auf die Standardwerte zurück', () => {
  for (const raw of ['{kaputt', '', 'null', '[1,2,3]', '"text"', '42', 'true']) {
    fakeStorage({ [`${KEY}-stats`]: raw });
    assert.deepEqual(loadStats(KEY), defaultStats(), `"${raw}"`);
  }
});

test('Kaputtes JSON: der alte Highscore geht trotzdem nicht verloren', () => {
  fakeStorage({ [KEY]: '777', [`${KEY}-stats`]: '{kaputt' });
  assert.equal(loadStats(KEY).bestScore, 777);
});

test('Ungültige Felder werden bereinigt, unbekannte Felder verworfen', () => {
  fakeStorage({
    [`${KEY}-stats`]: JSON.stringify({
      bestScore: -3, bestDistance: 'viel', mostStars: null, bestCombo: 4.9, totalKills: '12', longestRun: -1, runs: Infinity, extra: 5,
    }),
  });
  assert.deepEqual(loadStats(KEY), { ...defaultStats(), bestCombo: 4, totalKills: 12 });
});

test('localStorage nicht verfügbar: nichts wirft, Standardwerte, Speichern meldet false', () => {
  delete globalThis.localStorage;
  assert.deepEqual(loadStats(KEY), defaultStats());
  assert.equal(saveStats(KEY, defaultStats()), false);
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  assert.deepEqual(loadStats(KEY), defaultStats());
  assert.equal(saveStats(KEY, defaultStats()), false);
});

test('Lesen und Schreiben im Speicher werfen: nichts bricht ab', () => {
  fakeStorage({}, { failGet: true });
  assert.deepEqual(loadStats(KEY), defaultStats());
  fakeStorage({}, { failSet: true });
  assert.equal(saveStats(KEY, { ...defaultStats(), bestScore: 3 }), false);
});

test('Speichern bereinigt auch ungültige Eingaben', () => {
  const store = fakeStorage();
  saveStats(KEY, { bestScore: NaN, mostStars: 7.8, runs: -2, foo: 1 });
  assert.deepEqual(JSON.parse(store.data[`${KEY}-stats`]), { ...defaultStats(), mostStars: 7 });
  saveStats(KEY, null);
  assert.deepEqual(JSON.parse(store.data[`${KEY}-stats`]), defaultStats());
});

// ---------- recordRun ----------

test('recordRun: erster Lauf setzt alle Rekorde, zählt Läufe und Gegner', () => {
  const { stats, records } = recordRun(defaultStats(), RUN);
  assert.deepEqual(records, { score: true, distance: true, stars: true, combo: true, time: true });
  assert.deepEqual(stats, { bestScore: 500, bestDistance: 300, mostStars: 20, bestCombo: 3, totalKills: 4, longestRun: 95.5, runs: 1 });
});

test('recordRun: gleicher Wert ist kein Rekord, nur echtes Übertreffen zählt', () => {
  const prev = { bestScore: 500, bestDistance: 299, mostStars: 21, bestCombo: 3, totalKills: 10, longestRun: 95.5, runs: 3 };
  const { stats, records } = recordRun(prev, RUN);
  assert.deepEqual(records, { score: false, distance: true, stars: false, combo: false, time: false });
  assert.equal(stats.bestScore, 500);
  assert.equal(stats.bestDistance, 300);
  assert.equal(stats.mostStars, 21, 'schlechterer Wert senkt den Rekord nicht');
  assert.equal(stats.totalKills, 14);
  assert.equal(stats.runs, 4);
});

test('recordRun: Werte gleich 0 sind nie ein Rekord', () => {
  const { stats, records } = recordRun(defaultStats(), { score: 0, distance: 0, stars: 0, kills: 0, bestCombo: 0, time: 0 });
  assert.deepEqual(records, { score: false, distance: false, stars: false, combo: false, time: false });
  assert.equal(stats.runs, 1);
});

test('recordRun: ändert das übergebene Objekt nicht', () => {
  const prev = Object.freeze({ bestScore: 10, bestDistance: 10, mostStars: 10, bestCombo: 1, totalKills: 1, longestRun: 10, runs: 1 });
  const run = Object.freeze({ ...RUN });
  const out = recordRun(prev, run);
  assert.notEqual(out.stats, prev);
  assert.equal(prev.bestScore, 10);
  assert.equal(prev.runs, 1);
});

test('recordRun: ungültige Läufe und Statistiken werfen nicht', () => {
  for (const run of [undefined, null, {}, { score: NaN, distance: 'x', stars: -4, kills: Infinity, bestCombo: null, time: undefined }]) {
    const { stats, records } = recordRun(defaultStats(), run);
    assert.deepEqual(records, { score: false, distance: false, stars: false, combo: false, time: false });
    assert.equal(stats.runs, 1);
    assert.equal(stats.totalKills, 0);
  }
  const { stats } = recordRun(undefined, RUN);
  assert.equal(stats.bestScore, 500);
  const again = recordRun(recordRun(null, RUN).stats, { ...RUN, score: 800, kills: 2 });
  assert.equal(again.stats.runs, 2);
  assert.equal(again.stats.totalKills, 6);
  assert.deepEqual(again.records, { score: true, distance: false, stars: false, combo: false, time: false });
});

test('recordRun: Zahlen werden ganzzahlig übernommen, Laufzeit bleibt mit Nachkommastellen', () => {
  const { stats } = recordRun(defaultStats(), { score: 99.9, distance: 10.7, stars: 3.2, kills: 1.9, bestCombo: 2.5, time: 12.345 });
  assert.equal(stats.bestScore, 99);
  assert.equal(stats.bestDistance, 10);
  assert.equal(stats.mostStars, 3);
  assert.equal(stats.totalKills, 1);
  assert.equal(stats.bestCombo, 2);
  assert.equal(stats.longestRun, 12.345);
});

test('Ein ganzer Ablauf: laden, Lauf aufzeichnen, speichern, neu laden', () => {
  fakeStorage({ [KEY]: '100' });
  let stats = loadStats(KEY);
  assert.equal(stats.bestScore, 100);
  const first = recordRun(stats, { ...RUN, score: 90 });
  assert.equal(first.records.score, false, 'unter dem alten Highscore');
  stats = first.stats;
  saveStats(KEY, stats);
  const second = recordRun(loadStats(KEY), { ...RUN, score: 150 });
  assert.equal(second.records.score, true);
  assert.equal(second.stats.runs, 2);
});
