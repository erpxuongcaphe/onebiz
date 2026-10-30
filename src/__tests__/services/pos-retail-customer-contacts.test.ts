import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => api,
  handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getOrCreateWalkInRetailContact, getRetailCustomerContacts, getRetailCustomerContactById, parseRetailCustomerContacts, resolveRetailCustomerContact } from "@/lib/services/supabase/pos-retail-customer-contacts";
const request = { branchId: "branch-a" };
const contact = { id: "customer-a", code: "KH001", name: "Customer A", phone: null, is_internal: false,
  customer_type: "company", is_walk_in: false, branch_id: null, price_tier_id: "price-a",
  group_id: "group-a", customer_groups: { name: "Group A", discount_percent: 5 }, loyalty_points: 120,
  loyalty_tier_id: "loyalty-a", loyalty_tiers: { name: "Member A", discount_percent: 3 },
  house_number: "10", street: "Street A", quarter: "Quarter A", ward: "Ward A", province: "Province A", country: "VN",
  email: "fixture@example.test", address: "Address A", tax_code: "FIXTURE" };
beforeEach(() => vi.resetAllMocks());
describe("Retail contact profile boundary", () => {
  it("resolves explicit Guest through scoped contacts without reading customer money", async () => {
    api.rpc.mockResolvedValueOnce({ data: { id: contact.id }, error: null })
      .mockResolvedValueOnce({ data: [{ ...contact, is_walk_in: true }], error: null });
    const result = await getOrCreateWalkInRetailContact("branch-a");
    expect(result.isWalkIn).toBe(true);
    expect(result).not.toHaveProperty("currentDebt");
    expect(api.from).not.toHaveBeenCalled();
    expect(api.rpc).toHaveBeenNthCalledWith(1,"get_or_create_walk_in_customer");
  });
  it("rejects missing branch before creating Guest and rejects a mismatched Guest profile", async () => {
    await expect(getOrCreateWalkInRetailContact("all")).rejects.toThrow("chi nhánh");
    expect(api.rpc).not.toHaveBeenCalled();
    api.rpc.mockResolvedValueOnce({ data: { id: contact.id }, error: null })
      .mockResolvedValueOnce({ data: [contact], error: null });
    await expect(getOrCreateWalkInRetailContact("branch-a")).rejects.toThrow("khách lẻ chưa hợp lệ");
  });
  it("falls back only when the new identity RPC is not installed", async () => {
    api.rpc.mockResolvedValueOnce({data:null,error:{code:"PGRST202",message:"Function not found"}})
      .mockResolvedValueOnce({data:[contact],error:null});
    expect(await getRetailCustomerContacts(request)).toHaveLength(1);
    expect(api.rpc).toHaveBeenNthCalledWith(2,"get_pos_customer_contacts_scoped",expect.objectContaining({p_branch_id:"branch-a"}));
  });
  it("resolves external identity without another lookup", async () => {
    api.rpc.mockResolvedValue({ data: [contact], error: null });
    expect(await resolveRetailCustomerContact(contact.id, "branch-a")).toMatchObject({ id: contact.id });
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
  it("checks internal identity only after an empty external result", async () => {
    api.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
      data: [{ ...contact, is_internal: true, branch_id: "branch-b" }], error: null,
    });
    expect(await resolveRetailCustomerContact(contact.id, "branch-a")).toMatchObject({ isInternal: true });
    expect(api.rpc).toHaveBeenNthCalledWith(2, "get_pos_retail_customer_contacts_identity", expect.objectContaining({ p_internal: true, p_customer_id: contact.id }));
  });
  it("does not retry another mode after an authorization error", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(resolveRetailCustomerContact(contact.id, "branch-a")).rejects.toThrow("denied");
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps pricing, loyalty and structured delivery data without synthetic money", () => {
    const result = parseRetailCustomerContacts([contact], request)[0];
    expect(result).toMatchObject({ id: contact.id, type: "company", phone: "", priceTierId: "price-a", groupId: "group-a",
      groupName: "Group A", groupDiscountPercent: 5, loyaltyPoints: 120, loyaltyTierId: "loyalty-a", loyaltyTierDiscount: 3,
      loyaltyTierName: "Member A", houseNumber: "10", street: "Street A", quarter: "Quarter A", ward: "Ward A",
      province: "Province A", country: "VN", address: "Address A", taxCode: "FIXTURE" });
    for (const key of ["currentDebt", "totalSales", "totalSalesMinusReturns", "createdAt", "lastPurchaseAt"]) expect(result).not.toHaveProperty(key);
  });
  it.each(["current_debt", "total_spent", "total_orders", "total_sales", "last_purchase_at", "currentDebt", "totalSales", "totalSalesMinusReturns"])("rejects financial cache %s even when null", key => {
    expect(() => parseRetailCustomerContacts([{ ...contact, [key]: null }], request)).toThrow();
  });
  it.each([{ id: "" }, { code: "" }, { name: " " }, { phone: 123 }, { customer_type: "other" },
    { loyalty_points: -1 }, { loyalty_points: " " }, { loyalty_points: Infinity },
    { customer_groups: { discount_percent: 101 } }, { loyalty_tiers: { discount_percent: -1 } },
    { customer_groups: [] }, { is_internal: "true" }])("rejects malformed profile %j", patch => {
    expect(() => parseRetailCustomerContacts([{ ...contact, ...patch }], request)).toThrow();
  });
  it("rejects duplicates, unexpected IDs and excessive rows", () => {
    expect(() => parseRetailCustomerContacts([contact, contact], request)).toThrow();
    expect(() => parseRetailCustomerContacts([contact], { ...request, customerId: "other" })).toThrow();
    expect(() => parseRetailCustomerContacts([contact, { ...contact, id: "b" }], { ...request, limit: 1 })).toThrow();
  });
  it("requires the requested internal mode and excludes the receiving branch itself", () => {
    const internal = { ...contact, is_internal: true, branch_id: "branch-b" };
    expect(() => parseRetailCustomerContacts([internal], request)).toThrow();
    expect(parseRetailCustomerContacts([internal], { ...request, internal: true })[0].branchId).toBe("branch-b");
    expect(() => parseRetailCustomerContacts([{ ...internal, branch_id: "branch-a" }], { ...request, internal: true })).toThrow();
  });
  it("passes search/mode/branch and never reads raw customers", async () => {
    api.rpc.mockResolvedValue({ data: [contact], error: null });
    await getRetailCustomerContacts({ ...request, search: " KH001 ", limit: 20 });
    expect(api.rpc).toHaveBeenCalledWith("get_pos_retail_customer_contacts_identity", {
      p_branch_id: "branch-a", p_search: "KH001", p_customer_id: null, p_internal: false, p_limit: 20,
    });
    expect(api.from).not.toHaveBeenCalled();
  });
  it("restores the exact identity with its explicit internal mode", async () => {
    api.rpc.mockResolvedValue({ data: [{ ...contact, is_internal: true, branch_id: "branch-b" }], error: null });
    expect(await getRetailCustomerContactById({ ...request, customerId: "customer-a", internal: true })).toMatchObject({ id: "customer-a", isInternal: true });
    expect(api.rpc).toHaveBeenCalledWith("get_pos_retail_customer_contacts_identity", expect.objectContaining({ p_customer_id: "customer-a", p_limit: 1, p_internal: true }));
  });
  it("returns null for missing identities, not a fabricated customer", async () => {
    api.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getRetailCustomerContactById({ ...request, customerId: "missing" })).toBeNull();
  });
  it.each([{ branchId: "all" }, { branchId: "" }, { branchId: " a " }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { customerId: " " }, { search: "x".repeat(129) }])("rejects invalid request before RPC %j", patch => {
    return expect(getRetailCustomerContacts({ ...request, ...patch })).rejects.toThrow().then(() => expect(api.rpc).not.toHaveBeenCalled());
  });
  it("does not fall back after denied/unavailable source", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(getRetailCustomerContacts(request)).rejects.toThrow("denied");
    expect(api.rpc).toHaveBeenCalledTimes(1); expect(api.from).not.toHaveBeenCalled();
  });
  it("aborts before reading and rejects late responses after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getRetailCustomerContacts({ ...request, signal: controller.signal })).rejects.toThrow();
    expect(api.rpc).not.toHaveBeenCalled();
    const late = new AbortController();
    api.rpc.mockReturnValue({ abortSignal: () => { late.abort(); return Promise.resolve({ data: [contact], error: null }); } });
    await expect(getRetailCustomerContacts({ ...request, signal: late.signal })).rejects.toThrow();
  });
});
