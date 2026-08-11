import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getPaginationRange: () => ({ from: 0, to: 14 }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

vi.mock("@/lib/services/supabase/audit", () => ({
  recordAuditLog: vi.fn(),
}));

const { getCustomerListWorkspace } =
  await import("@/lib/services/supabase/customers");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [
        {
          id: "customer-1",
          code: "KHA-001",
          name: "Khách Một",
          phone: "0901",
          debt: "250000",
          total_spent: "1750000.5",
          returned_total: "150000",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      total: 37,
      summary: {
        totalSales: "9250000.5",
        totalReturns: "500000",
        netSales: "8750000.5",
        totalDebt: "1250000",
        customersWithDebt: 4,
        canViewDebt: true,
      },
    },
    error: null,
  });
});

describe("getCustomerListWorkspace", () => {
  it("maps rows and full-result metrics from one read-only RPC", async () => {
    const result = await getCustomerListWorkspace({ page: 0, pageSize: 15 });

    expect(result.total).toBe(37);
    expect(result.data[0]).toMatchObject({
      id: "customer-1",
      currentDebt: 250000,
      totalSales: 1_750_000.5,
      totalSalesMinusReturns: 1_600_000.5,
    });
    expect(result.summary).toEqual({
      totalSales: 9_250_000.5,
      totalReturns: 500000,
      netSales: 8_750_000.5,
      totalDebt: 1_250_000,
      customersWithDebt: 4,
      canViewDebt: true,
    });
  });

  it("passes birthday, segmentation and date filters to the server", async () => {
    await getCustomerListWorkspace({
      page: 2,
      pageSize: 50,
      search: " KH ",
      searchField: "phone",
      groupIds: ["00000000-0000-0000-0000-000000000001"],
      customerType: "company",
      gender: "female",
      debtFilter: "has_debt",
      salesRange: "tier_vip",
      ordersRange: "frequent",
      lastPurchase: "month",
      birthdayMonth: "8",
      tags: ["VIP"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      province: "Đồng Nai",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_customer_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "KH",
        p_search_field: "phone",
        p_customer_type: "company",
        p_gender: "female",
        p_debt_filter: "has_debt",
        p_sales_range: "tier_vip",
        p_orders_range: "frequent",
        p_last_purchase: "month",
        p_birthday_month: 8,
        p_tags: ["VIP"],
        p_created_from: "2026-07-31T17:00:00.000Z",
        p_created_to_exclusive: "2026-08-10T17:00:00.000Z",
        p_province: "Đồng Nai",
      }),
    );
  });
});

describe("customer list wiring", () => {
  const root = process.cwd();
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/khach-hang/page.tsx"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00309_customer_list_workspace.sql"),
    "utf8",
  );

  it("removes the dead creator filter and moves birthday filtering server-side", () => {
    expect(page).not.toContain("creatorFilter");
    expect(page).not.toContain("getProfilesForPersonFilter");
    expect(page).toContain("birthdayMonth: birthdayMonthFilter");
    expect(page).toContain("summary.netSales");
    expect(page).toContain("<FilterPanel");
    expect(page).not.toContain("<SummaryCard");
  });

  it("keeps the RPC read-only and protects debt metrics on the server", () => {
    const sqlWithoutComments = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("public.get_user_tenant_id()");
    expect(migration).toContain(
      "public.user_has_permission(v_actor, 'customers.view')",
    );
    expect(migration).toContain(
      "public.user_has_permission(v_actor, 'customers.view_debt')",
    );
    expect(migration).toContain("extract(month from s.birthday)");
    expect(sqlWithoutComments).not.toMatch(
      /\b(update|delete from|insert into|alter table)\b/i,
    );
  });
});
