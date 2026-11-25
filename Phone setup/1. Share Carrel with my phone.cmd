@echo off
rem Makes Carrel reachable from your own devices through Tailscale (private to your tailnet, HTTPS), and shows the address.
title Share Carrel with my phone
setlocal enabledelayedexpansion
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" for /f "delims=" %%p in ('where tailscale 2^>nul') do set "TS=%%p"
if not exist "%TS%" (
  echo.
  echo  Tailscale is not installed on this PC yet.
  echo  Install it from https://tailscale.com/download/windows , sign in, then run this again.
  echo.
  pause
  exit /b 1
)
"%TS%" status >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Tailscale is installed but not signed in. Click the Tailscale icon near the clock, sign in, then run this again.
  echo.
  pause
  exit /b 1
)
rem forward https://<this pc>.<tailnet>.ts.net to Carrel on port 8765, in the background, and keep it across restarts
"%TS%" serve --bg 8765
if errorlevel 1 (
  echo.
  echo  Tailscale could not share Carrel. If it printed a link about enabling HTTPS, open that link,
  echo  click Enable, and run this again.
  echo.
  pause
  exit /b 1
)
set "URL="
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "$s = & $env:TS status --json | ConvertFrom-Json; 'https://' + $s.Self.DNSName.TrimEnd('.')"`) do set "URL=%%u"
echo !URL!| clip
echo.
echo  ============================================================
echo   Carrel is shared with your own devices at:
echo.
echo     !URL!
echo.
echo   (also copied to the clipboard)
echo   Keep Carrel open on this PC: your phone syncs through it.
echo  ============================================================
echo.
pause
