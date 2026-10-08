// Statistiken im localStorage. Jeder Zugriff steht in try und catch, ohne Speicher läuft das Spiel einfach weiter.
import { STORAGE } from './constants.js';

const INT_FIELDS = ['bestScore', 'bestDistance', 'mostStars', 'bestCombo', 'totalKills', 'runs'];
const FIELDS = [...INT_FIELDS, 'longestRun'];

export const defaultStats = () => ({ bestScore: 0, bestDistance: 0, mostStars: 0, bestCombo: 0, totalKills: 0, longestRun: 0, runs: 0 });

const statsKey = (key) => `${key}-stats`;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // Zugriff verboten (z. B. Frame ohne Rechte)
  }
}

// Endliche Zahl größer gleich 0, alles andere zählt als 0
function count(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
}

// Baut aus beliebigen Daten ein gültiges Statistik Objekt (neues Objekt, die Eingabe bleibt unberührt)
function clean(raw) {
  const out = defaultStats();
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FIELDS) out[f] = INT_FIELDS.includes(f) ? Math.floor(count(raw[f])) : count(raw[f]);
  return out;
}

// Der frühere Highscore stand allein unter dem Schlüssel selbst, als einzelne Zahl
function legacy(store, key) {
  const stats = defaultStats();
  try {
    stats.bestScore = Math.floor(count(store.getItem(key)));
  } catch {
    /* ignorieren */
  }
  return stats;
}

export function loadStats(key = STORAGE.KEY) {
  const store = storage();
  if (!store) return defaultStats();
  try {
    const raw = store.getItem(statsKey(key));
    if (raw !== null && raw !== undefined) {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) return clean(data);
    }
  } catch {
    /* kaputtes JSON oder Speicherfehler: weiter mit dem alten Schlüssel */
  }
  return legacy(store, key);
}

export function saveStats(key = STORAGE.KEY, stats = defaultStats()) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(statsKey(key), JSON.stringify(clean(stats)));
    return true;
  } catch {
    return false; // Speicher voll oder gesperrt
  }
}

// run: { score, distance, stars, kills, bestCombo, time }. Gibt { stats, records } zurück,
// records: { score, distance, stars, combo, time } je true, wenn der Wert den bisherigen Rekord
// übertrifft (gleich zählt nicht) und größer 0 ist. Das übergebene Objekt bleibt unverändert.
export function recordRun(stats, run) {
  const prev = clean(stats);
  const r = run && typeof run === 'object' ? run : {};
  const score = Math.floor(count(r.score));
  const distance = Math.floor(count(r.distance));
  const stars = Math.floor(count(r.stars));
  const kills = Math.floor(count(r.kills));
  const combo = Math.floor(count(r.bestCombo));
  const time = count(r.time);
  const records = {
    score: score > prev.bestScore,
    distance: distance > prev.bestDistance,
    stars: stars > prev.mostStars,
    combo: combo > prev.bestCombo,
    time: time > prev.longestRun,
  };
  const next = {
    bestScore: Math.max(prev.bestScore, score),
    bestDistance: Math.max(prev.bestDistance, distance),
    mostStars: Math.max(prev.mostStars, stars),
    bestCombo: Math.max(prev.bestCombo, combo),
    totalKills: prev.totalKills + kills,
    longestRun: Math.max(prev.longestRun, time),
    runs: prev.runs + 1,
  };
  return { stats: next, records };
}
