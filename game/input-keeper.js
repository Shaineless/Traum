// Merkt sich Tastendrücke (Sprung, Dash), bis ein Simulationsschritt sie abholt.
// Bildschirme mit mehr als 60 Hz liefern Bilder ganz ohne Schritt. Ohne diesen Puffer ginge
// ein Sprung verloren, der genau in so einem Bild gedrückt wurde.

export function createInputKeeper() {
  let jump = false;
  let dash = false;
  let held = false;
  return {
    // Einmal pro Bild mit dem Ergebnis von input.poll() aufrufen
    add(p) {
      jump = jump || p.jumpPressed;
      dash = dash || p.dashPressed;
      held = held || p.jumpHeld;
    },
    // Eingabe für den ersten Schritt dieses Bildes: bekommt alle gemerkten Drücke
    first(p) {
      const out = { move: p.move, jumpPressed: jump, dashPressed: dash, jumpHeld: p.jumpHeld || held };
      jump = false;
      dash = false;
      held = false;
      return out;
    },
    // Weitere Schritte im selben Bild: nur gehaltene Tasten, keine neuen Drücke
    rest(p) {
      return { move: p.move, jumpPressed: false, dashPressed: false, jumpHeld: p.jumpHeld };
    },
  };
}
