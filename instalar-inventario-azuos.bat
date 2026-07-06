@echo off
setlocal
title Instalador do Inventario TI - Grupo Azuos
color 0B

echo ==================================================
echo     INSTALADOR DO INVENTARIO TI - GRUPO AZUOS
echo ==================================================
echo.
echo Este processo sera feito apenas uma vez.
echo Instalando o inventario automatico...
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\GrupoAzuos\InventarioTI"
set "AGENT_PATH=%INSTALL_DIR%\agente-inventario-azuos.ps1"
set "AGENT_URL=https://central-chamados-ti-azuos.vercel.app/agente-inventario-azuos.ps1"
set "PERF_AGENT_PATH=%INSTALL_DIR%\agente-desempenho-azuos.ps1"
set "PERF_AGENT_URL=https://central-chamados-ti-azuos.vercel.app/agente-desempenho-azuos.ps1"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%AGENT_URL%' -OutFile '%AGENT_PATH%'"
if errorlevel 1 goto :erro
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%PERF_AGENT_URL%' -OutFile '%PERF_AGENT_PATH%'"
if errorlevel 1 goto :erro

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosInventarioTI" /t REG_SZ /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%AGENT_PATH%\"" /f >nul
if errorlevel 1 goto :erro
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosMonitorDesempenho" /t REG_SZ /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%PERF_AGENT_PATH%\"" /f >nul
if errorlevel 1 goto :erro

schtasks /Create /TN "Grupo Azuos - Inventario TI" /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%AGENT_PATH%\"" /SC DAILY /MO 1 /ST 12:00 /F >nul 2>&1

echo Fazendo a primeira coleta...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%AGENT_PATH%" -Force
if errorlevel 1 goto :erro
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PERF_AGENT_PATH%"
if errorlevel 1 goto :erro

echo.
echo ==================================================
echo INSTALACAO CONCLUIDA COM SUCESSO
echo ==================================================
echo.
echo O computador sera atualizado automaticamente:
echo - todos os dias no primeiro login do Windows;
echo - verificacao diaria ao meio-dia, se a maquina permanecer ligada;
echo - desempenho de CPU, memoria e disco em tempo real.
echo.
pause
exit /b 0

:erro
color 0C
echo.
echo Nao foi possivel concluir a instalacao.
echo Verifique a internet e tente novamente.
echo.
pause
exit /b 1
