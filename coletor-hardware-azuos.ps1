[CmdletBinding()]
param(
  [switch]$Silent,
  [switch]$NoPause
)

$ErrorActionPreference = "SilentlyContinue"

# Envio agora passa pelo proxy serverless (a service key fica so na Vercel).
$ProxyUrl = "https://central-chamados-ti-azuos.vercel.app/api/coletor"
$ColetorSecret = "azuos-coletor-gfz8q9w0bqb7"
$LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $LogDir) { $LogDir = Join-Path $env:ProgramData "GrupoAzuos\InventarioTI" }
$LogPath = Join-Path $LogDir "ultima-coleta-status.txt"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
Set-Content -Path $LogPath -Value "Coleta iniciada em $((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))" -Encoding UTF8

# Instala/atualiza o monitor no MODELO CURTO (v2): baixa o monitor e garante uma
# tarefa agendada que o executa a cada 1 minuto (coleta rapida que abre e fecha).
# Como este coletor roda todo dia e se atualiza sozinho, ele distribui o modelo novo
# para toda a frota sem precisar mexer em cada maquina.
try {
  $monitorPath = Join-Path $LogDir "monitor-desempenho-azuos.ps1"
  $monitorUrl = "https://central-chamados-ti-azuos.vercel.app/monitor-desempenho-azuos.ps1"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try { Invoke-WebRequest -UseBasicParsing -Uri $monitorUrl -OutFile $monitorPath -ErrorAction Stop }
  catch { & curl.exe --ssl-no-revoke -fsSL $monitorUrl -o $monitorPath }

  $taskName = "Grupo Azuos - Monitor Desempenho"
  $taskCmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$monitorPath`""
  $taskExists = & schtasks /Query /TN $taskName 2>$null
  if (-not $taskExists) {
    & schtasks /Create /TN $taskName /TR $taskCmd /SC MINUTE /MO 1 /F 2>$null | Out-Null
  }

  # Remove o modelo ANTIGO (PowerShell oculto rodando sem parar), que o antivirus bloqueava.
  & reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosMonitorDesempenho" /f 2>$null | Out-Null

  # Dispara uma coleta agora (nao espera o proximo minuto).
  if (Test-Path $monitorPath) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$monitorPath`""
  }
} catch {}

function ConvertTo-Gb($bytes) {
  if (-not $bytes) { return 0 }
  return [math]::Round(([double]$bytes / 1GB), 2)
}

function Add-WarningItem($list, $message, $severity = "Atencao") {
  $list.Add([ordered]@{
    severity = $severity
    message = $message
  }) | Out-Null
}

if (-not $Silent) { Write-Host "Coletando inventario de hardware do Grupo Azuos..." -ForegroundColor Cyan }

$computer = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController)
$systemProduct = Get-CimInstance Win32_ComputerSystemProduct | Select-Object -First 1
$windowsProductId = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").ProductId
$memoryModules = @(Get-CimInstance Win32_PhysicalMemory)
$diskDrives = @(Get-CimInstance Win32_DiskDrive)
$physicalDisks = @(Get-PhysicalDisk)
# So o disco onde o Windows esta instalado (o disco real). Ignora Google Drive, pendrives, etc.
$sysDrive = if ($env:SystemDrive) { $env:SystemDrive } else { "C:" }
$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3 AND DeviceID='$sysDrive'")
$battery = Get-CimInstance Win32_Battery | Select-Object -First 1
$warnings = New-Object System.Collections.Generic.List[object]

$memoryTotalGb = [math]::Round(($memoryModules | Measure-Object -Property Capacity -Sum).Sum / 1GB, 2)
$memorySlots = @($memoryModules | Where-Object { $_.Capacity -gt 0 }).Count
$memoryPayload = @($memoryModules | ForEach-Object {
  [ordered]@{
    bank = $_.BankLabel
    slot = $_.DeviceLocator
    size_gb = ConvertTo-Gb $_.Capacity
    speed_mhz = $_.Speed
    manufacturer = $_.Manufacturer
    part_number = ($_.PartNumber -as [string]).Trim()
    serial_number = ($_.SerialNumber -as [string]).Trim()
  }
})

