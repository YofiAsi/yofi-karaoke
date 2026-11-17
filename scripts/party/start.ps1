# Starts the whole karaoke stack natively on this PC: private Postgres, api, worker and web; Ctrl+C stops everything.
param(
    [string]$DataDir,
    [string]$ToolsDir,
    [string]$PostgresBin,
    [switch]$Tunnel,
    [int]$WebPort = 3000,
    [int]$ApiPort = 4100,
    [int]$PgPort = 54329
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $DataDir
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $ToolsDir $ResolvedData)
$PgUser = "karaoke"
$PgDb = "karaoke"
$DatabaseUrl = "postgresql://${PgUser}@127.0.0.1:${PgPort}/${PgDb}"
$ApiUrl = "http://127.0.0.1:$ApiPort"
$WebUrl = "http://127.0.0.1:$WebPort"
$script:Children = New-Object System.Collections.ArrayList
$script:PgBin = $null

function Resolve-PostgresBin {
    if (-not $PostgresBin) { return (Find-PostgresBin $Paths) }
    if (Test-PostgresServerBin $PostgresBin) { return (Resolve-Path $PostgresBin).Path }
    return $null
}

function Assert-Prerequisites {
    Write-Step "Checking prerequisites"
    $problems = New-Object System.Collections.ArrayList
    if (-not (Find-Command "node")) { [void]$problems.Add("Node.js is not on PATH. Install Node 20 or newer.") }
    if (-not (Find-Command "corepack")) { [void]$problems.Add("corepack is not on PATH. It ships with Node.js.") }
    if (-not (Find-Command "ffmpeg")) { [void]$problems.Add("ffmpeg is not on PATH. Install it, for example with: winget install Gyan.FFmpeg.Essentials") }
    $script:PgBin = Resolve-PostgresBin
    if (-not $script:PgBin) { [void]$problems.Add("PostgreSQL server binaries were not found. Run scripts\party\setup.ps1, which downloads them into $($Paths.PgSql).") }
    if (-not (Test-Path $Paths.VenvPython)) { [void]$problems.Add("The GPU Python environment is missing in $($Paths.Venv). Run scripts\party\setup.ps1 first.") }
    if (-not (Test-Path $Paths.YtDlp)) { [void]$problems.Add("yt-dlp is missing from $($Paths.VenvBin). Run scripts\party\setup.ps1 again.") }
    if (-not (Test-WhisperModels)) { Write-Host "Whisper models are missing from $($Paths.Models); songs without lyrics stay without them until setup.ps1 runs again." -ForegroundColor Yellow }
    if ($Tunnel -and -not (Find-Cloudflared)) { [void]$problems.Add("-Tunnel needs cloudflared. Install it with: winget install Cloudflare.cloudflared") }
    foreach ($port in @($WebPort, $ApiPort, $PgPort)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            [void]$problems.Add("Port $port is already in use. Run scripts\party\stop.ps1 or pick another port.")
        }
    }
    if ($problems.Count -gt 0) {
        $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        Stop-WithError "Prerequisites missing"
    }
}

function Test-WhisperModels {
    foreach ($name in @("whisper-ivrit-turbo", "whisper-turbo")) {
        if (-not (Test-Path (Join-Path $Paths.Models "$name\model.bin"))) { return $false }
    }
    return $true
}

function Assert-NotRunning {
    $alive = @(Read-ProcessList $Paths | Where-Object { Test-SameProcess $_ })
    if ($alive.Count -gt 0) { Stop-WithError "Party mode already runs from $($Paths.Data). Stop it first with scripts\party\stop.ps1" }
}

function New-Secret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes)
}

function Get-StoredValue([string]$Name, [scriptblock]$Create) {
    $file = Join-Path $Paths.Secrets $Name
    if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
    $value = & $Create
    Set-Content -Path $file -Value $value -NoNewline -Encoding ascii
    return $value
}

function Read-HostPin {
    if ($env:YOFI_HOST_PIN) { return $env:YOFI_HOST_PIN }
    while ($true) {
        $pin = Read-Host "Choose the host PIN (6 to 64 characters, asked only once)"
        if ($pin.Length -ge 6 -and $pin.Length -le 64) { return $pin }
        Write-Host "The PIN must be 6 to 64 characters long." -ForegroundColor Yellow
    }
}

