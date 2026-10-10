$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$nodePath = Get-OnebizNode
$logDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
foreach ($logName in @('print-agent.log','print-agent-error.log')) {
  $logPath = Join-Path $logDirectory $logName
  if (Test-Path -LiteralPath $logPath) {
    Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
  }
}
$agentProcess = Start-Process -FilePath $nodePath -ArgumentList @('agent.mjs','onebiz-print-point.json') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'print-agent.log') -RedirectStandardError (Join-Path $logDirectory 'print-agent-error.log') -Wait -PassThru
exit $agentProcess.ExitCode
