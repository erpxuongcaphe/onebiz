import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  getPaginationRange: () => ({ from: 0, to: 19 }),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

vi.mock("@/lib/services/supabase/purchase-orders", () => ({
  updatePurchaseOrderStatus: vi.fn(),
}));

const { getPurchaseOrderListWorkspace } =
  await import("@/lib/services/supabase/purchase-entries");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [{
        id: "po-1",
        code: "PO000001",
        created_at: "2026-08-11T01:00:00Z",
        supplier_name: "Nhà cung cấp A",
        supplier_code: "NCC-001",
        total: "1250000",
        status: "ordered",
        created_by: "user-1",
        branch_id: "branch-1",
        profiles: { full_name: "Nhân viên A" },
        branches: { name: "Chi nhánh A" },
      }],
      total: 31,
      summary: {
        outstandingCount: 12,
        outstandingValue: "18500000",
        completedCount: 16,
        cancelledCount: 3,
      },
    },
    error: null,
  });
});

describe("getPurchaseOrderListWorkspace", () => {
  it("maps branch, supplier and whole-filter metrics", async () => {
    const result = await getPurchaseOrderListWorkspace({ page: 0, pageSize: 20 });

    expect(result.data[0]).toMatchObject({
      code: "PO000001",
      status: "pending",
      supplierCode: "NCC-001",
      branchId: "branch-1",
      branchName: "Chi nhánh A",
      createdByName: "Nhân viên A",
    });
    expect(result.total).toBe(31);
    expect(result.summary).toEqual({
      outstandingCount: 12,
      outstandingValue: 18500000,
      completedCount: 16,
      cancelledCount: 3,
    });
  });

  it("passes every list filter and the Vietnam date window to the RPC", async () => {
    await getPurchaseOrderListWorkspace({
      page: 2,
      pageSize: 50,
      search: " NCC-001 ",
      searchField: "supplier",
      status: "partial",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      amountMin: 100000,
      amountMax: 9000000,
      branchId: "branch-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_purchase_order_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "NCC-001",
        p_search_field: "supplier",
        p_status: "partial",
        p_date_from: "2026-07-31T17:00:00.000Z",
        p_date_to_exclusive: "2026-08-10T17:00:00.000Z",
        p_amount_min: 100000,
        p_amount_max: 9000000,
        p_branch_id: "branch-1",
      }),
    );
  });
});

describe("purchase-order list workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00312_purchase_order_list_workspace.sql"),
    "utf8",
  );
  const rollback = fs.readFileSync(
    path.join(root, "supabase/migrations/00312_rollback_purchase_order_list_workspace.sql"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/hang-hoa/dat-hang-nhap/page.tsx"),
    "utf8",
  );

  it("keeps the RPC read-only, tenant-scoped and permission-scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("inventory.view");
    expect(migration).toContain("reports.view_all_branches");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("po.tenant_id = v_tenant");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });

  it("uses one workspace for the list and whole-filter metrics", () => {
    expect(page).toContain("getPurchaseOrderListWorkspace");
    expect(page).toContain("summary.outstandingCount");
    expect(page).toContain('searchField={searchField}');
    expect(page).toContain('<RangeFilter');
    expect(page).not.toContain("Chờ / đang nhập trang này");
    expect(page).not.toMatch(/const kpiOutstanding = data\.filter/);
  });

  it("provides an exact rollback without touching business rows", () => {
    expect(rollback).toContain("drop function if exists public.get_purchase_order_list_workspace");
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });
});
