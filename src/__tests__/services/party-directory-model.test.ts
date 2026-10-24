import { describe, expect, it } from "vitest";
import { customerDirectoryModel, customerEditProfile, supplierDirectoryModel, supplierEditProfile, directoryScopeLabel } from "@/lib/services/supabase/party-directory-model";
import type { PartyDirectoryPage } from "@/lib/services/supabase/party-directory-reader";

function page(visible: boolean): PartyDirectoryPage {
  return { revision: "a".repeat(32), scope: { scope: "branch", branchIds: ["branch-a"] }, total: 100,
    canViewActivity: visible, canViewDebt: visible, activity: visible ? 9999 : null, returns: visible ? 20 : null,
    netSales: visible ? 9979 : null, debt: visible ? -50 : null, partiesWithDebt: visible ? 2 : null,
    contacts: [{ id: "contact-a", code: "C001", name: "Contact A", phone: "0901", type: "company", createdAt: "2026-10-01T00:00:00Z",
      email: "contact@example.invalid", address: "Synthetic address", houseNumber: "10", street: "Synthetic street",
      quarter: "Q", ward: "W", province: "P", country: "VN", taxCode: "TEST-TAX", note: "Supplier note",
      groupId: "group-a", groupName: "Group A", groupDiscountPercent: 5, priceTierId: "tier-a",
      loyaltyPoints: 12, loyaltyTierId: "loyalty-a", loyaltyTierName: "Tier A", loyaltyTierDiscount: 2,
      tags: ["tag-a"], birthday: "1990-01-01", lastPurchaseAt: visible ? "2026-10-01T00:00:00Z" : null,
      activity: visible ? 100 : null, returns: visible ? 20 : null, orders: visible ? 1 : null, debt: visible ? -10 : null }],
  };
}
describe("directory contact and financial view models", () => {
  it("distinguishes company totals from assigned branches and contact-only scope", () => {
    expect(directoryScopeLabel({ scope: "company", branchIds: ["a", "b"] })).toBe("Toàn công ty");
    expect(directoryScopeLabel({ scope: "assigned", branchIds: ["a", "b"] })).toBe("2 chi nhánh được giao");
    expect(directoryScopeLabel({ scope: "assigned", branchIds: [] })).toBe("Liên hệ dùng chung");
  });
  it("preserves customer contact, pricing and loyalty fields without replacing filtered totals by page sums", () => {
    const result = customerDirectoryModel(page(true));
    expect(result.summary.totalSales).toBe(9999);
    expect(result.data[0]).toMatchObject({ email: "contact@example.invalid", houseNumber: "10", street: "Synthetic street",
      taxCode: "TEST-TAX", groupId: "group-a", groupDiscountPercent: 5, priceTierId: "tier-a", loyaltyPoints: 12,
      totalSales: 100, totalSalesMinusReturns: 80, currentDebt: -10 });
  });
  it("keeps hidden customer financial fields null, not zero", () => {
    const result = customerDirectoryModel(page(false));
    expect(result.summary.totalSales).toBeNull(); expect(result.summary.totalDebt).toBeNull();
    expect(result.data[0]).toMatchObject({ currentDebt: null, totalSales: null, totalSalesMinusReturns: null, lastPurchaseAt: null });
  });
  it("prepares editable customer contact data without financial fields or mutating the original", () => {
    const row = Object.freeze(customerDirectoryModel(page(false)).data[0]);
    const profile = customerEditProfile(row);
    for (const key of ["currentDebt", "totalSales", "totalSalesMinusReturns", "activity", "debt", "returns", "orders"]) expect(profile).not.toHaveProperty(key);
    expect(profile.priceTierId).toBe("tier-a"); expect(row.currentDebt).toBeNull();
  });
  it("preserves supplier profile/note and its independently masked amounts", () => {
    const result = supplierDirectoryModel(page(false));
    expect(result.data[0]).toMatchObject({ name: "Contact A", note: "Supplier note", taxCode: "TEST-TAX", currentDebt: null, totalPurchases: null });
    expect(result.summary.totalPurchases).toBeNull();
    const profile = supplierEditProfile(result.data[0]);
    expect(profile).not.toHaveProperty("currentDebt"); expect(profile).not.toHaveProperty("totalPurchases");
    expect(profile).not.toHaveProperty("loyaltyPoints");
  });
});
