# Installs the GPU Python environment for party mode into the data directory.
param(
    [string]$DataDir,
    [string]$ToolsDir
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $DataDir
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $ToolsDir $ResolvedData)
$Requirements = Join-Path $RepoRoot "apps\worker\python\requirements.nvidia.txt"
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

function Install-PostgresServer {
    if (Find-PostgresBin $Paths) { return }
    Write-Step "Downloading PostgreSQL server binaries into $($Paths.PgSql) (about 325 MB)"
    $zip = Join-Path $Paths.Tools "postgresql-binaries.zip"
    $staging = Join-Path $Paths.Tools "pgsql-staging"
    Invoke-WebRequest -Uri $PostgresZipUrl -OutFile $zip -UseBasicParsing
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $staging
    Move-Item (Join-Path $staging "pgsql") $Paths.PgSql
    Remove-Item $staging, $zip -Recurse -Force
    if (-not (Find-PostgresBin $Paths)) { Stop-WithError "PostgreSQL binaries were extracted but initdb was not found in $($Paths.PgSql)" }
}

function Test-GpuProvider {
    Write-Step "Checking that onnxruntime sees the CUDA provider"
    $check = Join-Path $RepoRoot "apps\worker\python\cuda_probe.py"
    Invoke-Checked $Paths.VenvPython @($check)
}

foreach ($dir in @($Paths.UvCache, $Paths.Pythons, $Paths.Models)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Set-UvEnvironment $Paths
$uv = Get-Uv
New-Venv $uv
Install-Requirements $uv
Test-GpuProvider
Install-PostgresServer
Write-Step "Setup complete. Data directory: $($Paths.Data)"