$diskPayload = @($diskDrives | ForEach-Object {
  $serial = ($_.SerialNumber -as [string]).Trim()
  $physical = $physicalDisks | Where-Object {
    ($_.SerialNumber -as [string]).Trim() -eq $serial -or $_.FriendlyName -eq $_.Model
  } | Select-Object -First 1

  $reliability = $null
  if ($physical) {
    try {
      $reliability = $physical | Get-StorageReliabilityCounter -ErrorAction Stop 2>$null
    } catch {
      $reliability = $null
    }
  }

  [ordered]@{
    model = $_.Model
    serial_number = $serial
    interface = $_.InterfaceType
    media_type = if ($physical.MediaType) { [string]$physical.MediaType } else { $_.MediaType }
    size_gb = ConvertTo-Gb $_.Size
    status = $_.Status
    health_status = if ($physical.HealthStatus) { [string]$physical.HealthStatus } else { $_.Status }
    operational_status = if ($physical.OperationalStatus) { ($physical.OperationalStatus -join ", ") } else { "" }
    temperature_c = $reliability.Temperature
    wear = $reliability.Wear
    read_errors_total = $reliability.ReadErrorsTotal
    write_errors_total = $reliability.WriteErrorsTotal
  }
})

$volumePayload = @($volumes | ForEach-Object {
  $freePercent = if ($_.Size -gt 0) { [math]::Round(($_.FreeSpace / $_.Size) * 100, 1) } else { 0 }
  [ordered]@{
    drive = $_.DeviceID
    label = $_.VolumeName
    file_system = $_.FileSystem
    size_gb = ConvertTo-Gb $_.Size
    free_gb = ConvertTo-Gb $_.FreeSpace
    free_percent = $freePercent
  }
})

if ($memoryTotalGb -lt 8) {
  Add-WarningItem $warnings "Memoria RAM abaixo de 8 GB: $memoryTotalGb GB"
}

foreach ($volume in $volumePayload) {
  if ($volume.free_percent -lt 15) {
    Add-WarningItem $warnings "Pouco espaco livre no disco $($volume.drive): $($volume.free_percent)%"
  }
}

foreach ($disk in $diskPayload) {
  $health = "$($disk.health_status) $($disk.operational_status) $($disk.status)"
  if ($health -match "Unhealthy|Warning|Pred Fail|Error|Degraded|Falha|Aviso") {
    Add-WarningItem $warnings "Disco com alerta: $($disk.model) - $health" "Critica"
  }
  if ($disk.temperature_c -and $disk.temperature_c -ge 55) {
    Add-WarningItem $warnings "Disco quente: $($disk.model) com $($disk.temperature_c)C" "Atencao"
  }
  if ($disk.wear -and $disk.wear -ge 80) {
    Add-WarningItem $warnings "SSD com desgaste elevado: $($disk.model) - $($disk.wear)%" "Critica"
  }
}

$criticalCount = @($warnings | Where-Object { $_.severity -eq "Critica" }).Count
$score = 100 - ($warnings.Count * 12) - ($criticalCount * 18)
if ($score -lt 0) { $score = 0 }
$healthStatus = if ($criticalCount -gt 0 -or $score -lt 55) { "Critica" } elseif ($warnings.Count -gt 0 -or $score -lt 80) { "Atencao" } else { "Boa" }

$lastBoot = $null
if ($os.LastBootUpTime -is [datetime]) {
  $lastBoot = $os.LastBootUpTime.ToString("o")
} elseif ($os.LastBootUpTime) {
  try {
    $lastBoot = ([Management.ManagementDateTimeConverter]::ToDateTime([string]$os.LastBootUpTime)).ToString("o")
  } catch {
    $lastBoot = $null
  }
}

$batteryPayload = $null
if ($battery) {
  $batteryPayload = [ordered]@{
    name = $battery.Name
    status = $battery.Status
    estimated_charge_remaining = $battery.EstimatedChargeRemaining
    estimated_run_time = $battery.EstimatedRunTime
  }
}

$warningPayload = @($warnings | ForEach-Object { $_ })
$gpuPayload = @($gpus | ForEach-Object {
  [ordered]@{
    name = $_.Name
    memory_gb = if ($_.AdapterRAM) { [math]::Round(([double]$_.AdapterRAM / 1GB), 2) } else { $null }
    driver_version = $_.DriverVersion
    resolution = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } else { "" }
  }
})

