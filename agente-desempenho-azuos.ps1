$ErrorActionPreference = "SilentlyContinue"
$baseDir = Join-Path $env:LOCALAPPDATA "GrupoAzuos\InventarioTI"
$monitorPath = Join-Path $baseDir "monitor-desempenho-azuos.ps1"
$monitorUrl = "https://central-chamados-ti-azuos.vercel.app/monitor-desempenho-azuos.ps1"

function Get-AzuosFile($url, $path) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path -ErrorAction Stop
  } catch {
    & curl.exe --ssl-no-revoke -fsSL $url -o $path
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $url" }
  }
}

if (-not (Test-Path $baseDir)) { New-Item -ItemType Directory -Path $baseDir -Force | Out-Null }

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Get-AzuosFile $monitorUrl $monitorPath
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$monitorPath`""
  exit 0
} catch { exit 1 }
