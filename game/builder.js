// Werkzeugkasten für Chunk Layouts. Chunks beschreiben ihr Layout in lokalen Koordinaten:
// x = 0 ist die linke Kante der ersten Plattform, y = 0 ist die Oberkante der Einstiegsplattform,
// negative y liegen höher. Der Builder rechnet in Weltkoordinaten um und legt die Objekte
// in einer Staging Struktur ab. Der Generator prüft sie und übernimmt sie erst dann in den Spielzustand.

import { COMET, LIGHTNING, RAIN, paceAt } from './constants.js';
import {
  createBlinkPlatform, createBreakablePlatform, createCharger, createComet, createFlyer, createGate, createHailcloud, createJumper,
  createLightning, createMovingPlatform, createPowerup, createRain, createSpike, createSpringPlatform, createStar,
  createStaticPlatform, createWalker, createWind,
} from './entities.js';
import { chance, int, pick, range } from './rng.js';

// measure = true: Probelauf zum Ausmessen. Keine IDs aus dem echten Zustand, nur Ausdehnung zählt.
export function createBuilder(s, { ox, oy, diff, meter, mechs, measure = false, gateIndex = 0 }) {
  const ctx = measure ? { nextId: 1_000_000_000 } : s;
  const X = (x) => ox + x;
  const Y = (y) => oy + y;
  const boost = s.events.starBoost ? 1.5 : 1;
  const pace = paceAt(diff); // Tempo Faktor dieser Schwierigkeit für Gegner, Plattformen und Blitzabstände
  const st = {
    platforms: [], enemies: [], hazards: [], zones: [], stars: [], powerups: [], gates: [], route: [],
    minY: Infinity, maxY: -Infinity, platMinY: Infinity, platMaxY: -Infinity, maxX: 0, tags: new Set(),
  };

  const track = (x, y, w = 0, h = 0) => {
    st.minY = Math.min(st.minY, y - oy);
    st.maxY = Math.max(st.maxY, y + h - oy);
    st.maxX = Math.max(st.maxX, x + w - ox);
  };
  const addPlat = (p, tag) => {
    st.platforms.push(p);
    if (tag) st.tags.add(tag);
    const top = p.kind === 'moving' ? p.oy - Math.abs(p.ay) : p.y;
    const bottom = p.kind === 'moving' ? p.oy + Math.abs(p.ay) : p.y;
    st.platMinY = Math.min(st.platMinY, top - oy);
    st.platMaxY = Math.max(st.platMaxY, bottom - oy);
    if (p.kind === 'moving') {
      track(p.ox - Math.abs(p.ax), top, p.w + 2 * Math.abs(p.ax), 16 + 2 * Math.abs(p.ay));
    } else track(p.x, p.y, p.w, Math.min(p.h, 16));
    return p;
  };
  const addStar = (x, y, opts, tag) => {
    const star = createStar(ctx, x, y, opts);
    st.stars.push(star);
    if (tag) st.tags.add(tag);
    track(x - 8, y - 8, 16, 16);
    return star;
  };

  const b = {
    s, diff, meter, ox, oy, st, pace,
    event: s.events.active ? s.events.active.type : null,
    unlocked: (m) => mechs.has(m),

    // Zufall, immer über den Spielzustand
    rand: (a, c) => range(s, a, c),
    int: (a, c) => int(s, a, c),
    chance: (p) => chance(s, p),
    pick: (arr) => pick(s, arr),

    // Plattformen
    ground: (x, y, w) => addPlat(createStaticPlatform(ctx, X(x), Y(y), w, { ground: true })),
    cloud: (x, y, w) => addPlat(createStaticPlatform(ctx, X(x), Y(y), w)),
    moving: (x, y, w, o = {}) => addPlat(createMovingPlatform(ctx, X(x), Y(y), w, { pace, ...o }), 'moving'),
    // Sprungwolke: dünne Plattform, die den Spieler hoch schleudert (Landeplatz, nie Einstieg oder Ausstieg)
    spring: (x, y, w) => addPlat(createSpringPlatform(ctx, X(x), Y(y), w), 'spring'),
    // Eiswolke: wie cloud, aber der Boden ist sehr rutschig. ground true für eine hohe Eisfläche
    ice: (x, y, w, o = {}) => addPlat(createStaticPlatform(ctx, X(x), Y(y), w, { slick: true, ...o }), 'ice'),
    // Blinkwolke: im Takt fest und weg. period in Sekunden (3,4 bis 4,4), phase 0..1 verschiebt den Takt
    blink: (x, y, w, o = {}) => addPlat(createBlinkPlatform(ctx, X(x), Y(y), w, o), 'blink'),
    breakable: (x, y, w, o = {}) => addPlat(createBreakablePlatform(ctx, X(x), Y(y), w, o), 'breakable'),

    // Sterne (lokale Koordinaten)
    star: (x, y, o = {}) => addStar(X(x), Y(y), o),
    starLine(x1, y1, x2, y2, n, o = {}) {
      n = Math.max(1, Math.round(n * boost));
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0.5 : i / (n - 1);
        addStar(X(x1 + (x2 - x1) * k), Y(y1 + (y2 - y1) * k), o);
      }
    },
    // Bogen über einer Lücke: von x1 bis x2, Basis y, Scheitelhöhe height (nach oben)
    starArc(x1, x2, y, height, n, o = {}) {
      n = Math.max(2, Math.round(n * boost));
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        addStar(X(x1 + (x2 - x1) * k), Y(y - Math.sin(k * Math.PI) * height), o);
      }
    },
    // n Sterne in einer Reihe über einer Plattform (absolute Plattform aus b.ground usw.)
    starsOver(plat, n, lift = 50, margin = 24) {
      n = Math.max(1, Math.round(n * boost));
      const w = Math.max(0, plat.w - margin * 2);
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0.5 : i / (n - 1);
        addStar(plat.x + margin + w * k, plat.y - lift, {});
      }
    },
    // Risikostern: fällt langsam, sobald der Spieler näher als triggerDist kommt
    riskStar: (x, y, o = {}) => addStar(X(x), Y(y), { value: 25, falling: true, bonus: 'risk', ...o }, 'fallingstar'),

    // Gegner (Plattformen hosten Gegner, immer 'static' oder 'breakable' Plattformen)
    walker(plat, t = 0.5, o = {}) {
      const e = createWalker(ctx, plat, t, { pace, ...o });
      st.enemies.push(e); st.tags.add('walker'); track(e.x, e.y, e.w, e.h);
      return e;
    },
    jumper(plat, t = 0.5, o = {}) {
      const e = createJumper(ctx, plat, t, { pace, ...o });
      st.enemies.push(e); st.tags.add('jumper'); track(e.x, e.y - 60, e.w, e.h + 60);
      return e;
    },
    charger(plat, t = 0.5, o = {}) {
      const e = createCharger(ctx, plat, t, { pace, ...o });
      st.enemies.push(e); st.tags.add('charger'); track(e.x, e.y, e.w, e.h);
      return e;
    },
    flyer(x, y, o = {}) {
      const e = createFlyer(ctx, X(x), Y(y), { pace, ...o });
      st.enemies.push(e); st.tags.add('flyer'); track(e.minX, e.y - e.amp, e.maxX - e.minX + e.w, e.h + 2 * e.amp);
      return e;
    },

    // Hagelwolke: schwebt, schießt nach Vorwarnung einen Fächer Hagel nach unten (hazards kind hail entstehen erst im Spiel)
    hailcloud(x, y, o = {}) {
      const e = createHailcloud(ctx, X(x), Y(y), { pace, ...o });
      st.enemies.push(e); st.tags.add('hailcloud'); track(e.minX, e.y - e.amp, e.maxX - e.minX + e.w, e.h + 2 * e.amp + 160);
      return e;
    },

    // Hindernisse und Zonen
    spike(plat, t = 0.5) {
      const h = createSpike(ctx, plat, t);
      st.hazards.push(h); st.tags.add('spike'); track(h.x, h.y, h.w, h.h);
      return h;
    },
    lightning(x, o = {}) {
      const h = createLightning(ctx, X(x), { pace, ...o });
      st.hazards.push(h); st.tags.add('lightning'); track(h.x - LIGHTNING.WIDTH / 2, 0, LIGHTNING.WIDTH, 0);
      return h;
    },
    // Komet schlägt bei (x, y) ein. y ist die Oberkante des Bodens an dieser Stelle (lokal), dort muss eine Plattform liegen
    comet(x, y, o = {}) {
      const c = createComet(ctx, X(x), Y(y), { pace, ...o });
      st.hazards.push(c); st.tags.add('comet'); track(c.x - COMET.W / 2, c.y - 160, COMET.W, 160);
      return c;
    },
    wind(x, y, w, h, o = {}) {
      const z = createWind(ctx, X(x), Y(y), w, h, o);
      st.zones.push(z); st.tags.add('wind'); track(z.x, z.y, z.w, z.h);
      return z;
    },
    rain(x, w = RAIN.W, o = {}) {
      const z = createRain(ctx, X(x), w, o);
      st.zones.push(z); st.tags.add('rain'); track(z.x, z.y, z.w, 0);
      return z;
    },

    powerup(type, x, y) {
      const p = createPowerup(ctx, type, X(x), Y(y));
      st.powerups.push(p); st.tags.add('powerup'); track(p.x - 12, p.y - 12, 24, 24);
      return p;
    },
    // Traumtor auf einer Plattform (muss eine breite, ebene static Plattform sein)
    gate(plat, t = 0.5) {
      const g = createGate(ctx, plat.x + plat.w * t, plat.y, gateIndex);
      st.gates.push(g); st.tags.add('gate'); track(g.x - g.w / 2, g.y - g.h, g.w, g.h);
      return g;
    },

    // Der vorgesehene Weg durch den Chunk. Erste Plattform = Einstieg, letzte = Ausstieg.
    route(...plats) { st.route = plats; },
  };
  return b;
}
