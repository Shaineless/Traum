# Architektur von Nimbus

Dieses Dokument ist der Vertrag zwischen den Modulen. Wer ein Modul ändert, hält die hier beschriebenen Signaturen und Datenformen ein.

## Grundregeln

1. Spiellogik ist rein und deterministisch. Kein `Math.random`, kein `Date.now`, kein DOM in `game/*.js` außer `game/input.js` und `game/render/*`. Zufall kommt nur aus `game/rng.js` über `s.rng`.
2. Der Spielzustand `s` besteht nur aus Daten (Zahlen, Strings, Booleans, Arrays, einfache Objekte). Keine Klassen, keine Funktionen, keine Maps oder Sets im Zustand. Dadurch funktioniert `structuredClone(s)`. Tests und der Test Bot verlassen sich darauf.
3. Schemas aller Objekte stehen in `game/entities.js`. Neue Felder dürfen ergänzt werden, vorhandene Felder werden nicht umbenannt.
4. Alle Zahlen und Tabellen stehen in `game/constants.js`. Keine Magic Numbers in den Modulen, wenn es eine Konstante gibt.
5. Koordinaten sind logische Pixel (800 mal 450), y wächst nach unten. Plattform `y` ist die Oberkante. Spieler und Gegner haben `x, y` als linke obere Ecke und `w, h`.
6. Texte im Spiel enthalten keine Gedankenstriche (weder Halbgeviertstrich noch Geviertstrich) und keine Aufzählungsstriche. Kurze, klare deutsche Sätze.
7. Performance: Pro Schritt keine Allokation großer Arrays, Objekte außerhalb des Bildes nur das Nötigste aktualisieren, Limits aus `LIMITS` einhalten.
8. Jedes Modul bringt eigene Tests in `tests/<modul>.test.mjs` mit (Node Test Runner, `node --test`). Die Tests laufen ohne Browser.

## Ablauf eines Simulationsschritts (`game/sim.js`)

```
decayFx → (Hitstop? dann nur Partikel) →
updatePlatforms → updateObstacles → updateEnemies → updatePlayer →
playerVsEnemies → playerVsHazards → updateCollectibles → updateGates → updateEvents →
Kamera → run.maxX / meters → updateHints → ensureAhead (Generator) → updateCombo → updatePopups → updateParticles
```

`s.mode`: `'playing'`, `'dying'` (Zeitlupe, 1,5 Sekunden) oder `'over'`. `nimbus-game.js` zeigt den Game Over Bildschirm, wenn `s.mode === 'over'`.

## Dateien und Zuständigkeiten

| Datei | Inhalt |
| --- | --- |
| `nimbus-game.js` | Öffentliche API `createNimbusGame`, Canvas, Schleife, Bildschirmzustände |
| `game/constants.js` | Konstanten, Schwierigkeitskurve, Welten, Texte |
| `game/rng.js` | Seed Zufall |
| `game/state.js`, `state-id.js` | Zustand anlegen, IDs |
| `game/entities.js` | Datenschema aller Objekte |
| `game/reach.js` | Sprungmathematik (Reichweite, Höhe) |
| `game/validate.js` | Fairness Regeln für Chunks |
| `game/builder.js` | Werkzeugkasten für Chunk Layouts |
| `game/scoring.js` | Punkte, Combo, Popups, Banner, Shake, Hitstop |
| `game/theme.js` | Farben der Traumwelt, überblendet |
| `game/sim.js` | Ein Simulationsschritt |
| `game/player.js` | Spielerphysik, Schaden, Respawn |
| `game/platforms.js` | bewegliche und brüchige Plattformen |
| `game/enemies.js` | vier Gegnertypen, Besiegen |
| `game/obstacles.js` | Stachelwolken, Blitze, Wind, Regen |
| `game/collectibles.js` | Sterne, fallende Sterne, Powerups, Magnet |
| `game/gates.js` | Traumtore, Weltwechsel |
| `game/events.js` | Dream Events |
| `game/generator.js` | Chunk Sequenzer, Schwierigkeit, Aufräumen |
| `game/chunks/*.js` | Chunk Layouts |
| `game/particles.js` | Partikel erzeugen und aktualisieren |
| `game/input.js` | Tastatur und Touch |
| `game/stats.js` | Statistiken im localStorage |
| `game/render/*.js` | alle Zeichenfunktionen |

