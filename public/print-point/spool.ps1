param([switch]$Worker)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class OnebizRawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DocInfo { public string pDocName="Onebiz"; public string pOutputFile=null; public string pDataType="RAW"; }
 [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr handle,int level,[In] DocInfo info);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr handle,byte[] bytes,int size,out int written);
}
'@
function Send-OnebizRaw([string]$File, [string]$Printer) {
$printerHandle=[IntPtr]::Zero
$startedDoc=$false
$startedPage=$false
$attemptedWrite=$false
try {
 $printBytes=[IO.File]::ReadAllBytes($File)
 if(-not [OnebizRawPrinter]::OpenPrinter($Printer,[ref]$printerHandle,[IntPtr]::Zero)){throw 'PRINTER_NOT_FOUND'}
 if([OnebizRawPrinter]::StartDocPrinter($printerHandle,1,[OnebizRawPrinter+DocInfo]::new()) -eq 0){throw 'START_DOC_FAILED'}
 $startedDoc=$true
 if(-not [OnebizRawPrinter]::StartPagePrinter($printerHandle)){throw 'START_PAGE_FAILED'}
 $startedPage=$true
 $writtenCount=0
 $attemptedWrite=$true
 if(-not [OnebizRawPrinter]::WritePrinter($printerHandle,$printBytes,$printBytes.Length,[ref]$writtenCount) -or $writtenCount -ne $printBytes.Length){throw 'WRITE_NOT_CONFIRMED'}
 if(-not [OnebizRawPrinter]::EndPagePrinter($printerHandle)){throw 'END_PAGE_NOT_CONFIRMED'}
 $startedPage=$false
 if(-not [OnebizRawPrinter]::EndDocPrinter($printerHandle)){throw 'END_DOC_NOT_CONFIRMED'}
 $startedDoc=$false
 @{status='handed_off';message='WINDOWS_ACCEPTED'}
}catch{
 @{status=$(if($attemptedWrite){'unknown'}else{'failed'});message=$_.Exception.Message}
}finally{
 if($startedPage){[void][OnebizRawPrinter]::EndPagePrinter($printerHandle)}
 if($startedDoc){[void][OnebizRawPrinter]::EndDocPrinter($printerHandle)}
 if($printerHandle -ne [IntPtr]::Zero){[void][OnebizRawPrinter]::ClosePrinter($printerHandle)}
}
}
if ($Worker) {
 [Console]::WriteLine('{"ready":true}')
 while ($null -ne ($line = [Console]::ReadLine())) {
  try {
   $request = $line | ConvertFrom-Json
   if (-not $request.file -or -not $request.printer) { throw 'INVALID_REQUEST' }
   $result = Send-OnebizRaw $request.file $request.printer
   [Console]::WriteLine(($result | ConvertTo-Json -Compress))
  } catch {
   [Console]::WriteLine((@{status='failed';message=$_.Exception.Message} | ConvertTo-Json -Compress))
  }
 }
} else {
 Send-OnebizRaw $env:ONEBIZ_PRINT_FILE $env:ONEBIZ_PRINT_PRINTER | ConvertTo-Json -Compress
}
