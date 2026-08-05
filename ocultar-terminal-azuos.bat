@echo off
setlocal
title Ocultar janela do monitor - Grupo Azuos
color 0B

echo ==================================================
echo   OCULTAR JANELA DO MONITOR - GRUPO AZUOS
echo   (tira a janela vazia que fica abrindo sozinha)
echo ==================================================
echo.

set "DIR1=%LOCALAPPDATA%\GrupoAzuos\InventarioTI"
set "DIR2=%ProgramData%\GrupoAzuos\InventarioTI"
set "DIR="
if exist "%DIR1%\monitor-desempenho-azuos.ps1" set "DIR=%DIR1%"
if not defined DIR if exist "%DIR2%\monitor-desempenho-azuos.ps1" set "DIR=%DIR2%"

if not defined DIR (
  color 0C
  echo [ERRO] Nao encontrei a instalacao nesta maquina.
  echo Rode primeiro o instalador ^(instalar-inventario-azuos.bat^).
  echo.
  pause
  exit /b 1
)

echo Instalacao encontrada em:
echo   %DIR%
echo.
echo Baixando a versao corrigida dos agentes...
set "BASEURL=https://central-chamados-ti-azuos.vercel.app"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; foreach($f in 'agente-desempenho-azuos.ps1','monitor-desempenho-azuos.ps1','agente-inventario-azuos.ps1'){ try{ Invoke-WebRequest -UseBasicParsing -Uri ('%BASEURL%/'+$f) -OutFile (Join-Path '%DIR%' $f) }catch{ curl.exe --ssl-no-revoke -fsSL ('%BASEURL%/'+$f) -o (Join-Path '%DIR%' $f) } }" >nul 2>&1

echo Criando lancadores ocultos...
echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%DIR%\monitor-desempenho-azuos.ps1""", 0, False>"%DIR%\iniciar-monitor-oculto.vbs"
echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%DIR%\agente-desempenho-azuos.ps1""", 0, False>"%DIR%\iniciar-desempenho-oculto.vbs"
echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%DIR%\agente-inventario-azuos.ps1""", 0, False>"%DIR%\iniciar-inventario-oculto.vbs"

echo Reconfigurando a inicializacao (sem janela)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosInventarioTI" /t REG_SZ /d "wscript.exe \"%DIR%\iniciar-inventario-oculto.vbs\"" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosMonitorDesempenho" /t REG_SZ /d "wscript.exe \"%DIR%\iniciar-desempenho-oculto.vbs\"" /f >nul

schtasks /Create /TN "Grupo Azuos - Inventario TI" /TR "wscript.exe \"%DIR%\iniciar-inventario-oculto.vbs\"" /SC DAILY /MO 1 /ST 12:00 /F >nul 2>&1
schtasks /Create /TN "Grupo Azuos - Inventario TI (Logon)" /TR "wscript.exe \"%DIR%\iniciar-inventario-oculto.vbs\"" /SC ONLOGON /F >nul 2>&1
schtasks /Create /TN "Grupo Azuos - Monitor Vigia" /TR "wscript.exe \"%DIR%\iniciar-monitor-oculto.vbs\"" /SC MINUTE /MO 15 /F >nul 2>&1

echo Fechando a janela visivel que estiver aberta...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.ProcessId -ne $PID -and $_.CommandLine -match 'monitor-desempenho-azuos|agente-desempenho-azuos' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

echo Reiniciando o monitor OCULTO...
start "" wscript.exe "%DIR%\iniciar-monitor-oculto.vbs"

echo.
echo ==================================================
echo  PRONTO! A janela nao vai mais aparecer.
echo  O monitor continua rodando escondido e a maquina
echo  fica Online normalmente.
echo ==================================================
echo.
echo Ao apertar uma tecla esta janela fecha.
pause