## Zustand `s` (siehe `game/state.js`)

```
s.mode, s.t (Sim Zeit), s.realT, s.deathT, s.deathCause {kind,label}, s.lives, s.camX
s.player        { x,y,w,h,vx,vy,face,onGround,groundId,coyote,buffer,jumps,jumpHeld,invuln,stun,
                  squashX,squashY, dash{t,cd,dir}, power{shield,dashT,magnetT,feather}, windVx,wet,trail,dead,blink }
s.platforms     kind 'static' | 'moving' | 'breakable'
s.enemies       kind 'walker' | 'jumper' | 'flyer' | 'charger'
s.hazards       kind 'spike' | 'lightning'
s.zones         kind 'wind' | 'rain'
s.stars, s.powerups, s.gates, s.particles, s.popups
s.banner        { text, sub, t, dur } oder null
s.hints         { shown: {mech: true}, queue: [{x, text, mech}] }
s.gen           Zustand des Generators
s.world         { index, from, to, blend, gatesPassed }   blend 0..1 überblendet from nach to
s.events        { active: {type,t,dur,data}|null, nextMeter, count, starBoost, enemyBoost }
s.combo         { count, timer }
s.run           { score (ungenutzt), bonus, stars, kills, bestCombo, maxX, meters, hits }
s.fx            { shake, hitstop, flash, flashColor, slow }
s.respawn, s.debug
```

Punktzahl: `totalScore(s) = meters(s) + s.run.bonus` (siehe `scoring.js`). Eine Distanz von 50 Pixeln ist ein Meter.

## Eingabe pro Schritt

```
{ move: -1|0|1, jumpPressed: bool (Flanke), jumpHeld: bool, dashPressed: bool (Flanke) }
```

## Modulverträge

### scoring.js (fertig)
`meters`, `totalScore`, `popup(s,x,y,text,opts)`, `banner(s,text,sub,dur)`, `shake`, `hitstop`, `flash`, `addBonus`, `registerKill(s, enemy, how)`, `collectStar(s, star)`, `resetCombo`, `updateCombo`, `updatePopups`.

### particles.js
```
emit(s, preset, x, y, opts?)   updateParticles(s, dt)
```
Presets: `land, jump, doublejump, star, stomp, break, hurt, spark, shield, shieldbreak, gate, magnet, confetti, poof, dash, rain, windline, meteor`. Partikel sind `{x,y,vx,vy,life,max,size,color,shape,g,drag,rot,vr,alpha}` mit `shape` in `dot|star|cloud|line|drop|ring`. Hartes Limit `LIMITS.MAX_PARTICLES`: bei Überschreitung werden die ältesten verworfen oder die Anzahl neuer Partikel reduziert. Optik: weich, verträumt, wenige große weiche Teile statt vieler harter. Farben kommen aus dem Preset, optional `opts.color`.

