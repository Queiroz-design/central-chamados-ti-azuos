$ErrorActionPreference = "SilentlyContinue"
$baseDir = Join-Path $env:LOCALAPPDATA "GrupoAzuos\InventarioTI"
$monitorPath = Join-Path $baseDir "monitor-desempenho-azuos.ps1"
$monitorUrl = "https://central-chamados-ti-azuos.vercel.app/monitor-desempenho-azuos.ps1"

if (-not (Test-Path $baseDir)) { New-Item -ItemType Directory -Path $baseDir -Force | Out-Null }

try {
  Invoke-WebRequest -UseBasicParsing -Uri $monitorUrl -OutFile $monitorPath
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$monitorPath`""
  exit 0
} catch { exit 1 }
