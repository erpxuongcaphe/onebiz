$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$configPath = Join-Path $PSScriptRoot 'onebiz-print-point.json'
$pointConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($pointConfig.pointId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid print-point configuration.' }
$taskName = 'Onebiz Print Point ' + $pointConfig.pointId
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'This point already has a task. Check it in Task Scheduler before installing again.' }
$currentAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcherPath = Join-Path $PSScriptRoot 'run.ps1'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $launcherPath + '"') -WorkingDirectory $PSScriptRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentAccount
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentAccount -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Onebiz print point registered. Keep this Windows account signed in and verify the task after restart.'
