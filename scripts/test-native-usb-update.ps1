# Fake tasks/processes only, ordinary fixture files; never touches a real receiver.
$ErrorActionPreference='Stop'
$stage=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../.tmp/native-update-'+[Guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach($name in @('agent.mjs','usb-worker.mjs','OnebizUsbWorker.exe','OnebizUsbWorker.cs','update-native-usb.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../public/print-point/'+$name)) -Destination (Join-Path $stage $name)}
$global:UsbUpdateTest=@{root='';state='Running';stops=0;starts=0;probe=0;failCopy=$false}
function Get-ScheduledTask {param($TaskName,$ErrorAction) return [pscustomobject]@{TaskName=$TaskName;State=$global:UsbUpdateTest.state;Actions=@([pscustomobject]@{WorkingDirectory=$global:UsbUpdateTest.root})}}
function Start-Process {
 param($FilePath,$ArgumentList,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
 if($ArgumentList -ne '--probe' -or $WindowStyle -ne 'Hidden'){throw 'Unexpected native preflight'}
 Set-Content -LiteralPath $RedirectStandardOutput -Value '{"ready":true}'
 $p=[pscustomobject]@{ExitCode=$global:UsbUpdateTest.probe};$p|Add-Member ScriptMethod WaitForExit {param($ms)return $true};return $p
}
function Get-CimInstance {param($ClassName,$Filter,$OperationTimeoutSec)return @()}
function Stop-ScheduledTask {param($TaskName)$global:UsbUpdateTest.stops++;$global:UsbUpdateTest.state='Ready'}
function Start-ScheduledTask {param($TaskName)$global:UsbUpdateTest.starts++;$global:UsbUpdateTest.state='Running'}
function Copy-Item {
 param($LiteralPath,$Destination,[switch]$Force)
 if($global:UsbUpdateTest.failCopy -and $Destination -eq (Join-Path $global:UsbUpdateTest.root 'usb-worker.mjs')){$global:UsbUpdateTest.failCopy=$false;throw 'FIXTURE_COPY_FAILED'}
 Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
foreach($case in @('success','blocked','rollback')){
 $target=Join-Path $stage $case;New-Item -ItemType Directory -Path $target | Out-Null
 Set-Content -LiteralPath (Join-Path $target 'agent.mjs') -Value 'old-agent';Set-Content -LiteralPath (Join-Path $target 'usb-worker.mjs') -Value 'old-usb'
 $global:UsbUpdateTest.root=$target;$global:UsbUpdateTest.state='Running';$global:UsbUpdateTest.stops=0;$global:UsbUpdateTest.starts=0;$global:UsbUpdateTest.probe=0;$global:UsbUpdateTest.failCopy=$false
 if($case -eq 'blocked'){$global:UsbUpdateTest.probe=1}
 if($case -eq 'rollback'){$global:UsbUpdateTest.failCopy=$true}
 try{ & (Join-Path $stage 'update-native-usb.ps1') -PointId '00000000-0000-0000-0000-000000000001' -TargetFolder $target | Out-Null;if($case -ne 'success'){throw 'Expected refusal'}}
 catch{if($case -eq 'success'){throw};if($case -eq 'rollback' -and $_.Exception.Message -ne 'FIXTURE_COPY_FAILED'){throw};if($case -eq 'blocked' -and $_.Exception.Message -notmatch 'blocked/not ready'){throw}}
 if($case -eq 'success'){if(-not(Test-Path (Join-Path $target 'OnebizUsbWorker.exe')) -or $global:UsbUpdateTest.stops -ne 1 -or $global:UsbUpdateTest.starts -ne 1){throw 'Activation contract failed'}}
 else{if((Get-Content (Join-Path $target 'agent.mjs') -Raw).Trim() -ne 'old-agent' -or (Get-Content (Join-Path $target 'usb-worker.mjs') -Raw).Trim() -ne 'old-usb' -or (Test-Path (Join-Path $target 'OnebizUsbWorker.exe'))){throw 'Previous program not preserved'}}
 if($case -eq 'blocked' -and ($global:UsbUpdateTest.stops -ne 0 -or $global:UsbUpdateTest.starts -ne 0)){throw 'Blocked binary stopped receiver'}
}
Write-Output 'PASS mocked native upgrade: probe before stop, one task activation, program backup, blocked binary leaves live receiver alone, partial copy rolls back. No real task or paper.'