### player.js
```
updatePlayer(s, input, dt)
hurtPlayer(s, src) → 'ignored' | 'absorbed' | 'hurt' | 'dead'     src = { kind, label, x, y }
respawnPlayer(s)
bouncePlayer(s, speed)
```
Verhalten:
- Werte aus `PHYS`. Beschleunigung statt Sofortgeschwindigkeit: Boden `GROUND_ACCEL` und `GROUND_DECEL`, Luft `AIR_ACCEL`. Bei Regen (`rainAt` aus `obstacles.js`, Wert 0 bis 1) werden Boden Beschleunigung und Bremsen um `RAIN_ACCEL_MULT` und `RAIN_DECEL_MULT` abgeschwächt, linear nach Regenstärke (`p.wet` glättet).
- Springen: Coyote Time, Jump Buffer, Doppelsprung (`jumps` bis 2), Traumfeder: ist `power.feather > 0` und der normale Doppelsprung schon verbraucht, kostet ein weiterer Luftsprung eine Feder. Variable Sprunghöhe wie bisher (`CUT_GRAVITY_MULT`).
- Wind: `windAt(s, cx, cy)` aus `obstacles.js` liefert `{vx, ay}`. `p.windVx` nähert sich `vx` mit `WIND.SMOOTH`, wird zur Bewegung addiert. `ay` wird zur Schwerkraft addiert (negativ hebt). Der Spieler darf nie unbeweglich werden: Eingabe gewinnt.
- Plattformen sind einseitig (Landung nur von oben). Landung nur auf `isSolid(plat)` (aus `platforms.js`). Bei Landung: `onPlayerLand(s, plat)`, Partikel `land`, Squash. Steht der Spieler auf einer beweglichen Plattform, übernimmt er `plat.dx, plat.dy` jedes Schritts (vor der Kollision), damit er auch bei absinkenden Plattformen nicht abhebt.
- Linke Grenze `camX + LEFT_MARGIN`.
- Dash (Regenbogen Dash): Taste nur wirksam, wenn `power.dashT > 0` und `dash.cd <= 0`. Dauer `DASH_TIME`, Tempo `DASH_SPEED` in Blickrichtung (oder Eingaberichtung), Schwerkraft aus, unverwundbar (`hurtPlayer` gibt `'ignored'`), danach `DASH_COOLDOWN`. Spur über `p.trail` und Partikel `dash`.
- Squash und Stretch über `squashX/squashY` (Sprung streckt, Landung staucht, Rückkehr zu 1 exponentiell).
- Fallen (`y > KILL_Y`): `hurtPlayer(s, {kind:'fall', label:'In den Abgrund gefallen'})`.
- `hurtPlayer`: `'ignored'` bei `dead`, `invuln > 0` oder aktivem Dash. Schild absorbiert einen Treffer (`'absorbed'`, kurze Unverwundbarkeit `INVULN_SHIELD`, Partikel `shieldbreak`). Sonst Leben minus 1, Combo zurücksetzen, `s.run.hits++`, `s.deathCause = {kind,label}`, Unverwundbarkeit `INVULN_HURT`, Knockback weg von `src.x` (`KNOCKBACK_VX`, `KNOCKBACK_VY`), Stun, `flash`, `shake`, `hitstop 0.06`, Partikel `hurt`, Popup "Aua!". Bei `kind:'fall'` kein Knockback, stattdessen `respawnPlayer`. Ist danach `lives <= 0`: `s.mode = 'dying'`, `player.dead = true`, Spieler taumelt nach oben und fällt (keine Steuerung, keine Plattformkollision), Rückgabe `'dead'`.
- `respawnPlayer`: wählt die erste sichere Plattform vor dem Spieler: `kind === 'static'`, Breite mindestens 200, rechte Kante größer als `camX + 200`. Setzt den Spieler mittig darauf, Geschwindigkeit 0, `invuln = INVULN_RESPAWN`. Entfernt Gegner und Hindernisse im Bereich von 260 px links bis 420 px rechts des Spielers über `clearEnemiesNear` und `clearHazardsNear`. Garantie: Mindestens 2 Sekunden kein unvermeidbarer Schaden.
- `bouncePlayer(s, speed)`: `vy = -speed`, Boden verlassen, `jumps = min(jumps, 1)`, Stretch.

### platforms.js
```
updatePlatforms(s, dt)   onPlayerLand(s, plat)   isSolid(plat)   platformById(s, id)
```
- Bewegliche Plattformen: Position aus `platformAt(plat, s.t)` (siehe `reach.js`), `vx, vy` analytisch, `dx, dy` als Differenz zum letzten Schritt.
- Brüchige Plattformen: `onPlayerLand` setzt `state = 'armed'` (nur wenn `'idle'`). Dann: 0 bis 0,4 s normal, 0,4 bis 0,8 s `'shaking'` (`shakeX` schwingt mit steigender Stärke, `alpha` sinkt auf 0,55, gelegentlich Partikel `poof`), danach `'broken'` (`alpha 0`, Partikel `break`, nicht mehr solide). Hat `respawn > 0`, kehrt sie nach dieser Zeit sichtbar zurück (`alpha` blendet ein, `state` wieder `'idle'`).

