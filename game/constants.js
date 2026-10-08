// Alle Zahlen und Tabellen des Spiels an einem Ort.
// Koordinaten: logische Pixel, Ursprung oben links, y wächst nach unten.

export const W = 800;
export const H = 450;
export const STEP = 1 / 60;
export const METER = 50; // Pixel pro Meter Distanz
export const START_X = 120; // x des Spielers beim Start, Distanz 0

export const PHYS = {
  GRAVITY: 1900,
  MOVE_SPEED: 300,
  JUMP_SPEED: 680,
  DOUBLE_JUMP_SPEED: 578,
  MAX_FALL: 900,
  CUT_GRAVITY_MULT: 1.5, // zusätzliche Schwerkraft, wenn die Sprungtaste früh losgelassen wird
  CUT_THRESHOLD: 200, // nur wirksam, solange vy kleiner als minus dieser Wert ist
  COYOTE: 0.1,
  JUMP_BUFFER: 0.12,
  GROUND_ACCEL: 3200,
  GROUND_DECEL: 3600,
  AIR_ACCEL: 2400,
  AIR_DECEL: 1400,
  RAIN_ACCEL_MULT: 0.4, // Regen: Boden wird rutschig
  RAIN_DECEL_MULT: 0.15,
  W: 44,
  H: 34,
  INVULN_HURT: 1.6,
  INVULN_RESPAWN: 2.2,
  INVULN_SHIELD: 1.0,
  KNOCKBACK_VX: 260,
  KNOCKBACK_VY: 380,
  STUN: 0.22, // so lange ist die Steuerung nach einem Treffer eingeschränkt
  STOMP_BOUNCE: 476,
  STOMP_BOUNCE_HELD: 640,
  DASH_SPEED: 760,
  DASH_TIME: 0.2,
  DASH_COOLDOWN: 0.55,
  LEFT_MARGIN: 8, // Mindestabstand des Spielers zum linken Bildrand
};

export const MAX_LIVES = 3;

export const LIMITS = {
  MAX_PARTICLES: 260,
  MAX_POPUPS: 10,
  MAX_ENEMIES_ACTIVE: 8, // lebende Gegner im Bereich camX minus 120 bis camX plus W plus 400
  MAX_PLATFORMS: 56,
  MAX_HAZARDS: 14,
  MAX_STARS: 140,
  GEN_AHEAD: W * 2, // so weit vor der Kamera wird Welt erzeugt
  CLEAN_BEHIND: 320, // alles weiter links von camX minus diesem Wert wird gelöscht
  SAFE_START: 220, // so viele Pixel am Chunk-Anfang bleiben frei von Gegnern und Hindernissen
};

// Fenstergrößen, in denen Windzonen und Wetter wirken dürfen
export const WIND = {
  MAX_VX: 120, // maximale Drift in px pro Sekunde, viel kleiner als MOVE_SPEED
  MAX_LIFT: 800, // maximale Aufwärtsbeschleunigung, Schwerkraft bleibt dadurch positiv (1900 minus 800)
  SMOOTH: 4, // Glättung der Drift pro Sekunde
};

export const ENEMY = {
  WALKER: { w: 40, h: 30, speed: 55, turnTime: 0.3 },
  JUMPER: { w: 38, h: 32, crouchTime: 0.5, hopVy: 430, hopVx: 60, minWait: 1.6, maxWait: 2.8, speed: 30 },
  FLYER: { w: 42, h: 30, speed: 45, amp: 22, omega: 2.2 },
  CHARGER: { w: 46, h: 34, speed: 28, detectX: 260, detectY: 70, windup: 0.75, dashSpeed: 430, dashTime: 0.5, cooldown: 1.3 },
};

export const LIGHTNING = { GLOW: 0.55, FLICKER: 0.45, STRIKE: 0.22, COOLDOWN: 1.1, WIDTH: 56, CLOUD_Y: 52 };
export const RAIN = { ON: 4, OFF: 3, W: 300, FADE: 0.6 };
export const SPIKE = { w: 36, h: 28 };

export const COMBO = { WINDOW: 3.5, MAX_MULT: 4, BASE: 25 };
export const SCORE = { STAR: 10, RISK_STAR: 25, EVENT_STAR: 5, GATE: 100 };

export const POWERUPS = {
  shield: { color: '#8fe9ff', label: 'Schild' },
  dash: { color: '#ff9ad5', label: 'Regenbogen Dash', duration: 8 },
  magnet: { color: '#ffd966', label: 'Sternmagnet', duration: 8, radius: 170 },
  feather: { color: '#c9b6ff', label: 'Traumfeder', maxCharges: 2 },
};

export const GATE = { FIRST: 500, INTERVAL: 650, HEAL: 1 };
export const gateMeter = (n) => GATE.FIRST + (n - 1) * GATE.INTERVAL; // n zählt ab 1

