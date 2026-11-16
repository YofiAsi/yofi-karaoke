# Installs the GPU Python environment for party mode into the data directory.
param(
    [string]$DataDir,
    [string]$ToolsDir,
    [string]$PostgresBin,
    [switch]$DownloadPostgres
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $DataDir
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $ToolsDir $ResolvedData)
$PythonDir = Join-Path $RepoRoot "apps\worker\python"
$Requirements = Join-Path $PythonDir "requirements.nvidia.txt"
$TranscribeRequirements = Join-Path $PythonDir "requirements.transcribe.txt"
$TranscribeOverrides = Join-Path $PythonDir "transcribe-overrides.txt"
$PostgresZipUrl = "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip"

function Install-Uv {
    Write-Step "Installing uv into $($Paths.UvDir)"
    $env:UV_UNMANAGED_INSTALL = $Paths.UvDir
    $installer = Invoke-RestMethod -Uri "https://astral.sh/uv/install.ps1"
    Invoke-Expression $installer
    Remove-Item Env:\UV_UNMANAGED_INSTALL
}

function Get-Uv {
    $uv = Find-Uv $Paths
    if (-not $uv) {
        Install-Uv
        $uv = Find-Uv $Paths
    }
    if (-not $uv) { Stop-WithError "uv could not be installed" }
    return $uv
}

function New-Venv([string]$Uv) {
    if (Test-Path $Paths.VenvPython) { return }
    Write-Step "Creating Python 3.12 venv in $($Paths.Venv)"
    Invoke-Checked $Uv @("venv", $Paths.Venv, "--python", "3.12")
}

function Install-Requirements([string]$Uv) {
    Write-Step "Installing worker GPU requirements (first run downloads several GB)"
    Invoke-Checked $Uv @(
        "pip", "install",
        "--python", $Paths.VenvPython,
        "--index-strategy", "unsafe-best-match",
        "-r", $Requirements
    )
}

function Install-TranscribeRequirements([string]$Uv) {
    Write-Step "Installing faster-whisper for automatic lyrics (keeps onnxruntime-gpu in place)"
    Invoke-Checked $Uv @(
        "pip", "install",
        "--python", $Paths.VenvPython,
        "-r", $TranscribeRequirements,
        "--overrides", $TranscribeOverrides
    )
}

function Install-WhisperModels {
    Write-Step "Fetching the Whisper models into $($Paths.Models) (about 3.2 GB on the first run)"
    $env:HF_HUB_DISABLE_TELEMETRY = "1"
    Invoke-Checked $Paths.VenvPython @((Join-Path $PythonDir "fetch_whisper_models.py"), "--model-dir", $Paths.Models)
}

function Test-WhisperGpu {
    Write-Step "Checking that both Whisper models run on CUDA"
    Invoke-Checked $Paths.VenvPython @((Join-Path $PythonDir "ct2_probe.py"), "--model-dir", $Paths.Models)
}

function Use-ProvidedPostgres([string]$Bin) {
    $full = (Resolve-Path $Bin -ErrorAction SilentlyContinue).Path
    if (-not (Test-PostgresServerBin $full)) {
        Stop-WithError "$Bin is not a PostgreSQL server bin folder (initdb.exe, pg_ctl.exe and ..\share\postgres.bki are required)"
    }
    Set-Content -Path $Paths.PgBinFile -Value $full -NoNewline -Encoding utf8
    Write-Step "Using PostgreSQL server binaries from $full"
}

function Show-PostgresChoices {
    Write-Host "PostgreSQL server binaries were not found (an install with only the command line tools is not enough)." -ForegroundColor Yellow
    Write-Host "Pick one and rerun setup:"
    Write-Host "  scripts\party\setup.ps1 -PostgresBin <folder with initdb.exe>"
    Write-Host "  scripts\party\setup.ps1 -DownloadPostgres   (official EDB zip, about 325 MB, into $($Paths.PgSql))"
}

function Remove-PostgresExtras {
    foreach ($extra in @("pgAdmin 4", "StackBuilder", "doc", "include")) {
        Remove-Item (Join-Path $Paths.PgSql $extra) -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Install-PostgresServer {
    if ($PostgresBin) { Use-ProvidedPostgres $PostgresBin; return }
    $found = Find-PostgresBin $Paths
    if ($found) { Write-Step "PostgreSQL server binaries: $found"; return }
    if (-not $DownloadPostgres) { Show-PostgresChoices; return }
    Write-Step "Downloading PostgreSQL server binaries into $($Paths.PgSql) (about 325 MB)"
    $zip = Join-Path $Paths.Tools "postgresql-binaries.zip"
    $staging = Join-Path $Paths.Tools "pgsql-staging"
    Invoke-WebRequest -Uri $PostgresZipUrl -OutFile $zip -UseBasicParsing
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $staging
    Move-Item (Join-Path $staging "pgsql") $Paths.PgSql
    Remove-Item $staging, $zip -Recurse -Force
    Remove-PostgresExtras
    if (-not (Find-PostgresBin $Paths)) { Stop-WithError "PostgreSQL binaries were extracted but initdb was not found in $($Paths.PgSql)" }
}

function Test-GpuProvider {
    Write-Step "Checking that onnxruntime sees the CUDA provider"
    $check = Join-Path $PythonDir "cuda_probe.py"
    Invoke-Checked $Paths.VenvPython @($check)
}

foreach ($dir in @($Paths.UvCache, $Paths.Pythons, $Paths.Models)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Set-UvEnvironment $Paths
$uv = Get-Uv
New-Venv $uv
Install-Requirements $uv
Install-TranscribeRequirements $uv
Test-GpuProvider
Install-WhisperModels
Test-WhisperGpu
Install-PostgresServer
if (-not (Find-PostgresBin $Paths)) { Stop-WithError "Python setup is done, PostgreSQL is still missing (see above)" }
Write-Step "Setup complete. Data directory: $($Paths.Data)"