function Initialize-Folders {
    foreach ($dir in @($Paths.Stems, $Paths.Tmp, $Paths.Logs, $Paths.Secrets, $Paths.Run, $Paths.Models)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

function Initialize-Postgres {
    if (Test-Path (Join-Path $Paths.PgData "PG_VERSION")) { return }
    Write-Step "Creating a private Postgres cluster in $($Paths.PgData)"
    $initdb = Join-Path $script:PgBin "initdb.exe"
    Invoke-Checked $initdb @("-D", $Paths.PgData, "-U", $PgUser, "-A", "trust", "-E", "UTF8", "--locale=C")
    $settings = @(
        "",
        "listen_addresses = '127.0.0.1'",
        "port = $PgPort",
        "max_connections = 50"
    )
    Add-Content -Path (Join-Path $Paths.PgData "postgresql.conf") -Value $settings -Encoding ascii
}

function Start-Postgres {
    Write-Step "Starting the private Postgres cluster on 127.0.0.1:$PgPort"
    $log = Join-Path $script:RunLogs "postgres.log"
    Invoke-Checked (Join-Path $script:PgBin "pg_ctl.exe") @("-D", $Paths.PgData, "-l", $log, "-w", "start")
    $psql = Join-Path $script:PgBin "psql.exe"
    $exists = & $psql -h 127.0.0.1 -p $PgPort -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$PgDb'"
    if ($exists -ne "1") { Invoke-Checked (Join-Path $script:PgBin "createdb.exe") @("-h", "127.0.0.1", "-p", "$PgPort", "-U", $PgUser, $PgDb) }
}

function Invoke-Pnpm([string[]]$Arguments) {
    & corepack pnpm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Get-BuildStamp {
    Push-Location $RepoRoot
    try {
        $head = (& git rev-parse HEAD 2>$null)
        $dirty = (& git status --porcelain --untracked-files=no 2>$null) -join "`n"
    } finally { Pop-Location }
    return "$head|$dirty|$ApiUrl"
}

function Test-BuildOutputs {
    $outputs = @("packages\shared\dist", "apps\api\dist\index.js", "apps\worker\dist\index.js", "apps\web\.next\BUILD_ID")
    foreach ($output in $outputs) {
        if (-not (Test-Path (Join-Path $RepoRoot $output))) { return $false }
    }
    return $true
}

function Invoke-BuildIfStale {
    $stampFile = Join-Path $RepoRoot "node_modules\.party-build-stamp"
    $stamp = Get-BuildStamp
    $current = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { "" }
    if ((Test-BuildOutputs) -and $current -eq $stamp.Trim()) {
        Write-Step "Build is up to date"
        return
    }
    Push-Location $RepoRoot
    try {
        Write-Step "Building shared, api, worker and web (takes a minute or two)"
        $env:API_INTERNAL_URL = $ApiUrl
        $env:NEXT_PUBLIC_API_URL = "/api"
        $env:NEXT_PUBLIC_WS_URL = "same-origin"
        Invoke-Pnpm @("--filter", "@karaoke/shared", "build")
        Invoke-Pnpm @("--filter", "api", "build")
        Invoke-Pnpm @("--filter", "worker", "build")
        Invoke-Pnpm @("--filter", "web", "build")
    } finally { Pop-Location }
    Set-Content -Path $stampFile -Value $stamp -NoNewline -Encoding utf8
}

function Install-NodeModules {
    if (Test-Path (Join-Path $RepoRoot "node_modules\.pnpm")) { return }
    Write-Step "Installing Node dependencies"
    Push-Location $RepoRoot
    try { Invoke-Pnpm @("install", "--frozen-lockfile") } finally { Pop-Location }
}

function Test-RomajiPackages {
    & $Paths.VenvPython -c "import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(n) for n in ('pykakasi', 'cutlet', 'fugashi', 'unidic_lite')) else 1)"
    return $LASTEXITCODE -eq 0
}

function Install-RomajiPackages {
    if (Test-RomajiPackages) { return }
    $uv = Find-Uv $Paths
    if (-not $uv) { Write-Host "uv was not found, so the romaji packages were not checked." -ForegroundColor Yellow; return }
    Set-UvEnvironment $Paths
    & $uv pip install --quiet --python $Paths.VenvPython -r (Join-Path $RepoRoot "apps\worker\python\requirements.romaji.txt")
    if ($LASTEXITCODE -ne 0) { Write-Host "The romaji packages could not be installed; Japanese lyrics stay in Japanese script." -ForegroundColor Yellow }
}

function Invoke-Migrations {
    Write-Step "Applying database migrations"
    Push-Location (Join-Path $RepoRoot "apps\api")
    try { Invoke-Pnpm @("exec", "prisma", "migrate", "deploy") } finally { Pop-Location }
}

function Set-CommonEnvironment([string]$HostPin, [string]$SessionSecret) {
    $env:NODE_ENV = "production"
    $env:DATABASE_URL = $DatabaseUrl
    $env:STORAGE_DRIVER = "fs"
    $env:STORAGE_DIR = $Paths.Stems
    $env:YTDLP_BIN = $Paths.YtDlp
    $env:PATH = "$($Paths.VenvBin);$env:PATH"
    $env:HOST = "127.0.0.1"
    $env:PORT = "$ApiPort"
    $env:HOST_PIN = $HostPin
    $env:SESSION_SECRET = $SessionSecret
    $env:SEPARATOR_BACKEND = "cuda"
    $env:PYTHON_BIN = $Paths.VenvPython
    $env:AUDIO_SEP_MODEL_DIR = $Paths.Models
    $env:TRANSCRIBE_BACKEND = "cuda"
    $env:WHISPER_MODEL_DIR = $Paths.Models
    $env:WORKER_TMP_DIR = $Paths.Tmp
    $env:YTDLP_JS_RUNTIMES = "node"
    $env:PYTHONUTF8 = "1"
    $env:API_INTERNAL_URL = $ApiUrl
}

function Start-Child([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$WorkDir) {
    $out = Join-Path $script:RunLogs "$Name.log"
    $err = Join-Path $script:RunLogs "$Name.err.log"
    $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $WorkDir `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
    $started = $process.StartTime.ToUniversalTime().Ticks
    [void]$script:Children.Add([pscustomobject]@{ name = $Name; pid = $process.Id; started = $started; process = $process; log = $out; err = $err })
    Save-ProcessList
    return $process
}

function Save-ProcessList {
    $list = @($script:Children | ForEach-Object { [pscustomobject]@{ name = $_.name; pid = $_.pid; started = $_.started } })
    ConvertTo-Json -InputObject $list | Set-Content -Path $Paths.PidFile -Encoding utf8
}

function Start-AppProcesses {
    $node = Find-Command "node"
    $next = Join-Path $RepoRoot "apps\web\node_modules\next\dist\bin\next"
    Write-Step "Starting api, worker and web"
    Start-Child "api" $node @("dist\index.js") (Join-Path $RepoRoot "apps\api") | Out-Null
    Start-Child "worker" $node @("dist\index.js") (Join-Path $RepoRoot "apps\worker") | Out-Null
    Start-Child "web" $node @("`"$next`"", "start", "-p", "$WebPort", "-H", "0.0.0.0") (Join-Path $RepoRoot "apps\web") | Out-Null
}

function Test-Url([string]$Url) {
    try {
        $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return $res.StatusCode -eq 200
    } catch { return $false }
}

function Get-ExitedChild {
    return ($script:Children | Where-Object { $_.process.HasExited } | Select-Object -First 1)
}

function Show-ChildFailure($Child) {
    $code = $Child.process.ExitCode
    $how = if ($null -eq $code) { "stopped" } else { "exited with code $code" }
    Write-Host "$($Child.name) $how. Last log lines:" -ForegroundColor Red
    foreach ($file in @($Child.err, $Child.log)) {
        if (Test-Path $file) { Get-Content $file -Tail 20 | ForEach-Object { Write-Host "  $_" } }
    }
}

function Wait-Ready([string]$Name, [string]$Url, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Url $Url) { return }
        $exited = Get-ExitedChild
        if ($exited) {
            Show-ChildFailure $exited
            throw "$($exited.name) stopped during startup"
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not answer on $Url within $TimeoutSeconds seconds"
}

function Get-LanAddresses {
    $configs = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" }
    return @($configs | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -and $_ -notlike "169.254.*" })
}

function Start-QuickTunnel {
    $cloudflared = Find-Cloudflared
    Write-Step "Starting a cloudflared quick tunnel"
    $child = Start-Child "tunnel" $cloudflared @("tunnel", "--no-autoupdate", "--url", "http://localhost:$WebPort") $RepoRoot
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        $entry = $script:Children | Where-Object { $_.name -eq "tunnel" }
        $match = Select-String -Path $entry.err -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { return (Wait-PublicDns $match.Matches[0].Value) }
        if ($child.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "The tunnel did not report a public URL; see $($entry.err)" -ForegroundColor Yellow
    return $null
}

function Test-PublicDns([string]$HostName) {
    try {
        return [bool](Resolve-DnsName -Name $HostName -Server "1.1.1.1" -DnsOnly -QuickTimeout -ErrorAction Stop)
    } catch { return $false }
}

function Wait-PublicDns([string]$Url) {
    $hostName = ([Uri]$Url).Host
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (Test-PublicDns $hostName) { return $Url }
        Start-Sleep -Seconds 2
    }
    Write-Host "The public name is not resolvable yet; give it a minute before sharing it." -ForegroundColor Yellow
    return $Url
}

function Show-Urls([string]$PublicUrl) {
    Write-Host ""
    Write-Host "Karaoke is running." -ForegroundColor Green
    Write-Host "  This PC:      http://localhost:$WebPort"
    foreach ($ip in Get-LanAddresses) { Write-Host "  Same WiFi:    http://${ip}:$WebPort" }
    if ($PublicUrl) { Write-Host "  Remote guests: $PublicUrl" }
    Write-Host "  Logs:         $script:RunLogs"
    Write-Host "  Host PIN:     stored in $(Join-Path $Paths.Secrets 'host-pin.txt')"
    Write-Host "Press Ctrl+C to stop everything."
}

function Remove-Child($Child) {
    $script:Children.Remove($Child)
    Save-ProcessList
}

function Wait-UntilChildExits {
    while ($true) {
        $exited = Get-ExitedChild
        if ($exited -and $exited.name -eq "tunnel") {
            Write-Host "The tunnel stopped; guests on the same WiFi can keep singing. Restart with -Tunnel for a new public URL." -ForegroundColor Yellow
            Remove-Child $exited
        } elseif ($exited) {
            Show-ChildFailure $exited
            return
        }
        Start-Sleep -Seconds 1
    }
}

function Stop-Everything {
    Write-Step "Stopping api, worker, web and tunnel"
    foreach ($child in @($script:Children)) { Stop-Tree $child.pid }
    if ($script:PgBin) { Stop-PrivatePostgres $Paths $script:PgBin }
    Remove-Item $Paths.PidFile -ErrorAction SilentlyContinue
    Write-Step "Stopped"
}

Assert-Prerequisites
Assert-NotRunning
Initialize-Folders
$script:RunLogs = Join-Path $Paths.Logs (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $script:RunLogs | Out-Null
$sessionSecret = Get-StoredValue "session-secret.txt" { New-Secret }
$hostPin = Get-StoredValue "host-pin.txt" { Read-HostPin }
Install-NodeModules
Install-RomajiPackages
Invoke-BuildIfStale
Initialize-Postgres

try {
    Start-Postgres
    Set-CommonEnvironment $hostPin $sessionSecret
    Invoke-Migrations
    Start-AppProcesses
    Wait-Ready "api" "$ApiUrl/api/health" 60
    Wait-Ready "web" $WebUrl 90
    $publicUrl = if ($Tunnel) { Start-QuickTunnel } else { $null }
    Show-Urls $publicUrl
    Wait-UntilChildExits
} finally {
    Stop-Everything
}
