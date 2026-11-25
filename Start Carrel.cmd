@echo off
cd /d "%~dp0"
title Carrel
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (echo Python 3 is needed: https://www.python.org/downloads/ & pause & exit /b 1)
rem pick up edits to your practice sets and exam questions in the vault (a few seconds; on failure the last build is kept)
echo Reading your practice notes from the vault...
pushd build
%PY% build_courses.py >nul 2>nul || echo Could not refresh the question sets; starting with the last build.
popd
%PY% server.py
pause
