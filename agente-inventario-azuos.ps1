[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "SilentlyContinue"
$baseDir = Join-Path $env:LOCALAPPDATA "GrupoAzuos\InventarioTI"
$collectorPath = Join-Path $baseDir "coletor-hardware-azuos.ps1"
$lastRunPath = Join-Path $baseDir "ultima-coleta.txt"
$collectorUrl = "https://central-chamados-ti-azuos.vercel.app/coletor-hardware-azuos.ps1"

if (-not (Test-Path $baseDir)) {
  New-Item -ItemType Directory -Path $baseDir -Force | Out-Null
}

if (-not $Force -and (Test-Path $lastRunPath)) {
  $lastRun = (Get-Item $lastRunPath).LastWriteTime
  if ($lastRun.Date -eq (Get-Date).Date) {
    exit 0
  }
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri $collectorUrl -OutFile $collectorPath
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collectorPath -Silent
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Set-Content -Path $lastRunPath -Value (Get-Date).ToString("o") -Encoding UTF8
  exit 0
} catch {
  exit 1
}
