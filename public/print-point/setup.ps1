$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
. (Join-Path $PSScriptRoot 'autostart.ps1')
$configPath = Join-Path $PSScriptRoot 'onebiz-print-point.json'
$pointConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($pointConfig.pointId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid print-point configuration.' }
$taskName = 'Onebiz Print Point ' + $pointConfig.pointId
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'This point already has a task. Check it in Task Scheduler before installing again.' }
$nodePath = Install-OnebizRuntime
$currentAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-OnebizHiddenPrintAction -Root $PSScriptRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentAccount
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentAccount -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Onebiz print point registered. Keep this Windows account signed in and verify the task after restart.'
