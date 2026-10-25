using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Diagnostics;
using System.Collections.Generic;

class RecoveryTests {
 static Type program=Assembly.LoadFrom("OnebizWin7.exe").GetType("OnebizWin7");
 static BindingFlags flags=BindingFlags.Static|BindingFlags.NonPublic;
 static MethodInfo call=program.GetMethod("Call",flags);
 static void Set(string name,object value){program.GetField(name,flags).SetValue(null,value);}
 static object Call(string action){try{return call.Invoke(null,new object[]{action,new {}});}catch(TargetInvocationException e){throw e.InnerException;}}
 static void Assert(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS: "+name);}
 class Server:IDisposable {
  public TcpListener listener;public int Port,Requests;bool stopped;
  public Func<int,string> Handler;public int StallMs;
  public Server(Func<int,string> handler,int stall){
   Handler=handler;StallMs=stall;listener=new TcpListener(IPAddress.Loopback,0);listener.Start();Port=((IPEndPoint)listener.LocalEndpoint).Port;
   Task.Factory.StartNew(delegate {while(!stopped){TcpClient client;try{client=listener.AcceptTcpClient();}catch{return;}
    Task.Factory.StartNew(delegate {using(client){try{
     client.ReceiveTimeout=2000;using(var stream=client.GetStream()){
      int ending=0;var headers=new StringBuilder();while(ending<4){int b=stream.ReadByte();if(b<0)return;headers.Append((char)b);ending=(ending==0&&b==13)?1:(ending==1&&b==10)?2:(ending==2&&b==13)?3:(ending==3&&b==10)?4:0;}
      int length=0;foreach(string line in headers.ToString().Split('\n'))if(line.StartsWith("Content-Length:",StringComparison.OrdinalIgnoreCase))length=Int32.Parse(line.Substring(15).Trim());
      for(int i=0;i<length;i++)if(stream.ReadByte()<0)return;
      int number=Interlocked.Increment(ref Requests);string response=Handler(number);
      if(response=="STALL"){Thread.Sleep(StallMs);return;}
      byte[] bytes=Encoding.UTF8.GetBytes(response);stream.Write(bytes,0,bytes.Length);stream.Flush();
      if(response.Contains("X-Test-Stall"))Thread.Sleep(StallMs);
     }
    }catch{}}});
   }});
  }
  public void Dispose(){stopped=true;listener.Stop();}
 }
 static string Response(string body,int status){return "HTTP/1.1 "+status+" Test\r\nContent-Type: application/json\r\nContent-Length: "+Encoding.UTF8.GetByteCount(body)+"\r\nConnection: close\r\n\r\n"+body;}
 static void Configure(Server server,int timeout){Set("config",new Dictionary<string,object>{{"url","http://127.0.0.1:"+server.Port},{"publicKey","fixture"},{"pointId","fixture"},{"token","fixture"}});Set("RpcDeadlineMs",timeout);}
 static int Main(string[] args){try{
  if(args.Length==1&&args[0]=="--watchdog-child"){
   program.GetMethod("StartWatchdog",flags).Invoke(null,new object[]{250});Thread.Sleep(5000);return 99;
  }
  if(args.Length==1&&args[0]=="--healthy-child"){
   program.GetMethod("StartWatchdog",flags).Invoke(null,new object[]{400});
   for(int i=0;i<10;i++){Thread.Sleep(100);program.GetMethod("Pulse",flags).Invoke(null,null);}
   return 0;
  }
  if(args.Length==1&&args[0]=="--paused-child"){
   program.GetMethod("StartWatchdog",flags).Invoke(null,new object[]{250});
   program.GetMethod("StopWatchdog",flags).Invoke(null,null);Thread.Sleep(1000);return 0;
  }
  ServicePointManager.Expect100Continue=false;
  using(var server=new Server(delegate(int n){return n==1?"STALL":Response("null",200);},3000)){
   Configure(server,400);var clock=Stopwatch.StartNew();bool failed=false;try{Call("claim");}catch(Exception e){failed=e.Message.Contains("RPC claim");}
   Assert(failed&&clock.ElapsedMilliseconds<2500,"hung claim has an action-specific deadline");
   Assert(Call("claim")==null,"a subsequent claim recovers after timeout");
  }
  using(var server=new Server(delegate(int n){return n==1?"HTTP/1.1 200 OK\r\nContent-Length: 99999\r\nX-Test-Stall: yes\r\nConnection: close\r\n\r\nx":Response("null",200);},3000)){
   Configure(server,400);var clock=Stopwatch.StartNew();bool failed=false;try{Call("claim");}catch{failed=true;}
   Assert(failed&&clock.ElapsedMilliseconds<2500,"absolute deadline also interrupts partial response body");
   Assert(Call("claim")==null,"pool usable after partial-body timeout");
  }
  using(var server=new Server(delegate(int n){return Response(n<=30?"{\"message\":\"fixture error\"}":"null",n<=30?500:200);},0)){
   Configure(server,2000);int errors=0;for(int i=0;i<30;i++)try{Call("claim");}catch(Exception e){if(e.Message.Contains("HTTP 500"))errors++;}
   Assert(errors==30,"30 HTTP error responses are closed and classified");
   for(int i=0;i<50;i++)Assert(Call("claim")==null,"burst claim "+(i+1));
   Assert(server.Requests==80,"80 RPC requests completed without printer access");
  }
  string journal=Path.Combine(Path.GetTempPath(),"onebiz-recovery-fixture-"+Guid.NewGuid()+".json");Set("journal",journal);
  var record=new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"claim_id",Guid.NewGuid().ToString()},{"status","unknown"},{"message","fixture"}};
  var save=program.GetMethod("Save",flags);var ack=program.GetMethod("Ack",flags);
  try{
   using(var server=new Server(delegate(int n){return n==1?Response("{}",500):Response("null",200);},0)){
    Configure(server,2000);save.Invoke(null,new object[]{record});bool failed=false;try{ack.Invoke(null,new object[]{record});}catch{failed=true;}
    Assert(failed&&File.Exists(journal),"failed acknowledgement retains durable journal");
    ack.Invoke(null,new object[]{record});Assert(!File.Exists(journal)&&server.Requests==2,"recovery retries acknowledgement only; no physical send");
   }
   using(var server=new Server(delegate(int n){return Response("{\"message\":\"PRINT_CLAIM_EXPIRED\"}",400);},0)){
    Configure(server,2000);save.Invoke(null,new object[]{record});ack.Invoke(null,new object[]{record});
    Assert(!File.Exists(journal)&&Directory.GetFiles(Path.GetDirectoryName(journal),Path.GetFileName(journal)+".expired-*").Length==1,"expired claim archived without physical replay");
   }
  }finally{
   if(File.Exists(journal))File.Delete(journal);
   foreach(string file in Directory.GetFiles(Path.GetDirectoryName(journal),Path.GetFileName(journal)+".expired-*"))File.Delete(file);
  }
  var start=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--watchdog-child"){UseShellExecute=false,CreateNoWindow=true};
  using(var child=Process.Start(start)){Assert(child.WaitForExit(5000)&&child.ExitCode==75,"stalled worker exits with recovery code 75");}
  start.Arguments="--healthy-child";
  using(var child=Process.Start(start)){Assert(child.WaitForExit(5000)&&child.ExitCode==0,"healthy progressing worker remains alive");}
  start.Arguments="--paused-child";
  using(var child=Process.Start(start)){Assert(child.WaitForExit(5000)&&child.ExitCode==0,"watchdog stopped while waiting for human confirmation");}
  Console.WriteLine("PASS: all tests use loopback and disposable fixture journal; no live queue, credentials or physical printer.");return 0;
 }catch(Exception e){Console.WriteLine(e);return 1;}}
}
