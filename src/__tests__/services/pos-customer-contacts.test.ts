import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => api,
  handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getFnbCustomerContacts, getFnbBuyerContacts, parsePosCustomerIdentities } from "@/lib/services/supabase/pos-customer-contacts";
const contact = { id: "customer-a", code: "KH001", name: "Customer A", phone: null, is_internal: false };
beforeEach(() => vi.resetAllMocks());
describe("POS contact-only source", () => {
  it("loads only the selected buyer mode and preserves the linked employee identity",async()=>{
    api.rpc.mockResolvedValue({data:[{...contact,employee_id:'staff',benefit_groups:['Manager']}],error:null});
    expect(await getFnbBuyerContacts({branchId:'branch',kind:'employee',search:' trang '})).toEqual([{id:'customer-a',code:'KH001',name:'Customer A',phone:'',employeeId:'staff',benefitGroups:['Manager']}]);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith('fnb_buyer_lookup_v1',{p_branch_id:'branch',p_search:'trang',p_kind:'employee'});
    expect(api.from).not.toHaveBeenCalled();
  });
  it("refuses malformed employee identities and never falls back to full staff data",async()=>{
    api.rpc.mockResolvedValue({data:[contact],error:null});
    await expect(getFnbBuyerContacts({branchId:'branch',kind:'employee'})).rejects.toThrow(/ưu đãi/);
    expect(api.from).not.toHaveBeenCalled();
  });
  it("cancels buyer lookup and refuses missing migration instead of unscoped fallback",async()=>{
    const controller=new AbortController(),abortSignal=vi.fn().mockResolvedValue({data:[contact],error:null});
    api.rpc.mockReturnValueOnce({abortSignal});
    await getFnbBuyerContacts({branchId:'branch',kind:'customer',signal:controller.signal});
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
    api.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'missing'}});
    await expect(getFnbBuyerContacts({branchId:'branch',kind:'employee'})).rejects.toThrow(/đang được cập nhật/);
    expect(api.from).not.toHaveBeenCalled();
  });
  it("projects identities without fake financial totals", () => {
    expect(parsePosCustomerIdentities([{ ...contact, price_tier_id: "tier-a", address: "Address" }]))
      .toEqual([{ id: "customer-a", code: "KH001", name: "Customer A", phone: "" }]);
  });
  it.each(["current_debt", "total_spent", "total_orders", "totalSales", "totalSalesMinusReturns", "currentDebt"])("rejects financial cache %s", key => {
    expect(() => parsePosCustomerIdentities([{ ...contact, [key]: 0 }])).toThrow();
  });
  it.each([null, {}, [contact, contact], [{ ...contact, id: "" }], [{ ...contact, name: " " }],
    [{ ...contact, phone: 123 }], [{ ...contact, is_internal: true }], Array.from({ length: 11 }, (_, i) => ({ ...contact, id: String(i) }))])("rejects malformed or unexpected contacts", value => {
    expect(() => parsePosCustomerIdentities(value)).toThrow();
  });
  it("requires a concrete branch and calls only the scoped source", async () => {
    api.rpc.mockResolvedValue({ data: [contact], error: null });
    await getFnbCustomerContacts({ branchId: "branch-a", search: " Customer " });
    expect(api.rpc).toHaveBeenCalledWith("get_pos_customer_contacts_scoped", {
      p_branch_id: "branch-a", p_search: "Customer", p_customer_id: null, p_internal: false, p_limit: 10,
    });
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each(["", "all", " "])("rejects invalid scope %s", async branchId => {
    await expect(getFnbCustomerContacts({ branchId })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it("rejects oversized search before querying", async () => {
    await expect(getFnbCustomerContacts({ branchId: "a", search: "a".repeat(129) })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it("never falls back to shared customer rows on errors", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getFnbCustomerContacts({ branchId: "a" })).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
  it("does not read an aborted request or accept a late aborted response", async () => {
    const before = new AbortController(); before.abort();
    await expect(getFnbCustomerContacts({ branchId: "a", signal: before.signal })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
    const during = new AbortController();
    api.rpc.mockReturnValue({ abortSignal: () => { during.abort(); return Promise.resolve({ data: [contact], error: null }); } });
    await expect(getFnbCustomerContacts({ branchId: "a", signal: during.signal })).rejects.toThrow();
  });
});
