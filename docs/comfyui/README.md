# ComfyUI Workflow: 4K 60 FPS (speicherschonend)

Datei: `4K 60 FPS.json` – in ComfyUI per Drag & Drop ins Fenster ziehen (oder Workflow → Öffnen),
dann **Workflow → Speichern unter…** und `4K 60 FPS` nennen.

## Benötigte Custom Nodes (ComfyUI-Manager → "Install Missing Custom Nodes")
- ComfyUI-VideoHelperSuite (Video laden/speichern)
- ComfyUI-Frame-Interpolation (RIFE; Modell `rife47.pth` lädt sich selbst)
- Upscale-Modell `RealESRGAN_x2.pth` in `models/upscale_models/`
  (für 720p oder kleiner lieber ein 4x-Modell, z. B. `RealESRGAN_x4plus.pth`)

## Warum es wenig Speicher braucht
- Zuerst Interpolation (bei kleiner Auflösung), dann erst Upscale auf 4K.
- `ImageUpscaleWithModel` rechnet kachelweise (spart VRAM).
- Das Video wird in Stücken verarbeitet (`frame_load_cap` = 30 Frames).
  Ein 4K-Frame braucht ~100 MB RAM, 30 Quellframes -> 60 Frames ≈ 6 GB.
  Zu viel? `frame_load_cap` auf 16–20 senken. Genug RAM? Höher stellen.

## Auf die Hälfte der Grafikkarte begrenzen
ComfyUI mit Startoption `--reserve-vram <GB>` starten, GB = Hälfte deiner VRAM,
z. B. bei 16 GB: `python main.py --lowvram --reserve-vram 8`
(bei 8 GB: `--reserve-vram 4`, bei 24 GB: `--reserve-vram 12`).

## Benutzung
1. Video in `ComfyUI/input/` legen, im Knoten 1 auswählen.
2. Queue drücken -> Teil 1. Danach `skip_first_frames` um 30 erhöhen
   (30, 60, 90, …) und wieder Queue, bis das Video durch ist.
3. Teile zusammenfügen und Originalton dazu (ffmpeg):
   ```
   ls teil_*.mp4 | sed "s/^/file '/;s/$/'/" > liste.txt
   ffmpeg -f concat -safe 0 -i liste.txt -c copy ohne_ton.mp4
   ffmpeg -i ohne_ton.mp4 -i input.mp4 -map 0:v -map 1:a? -c copy -shortest 4K_60FPS.mp4
   ```

## Hinweise
- `force_rate` = 30: Quellvideo wird auf 30 FPS gebracht, RIFE x2 ergibt exakt 60.
  Bei 60-FPS-Quellen: `force_rate` 0 und RIFE `multiplier` 1 (nur Upscale).
- Knoten 5 streckt auf 3840x2160; bei nicht-16:9-Videos `crop` auf `center` stellen.
- An den Stückgrenzen kann es minimal ruckeln (RIFE sieht dort das Nachbarstück nicht).
