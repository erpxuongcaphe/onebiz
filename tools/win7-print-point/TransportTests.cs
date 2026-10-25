using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading.Tasks;
class TransportTests {
 static int Main() {try {
  var assembly=Assembly.LoadFrom("OnebizWin7.exe");var program=assembly.GetType("OnebizWin7");var destination=program.GetNestedType("Destination",BindingFlags.NonPublic);var send=program.GetMethod("Send",BindingFlags.Static|BindingFlags.NonPublic);
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;
  var d=Activator.CreateInstance(destination);destination.GetField("Host").SetValue(d,"127.0.0.1");destination.GetField("Port").SetValue(d,port);
  var receive=Task.Factory.StartNew(delegate {using(var client=listener.AcceptTcpClient())using(var stream=client.GetStream())using(var buffer=new MemoryStream()){stream.CopyTo(buffer);return buffer.ToArray();}});
  byte[] payload={27,64,1,2,3,29,86,1};object[] args={d,payload,false,false};send.Invoke(null,args);
  if(!receive.Wait(5000))throw new Exception("TCP_RECEIVE_TIMEOUT");byte[] received=receive.Result;
  if(!(bool)args[3]||received.Length!=payload.Length)throw new Exception("TCP_LENGTH_OR_ATTEMPT");for(int i=0;i<payload.Length;i++)if(received[i]!=payload[i])throw new Exception("TCP_BYTES");
  listener.Stop();Console.WriteLine("PASS: LAN sender delivered exact bytes once to local fake printer.");
  var closed=new TcpListener(IPAddress.Loopback,0);closed.Start();int closedPort=((IPEndPoint)closed.LocalEndpoint).Port;closed.Stop();destination.GetField("Port").SetValue(d,closedPort);
  args=new object[]{d,payload,false,false};bool failed=false;try{send.Invoke(null,args);}catch(TargetInvocationException){failed=true;}
  if(!failed||(bool)args[3])throw new Exception("CONNECT_FAILURE_CLASSIFICATION");Console.WriteLine("PASS: refused connection classified before physical send.");
  listener=new TcpListener(IPAddress.Loopback,0);listener.Start();destination.GetField("Port").SetValue(d,((IPEndPoint)listener.LocalEndpoint).Port);
  var probeReceive=Task.Factory.StartNew(delegate {using(var client=listener.AcceptTcpClient())using(var stream=client.GetStream()){stream.ReadTimeout=5000;return stream.ReadByte();}});
  args=new object[]{d,new byte[0],true,false};send.Invoke(null,args);if(!probeReceive.Wait(5000)||probeReceive.Result!=-1||(bool)args[3])throw new Exception("PROBE_SENT_DATA");listener.Stop();
  Console.WriteLine("PASS: connection probe opens/closes TCP without printing bytes. No production network or printer used.");return 0;
 }catch(Exception e){Console.WriteLine(e);return 1;}}
}
