@echo off
rem Puts a Carrel shortcut in your Startup folder, so Carrel (and phone sync) is running whenever the PC is on.
rem Undo: delete "Carrel.lnk" from the folder this opens at the end.
title Start Carrel when I sign in
set EXE=%~dp0..\Carrel.exe
for %%i in ("%EXE%") do set EXE=%%~fi
if not exist "%EXE%" ( echo Carrel.exe was not found next to this folder. & pause & exit /b 1 )
powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut([Environment]::GetFolderPath('Startup') + '\Carrel.lnk'); $s.TargetPath = '%EXE%'; $s.WorkingDirectory = (Split-Path '%EXE%'); $s.WindowStyle = 7; $s.Save()"
echo Carrel will now start when you sign in to Windows.
explorer shell:startup
pause