$payload = [ordered]@{
  computer_name = $env:COMPUTERNAME
  user_name = "$env:USERNAME"
  domain_name = "$env:USERDOMAIN"
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  serial_number = $bios.SerialNumber
  os_caption = $os.Caption
  os_version = $os.Version
  last_boot = $lastBoot
  cpu_name = $cpu.Name
  cpu_cores = $cpu.NumberOfCores
  cpu_logical_processors = $cpu.NumberOfLogicalProcessors
  gpu = $gpuPayload
  system_type = "$($os.OSArchitecture), $($computer.SystemType)"
  device_uuid = $systemProduct.UUID
  product_id = $windowsProductId
  memory_total_gb = $memoryTotalGb
  memory_slots = $memorySlots
  memory_modules = $memoryPayload
  disks = $diskPayload
  volumes = $volumePayload
  battery = $batteryPayload
  health_score = [int]$score
  health_status = $healthStatus
  warnings = $warningPayload
  raw = [ordered]@{
    collected_by = "coletor-hardware-azuos.ps1"
    collected_at = (Get-Date).ToString("o")
  }
  reported_at = (Get-Date).ToString("o")
}

$headers = @{ "x-coletor-secret" = $ColetorSecret }

$envelope = [ordered]@{
  table   = "hardware_inventory"
  method  = "POST"
  query   = "?on_conflict=computer_name"
  prefer  = "resolution=merge-duplicates,return=minimal"
  payload = $payload
}
$json = $envelope | ConvertTo-Json -Depth 9
$jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($json)

try {
  try {
    Invoke-RestMethod -Method Post -Uri $ProxyUrl -Headers $headers -ContentType "application/json; charset=utf-8" -Body $jsonBytes -TimeoutSec 30 -ErrorAction Stop | Out-Null
  } catch {
    $detail = $_.ErrorDetails.Message
    if (-not $detail -and $_.Exception.Response) {
      try {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $sr.ReadToEnd(); $sr.Close()
      } catch {}
    }
    if (-not $detail) {
      $detail = (& curl.exe --ssl-no-revoke --max-time 30 -sS -L -X POST $ProxyUrl `
        -H "x-coletor-secret: $ColetorSecret" `
        -H "Content-Type: application/json; charset=utf-8" `
        --data-raw $json 2>&1) -join "`n"
    }
    throw "Falha ao enviar inventario. Resposta do proxy: $detail"
  }
  Set-Content -Path $LogPath -Value "SUCESSO - Inventario enviado em $((Get-Date).ToString('dd/MM/yyyy HH:mm:ss')) - Computador: $($payload.computer_name)" -Encoding UTF8
  if (-not $Silent) {
    Write-Host "Inventario enviado com sucesso." -ForegroundColor Green
    Write-Host "Computador: $($payload.computer_name)"
    Write-Host "Saude: $healthStatus ($score/100)"
  }
  if (-not $Silent -and $warnings.Count -gt 0) {
    Write-Host "Alertas:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "- $($_.message)" }
  }
} catch {
  $errorMessage = $_.Exception.Message
  if (-not $Silent) {
    Write-Host "Erro ao enviar inventario." -ForegroundColor Red
    Write-Host $_.Exception.Message
  }
  $responseText = $_.ErrorDetails.Message
  if (-not $responseText -and $_.Exception.Response) {
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $responseText = $reader.ReadToEnd()
      $reader.Close()
    } catch {}
  }
  Add-Content -Path $LogPath -Value "ERRO - $errorMessage" -Encoding UTF8
  if ($responseText) { Add-Content -Path $LogPath -Value $responseText -Encoding UTF8 }
  if (-not $Silent -and $responseText) { Write-Host $responseText }
  if ($Silent) { exit 1 }
}

if (-not $Silent -and -not $NoPause) {
  Write-Host ""
  Write-Host "Pode fechar esta janela." -ForegroundColor Cyan
  Read-Host "Pressione ENTER para sair"
}
if ($Silent) { exit 0 }
