@echo off
cd /d "%~dp0build"
title Carrel rebuild
set PY=python
where python >nul 2>nul || set PY=py
echo Re-reading lecture PDFs, decks and the planner from the vault...
%PY% extract_slides.py || goto :fail
%PY% build_courses.py || goto :fail
%PY% vault_sources.py || goto :fail
echo.
echo Done. Reload Carrel in the browser.
pause
exit /b 0
:fail
echo.
echo The rebuild stopped with an error (see above).
pause
exit /b 1
