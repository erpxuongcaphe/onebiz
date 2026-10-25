using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Diagnostics;

class OnebizWin7 {
 static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4000000 };
 static string home = AppDomain.CurrentDomain.BaseDirectory;
 static Dictionary<string,object> config;
 static string journal;
 static string claimRequest;
 static int RpcDeadlineMs=15000;
 static long progress=Stopwatch.GetTimestamp();
 static Timer watchdog;
 const string Version="2026.10.25.1";
 static void Pulse(){Interlocked.Exchange(ref progress,Stopwatch.GetTimestamp());}
 static void StartWatchdog(int milliseconds){
  StopWatchdog();
  Pulse();watchdog=new Timer(delegate {
   double elapsed=(Stopwatch.GetTimestamp()-Interlocked.Read(ref progress))*1000.0/Stopwatch.Frequency;
   if(elapsed>=milliseconds)Environment.Exit(75);
  },null,Math.Min(milliseconds,1000),Math.Min(milliseconds,1000));
 }
 static void StopWatchdog(){var old=Interlocked.Exchange(ref watchdog,null);if(old!=null)old.Dispose();}
 class RpcFailure:Exception {
  public bool ClaimExpired;
  public RpcFailure(string action,string kind,bool expired):base("RPC "+action+": "+kind){ClaimExpired=expired;}
 }
 static object ReadResponse(HttpWebResponse response){
  using(response)using(var reader=new StreamReader(response.GetResponseStream())){
   var result=new StringBuilder();char[] buffer=new char[8192];int count;
   while((count=reader.Read(buffer,0,buffer.Length))>0){
    if(result.Length+count>4000000)throw new Exception("RPC_RESPONSE_TOO_LARGE");
    result.Append(buffer,0,count);
   }
   return json.DeserializeObject(result.ToString());
  }
 }

 static string S(Dictionary<string,object> d,string k) { return d.ContainsKey(k) ? Convert.ToString(d[k]) : ""; }
 static void Log(string s) {
  string line=DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")+" "+s; Console.WriteLine(line);
  string path=Path.Combine(home,"receiver.log"),previous=path+".previous";
  if(File.Exists(path)&&new FileInfo(path).Length>2000000){if(File.Exists(previous))File.Delete(previous);File.Move(path,previous);}
  File.AppendAllText(path,line+Environment.NewLine,Encoding.UTF8);
 }
 static Dictionary<string,object> Read(string path) { return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path)); }
 static object Call(string action, object data) {
  var clock=Stopwatch.StartNew();bool completed=false;string phase="request-stream";
  var req=(HttpWebRequest)WebRequest.Create(new Uri(new Uri(S(config,"url")),"/rest/v1/rpc/fnb_print_agent_v1"));
  req.Method="POST"; req.ContentType="application/json"; req.Headers["apikey"]=S(config,"publicKey");
  req.Timeout=RpcDeadlineMs; req.ReadWriteTimeout=RpcDeadlineMs; req.AllowAutoRedirect=false;
  // An absolute deadline includes response body reads, unlike Timeout by itself.
  using(var deadline=new Timer(delegate {try{req.Abort();}catch{}},null,RpcDeadlineMs,Timeout.Infinite)){
   try{
    byte[] body=Encoding.UTF8.GetBytes(json.Serialize(new {p_point=S(config,"pointId"),p_token=S(config,"token"),p_action=action,p_data=data}));
    req.ContentLength=body.Length;
    using(var stream=req.GetRequestStream()){phase="request-write";stream.Write(body,0,body.Length);}
    phase="response-headers";
    var response=(HttpWebResponse)req.GetResponse();phase="response-body";
    var result=ReadResponse(response);completed=true;if(clock.ElapsedMilliseconds>=2000)Log("RPC "+action+" hoan tat sau "+clock.ElapsedMilliseconds+"ms");return result;
   }catch(WebException e){
    bool expired=false;int status=0;
    // Always release failed responses; otherwise repeated failures can exhaust pooled connections.
    if(e.Response!=null)using(var response=e.Response){
     var http=response as HttpWebResponse;if(http!=null)status=(int)http.StatusCode;
     try{using(var reader=new StreamReader(response.GetResponseStream())){
      char[] text=new char[8192];int size=reader.Read(text,0,text.Length);
      expired=new string(text,0,size).Contains("PRINT_CLAIM_EXPIRED");
     }}catch{}
    }
    throw new RpcFailure(action,(status>0?"HTTP "+status:e.Status.ToString())+" sau "+clock.ElapsedMilliseconds+"ms; phase="+phase,expired);
   }finally{if(!completed)req.Abort();}
  }
 }
 static string[] Printers() {
  var task=Task.Factory.StartNew(delegate {var names=new List<string>();foreach(string name in PrinterSettings.InstalledPrinters){if(names.Count<100&&name.Length<=200)names.Add(name);}return names.ToArray();});
  try {if(task.Wait(5000))return task.Result;}catch{}
  Console.WriteLine("Khong doc kip danh sach driver Windows. Van co the in LAN.");return new string[0];
 }
 class Destination { public string Host,Printer; public int Port; public bool Cut=true; }
 static Destination Parse(string value) {
  if(String.IsNullOrWhiteSpace(value)||value.Length>200) throw new Exception("Ten may in khong hop le");
  var d=new Destination();
  if(value.StartsWith("tcp://")) {
   var m=Regex.Match(value,@"^tcp://(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})(\?cut=0)?$");
   if(!m.Success) throw new Exception("IP/cong khong hop le");
   string[] a=m.Groups[1].Value.Split('.'); int[] n=new int[4]; for(int i=0;i<4;i++) {n[i]=Int32.Parse(a[i]);if(n[i]>255) throw new Exception("IP khong hop le");}
   if(!(n[0]==10 || n[0]==172&&n[1]>=16&&n[1]<=31 || n[0]==192&&n[1]==168)||n[3]==0||n[3]==255) throw new Exception("Chi dung IP noi bo");
   d.Port=Int32.Parse(m.Groups[2].Value); if(d.Port<1||d.Port>65535) throw new Exception("Cong khong hop le"); d.Host=m.Groups[1].Value;d.Cut=!m.Groups[3].Success;
  } else if(value.StartsWith("windows://")) {
   var m=Regex.Match(value,@"^windows://([^?]+)\?cut=0$");if(!m.Success) throw new Exception("May in Windows khong hop le"); d.Printer=Uri.UnescapeDataString(m.Groups[1].Value);d.Cut=false;
  } else {if(value.Contains("://")) throw new Exception("Giao thuc khong ho tro");d.Printer=value;}
  return d;
 }
 static byte[] Probe=Encoding.ASCII.GetBytes("\x1b@\x1b"+"a\x01ONEBIZ_CONNECTION_V2");
 static bool Equal(byte[] a,byte[] b) {if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 static void Validate(byte[] b,string paper) {
  int stride=paper=="58mm"?48:paper=="80mm"?72:0;
  if(stride==0||b.Length>1800000||b.Length<19||b[0]!=27||b[1]!=64||b[2]!=27||b[3]!=97||b[4]!=1) throw new Exception("INVALID_RASTER");
  int p=5,rows=0;
  while(p+8<=b.Length&&b[p]==29&&b[p+1]==118) {int w=b[p+4]+256*b[p+5],h=b[p+6]+256*b[p+7]; if(b[p+2]!=48||b[p+3]!=0||w!=stride||h<1||h>256)throw new Exception("INVALID_RASTER");p+=8+w*h;rows+=h;if(p>b.Length||rows>24000)throw new Exception("INVALID_RASTER");}
  byte[] tail={27,100,3,29,86,1};if(rows==0||b.Length-p!=6)throw new Exception("INVALID_RASTER");for(int i=0;i<6;i++)if(b[p+i]!=tail[i])throw new Exception("INVALID_RASTER");
 }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class DocInfo {public string name="Onebiz",output=null,type="RAW";}
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr h,IntPtr defaults);
 [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",CharSet=CharSet.Unicode,SetLastError=true)] static extern int StartDocPrinter(IntPtr h,int level,[In] DocInfo doc);
 [DllImport("winspool.drv")] static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv")] static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv")] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] bytes,int size,out int written);
 static void Send(Destination d,byte[] bytes,bool probe,ref bool attempted) {
  if(d.Host!=null) {
   using(var client=new TcpClient()) {
    var result=client.BeginConnect(d.Host,d.Port,null,null);using(result.AsyncWaitHandle) {if(!result.AsyncWaitHandle.WaitOne(5000))throw new Exception("Khong ket noi duoc IP/cong");client.EndConnect(result);}
    if(probe)return;client.SendTimeout=10000; using(var stream=client.GetStream()){stream.WriteTimeout=10000;attempted=true;stream.Write(bytes,0,bytes.Length);stream.Flush();}
   }
  } else {
   if(probe){if(Array.IndexOf(Printers(),d.Printer)<0)throw new Exception("Khong tim thay may in Windows");return;}
   IntPtr handle=IntPtr.Zero;bool doc=false,page=false;
   try {if(!OpenPrinter(d.Printer,out handle,IntPtr.Zero))throw new Exception("Khong mo duoc may in Windows");if(StartDocPrinter(handle,1,new DocInfo())==0)throw new Exception("START_DOC_FAILED");doc=true;
    if(!StartPagePrinter(handle))throw new Exception("START_PAGE_FAILED");page=true;int written;attempted=true;
    if(!WritePrinter(handle,bytes,bytes.Length,out written)||written!=bytes.Length)throw new Exception("WRITE_NOT_CONFIRMED");
    if(!EndPagePrinter(handle))throw new Exception("END_PAGE_NOT_CONFIRMED");page=false;if(!EndDocPrinter(handle))throw new Exception("END_DOC_NOT_CONFIRMED");doc=false;
   } finally {if(page)EndPagePrinter(handle);if(doc)EndDocPrinter(handle);if(handle!=IntPtr.Zero)ClosePrinter(handle);}
  }
 }
 static void Save(Dictionary<string,object> record) { SaveAt(journal,record); }
 static void SaveAt(string path,Dictionary<string,object> record) {
  string tmp=path+".tmp";using(var file=new FileStream(tmp,FileMode.Create,FileAccess.Write,FileShare.None)) {byte[] bytes=Encoding.UTF8.GetBytes(json.Serialize(record));file.Write(bytes,0,bytes.Length);file.Flush(true);}
  if(File.Exists(path))File.Replace(tmp,path,null);else File.Move(tmp,path);
 }
 // Persist the request identity BEFORE contacting the server. A lost response can
 // then be retrieved with the same identity, rather than blocking the point for 2m.
 // Pending physical-send journals always take priority over another claim.
 static Dictionary<string,object> Claim() {
  Dictionary<string,object> intent;
  if(File.Exists(claimRequest))intent=Read(claimRequest);
  else {intent=new Dictionary<string,object>{{"request_id",Guid.NewGuid().ToString()}};SaveAt(claimRequest,intent);}
  Guid requestId;if(!Guid.TryParse(S(intent,"request_id"),out requestId))throw new Exception("INVALID_DURABLE_CLAIM_REQUEST");
  var response=Call("claim",intent);
  var job=response as Dictionary<string,object>;
  if(response!=null&&job==null)throw new Exception("INVALID_CLAIM_RESPONSE");
  if(response==null)File.Delete(claimRequest);
  else if(S(job,"claim_id")!=requestId.ToString())throw new Exception("PRINT_RECOVERY_PROTOCOL_MISMATCH");
  return job;
 }
 static void Ack(Dictionary<string,object> record) {
  try { Call("finish",record);File.Delete(journal); }
  catch(RpcFailure e) {
   if(e.ClaimExpired){File.Move(journal,journal+".expired-"+DateTime.UtcNow.Ticks);Log("Phieu cu da het quyen xac nhan. Kiem tra trang in; khong tu in lai.");return;}
   throw new Exception(e.Message+"; giu nhat ky, KHONG gui lai may in.");
  }
 }
 static void Process(Dictionary<string,object> job) {
  var record=new Dictionary<string,object>{{"id",S(job,"id")},{"claim_id",S(job,"claim_id")},{"status","unknown"},{"message","Bo nhan ngat trong xu ly. Kiem tra giay truoc khi in lai."}};
  Save(record);
  // If the process stops after this point, startup acknowledges the durable
  // unknown outcome; it must NEVER send these bytes to the printer again.
  if(claimRequest!=null&&File.Exists(claimRequest))File.Delete(claimRequest);
  bool attempted=false;
  try {
   byte[] b=Convert.FromBase64String(S(job,"bytes"));bool probe=Equal(b,Probe);if(!probe)Validate(b,S(job,"paper"));var d=Parse(S(job,"printer"));
   if(!probe&&!d.Cut)Array.Resize(ref b,b.Length-3);
   if(!probe&&S(job,"label").StartsWith("IN LẠI",StringComparison.Ordinal)){byte[] prefix=Encoding.ASCII.GetBytes("\x1b@IN LAI - KIEM TRA TRUNG MON\n");var joined=new byte[prefix.Length+b.Length];Buffer.BlockCopy(prefix,0,joined,0,prefix.Length);Buffer.BlockCopy(b,0,joined,prefix.Length,b.Length);b=joined;}
   Send(d,b,probe,ref attempted);record["status"]="handed_off";record["message"]=probe?"Ket noi/ten may in hop le. Chua in giay; dung In thu.":"Da chuyen du lieu. Kiem tra giay; chua xac nhan in xong.";
  }catch(Exception e){record["status"]=attempted?"unknown":"failed";record["message"]=e.Message;}
  Save(record);Log("Phieu "+S(job,"id")+" : "+S(record,"status"));Pulse();Ack(record);Pulse();
 }
 static void SelfTest() {
  Parse("tcp://192.168.10.222:9100");if(Parse("windows://XP-80?cut=0").Cut)throw new Exception("CUT_TEST");
  foreach(string bad in new[]{"tcp://8.8.8.8:9100","tcp://192.168.1.3:0","tcp://192.168.1.999:9100","http://printer"}) {bool rejected=false;try{Parse(bad);}catch{rejected=true;}if(!rejected)throw new Exception("DEST_TEST");}
  byte[] b=new byte[5+8+72+6];byte[] head={27,64,27,97,1,29,118,48,0,72,0,1,0};Buffer.BlockCopy(head,0,b,0,head.Length);byte[] tail={27,100,3,29,86,1};Buffer.BlockCopy(tail,0,b,b.Length-6,6);Validate(b,"80mm");b[9]=48;bool invalid=false;try{Validate(b,"80mm");}catch{invalid=true;}if(!invalid)throw new Exception("RASTER_TEST");
  if(Probe.Length!=25||Probe[3]!=97||Probe[4]!=1)throw new Exception("PROBE_TEST");
  journal=Path.Combine(home,"onebiz-selftest-"+Guid.NewGuid()+".json");
  try {
   var record=new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"claim_id",Guid.NewGuid().ToString()},{"status","unknown"},{"message","test"}};
   Save(record);if(S(Read(journal),"status")!="unknown")throw new Exception("JOURNAL_CREATE_TEST");
   record["status"]="handed_off";Save(record);if(S(Read(journal),"status")!="handed_off")throw new Exception("JOURNAL_REPLACE_TEST");
   var request=json.Deserialize<Dictionary<string,object>>(json.Serialize(new {p_point="test",p_token="not-a-real-token",p_action="finish",p_data=record}));
   if(S(request,"p_action")!="finish"||!(request["p_data"] is Dictionary<string,object>))throw new Exception("RPC_ENVELOPE_TEST");
  } finally {if(File.Exists(journal))File.Delete(journal);if(File.Exists(journal+".tmp"))File.Delete(journal+".tmp");}
  Console.WriteLine("PASS: private LAN, port, Windows destination, cut flag, raster width, invalid raster, probe, durable journal create/replace, RPC envelope. No network/printing.");
 }
 static int Main(string[] args) {
  try {
   if(args.Length>0&&args[0]=="--self-test"){SelfTest();return 0;}
   ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
   config=Read(Path.Combine(home,"onebiz-print-point.json"));Guid point;
   Uri url;if(!Uri.TryCreate(S(config,"url"),UriKind.Absolute,out url)||url.Scheme!="https"||!String.IsNullOrEmpty(url.UserInfo)||!url.IsDefaultPort||!Regex.IsMatch(url.Host,@"^[a-z0-9]{20}\.supabase\.co$")||!Guid.TryParse(S(config,"pointId"),out point)||!Regex.IsMatch(S(config,"token"),"^[a-f0-9]{64}$")||String.IsNullOrEmpty(S(config,"publicKey")))throw new Exception("Cau hinh khong hop le. Dung file JSON trong bo tai MOI NHAT.");
   journal=Path.Combine(home,"pending-ack-"+point.ToString()+".json");
   claimRequest=Path.Combine(home,"pending-claim-"+point.ToString()+".json");
   bool owned;using(var mutex=new Mutex(true,"Local\\OnebizPrint-"+point.ToString(),out owned)) {
    if(!owned)throw new Exception("Bo nhan nay dang chay. Khong mo them.");
    Console.WriteLine("ONEBIZ - BO NHAN WIN7 "+Version+" / .NET 4.8\nWindows: "+Environment.OSVersion+"; 64-bit: "+Environment.Is64BitOperatingSystem);
    StartWatchdog(60000);
    Console.WriteLine("1. KIEM TRA: chi ket noi va liet ke may in. Khong lay phieu.");
    var names=Printers();try{Call("heartbeat",new {printers=names});Log("Ket noi may chu thanh cong. May in Windows: "+names.Length);}catch(RpcFailure e){Log(e.Message+"; se thu lai ket noi, chua gui phieu.");}Pulse();
    foreach(var name in names)Console.WriteLine("  "+name);
    Console.WriteLine("Ra soat phieu cu dang cho tren Onebiz truoc. Tat bo nhan khac.\nGo BAT DA RA SOAT de bat dau nhan tat ca phieu dang cho; Enter de thoat.");
    StopWatchdog();
    if(Console.ReadLine()!="BAT DA RA SOAT")return 0;
    StartWatchdog(60000);
    // Pending acknowledgement is handled inside the retry loop, never physically replayed.
    // Refuse to print with an old server which cannot recover this request ID.
    var capability=Call("heartbeat",new {printers=names}) as Dictionary<string,object>;
    if(capability==null||S(capability,"recoverable_claim_v1")!="True")throw new Exception("May chu chua san sang phuc hoi phieu. Chua gui may in.");
    Log("Dang nhan phieu. Giu cua so nay mo; Ctrl+C de dung.");DateTime next=DateTime.UtcNow.AddMinutes(5);int failures=0;
    while(true) {try {
     Pulse();if(File.Exists(journal)){Ack(Read(journal));Pulse();continue;}
     if(DateTime.UtcNow>=next){Call("heartbeat",new {printers=names});next=DateTime.UtcNow.AddMinutes(5);}
     var job=Claim();Pulse();if(job==null)Thread.Sleep(1000);else Process(job);failures=0;
    }catch(Exception e){failures++;int delay=failures<=3?1000:5000;Log("Thu lai ket noi sau "+(delay/1000)+" giay: "+e.Message);Thread.Sleep(delay);}}
   }
  }catch(Exception e){Console.WriteLine("LOI: "+e.Message);Console.WriteLine("Giu cua so nay va chup loi. Khong can tai lai ma ket noi.");try{Log("Khoi dong that bai: "+e.GetType().Name+" "+e.Message);}catch{}return 1;}
 }
}
