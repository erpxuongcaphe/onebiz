# Changes the next launch only. Never stops an agent or touches a print credential.
param([Parameter(Mandatory=$true)][Guid]$PointId)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'autostart.ps1')
$taskName = 'Onebiz Print Point ' + $PointId.ToString()
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Actions.Count -ne 1 -or $task.Actions[0].WorkingDirectory.TrimEnd('\') -ne $PSScriptRoot.TrimEnd('\')) {
  throw 'Task does not belong to this print folder. No changes made.'
}
$newAction = New-OnebizHiddenPrintAction -Root $PSScriptRoot
$backupPath = Join-Path $PSScriptRoot ('autostart-backup-'+[Guid]::NewGuid().ToString('N')+'.xml')
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backupPath -Encoding Unicode
$task.Settings.StartWhenAvailable = $true
Set-ScheduledTask -TaskName $taskName -Action $newAction -Settings $task.Settings | Out-Null
Write-Output 'Updated next launch to hidden host. Current receiver was not stopped or restarted.'
Write-Output ('Task backup: '+$backupPath)
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
