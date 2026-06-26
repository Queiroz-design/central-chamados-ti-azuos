$ErrorActionPreference = "SilentlyContinue"

$SupabaseUrl = "https://fazguvdmaufcohemsqom.supabase.co"
$SupabaseKey = "sb_publishable_acp9vD-gQfaT6vtWln60wA_WT-sVtVt"
$Endpoint = "$SupabaseUrl/rest/v1/hardware_inventory"

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

Write-Host "Coletando inventario de hardware do Grupo Azuos..." -ForegroundColor Cyan

$computer = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$memoryModules = @(Get-CimInstance Win32_PhysicalMemory)
$diskDrives = @(Get-CimInstance Win32_DiskDrive)
$physicalDisks = @(Get-PhysicalDisk)
$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3")
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
    $reliability = $physical | Get-StorageReliabilityCounter
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

$payload = [ordered]@{
  computer_name = $env:COMPUTERNAME
  user_name = "$env:USERNAME"
  domain_name = "$env:USERDOMAIN"
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  serial_number = $bios.SerialNumber
  os_caption = $os.Caption
  os_version = $os.Version
  last_boot = ([Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)).ToString("o")
  cpu_name = $cpu.Name
  cpu_cores = $cpu.NumberOfCores
  cpu_logical_processors = $cpu.NumberOfLogicalProcessors
  memory_total_gb = $memoryTotalGb
  memory_slots = $memorySlots
  memory_modules = $memoryPayload
  disks = $diskPayload
  volumes = $volumePayload
  battery = if ($battery) {
    [ordered]@{
      name = $battery.Name
      status = $battery.Status
      estimated_charge_remaining = $battery.EstimatedChargeRemaining
      estimated_run_time = $battery.EstimatedRunTime
    }
  } else { $null }
  health_score = [int]$score
  health_status = $healthStatus
  warnings = @($warnings)
  raw = [ordered]@{
    collected_by = "coletor-hardware-azuos.ps1"
    collected_at = (Get-Date).ToString("o")
  }
  reported_at = (Get-Date).ToString("o")
}

$headers = @{
  "apikey" = $SupabaseKey
  "Authorization" = "Bearer $SupabaseKey"
  "Content-Type" = "application/json"
  "Prefer" = "resolution=merge-duplicates,return=representation"
}

$json = $payload | ConvertTo-Json -Depth 8
$uri = "$Endpoint?on_conflict=computer_name"

try {
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $json | Out-Null
  Write-Host "Inventario enviado com sucesso." -ForegroundColor Green
  Write-Host "Computador: $($payload.computer_name)"
  Write-Host "Saude: $healthStatus ($score/100)"
  if ($warnings.Count -gt 0) {
    Write-Host "Alertas:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "- $($_.message)" }
  }
} catch {
  Write-Host "Erro ao enviar inventario." -ForegroundColor Red
  Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "Pode fechar esta janela." -ForegroundColor Cyan
Read-Host "Pressione ENTER para sair"