### enemies.js
```
updateEnemies(s, dt)   playerVsEnemies(s)   clearEnemiesNear(s, x0, x1)
```
Gegner außerhalb von `camX - 200` bis `camX + W + 500` werden nicht aktualisiert. Tote Gegner (`dead > 0`) schrumpfen 0,4 s lang und werden dann entfernt. Alle Telegraphs setzen `e.telegraph` (0..1) für die Darstellung.
- **Walker**: läuft zwischen `minX` und `maxX` mit `ENEMY.WALKER.speed`. An der Kante stoppt er `turnTime` Sekunden (`state 'turn'`, `telegraph` steigt), dann Richtungswechsel.
- **Jumper**: wartet `cooldown` Sekunden (patrouilliert langsam), kauert sich `crouchTime` Sekunden zusammen (`state 'crouch'`, `telegraph` 0 bis 1), springt dann mit `hopVy` und `hopVx` in seine Blickrichtung, bleibt innerhalb `minX..maxX`, landet auf der Host Plattform. Zielt nie auf den Spieler. Neue Wartezeit zufällig zwischen `minWait` und `maxWait` über `rng`.
- **Flyer**: schwebt sinusförmig, `y = baseY + amp * sin(omega * s.t + phase)`, bewegt sich zwischen `minX` und `maxX`.
- **Charger**: patrouilliert langsam. Erkennt er den Spieler (Abstand in x höchstens `detectX`, Höhenunterschied der Füße höchstens `detectY`, Spieler lebt), startet `windup` (`windup` Sekunden, `telegraph` 0 bis 1, Zittern, Richtung fest zum Spieler). Danach `dash` mit `dashSpeed` für höchstens `dashTime`, stoppt an der Plattformkante (fällt nie herunter). Dann `cooldown`.
- `playerVsEnemies`: Hitbox des Gegners ist 3 px kleiner als die Zeichnung, die des Spielers 4 px. Bei Überlappung: Dash aktiv, dann `registerKill(s, e, 'dash')`. Sonst Stomp, wenn `p.vy > 0` und die Füße des Spielers im Vorschritt höchstens 10 px unter der Oberkante des Gegners waren: `registerKill(s, e, 'stomp')`, `bouncePlayer(s, jumpHeld ? STOMP_BOUNCE_HELD : STOMP_BOUNCE)`. Sonst `hurtPlayer(s, {kind:'enemy', label, x, y})` mit den Labels Gewitterwolke, Hüpfer, Fliegende Wolke, Sturmwolke. Besiegte Gegner: `dead = 0.001`, `state = 'dead'`, kein Schaden mehr.
- `clearEnemiesNear` entfernt Gegner im x Bereich mit Partikel `poof`.

### obstacles.js
```
updateObstacles(s, dt)   playerVsHazards(s)   clearHazardsNear(s, x0, x1)
windAt(s, x, y) → { vx, ay }     rainAt(s, x, y) → 0..1
```
- **Stachelwolke** (`spike`): folgt ihrer Host Plattform (`hostId`, `hostDx`). Hitbox um 6 px seitlich und 8 px oben verkleinert. `hurtPlayer(s, {kind:'spike', label:'Stachelwolke', x, y})`.
- **Blitz** (`lightning`): Phasen `idle` (`timer` Sekunden), `glow` (`LIGHTNING.GLOW`), `flicker` (`LIGHTNING.FLICKER`), `strike` (`LIGHTNING.STRIKE`), `cooldown` (`LIGHTNING.COOLDOWN`), dann wieder `idle` mit `idleTime`. `charge` steigt von 0 auf 1 über glow und flicker (für die Darstellung). Schaden nur in der Phase `strike`, in der Säule `x ± w/2` von `cloudY` bis zum unteren Bildrand. Zwischen Beginn von `glow` und Einschlag liegen immer mindestens 0,9 Sekunden. Außerhalb des Bildbereichs (`camX - 100` bis `camX + W + 200`) bleibt der Blitz in `idle` mit vollem `timer`, damit er beim Eintreten ins Bild nie sofort zuschlägt. Beim Einschlag nahe der Kamera: `shake`, Partikel `spark`.
- **Regen** (`rain`): Zyklus `onTime` an, `offTime` aus, `intensity` blendet in `RAIN.FADE` Sekunden. Gleiche Bildbereichsregel. Während es regnet gelegentlich Partikel `rain`.
- **Wind** (`wind`): `windAt` summiert alle Zonen, die den Punkt enthalten, plus `eventWindVx(s)` aus `events.js`, und begrenzt auf `WIND.MAX_VX` und `WIND.MAX_LIFT`. `rainAt` liefert die größte `intensity` aller Regenzonen, die den Punkt enthalten (Zone reicht von `y` bis zum unteren Bildrand).
- `clearHazardsNear`: entfernt Stachelwolken im Bereich, setzt Blitze im Bereich auf `idle` mit `timer = idleTime + 2`, `charge = 0`.

