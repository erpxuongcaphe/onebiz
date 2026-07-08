// Branch Stock service — Per-branch inventory tracking
//
// Multi-tenant safety: mọi query filter tenant_id ngay đầu chain.
// branch_stock có cột tenant_id; products + branches join cũng cần check.

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import type { BranchStock } from "@/lib/types";

const supabase = getClient();

export interface BranchStockRow {
  id: string;
  branchId: string;
  branchName: string;
  branchCode?: string;
  productId: string;
  productCode: string;
  productName: string;
  productType?: "nvl" | "sku";
  unit?: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  reserved: number;
  available: number;
  minStock?: number;
  maxStock?: number;
  costPrice?: number;
  stockValue: number;
  updatedAt: string;
}


function logicalBranchStockKey(row: Pick<BranchStockRow, "branchId" | "productId" | "variantId">): string {
  return `${row.branchId}:${row.productId}:${row.variantId ?? "__base__"}`;
}

function latestIso(a: string | undefined, b: string | undefined): string {
  if (!a) return b ?? "";
  if (!b) return a;
  return a >= b ? a : b;
}

function mergeBranchStockRows(rows: BranchStockRow[]): BranchStockRow[] {
  const merged = new Map<string, BranchStockRow>();

  for (const row of rows) {
    const key = logicalBranchStockKey(row);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }

    const quantity = existing.quantity + row.quantity;
    const reserved = existing.reserved + row.reserved;
    const cost = existing.costPrice ?? row.costPrice ?? 0;

    merged.set(key, {
      ...existing,
      quantity,
      reserved,
      available: quantity - reserved,
      costPrice: cost,
      stockValue: quantity * cost,
      updatedAt: latestIso(existing.updatedAt, row.updatedAt),
    });
  }

  return Array.from(merged.values());
}
export async function getBranchStock(params?: {
  branchId?: string;
  productId?: string;
}): Promise<BranchStock[]> {
  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("branch_stock")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  if (params?.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    productId: row.product_id,
    variantId: row.variant_id ?? undefined,
    quantity: row.quantity,
    reserved: row.reserved,
    updatedAt: row.updated_at,
  }));
}

/**
 * Lấy tồn kho dạng row hiển thị — join với products + branches.
 * Có filter productType (nvl/sku), search code/name, branch.
 *
 * Overload: trả về array trực tiếp (backward compat) khi không có limit/includeCount,
 *           hoặc { rows, total } khi cần server-side pagination.
 */
