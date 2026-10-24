import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {act,cleanup,renderHook} from "@testing-library/react";
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/printer/branch-queue",()=>({getBranchPrintJobState:mock.read}));
import {usePrintJobFeedback} from "@/lib/hooks/use-print-job-feedback";
const job=(id:string,status="queued")=>({id,label:`Bill ${id}`,route_label:"Quầy",status,created_at:new Date().toISOString(),actor_name:"Thu ngân",message:null});
const accept=(id:string,branchId="branch")=>window.dispatchEvent(new CustomEvent("onebiz-print-result",{detail:{success:true,backend:"branch-queue",queued:{id,branchId,label:`Bill ${id}`,routeLabel:"Quầy"}}}));
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();mock.read.mockReset();mock.read.mockResolvedValue({point:{connected:true},jobs:[]});});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("live feedback for consecutive F&B bills",()=>{
 it("tracks 50 rapidly accepted IDs without resending and reads only those IDs",async()=>{
  const notice=vi.fn();const view=renderHook(()=>usePrintJobFeedback("branch","tenant:user",notice));
  act(()=>{for(let i=0;i<50;i++)accept(`job${i}`);accept("job0");accept("other","another-branch");});
  expect(view.result.current.waiting).toBe(50);expect(mock.read).not.toHaveBeenCalled();
  mock.read.mockImplementation(async(_branch,ids:string[])=>({point:{connected:true},jobs:ids.map(id=>job(id,"handed_off"))}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(mock.read).toHaveBeenCalledTimes(1);expect(mock.read.mock.calls[0][0]).toBe("branch");
  expect(mock.read.mock.calls[0][1]).toHaveLength(50);expect(new Set(mock.read.mock.calls[0][1]).size).toBe(50);
  expect(view.result.current.waiting).toBe(0);expect(notice).toHaveBeenCalledWith(expect.objectContaining({title:"Đã chuyển dữ liệu tới máy in",variant:"info"}));
  expect(notice.mock.calls.some(([n])=>/Đã in xong|Đã ra giấy/.test(n.title))).toBe(false);
 });
 it("shows waiting immediately, then a persistent slow warning and unknown result",async()=>{
  const notice=vi.fn();const view=renderHook(()=>usePrintJobFeedback("branch","tenant:user",notice));
  mock.read.mockResolvedValue({point:{connected:true},jobs:[job("a")]});
  act(()=>accept("a"));expect(view.result.current.waiting).toBe(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(view.result.current.issues).toBe(1);expect(view.result.current.jobs[0].message).toMatch(/Chờ lâu/);
  mock.read.mockResolvedValue({point:{connected:true},jobs:[job("a","unknown")]});
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(view.result.current.jobs[0].status).toBe("unknown");expect(view.result.current.issues).toBe(1);
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({title:"Có phiếu cần kiểm tra giấy"}));
 });
 it("a hung read times out, then can recover without leaving overlapping polls",async()=>{
  const notice=vi.fn();const view=renderHook(()=>usePrintJobFeedback("branch","tenant:user",notice));
  let finish!:(result:unknown)=>void;mock.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  act(()=>accept("a"));await act(async()=>{await vi.advanceTimersByTimeAsync(8001);});
  expect(view.result.current.error).toMatch(/có thể đã ra/);expect(mock.read).toHaveBeenCalledTimes(1);
  mock.read.mockResolvedValue({point:{connected:true},jobs:[job("a","handed_off")]});
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(view.result.current.waiting).toBe(0);expect(view.result.current.error).toBe("");
  await act(async()=>{finish({point:{connected:false},jobs:[job("a","unknown")]});});
  expect(view.result.current.issues).toBe(0);
 });
 it("a new event arriving during a read is retained and checked in the next batch",async()=>{
  let finish!:(result:unknown)=>void;mock.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=renderHook(()=>usePrintJobFeedback("branch","tenant:user",vi.fn()));
  act(()=>accept("a"));await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  act(()=>accept("b"));await act(async()=>{finish({point:{connected:true},jobs:[job("a","handed_off")]});});
  expect(view.result.current.waiting).toBe(1);expect(view.result.current.jobs[0].id).toBe("b");
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(mock.read).toHaveBeenLastCalledWith("branch",["b"]);
 });
 it("restores only the same account/branch and ignores late results after changing branch",async()=>{
  let finish!:(result:unknown)=>void;mock.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=renderHook(({branch,scope})=>usePrintJobFeedback(branch,scope,vi.fn()),{initialProps:{branch:"branch",scope:"tenant:user"}});
  act(()=>accept("a"));await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  view.rerender({branch:"other",scope:"tenant:user"});expect(view.result.current.waiting).toBe(0);
  await act(async()=>{finish({point:{connected:true},jobs:[job("a","unknown")]});});expect(view.result.current.issues).toBe(0);
  view.rerender({branch:"branch",scope:"tenant:user"});expect(view.result.current.waiting).toBe(1);
  view.rerender({branch:"branch",scope:"tenant:different"});expect(view.result.current.waiting).toBe(0);
 });
 it("no new bill means no polling; offline state never triggers enqueue or retry",async()=>{
  const view=renderHook(()=>usePrintJobFeedback("branch","tenant:user",vi.fn()));
  await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});expect(mock.read).not.toHaveBeenCalled();
  mock.read.mockResolvedValue({point:{connected:false},jobs:[job("a")]});
  act(()=>accept("a"));await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(view.result.current.jobs[0].message).toMatch(/chưa kết nối/);expect(view.result.current.issues).toBe(1);
 });
});
