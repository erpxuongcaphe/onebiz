using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class ClaimTests {
 static Type program=Assembly.LoadFrom("OnebizWin7.exe").GetType("OnebizWin7");
 static BindingFlags flags=BindingFlags.Static|BindingFlags.NonPublic;
 static JavaScriptSerializer json=new JavaScriptSerializer();
 static void Set(string k,object v){program.GetField(k,flags).SetValue(null,v);}
 static object Invoke(string name,params object[] args){try{return program.GetMethod(name,flags).Invoke(null,args);}catch(TargetInvocationException e){throw e.InnerException;}}
 static void Assert(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS: "+name);}
 class Server:IDisposable {
  TcpListener listener=new TcpListener(IPAddress.Loopback,0);bool stopped;
  public int Port,Requests;public Func<int,Dictionary<string,object>,string> Handler;
  public Server(Func<int,Dictionary<string,object>,string> handler){Handler=handler;listener.Start();Port=((IPEndPoint)listener.LocalEndpoint).Port;
   Task.Factory.StartNew(delegate{while(!stopped){TcpClient client;try{client=listener.AcceptTcpClient();}catch{return;}
    Task.Factory.StartNew(delegate{using(client){try{client.ReceiveTimeout=2000;using(var s=client.GetStream()){
     int ending=0;var h=new StringBuilder();while(ending<4){int b=s.ReadByte();if(b<0)return;h.Append((char)b);ending=(ending==0&&b==13)?1:(ending==1&&b==10)?2:(ending==2&&b==13)?3:(ending==3&&b==10)?4:0;}
     int length=0;foreach(string line in h.ToString().Split('\n'))if(line.StartsWith("Content-Length:",StringComparison.OrdinalIgnoreCase))length=Int32.Parse(line.Substring(15).Trim());
     byte[] body=new byte[length];int p=0;while(p<length){int n=s.Read(body,p,length-p);if(n==0)return;p+=n;}
     var request=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));
     string answer=Handler(Interlocked.Increment(ref Requests),request);
     if(answer==null){Thread.Sleep(1500);return;}
     byte[] response=Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+Encoding.UTF8.GetByteCount(answer)+"\r\nConnection: close\r\n\r\n"+answer);
     s.Write(response,0,response.Length);
    }}catch{}}});
   }});
  }
  public void Dispose(){stopped=true;listener.Stop();}
 }
 static void Configure(Server s){Set("config",new Dictionary<string,object>{{"url","http://127.0.0.1:"+s.Port},{"publicKey","fixture"},{"pointId","fixture"},{"token","fixture"}});Set("RpcDeadlineMs",400);}
 static int Main(){string directory=Path.Combine(Path.GetTempPath(),"onebiz-claim-fixture-"+Guid.NewGuid());Directory.CreateDirectory(directory);
 string intent=Path.Combine(directory,"pending-claim.json"),journal=Path.Combine(directory,"pending-ack.json");Set("claimRequest",intent);Set("journal",journal);
 try{
  ServicePointManager.Expect100Continue=false;string requestId=null;
  using(var s=new Server(delegate(int n,Dictionary<string,object> r){
   var data=(Dictionary<string,object>)r["p_data"];
   if(n==1){requestId=Convert.ToString(data["request_id"]);Assert(File.Exists(intent),"intent is durable before RPC reaches server");return null;}
   Assert(Convert.ToString(data["request_id"])==requestId,"retry keeps the same request identity");
   return json.Serialize(new {id=Guid.NewGuid().ToString(),claim_id=requestId,paper="80mm",printer="Fixture",bytes="invalid",label="fixture"});
  })){
   Configure(s);bool failed=false;try{Invoke("Claim");}catch{failed=true;}
   Assert(failed&&File.Exists(intent),"lost claim response retains durable intent");
   var job=(Dictionary<string,object>)Invoke("Claim");
   Assert(Convert.ToString(job["claim_id"])==requestId&&File.Exists(intent),"assignment recovered before journal replaces intent");
  }
  // Simulate a restart with an existing intent and a terminal server assignment.
  using(var s=new Server(delegate(int n,Dictionary<string,object> r){Assert(Convert.ToString(((Dictionary<string,object>)r["p_data"])["request_id"])==requestId,"restart loads persisted request identity");return "null";})){
   Configure(s);Assert(Invoke("Claim")==null&&!File.Exists(intent),"terminal/empty assignment retires intent without physical replay");
  }
  File.WriteAllText(intent,json.Serialize(new {request_id=Guid.NewGuid().ToString()}));
  var invalidJob=new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"claim_id",Guid.NewGuid().ToString()},{"bytes","invalid"},{"paper","80mm"},{"printer","Fixture"},{"label","fixture"}};
  using(var s=new Server(delegate(int n,Dictionary<string,object> r){Assert(Convert.ToString(r["p_action"])=="finish","pending send outcome only uses finish RPC");return n==1?null:"{\"ok\":true,\"already_finished\":true}";})){
   Configure(s);bool failed=false;try{Invoke("Process",invalidJob);}catch{failed=true;}
   Assert(failed&&File.Exists(journal)&&!File.Exists(intent),"send journal replaces claim intent before any physical send");
   var record=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(journal));
   Assert(Convert.ToString(record["status"])=="failed","invalid raster is rejected before sending bytes");
   Invoke("Ack",record);Assert(!File.Exists(journal),"lost finish response resolves through acknowledgement only");
  }
  File.WriteAllText(intent,"{\"request_id\":\"broken\"}");bool invalid=false;try{Invoke("Claim");}catch(Exception e){invalid=e.Message=="INVALID_DURABLE_CLAIM_REQUEST";}
  Assert(invalid&&File.Exists(intent),"corrupt intent fails closed instead of inventing a new claim");
  Console.WriteLine("PASS: loopback HTTP and temporary journals only; no credentials or physical printer.");return 0;
 }catch(Exception e){Console.WriteLine(e);return 1;}finally{Directory.Delete(directory,true);}
 }
}
