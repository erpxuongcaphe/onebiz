$ErrorActionPreference = 'Stop'
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
$printerHandle=[IntPtr]::Zero
$startedDoc=$false
$startedPage=$false
$attemptedWrite=$false
try {
 $printBytes=[IO.File]::ReadAllBytes($env:ONEBIZ_PRINT_FILE)
 if(-not [OnebizRawPrinter]::OpenPrinter($env:ONEBIZ_PRINT_PRINTER,[ref]$printerHandle,[IntPtr]::Zero)){throw 'Không tìm thấy máy trong Windows.'}
 if([OnebizRawPrinter]::StartDocPrinter($printerHandle,1,[OnebizRawPrinter+DocInfo]::new()) -eq 0){throw 'Windows không nhận lệnh in.'}
 $startedDoc=$true
 if(-not [OnebizRawPrinter]::StartPagePrinter($printerHandle)){throw 'Không mở được trang in.'}
 $startedPage=$true
 $writtenCount=0
 $attemptedWrite=$true
 if(-not [OnebizRawPrinter]::WritePrinter($printerHandle,$printBytes,$printBytes.Length,[ref]$writtenCount) -or $writtenCount -ne $printBytes.Length){throw 'Chưa xác nhận đủ dữ liệu gửi.'}
 if(-not [OnebizRawPrinter]::EndPagePrinter($printerHandle)){throw 'Chưa xác nhận kết thúc trang.'}
 $startedPage=$false
 if(-not [OnebizRawPrinter]::EndDocPrinter($printerHandle)){throw 'Chưa xác nhận kết thúc lệnh.'}
 $startedDoc=$false
 @{status='handed_off';message='Windows đã nhận lệnh. Kiểm tra giấy tại máy; chưa xác nhận giấy đã ra.'}|ConvertTo-Json -Compress
}catch{
 @{status=$(if($attemptedWrite){'unknown'}else{'failed'});message=$_.Exception.Message}|ConvertTo-Json -Compress
}finally{
 if($startedPage){[void][OnebizRawPrinter]::EndPagePrinter($printerHandle)}
 if($startedDoc){[void][OnebizRawPrinter]::EndDocPrinter($printerHandle)}
 if($printerHandle -ne [IntPtr]::Zero){[void][OnebizRawPrinter]::ClosePrinter($printerHandle)}
}
