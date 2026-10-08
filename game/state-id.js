// Eigene kleine Datei, damit entities.js und state.js sich nicht gegenseitig importieren.
export function newId(s) {
  return s.nextId++;
}
