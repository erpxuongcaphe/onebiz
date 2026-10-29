using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

[DataContract] public class UsbRequest {
 [DataMember] public string file;
 [DataMember] public string printer;
}
[DataContract] public class UsbResult {
 [DataMember] public string status;
 [DataMember] public string message;
 [DataMember] public int jobId;
 public UsbResult(string s,string m,int id) {status=s;message=m;jobId=id;}
}
public interface IRawPrintApi {
 bool Open(string printer,out IntPtr handle);
 int StartDoc(IntPtr handle);
 bool StartPage(IntPtr handle);
 bool Write(IntPtr handle,byte[] bytes,out int written);
 bool EndPage(IntPtr handle);
 bool EndDoc(IntPtr handle);
 void Close(IntPtr handle);
}
public class NativeRawPrintApi : IRawPrintApi {
 [StructLayout(LayoutKind.Sequential)] struct PrinterInfo4 {public IntPtr name,server;public uint attributes;}
 [DllImport("winspool.drv",EntryPoint="EnumPrintersW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumPrinters(uint flags,string name,uint level,IntPtr buffer,uint size,out uint needed,out uint returned);
 public static string[] ListPrinters(){
  uint needed,count;EnumPrinters(6,null,4,IntPtr.Zero,0,out needed,out count);
  if(needed==0)return new string[0];if(needed>16777216)throw new InvalidDataException();
  IntPtr buffer=Marshal.AllocHGlobal((int)needed);
  try{
   if(!EnumPrinters(6,null,4,buffer,needed,out needed,out count))throw new IOException();
   int size=Marshal.SizeOf(typeof(PrinterInfo4));var names=new System.Collections.Generic.List<string>();
   for(int i=0;i<count&&names.Count<100;i++){var entry=(PrinterInfo4)Marshal.PtrToStructure(IntPtr.Add(buffer,i*size),typeof(PrinterInfo4));var value=Marshal.PtrToStringUni(entry.name);if(!String.IsNullOrEmpty(value))names.Add(value);}
   return names.ToArray();
  }finally{Marshal.FreeHGlobal(buffer);}
 }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class DocInfo {
  public string pDocName="Onebiz"; public string pOutputFile=null; public string pDataType="RAW";
 }
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",CharSet=CharSet.Unicode,SetLastError=true)] static extern int StartDocPrinter(IntPtr handle,int level,[In]DocInfo info);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr handle,byte[] bytes,int size,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
 public bool Open(string printer,out IntPtr handle){return OpenPrinter(printer,out handle,IntPtr.Zero);}
 public int StartDoc(IntPtr h){return StartDocPrinter(h,1,new DocInfo());}
 public bool StartPage(IntPtr h){return StartPagePrinter(h);}
 public bool Write(IntPtr h,byte[] b,out int n){return WritePrinter(h,b,b.Length,out n);}
 public bool EndPage(IntPtr h){return EndPagePrinter(h);}
 public bool EndDoc(IntPtr h){return EndDocPrinter(h);}
 public void Close(IntPtr h){ClosePrinter(h);}
}
public static class OnebizUsbWorker {
 public static UsbResult Print(byte[] bytes,string printer,IRawPrintApi api) {
  IntPtr h=IntPtr.Zero; bool doc=false,page=false,attempted=false;int jobId=0;
  try {
   if(bytes==null || bytes.Length==0 || bytes.Length>1800100 || String.IsNullOrWhiteSpace(printer)) return new UsbResult("failed","INVALID_REQUEST",0);
   if(!api.Open(printer,out h)) return new UsbResult("failed","PRINTER_NOT_FOUND",0);
   jobId=api.StartDoc(h);if(jobId==0)return new UsbResult("failed","START_DOC_FAILED",0);doc=true;
   if(!api.StartPage(h))return new UsbResult("failed","START_PAGE_FAILED",jobId);page=true;
   int written;attempted=true;
   if(!api.Write(h,bytes,out written) || written!=bytes.Length)return new UsbResult("unknown","WRITE_NOT_CONFIRMED",jobId);
   if(!api.EndPage(h))return new UsbResult("unknown","END_PAGE_NOT_CONFIRMED",jobId);page=false;
   if(!api.EndDoc(h))return new UsbResult("unknown","END_DOC_NOT_CONFIRMED",jobId);doc=false;
   return new UsbResult("handed_off","WINDOWS_ACCEPTED",jobId);
  } catch {return new UsbResult(attempted?"unknown":"failed","WINDOWS_PRINT_ERROR",jobId);}
  finally {
   if(page)try{api.EndPage(h);}catch{}
   if(doc)try{api.EndDoc(h);}catch{}
   if(h!=IntPtr.Zero)try{api.Close(h);}catch{}
  }
 }
 public static int Main(string[] args) {
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  if(args.Length==1 && args[0]=="--list"){
   try{using(var stream=new MemoryStream()){new DataContractJsonSerializer(typeof(string[])).WriteObject(stream,NativeRawPrintApi.ListPrinters());Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));}return 0;}
   catch{Console.Error.WriteLine("NATIVE_PRINTER_DISCOVERY_FAILED");return 1;}
  }
  if(args.Length>1 || (args.Length==1 && args[0]!="--probe"))return 2;
  Console.WriteLine("{\"ready\":true,\"version\":1}");Console.Out.Flush();
  if(args.Length==1)return 0;
  var input=new DataContractJsonSerializer(typeof(UsbRequest));
  var output=new DataContractJsonSerializer(typeof(UsbResult));
  var api=new NativeRawPrintApi();string line;
  while((line=Console.ReadLine())!=null) {
   UsbResult result;
   try {
    if(line.Length>32768)throw new InvalidDataException();
    UsbRequest request;
    using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(line))){request=(UsbRequest)input.ReadObject(stream);}
    if(request==null || String.IsNullOrWhiteSpace(request.file) || String.IsNullOrWhiteSpace(request.printer))throw new InvalidDataException();
    var info=new FileInfo(request.file);
    if(info.Length<1 || info.Length>1800100)throw new InvalidDataException();
    result=Print(File.ReadAllBytes(request.file),request.printer,api);
   } catch {result=new UsbResult("failed","INVALID_REQUEST_OR_FILE",0);}
   using(var stream=new MemoryStream()){output.WriteObject(stream,result);Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));}
   Console.Out.Flush();
  }
  return 0;
 }
}
