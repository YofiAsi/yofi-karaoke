# Double click entry point for party mode: shows live logs, keeps a terminal log and stops the stack when this window closes.
param(
    [switch]$NoTunnel
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $null
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $null $ResolvedData)

function Test-PartyRunning {
    return @(Read-ProcessList $Paths | Where-Object { Test-SameProcess $_ }).Count -gt 0
}

function Start-TerminalLog {
    New-Item -ItemType Directory -Force -Path $Paths.Logs | Out-Null
    $file = Join-Path $Paths.Logs "launcher-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    Start-Transcript -Path $file | Out-Null
    Write-Host "Terminal log: $file"
}

function Start-CloseWatcher {
    $shell = (Get-Process -Id $PID).Path
    $watcher = Join-Path $PSScriptRoot "stop-when-closed.ps1"
    Start-Process -FilePath $shell -WindowStyle Hidden `
        -ArgumentList @("-NoProfile", "-File", "`"$watcher`"", "-LauncherPid", "$PID")
}

function Test-TunnelWanted {
    if ($NoTunnel) { return $false }
    if (Find-Cloudflared) { return $true }
    Write-Host "cloudflared is not installed, so this run is local only. Install it with: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
    return $false
}

function Wait-BeforeClosing {
    Write-Host ""
    Read-Host "Press Enter to close this window" | Out-Null
}

$Host.UI.RawUI.WindowTitle = "Yofi Karaoke (close this window to stop)"
if (Test-PartyRunning) {
    Write-Host "Karaoke already runs in another window." -ForegroundColor Yellow
    Wait-BeforeClosing
    exit 1
}
Start-TerminalLog
Start-CloseWatcher
& (Join-Path $PSScriptRoot "start.ps1") -ShowLogs -Tunnel:(Test-TunnelWanted)
Wait-BeforeClosing
