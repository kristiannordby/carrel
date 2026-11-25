@echo off
rem Double-click to install Carrel (or to repair or change its settings later).
cd /d "%~dp0"
title Install Carrel
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
  echo.
  echo  Python is not installed. Install Python 3 from https://www.python.org/downloads/
  echo  and tick "Add python.exe to PATH" on the first screen of the installer. Then run this again.
  echo.
  pause
  exit /b 1
)
%PY% install.py %*
echo.
pause
