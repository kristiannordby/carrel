@echo off
rem Turns off the Tailscale address for Carrel. The phone app keeps working offline from its saved copy.
title Stop sharing Carrel
set TS=tailscale
where tailscale >nul 2>nul || set TS="%ProgramFiles%\Tailscale\tailscale.exe"
%TS% serve reset && echo Carrel is no longer shared. && pause
