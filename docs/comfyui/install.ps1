# Installiert ComfyUI (portable, NVIDIA) + Nodes + Modelle + Workflow "4K 60FPS 1.0"
# Start: Rechtsklick -> "Mit PowerShell ausführen" (Admin nur nötig fürs Strom-Limit)
$ErrorActionPreference = 'Stop'
$root = Join-Path $HOME 'ComfyUI-4K'
New-Item -ItemType Directory -Force $root | Out-Null
Set-Location $root

if (-not (Test-Path 'ComfyUI_windows_portable')) {
  Write-Host 'Lade ComfyUI (ca. 2 GB)...'
  Invoke-WebRequest 'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z' -OutFile cu.7z
  if (Get-Command 7z -ErrorAction SilentlyContinue) { 7z x cu.7z -y | Out-Null } else { tar -xf cu.7z }
  Remove-Item cu.7z
}
$cu = Join-Path $root 'ComfyUI_windows_portable\ComfyUI'
$py = Join-Path $root 'ComfyUI_windows_portable\python_embeded\python.exe'

# Custom Nodes
$nodes = @{ 'ComfyUI-VideoHelperSuite'='Kosinkadink'; 'ComfyUI-Frame-Interpolation'='Fannovel16' }
foreach ($n in $nodes.Keys) {
  $dst = Join-Path $cu "custom_nodes\$n"
  if (-not (Test-Path $dst)) {
    Invoke-WebRequest "https://github.com/$($nodes[$n])/$n/archive/refs/heads/main.zip" -OutFile n.zip
    Expand-Archive n.zip -DestinationPath "$cu\custom_nodes" -Force; Remove-Item n.zip
    Rename-Item "$cu\custom_nodes\$n-main" $n
  }
  $req = Join-Path $dst 'requirements-no-cupy.txt'; if (-not (Test-Path $req)) { $req = Join-Path $dst 'requirements.txt' }
  if (Test-Path $req) { & $py -m pip install -r $req }
}

# Upscale-Modell + Workflow
$um = Join-Path $cu 'models\upscale_models'; New-Item -ItemType Directory -Force $um | Out-Null
if (-not (Test-Path "$um\RealESRGAN_x2plus.pth")) {
  Invoke-WebRequest 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth' -OutFile "$um\RealESRGAN_x2plus.pth"
}
$wf = Join-Path $cu 'user\default\workflows'; New-Item -ItemType Directory -Force $wf | Out-Null
Copy-Item (Join-Path $PSScriptRoot '4K 60FPS 1.0.json') $wf -Force
Copy-Item (Join-Path $PSScriptRoot 'start-4k.bat') $root -Force
Write-Host "`nFERTIG. Starte jetzt: $root\start-4k.bat"
