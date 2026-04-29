/**
 * Supabase service: Inventory operations
 *
 * - inventory_checks: from Supabase (read + apply)
 * - disposal_exports, internal_exports: from Supabase (read + filter)
 * - manufacturing: removed — handled by production.ts
 *
 * Apply flow (G7 fix):
 *   `applyInventoryCheck(checkId)` reads every row from `inventory_check_items`
 *   whose `difference != 0`, splits them into 'in' (actual > system) and 'out'
 *   (actual < system) lists, then routes each list through
 *   `applyManualStockMovement` so the dual-table sync (products.stock +
 *   branch_stock + stock_movements ledger) stays consistent with the rest of
 *   the warehouse dialogs. Finally flips the check status to `balanced`.
 *
 *   stock_movements convention: `quantity` is always positive; direction comes
 *   from the `type` column. Hence we split deltas instead of writing a single
 *   signed 'adjust' row.
 */

import type { InventoryCheck, DisposalExport, InternalExport, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getCurrentContext, getCurrentTenantId, getPaginationRange, handleError } from "./base";
import { applyManualStockMovement, nextEntityCode } from "./stock-adjustments";

// --- Disposal Exports / Xuất hủy (Supabase) ---

const disposalStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDisposalExport(row: any): DisposalExport {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    totalProducts: 0, // Cần aggregate từ disposal_export_items — bỏ qua ở list view
    totalAmount: Number(row.total_amount ?? 0),
    reason: row.reason ?? "",
    status: row.status === "completed" ? "completed" : "draft",
    statusName: disposalStatusNameMap[row.status] ?? row.status,
    createdBy: row.created_by ?? "",
    createdByName: profile?.full_name ?? "",
  };
}

export async function getDisposalExports(params: QueryParams): Promise<QueryResult<DisposalExport>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("disposal_exports")
    .select("*, profiles!disposal_exports_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search theo mã phiếu
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all" && params.filters.status !== "") {
    query = query.eq("status", params.filters.status);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getDisposalExports");

  const exports: DisposalExport[] = (data ?? []).map(mapDisposalExport);
  return { data: exports, total: count ?? 0 };
}

export function getDisposalStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// --- Internal Exports / Xuất dùng nội bộ (Supabase) ---

const internalExportStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInternalExport(row: any): InternalExport {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    totalProducts: 0, // Cần aggregate từ internal_export_items — bỏ qua ở list view
    totalAmount: Number(row.total_amount ?? 0),
    status: row.status === "completed" ? "completed" : "draft",
    statusName: internalExportStatusNameMap[row.status] ?? row.status,
    note: row.note ?? undefined,
    createdBy: row.created_by ?? "",
    createdByName: profile?.full_name ?? "",
  };
}

export async function getInternalExports(params: QueryParams): Promise<QueryResult<InternalExport>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("internal_exports")
    .select("*, profiles!internal_exports_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search theo mã phiếu
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all" && params.filters.status !== "") {
    query = query.eq("status", params.filters.status);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInternalExports");

  const exports: InternalExport[] = (data ?? []).map(mapInternalExport);
  return { data: exports, total: count ?? 0 };
}

export function getInternalExportStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// --- Complete / Cancel Disposal Export ---

/**
 * Hoàn thành phiếu xuất hủy:
 *   1. Atomic claim: UPDATE status='completed' WHERE status='draft'
 *   2. Load disposal_export_items
 *   3. Apply stock-out via applyManualStockMovement
 */
export async function completeDisposalExport(disposalId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. ATOMIC claim
  const { data: claimed, error: claimErr } = await sb
    .from("disposal_exports")
    .update({ status: "completed" })
    .eq("tenant_id", tenantId)
    .eq("id", disposalId)
    .eq("status", "draft")
    .select("id, code")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "completeDisposalExport:claim");
  if (!claimed) {
    const { data: existing } = await sb
      .from("disposal_exports")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", disposalId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu xuất hủy");
    throw new Error(
      `Phiếu xuất hủy đã được xử lý (trạng thái: ${existing.status}). Không thể hoàn tất lại.`
    );
  }

  // 2. Load items — scope qua disposal_id (đã verify ownership)
  const { data: items, error: itemsErr } = await sb
    .from("disposal_export_items")
    .select("id, product_id, product_name, quantity")
    .eq("disposal_id", disposalId);
  if (itemsErr) handleError(itemsErr, "completeDisposalExport:items");
  if (!items || items.length === 0) return;

  // 3. Stock-out
  const ctx = await getCurrentContext();
  await applyManualStockMovement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (items as any[]).map((it: any) => ({
      productId: it.product_id,
      quantity: Number(it.quantity ?? 0),
      type: "out" as const,
      referenceType: "disposal_export",
      referenceId: disposalId,
      note: `${claimed.code} - Xuất hủy - ${it.product_name} (-${it.quantity})`,
    })),
    { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId }
  );
}

