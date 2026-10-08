// Merkt sich Tastendrücke (Sprung, Dash), bis ein Simulationsschritt sie abholt.
// Bildschirme mit mehr als 60 Hz liefern Bilder ganz ohne Schritt. Ohne diesen Puffer ginge
// ein Sprung verloren, der genau in so einem Bild gedrückt wurde.

export function createInputKeeper() {
  let jump = false;
  let dash = false;
  let held = false;
  let slam = false;
  let thr = false;
  return {
    // Einmal pro Bild mit dem Ergebnis von input.poll() aufrufen
    add(p) {
      jump = jump || p.jumpPressed;
      dash = dash || p.dashPressed;
      held = held || p.jumpHeld;
      slam = slam || !!p.slamPressed;
      thr = thr || !!p.throwPressed;
    },
    // Eingabe für den ersten Schritt dieses Bildes: bekommt alle gemerkten Drücke
    first(p) {
      const out = { move: p.move, jumpPressed: jump, dashPressed: dash, jumpHeld: p.jumpHeld || held, slamPressed: slam, throwPressed: thr, downHeld: !!p.downHeld };
      jump = false;
      dash = false;
      held = false;
      slam = false;
      thr = false;
      return out;
    },
    // Weitere Schritte im selben Bild: nur gehaltene Tasten, keine neuen Drücke
    rest(p) {
      return { move: p.move, jumpPressed: false, dashPressed: false, jumpHeld: p.jumpHeld, slamPressed: false, throwPressed: false, downHeld: !!p.downHeld };
    },
  };
}
