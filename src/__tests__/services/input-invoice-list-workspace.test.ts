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

const { getInputInvoiceListWorkspace, getInputInvoicesForExport } =
  await import("@/lib/services/supabase/purchase-entries");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [{
        id: "ii-1",
        code: "HDV000001",
        created_at: "2026-08-11T01:00:00Z",
        supplier_name: "Nhà cung cấp A",
        supplier_code: "NCC-001",
        total_amount: "1250000",
        tax_amount: "125000",
        status: "unrecorded",
        created_by: "user-1",
        branch_id: "branch-1",
        note: "Hóa đơn tháng 8",
        profiles: { full_name: "Nhân viên A" },
        branches: { name: "Chi nhánh A" },
      }],
      total: 31,
      summary: {
        recordedCount: 12,
        unrecordedCount: 16,
        cancelledCount: 3,
        activeValue: "18500000",
        taxValue: "1850000",
      },
    },
    error: null,
  });
});

describe("getInputInvoiceListWorkspace", () => {
  it("maps supplier, branch and whole-filter metrics", async () => {
    const result = await getInputInvoiceListWorkspace({ page: 0, pageSize: 20 });

    expect(result.data[0]).toMatchObject({
      code: "HDV000001",
      supplierCode: "NCC-001",
      supplierName: "Nhà cung cấp A",
      branchId: "branch-1",
      branchName: "Chi nhánh A",
      note: "Hóa đơn tháng 8",
    });
    expect(result.total).toBe(31);
    expect(result.summary).toEqual({
      recordedCount: 12,
      unrecordedCount: 16,
      cancelledCount: 3,
      activeValue: 18500000,
      taxValue: 1850000,
    });
  });

  it("passes every filter and the Vietnam date window to the RPC", async () => {
    await getInputInvoiceListWorkspace({
      page: 2,
      pageSize: 50,
      search: " NCC-001 ",
      searchField: "supplier",
      status: "unrecorded",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      amountMin: 100000,
      amountMax: 9000000,
      branchId: "branch-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "get_input_invoice_list_workspace",
      expect.objectContaining({
        p_page: 2,
        p_page_size: 50,
        p_search: "NCC-001",
        p_search_field: "supplier",
        p_status: "unrecorded",
        p_date_from: "2026-07-31T17:00:00.000Z",
        p_date_to_exclusive: "2026-08-10T17:00:00.000Z",
        p_amount_min: 100000,
        p_amount_max: 9000000,
        p_branch_id: "branch-1",
      }),
    );
  });

  it("exports every page from the same filtered workspace", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { items: [{ id: "ii-1", code: "A", status: "recorded" }], total: 2, summary: {} },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: "ii-2", code: "B", status: "recorded" }], total: 2, summary: {} },
        error: null,
      });

    const rows = await getInputInvoicesForExport({ status: "recorded" });
    expect(rows.map((row) => row.code)).toEqual(["A", "B"]);
    expect(rpc).toHaveBeenNthCalledWith(2, "get_input_invoice_list_workspace", expect.objectContaining({ p_page: 1, p_page_size: 200 }));
  });
});

describe("input-invoice workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/00313_input_invoice_list_workspace.sql"),
    "utf8",
  );
  const rollback = fs.readFileSync(
    path.join(root, "supabase/migrations/00313_rollback_input_invoice_list_workspace.sql"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(root, "src/app/(main)/hang-hoa/hoa-don-dau-vao/page.tsx"),
    "utf8",
  );

  it("keeps the RPC read-only, tenant-scoped and permission-scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("inventory.view");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("ii.tenant_id = v_tenant");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });

  it("uses one workspace for list, metrics, filters and complete exports", () => {
    expect(page).toContain("getInputInvoiceListWorkspace");
    expect(page).toContain("getInputInvoicesForExport");
    expect(page).toContain("summary.unrecordedCount");
    expect(page).toContain('searchField={searchField}');
    expect(page).toContain("<RangeFilter");
    expect(page).not.toContain("Đã ghi sổ trang này");
    expect(page).not.toMatch(/const pageRecorded = data\.filter/);
  });

  it("provides an exact rollback without touching business rows", () => {
    expect(rollback).toContain("drop function if exists public.get_input_invoice_list_workspace");
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });
});