/**
 * Hủy phiếu xuất hủy — chỉ cho phép hủy khi ở trạng thái draft.
 */
export async function cancelDisposalExport(disposalId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: claimed, error } = await sb
    .from("disposal_exports")
    .update({ status: "cancelled" })
    .eq("tenant_id", tenantId)
    .eq("id", disposalId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) handleError(error, "cancelDisposalExport");
  if (!claimed) {
    const { data: existing } = await sb
      .from("disposal_exports")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", disposalId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu xuất hủy");
    throw new Error(`Không thể hủy phiếu ở trạng thái "${existing.status}".`);
  }
}

// --- Complete / Cancel Internal Export ---

/**
 * Hoàn thành phiếu xuất nội bộ:
 *   1. Atomic claim: UPDATE status='completed' WHERE status='draft'
 *   2. Load internal_export_items
 *   3. Apply stock-out via applyManualStockMovement
 */
export async function completeInternalExport(exportId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. ATOMIC claim
  const { data: claimed, error: claimErr } = await sb
    .from("internal_exports")
    .update({ status: "completed" })
    .eq("tenant_id", tenantId)
    .eq("id", exportId)
    .eq("status", "draft")
    .select("id, code")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "completeInternalExport:claim");
  if (!claimed) {
    const { data: existing } = await sb
      .from("internal_exports")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", exportId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu xuất nội bộ");
    throw new Error(
      `Phiếu xuất nội bộ đã được xử lý (trạng thái: ${existing.status}). Không thể hoàn tất lại.`
    );
  }

  // 2. Load items — scope qua export_id (đã verify ownership)
  const { data: items, error: itemsErr } = await sb
    .from("internal_export_items")
    .select("id, product_id, product_name, quantity")
    .eq("export_id", exportId);
  if (itemsErr) handleError(itemsErr, "completeInternalExport:items");
  if (!items || items.length === 0) return;

  // 3. Stock-out
  const ctx = await getCurrentContext();
  await applyManualStockMovement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (items as any[]).map((it: any) => ({
      productId: it.product_id,
      quantity: Number(it.quantity ?? 0),
      type: "out" as const,
      referenceType: "internal_export",
      referenceId: exportId,
      note: `${claimed.code} - Xuất nội bộ - ${it.product_name} (-${it.quantity})`,
    })),
    { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId }
  );
}

/**
 * Hủy phiếu xuất nội bộ — chỉ cho phép hủy khi ở trạng thái draft.
 */
export async function cancelInternalExport(exportId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: claimed, error } = await sb
    .from("internal_exports")
    .update({ status: "cancelled" })
    .eq("tenant_id", tenantId)
    .eq("id", exportId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) handleError(error, "cancelInternalExport");
  if (!claimed) {
    const { data: existing } = await sb
      .from("internal_exports")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", exportId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu xuất nội bộ");
    throw new Error(`Không thể hủy phiếu ở trạng thái "${existing.status}".`);
  }
}

// --- Create Internal Export / Xuất nội bộ ---

export interface CreateExportItemInput {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  /** Giá vốn per unit — dùng để tính total_amount cho P&L. */
  unitPrice: number;
}

export interface CreateInternalExportInput {
  /** Phòng ban / nơi nhận / mục đích sử dụng. */
  department: string;
  note?: string;
  items: CreateExportItemInput[];
}

