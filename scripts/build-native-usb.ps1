$ErrorActionPreference='Stop'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not (Test-Path $compiler)){throw 'Windows .NET Framework compiler is required for this build.'}
$source=Join-Path $PSScriptRoot '../public/print-point/OnebizUsbWorker.cs'
$output=Join-Path $PSScriptRoot '../public/print-point/OnebizUsbWorker.exe'
& $compiler /nologo /optimize+ /platform:anycpu /target:exe /r:System.Runtime.Serialization.dll ('/out:'+$output) $source
if($LASTEXITCODE -ne 0){throw 'Native worker compile failed'}
Get-FileHash -LiteralPath $source,$output -Algorithm SHA256
