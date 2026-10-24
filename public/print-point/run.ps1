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
# A child exit must recover without rebooting Windows. One scheduled task/instance only.
$restartDelay = 5
while ($true) {
  $startedAt = Get-Date
  try {
    $agentProcess = Start-Process -FilePath $nodePath -ArgumentList @('agent.mjs','onebiz-print-point.json') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'print-agent.log') -RedirectStandardError (Join-Path $logDirectory 'print-agent-error.log') -Wait -PassThru
  } catch {
    # Never log arguments, private configuration or raw exception details.
    Add-Content -LiteralPath (Join-Path $logDirectory 'supervisor.log') -Value ((Get-Date).ToString('o') + ' AGENT_START_FAILED')
  }
  Add-Content -LiteralPath (Join-Path $logDirectory 'supervisor.log') -Value ((Get-Date).ToString('o') + ' AGENT_EXIT_RESTART_DELAY_SECONDS=' + $restartDelay)
  Start-Sleep -Seconds $restartDelay
  if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $restartDelay = 5 } else { $restartDelay = [Math]::Min(60, $restartDelay * 2) }
  foreach ($logName in @('print-agent.log','print-agent-error.log')) {
    $logPath = Join-Path $logDirectory $logName
    if (Test-Path -LiteralPath $logPath) { Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force }
  }
}
