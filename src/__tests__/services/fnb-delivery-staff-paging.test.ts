import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), range: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: mock.rpc }), handleError: (e: { message: string }) => { throw new Error(e.message); } }));
import { listFnbDeliveryStaff } from "@/lib/services/supabase/fnb-delivery-staff";
beforeEach(() => { mock.rpc.mockReset().mockReturnValue({ range: mock.range }); mock.range.mockReset(); });
it("loads a complete branch roster beyond one page", async () => {
  const rows = Array.from({ length: 257 }, (_, n) => ({ id: String(n), full_name: `Staff ${n}` }));
  mock.range.mockImplementation(async (from: number,to: number) => ({ data: rows.slice(from,to+1), count: rows.length, error: null }));
  expect(await listFnbDeliveryStaff("premium")).toHaveLength(257);
  expect(mock.rpc).toHaveBeenCalledWith("list_fnb_delivery_staff_20261027", { p_branch_id: "premium" }, { count: "exact" });
});
it("fails visibly instead of returning a misleading empty or partial roster", async () => {
  mock.range.mockResolvedValue({ data: null, error: { message: "denied" } });
  await expect(listFnbDeliveryStaff("wrong")).rejects.toThrow("denied");
  expect(await listFnbDeliveryStaff("")).toEqual([]);
});
