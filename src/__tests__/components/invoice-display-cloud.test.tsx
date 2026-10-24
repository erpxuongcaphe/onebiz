import {act,renderHook,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
const api=vi.hoisted(()=>({get:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/services/supabase/invoice-display-preferences",()=>({getInvoiceDisplayPreferences:api.get,saveInvoiceDisplayPreferences:api.save}));
import {useInvoiceDisplay,DEFAULT_INVOICE_DISPLAY} from "@/lib/hooks/use-invoice-display";
import {applyDisplayPatch,mergeDisplayPatch,acknowledgeDisplayPatch} from "@/lib/utils/invoice-display";
const record=(split=false)=>({value:{...DEFAULT_INVOICE_DISPLAY,splitOptions:split},revision:1});
beforeEach(()=>{localStorage.clear();api.get.mockReset().mockResolvedValue(record());api.save.mockReset().mockImplementation(async(_t,_u,p)=>({value:applyDisplayPatch(DEFAULT_INVOICE_DISPLAY,p),revision:2}));});
afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe("account display synchronization",()=>{
 it("restores cloud on a second device without local cache",async()=>{api.get.mockResolvedValue(record(true));const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));expect(h.result.current[0].splitOptions).toBe(true);expect(api.save).not.toHaveBeenCalled();});
 it("refreshes when returning to an open iPad tab",async()=>{const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));api.get.mockResolvedValue(record(true));act(()=>window.dispatchEvent(new Event("focus")));await waitFor(()=>expect(h.result.current[0].splitOptions).toBe(true));});
 it("does not let a delayed cloud read overwrite a new user choice",async()=>{let done!:(r:ReturnType<typeof record>)=>void;api.get.mockReturnValue(new Promise(r=>done=r));const h=renderHook(()=>useInvoiceDisplay("t","u"));act(()=>h.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await act(async()=>done(record(false)));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));expect(h.result.current[0].splitOptions).toBe(true);expect(api.save).toHaveBeenCalledWith("t","u",{splitOptions:true});});
 it("imports local choices only when cloud has no saved choice",async()=>{localStorage.setItem("onebiz:invoice-display:v1:t:u",JSON.stringify({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));api.get.mockResolvedValue(null);api.save.mockResolvedValue(record(true));const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));expect(api.save).toHaveBeenCalledWith("t","u",expect.objectContaining({splitOptions:true}),true);});
 it("retains offline edits after remount and merges only edited fields on retry",async()=>{api.get.mockRejectedValue(Error("offline"));const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("offline"));act(()=>h.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(h.result.current[2].state).toBe("offline"));h.unmount();api.get.mockResolvedValue(record());const second=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(second.result.current[2].state).toBe("synced"));expect(second.result.current[0].splitOptions).toBe(true);expect(api.save).toHaveBeenCalledWith("t","u",{splitOptions:true});});
 it("serializes rapid edits and preserves failed in-flight changes",async()=>{let fail!:(e:Error)=>void;const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));api.save.mockImplementationOnce(()=>new Promise((_r,reject)=>fail=reject));act(()=>h.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1));act(()=>h.result.current[1]({...h.result.current[0],hiddenFields:[...h.result.current[0].hiddenFields,"Size"]}));await act(async()=>fail(Error("offline")));await waitFor(()=>expect(h.result.current[2].state).toBe("offline"));act(()=>h.result.current[2].retry());await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));expect(api.save).toHaveBeenLastCalledWith("t","u",{splitOptions:true,detailVisibility:{Size:false}});});
 it("keeps in-flight and newer edits recoverable if the page closes while saving",async()=>{
  const h=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));api.save.mockImplementationOnce(()=>new Promise(()=>{}));
  act(()=>h.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1));
  act(()=>h.result.current[1]({...h.result.current[0],hiddenFields:[...h.result.current[0].hiddenFields,"Size"]}));h.unmount();
  const stored=JSON.parse(localStorage.getItem("onebiz:invoice-display:v2:t:u")!);expect(stored.pending).toEqual({splitOptions:true,detailVisibility:{Size:false}});
 });
 it("ignores old account responses and sends expected identity to the server",async()=>{let done!:(r:ReturnType<typeof record>)=>void;api.get.mockImplementationOnce(()=>new Promise(r=>done=r));const h=renderHook(({user})=>useInvoiceDisplay("t",user),{initialProps:{user:"a"}});h.rerender({user:"b"});await waitFor(()=>expect(h.result.current[2].state).toBe("synced"));await act(async()=>done(record(true)));expect(h.result.current[0].splitOptions).toBe(false);act(()=>h.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(api.save).toHaveBeenCalledWith("t","b",{splitOptions:true}));});
 it("does not let a second passive tab erase another tab's offline queue",async()=>{
  const a=renderHook(()=>useInvoiceDisplay("t","u")),b=renderHook(()=>useInvoiceDisplay("t","u"));
  await waitFor(()=>expect(a.result.current[2].state).toBe("synced"));await waitFor(()=>expect(b.result.current[2].state).toBe("synced"));
  api.get.mockRejectedValue(Error("offline"));
  act(()=>a.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(a.result.current[2].state).toBe("offline"));
  act(()=>b.result.current[2].retry());await waitFor(()=>expect(b.result.current[2].state).toBe("offline"));
  a.unmount();b.unmount();
  const stored=JSON.parse(localStorage.getItem("onebiz:invoice-display:v2:t:u")!);expect(stored.pending.splitOptions).toBe(true);
  const reopened=renderHook(()=>useInvoiceDisplay("t","u"));await waitFor(()=>expect(reopened.result.current[2].state).toBe("offline"));expect(reopened.result.current[0].splitOptions).toBe(true);
 });
 it("a remaining tab can recover another closed tab's offline choice when online returns",async()=>{
  const a=renderHook(()=>useInvoiceDisplay("t","u")),b=renderHook(()=>useInvoiceDisplay("t","u"));
  await waitFor(()=>expect(a.result.current[2].state).toBe("synced"));await waitFor(()=>expect(b.result.current[2].state).toBe("synced"));
  api.get.mockRejectedValue(Error("offline"));act(()=>a.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));await waitFor(()=>expect(a.result.current[2].state).toBe("offline"));a.unmount();
  api.get.mockResolvedValue(record());act(()=>b.result.current[2].retry());await waitFor(()=>expect(b.result.current[0].splitOptions).toBe(true));await waitFor(()=>expect(b.result.current[2].state).toBe("synced"));
  expect(api.save).toHaveBeenLastCalledWith("t","u",{splitOptions:true});expect(JSON.parse(localStorage.getItem("onebiz:invoice-display:v2:t:u")!).pending).toEqual({});
 });
 it("acknowledges only matching fields and leaves another tab's newer fields queued",()=>{
  const pending={splitOptions:false,detailVisibility:{Size:false,"Mức đá":false},listColumns:{date:true,customerName:false}};
  expect(acknowledgeDisplayPatch(pending,{splitOptions:true,detailVisibility:{Size:false},listColumns:{date:false}})).toEqual({splitOptions:false,detailVisibility:{"Mức đá":false},listColumns:{date:true,customerName:false}});
  expect(pending.detailVisibility.Size).toBe(false);
 });
 it("keeps later values when merging rapid edits from the same control",()=>{expect(mergeDisplayPatch({detailVisibility:{Size:false,"Mức đá":false}},{detailVisibility:{Size:true},listColumns:{date:false}})).toEqual({detailVisibility:{Size:true,"Mức đá":false},listColumns:{date:false}});});
});
