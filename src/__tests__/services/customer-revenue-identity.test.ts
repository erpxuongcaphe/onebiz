import { expect, it, vi } from "vitest";
import { getTopCustomersByRevenue } from "@/lib/services/supabase/analytics";

const mock = vi.hoisted(() => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  };
  return { query, from: vi.fn(() => query) };
});

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mock.from }),
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: Error) => { throw error; },
}));

it("aggregates explicitly linked internal and standard customers without changing totals or grouping by similar names", async () => {
  const standard = { id: "standard", name: "Xưởng Tư Búa", code: "KHA-NBO-002", customer_groups: { name: "Khách nội bộ" } };
  mock.query.range.mockResolvedValue({
    data: [
      { customer_id: "legacy", total: 100, customers: { code: "KH-NB-CNH-XTB", canonical: standard } },
      { customer_id: "standard", total: 200, customers: standard },
      { customer_id: "other", total: 50, customers: { name: standard.name, code: "KHA-KSI-013" } },
    ],
    error: null,
  });

  const rows = await getTopCustomersByRevenue(null, "warehouse", { from: "2026-11-01", to: "2026-11-19" });

  expect(rows).toEqual([
    { rank: 1, customerId: standard.id, name: standard.name, code: standard.code, groupName: "Khách nội bộ", revenue: 300, orders: 2 },
    { rank: 2, customerId: "other", name: standard.name, code: "KHA-KSI-013", revenue: 50, orders: 1 },
  ]);
  expect(mock.query.eq).toHaveBeenCalledWith("branch_id", "warehouse");
});
