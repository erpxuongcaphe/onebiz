import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ row: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mock.row }) }) }) }),
  getCurrentTenantId: async () => "tenant",
}));
vi.mock("@/lib/services/supabase/tenant-settings", () => ({ getTenantBusinessInfo: mock.tenant }));
import { getResolvedBrand } from "@/lib/services/supabase/print-templates-engine";
beforeEach(() => {
  mock.tenant.mockResolvedValue({ businessName: "Công ty", address: "Trụ sở", phone: "Hotline công ty", taxCode: "MST", bankAccount: "123" });
});
describe("F&B contact isolation", () => {
  it("uses actual outlet identity even if an old company-name print override exists", async () => {
    mock.row.mockResolvedValue({ data: { name: "Xưởng Tư Búa", address: "03 Trần Minh Trí", phone: "0915667500", print_brand: { businessName: "Công ty cũ" } } });
    const brand = await getResolvedBrand("branch", { branchOnly: true });
    expect(brand).toMatchObject({ businessName: "Xưởng Tư Búa", branchName: "Xưởng Tư Búa", phone: "0915667500", address: "03 Trần Minh Trí", bankAccount: "123" });
    expect(brand.taxCode).toBeUndefined();
  });
  it("never fills missing branch contacts from the company", async () => {
    mock.row.mockResolvedValue({ data: { name: "Quán", print_brand: null } });
    const brand = await getResolvedBrand("branch", { branchOnly: true });
    expect(brand.address).toBeUndefined();
    expect(brand.phone).toBeUndefined();
    expect((await getResolvedBrand("branch")).phone).toBe("Hotline công ty");
  });
  it("keeps branch-specific editable contact overrides", async () => {
    mock.row.mockResolvedValue({ data: { name: "Quán", phone: "Hồ sơ", print_brand: { phone: "Số in riêng", address: "Địa chỉ in riêng" } } });
    expect(await getResolvedBrand("branch", { branchOnly: true })).toMatchObject({ phone: "Số in riêng", address: "Địa chỉ in riêng" });
  });
});
