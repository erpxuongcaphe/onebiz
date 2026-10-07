$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$nodePath = Get-OnebizNode
$agentProcess = Start-Process -FilePath $nodePath -ArgumentList @('agent.mjs','onebiz-print-point.json') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru
exit $agentProcess.ExitCode
