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

// Fähigkeiten von Nimbus. Der Wolkenstoß (Dash) ist immer da, das Regenbogen Powerup macht ihn stärker.
export const ABILITY = {
  DASH_BASIC: { TIME: 0.16, COOLDOWN: 1.6 }, // einmal pro Luftphase, Abklingzeit am Boden und in der Luft
  DASH_RAINBOW: { TIME: 0.22, COOLDOWN: 0.45 }, // mit dem Powerup: viel öfter, ohne Luftlimit
  GLIDE: { FALL: 150, MAX: 1.2, MIN_VY: 60 }, // Sprungtaste halten beim Fallen: höchstens 150 px/s, bis zu 1,2 s je Luftphase
  SLAM: { SPEED: 1250, RADIUS: 112, BOUNCE: 320, MIN_HEIGHT: 36 }, // Sturzflug nach unten mit Schockwelle bei der Landung
  SHOT: { SPEED: 640, LIFE: 0.62, COOLDOWN: 0.35, W: 22, H: 22 }, // Sternenwurf
  AMMO: { MAX: 3, STARS_PER: 10 }, // zehn Sterne laden einen Wurfstern, bis zu drei
};

export const MAX_LIVES = 3;

export const LIMITS = {
  MAX_PARTICLES: 260,
  MAX_POPUPS: 10,
  MAX_ENEMIES_ACTIVE: 9, // lebende Gegner im Bereich camX minus 120 bis camX plus W plus 400
  MAX_PLATFORMS: 64,
  MAX_HAZARDS: 18,
  MAX_STARS: 140,
  GEN_AHEAD: W * 2, // so weit vor der Kamera wird Welt erzeugt
  CLEAN_BEHIND: 320, // alles weiter links von camX minus diesem Wert wird gelöscht
  SAFE_START: 220, // so viele Pixel am Chunk-Anfang bleiben frei von Gegnern und Hindernissen
  MAX_SFX: 16, // Tonereignisse, die pro Bild aufgesammelt werden
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
  // Hagelwolke: schwebt, kündigt 0,8 s vorher an und verschießt dann einen Fächer aus Hagelkörnern nach unten
  HAILCLOUD: { w: 46, h: 32, speed: 36, amp: 16, omega: 1.8, windup: 0.8, cooldown: 2.6, balls: 3, spread: 0.34, ballSpeed: 300 },
};
export const HAIL = { R: 9, LIFE: 3.2 };

export const LIGHTNING = { GLOW: 0.55, FLICKER: 0.45, STRIKE: 0.22, COOLDOWN: 1.1, WIDTH: 56, CLOUD_Y: 52 };
export const RAIN = { ON: 4, OFF: 3, W: 300, FADE: 0.6 };
export const SPIKE = { w: 36, h: 28 };

// Tempo Faktor für Gegner, bewegliche Plattformen und Blitzabstände. Vorwarnzeiten bleiben davon unberührt.
export const paceAt = (diff) => Math.min(1.6, 1 + 0.06 * Math.max(0, diff - 1));

export const SPRING = { SPEED: 940 }; // Sprungwolke: Startgeschwindigkeit nach oben, etwa 232 px Höhe
export const ICE = { ACCEL_MULT: 0.3, DECEL_MULT: 0.08 }; // Eiswolke: Boden wird sehr rutschig
export const BLINK = { PERIOD: [3.4, 4.4], ON: 0.62, WARN: 0.7 }; // Blinkwolke: Takt in Sekunden, Anteil sichtbar, Vorwarnung
export const COMET = { WARN: 1.1, STRIKE: 0.35, COOLDOWN: 1.4, RADIUS: 40, W: 80 }; // Komet: Vorwarnung mindestens 1,1 s

export const COMBO = { WINDOW: 3.5, MAX_MULT: 4, BASE: 25 };
export const SCORE = { STAR: 10, RISK_STAR: 25, EVENT_STAR: 5, GATE: 100 };

export const POWERUPS = {
  shield: { color: '#8fe9ff', label: 'Schild' },
  dash: { color: '#ff9ad5', label: 'Regenbogen Dash', duration: 8 },
  magnet: { color: '#ffd966', label: 'Sternmagnet', duration: 8, radius: 170 },
  feather: { color: '#c9b6ff', label: 'Traumfeder', maxCharges: 2 },
  double: { color: '#ffb86b', label: 'Doppelpunkte', duration: 10 },
};

export const GATE = { FIRST: 500, INTERVAL: 650, HEAL: 1 };
export const gateMeter = (n) => GATE.FIRST + (n - 1) * GATE.INTERVAL; // n zählt ab 1

// Abschnitte der Schwierigkeitskurve, Angaben in Metern.
// diff [von, bis] wird innerhalb des Abschnitts linear interpoliert.
export const SECTIONS = [
  { from: 0, to: 250, name: 'Einschlafen', diff: [1, 1], mech: ['static', 'star'] },
  { from: 250, to: 500, name: 'Erste Gegner', diff: [1, 2.6], mech: ['walker', 'spike', 'powerup'] },
  { from: 500, to: 800, name: 'Wolkenwege', diff: [2.6, 3.8], mech: ['moving', 'rain', 'spring'] },
  { from: 800, to: 1200, name: 'Bröckelndes Land', diff: [3.8, 5], mech: ['breakable', 'jumper', 'lightning', 'fallingstar', 'ice'] },
  { from: 1200, to: 1700, name: 'Windtal', diff: [5, 6.2], mech: ['wind', 'flyer', 'charger', 'blink', 'hailcloud'] },
  { from: 1700, to: Infinity, name: 'Traumsturm', diff: [6.2, 9], mech: ['combo', 'comet'], rampTo: 3200 },
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
  spring: 'Sprungwolken schleudern dich hoch',
  ice: 'Auf Eiswolken rutschst du weit',
  blink: 'Blinkwolken verschwinden im Takt',
  comet: 'Kometen kündigen ihren Einschlag an',
  hailcloud: 'Hagelwolken zielen nie auf dich, aber sie fächern nach unten',
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

// Kurze Tipps zu den Fähigkeiten, einmal pro Lauf an diesen Metern als Banner (generator.js, updateHints).
// Texte ohne Tastennamen, damit sie auch auf dem Handy passen.
export const TIPS = [
  { at: 70, id: 'glide', text: 'Sprungtaste in der Luft halten: Gleiten' },
  { at: 150, id: 'dash', text: 'Wolkenstoß: Dash Taste' },
  { at: 210, id: 'slam', text: 'In der Luft nach unten: Stampfen' },
  { at: 330, id: 'throw', text: 'Zehn Sterne laden einen Wurfstern' },
];