### collectibles.js
```
updateCollectibles(s, dt)   givePowerup(s, type)
```
- Normale Sterne: Einsammeln, wenn Abstand zum Spielerzentrum in x unter 26 und in y unter 30 liegt, über `collectStar`. Eingesammelte Sterne werden entfernt.
- Fallende Sterne (`falling`): starten (`started = true`, `vy = fallSpeed`), sobald der Abstand zum Spieler in x kleiner als `triggerDist` ist. Fallen linear, verschwinden unter `H + 40`.
- Sternmagnet (`power.magnetT > 0`): Sterne im Radius `POWERUPS.magnet.radius` um den Spieler fliegen mit 420 px pro Sekunde zum Spieler. Partikel `magnet` sparsam.
- Powerups: Einsammeln bei Abstand unter 30. `givePowerup`: `shield` setzt `power.shield = true`, `dash` setzt `power.dashT = duration`, `magnet` setzt `power.magnetT = duration`, `feather` erhöht `power.feather` bis `maxCharges`. Popup mit dem Label, passende Partikel. `collectibles.js` zählt `dashT` und `magnetT` herunter (nur hier).

### gates.js
```
updateGates(s, dt)
```
Passiert der Spieler die x Position eines Tors (Mitte des Spielers kreuzt `gate.x`, Höhe egal): `passed = true`, Bonus `SCORE.GATE * gate.index`, ein Leben dazu (bis `MAX_LIVES`, Popup), Weltwechsel (`world.from = world.to`, `world.index` und `world.to` auf `(index + 1) % 4`, `world.blend = 0`, `world.gatesPassed++`), `banner("Traumwelt N", WORLDS[...].name)`, Partikel `gate` und `confetti`, kurzer weißer `flash`, leichter `shake`, `s.respawn` aktualisieren. `world.blend` wächst pro Schritt um `dt / 3` bis 1. `gate.anim` läuft für die Darstellung.

### events.js
```
updateEvents(s, dt)   startEvent(s, type)   eventWindVx(s) → px/s   eventEnvelope(s) → {type, env 0..1, t, dur} | null
```
Typen `meteor`, `supermoon`, `storm`, `shower` (`EVENTS`). Planung: ab `EVENTS.FIRST_METER`, wenn kein Ereignis aktiv ist, `meters >= s.events.nextMeter`, in den nächsten 120 Metern kein Traumtor liegt und `chance(EVENTS.CHANCE)` gelingt: zufälliger Typ (Gewichte meteor 3, supermoon 2, shower 2, storm 2, storm erst ab 800 Metern). Danach `nextMeter = meters + range(EVERY)`.
- `meteor` (Sternschnuppen): Partikel `meteor` am Himmel, zusätzlich fallen alle 0,6 Sekunden Sterne (`bonus 'event'`, `value 5`, `falling`, schon `started`) vor dem Spieler vom Himmel.
- `supermoon`: `s.events.starBoost = true` (der Generator baut mehr Sterne). Der Mond wird beim Rendern größer (Hüllkurve `eventEnvelope`).
- `storm` (Traumsturm): `s.events.enemyBoost = true`, `eventWindVx` liefert eine sanfte Böe (Betrag höchstens 70, wechselndes Vorzeichen, Ein und Ausblendung in 1,5 Sekunden).
- `shower` (Sternschauer): alle 0,35 Sekunden ein Stern (`bonus 'event'`, `value 5`) über der nächsten Plattform vor dem Bild.
Beim Start `banner(name, kurzer Satz)`. Nach Ablauf `active = null`, Flags zurücksetzen.

