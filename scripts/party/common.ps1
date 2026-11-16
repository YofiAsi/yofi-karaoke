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

function Get-PartyPaths([string]$DataDir) {
    [pscustomobject]@{
        Data       = $DataDir
        UvDir      = Join-Path $DataDir "uv"
        UvCache    = Join-Path $DataDir "cache\uv"
        Pythons    = Join-Path $DataDir "python"
        Venv       = Join-Path $DataDir "venv"
        VenvPython = Join-Path $DataDir "venv\Scripts\python.exe"
        VenvBin    = Join-Path $DataDir "venv\Scripts"
        Models     = Join-Path $DataDir "models"
        Stems      = Join-Path $DataDir "stems"
        Tmp        = Join-Path $DataDir "tmp"
        PgData     = Join-Path $DataDir "postgres"
        Logs       = Join-Path $DataDir "logs"
        Secrets    = Join-Path $DataDir "secrets"
        Run        = Join-Path $DataDir "run"
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
