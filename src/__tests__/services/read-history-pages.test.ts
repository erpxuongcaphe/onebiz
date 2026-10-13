import { describe, expect, it, vi } from "vitest";
import { readHistoryPages } from "@/lib/services/supabase/read-history-pages";

describe("complete permitted history", () => {
  it("reads beyond 30 and 1000 rows with no status suppression", async () => {
    const source = Array.from({length:1201},(_,i)=>({id:String(i),status:i%2 ? "cancelled" : "completed"}));
    const fetch = vi.fn(async (offset:number,size:number)=>({data:source.slice(offset,offset+size),error:null}));
    const rows = await readHistoryPages(fetch);
    expect(rows).toEqual(source);
    expect(fetch).toHaveBeenLastCalledWith(1200,200);
  });
  it("retains the explicit short preview contract", async () => {
    const fetch = vi.fn(async (_offset:number,size:number)=>({data:Array.from({length:size},(_,i)=>({id:String(i)})),error:null}));
    expect(await readHistoryPages(fetch,30)).toHaveLength(30);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not turn a late page failure into empty or partial success", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({data:Array.from({length:200},(_,i)=>({id:String(i)})),error:null}).mockResolvedValueOnce({data:null,error:{message:"permission denied"}});
    await expect(readHistoryPages(fetch)).rejects.toThrow("permission denied");
  });
  it("rejects duplicate rows after concurrent history changes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({data:Array.from({length:200},(_,i)=>({id:String(i)})),error:null}).mockResolvedValueOnce({data:[{id:"1"}],error:null});
    await expect(readHistoryPages(fetch)).rejects.toThrow("Lịch sử thay đổi");
  });
});