/**
 * Tạo phiếu xuất dùng nội bộ + insert items + apply stock-out trong một luồng.
 *
 * Trước đây dialog chỉ gọi applyManualStockMovement → stock_movements có ghi
 * nhưng header internal_exports không ghi → list view không hiển thị phiếu vừa
 * tạo (ghost record). Fix: insert header (status='completed') → items → stock.
 *
 * NOT atomic cross-table — nếu stock movement fail ở giữa, header/items đã ghi
 * thì auto-flip status='cancelled' để list không show phiếu hỏng. RPC
 * transactional sẽ replace trong sprint KHO-2.
 */
export async function createInternalExport(
  input: CreateInternalExportInput
): Promise<{ id: string; code: string }> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  if (input.items.length === 0) {
    throw new Error("Phiếu xuất nội bộ phải có ít nhất 1 sản phẩm");
  }

  const ctx = await getCurrentContext();
  const code = await nextEntityCode("internal_export", { tenantId: ctx.tenantId });
  const totalAmount = input.items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0
  );

  // 1. Header — create as 'completed' (dialog finalize flow, không qua state draft)
  const { data: header, error: headerErr } = await sb
    .from("internal_exports")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code,
      status: "completed",
      total_amount: totalAmount,
      department: input.department,
      note: input.note ?? null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (headerErr) handleError(headerErr, "createInternalExport:header");
  if (!header) throw new Error("Không tạo được phiếu xuất nội bộ");

  // 2. Items
  const { error: itemsErr } = await sb.from("internal_export_items").insert(
    input.items.map((it) => ({
      export_id: header.id,
      product_id: it.productId,
      product_name: it.productName,
      unit: it.unit,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      total: it.quantity * it.unitPrice,
    }))
  );
  if (itemsErr) {
    // Rollback: xoá header để list không show phiếu rỗng
    await sb.from("internal_exports").delete().eq("id", header.id);
    handleError(itemsErr, "createInternalExport:items");
  }

  // 3. Stock-out với referenceId = header vừa tạo (để FK + audit trail)
  try {
    await applyManualStockMovement(
      input.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        type: "out" as const,
        referenceType: "internal_export",
        referenceId: header.id,
        note: `${header.code} - Xuất nội bộ - ${it.productName} (-${it.quantity})`,
      })),
      { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId }
    );
  } catch (err) {
    // Stock fail → mark cancelled để list không show phiếu "ghost completed"
    // mà stock chưa cập nhật (tránh CEO thấy phiếu completed nhưng tồn kho lệch).
    await sb
      .from("internal_exports")
      .update({ status: "cancelled" })
      .eq("id", header.id);
    throw err;
  }

  return { id: header.id, code: header.code };
}

// --- Create Disposal Export / Xuất hủy ---

export interface CreateDisposalExportInput {
  /** Lý do xuất hủy (hỏng, hết hạn, vỡ...). */
  reason: string;
  note?: string;
  items: CreateExportItemInput[];
}

/**
 * Tạo phiếu xuất hủy + insert items + apply stock-out.
 * Same rationale as createInternalExport above.
 */
export async function createDisposalExport(
  input: CreateDisposalExportInput
): Promise<{ id: string; code: string }> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  if (input.items.length === 0) {
    throw new Error("Phiếu xuất hủy phải có ít nhất 1 sản phẩm");
  }

  const ctx = await getCurrentContext();
  const code = await nextEntityCode("disposal", { tenantId: ctx.tenantId });
  const totalAmount = input.items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0
  );

  // 1. Header
  const { data: header, error: headerErr } = await sb
    .from("disposal_exports")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code,
      status: "completed",
      total_amount: totalAmount,
      reason: input.reason,
      note: input.note ?? null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (headerErr) handleError(headerErr, "createDisposalExport:header");
  if (!header) throw new Error("Không tạo được phiếu xuất hủy");

  // 2. Items
  const { error: itemsErr } = await sb.from("disposal_export_items").insert(
    input.items.map((it) => ({
      disposal_id: header.id,
      product_id: it.productId,
      product_name: it.productName,
      unit: it.unit,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      total: it.quantity * it.unitPrice,
    }))
  );
  if (itemsErr) {
    await sb.from("disposal_exports").delete().eq("id", header.id);
    handleError(itemsErr, "createDisposalExport:items");
  }

  // 3. Stock-out
  try {
    await applyManualStockMovement(
      input.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        type: "out" as const,
        referenceType: "disposal_export",
        referenceId: header.id,
        note: `${header.code} - Xuất hủy - ${it.productName} (-${it.quantity})`,
      })),
      { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId }
    );
  } catch (err) {
    await sb
      .from("disposal_exports")
      .update({ status: "cancelled" })
      .eq("id", header.id);
    throw err;
  }

  return { id: header.id, code: header.code };
}

