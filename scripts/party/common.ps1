# Shared helpers for the party mode scripts (dot sourced by setup, start and stop).

Set-StrictMode -Version 3
$ErrorActionPreference = "Stop"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Resolve-DataDir([string]$DataDir) {
    if (-not $DataDir) { $DataDir = $env:YOFI_DATA_DIR }
    if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA "yofi-karaoke" }
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    return (Resolve-Path $DataDir).Path
}

function Resolve-ToolsDir([string]$ToolsDir, [string]$DataDir) {
    if (-not $ToolsDir) { $ToolsDir = $env:YOFI_TOOLS_DIR }
    if (-not $ToolsDir) { return $DataDir }
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    return (Resolve-Path $ToolsDir).Path
}

function Get-PartyPaths([string]$DataDir, [string]$ToolsDir) {
    if (-not $ToolsDir) { $ToolsDir = $DataDir }
    [pscustomobject]@{
        Data       = $DataDir
        Tools      = $ToolsDir
        UvDir      = Join-Path $ToolsDir "uv"
        UvCache    = Join-Path $ToolsDir "cache\uv"
        Pythons    = Join-Path $ToolsDir "python"
        Venv       = Join-Path $ToolsDir "venv"
        VenvPython = Join-Path $ToolsDir "venv\Scripts\python.exe"
        VenvBin    = Join-Path $ToolsDir "venv\Scripts"
        YtDlp      = Join-Path $ToolsDir "venv\Scripts\yt-dlp.exe"
        Models     = Join-Path $ToolsDir "models"
        PgSql      = Join-Path $ToolsDir "pgsql"
        Stems      = Join-Path $DataDir "stems"
        Tmp        = Join-Path $DataDir "tmp"
        PgData     = Join-Path $DataDir "postgres"
        Logs       = Join-Path $DataDir "logs"
        Secrets    = Join-Path $DataDir "secrets"
        Run        = Join-Path $DataDir "run"
        PidFile    = Join-Path $DataDir "run\processes.json"
    }
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-WithError([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Find-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

function Find-Uv($Paths) {
    $local = Join-Path $Paths.UvDir "uv.exe"
    if (Test-Path $local) { return $local }
    return (Find-Command "uv")
}

function Set-UvEnvironment($Paths) {
    $env:UV_CACHE_DIR = $Paths.UvCache
    $env:UV_PYTHON_INSTALL_DIR = $Paths.Pythons
    $env:UV_PYTHON_PREFERENCE = "only-managed"
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-WithError "$Exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Test-PostgresServerBin([string]$Bin) {
    if (-not $Bin) { return $false }
    $hasTools = (Test-Path (Join-Path $Bin "initdb.exe")) -and (Test-Path (Join-Path $Bin "pg_ctl.exe"))
    return $hasTools -and (Test-Path (Join-Path $Bin "..\share\postgres.bki"))
}

function Get-PostgresBinCandidates($Paths) {
    $candidates = @(Join-Path $Paths.PgSql "bin")
    $initdb = Find-Command "initdb"
    if ($initdb) { $candidates += Split-Path $initdb }
    $installed = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\initdb.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    $candidates += @($installed | ForEach-Object { $_.DirectoryName })
    return $candidates
}

function Find-PostgresBin($Paths) {
    return (Get-PostgresBinCandidates $Paths | Where-Object { Test-PostgresServerBin $_ } | Select-Object -First 1)
}

function Find-Cloudflared {
    $onPath = Find-Command "cloudflared"
    if ($onPath) { return $onPath }
    $default = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $default) { return $default }
    return $null
}

function Test-Alive([int]$ProcessId) {
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-Tree([int]$ProcessId) {
    if (-not (Test-Alive $ProcessId)) { return }
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Read-ProcessList($Paths) {
    if (-not (Test-Path $Paths.PidFile)) { return @() }
    $parsed = ConvertFrom-Json (Get-Content $Paths.PidFile -Raw)
    return @($parsed)
}

function Test-SameProcess($Entry) {
    $process = Get-Process -Id $Entry.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    return $process.StartTime.ToUniversalTime().ToString("o") -eq $Entry.started
}

function Stop-PrivatePostgres($Paths, [string]$PgBin) {
    if (-not (Test-Path (Join-Path $Paths.PgData "postmaster.pid"))) { return }
    Write-Step "Stopping the private Postgres cluster"
    & (Join-Path $PgBin "pg_ctl.exe") -D $Paths.PgData -m fast -w stop 2>&1 | Out-Host
}
