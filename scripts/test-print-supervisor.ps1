# Mock processes only. Never launches an agent or reads a point credential.
$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('onebiz-supervisor-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/print-point/run.ps1') -Destination (Join-Path $fixture 'run.ps1')
Set-Content -LiteralPath (Join-Path $fixture 'runtime.ps1') -Value "function Get-OnebizNode { return 'fake-node-not-launched.exe' }"
$global:OnebizSupervisorFixtureState=@{starts=0;delays=@()}
function Start-Process {
 param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$Wait,[switch]$PassThru)
 if($FilePath -ne 'fake-node-not-launched.exe' -or $WindowStyle -ne 'Hidden' -or -not $Wait -or -not $PassThru){throw 'Supervisor lost hidden/wait contract'}
 if(($ArgumentList -join '|') -ne 'agent.mjs|onebiz-print-point.json'){throw 'Unexpected agent arguments'}
 $global:OnebizSupervisorFixtureState.starts++
 Set-Content -LiteralPath $RedirectStandardOutput -Value 'fixture output'
 Set-Content -LiteralPath $RedirectStandardError -Value 'fixture error'
 return @{ExitCode=75}
}
function Start-Sleep {
 param([int]$Seconds)
 $global:OnebizSupervisorFixtureState.delays+=$Seconds
 if($global:OnebizSupervisorFixtureState.delays.Count -eq 3){throw 'FIXTURE_STOP'}
}
try { & (Join-Path $fixture 'run.ps1');throw 'Supervisor exited instead of recovering' }
catch { if($_.Exception.Message -ne 'FIXTURE_STOP'){throw} }
if($global:OnebizSupervisorFixtureState.starts -ne 3 -or ($global:OnebizSupervisorFixtureState.delays -join ',') -ne '5,10,20'){throw 'Restart/backoff failed'}
if(-not (Test-Path -LiteralPath (Join-Path $fixture 'logs/print-agent.log.previous'))){throw 'Previous log not retained'}
Write-Output 'PASS mocked supervisor restarts three child exits, hidden/wait/args, 5/10/20-second backoff, previous logs retained. No real process launched.'
