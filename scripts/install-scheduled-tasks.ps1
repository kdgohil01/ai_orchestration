[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('DryRun', 'LocalOnly', 'Publish')]
    [string]$Mode = 'DryRun',

    [switch]$Apply,
    [switch]$AllowPublish,
    [switch]$IncludeLong,

    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$ShortTime = '18:00',

    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$LongTime = '18:00'
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source

if ($Mode -eq 'Publish' -and -not $AllowPublish) {
    throw 'Publish scheduling requires both -Mode Publish and -AllowPublish. Review a complete dry run first.'
}

$modeArgument = switch ($Mode) {
    'DryRun' { '--dry-run' }
    'LocalOnly' { '--skip-upload' }
    'Publish' { '--publish' }
}

$taskDefinitions = @(
    [pscustomobject]@{
        Name = 'DeedLamp-AgentC-Retry'
        Description = 'Runs deterministic local retry checks. Upload-capable retries require manual review.'
        Script = 'orchestrator.js'
        Arguments = 'run-due'
        Schedule = 'Every 15 minutes, beginning five minutes after registration'
        TriggerType = 'Retry'
    },
    [pscustomobject]@{
        Name = 'DeedLamp-Shorts'
        Description = "Runs the DeedLamp Shorts agent in $Mode mode."
        Script = 'short.js'
        Arguments = $modeArgument
        Schedule = "Daily at $ShortTime local time"
        TriggerType = 'Daily'
        Time = $ShortTime
    }
)

if ($IncludeLong) {
    $taskDefinitions += [pscustomobject]@{
        Name = 'DeedLamp-LongForm'
        Description = "Runs the DeedLamp long-form agent weekly in $Mode mode."
        Script = 'long.js'
        Arguments = $modeArgument
        Schedule = "Weekly on Sunday at $LongTime local time"
        TriggerType = 'Weekly'
        Time = $LongTime
    }
}

if ($Apply) {
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
        -StartWhenAvailable
}

foreach ($definition in $taskDefinitions) {
    $scriptPath = Join-Path $projectDir $definition.Script
    $arguments = "`"$scriptPath`" $($definition.Arguments)"
    Write-Host "Task: $($definition.Name)"
    Write-Host "  Executable: $nodePath"
    Write-Host "  Arguments:  $arguments"
    Write-Host "  Working dir: $projectDir"
    Write-Host "  Schedule:   $($definition.Schedule)"
    if ($Apply) {
        $trigger = switch ($definition.TriggerType) {
            'Retry' {
                New-ScheduledTaskTrigger `
                    -Once `
                    -At (Get-Date).AddMinutes(5) `
                    -RepetitionInterval (New-TimeSpan -Minutes 15)
            }
            'Daily' { New-ScheduledTaskTrigger -Daily -At $definition.Time }
            'Weekly' { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $definition.Time }
        }
        $action = New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $projectDir
        if ($PSCmdlet.ShouldProcess($definition.Name, 'Register or update local Windows scheduled task')) {
            Register-ScheduledTask `
                -TaskName $definition.Name `
                -Description $definition.Description `
                -Action $action `
                -Trigger $trigger `
                -Settings $settings `
                -Force | Out-Null
            Write-Host "  Registered."
        }
    } else {
        Write-Host '  Preview only. Re-run with -Apply to register.'
    }
}
