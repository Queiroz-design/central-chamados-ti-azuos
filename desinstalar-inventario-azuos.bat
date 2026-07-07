@echo off
setlocal
title Desinstalar Inventario TI - Grupo Azuos
color 0E

echo ==================================================
echo   DESINSTALADOR DO INVENTARIO TI - GRUPO AZUOS
echo ==================================================
echo.
echo Parando o monitor de desempenho...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*monitor-desempenho-azuos*' -or $_.CommandLine -like '*agente-desempenho-azuos*' -or $_.CommandLine -like '*agente-inventario-azuos*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }"

echo Removendo a inicializacao automatica (login)...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosInventarioTI" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AzuosMonitorDesempenho" /f >nul 2>&1

echo Removendo a tarefa agendada...
schtasks /Delete /TN "Grupo Azuos - Inventario TI" /F >nul 2>&1

echo Apagando os arquivos dos agentes...
rmdir /S /Q "%LOCALAPPDATA%\GrupoAzuos\InventarioTI" >nul 2>&1
rmdir /S /Q "%ProgramData%\GrupoAzuos\InventarioTI" >nul 2>&1

echo.
echo ==================================================
echo DESINSTALACAO CONCLUIDA
echo ==================================================
echo.
echo O monitoramento foi removido desta maquina.
echo Agora a maquina nao envia mais dados e pode ser apagada do painel.
echo.
pause
