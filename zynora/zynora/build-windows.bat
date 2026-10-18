@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is niet geinstalleerd. Download het via https://nodejs.org en start dit bestand opnieuw. & pause & exit /b)
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
call npm run dist
echo.
echo Klaar! In de map "dist" staat de installer (Zynora Setup ....exe) en een draagbare versie.
explorer dist
pause
