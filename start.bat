@echo off
cd /d "%~dp0"

:: Verificar que pnpm esté instalado
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm no encontrado. Instalar: npm install -g pnpm
    pause
    exit /b 1
)

:: Instalar dependencias si node_modules no existe
if not exist "node_modules\" (
    echo [SETUP] Instalando dependencias...
    pnpm install
)

:: Instalar Chromium si no existe
if not exist "node_modules\.pnpm\playwright*" (
    echo [SETUP] Instalando Chromium para Playwright...
    pnpm setup
)

:: Liberar puerto 3001 si está ocupado
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " 2^>nul') do (
    echo [INFO] Liberando puerto 3001 (PID %%a)...
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo  CopyPage
echo  Frontend : http://localhost:5173
echo  API      : http://localhost:3001
echo.

pnpm dev
