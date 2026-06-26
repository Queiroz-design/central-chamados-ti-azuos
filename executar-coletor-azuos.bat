@echo off
setlocal
title Coletor de Hardware - Grupo Azuos
color 0B

echo ================================================
echo        COLETOR DE HARDWARE - GRUPO AZUOS
echo ================================================
echo.
echo Preparando a coleta. Aguarde...

set "SCRIPT_PATH=%TEMP%\coletor-hardware-azuos.ps1"
set "SCRIPT_URL=https://central-chamados-ti-azuos.vercel.app/coletor-hardware-azuos.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%SCRIPT_URL%' -OutFile '%SCRIPT_PATH%'; & '%SCRIPT_PATH%' } catch { Write-Host 'Nao foi possivel executar o coletor.' -ForegroundColor Red; Write-Host $_.Exception.Message; Read-Host 'Pressione ENTER para sair'; exit 1 }"

del "%SCRIPT_PATH%" >nul 2>&1
endlocal
