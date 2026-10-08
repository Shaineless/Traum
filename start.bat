@echo off
setlocal
cd /d "%~dp0"
set PORT=8080
set URL=http://localhost:%PORT%/index.html

echo Nimbus wird gestartet auf %URL%
echo Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "%URL%"
  python -m http.server %PORT%
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "%URL%"
  py -m http.server %PORT%
  goto :end
)

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" "%URL%"
  npx --yes serve -l %PORT% .
  goto :end
)

echo Weder Python noch Node.js gefunden.
echo Installiere eines davon, zum Beispiel Python von https://www.python.org/downloads/
echo ^(beim Installieren "Add Python to PATH" anhaken^) und starte start.bat erneut.

:end
pause
