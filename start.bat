@echo off
title CopyPage
cd /d "%~dp0"

:: Verificar pnpm
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm no encontrado. Instalar con: npm install -g pnpm
    pause
    exit /b 1
)

:: Instalar dependencias si faltan
if not exist "node_modules\" (
    echo [SETUP] Instalando dependencias...
    pnpm install
    if %errorlevel% neq 0 ( echo [ERROR] pnpm install fallo & pause & exit /b 1 )
)

:: Instalar Chromium si falta
if not exist "node_modules\.pnpm\playwright@*" (
    echo [SETUP] Instalando Chromium...
    pnpm setup
)

:: Liberar puerto 3001 si esta ocupado
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr " :3001 "') do (
    echo [INFO] Liberando puerto 3001 ^(PID %%a^)...
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo  -----------------------------------------------
echo   CopyPage iniciando...
echo   Frontend : http://localhost:5173
echo   API      : http://localhost:3001
echo  -----------------------------------------------
echo.

pnpm dev

echo.
echo [INFO] El servidor se detuvo.
pause