### generator.js und Chunks
```
initGenerator(s)   ensureAhead(s)   updateHints(s)   chunkAt(s, x)   cleanup(s)
```
- `initGenerator` legt die Startplattform an (ab x = -200, y = 360, Breite 900) und erzeugt Welt bis `LIMITS.GEN_AHEAD`.
- Ein Chunk ist `{ id, name, diff, weight, min, max, mech: [...], rest, build(b) }`. `min` und `max` in Metern. `build(b)` benutzt `game/builder.js`. Koordinaten lokal, `b.route(...)` ist Pflicht (erste Plattform Einstieg, letzte Ausstieg, beide `static`, mindestens 160 bzw. 140 breit).
- Auswahl: erlaubt sind Chunks mit `min <= Meter < max`, deren `mech` Tags freigeschaltet sind (`mechsAt`), deren `diff` höchstens `difficultyAt(meter) + 0.6` ist. Gewicht sinkt mit Abstand zur Zieldifficulty. Ein Chunk darf nicht in den letzten drei Chunks vorkommen. Während `s.events.enemyBoost` zählen Chunks mit Gegnern doppelt.
- Ruhepausen: alle `REST.EVERY` Meter (mit Jitter) kommt ein Chunk mit `rest: true` (einfach, viele Sterne). Direkt vor und nach einem Traumtor ebenfalls.
- Traumtore: bei `gateMeter(n)` baut der Generator den Spezial Chunk `gate` (breite ebene Plattform, `b.gate`). `b.gateIndex` ist die laufende Nummer ab 1.
- Verbindung zwischen Chunks: Lücke `gap` zwischen Ausstieg des vorigen und Einstieg des neuen Chunks, so gewählt, dass der Sprung mit **einem** Sprung (ohne Doppelsprung) und Sicherheit `safeFor(diff) * 0.9` machbar ist (`maxGap` aus `reach.js`). Der Einstieg wird so in der Höhe verschoben, dass alle Plattform Oberkanten (`st.platMinY` bis `st.platMaxY`, relativ zum Einstieg, bei beweglichen Plattformen samt Schwingweg) in `[Y_MIN, Y_MAX]` liegen und alle anderen Objekte (`st.minY` bis `st.maxY`) zwischen 24 und `H - 12` (Messlauf mit `createBuilder(..., { measure: true })`, davor `s.rng` sichern und danach zurücksetzen; `tests/chunk-harness.mjs` zeigt die Rechnung).
- Validierung mit `validateStaged` (`game/validate.js`). Bei Fehlern bis zu 5 neue Versuche, danach der Fallback Chunk `flat`. Zähler in `s.gen.stats = { chunks, rejects, fallbacks }`.
- Übernahme in den Zustand erst nach erfolgreicher Validierung. Dabei Limits einhalten (`MAX_PLATFORMS`, `MAX_HAZARDS`, `MAX_STARS`, aktive Gegner).
- `s.gen.spans` merkt sich die letzten Chunks `{ id, x0, x1, diff }` für `chunkAt` und die Debug Anzeige. `s.gen.routeLog` sammelt alle Routenplattformen als `{id,kind,x,y,w}` nur, wenn `s.gen.keepLog` gesetzt ist (für Tests).
- Hinweise: wird zum ersten Mal eine Mechanik gebaut (Tag in `HINTS`), kommt `{x, text, mech}` in `s.hints.queue`. `updateHints` zeigt den Text als `banner`, sobald `player.x > x - 260`, einmal pro Mechanik und Lauf.
- `cleanup(s)`: entfernt alle Objekte (Plattformen, Gegner, Hindernisse, Zonen, Sterne, Powerups, Tore) links von `camX - CLEAN_BEHIND`, tote Gegner und eingesammelte Sterne.
- Chunk Bibliothek: `game/chunks/index.js` exportiert `CHUNKS`. Mindestens 28 Layouts, verteilt auf `basic.js` (Schwierigkeit 1 bis 2.5) und `advanced.js` (2.5 bis 5), dazu `gate` und `flat` in `special.js`.

