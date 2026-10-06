$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$agentProcess = Start-Process -FilePath $nodePath -ArgumentList @('agent.mjs','onebiz-print-point.json') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru
exit $agentProcess.ExitCode
