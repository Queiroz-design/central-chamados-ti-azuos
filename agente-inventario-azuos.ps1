[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$ShowDetails
)

$ErrorActionPreference = "SilentlyContinue"
$baseDir = Join-Path $env:LOCALAPPDATA "GrupoAzuos\InventarioTI"
$collectorPath = Join-Path $baseDir "coletor-hardware-azuos.ps1"
$lastRunPath = Join-Path $baseDir "ultima-coleta.txt"
$collectorUrl = "https://central-chamados-ti-azuos.vercel.app/coletor-hardware-azuos.ps1"
$logPath = Join-Path $baseDir "ultima-coleta-status.txt"

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
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $collectorUrl -OutFile $collectorPath
  if ($ShowDetails) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collectorPath -NoPause
  } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collectorPath -Silent
  }
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Set-Content -Path $lastRunPath -Value (Get-Date).ToString("o") -Encoding UTF8
  exit 0
} catch {
  Add-Content -Path $logPath -Value "ERRO NO AGENTE - $($_.Exception.Message)" -Encoding UTF8
  exit 1
}