// --- Inventory Checks (Supabase) ---

export async function getInventoryChecks(params: QueryParams): Promise<QueryResult<InventoryCheck>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("inventory_checks")
    .select("*, profiles!inventory_checks_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all" && params.filters.status !== "") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInventoryChecks");

  const checks: InventoryCheck[] = (data ?? []).map(mapInventoryCheck);
  return { data: checks, total: count ?? 0 };
}

export function getInventoryCheckStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "balanced", label: "Đã cân bằng" },
    { value: "in_progress", label: "Đang xử lý" },
    { value: "draft", label: "Phiếu tạm" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

/* ------------------------------------------------------------------ */
/*  Apply inventory check (G7 fix) — commits real stock deltas        */
/* ------------------------------------------------------------------ */

/**
 * Apply an inventory check:
 *   1. Validate the check is in a mutable state ('draft' | 'in_progress')
 *   2. Read every `inventory_check_items` row
 *   3. For each item with `difference != 0`, derive a manual movement:
 *        - difference > 0 → type='in',  quantity=|difference|  (found more)
 *        - difference < 0 → type='out', quantity=|difference|  (lost some)
 *   4. Route every movement through `applyManualStockMovement` (writes
 *      stock_movements + products.stock + branch_stock in one pass)
 *   5. Flip `inventory_checks.status = 'balanced'`
 *
 * NOT atomic (fetch-then-update loop). Acceptable for single-cashier
 * workflows; a future RPC will wrap this in a single transaction.
 *
 * Throws if the check is already balanced/cancelled, or if it has no items.
 */
export async function applyInventoryCheck(checkId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 1. ATOMIC status flip — claim this check by flipping status to 'balanced'
  //    FIRST. If two concurrent calls race, only one will match the WHERE
  //    clause (status IN draft/in_progress) and succeed. The loser gets 0 rows
  //    and bails out, preventing double stock adjustment.
  const { data: claimed, error: claimErr } = await supabase
    .from("inventory_checks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "balanced" as any })
    .eq("tenant_id", tenantId)
    .eq("id", checkId)
    .in("status", ["draft", "in_progress"])
    .select("id, code, status")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "applyInventoryCheck.claim");
  if (!claimed) {
    const { data: existing } = await supabase
      .from("inventory_checks")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", checkId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu kiểm kho");
    throw new Error(
      `Phiếu kiểm kho đã được xử lý (trạng thái: ${existing.status}). Không thể áp dụng lại.`
    );
  }
  const check = claimed;

  // 2. Read check items
  // NOTE: `inventory_check_items` is not in the generated Database types yet
  // (schema 00001 but not surfaced in types.ts). Cast to any to bypass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: itemsRaw, error: itemsErr } = await (supabase as any)
    .from("inventory_check_items")
    .select("id, product_id, product_name, system_stock, actual_stock, difference")
    .eq("check_id", checkId);
  if (itemsErr) handleError(itemsErr, "applyInventoryCheck.items");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRaw ?? []) as Array<{
    id: string;
    product_id: string;
    product_name: string;
    system_stock: number;
    actual_stock: number;
    difference: number;
  }>;
  if (items.length === 0) {
    throw new Error("Phiếu kiểm kho chưa có sản phẩm nào để áp dụng");
  }

  // 3. Build movements — skip zero-diff rows (nothing to write)
  //
  // SECURITY: RECOMPUTE `difference` từ `actual_stock - system_stock` thay vì
  // trust giá trị `it.difference` do client gửi. Kịch bản tấn công: user sửa
  // devtools gửi `difference = 1000` dù actual=system → gây nhập kho ảo.
  // Recompute ở đây đảm bảo delta luôn khớp với actual-system đã ghi ở bước tạo.
  const movements = items
    .map((it) => {
      const actual = Number(it.actual_stock ?? 0);
      const system = Number(it.system_stock ?? 0);
      const diff = actual - system; // server-recomputed, KHÔNG dùng it.difference
      if (diff === 0) return null;
      return {
        productId: it.product_id,
        productName: it.product_name,
        quantity: Math.abs(diff),
        type: (diff > 0 ? "in" : "out") as "in" | "out",
      };
    })
    .filter((m): m is { productId: string; productName: string; quantity: number; type: "in" | "out" } => m !== null);

  if (movements.length === 0) {
    // Nothing to apply — status already flipped to 'balanced' at step 1.
    return;
  }

  // 4. Apply all deltas in one batch via the shared helper
  await applyManualStockMovement(
    movements.map((m) => ({
      productId: m.productId,
      quantity: m.quantity,
      type: m.type,
      referenceType: "inventory_check",
      referenceId: checkId,
      note: `${check.code} - Kiểm kê - ${m.productName} (${m.type === "in" ? "+" : "-"}${m.quantity})`,
    }))
  );

  // 5. Status already flipped to 'balanced' at step 1 (atomic claim).
  //    No further status update needed.
}

