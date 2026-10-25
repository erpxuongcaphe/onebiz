import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({
 router:{push:vi.fn(),replace:vi.fn()},session:vi.fn(),permissions:vi.fn(),profile:vi.fn(),
 callback:undefined as undefined|((event:string,session:unknown)=>void),signOut:vi.fn(),
}));
vi.mock("next/navigation",()=>({useRouter:()=>mock.router}));
vi.mock("@/lib/services/supabase/permission-overrides",()=>({getUserEffectivePermissions:mock.permissions}));
vi.mock("@/lib/services/supabase/base",()=>({_seedProfileCache:vi.fn(),_clearProfileCache:vi.fn()}));
vi.mock("@/lib/hooks/use-device-binding",()=>({readDeviceBinding:()=>null}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({
 auth:{getSession:mock.session,onAuthStateChange:(callback:typeof mock.callback)=>{mock.callback=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};},signOut:mock.signOut},
 rpc:async()=>({data:[{branch_id:"branch"}],error:null}),
 from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,single:()=>table==="profiles"?mock.profile():Promise.resolve({data:{id:"tenant",name:"Tenant",settings:{}},error:null}),
   order:async()=>({data:[{id:"branch",tenant_id:"tenant",name:"Branch",is_default:true}],error:null})};return q;
 },
})}));
vi.mock("@/lib/contexts",async()=>({useAuth:(await import("@/lib/contexts/auth-context")).useAuth}));
import {AuthProvider,useAuth} from "@/lib/contexts/auth-context";
import {PermissionPage} from "@/components/shared/permission-page";
const user={id:"user",email:"fixture@example.test",created_at:"2026-01-01"};
const profile={id:"user",tenant_id:"tenant",branch_id:"branch",role:"staff",is_active:true,full_name:"Fixture",created_at:"2026-01-01"};
const session={data:{session:{user}},error:null};
function Probe(){const a=useAuth();return <><output aria-label="auth">{JSON.stringify({loading:a.isLoading,error:a.authDataError,allowed:a.hasPermission("pos_fnb.send_kitchen")})}</output><PermissionPage requires="pos_fnb.send_kitchen"><p>POS được phép</p></PermissionPage></>;}
const state=()=>JSON.parse(screen.getByLabelText("auth").textContent!);
const flush=async()=>{await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});};
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();vi.clearAllMocks();
 mock.session.mockReset().mockResolvedValue(session);
 mock.permissions.mockReset().mockResolvedValue(["pos_fnb.send_kitchen"]);
 mock.profile.mockReset().mockResolvedValue({data:profile,error:null});
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("auth bootstrap failure is distinct from genuine permission denial",()=>{
 it("does not release loading when INITIAL_SESSION and getSession finish in different orders",async()=>{
  let finishSession!:(v:typeof session)=>void,finishPerms!:(v:string[])=>void;
  mock.session.mockReturnValue(new Promise(r=>{finishSession=r;}));
  mock.permissions.mockReturnValue(new Promise(r=>{finishPerms=r;}));
  render(<AuthProvider><Probe/></AuthProvider>);
  act(()=>mock.callback?.("INITIAL_SESSION",{user}));await flush();
  await act(async()=>{finishSession(session);});await flush();
  expect(state().loading).toBe(true);expect(screen.queryByText("Không có quyền truy cập")).not.toBeInTheDocument();
  expect(mock.permissions).toHaveBeenCalledTimes(1);
  await act(async()=>{finishPerms(["pos_fnb.send_kitchen"]);});await flush();
  expect(state().allowed).toBe(true);expect(screen.getByText("POS được phép")).toBeInTheDocument();
 });
 it("shows a retryable read error and automatically recovers without logout",async()=>{
  mock.permissions.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(["pos_fnb.send_kitchen"]);
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa kiểm tra được quyền truy cập");
  expect(screen.queryByText("Không có quyền truy cập")).not.toBeInTheDocument();
  expect(state().allowed).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});await flush();
  expect(screen.getByText("POS được phép")).toBeInTheDocument();expect(mock.signOut).not.toHaveBeenCalled();
 });
 it("does not treat a profile transport error as an inactive account",async()=>{
  mock.profile.mockResolvedValue({data:null,error:{message:"Network error"}});
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  expect(state().error).toBeTruthy();expect(screen.getByRole("button",{name:"Thử lại"})).toBeEnabled();
  expect(screen.queryByText("Không có quyền truy cập")).not.toBeInTheDocument();
 });
 it("retains genuine denial after a successful empty permission response",async()=>{
  mock.permissions.mockResolvedValue([]);
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  expect(state().error).toBeNull();expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(mock.permissions).toHaveBeenCalledTimes(1);
 });
 it("never grants an inactive account",async()=>{
  mock.profile.mockResolvedValue({data:{...profile,is_active:false},error:null});
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  expect(state().allowed).toBe(false);expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
 });
 it("times out a hanging read; ignores its late result and allows retry of real grants",async()=>{
  let finishOld!:(v:string[])=>void;mock.permissions.mockReturnValueOnce(new Promise(r=>{finishOld=r;}));
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(state().loading).toBe(true);expect(screen.queryByText("Không có quyền truy cập")).not.toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.getByRole("alert")).toBeInTheDocument();expect(state().allowed).toBe(false);
  await act(async()=>{finishOld(["*"]);});await flush();expect(state().allowed).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));await flush();
  expect(screen.getByText("POS được phép")).toBeInTheDocument();
 });
 it("limits automatic recovery attempts and keeps manual retry available",async()=>{
  mock.permissions.mockRejectedValue(new Error("offline"));
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});await flush();
  expect(mock.permissions).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("button",{name:"Thử lại"})).toBeEnabled();expect(mock.signOut).not.toHaveBeenCalled();
 });
 it("recovers a getSession failure through existing session data without clearing drafts",async()=>{
  localStorage.setItem("fixture-draft","keep");
  mock.session.mockRejectedValueOnce(new Error("session read failed")).mockResolvedValue(session);
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));await flush();
  expect(screen.getByText("POS được phép")).toBeInTheDocument();
  expect(localStorage.getItem("fixture-draft")).toBe("keep");expect(mock.signOut).not.toHaveBeenCalled();
 });
 it("does not accept a stale initial session after an explicit sign-out event",async()=>{
  let finish!:(v:typeof session)=>void;
  mock.session.mockReturnValue(new Promise(r=>{finish=r;}));
  render(<AuthProvider><Probe/></AuthProvider>);
  act(()=>mock.callback?.("SIGNED_OUT",null));await flush();
  await act(async()=>{finish(session);});await flush();
  expect(state().allowed).toBe(false);expect(mock.profile).not.toHaveBeenCalled();
 });
 it("bounds manual session reads instead of hanging indefinitely",async()=>{
  mock.session.mockRejectedValueOnce(new Error("network")).mockReturnValue(new Promise(()=>{}));
  render(<AuthProvider><Probe/></AuthProvider>);await flush();
  fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(12001);});await flush();
  expect(state().loading).toBe(false);expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(state().allowed).toBe(false);expect(mock.signOut).not.toHaveBeenCalled();
 });
});
