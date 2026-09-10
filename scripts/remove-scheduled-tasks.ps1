[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$taskNames = @('DeedLamp-AgentC-Retry', 'DeedLamp-Shorts', 'DeedLamp-LongForm')

foreach ($taskName in $taskNames) {
    if (-not $Apply) {
        Write-Host "Would check for and remove $taskName. Re-run with -Apply to use Task Scheduler."
        continue
    }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "$taskName is not registered."
        continue
    }
    if ($PSCmdlet.ShouldProcess($taskName, 'Unregister local Windows scheduled task')) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed $taskName."
    }
}
