# No printer API is called: fake API unit cases + probe + invalid-file protocol.
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../public/print-point/OnebizUsbWorker.cs'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fixtureRoot=Join-Path $PSScriptRoot ('../.tmp/native-usb-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$shipped=Join-Path $PSScriptRoot '../public/print-point/OnebizUsbWorker.exe'
$testExe=Join-Path $fixtureRoot 'tests.exe'
# Compile the same sender source with a fake Winspool implementation, self-contained.
& $compiler /nologo /r:System.Runtime.Serialization.dll /main:NativeUsbWorkerTests ('/out:'+$testExe) $source (Join-Path $PSScriptRoot 'NativeUsbWorkerTests.cs')
if($LASTEXITCODE -ne 0){throw 'Native tests compile failed'}
& $testExe
if($LASTEXITCODE -ne 0){throw 'Native fake API tests failed'}
& $shipped --probe
if($LASTEXITCODE -ne 0){throw 'Shipped native binary probe failed'}
& node (Join-Path $PSScriptRoot 'test-native-usb-protocol.mjs') $shipped
if($LASTEXITCODE -ne 0){throw 'Native protocol tests failed'}
