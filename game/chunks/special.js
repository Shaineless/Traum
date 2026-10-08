// Spezial Chunks: der Fallback 'flat' und das Traumtor 'gate'. Beide haben Gewicht 0, der Generator
// wählt sie nie zufällig. 'flat' springt ein, wenn kein Layout validiert werden konnte,
// 'gate' wird bei jedem Torabstand (gateMeter) gebaut.

// Fallback: eine einzige breite Plattform. Unmöglich zu verfehlen, mit ein paar Sternen.
export const FLAT = {
  id: 'flat',
  name: 'Flach',
  diff: 1,
  weight: 0,
  min: 0,
  max: Infinity,
  mech: [],
  rest: true,
  build(b) {
    const g = b.ground(0, 0, b.int(480, 560));
    b.starsOver(g, 5, 42, 40);
    b.route(g);
  },
};

// Traumtor: breite, ebene Plattform mit dem Tor in der Mitte. Ein Sternbogen spannt sich über das Tor,
// rechts und links liegen Sternreihen zum Einsammeln. Kein Gegner, kein Hindernis, kein Risiko.
export const GATE = {
  id: 'gate',
  name: 'Traumtor',
  diff: 1,
  weight: 0,
  min: 0,
  max: Infinity,
  mech: [],
  rest: true,
  special: 'gate',
  build(b) {
    const w = b.int(630, 670);
    const g = b.ground(0, 0, w);
    b.gate(g, 0.5);
    const mid = w / 2;
    // Der Ring ist 120 px breit und 190 px hoch: der weite Bogen spannt sich mit Abstand darüber
    b.starArc(mid - 125, mid + 125, -20, 190, 11);
    b.starLine(40, -42, mid - 170, -42, 4);
    b.starLine(mid + 170, -42, w - 40, -42, 4);
    b.route(g);
  },
};
