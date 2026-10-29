using System;
public class FakeRawPrintApi : IRawPrintApi {
 public string fail="";public int writes=0,closes=0;public bool Open(string p,out IntPtr h){h=fail=="open"?IntPtr.Zero:new IntPtr(1);return h!=IntPtr.Zero;}
 public int StartDoc(IntPtr h){return fail=="doc"?0:17;}
 public bool StartPage(IntPtr h){return fail!="page";}
 public bool Write(IntPtr h,byte[] b,out int n){writes++;n=fail=="partial"?b.Length-1:b.Length;if(fail=="throw")throw new Exception();return fail!="write";}
 public bool EndPage(IntPtr h){return fail!="endpage";}
 public bool EndDoc(IntPtr h){return fail!="enddoc";}
 public void Close(IntPtr h){closes++;}
}
public static class NativeUsbWorkerTests {
 public static int Main(){
  foreach(var failure in new[]{"","open","doc","page","partial","write","throw","endpage","enddoc"}) {
   var api=new FakeRawPrintApi();api.fail=failure;var result=OnebizUsbWorker.Print(new byte[]{1,2,3},"Fixture",api);
   var before=failure=="open"||failure=="doc"||failure=="page";
   var expected=failure==""?"handed_off":before?"failed":"unknown";
   if(result.status!=expected || api.writes!=(before?0:1) || api.closes!=(failure=="open"?0:1))throw new Exception("Case failed: "+failure);
  }
  var invalidApi=new FakeRawPrintApi();if(OnebizUsbWorker.Print(new byte[0],"",invalidApi).status!="failed"||invalidApi.writes!=0)throw new Exception("Invalid request printed");
  Console.WriteLine("PASS native RAW sender: pre-write failures safe, partial/uncertain writes unknown, one write only, cleanup, job ID. Fake API only; no paper.");return 0;
 }
}
