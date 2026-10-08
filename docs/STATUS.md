# Stand der Arbeit

Zwischenstand, weil die parallele Umsetzung vorzeitig angehalten wurde.

## Fertig geschrieben

Spielerphysik, Plattformen, Gegner, Hindernisse, Sammelobjekte, Traumtore, Ereignisse, Generator mit Validierung, 30 Chunk Layouts, Hintergrund, Bildschirme und Weltdarstellung samt Tests. Rund 500 Tests laufen, zwei sind rot.

## Noch Platzhalter

Diese Dateien enthalten nur einen minimalen Stub und müssen noch umgesetzt werden:

| Datei | Aufgabe |
| --- | --- |
| `game/particles.js` | Partikel erzeugen und aktualisieren |
| `game/render/characters.js` | Nimbus, Gegner und Partikel zeichnen |
| `game/render/hud.js` | Herzen, Punkte, Combo, Touch Tasten, Debug Anzeige |
| `game/input.js` | Tastatur und Touch |
| `game/stats.js` | Statistiken im localStorage |

## Danach

1. Alle Tests grün machen (`npm test`).
2. Test Bot laufen lassen (`node tests/bot-run.mjs 1500 1 6`) und unfaire Stellen im Level beheben.
3. Im Browser prüfen und Screenshots für das README erzeugen.
4. README aktualisieren, dann veröffentlichen.

Der Vertrag zwischen den Modulen steht in `docs/ARCHITEKTUR.md`.
