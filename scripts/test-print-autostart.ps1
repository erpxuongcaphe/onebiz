# Fake scheduled tasks only; native Windows test launches a harmless fixture, never an agent.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '../.tmp') ('onebiz hidden test '+[Guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $root | Out-Null
foreach($name in @('start-hidden.vbs','autostart.ps1','update-autostart.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../public/print-point/'+$name)) -Destination (Join-Path $root $name)
}
Set-Content -LiteralPath (Join-Path $root 'run.ps1') -Value 'Set-Content -LiteralPath (Join-Path $PSScriptRoot "completed.txt") -Value "fixture"; Start-Sleep -Seconds 1; exit 27'
$nativeWindows=($env:OS -eq 'Windows_NT')
if($nativeWindows) {
  # Match the quầy account's RemoteSigned policy for this fixture process only.
  # Do not alter the machine or user's registry policy.
  $previousFixturePolicy=$env:PSExecutionPolicyPreference
  $env:PSExecutionPolicyPreference='RemoteSigned'
  try {
  $hostExe=Join-Path $env:SystemRoot 'System32\wscript.exe'
  $probe=Start-Process -FilePath $hostExe -ArgumentList @('//B','//NoLogo',('"'+(Join-Path $root 'start-hidden.vbs')+'"'),'/check') -WindowStyle Hidden -PassThru
  if(-not $probe.WaitForExit(10000) -or $probe.ExitCode -ne 0 -or (Test-Path (Join-Path $root 'completed.txt'))){throw 'Preflight launched fixture or failed'}
  $started=Get-Date
  $child=Start-Process -FilePath $hostExe -ArgumentList @('//B','//NoLogo',('"'+(Join-Path $root 'start-hidden.vbs')+'"')) -WindowStyle Hidden -PassThru
  if(-not $child.WaitForExit(15000)){ $child.Kill(); throw 'Fixture did not exit' }
  if($child.ExitCode -ne 27 -or -not (Test-Path (Join-Path $root 'completed.txt')) -or ((Get-Date)-$started).TotalSeconds -lt 1){throw 'GUI host failed wait, quoting or exit-code propagation'}
  Write-Output 'PASS native Windows GUI host: preflight launches nothing; hidden fixture with spaced path is awaited and exit 27 propagated.'
  } finally { $env:PSExecutionPolicyPreference=$previousFixturePolicy }
}
$global:HiddenPrintTest=@{sets=0;exitCode=0;backups=0}
if(-not $env:SystemRoot){$env:SystemRoot=$root}
function Test-Path { param($LiteralPath,$Path) return $true }
function Start-Process {
  param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
  if($FilePath -notmatch 'wscript.exe$' -or $WindowStyle -ne 'Hidden' -or ($ArgumentList -join '|') -notmatch '/check$'){throw 'Preflight contract changed'}
  $p=[pscustomobject]@{ExitCode=$global:HiddenPrintTest.exitCode}
  $p|Add-Member ScriptMethod WaitForExit {param($timeout) return $true}
  return $p
}
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) return [pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory} }
function Get-ScheduledTask { param($TaskName,$ErrorAction) return [pscustomobject]@{TaskName=$TaskName;State='Running';Actions=@([pscustomobject]@{WorkingDirectory=$root});Settings=[pscustomobject]@{StartWhenAvailable=$false;RestartCount=3};Principal='preserved';Triggers='preserved'} }
function Export-ScheduledTask { param($TaskName) $global:HiddenPrintTest.backups++;return '<fixture-task />' }
function Set-ScheduledTask {
  param($TaskName,$Action,$Settings)
  if($TaskName -ne 'Onebiz Print Point 00000000-0000-0000-0000-000000000001' -or $Action.Execute -notmatch 'wscript.exe$' -or $Action.Arguments -notmatch '^//B //NoLogo ".*start-hidden.vbs"$' -or -not $Settings.StartWhenAvailable -or $Settings.RestartCount -ne 3){throw 'Task update lost settings or target'}
  $global:HiddenPrintTest.sets++
}
function Stop-ScheduledTask {throw 'Must not stop running task'}
function Start-ScheduledTask {throw 'Must not start a second task'}
& (Join-Path $root 'update-autostart.ps1') -PointId '00000000-0000-0000-0000-000000000001' | Out-Null
if($global:HiddenPrintTest.sets -ne 1 -or $global:HiddenPrintTest.backups -ne 1){throw 'Missing backup/update'}
$global:HiddenPrintTest.exitCode=1
try { & (Join-Path $root 'update-autostart.ps1') -PointId '00000000-0000-0000-0000-000000000001';throw 'Expected blocked host' }
catch {if($_.Exception.Message -notmatch 'preflight failed'){throw}}
if($global:HiddenPrintTest.sets -ne 1 -or $global:HiddenPrintTest.backups -ne 1){throw 'Blocked host changed task'}
Write-Output 'PASS mocked upgrade: backs up existing task, preserves running receiver/retry settings, and refuses blocked host before changing anything.'
