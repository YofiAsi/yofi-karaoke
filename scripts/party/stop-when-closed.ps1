# Waits for the launcher window to go away, then stops party mode.
param(
    [Parameter(Mandatory)][int]$LauncherPid
)

Wait-Process -Id $LauncherPid -ErrorAction SilentlyContinue
& (Join-Path $PSScriptRoot "stop.ps1")
