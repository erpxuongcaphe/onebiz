# Run from the extracted public update. No print credentials are read or changed.
param([Parameter(Mandatory=$true)][Guid]$PointId,[Parameter(Mandatory=$true)][string]$TargetFolder)
$ErrorActionPreference='Stop'
$TargetFolder=[IO.Path]::GetFullPath($TargetFolder).TrimEnd('\')
$taskName='Onebiz Print Point '+$PointId.ToString()
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if($task.State -eq 'Disabled' -or $task.Actions.Count -ne 1 -or $task.Actions[0].WorkingDirectory.TrimEnd('\') -ne $TargetFolder){throw 'Task/folder mismatch or disabled task. Nothing changed.'}
$files=@('agent.mjs','usb-worker.mjs','OnebizUsbWorker.exe','OnebizUsbWorker.cs')
foreach($file in $files){if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot $file))){throw 'Update is incomplete. Nothing changed.'}}
$probeLog=Join-Path $PSScriptRoot 'native-probe.log'
$probe=Start-Process -FilePath (Join-Path $PSScriptRoot 'OnebizUsbWorker.exe') -ArgumentList '--probe' -WindowStyle Hidden -RedirectStandardOutput $probeLog -RedirectStandardError (Join-Path $PSScriptRoot 'native-probe-error.log') -PassThru
if(-not $probe.WaitForExit(10000)){$probe.Kill();throw 'Native probe timeout. Current receiver unchanged.'}
if($probe.ExitCode -ne 0 -or -not ((Get-Content -LiteralPath $probeLog -Raw | ConvertFrom-Json).ready)){throw 'Native worker blocked/not ready. Current receiver unchanged.'}
$backup=Join-Path $TargetFolder ('usb-backup-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($file in $files){$old=Join-Path $TargetFolder $file;if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination (Join-Path $backup $file)}}
# Check process diagnostics before stopping anything; no raw command line is logged.
$beforeAgents=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -OperationTimeoutSec 5 | Where-Object {$_.CommandLine -match 'agent\.mjs'})
Write-Output ('Program backup: '+$backup)
Stop-ScheduledTask -TaskName $taskName
$deadline=(Get-Date).AddSeconds(10)
while((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){
 if((Get-Date) -ge $deadline){throw 'Task is still running. No program replaced; do not start another receiver.'};Start-Sleep -Milliseconds 250
}
# Do not kill unrelated processes. Refuse to create a second receiver if a child survived.
$survivors=@($beforeAgents | ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue})
if($survivors.Count){throw 'A print agent remains running. No program replaced; do not start a second receiver.'}
try{
 foreach($file in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $TargetFolder $file) -Force}
 Start-ScheduledTask -TaskName $taskName
}catch{
 foreach($file in $files){$old=Join-Path $backup $file;$target=Join-Path $TargetFolder $file;if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination $target -Force}else{if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force}}}
 Start-ScheduledTask -TaskName $taskName
 throw
}
Write-Output 'Native USB program installed; existing hidden task restarted. No old print job replayed.'
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
