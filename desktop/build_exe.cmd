@echo off
rem Builds Carrel.exe into the folder above this one. Only needed again if desktop\carrel_desktop.py changes or
rem Python is upgraded; edits to app\, build\ and server.py are picked up by the existing exe on its next start.
setlocal
set ROOT=%~dp0..
set WORK=%TEMP%\cbuild
if not exist "%WORK%\venv\Scripts\python.exe" (
  python -m venv "%WORK%\venv" || exit /b 1
  "%WORK%\venv\Scripts\python" -m pip install -q pywebview pyinstaller pypdf || exit /b 1
)
"%WORK%\venv\Scripts\python" -m PyInstaller --noconfirm --clean --onefile --windowed --name Carrel ^
  --icon "%~dp0carrel.ico" --workpath "%WORK%\work" --specpath "%WORK%" --distpath "%WORK%\dist" ^
  --exclude-module server --exclude-module build_courses --exclude-module vault_sources --exclude-module config ^
  "%~dp0carrel_desktop.py" || exit /b 1
copy /y "%WORK%\dist\Carrel.exe" "%ROOT%\Carrel.exe" >nul && echo Built %ROOT%\Carrel.exe
