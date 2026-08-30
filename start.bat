@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js was not found on this machine.
  echo     Install the LTS build from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

node src\index.js %*
if errorlevel 1 pause
