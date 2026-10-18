@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is niet geinstalleerd. Download het via https://nodejs.org en start dit bestand opnieuw. & pause & exit /b)
call npm install --no-audit --no-fund --loglevel=error
call npm start
