@echo off
setlocal enabledelayedexpansion

echo.
echo   ========================================================
echo     G1Code AI IDE — Web ^& Localhost Runner
echo                  Windows Edition
echo   ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   [ERROR] Node.js was not found. Please install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo   [ERROR] npm was not found. Please ensure Node.js is installed with npm.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   [..] Installing required project dependencies...
  call npm install --loglevel=error
)

echo.
echo   ========================================================
echo     Starting Backend API Server + Web UI Dashboard
echo     - Backend API:       http://127.0.0.1:3131
echo     - Web UI Dashboard:  http://localhost:5173
echo     Press Ctrl+C to stop all servers
echo   ========================================================
echo.

start "" "http://localhost:5173"
call npm run dev:ui
