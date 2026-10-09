@echo off
rem Startet ComfyUI mit ca. 65 % Grafikkarte; Rest bleibt fuer deinen PC frei.
rem Strom-Limit auf 70 % (nur NVIDIA, braucht Admin; bei Fehler einfach ignorieren).
for /f "tokens=1 delims=. " %a in ('nvidia-smi --query-gpu=power.max_limit --format=csv,noheader,nounits') do set MAXW=%a
if defined MAXW set /a LIMW=%MAXW%*70/100 & nvidia-smi -pl %LIMW% >nul 2>&1
rem 35 % der VRAM freihalten
for /f "tokens=1" %m in ('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits') do set /a RES=%m*35/100/1024
if not defined RES set RES=3
cd /d "%~dp0ComfyUI_windows_portable"
start "ComfyUI" /belownormal python_embeded\python.exe -s ComfyUI\main.py --reserve-vram %RES% --lowvram --windows-standalone-build --auto-launch
