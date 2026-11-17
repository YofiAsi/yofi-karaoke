@echo off
rem Opens a terminal window that runs party mode; closing that window stops the server.
where pwsh >nul 2>nul && (set "PS=pwsh") || (set "PS=powershell")
start "Yofi Karaoke" %PS% -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\party\launch.ps1" %*
