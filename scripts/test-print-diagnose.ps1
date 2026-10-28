$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('onebiz-diagnose-fixture-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
$id = '11111111-1111-1111-1111-111111111111'
$token = 'a' * 64
$key = 'SECRET_SENTINEL_PUBLIC_KEY'
$configPath = Join-Path $fixture 'onebiz-print-point.json'
$config = @{url='https://abcdefghijklmnopqrst.supabase.co'; pointId=$id; token=$token; publicKey=$key}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction)
  @([pscustomobject]@{ProcessId=123;ParentProcessId=10;CommandLine=('node "' + $fixture + '\agent.mjs" --secret ' + $token)},[pscustomobject]@{ProcessId=456;ParentProcessId=10;CommandLine='node agent.mjs'},[pscustomobject]@{ProcessId=789;ParentProcessId=10;CommandLine='node other.mjs'})
}
function Get-ScheduledTask { param($ErrorAction)
  @([pscustomobject]@{TaskName=('Onebiz Print Point ' + $id);State='Running'},[pscustomobject]@{TaskName='Other task';State='Ready'})
}
$diagnose = Join-Path $PSScriptRoot '../public/print-point/diagnose.ps1'
function Read-Report {
  $raw = & $diagnose -PackageDirectory $fixture | Out-String
  foreach ($secret in @($token,$key,$id,'--secret')) { if ($raw.Contains($secret)) { throw 'Diagnostic leaked configuration/process content' } }
  return ($raw | ConvertFrom-Json)
}
$before = (Get-FileHash -LiteralPath $configPath).Hash
$report = Read-Report
if ($report.mode -ne 'READ_ONLY_LOCAL_NO_NETWORK_NO_PRINT' -or -not $report.credentialShapeValid) { throw 'Valid configuration not recognized' }
if ($report.processes.Count -ne 2 -or -not $report.processes[0].packagePathExplicitlyMatches -or $report.processes[1].packagePathExplicitlyMatches) { throw 'Process matching incorrect' }
if ($report.tasks.Count -ne 1 -or -not $report.tasks[0].matchesThisPoint) { throw 'Task matching incorrect' }
if ((Get-FileHash -LiteralPath $configPath).Hash -ne $before) { throw 'Configuration mutated' }
$config.url='https://user:secret@abcdefghijklmnopqrst.supabase.co'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath
$report=Read-Report
if ($report.credentialShapeValid -or $report.projectHost) { throw 'Unsafe URL accepted' }
'not JSON' | Set-Content -LiteralPath $configPath
$report=Read-Report
if ($report.configuration -ne 'unreadable') { throw 'Malformed config not handled' }
# Only delete the explicitly created fixture file; no recursive deletion or real config.
Remove-Item -LiteralPath $configPath
$report=Read-Report
if ($report.configuration -ne 'missing') { throw 'Missing config not handled' }
Write-Output 'PASS read-only diagnostic: valid/unsafe/malformed/missing config, process/task matching, credential redaction, configuration unchanged. Mock metadata only; no network or printing.'
