$ErrorActionPreference = "SilentlyContinue"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $baseDir) { $baseDir = Join-Path $env:ProgramData "GrupoAzuos\InventarioTI" }
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
  # Lanca o monitor TOTALMENTE oculto via wscript/VBS.
  # (Start-Process -WindowStyle Hidden ainda deixava uma janela vazia do PowerShell na tela.)
  $vbsPath = Join-Path $baseDir "iniciar-monitor-oculto.vbs"
  $vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $monitorPath + '""", 0, False'
  Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII
  Start-Process wscript.exe -ArgumentList "`"$vbsPath`""
  exit 0
} catch { exit 1 }
