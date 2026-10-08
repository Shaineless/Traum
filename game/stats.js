// STUB: wird von einem Agenten umgesetzt.
export const defaultStats = () => ({ bestScore: 0, bestDistance: 0, mostStars: 0, bestCombo: 0, totalKills: 0, longestRun: 0, runs: 0 });
export function loadStats(key) { return defaultStats(); }
export function saveStats(key, stats) {}
// run: { score, distance, stars, kills, bestCombo, time }. Gibt { stats, records } zurück,
// records: { score, distance, stars, combo, time } je true, wenn neuer Rekord.
export function recordRun(stats, run) { return { stats, records: {} }; }