/* ------------------------------------------------------------------ */
/*  Per-item variance detail (for inline detail panel)                 */
/* ------------------------------------------------------------------ */

export interface InventoryCheckItemRow {
  id: string;
  productId: string;
  productName: string;
  productCode?: string;
  unit?: string;
  systemStock: number;
  actualStock: number;
  difference: number;
  /** Latest cost × |difference| — signed same as difference */
  valueImpact: number;
  note?: string;
}

/**
 * Fetch per-product rows for an inventory check, joined with products to pull
 * code/unit/cost. Used by the detail panel to show a "sổ chênh lệch" table and
 * by the apply-modal preview to show expected impact before committing.
 */
export async function getInventoryCheckItems(
  checkId: string
): Promise<InventoryCheckItemRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from("inventory_check_items")
    .select(
      "id, product_id, product_name, system_stock, actual_stock, difference, note, products(code, unit, cost)"
    )
    .eq("check_id", checkId)
    .order("difference", { ascending: true });

  if (error) handleError(error, "getInventoryCheckItems");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const diff = Number(row.difference ?? 0);
    const cost = Number(row.products?.cost ?? 0);
    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      productCode: row.products?.code ?? undefined,
      unit: row.products?.unit ?? undefined,
      systemStock: Number(row.system_stock ?? 0),
      actualStock: Number(row.actual_stock ?? 0),
      difference: diff,
      valueImpact: diff * cost,
      note: row.note ?? undefined,
    };
  });
}

/**
 * Hủy phiếu kiểm kho — chỉ cho phép hủy khi phiếu ở trạng thái draft/in_progress.
 */
export async function cancelInventoryCheck(checkId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data: claimed, error: claimErr } = await supabase
    .from("inventory_checks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "cancelled" as any })
    .eq("tenant_id", tenantId)
    .eq("id", checkId)
    .in("status", ["draft", "in_progress"])
    .select("id")
    .maybeSingle();

  if (claimErr) handleError(claimErr, "cancelInventoryCheck");
  if (!claimed) {
    const { data: existing } = await supabase
      .from("inventory_checks")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", checkId)
      .single();
    if (!existing) throw new Error("Không tìm thấy phiếu kiểm kho");
    throw new Error(
      `Phiếu kiểm kho đã được xử lý (trạng thái: ${existing.status}). Không thể hủy.`
    );
  }
}

// --- Mapper ---

const checkStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  in_progress: "Đang xử lý",
  balanced: "Đã cân bằng",
  cancelled: "Đã hủy",
};

// Map DB status to frontend status
const checkStatusMap: Record<string, InventoryCheck["status"]> = {
  draft: "processing",
  in_progress: "processing",
  balanced: "balanced",
  cancelled: "unbalanced",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInventoryCheck(row: any): InventoryCheck {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    status: checkStatusMap[row.status] ?? "processing",
    statusName: checkStatusNameMap[row.status] ?? row.status,
    totalProducts: 0, // Would need aggregation from inventory_check_items
    increaseQty: 0,
    decreaseQty: 0,
    increaseAmount: 0,
    decreaseAmount: 0,
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdByName: profile?.full_name ?? "",
  };
}
