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

const { getSupplierListWorkspace } =
  await import("@/lib/services/supabase/suppliers");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [
        {
          id: "supplier-1",
          code: "NCC001",
          name: "NCC Một",
          phone: "0901",
          debt: "250000",
          total_purchases: "1750000.5",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      total: 27,
      summary: {
        totalPurchases: "9250000.5",
        totalDebt: "1250000",
        suppliersWithDebt: 4,
      },
    },
    error: null,
  });
});

describe("getSupplierListWorkspace", () => {
  it("maps rows and full-filter summary from one read-only RPC", async () => {
    const result = await getSupplierListWorkspace({ page: 0, pageSize: 15 });

    expect(result.total).toBe(27);
    expect(result.data[0]).toMatchObject({
      id: "supplier-1",
      currentDebt: 250000,
      totalPurchases: 1_750_000.5,
    });
    expect(result.summary).toEqual({
      totalPurchases: 9_250_000.5,
      totalDebt: 1_250_000,
      suppliersWithDebt: 4,
    });
  });

  it("passes purchase/debt/date/province filters with an exclusive end date", async () => {
    await getSupplierListWorkspace({
      page: 2,
      pageSize: 50,
      search: " NCC ",
      searchField: "code",
      statuses: ["active"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      province: "Đồng Nai",
      debtFrom: "100000",
      debtTo: "900000",
      totalPurchaseFrom: "2000000",
      totalPurchaseTo: "8000000",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_supplier_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "NCC",
        p_search_field: "code",
        p_statuses: ["active"],
        p_created_from: "2026-07-31T17:00:00.000Z",
        p_created_to_exclusive: "2026-08-10T17:00:00.000Z",
        p_province: "Đồng Nai",
        p_debt_min: 100000,
        p_debt_max: 900000,
        p_total_purchase_min: 2000000,
        p_total_purchase_max: 8000000,
      }),
    );
  });
});

describe("supplier list wiring", () => {
  const root = process.cwd();
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/hang-hoa/nha-cung-cap/page.tsx"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00308_supplier_list_workspace.sql"),
    "utf8",
  );

  it("removes the fake supplier-group filter and wires purchase range", () => {
    expect(page).not.toContain('label="Nhóm NCC"');
    expect(page).toContain("totalPurchaseFrom: totalBuyFrom");
    expect(page).toContain("totalPurchaseTo: totalBuyTo");
    expect(page).toContain("summary.totalPurchases");
    expect(page).toContain("summary.totalDebt");
  });

  it("keeps the RPC read-only and server-authorized", () => {
    const sqlWithoutComments = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("public.get_user_tenant_id()");
    expect(migration).toContain(
      "public.user_has_permission(v_actor, 'suppliers.view')",
    );
    expect(sqlWithoutComments).not.toMatch(
      /\b(update|delete from|insert into|alter table)\b/i,
    );
  });
});
