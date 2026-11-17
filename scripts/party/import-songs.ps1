# Adds a list of YouTube videos to the party mode library and starts processing them. Run it while party mode is running.
param(
    [Parameter(Mandatory = $true)][string]$ListFile,
    [string]$DataDir,
    [string]$ToolsDir,
    [int]$PgPort = 54329
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $DataDir
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $ToolsDir $ResolvedData)
$Importer = Join-Path $RepoRoot "apps\api\dist\scripts\importSongs.js"

if (-not (Test-Path $ListFile)) { Stop-WithError "The list file $ListFile was not found." }
if (-not (Test-Path $Importer)) { Stop-WithError "The importer is not built yet. Start party mode once with scripts\party\start.ps1, then run this again." }

$env:DATABASE_URL = "postgresql://karaoke@127.0.0.1:${PgPort}/karaoke"
$env:STORAGE_DRIVER = "fs"
$env:STORAGE_DIR = $Paths.Stems
$env:YTDLP_BIN = $Paths.YtDlp
$env:YTDLP_JS_RUNTIMES = "node"
$env:HOST_PIN = "unused-by-the-importer"

& (Find-Command "node") $Importer (Resolve-Path $ListFile).Path
exit $LASTEXITCODE