// Abschnitte der Schwierigkeitskurve, Angaben in Metern.
// diff [von, bis] wird innerhalb des Abschnitts linear interpoliert.
export const SECTIONS = [
  { from: 0, to: 250, name: 'Einschlafen', diff: [1, 1], mech: ['static', 'star'] },
  { from: 250, to: 500, name: 'Erste Gegner', diff: [1, 2], mech: ['walker', 'spike', 'powerup'] },
  { from: 500, to: 800, name: 'Wolkenwege', diff: [2, 2.5], mech: ['moving', 'rain'] },
  { from: 800, to: 1200, name: 'Bröckelndes Land', diff: [2.5, 3], mech: ['breakable', 'jumper', 'lightning', 'fallingstar'] },
  { from: 1200, to: 1700, name: 'Windtal', diff: [3, 3.5], mech: ['wind', 'flyer', 'charger'] },
  { from: 1700, to: Infinity, name: 'Traumsturm', diff: [3.5, 5], mech: ['combo'], rampTo: 3700 },
];

export function sectionAt(meter) {
  for (const s of SECTIONS) if (meter >= s.from && meter < s.to) return s;
  return SECTIONS[SECTIONS.length - 1];
}

export function difficultyAt(meter) {
  const s = sectionAt(meter);
  const end = Number.isFinite(s.to) ? s.to : s.rampTo || s.from + 2000;
  const k = Math.min(1, Math.max(0, (meter - s.from) / (end - s.from)));
  return s.diff[0] + (s.diff[1] - s.diff[0]) * k;
}

export function mechsAt(meter) {
  const set = new Set();
  for (const s of SECTIONS) if (meter >= s.from) s.mech.forEach((m) => set.add(m));
  if (meter >= 0) set.add('static');
  return set;
}

// Kurze Ruhepausen: alle REST.EVERY Meter ein einfacher Abschnitt
export const REST = { EVERY: 400, JITTER: 80, FIRST: 380 };

export const HINTS = {
  walker: 'Spring von oben auf Gewitterwolken',
  spike: 'Stachelwolken musst du überspringen',
  moving: 'Bewegliche Plattformen tragen dich mit',
  rain: 'Im Regen rutschst du etwas',
  breakable: 'Brüchige Plattformen nicht zu lange betreten',
  jumper: 'Hüpfer ziehen sich vor dem Sprung zusammen',
  lightning: 'Blitze kündigen sich an. Geh aus der Zone',
  fallingstar: 'Fallende Sterne bringen Extrapunkte',
  wind: 'Wind schiebt dich sanft',
  flyer: 'Fliegende Wolken schweben über Abgründen',
  charger: 'Sturmwolken laden auf und stürmen los',
};

export const WORLDS = [
  {
    name: 'Mitternacht',
    sky: ['#0f0a2e', '#3a2a7a', '#7a4fa8'],
    ground: '#5b3f9e',
    groundTop: '#b9a4ff',
    float: '#8a6fd6',
    cloud: 'rgba(255,255,255,.08)',
    star: '#ffffff',
    moon: '#f5ecc8',
    accent: '#ffd966',
    mist: 'rgba(160,120,255,.10)',
  },
  {
    name: 'Lila Traumhimmel',
    sky: ['#2a0a4a', '#7a2f9e', '#e07ab8'],
    ground: '#7a3fa0',
    groundTop: '#ffb3e6',
    float: '#c86fd6',
    cloud: 'rgba(255,220,255,.12)',
    star: '#ffe6ff',
    moon: '#ffe3f2',
    accent: '#ffe08a',
    mist: 'rgba(255,150,220,.12)',
  },
  {
    name: 'Sternennebel',
    sky: ['#06122e', '#1f4a8a', '#4fb8c8'],
    ground: '#245a8a',
    groundTop: '#9ff0ff',
    float: '#4f9bd6',
    cloud: 'rgba(200,255,255,.10)',
    star: '#dff8ff',
    moon: '#e6fbff',
    accent: '#fff0a0',
    mist: 'rgba(90,220,255,.14)',
  },
  {
    name: 'Gewittertraum',
    sky: ['#0a0f1e', '#2a3550', '#5a6a8a'],
    ground: '#3a4668',
    groundTop: '#9fb4e0',
    float: '#5f78b0',
    cloud: 'rgba(180,200,255,.09)',
    star: '#cfe0ff',
    moon: '#cdd8f0',
    accent: '#ffe27a',
    mist: 'rgba(130,160,255,.10)',
  },
];

export const EVENTS = {
  meteor: { name: 'Sternschnuppen', dur: 9 },
  supermoon: { name: 'Supermond', dur: 14 },
  storm: { name: 'Traumsturm', dur: 13 },
  shower: { name: 'Sternschauer', dur: 10 },
  FIRST_METER: 400,
  EVERY: [350, 650], // Meter bis zum nächsten möglichen Ereignis
  CHANCE: 0.7,
};

export const STORAGE = { KEY: 'nimbus-highscore' };

export const Y_MIN = 215; // höchste erlaubte Plattform Oberkante
export const Y_MAX = 400; // tiefste erlaubte Plattform Oberkante
export const KILL_Y = H + 120; // darunter ist der Spieler gefallen
