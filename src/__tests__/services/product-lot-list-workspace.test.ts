import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn(),
  handleError: (error: { message?: string }, context: string) => {
    throw new Error(`[${context}] ${error.message ?? "unknown"}`);
  },
}));

const { getProductLotListWorkspace, getProductLotsForExport } =
  await import("@/lib/services/supabase/production");

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      items: [{
        id: "lot-1", tenant_id: "tenant-1", product_id: "product-1",
        product_name: "Sữa đặc", product_code: "NVL-SUA-001", lot_number: "LOT-001",
        source_type: "purchase", expiry_date: "2026-08-20", received_date: "2026-07-01",
        initial_qty: "24.5", current_qty: "5.17", branch_id: "branch-1", branch_name: "Kho tổng",
        status: "active", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
        days_remaining: 8,
      }],
      total: 37,
      summary: { activeCount: 30, currentQty: "125.67", expiredCount: 2, nearExpiryCount: 5 },
    }, error: null,
  });
});

describe("getProductLotListWorkspace", () => {
  it("maps quantities, branch and whole-filter metrics without rounding decimals", async () => {
    const result = await getProductLotListWorkspace({ page: 0, pageSize: 20 });
    expect(result.data[0]).toMatchObject({ lotNumber: "LOT-001", branchName: "Kho tổng", currentQty: 5.17, daysUntilExpiry: 8 });
    expect(result.total).toBe(37);
    expect(result.summary).toEqual({ activeCount: 30, currentQty: 125.67, expiredCount: 2, nearExpiryCount: 5 });
  });

  it("passes every search, status, expiry and branch filter to one RPC", async () => {
    await getProductLotListWorkspace({
      page: 2, pageSize: 50, search: " NVL-SUA ", searchField: "product_code",
      statuses: ["active", "consumed"], sourceTypes: ["purchase"], expiryState: "upcoming",
      thresholdDays: 45, receivedFrom: "2026-08-01", receivedToExclusive: "2026-09-01", branchId: "branch-1",
    });
    expect(rpc).toHaveBeenCalledWith("get_product_lot_list_workspace", {
      p_page: 2, p_page_size: 50, p_search: "NVL-SUA", p_search_field: "product_code",
      p_statuses: ["active", "consumed"], p_source_types: ["purchase"], p_expiry_state: "upcoming",
      p_threshold_days: 45, p_received_from: "2026-08-01", p_received_to_exclusive: "2026-09-01",
      p_branch_id: "branch-1",
    });
  });

  it("exports every page from the same filtered workspace", async () => {
    rpc
      .mockResolvedValueOnce({ data: { items: [{ id: "1", lot_number: "A" }], total: 2, summary: {} }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ id: "2", lot_number: "B" }], total: 2, summary: {} }, error: null });
    const rows = await getProductLotsForExport({ branchId: "branch-1" });
    expect(rows.map((row) => row.lotNumber)).toEqual(["A", "B"]);
    expect(rpc).toHaveBeenNthCalledWith(2, "get_product_lot_list_workspace", expect.objectContaining({ p_page: 1, p_page_size: 200, p_branch_id: "branch-1" }));
  });
});

describe("product lot workspace contract", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/00317_product_lot_list_workspace.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(root, "supabase/migrations/00317_rollback_product_lot_list_workspace.sql"), "utf8");
  const lotPage = fs.readFileSync(path.join(root, "src/app/(main)/hang-hoa/lo-san-xuat/page.tsx"), "utf8");
  const expiryPage = fs.readFileSync(path.join(root, "src/app/(main)/hang-hoa/hsd/page.tsx"), "utf8");

  it("keeps SQL read-only, tenant scoped, permission scoped and branch scoped", () => {
    const sql = migration.replace(/^--.*$/gm, "");
    expect(migration).toContain("stable security invoker");
    expect(migration).toContain("inventory.view");
    expect(migration).toContain("get_user_accessible_branches");
    expect(migration).toContain("l.tenant_id=v_tenant");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });

  it("uses one workspace for list, metrics, branch scope and full exports on both pages", () => {
    for (const page of [lotPage, expiryPage]) {
      expect(page).toContain("getProductLotListWorkspace");
      expect(page).toContain("getProductLotsForExport");
      expect(page).toMatch(/duocXemToanChuoi\s*&&\s*viewAllBranches\s*\?\s*undefined\s*:\s*activeBranchId/);
      expect(page).toContain("pageCount=");
      expect(page).not.toContain("getAllProductLots");
      expect(page).not.toContain("getExpiringLots");
    }
  });

  it("provides an exact rollback without touching business rows", () => {
    expect(rollback).toContain("drop function if exists public.get_product_lot_list_workspace");
    expect(rollback).not.toMatch(/\b(insert|update|delete|truncate|alter)\b/i);
  });
});
