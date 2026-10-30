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
class WakeTests {
 static int Main(){try{
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;
  var connected=new ManualResetEvent(false);var release=new ManualResetEvent(false);
  var server=Task.Factory.StartNew(delegate{using(var socket=listener.AcceptTcpClient())using(var stream=socket.GetStream()){
   var reader=new StreamReader(stream);string line;int length=0;
   while(!String.IsNullOrEmpty(line=reader.ReadLine()))if(line.StartsWith("Content-Length:",StringComparison.OrdinalIgnoreCase))length=Int32.Parse(line.Substring(15));
   var body=new char[length];int offset=0;while(offset<length){int n=reader.Read(body,offset,length-offset);if(n==0)throw new Exception("BODY_TRUNCATED");offset+=n;}
   if(!new string(body).Contains("pointId"))throw new Exception("AUTH_BODY_MISSING");
   var bytes=Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nevent: ready\ndata: 1\n\n");stream.Write(bytes,0,bytes.Length);stream.Flush();connected.Set();
   release.WaitOne(5000);bytes=Encoding.UTF8.GetBytes("event: wake\ndata: 1\n\n");stream.Write(bytes,0,bytes.Length);stream.Flush();Thread.Sleep(200);
  }});
  ServicePointManager.Expect100Continue=false;
  var type=Assembly.LoadFrom("OnebizWin7.exe").GetType("OnebizWin7").GetNestedType("WakeListener",BindingFlags.NonPublic);
  var config=new Dictionary<string,object>{{"url","http://127.0.0.1:"+port},{"pointId","fixture"},{"token","fixture"},{"publicKey","fixture"}};
  var wake=Activator.CreateInstance(type,new object[]{config});type.GetMethod("Start").Invoke(wake,null);
  if(!connected.WaitOne(5000))throw new Exception("WAKE_CONNECT_FAILED");Thread.Sleep(100);
  if(!(bool)type.GetField("Connected").GetValue(wake))throw new Exception("WAKE_NOT_READY");
  type.GetMethod("Wait").Invoke(wake,new object[]{5000}); // drain initial ready
  var clock=Stopwatch.StartNew();release.Set();type.GetMethod("Wait").Invoke(wake,new object[]{5000});
  if(clock.ElapsedMilliseconds>1000)throw new Exception("WAKE_DID_NOT_INTERRUPT_IDLE");
  if(!server.Wait(5000))throw new Exception("FAKE_SERVER_STUCK");listener.Stop();
  Thread.Sleep(100);if((bool)type.GetField("Connected").GetValue(wake))throw new Exception("STALE_CONNECTED_FLAG");
  Console.WriteLine("PASS Win7 SSE auth body, ready, immediate wake, disconnect fallback. Loopback only; no bill or printer.");return 0;
 }catch(Exception e){Console.WriteLine(e);return 1;}}
}
