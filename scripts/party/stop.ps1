# Cleans up after party mode: stops leftover api, worker, web and tunnel processes and the private Postgres.
param(
    [string]$DataDir,
    [string]$ToolsDir
)

. (Join-Path $PSScriptRoot "common.ps1")

$ResolvedData = Resolve-DataDir $DataDir
$Paths = Get-PartyPaths $ResolvedData (Resolve-ToolsDir $ToolsDir $ResolvedData)

function Stop-RecordedProcesses {
    foreach ($entry in Read-ProcessList $Paths) {
        if (Test-SameProcess $entry) {
            Write-Step "Stopping $($entry.name) (pid $($entry.pid))"
            Stop-Tree $entry.pid
        }
    }
    Remove-Item $Paths.PidFile -ErrorAction SilentlyContinue
}

Stop-RecordedProcesses
$pgBin = Find-PostgresBin $Paths
if ($pgBin) { Stop-PrivatePostgres $Paths $pgBin }
Write-Step "Party mode is stopped"