### input.js
Siehe Stub: `TOUCH_LAYOUT`, `createInput(canvas, { onAction, onTouch })` mit `poll()`, `held()`, `destroy()`. Tasten: links `ArrowLeft`, `KeyA`; rechts `ArrowRight`, `KeyD`; Sprung `Space`, `ArrowUp`, `KeyW`, `Enter` (nur als Start); Dash `ShiftLeft`, `ShiftRight`, `KeyX`, `KeyK`; Pause `KeyP`, `Escape`; Debug `F3`. Tasten wirken nur, wenn das Canvas Fokus hat oder die Maus darüber ist. Touch: Pointer Events, Mehrfach Touch, ein Finger darf von einer Fläche zur anderen gleiten, Koordinaten werden in logische Pixel umgerechnet. Jede Spielaktion ruft `onAction('press')` (zum Starten und Neustarten). Eine Touch Eingabe ruft einmal `onTouch()`.

### stats.js
Siehe Stub. localStorage Schlüssel `key + '-stats'` (JSON). Der alte Schlüssel `key` (nur eine Zahl, der frühere Highscore) wird beim ersten Laden als `bestScore` übernommen. Alle Zugriffe in try und catch. `recordRun` ändert das übergebene Objekt nicht, sondern gibt ein neues zurück.

### render/*
`view = { W, H, camX, time, shakeX, shakeY, reduceMotion, debug }`. `view.time` ist die laufende Echtzeit in Sekunden für Animationen. Alle Zeichenfunktionen erwarten, dass `ctx` bereits auf logische Koordinaten skaliert ist. Kein Zustand außerhalb von `s`, `ui` und `view`. Zeichne nur, was im Bild liegt (`x - camX` zwischen minus 120 und `W + 120`). Keine Bilddateien. Stil: weich, verträumt, Pastellfarben mit leichtem Leuchten, Gegner klar lesbar und eindeutig anders gefärbt als Nimbus.
- `background.js`: `drawBackground(ctx, s, view)`. Himmelsverlauf aus `themeAt(s.world)`, Parallax Ebenen: Sterne (sehr langsam, funkelnd), ferne Wolken, Mond und Nebel, leichte schwebende Partikel. Dream Events: Supermond (Mond wächst über `eventEnvelope`), Sternschnuppen am Himmel, Sturmwolken. Nur Canvas Formen, Farbverläufe, keine Dateien.
- `world.js`: `drawWorld(ctx, s, view)`: Plattformen (statisch, beweglich mit sichtbarer Bahn, brüchig mit Wackeln und Alpha), Windzonen mit Windlinien, Regenzonen mit Regenwolke und Tropfen, Stachelwolken (dunkel, spitz, elektrisch), Blitze (Glow, Flackern, Einschlag mit Zonenmarkierung am Boden während der Vorwarnung), Sterne (normal, fallend, Risiko, Event), Powerups (vier unterscheidbare Formen und Farben), Traumtore (leuchtender Mondring, Portal).
- `characters.js`: `drawCharacters(ctx, s, view)`: Spieler Nimbus (Squash und Stretch, Blinken bei `invuln`, Schildblase, Dash Regenbogenspur, Blinzeln), Gegner (Walker, Jumper mit Zusammenziehen, Flyer, Charger mit Aufladen und Ausrufezeichen), Partikel, Hitboxen bei `view.debug`.
- `hud.js`: `drawHud(ctx, s, ui, view)`: Herzen, Punkte, Distanz, Combo Anzeige mit Zeitbalken, Powerup Anzeigen mit Restzeit, Popups in Weltkoordinaten, Banner, Touch Tasten (nur wenn `ui.touch` und `ui.state === 'playing'`), Debug Anzeige bei `ui.debug`.
- `screens.js`: `drawTitle`, `drawPause`, `drawGameOver`. Game Over wie spezifiziert: Text "Du bist aufgewacht.", darunter Punkte, Distanz, Sterne, Gegner, beste Combo, Rekord, Ursache ("Getroffen von: ..."), bei neuem Rekord "✨ Neuer Traumrekord!", Knopf "Nochmal träumen". Einblenden über `ui.overT`.

## Debug Modus

`createNimbusGame(container, { debug: true })` zeigt FPS, Distanz, Schwierigkeit, aktuelle Chunk ID, aktive Gegner, aktive Plattformen, Partikelanzahl, Spielergeschwindigkeit und alle Hitboxen. `F3` schaltet um. Standard ist `false`.
