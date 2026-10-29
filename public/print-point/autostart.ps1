function New-OnebizHiddenPrintAction {
  param([Parameter(Mandatory=$true)][string]$Root)
  $hostPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $launcherPath = Join-Path $Root 'start-hidden.vbs'
  if (-not (Test-Path -LiteralPath $hostPath) -or -not (Test-Path -LiteralPath $launcherPath)) {
    throw 'Hidden launcher is unavailable. No task settings changed.'
  }
  $probe = Start-Process -FilePath $hostPath -ArgumentList @('//B','//NoLogo',('"'+$launcherPath+'"'),'/check') -WindowStyle Hidden -PassThru
  if (-not $probe.WaitForExit(10000)) {
    $probe.Kill()
    throw 'Hidden launcher preflight timed out. No task settings changed.'
  }
  if ($probe.ExitCode -ne 0) { throw 'Windows Script Host is blocked or launcher preflight failed. No task settings changed.' }
  return New-ScheduledTaskAction -Execute $hostPath -Argument ('//B //NoLogo "'+$launcherPath+'"') -WorkingDirectory $Root
}
