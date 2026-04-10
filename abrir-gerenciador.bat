@echo off
cd /d "%~dp0app"

if not exist node_modules (
  echo Instalando dependencias do gerenciador...
  call npm install
)

call npm start
