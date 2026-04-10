@echo off
cd /d "%~dp0app"

if not exist ReforgerServerManager-sea.exe (
  echo ReforgerServerManager-sea.exe nao encontrado.
  pause
  exit /b 1
)

ReforgerServerManager-sea.exe
echo.
echo O executavel SEA terminou. Pressione uma tecla para fechar.
pause >nul
