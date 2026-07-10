[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"
$AgentVersion = "1.1.2"
$SampleSeconds = 30
$HistoryEveryCycles = 10
$AlertThreshold = 98
$RecoveryThreshold = 90
$ConsecutiveRequired = 2
# Limites por recurso. Disco agora e por ESPACO cheio (100 - % livre), nao por uso/leitura.
$AlertThresholds = @{ CPU = 98; Memoria = 98; Disco = 90 }      # Disco: alerta com menos de 10% livre
$RecoveryThresholds = @{ CPU = 90; Memoria = 90; Disco = 85 }   # Disco: recupera com mais de 15% livre
# Envio agora passa pelo proxy serverless (a service key fica so na Vercel).
$ProxyUrl = "https://central-chamados-ti-azuos.vercel.app/api/coletor"
$ColetorSecret = "azuos-coletor-gfz8q9w0bqb7"
$ComputerName = $env:COMPUTERNAME
$LogicalProcessors = [math]::Max(1, (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors)

$MonitorLogDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $MonitorLogDir) { $MonitorLogDir = Join-Path $env:ProgramData "GrupoAzuos\InventarioTI" }
$MonitorLog = Join-Path $MonitorLogDir "ultima-telemetria-status.txt"
function Write-MonitorLog($text) { try { Set-Content -Path $MonitorLog -Value "$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss')) - $text" -Encoding UTF8 } catch {} }
Write-MonitorLog "Monitor iniciado."

$mutex = New-Object System.Threading.Mutex($false, "Local\AzuosMonitorDesempenho")
if (-not $mutex.WaitOne(0, $false)) { Write-MonitorLog "Ja existe um monitor rodando nesta sessao. Este saiu."; exit 0 }

Write-MonitorLog "Preparando coleta..."

function Clamp-Percent($value) {
  if ($null -eq $value) { return 0 }
  return [math]::Round([math]::Min(100, [math]::Max(0, [double]$value)), 1)
}

function Invoke-Supabase($method, $table, $body, $query = "", $returnRepresentation = $false) {
  # Envia sempre por POST ao proxy; o metodo real do Supabase vai no envelope.
  $prefer = if ($returnRepresentation) { "resolution=merge-duplicates,return=representation" } else { "resolution=merge-duplicates,return=minimal" }
  $envelope = [ordered]@{
    table   = $table
    method  = $method.ToUpper()
    query   = $query
    prefer  = $prefer
    payload = $body
  }
  $json = $envelope | ConvertTo-Json -Depth 9 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $headers = @{ "x-coletor-secret" = $ColetorSecret }
  try {
    return Invoke-RestMethod -Method Post -Uri $ProxyUrl -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 20 -ErrorAction Stop
  } catch {
    $result = & curl.exe --ssl-no-revoke --max-time 25 -sS -f -L -X POST $ProxyUrl `
      -H "x-coletor-secret: $ColetorSecret" `
      -H "Content-Type: application/json; charset=utf-8" `
      --data-raw $json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Falha HTTPS no monitor: $result" }
    if ($result -and ($method -eq "Get" -or $returnRepresentation)) { return $result | ConvertFrom-Json }
    return $null
  }
}

function Get-ActivityInfo {
  # Removido o monitoramento de janela ativa (parecia spyware para o antivirus).
  return [ordered]@{ process = ""; category = "" }
}

function Get-TopProcesses($perfProcesses) {
  $valid = @($perfProcesses | Where-Object { $_.Name -notmatch "^(_Total|Idle)$" -and $_.IDProcess -gt 0 })
  $topCpu = @($valid | Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 | ForEach-Object {
    [ordered]@{ name=$_.Name; pid=$_.IDProcess; percent=Clamp-Percent ($_.PercentProcessorTime / $LogicalProcessors) }
  })
  $topIo = @($valid | Sort-Object IODataBytesPersec -Descending | Select-Object -First 5 | ForEach-Object {
    [ordered]@{ name=$_.Name; pid=$_.IDProcess; mbps=[math]::Round(([double]$_.IODataBytesPersec / 1MB), 2) }
  })
  $topMemory = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object {
    [ordered]@{ name=$_.ProcessName; pid=$_.Id; memory_mb=[math]::Round(([double]$_.WorkingSet64 / 1MB), 0) }
  })
  return [ordered]@{ cpu=$topCpu; memory=$topMemory; io=$topIo }
}

function Get-CauseProcess($metric, $tops) {
  if ($metric -eq "CPU" -and $tops.cpu.Count) { return $tops.cpu[0].name }
  if ($metric -eq "Memoria" -and $tops.memory.Count) { return $tops.memory[0].name }
  if ($metric -eq "Disco" -and $tops.io.Count) { return $tops.io[0].name }
  return "Nao identificado"
}

$breachCounts = @{ CPU=0; Memoria=0; Disco=0 }
$recoveryCounts = @{ CPU=0; Memoria=0; Disco=0 }
$activeAlerts = @{}
$cycle = 0

Write-MonitorLog "Verificando alertas ativos..."
try {
  $existing = Invoke-Supabase "Get" "hardware_performance_alerts" $null "?computer_name=eq.$([uri]::EscapeDataString($ComputerName))&status=eq.Ativo&select=*" $false
  foreach ($alert in @($existing)) { $activeAlerts[$alert.metric] = $alert }
} catch {}

while ($true) {
  try {
    Write-MonitorLog "Coletando desempenho..."
    $processor = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    $disk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
    $os = Get-CimInstance Win32_OperatingSystem
    $system = Get-CimInstance Win32_ComputerSystem
    $sysDrive = if ($env:SystemDrive) { $env:SystemDrive } else { "C:" }
    $volume = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$sysDrive'"
    $perfProcesses = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process)
    $activity = Get-ActivityInfo
    $tops = Get-TopProcesses $perfProcesses

    $cpuPercent = Clamp-Percent $processor.PercentProcessorTime
    $memoryTotalGb = [math]::Round(([double]$os.TotalVisibleMemorySize / 1MB), 2)
    $memoryUsedGb = [math]::Round(([double]($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB), 2)
    $memoryPercent = Clamp-Percent (($memoryUsedGb / [math]::Max(.01, $memoryTotalGb)) * 100)
    $diskPercent = Clamp-Percent $disk.PercentDiskTime
    # Espaco livre SEMPRE do disco do Windows (o disco real). Ignora Google Drive, pendrives, etc.
    $diskFreePercent = if ($volume.Size) { [math]::Round(([double]$volume.FreeSpace / [double]$volume.Size) * 100, 1) } else { $null }
    $uptimeSeconds = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds
    $now = (Get-Date).ToString("o")

    $livePayload = [ordered]@{
      computer_name=$ComputerName; user_name=$env:USERNAME
      cpu_percent=$cpuPercent; memory_percent=$memoryPercent
      memory_used_gb=$memoryUsedGb; memory_total_gb=$memoryTotalGb
      disk_percent=$diskPercent; disk_free_percent=$diskFreePercent
      uptime_seconds=$uptimeSeconds; active_process=$activity.process
      activity_category=$activity.category; top_cpu=$tops.cpu
      top_memory=$tops.memory; top_io=$tops.io
      agent_version=$AgentVersion; last_seen=$now
    }
    Invoke-Supabase "Post" "hardware_live_status" $livePayload "?on_conflict=computer_name" $false | Out-Null
    Write-MonitorLog "OK - telemetria enviada. CPU $cpuPercent% MEM $memoryPercent% DISK $diskPercent%"

    $cycle++
    if ($cycle -ge $HistoryEveryCycles) {
      $cycle = 0
      $historyPayload = [ordered]@{
        computer_name=$ComputerName; sampled_at=$now
        cpu_percent=$cpuPercent; memory_percent=$memoryPercent; disk_percent=$diskPercent
        active_process=$activity.process; activity_category=$activity.category
        top_processes=$tops
      }
      Invoke-Supabase "Post" "hardware_performance_history" $historyPayload "" $false | Out-Null
    }

    # Disco vira % de espaco OCUPADO do disco do Windows (100 - livre). CPU/Memoria seguem sendo % de uso.
    $diskUsedSpace = if ($null -ne $diskFreePercent) { [math]::Round(100 - [double]$diskFreePercent, 1) } else { 0 }
    $values = @{ CPU=$cpuPercent; Memoria=$memoryPercent; Disco=$diskUsedSpace }
    foreach ($metric in @("CPU","Memoria","Disco")) {
      $value = [double]$values[$metric]
      $th = [double]$AlertThresholds[$metric]
      $rec = [double]$RecoveryThresholds[$metric]
      if ($value -ge 100) { $breachCounts[$metric] = $ConsecutiveRequired }
      elseif ($value -ge $th) { $breachCounts[$metric]++ }
      else { $breachCounts[$metric] = 0 }

      if ($breachCounts[$metric] -ge $ConsecutiveRequired -and -not $activeAlerts.ContainsKey($metric)) {
        if ($metric -eq "Disco") {
          $cause = $null
          $freeTxt = if ($null -ne $diskFreePercent) { "$sysDrive $diskFreePercent% livre" } else { "espaco baixo" }
          $message = "Disco quase cheio ($freeTxt). Libere espaco ou avalie ampliar/trocar o disco."
        } else {
          $cause = Get-CauseProcess $metric $tops
          $message = "$metric atingiu $value%. Possivel causa: $cause. Atividade: $($activity.category)."
        }
        $alertPayload = [ordered]@{
          computer_name=$ComputerName; metric=$metric; peak_value=$value
          threshold=$th; status="Ativo"; started_at=$now
          cause_process=$cause; activity_category=$activity.category
          top_processes=$tops; message=$message
        }
        $saved = Invoke-Supabase "Post" "hardware_performance_alerts" $alertPayload "" $true
        if ($saved) { $activeAlerts[$metric] = @($saved)[0] }
      }

      if ($activeAlerts.ContainsKey($metric)) {
        $active = $activeAlerts[$metric]
        if ($value -gt [double]$active.peak_value) { $active.peak_value = $value }
        if ($value -lt $rec) { $recoveryCounts[$metric]++ } else { $recoveryCounts[$metric] = 0 }
        if ($recoveryCounts[$metric] -ge 2) {
          $duration = [int]((Get-Date) - [datetime]$active.started_at).TotalSeconds
          $patch = [ordered]@{ status="Recuperado"; recovered_at=$now; duration_seconds=$duration; peak_value=$active.peak_value }
          Invoke-Supabase "Patch" "hardware_performance_alerts" $patch "?id=eq.$($active.id)" $false | Out-Null
          $activeAlerts.Remove($metric)
          $recoveryCounts[$metric] = 0
        }
      }
    }
  } catch {
    Write-MonitorLog "ERRO ao enviar telemetria: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $SampleSeconds
}