export async function getBranchStockRows(params?: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<BranchStockRow[]> {
  const result = await getBranchStockPage(params ?? {});
  return result.rows;
}

/**
 * Server-side paginated version — returns { rows, total }.
 * Server-side filters: branchId, productType (inner join), search (OR code/name ilike).
 * Client-side filter: lowStockOnly (cross-column comparison, khó làm server-side).
 */
export async function getBranchStockPage(params: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rows: BranchStockRow[]; total: number }> {
  const tenantId = await getCurrentTenantId();
  // A2 08/07/2026 (Cách B): LUÔN inner join products để loại được món menu F&B
  // trong MỌI trường hợp (kể cả khi không filter/search). An toàn vì
  // branch_stock.product_id là NOT NULL + FK ON DELETE RESTRICT (migration 00049)
  // → mọi dòng branch_stock LUÔN có product khớp, không có orphan → inner join
  // KHÔNG làm rớt dòng hợp lệ nào của hàng KHÔNG phải menu (NVL/SKU Retail).
  // Trước đây chỉ inner khi có filter → không filter thì món menu vẫn lọt vào
  // danh sách tồn (bug Cách B).
  // CEO 28/05/2026: cú pháp embed PostgREST đúng là `alias:fk!inner`, KHÔNG phải
  // `alias!inner:fk` (đặt !inner ở giữa → PGRST100 "failed to parse select
  // parameter" → HTTP 400 → toast "Lỗi tải tồn kho").
  const productsRel =
    "products:product_id!inner ( id, code, name, product_type, unit, cost_price, min_stock, max_stock )";

  let query = supabase
    .from("branch_stock")
    .select(
      `
      id,
      branch_id,
      product_id,
      variant_id,
      quantity,
      reserved,
      updated_at,
      branches:branch_id ( id, name, code ),
      ${productsRel},
      product_variants:variant_id ( id, name )
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.productType) query = query.eq("products.product_type", params.productType);
  // A2 08/07 (Cách B): loại món menu F&B (không giữ tồn) khỏi danh sách tồn kho —
  // áp LUÔN nhờ inner join cố định ở trên (không còn phụ thuộc có filter hay không).
  query = query.neq("products.inventory_role", "fnb_menu_item");
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,name.ilike.%${esc}%`,
      { foreignTable: "products" }
    );
  }

  // Server-side pagination
  if (typeof params.offset === "number" && typeof params.limit === "number") {
    query = query.range(params.offset, params.offset + params.limit - 1);
  } else if (typeof params.limit === "number") {
    query = query.range(0, params.limit - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRows: BranchStockRow[] = (data ?? []).map((row: any) => {
    const product = row.products ?? {};
    const branch = row.branches ?? {};
    const variant = row.product_variants ?? null;
    const quantity = Number(row.quantity ?? 0);
    const reserved = Number(row.reserved ?? 0);
    const cost = Number(product.cost_price ?? 0);

    return {
      id: row.id,
      branchId: row.branch_id,
      branchName: branch.name ?? "—",
      branchCode: branch.code ?? undefined,
      productId: row.product_id,
      productCode: product.code ?? "",
      productName: product.name ?? "",
      productType: product.product_type ?? undefined,
      unit: product.unit ?? undefined,
      variantId: row.variant_id ?? undefined,
      variantName: variant?.name ?? undefined,
      quantity,
      reserved,
      available: quantity - reserved,
      minStock: product.min_stock ?? undefined,
      maxStock: product.max_stock ?? undefined,
      costPrice: cost,
      stockValue: quantity * cost,
      updatedAt: row.updated_at,
    };
  });

  const rows = mergeBranchStockRows(rawRows);

  // Client-side filter (lowStockOnly — cross-column comparison)
  let filtered = rows;
  if (params.lowStockOnly) {
    filtered = filtered.filter(
      (r) => r.minStock !== undefined && r.quantity <= (r.minStock ?? 0)
    );
  }

  const total = rawRows.length !== rows.length || params.lowStockOnly ? filtered.length : count ?? filtered.length;
  return { rows: filtered, total };
}

/**
 * Aggregates tồn kho (total rows, total qty, total value, low stock count) —
 * lightweight query không join branches/variants, chỉ lấy quantity + cost_price.
 * Dùng cho summary card ở trang tồn kho mà không phải load full rows.
 */
export async function getBranchStockAggregates(params: {
  branchId?: string;
  productType?: "nvl" | "sku";
  search?: string;
}): Promise<{
  totalRows: number;
  totalQty: number;
  totalValue: number;
  lowStockCount: number;
}> {
  // A2 08/07/2026 (Cách B): LUÔN inner join products để loại món menu F&B khỏi
  // số liệu tổng (tổng dòng/tổng tồn/giá trị/low-stock) trong MỌI trường hợp —
  // khớp getBranchStockPage. An toàn vì branch_stock.product_id NOT NULL + FK
  // RESTRICT (không orphan). Trước đây chỉ inner khi có filter → summary card
  // không filter vẫn cộng cả món menu vào giá trị tồn (giá vốn) → phồng số.
  // CEO 28/05/2026: cú pháp đúng `alias:fk!inner` (xem getBranchStockPage).
  const productsRel =
    "products:product_id!inner ( product_type, code, name, cost_price, min_stock )";

  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("branch_stock")
    .select(
      `
      branch_id,
      product_id,
      variant_id,
      quantity,
      ${productsRel}
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId);

  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.productType) query = query.eq("products.product_type", params.productType);
  // A2 08/07 (Cách B): loại món menu F&B khỏi số liệu tổng — áp LUÔN nhờ inner join
  // cố định ở trên (không còn phụ thuộc có filter hay không).
  query = query.neq("products.inventory_role", "fnb_menu_item");
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,name.ilike.%${esc}%`,
      { foreignTable: "products" }
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const grouped = new Map<string, { quantity: number; cost: number; minStock?: number | null }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const key = `${row.branch_id}:${row.product_id}:${row.variant_id ?? "__base__"}`;
    const current = grouped.get(key) ?? { quantity: 0, cost: 0, minStock: null };
    const product = row.products ?? {};
    grouped.set(key, {
      quantity: current.quantity + Number(row.quantity ?? 0),
      cost: Number(product.cost_price ?? current.cost ?? 0),
      minStock: product.min_stock ?? current.minStock,
    });
  }

  let totalQty = 0;
  let totalValue = 0;
  let lowStockCount = 0;
  for (const row of grouped.values()) {
    totalQty += row.quantity;
    totalValue += row.quantity * row.cost;
    if (row.minStock !== undefined && row.minStock !== null && row.quantity <= Number(row.minStock)) {
      lowStockCount += 1;
    }
  }

  return {
    totalRows: grouped.size,
    totalQty,
    totalValue,
    lowStockCount,
  };
}

export async function getProductStockByBranch(productId: string) {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("branch_stock")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .gt("quantity", 0);

  if (error) throw error;
  return data ?? [];
}

/**
 * Lấy breakdown tồn kho của 1 sản phẩm ở TẤT CẢ chi nhánh (bao gồm 0 tồn) —
 * kèm branchName + branchCode + reserved + available. Dùng cho detail panel.
 */
export async function getProductStockBreakdown(
  productId: string,
): Promise<Array<{
  branchId: string;
  branchName: string;
  branchCode?: string;
  quantity: number;
  reserved: number;
  available: number;
  updatedAt: string;
}>> {
  const tenantId = await getCurrentTenantId();

  // P1-3C-K6 12/06/2026: list TẤT CẢ chi nhánh active (kể cả qty=0 chưa từng
  // nhập SP này). Trước đây chỉ trả branch_stock đã tồn tại → user thấy
  // "có ở 3/5 CN" mà thực ra 2 CN còn lại là "chưa từng nhập" ≠ "hết hàng".
  const [stockRes, branchRes] = await Promise.all([
    supabase
      .from("branch_stock")
      .select("branch_id, quantity, reserved, updated_at")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId),
    supabase
      .from("branches")
      .select("id, name, code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
  ]);
  if (stockRes.error) throw stockRes.error;
  if (branchRes.error) throw branchRes.error;

  const stockByBranch = new Map<string, { quantity: number; reserved: number; updated_at: string }>();
  for (const r of stockRes.data ?? []) {
    const row = r as { branch_id: string; quantity?: number; reserved?: number; updated_at?: string };
    const current = stockByBranch.get(row.branch_id) ?? { quantity: 0, reserved: 0, updated_at: "" };
    stockByBranch.set(row.branch_id, {
      quantity: current.quantity + Number(row.quantity ?? 0),
      reserved: current.reserved + Number(row.reserved ?? 0),
      updated_at: latestIso(current.updated_at, row.updated_at),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (branchRes.data ?? []).map((b: any) => {
    const s = stockByBranch.get(b.id);
    const qty = Number(s?.quantity ?? 0);
    const reserved = Number(s?.reserved ?? 0);
    return {
      branchId: b.id as string,
      branchName: (b.name as string) ?? "—",
      branchCode: (b.code as string) ?? undefined,
      quantity: qty,
      reserved,
      available: qty - reserved,
      updatedAt: s?.updated_at ?? "",
    };
  });

  // Sort: branches có tồn lên trước, rồi alphabet.
  rows.sort((a, b) => {
    if ((b.quantity ?? 0) !== (a.quantity ?? 0)) return (b.quantity ?? 0) - (a.quantity ?? 0);
    return a.branchName.localeCompare(b.branchName);
  });

  return rows;
}
