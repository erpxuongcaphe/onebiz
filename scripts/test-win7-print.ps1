$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../tools/win7-print-point'
$stage=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../.tmp/win7-verify-'+[Guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /r:System.Web.Extensions.dll /r:System.Drawing.dll ('/out:'+(Join-Path $stage 'OnebizWin7.exe')) (Join-Path $source 'OnebizWin7.cs')
if($LASTEXITCODE -ne 0){throw 'Win7 receiver compile failed'}
Push-Location $stage
try {
 & .\OnebizWin7.exe --self-test
 if($LASTEXITCODE -ne 0){throw 'Win7 self-test failed'}
 foreach($name in @('RecoveryTests','ClaimTests','TransportTests','WakeTests')){
  & $compiler /nologo /r:System.Web.Extensions.dll ('/out:'+(Join-Path $stage ($name+'.exe'))) (Join-Path $source ($name+'.cs'))
  if($LASTEXITCODE -ne 0){throw ('Compile failed: '+$name)}
  & (Join-Path $stage ($name+'.exe'))
  if($LASTEXITCODE -ne 0){throw ('Test failed: '+$name)}
 }
} finally { Pop-Location }
Write-Output ('Verified Win7 build: '+(Join-Path $stage 'OnebizWin7.exe'))
