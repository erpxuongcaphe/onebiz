import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ brand: vi.fn() }));
vi.mock("@/lib/services", () => ({ getResolvedBrand: mock.brand }));
import { withFnbReceiptBrand } from "@/lib/fnb-receipt-brand";
import type { PreBillData } from "@/lib/print-fnb";
const base: PreBillData = { branchId: "tu-bua", orderNumber: "KB1", orderType: "takeaway", createdAt: "2026-10-08T03:00:00Z", items: [], subtotal: 0, discountAmount: 0, deliveryFee: 0, total: 0, storeName: "OneBiz", storeAddress: "Old address", storePhone: "Old phone" };
beforeEach(() => { vi.clearAllMocks(); mock.brand.mockResolvedValue({ branchName: "Xưởng Tư Búa", businessName: "Công ty", address: "03 Trần Minh Trí", phone: "0901664656" }); });
describe("default F&B receipt branch information", () => {
  it("uses the current branch and its resolved print address for both bill phases", async () => {
    const result = await withFnbReceiptBrand(base);
    expect(mock.brand).toHaveBeenCalledWith("tu-bua", { branchOnly: true });
    expect(result).toMatchObject({ storeName: "Xưởng Tư Búa", storeAddress: "03 Trần Minh Trí", storePhone: "0901664656", total: 0 });
    expect(base.storeName).toBe("OneBiz");
  });
  it("keeps disabled header fields hidden", async () => {
    const result = await withFnbReceiptBrand({ ...base, storeName: undefined, storeAddress: undefined, storePhone: undefined });
    expect(result.storeName).toBeUndefined(); expect(result.storeAddress).toBeUndefined(); expect(result.storePhone).toBeUndefined();
  });
  it("never falls back to the legal company name when the branch name is unavailable", async () => {
    mock.brand.mockResolvedValue({ businessName: "Công ty TNHH" });
    expect((await withFnbReceiptBrand(base)).storeName).toBe(base.storeName);
  });
  it("does not block offline printing with a server lookup", async () => {
    expect(await withFnbReceiptBrand({ ...base, isOffline: true })).toEqual({ ...base, isOffline: true });
    expect(mock.brand).not.toHaveBeenCalled();
  });
  it("retains available cached fields when lookup fails or returned fields are empty", async () => {
    mock.brand.mockResolvedValue({}); expect(await withFnbReceiptBrand(base)).toEqual(base);
    mock.brand.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await withFnbReceiptBrand(base)).toEqual(base); warn.mockRestore();
  });
});
