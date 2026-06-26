$ErrorActionPreference = "SilentlyContinue"
$baseDir = Join-Path $env:LOCALAPPDATA "GrupoAzuos\InventarioTI"
$collectorPath = Join-Path $baseDir "coletor-hardware-azuos.ps1"
$collectorUrl = "https://central-chamados-ti-azuos.vercel.app/coletor-hardware-azuos.ps1"

if (-not (Test-Path $baseDir)) {
  New-Item -ItemType Directory -Path $baseDir -Force | Out-Null
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri $collectorUrl -OutFile $collectorPath
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collectorPath -Silent
  if ($LASTEXITCODE -ne 0) { exit 1 }
  exit 0
} catch {
  exit 1
}
