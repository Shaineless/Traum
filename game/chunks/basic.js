// Chunk Layouts für die frühe Spielphase (Schwierigkeit 1 bis 2,5).
// Jeder Chunk: { id, name, diff, weight, min, max, mech, rest, build(b) }. Siehe docs/ARCHITEKTUR.md.

export const BASIC = [
  {
    id: 'meadow',
    name: 'Wiese',
    diff: 1,
    weight: 3,
    min: 0,
    max: Infinity,
    mech: [],
    rest: true,
    build(b) {
      const g = b.ground(0, 0, b.int(520, 700));
      b.starsOver(g, b.int(5, 8), 55);
      b.route(g);
    },
  },
];
