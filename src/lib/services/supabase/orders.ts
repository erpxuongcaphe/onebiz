/**
 * Supabase service: Sales Orders (Đơn hàng)
 *
 * Two responsibilities:
 *
 *   1. `getOrders` / `getOrderStatuses` — real Supabase queries against
 *      the `sales_orders` table (migration 00012).
 *
 *   2. NEW (POS sprint): thin wrapper around `posCheckout` plus draft
 *      order management. POS uses the existing `invoices` + `invoice_items`
 *      schema (status=draft → status=completed) instead of a new table,
 *      per sprint plan M1 (see serene-toasting-quilt.md).
 *
 *      - `saveDraftOrder`      (F9 — no stock change)
 *      - `listDraftOrders`     (load saved drafts)
 *      - `completeDraftOrder`  (F10 on a draft — trigger stock + cash)
 *      - `deleteDraftOrder`    (cleanup)
 *      - `posCheckout`         (re-export — F10 on a fresh cart)
 */

import type { SalesOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId, getCurrentContext } from "./base";
import {
  posCheckout,
  type PosCheckoutInput,
  type PosCheckoutResult,
  type PosCheckoutItem,
} from "./pos-checkout";
import { recordAuditLog } from "./audit";
import { isRpcUnavailable } from "./rpc-utils";
import {
  applyCreatedAtRangeFilter,
  normalizeCreatedAtRange,
} from "@/lib/utils/list-date-preset-range";

// ============================================================
// Sales Orders — real Supabase queries against `sales_orders`
// ============================================================

const STATUS_LABEL: Record<string, string> = {
  draft: "Chờ xử lý",
  new: "Mới",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

/** Các trạng thái invoices hợp lệ để lọc từ UI (chặn giá trị lạ). */
const VALID_ORDER_STATUSES = new Set([
  "draft",
  "confirmed",
  "delivering",
  "completed",
  "cancelled",
]);

export async function getOrders(
  params: QueryParams
): Promise<QueryResult<SalesOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // CEO 08/07/2026: "Đơn đặt hàng" = hóa đơn có source='order' (marker do
  // create-order-dialog gắn). GIỮ đơn qua MỌI trạng thái (Chờ xử lý → Hoàn
  // thành → Đã hủy) như KiotViet — trước đây lọc status='draft' nên đơn hoàn
  // tất rớt khỏi list. Đơn hoàn thành vẫn hiện ở CẢ trang Hóa đơn (chủ đích).
  // Bảng sales_orders là hệ CŨ (0 dữ liệu, không nút nào ghi vào).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partnerId =
    typeof params.filters?.deliveryPartnerId === "string" &&
    params.filters.deliveryPartnerId !== "all"
      ? params.filters.deliveryPartnerId
      : undefined;
  const shippingDateFrom =
    typeof params.filters?.shippingDateFrom === "string"
      ? params.filters.shippingDateFrom
      : undefined;
  const shippingDateTo =
    typeof params.filters?.shippingDateTo === "string"
      ? params.filters.shippingDateTo
      : undefined;
  const deliveryArea =
    typeof params.filters?.deliveryArea === "string"
      ? params.filters.deliveryArea.trim()
      : "";
  const fulfillmentState =
    typeof params.filters?.fulfillmentState === "string"
      ? params.filters.fulfillmentState
      : "all";
  const debtState =
    typeof params.filters?.debtState === "string"
      ? params.filters.debtState
      : "all";
  const shippingState =
    typeof params.filters?.shippingState === "string"
      ? params.filters.shippingState
      : "all";
  const amountMin = Number(params.filters?.amountMin);
  const amountMax = Number(params.filters?.amountMax);
  const hasCustomerPhoneFilter = Boolean(
    params.search && params.searchField === "customer_phone",
  );
  const hasShippingFilter = Boolean(
    partnerId ||
      shippingDateFrom ||
      shippingDateTo ||
      deliveryArea ||
      shippingState !== "all",
  );
  const customerRelation = hasCustomerPhoneFilter
    ? "customer:customers!invoices_customer_id_fkey!inner(phone, tenant_id)"
    : "customer:customers!invoices_customer_id_fkey(phone)";
  const shipmentRelation = hasShippingFilter
    ? shippingState === "none"
      ? ", shipments:shipping_orders!shipping_orders_invoice_id_fkey(id)"
      : ", shipments:shipping_orders!shipping_orders_invoice_id_fkey!inner(id)"
    : "";

  let query = (supabase as any)
    .from("invoices")
    .select(
      `*, profiles!invoices_created_by_fkey(full_name), branches!invoices_branch_id_fkey(name), ${customerRelation}${shipmentRelation}`,
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    // 00173: ẩn đơn đã xóa mềm (đơn đặt hàng vốn KHÔNG bị xóa — guard cho chắc).
    .is("deleted_at", null);

  // Lọc trạng thái (tùy chọn) — UI truyền mảng qua filters.status. Chỉ nhận
  // giá trị hợp lệ; rỗng/không hợp lệ → không lọc (hiện tất cả trạng thái).
  const statusFilter = params.filters?.status;
  if (statusFilter) {
    const statuses = (Array.isArray(statusFilter) ? statusFilter : [statusFilter])
      .filter((s) => VALID_ORDER_STATUSES.has(s));
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  // CEO 14/07: đơn đã xuất hóa đơn (fulfilled_by_id) không còn là "chưa xử lý".
  // KHÔNG lọc ở query (cột thêm ở 00188 — lọc server .is() sẽ LỖI nếu migration
  // chưa chạy). POS "Xử lý đặt hàng" lọc client-side theo o.fulfilledById cho an
  // toàn cả trước/sau migration (trước: cột thiếu → fulfilledById undefined →
  // không loại gì, cũng đúng vì chưa có đơn nào fulfilled).

  // Tìm theo đúng nội dung đang hiển thị: mã DH gốc, mã chứng từ hiện tại,
  // tên hoặc SĐT khách. Escape wildcard để chuỗi người dùng là chuỗi thường.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    if (params.searchField === "code") {
      query = query.or(`code.ilike.%${esc}%,order_code.ilike.%${esc}%`);
    }
    else if (params.searchField === "customer_name")
      query = query.ilike("customer_name", `%${esc}%`);
    else if (params.searchField === "customer_phone") {
      query = query
        .eq("customer.tenant_id", tenantId)
        .ilike("customer.phone", `%${esc}%`);
    }
    else
      query = query.or(
        `code.ilike.%${esc}%,order_code.ilike.%${esc}%,customer_name.ilike.%${esc}%`,
      );
  }

  // Filter: khoảng ngày (created_at) — timezone-safe. FIX (CEO 08/07): trang có
  // ô "Thời gian" nhưng trước đây KHÔNG áp ngày; nay truyền dateFrom/dateTo.
  query = applyCreatedAtRangeFilter(query, params.filters);

  // Ba mức xử lý (CEO 21/08). "pending" nay là CHỜ XỬ LÝ theo nghĩa chặt: chưa
  // gắn hóa đơn VÀ chưa có đơn con nào đã thanh toán. Đơn đã có hóa đơn nhưng
  // chưa gắn là "processing" — không được gọi là chờ xử lý nữa.
  if (fulfillmentState === "fulfilled") {
    query = query.not("fulfilled_by_id", "is", null);
  } else if (fulfillmentState === "pending" || fulfillmentState === "processing") {
    query = query.is("fulfilled_by_id", null);
    const coCon = await layIdDonCoConHoanTat(tenantId, params.branchId);
    if (coCon !== null) {
      if (fulfillmentState === "processing") {
        // Không có đơn nào có hóa đơn ⇒ kết quả rỗng. `.in` với mảng rỗng bị
        // PostgREST từ chối nên chặn bằng điều kiện không bao giờ đúng.
        if (coCon.length === 0) query = query.eq("id", KHONG_BAO_GIO_KHOP);
        else query = query.in("id", coCon);
      } else if (coCon.length > 0) {
        query = query.not("id", "in", `(${coCon.join(",")})`);
      }
    }
    // coCon === null ⇒ máy chủ chưa có cột: "pending" giữ nghĩa cũ (chưa gắn),
    // "processing" cũng ra cùng tập — đúng vì khi đó chưa có mô hình đơn con.
  }

  if (debtState === "outstanding") {
    query = query.gt("debt", 0);
  } else if (debtState === "settled") {
    query = query.lte("debt", 0);
  }

  if (Number.isFinite(amountMin) && amountMin >= 0) {
    query = query.gte("total", amountMin);
  }
  if (Number.isFinite(amountMax) && amountMax >= 0) {
    query = query.lte("total", amountMax);
  }

  // Ba bộ lọc vận chuyển cùng đi qua quan hệ !inner: chỉ giữ đơn có ít nhất
  // một vận đơn khớp. PostgREST vẫn trả mỗi hóa đơn một lần dù có nhiều vận đơn.
  if (hasShippingFilter) {
    const shippingRange = normalizeCreatedAtRange({
      dateFrom: shippingDateFrom,
      dateTo: shippingDateTo,
    });
    if (shippingState === "none") {
      query = query.is("shipments", null);
    } else if (shippingState !== "all" && shippingState !== "any") {
      query = query.eq("shipments.status", shippingState);
    }
    query = query.eq("shipments.tenant_id", tenantId);
    if (partnerId) query = query.eq("shipments.partner_id", partnerId);
    if (shippingRange.from) {
      query = query.gte("shipments.created_at", shippingRange.from);
    }
    if (shippingRange.toExclusive) {
      query = query.lt("shipments.created_at", shippingRange.toExclusive);
    }
    if (deliveryArea) {
      const escArea = deliveryArea.replace(/[%_]/g, "\\$&");
      query = query.ilike("shipments.receiver_address", `%${escArea}%`);
    }
  }

  // Filter: branch (falsy = tất cả chi nhánh).
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getOrders");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: SalesOrder[] = (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const branch = row.branches as { name: string } | null;
    const customer = row.customer as { phone: string | null } | null;
    return {
      id: row.id,
      // CEO 10/07: hiện MÃ ĐƠN gốc (DH). Trước hoàn tất code=DH; sau hoàn tất
      // code=HD nhưng order_code giữ DH → luôn hiện DH ở trang Đơn đặt hàng.
      code: row.order_code ?? row.code,
      // Mã hóa đơn thật (HD) khi đã hoàn tất — để đối chiếu / mở hóa đơn.
      invoiceCode: row.order_code ? row.code : undefined,
      date: row.created_at,
      customerName: row.customer_name ?? "",
      customerId: row.customer_id ?? undefined,
      customerPhone: customer?.phone ?? "",
      totalAmount: row.total ?? 0,
      // Phí giao = cột delivery_fee (invoices KHÔNG có shipping_fee).
      shippingFee: Number(row.delivery_fee ?? 0),
      // Số đã thu / còn phải thu — để thẻ "Tổng cần thu" tính đúng theo trạng
      // thái (đơn hoàn thành đã trả → debt=0 → không cộng vào cần thu).
      paid: Number(row.paid ?? 0),
      debt: Number(row.debt ?? 0),
      status: row.status,
      statusName: STATUS_LABEL[row.status] ?? row.status ?? "",
      // CEO 14/07: link tới hóa đơn đã xuất (nếu có) — hiện "Đã xuất hóa đơn".
      fulfilledById: row.fulfilled_by_id ?? undefined,
      // Ghi chú người bán — in trên phiếu đặt hàng (CEO 08/07).
      note: row.note ?? undefined,
      createdBy: row.created_by ?? "",
      createdByName: profile?.full_name ?? "",
      branchId: row.branch_id ?? undefined,
      branchName: branch?.name ?? undefined,
    };
  });

  // CEO 14/07: lấy mã HĐ đã xuất cho các đơn fulfilled (hiện trên badge "Đã
  // xuất hóa đơn"). Chỉ query khi thực sự có đơn fulfilled (hiếm).
  const fulfilledIds = [
    ...new Set(orders.map((o) => o.fulfilledById).filter(Boolean)),
  ] as string[];
  if (fulfilledIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hd } = await (supabase as any)
      .from("invoices")
      .select("id, code")
      .in("id", fulfilledIds);
    const codeById = new Map<string, string>(
      (hd ?? []).map((r: { id: string; code: string }) => [r.id, r.code]),
    );
    for (const o of orders) {
      if (o.fulfilledById) {
        o.fulfilledInvoiceCode = codeById.get(o.fulfilledById) ?? undefined;
      }
    }
  }

  // 00337 — ĐẾM ĐƠN BÁN CON ĐÃ THANH TOÁN cho các đơn chưa gắn hóa đơn, để
  // phân biệt "Chờ xử lý" với "Đang xử lý". Đơn đã gắn thì đã là Hoàn tất, không
  // cần đếm. Máy chủ chưa có cột ⇒ trả null ⇒ để undefined, màn quay về mô hình
  // hai mức cũ thay vì đoán bừa.
  const chuaGan = orders.filter((o) => !o.fulfilledById).map((o) => o.id);
  if (chuaGan.length > 0) {
    const dem = await demDonConHoanTat(chuaGan);
    if (dem) {
      for (const o of orders) {
        if (!o.fulfilledById) o.completedChildCount = dem.get(o.id) ?? 0;
      }
    }
  }

  return { data: orders, total: count ?? 0 };
}

export function getOrderStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "new", label: "Mới" },
    { value: "confirmed", label: "Đã xác nhận" },
    { value: "delivering", label: "Đang giao" },
    { value: "completed", label: "Hoàn thành" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// ============================================================
// Read-only summary for the Sales Order list (RPC 00306)
// ============================================================

export interface SalesOrderListSummary {
  tongDon: number;
  tongTienHang: number;
  tongPhiGiao: number;
  tongCanThu: number;
}

export interface SalesOrderListSummaryParams {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  statuses?: string[];
  search?: string;
  searchField?: string;
  deliveryPartnerId?: string;
  shippingDateFrom?: string;
  shippingDateTo?: string;
  deliveryArea?: string;
  fulfillmentState?: string;
  debtState?: string;
  shippingState?: string;
  amountMin?: number;
  amountMax?: number;
}

export async function getSalesOrderListSummary(
  params: SalesOrderListSummaryParams,
): Promise<SalesOrderListSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const orderRange = normalizeCreatedAtRange({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  const shippingRange = normalizeCreatedAtRange({
    dateFrom: params.shippingDateFrom,
    dateTo: params.shippingDateTo,
  });

  const { data, error } = await supabase.rpc("get_sales_order_list_summary", {
    p_branch_id: params.branchId ?? null,
    p_date_from: orderRange.from ?? null,
    p_date_to_exclusive: orderRange.toExclusive ?? null,
    p_statuses:
      params.statuses && params.statuses.length > 0 ? params.statuses : null,
    p_search: params.search?.trim() || null,
    p_search_field: params.searchField ?? "all",
    p_delivery_partner_id:
      params.deliveryPartnerId && params.deliveryPartnerId !== "all"
        ? params.deliveryPartnerId
        : null,
    p_shipping_date_from: shippingRange.from ?? null,
    p_shipping_date_to_exclusive: shippingRange.toExclusive ?? null,
    p_delivery_area: params.deliveryArea?.trim() || null,
    p_fulfillment_state:
      params.fulfillmentState && params.fulfillmentState !== "all"
        ? params.fulfillmentState
        : null,
    p_debt_state:
      params.debtState && params.debtState !== "all" ? params.debtState : null,
    p_shipping_state:
      params.shippingState && params.shippingState !== "all"
        ? params.shippingState
        : null,
    p_amount_min:
      typeof params.amountMin === "number" &&
      Number.isFinite(params.amountMin) &&
      params.amountMin >= 0
        ? params.amountMin
        : null,
    p_amount_max:
      typeof params.amountMax === "number" &&
      Number.isFinite(params.amountMax) &&
      params.amountMax >= 0
        ? params.amountMax
        : null,
  });
  if (error) handleError(error, "getSalesOrderListSummary");

  const row = Array.isArray(data) ? data[0] : data;
  return {
    tongDon: Number(row?.tong_don ?? 0),
    tongTienHang: Number(row?.tong_tien_hang ?? 0),
    tongPhiGiao: Number(row?.tong_phi_giao ?? 0),
    tongCanThu: Number(row?.tong_can_thu ?? 0),
  };
}

export function khoaChiSoDonDatHang(
  params: SalesOrderListSummaryParams,
): string {
  return JSON.stringify([
    params.branchId ?? "",
    params.dateFrom ?? "",
    params.dateTo ?? "",
    [...(params.statuses ?? [])].sort(),
    params.search ?? "",
    params.searchField ?? "all",
    params.deliveryPartnerId ?? "",
    params.shippingDateFrom ?? "",
    params.shippingDateTo ?? "",
    params.deliveryArea ?? "",
    params.fulfillmentState ?? "",
    params.debtState ?? "",
    params.shippingState ?? "",
    params.amountMin ?? "",
    params.amountMax ?? "",
  ]);
}

/** Nhớ tạm theo bộ lọc, đồng thời chặn kết quả cũ về muộn ghi đè bộ lọc mới. */
export function taoBoNhoChiSoDonDatHang() {
  let luotHienTai = 0;
  const nho = new Map<string, SalesOrderListSummary>();
  return {
    batDau(khoa: string): {
      luot: number;
      sanCo: SalesOrderListSummary | undefined;
    } {
      return { luot: ++luotHienTai, sanCo: nho.get(khoa) };
    },
    conMoiNhat(luot: number): boolean {
      return luot === luotHienTai;
    },
    luu(khoa: string, ketQua: SalesOrderListSummary): void {
      nho.set(khoa, ketQua);
    },
    xoaHet(): void {
      nho.clear();
      luotHienTai += 1;
    },
  };
}

// ============================================================
// Complete Sales Order → auto Invoice + Stock + Cash
// ============================================================

/**
 * Hoàn thành đơn hàng bán (sales_orders):
 *   1. Atomic claim: UPDATE status='completed' WHERE status IN (confirmed, delivering)
 *   2. Load sales_order_items
 *   3. Create invoice (completed) + invoice_items
 *   4. Decrement stock via applyStockDecrement
 *   5. Create cash receipt via createAutoCashReceipt
 *
 * Kết quả: 1 sales order → 1 invoice + stock trừ + sổ quỹ ghi phiếu thu.
 */
export async function completeSalesOrder(
  orderId: string,
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "complete_legacy_sales_order_atomic",
    { p_order_id: orderId },
  );
  if (error) handleError(error, "completeSalesOrder");
  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về hóa đơn hoàn tất hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
  };
}

// ============================================================
// Cancel Sales Order
// ============================================================

export async function cancelSalesOrder(orderId: string): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "cancel_legacy_sales_order_atomic",
    {
      p_order_id: orderId,
      p_reason: "Hủy từ giao diện đơn hàng",
    },
  );
  if (error) handleError(error, "cancelSalesOrder");
}

// ============================================================
// Re-export from pos-checkout for convenience
// ============================================================
export { posCheckout };
export type { PosCheckoutInput, PosCheckoutResult, PosCheckoutItem };

/**
 * Lấy line items của một sales order cho detail panel.
 *
 * Trước đây panel detail render hardcoded "SP001 — Sản phẩm mẫu" cho
 * MỌI đơn → user nhìn không biết đơn này gồm SP gì.
 */
export interface SalesOrderItemRow {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  /** 00208: ghi chú từng món. */
  note?: string;
}

export async function getSalesOrderItems(
  orderId: string,
): Promise<SalesOrderItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Verify order thuộc tenant trước (defense-in-depth)
  const { data: order } = await supabase
    .from("sales_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return [];

  const { data, error } = await supabase
    .from("sales_order_items")
    .select(
      "id, product_id, product_name, unit, quantity, unit_price, discount, total, products!sales_order_items_product_id_fkey(code)",
    )
    .eq("order_id", orderId);

  if (error) {
    console.warn("[getSalesOrderItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: row.products?.code ?? "",
    productName: row.product_name ?? "",
    unit: row.unit ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
  }));
}

/**
 * CEO 08/07/2026: Item của 1 "đơn đặt hàng" = invoice_items (vì đơn = hóa đơn
 * nháp). Dùng cho panel chi tiết + in đơn ở trang Đơn đặt hàng.
 */
export async function getDraftOrderItems(
  invoiceId: string,
): Promise<SalesOrderItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Verify hóa đơn thuộc tenant trước (defense-in-depth)
  const { data: inv } = await supabase
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return [];

  // 00208: select("*") để lấy cả note mà không vỡ khi cột chưa migrate.
  const { data, error } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  if (error) {
    console.warn("[getDraftOrderItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: "",
    productName: row.product_name ?? "",
    unit: row.unit ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    note: row.note ?? undefined, // 00208
  }));
}

// ============================================================
// Types
// ============================================================

export interface DraftOrderSummary {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string;
  total: number;
  subtotal: number;
  discountAmount: number;
  itemCount: number;
  note: string | null;
  createdAt: string;
  /** CEO 04/05/2026: thông tin cho recovery dialog. */
  updatedAt?: string;
  /** Tên cashier đã tạo nháp này (dùng trong recovery list). */
  createdByName?: string;
  /** Danh sách 3 tên SP đầu tiên — preview ngắn cho recovery card. */
  itemsSummary?: string[];
  /** TRUE = auto-save background, FALSE = F9 manual sticky. */
  autoSaved?: boolean;
  /** UUID idempotency key — client store để tiếp tục auto-save sau khi load. */
  clientSessionId?: string | null;
  /** 'order' = đơn đặt hàng (POS hiện banner riêng, không xóa nhầm). */
  source?: string | null;
  /** Phí giao hàng (invoices.delivery_fee) — dùng khi mở sửa đơn. */
  deliveryFee?: number;
  /** Server revision used to reject stale-device draft writes. */
  revision: number;
}

export interface DraftOrderDetail extends DraftOrderSummary {
  branchId: string;
  items: Array<{
    id: string;
    productId: string;
    variantId?: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    /** 00208: ghi chú riêng từng mã hàng — giữ khi mở lại đơn để sửa. */
    note?: string;
  }>;
}

export interface SaveSalesOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  note?: string | null;
}

export interface SaveSalesOrderInput {
  orderId?: string | null;
  requestedCode?: string | null;
  branchId: string;
  customerId?: string | null;
  deliveryFee?: number;
  note?: string | null;
  partnerId?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  collectionMode: "cod" | "none";
  receiverCustomerId?: string | null;
  items: SaveSalesOrderItemInput[];
}

export interface SaveSalesOrderResult {
  orderId: string;
  orderCode: string;
  total: number;
  shipmentId: string | null;
  shipmentCode: string | null;
  created: boolean;
}

export async function saveSalesOrderAtomic(
  input: SaveSalesOrderInput,
): Promise<SaveSalesOrderResult> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "save_sales_order_atomic_v2",
    {
      p_order_id: input.orderId ?? null,
      p_requested_code: input.requestedCode ?? null,
      p_branch_id: input.branchId,
      p_customer_id: input.customerId ?? null,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit_price: Number(item.unitPrice),
        note: item.note ?? null,
      })),
      p_delivery_fee: Number(input.deliveryFee ?? 0),
      p_note: input.note ?? null,
      p_partner_id: input.partnerId ?? null,
      p_receiver_name: input.receiverName ?? null,
      p_receiver_phone: input.receiverPhone ?? null,
      p_receiver_address: input.receiverAddress ?? null,
      p_collection_mode: input.collectionMode,
      p_receiver_customer_id: input.receiverCustomerId ?? null,
    },
  );
  if (error) handleError(error, "saveSalesOrderAtomic");

  const result = data as Record<string, unknown> | null;
  if (!result?.order_id || !result.order_code) {
    throw new Error("Máy chủ không trả về kết quả lưu đơn đặt hàng hợp lệ.");
  }
  return {
    orderId: String(result.order_id),
    orderCode: String(result.order_code),
    total: Number(result.total ?? 0),
    shipmentId: result.shipment_id ? String(result.shipment_id) : null,
    shipmentCode: result.shipment_code ? String(result.shipment_code) : null,
    created: Boolean(result.created),
  };
}

// ============================================================
// F9 — Save draft (no stock change, no cash transaction)
// ============================================================

/**
 * Create a new invoice with status='draft'.
 * - Generates invoice code via RPC `next_code('invoice')`.
 * - Inserts invoice + invoice_items.
 * - Does NOT touch products.stock, stock_movements, or cash_transactions.
 *
 * Stock/cash side-effects are deferred to `completeDraftOrder`.
 *
 * CEO 04/05/2026 — Auto-save & recovery upgrade (Sprint POS-RECOVERY-1):
 * - Param `options.sessionId` (UUID) làm anchor: nếu đã có draft với
 *   session_id này → UPDATE in-place. Nếu chưa → INSERT mới.
 * - `options.autoSaved=true` cho auto-save background (TTL 30 ngày qua
 *   cleanup_expired_auto_drafts). False = F9 manual (giữ vĩnh viễn).
 */
export async function saveDraftOrder(
  input: PosCheckoutInput,
  options: {
    /** UUID anchor — upsert by (tenant_id, client_session_id). */
    sessionId: string;
    /** TRUE = auto-save background (TTL 30d). FALSE = F9 manual sticky. */
    autoSaved?: boolean;
    invoiceId?: string | null;
    expectedRevision?: number | null;
  },
): Promise<{ invoiceId: string; invoiceCode: string; revision: number; status: string }> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "save_pos_draft_atomic_v3",
    {
      p_branch_id: input.branchId,
      p_customer_id: input.customerId ?? null,
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_order_discount:
        input.orderDiscountAmount ??
        Math.max(
          0,
          input.discountAmount -
            input.items.reduce((sum, item) => sum + item.discount, 0),
        ),
      p_shipping_fee: input.shippingFee ?? 0,
      p_order_vat_rate: input.orderVatRate ?? 0,
      p_note: input.note ?? null,
      p_client_session_id: options.sessionId,
      p_auto_saved: options.autoSaved ?? false,
      p_invoice_id: options.invoiceId ?? null,
      p_expected_revision: options.expectedRevision ?? null,
    },
  );
  if (error) {
    if (/POS_DRAFT_(CONFLICT|SESSION_CHANGED|NOT_FOUND|CHANGED_DURING_SAVE)/.test(error.message)) {
      throw new Error(`${error.message}|${error.details ?? "{}"}`);
    }
    handleError(error, "saveDraftOrder.atomic_v3");
  }

  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về kết quả lưu đơn nháp hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
    revision: Number(result.revision ?? 0),
    status: String(result.status ?? "draft"),
  };
}

// ============================================================
// List drafts — for resume picker
// ============================================================

/**
 * List draft invoices (status='draft') for a given branch.
 * Returns a lightweight summary — includes item count via a second query
 * (Supabase PostgREST doesn't easily support COUNT subqueries in a single
 * round-trip without an RPC).
 */
export async function listDraftOrders(
  branchId?: string,
  limit: number = 50,
): Promise<DraftOrderSummary[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Sort by updated_at DESC để recovery dialog hiện nháp mới nhất lên đầu
  // (auto-save liên tục refresh updated_at qua trigger handle_updated_at).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select(
      "id, code, customer_id, customer_name, total, subtotal, discount_amount, note, created_at, updated_at, auto_saved, client_session_id, draft_revision, created_by, profiles!invoices_created_by_fkey(full_name), invoice_items(product_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "draft")
    // 00173: ẩn đơn xóa mềm + KHÔNG trộn đơn đặt hàng (source='order') vào list
    // nháp POS — tránh xóa nhầm; đơn đặt hàng quản ở trang Đặt hàng. source có
    // thể NULL (nháp cũ) nên dùng (is null OR neq order).
    .is("deleted_at", null)
    .or("source.is.null,source.neq.order")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "listDraftOrders");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const items = Array.isArray(row.invoice_items) ? row.invoice_items : [];
    const profile = row.profiles as { full_name?: string } | null;
    return {
      id: row.id,
      code: row.code,
      customerId: row.customer_id,
      customerName: row.customer_name ?? "Khách lẻ",
      total: row.total ?? 0,
      subtotal: row.subtotal ?? 0,
      discountAmount: row.discount_amount ?? 0,
      itemCount: items.length,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdByName: profile?.full_name ?? undefined,
      // 3 tên SP đầu cho preview card (recovery dialog)
      itemsSummary: items
        .slice(0, 3)
        .map((it: { product_name?: string }) => it.product_name ?? "")
        .filter(Boolean),
      autoSaved: row.auto_saved ?? false,
      clientSessionId: row.client_session_id ?? null,
      revision: Number(row.draft_revision ?? 0),
    };
  });
}

/**
 * Load a single draft invoice with its items — used when the cashier
 * re-opens a draft to finish checkout.
 */
export async function getDraftOrderById(
  invoiceId: string
): Promise<DraftOrderDetail | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select(
      "id, code, branch_id, customer_id, customer_name, subtotal, discount_amount, delivery_fee, total, note, created_at, updated_at, status, auto_saved, client_session_id, draft_revision, source, invoice_items(*)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    // 00173: không mở lại đơn đã xóa mềm.
    .is("deleted_at", null)
    .single();
  if (error) handleError(error, "getDraftOrderById");
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    id: raw.id,
    code: raw.code,
    branchId: raw.branch_id,
    customerId: raw.customer_id,
    customerName: raw.customer_name ?? "Khách lẻ",
    subtotal: raw.subtotal ?? 0,
    discountAmount: raw.discount_amount ?? 0,
    total: raw.total ?? 0,
    itemCount: Array.isArray(raw.invoice_items) ? raw.invoice_items.length : 0,
    note: raw.note,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    autoSaved: raw.auto_saved ?? false,
    clientSessionId: raw.client_session_id ?? null,
    source: raw.source ?? null,
    deliveryFee: Number(raw.delivery_fee ?? 0),
    revision: Number(raw.draft_revision ?? 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (raw.invoice_items ?? []).map((it: any) => ({
      id: it.id,
      productId: it.product_id,
      variantId: it.variant_id ?? undefined,
      productName: it.product_name,
      unit: it.unit ?? "Cái",
      quantity: it.quantity,
      unitPrice: it.unit_price,
      discount: it.discount ?? 0,
      total: it.total ?? 0,
      note: it.note ?? undefined, // 00208 — kẻo mở nháp rớt ghi chú món
    })),
  };
}

/**
 * CEO 08/07/2026 — VÁ BUG TRÙNG ĐƠN + NỢ ẢO.
 *
 * Đơn nháp tạo từ dialog "Đặt hàng" (Đơn đặt hàng) KHÔNG có `client_session_id`
 * (không qua phiên POS). Khi nhân viên mở đơn đó trong POS (?draftId) để chuyển
 * thành hóa đơn rồi SỬA → `useAutoSaveDraft` chạy `saveDraftOrder` với session
 * POS mới → KHÔNG khớp `client_session_id` của đơn → TẠO NHÁP MỚI (mã mới) →
 * `setLoadedDraftId` trỏ sang nháp mới → Thanh toán hoàn tất NHÁP MỚI, đơn gốc
 * KẸT "phiếu tạm" → 2 đơn trùng + nợ ảo (đơn gốc vẫn cộng nợ KH qua trigger 00130).
 *
 * Fix: khi mở 1 đơn nháp CHƯA có session vào POS → GẮN session hiện tại vào đơn
 * → auto-save UPDATE đúng đơn này, completeDraftOrder hoàn tất đúng đơn này (giữ
 * nguyên mã). Chỉ set khi status còn 'draft' (không đụng hóa đơn đã hoàn tất).
 */
export async function adoptDraftSession(
  invoiceId: string,
  sessionId: string,
  expectedRevision: number,
): Promise<number> {
  if (!invoiceId || !sessionId) return expectedRevision;
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "adopt_pos_draft_session_atomic_v2",
    {
      p_invoice_id: invoiceId,
      p_client_session_id: sessionId,
      p_expected_revision: expectedRevision,
    },
  );
  if (error) {
    if (/POS_DRAFT_(CONFLICT|SESSION_CHANGED|NOT_FOUND)/.test(error.message)) {
      throw new Error(`${error.message}|${error.details ?? "{}"}`);
    }
    handleError(error, "adoptDraftSession.atomic_v2");
  }
  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id) {
    throw new Error("Máy chủ không xác nhận phiên của đơn nháp.");
  }
  return Number(result.revision ?? expectedRevision);
}

// ============================================================
// F10 on a draft — convert draft → completed
// ============================================================

/**
 * Convert a saved draft invoice into a completed sale:
 *  1. Load invoice + items
 *  2. Validate status === 'draft'
 *  3. UPDATE invoices (status='completed', paid, debt, payment_method)
 *  4. applyStockDecrement (stock_movements + products.stock)
 *  5. createAutoCashReceipt (if paid > 0)
 */
/**
 * CEO 29/05/2026: Tìm đơn nháp (status='draft') theo client_session_id.
 * Dùng ở POS handleComplete: nếu loadedDraftId chưa kịp set (auto-save vừa tạo
 * draft) → tra theo session để hoàn tất ĐÚNG đơn nháp đó (completeDraftOrder)
 * thay vì posCheckout (server sẽ từ chối "still draft" → kẹt nháp).
 * Best-effort: lỗi → trả null để checkout đi nhánh thường.
 */
export async function findDraftIdBySession(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const supabase = getClient();
    const tenantId = await getCurrentTenantId();
    // client_session_id chưa có trong Supabase generated types (migration 00048
    // chưa regen) → cast any cho query filter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("invoices")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("client_session_id", sessionId)
      .eq("status", "draft")
      // 00173: bỏ qua đơn đã xóa mềm.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * 04/08/2026 — Như findDraftIdBySession nhưng trả kèm draft_revision.
 * Dùng khi F5/tablet reload khôi phục giỏ từ localStorage với session CŨ:
 * seed đúng {invoiceId, revision} cho auto-save để lần lưu đầu tiên không
 * dính POS_DRAFT_CONFLICT chắc chắn (00292: đã có nháp cho session mà gửi
 * expected_revision null là conflict → tab đêm nào cũng kẹt dialog).
 * Chỉ ĐỌC, best-effort — lỗi trả null, luồng cũ giữ nguyên.
 */
export async function findDraftBySession(
  sessionId: string,
): Promise<{ invoiceId: string; revision: number } | null> {
  if (!sessionId) return null;
  try {
    const supabase = getClient();
    const tenantId = await getCurrentTenantId();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("invoices")
      .select("id, draft_revision")
      .eq("tenant_id", tenantId)
      .eq("client_session_id", sessionId)
      .eq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.id) return null;
    return {
      invoiceId: String(data.id),
      revision: Number(data.draft_revision ?? 0),
    };
  } catch {
    return null;
  }
}

export async function completeDraftOrder(
  invoiceId: string,
  payment: {
    method: "cash" | "transfer" | "card" | "mixed";
    paid: number;
    tenantId: string;
    branchId: string;
    createdBy: string;
    customerId?: string | null;
    items: PosCheckoutItem[];
    paymentBreakdown?: import("./pos-checkout").PaymentBreakdownItem[];
    shiftId?: string | null;
    promotionId?: string | null;
    couponCode?: string | null;
    loyaltyPoints?: number;
    discountSource?: PosCheckoutInput["discountSource"];
    orderDiscountAmount?: number;
    discountOtpId?: string | null;
    discountReason?: string | null;
    shippingFee?: number;
    orderVatRate?: number;
    amountTendered?: number | null;
    customerCredit?: number;
    allowBomShortage?: boolean;
    clientSessionId: string;
    expectedRevision: number;
    expectedTotal: number;
    /** 00335 — ngày hoá đơn người dùng chủ động chỉnh (cần quyền + lý do). */
    issuedAt?: string | null;
    issuedReason?: string | null;
    /** 00335 — giờ bấm thanh toán khi mất mạng (tham khảo, không kế toán). */
    checkoutClientAt?: string | null;
  },
): Promise<{
  invoiceCode: string;
  total?: number;
  paid?: number;
  debt?: number;
  taxAmount?: number;
  discountAmount?: number;
}> {
  const supabase = getClient();
  // 00335: NGÀY HOÁ ĐƠN chỉ có ở v6 (bọc ngoài v5). Gọi v6 trước; máy chủ chưa
  // chạy Pha B thì lùi về v5 — vẫn nguyên tử, chỉ mất khả năng chỉnh ngày.
  const thamSoChung = {
      p_invoice_id: invoiceId,
      p_customer_id: payment.customerId ?? null,
      p_items: payment.items,
      p_method: payment.method,
      p_paid: payment.paid,
      p_payment_breakdown: payment.paymentBreakdown ?? null,
      p_shift_id: payment.shiftId ?? null,
      p_promotion_id: payment.promotionId ?? null,
      p_coupon_code: payment.couponCode ?? null,
      p_loyalty_points: payment.loyaltyPoints ?? 0,
      p_discount_source: payment.discountSource ?? null,
      p_order_discount: payment.orderDiscountAmount ?? 0,
      p_discount_otp_id: payment.discountOtpId ?? null,
      p_discount_reason: payment.discountReason ?? null,
      p_shipping_fee: payment.shippingFee ?? 0,
      p_order_vat_rate: payment.orderVatRate ?? 0,
      p_allow_bom_shortage: payment.allowBomShortage ?? false,
      p_amount_tendered: payment.amountTendered ?? payment.paid,
      p_customer_credit: payment.customerCredit ?? 0,
      p_client_session_id: payment.clientSessionId,
      p_expected_revision: payment.expectedRevision,
      p_expected_total: payment.expectedTotal,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data, error } = await (supabase.rpc as any)("complete_draft_atomic_v6", {
    ...thamSoChung,
    p_issued_at: payment.issuedAt ?? null,
    p_issued_reason: payment.issuedReason ?? null,
    p_checkout_client_at: payment.checkoutClientAt ?? null,
  });

  if (isRpcUnavailable(error)) {
    if (payment.issuedAt) {
      throw new Error(
        "Máy chủ chưa bật tính năng chỉnh Ngày hoá đơn. Vui lòng bỏ trống ngày để thanh toán bình thường.",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data, error } = await (supabase.rpc as any)(
      "complete_draft_atomic_v5",
      thamSoChung,
    ));
  }

  if (error) {
    if (
      error.message === "POS_PRICE_CHANGED" ||
      error.message === "POS_DISCOUNT_CHANGED"
    ) {
      throw new Error(`${error.message}|${error.details ?? "{}"}`);
    }
    if (/POS_DRAFT_(CONFLICT|SESSION_CHANGED|NOT_FOUND)|POS_CART_TOTAL_CHANGED/.test(error.message)) {
      throw new Error(`${error.message}|${error.details ?? "{}"}`);
    }
    if (
      error.code === "PGRST202" ||
      /complete_draft_atomic_v5|schema cache/i.test(error.message)
    ) {
      throw new Error(
        "Chưa có migration 00292. Không thể thanh toán đơn nháp an toàn.",
      );
    }
    handleError(error, "completeDraftOrder:atomic_v5");
  }

  const result = data as {
    invoice_code?: string;
    total?: number;
    paid?: number;
    debt?: number;
    tax_amount?: number;
    discount_amount?: number;
  } | null;
  if (!result?.invoice_code) {
    throw new Error("Phản hồi thanh toán thiếu mã hóa đơn.");
  }
  return {
    invoiceCode: result.invoice_code,
    total: result.total,
    paid: result.paid,
    debt: result.debt,
    taxAmount: result.tax_amount,
    discountAmount: result.discount_amount,
  };
}

// ============================================================
// Delete draft (SOFT-delete — 00173; never touches completed or đơn đặt hàng)
// ============================================================

export async function deleteDraftOrder(
  invoiceId: string,
  opts?: { onlyAutoSaved?: boolean },
): Promise<void> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "soft_delete_pos_draft_atomic",
    {
      p_invoice_id: invoiceId,
      p_only_auto_saved: opts?.onlyAutoSaved ?? false,
    },
  );
  if (error) handleError(error, "deleteDraftOrder.atomic");
  if (!data) {
    throw new Error("Máy chủ không trả về kết quả xử lý đơn nháp.");
  }
}

// ============================================================
// Duplicate invoice — clone existing invoice → create new draft
// Sprint UX-1 Stage 3 (CEO 04/05/2026): Sao chép action top user request.
// Lý do: kế toán thường tạo phiếu giống tháng trước, chỉ đổi vài thông số.
// ============================================================

/**
 * Sao chép invoice (bất kỳ status nào) → tạo invoice DRAFT mới với cùng
 * customer, items, payment method, note. Status mới = 'draft' để cashier
 * sửa trước khi finalize.
 *
 * KHÔNG sao chép: paid, debt, audit_log (mới = chưa thanh toán + chưa
 * có lịch sử). Code mới qua next_code RPC.
 *
 * Trả về { invoiceId, invoiceCode } của bản copy mới — caller có thể
 * router.push("/don-hang/hoa-don?id=" + id) để mở edit ngay.
 */
export async function duplicateInvoice(
  sourceInvoiceId: string,
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const context = await getCurrentContext();
  const { data, error } = await (supabase.rpc as any)(
    "duplicate_invoice_to_order_atomic",
    {
      p_source_invoice_id: sourceInvoiceId,
      p_target_branch_id: context.branchId,
    },
  );
  if (error) handleError(error, "duplicateInvoice");

  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về bản sao hóa đơn hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Đơn bán con từ đơn đặt hàng (00331) — CEO 17/08/2026
//
// Mô hình: một đơn đặt hàng gốc (source='order') → KHÔNG GIỚI HẠN đơn bán
// con. Đơn con là nháp POS bình thường (id/mã/session riêng), chỉ tham chiếu
// về gốc qua invoices.source_order_id. Đơn gốc bất khả xâm phạm: tạo / sửa /
// xoá / thanh toán đơn con không đụng đơn gốc.
//
// ⚠️ TƯƠNG THÍCH: các hàm dưới đây là ĐƯỜNG MỚI, chưa màn nào gọi cho tới
// PR3/PR4. Khi máy chủ CHƯA chạy 00331 (thiếu cột/RPC) thì trả null hoặc báo
// lỗi tiếng Việt rõ ràng — không làm hỏng luồng cũ.
// ═══════════════════════════════════════════════════════════════════════════

export interface ChildSaleCreated {
  childId: string;
  childCode: string;
  clientSessionId: string;
  draftRevision: number;
  itemCount: number;
  sourceOrderId: string;
  sourceOrderCode: string;
}

export interface ChildSaleInfo {
  id: string;
  code: string;
  status: string;
  total: number;
  paid: number;
  createdAt: string;
  /**
   * Huỷ bỏ hóa đơn (void) là trạng thái RIÊNG, không nằm trong `status`. Một
   * đơn con `completed` rồi bị void vẫn giữ status='completed' — nếu chỉ nhìn
   * status thì màn đơn gốc tiếp tục trình bày "đã hoàn tất" trong khi tiền đã
   * bị thu hồi. Phải đọc cả hai.
   */
  voidedAt: string | null;
  cancelledAt: string | null;
}

/** Đơn con có thực sự dùng được để "Hoàn tất xử lý" đơn gốc hay không. */
export function donConDungDuoc(c: ChildSaleInfo): boolean {
  return c.status === "completed" && !c.voidedAt && !c.cancelledAt;
}

/**
 * BA MỨC XỬ LÝ của một đơn đặt hàng (CEO 21/08/2026).
 *
 * Một đơn đặt hàng được phép tạo KHÔNG GIỚI HẠN đơn bán con, nên KHÔNG tự
 * hoàn tất đơn ngay khi đơn con đầu tiên thanh toán xong. Ba mức:
 *
 *   cho_xu_ly   — chưa gắn hóa đơn VÀ chưa có đơn con nào đã thanh toán
 *   dang_xu_ly  — đã có ≥1 đơn con đã thanh toán nhưng CHƯA gắn (còn bán tiếp)
 *   hoan_tat    — đã gắn hóa đơn vào đơn gốc (fulfilled_by_id khác null)
 *
 * Nháp / đã huỷ / đã void KHÔNG được tính là hóa đơn hoàn tất — phần lọc đó
 * nằm ở nơi đếm `completedChildCount`.
 */
export type TrangThaiXuLyDon = "cho_xu_ly" | "dang_xu_ly" | "hoan_tat";

export function trangThaiXuLyDon(o: {
  fulfilledById?: string | null;
  completedChildCount?: number;
}): TrangThaiXuLyDon {
  if (o.fulfilledById) return "hoan_tat";
  // undefined = máy chủ chưa trả số đếm ⇒ giữ nguyên hành vi cũ (chờ xử lý),
  // không đoán bừa thành "đang xử lý".
  if ((o.completedChildCount ?? 0) > 0) return "dang_xu_ly";
  return "cho_xu_ly";
}

export const NHAN_TRANG_THAI_XU_LY: Record<
  TrangThaiXuLyDon,
  { nhan: string; mo_ta: string }
> = {
  cho_xu_ly: { nhan: "Chờ xử lý", mo_ta: "Chưa có hóa đơn nào đã thanh toán" },
  dang_xu_ly: { nhan: "Đang xử lý", mo_ta: "Đã có hóa đơn, còn bán tiếp được" },
  hoan_tat: { nhan: "Hoàn tất", mo_ta: "Đã gắn hóa đơn vào đơn đặt hàng" },
};

/** UUID không tồn tại — dùng để ép một truy vấn ra kết quả rỗng. */
const KHONG_BAO_GIO_KHOP = "00000000-0000-0000-0000-000000000000";

/**
 * Trần số đơn gốc dùng cho bộ lọc ba mức. PostgREST nhận danh sách id qua URL
 * nên không thể dài vô hạn. Vượt trần thì BÁO LỖI RÕ chứ không âm thầm cắt —
 * cắt lặng lẽ sẽ ra danh sách thiếu mà người dùng tưởng là đủ.
 */
const TRAN_ID_LOC_BA_MUC = 2000;

/**
 * Id các đơn đặt hàng đã có ít nhất một đơn bán con ĐÃ THANH TOÁN còn hiệu lực.
 * Trả `null` khi máy chủ chưa có cột (chưa chạy 00331/00335).
 */
async function layIdDonCoConHoanTat(
  tenantId: string,
  branchId?: string,
): Promise<string[] | null> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("invoices")
    .select("source_order_id")
    .eq("tenant_id", tenantId)
    .not("source_order_id", "is", null)
    .eq("status", "completed")
    .is("deleted_at", null)
    .is("voided_at", null)
    .is("cancelled_at", null)
    .limit(TRAN_ID_LOC_BA_MUC + 1);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) {
    if (error.code === MA_LOI_CHUA_CO_COT) return null;
    handleError(error, "layIdDonCoConHoanTat");
  }
  const ids = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...new Set(((data ?? []) as any[]).map((r) => String(r.source_order_id))),
  ];
  if (ids.length > TRAN_ID_LOC_BA_MUC) {
    throw new Error(
      `Có quá ${TRAN_ID_LOC_BA_MUC} đơn đặt hàng đã phát sinh hóa đơn — ` +
        "bộ lọc Chờ xử lý / Đang xử lý cần thu hẹp bớt (chọn chi nhánh hoặc " +
        "khoảng ngày) để kết quả đầy đủ.",
    );
  }
  return ids;
}

/**
 * Đếm đơn bán con ĐÃ THANH TOÁN và còn hiệu lực cho một loạt đơn gốc.
 *
 * Trả `null` khi máy chủ chưa có cột (chưa chạy 00331/00335) — nơi gọi phải
 * hiểu là "không biết" chứ không phải "bằng 0".
 */
export async function demDonConHoanTat(
  orderIds: string[],
): Promise<Map<string, number> | null> {
  if (orderIds.length === 0) return new Map();
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("source_order_id")
    .eq("tenant_id", tenantId)
    .in("source_order_id", orderIds)
    .eq("status", "completed")
    .is("deleted_at", null)
    .is("voided_at", null)
    .is("cancelled_at", null);
  if (error) {
    if (error.code === MA_LOI_CHUA_CO_COT) return null;
    handleError(error, "demDonConHoanTat");
  }
  const dem = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const k = String(row.source_order_id);
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  return dem;
}

/** Máy chủ chưa chạy 00331: cột/RPC chưa tồn tại. */
const MA_LOI_CHUA_CO_COT = "42703";
const MA_LOI_CHUA_CO_RPC = new Set(["42883", "PGRST202"]);

/**
 * Tạo MỘT đơn bán con mới từ đơn đặt hàng gốc. Mỗi lần gọi là một bản ghi
 * mới (mã NH mới, client session mới, chép mặt hàng) — thu ngân muốn bao
 * nhiêu đơn con cũng được, RPC không giới hạn.
 */
export async function createChildSaleFromOrder(
  orderId: string,
): Promise<ChildSaleCreated> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "create_child_sale_from_order",
    { p_order_id: orderId },
  );
  if (error) {
    if (MA_LOI_CHUA_CO_RPC.has(error.code ?? "")) {
      throw new Error(
        "Máy chủ chưa bật tính năng đơn bán con (migration 00331 chưa chạy).",
      );
    }
    handleError(error, "createChildSaleFromOrder");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any;
  return {
    childId: String(r.child_id),
    childCode: String(r.child_code),
    clientSessionId: String(r.client_session_id),
    draftRevision: Number(r.draft_revision ?? 0),
    itemCount: Number(r.item_count ?? 0),
    sourceOrderId: String(r.source_order_id),
    sourceOrderCode: String(r.source_order_code ?? ""),
  };
}

/**
 * Danh sách đơn bán con của một đơn gốc (mã + trạng thái + tiền), mới nhất
 * trên cùng. Trả `null` khi máy chủ CHƯA chạy 00331 — màn gọi phải phân biệt
 * "chưa bật tính năng" với "chưa có đơn con nào" ([]).
 */
export async function listChildSales(
  orderId: string,
): Promise<ChildSaleInfo[] | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    // 00335: mỗi đơn bán con có NGÀY HOÁ ĐƠN riêng — hiện theo ngày chứng từ
    // (đã bán = ngày phát hành; còn nháp = ngày tạo). Khác với danh sách ĐƠN
    // ĐẶT HÀNG bên trên vẫn giữ created_at = ngày đặt.
    .select("id, code, status, total, paid, ngay_chung_tu, voided_at, cancelled_at")
    .eq("tenant_id", tenantId)
    .eq("source_order_id", orderId)
    .is("deleted_at", null)
    .order("ngay_chung_tu", { ascending: false });
  if (error) {
    if (error.code === MA_LOI_CHUA_CO_COT) return null;
    handleError(error, "listChildSales");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    code: String(row.code ?? ""),
    status: String(row.status ?? "draft"),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    createdAt: String(row.ngay_chung_tu ?? ""),
    voidedAt: row.voided_at ? String(row.voided_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  }));
}

export interface OrderReconRow {
  productId: string;
  variantId: string | null;
  productName: string;
  unit: string;
  /** Số lượng trên đơn đặt hàng gốc. */
  qtyOrdered: number;
  /** Số lượng đã bán THẬT — chỉ cộng đơn con status='completed'. */
  qtySold: number;
  /** Dương = bán vượt số đặt (bình thường, chỉ cảnh báo nhẹ — không chặn). */
  delta: number;
}

interface ReconItemInput {
  productId: string;
  variantId?: string | null;
  productName: string;
  unit?: string | null;
  quantity: number;
}

/**
 * Toán đối chiếu thuần — tách riêng để test thẳng không cần giả lập mạng.
 * Khoá gộp = productId + variantId (hai cỡ khác nhau là hai dòng khác nhau).
 * Mặt hàng chỉ có ở đơn con (thu ngân bán thêm) vẫn phải hiện: qtyOrdered=0.
 */
export function tinhDoiChieuDatBan(
  hangDat: ReconItemInput[],
  hangBanCompleted: ReconItemInput[],
): OrderReconRow[] {
  const khoa = (i: ReconItemInput) => `${i.productId}::${i.variantId ?? ""}`;
  const bang = new Map<string, OrderReconRow>();
  for (const item of hangDat) {
    const k = khoa(item);
    const dong = bang.get(k) ?? {
      productId: item.productId,
      variantId: item.variantId ?? null,
      productName: item.productName,
      unit: item.unit ?? "",
      qtyOrdered: 0,
      qtySold: 0,
      delta: 0,
    };
    dong.qtyOrdered += Number(item.quantity) || 0;
    bang.set(k, dong);
  }
  for (const item of hangBanCompleted) {
    const k = khoa(item);
    const dong = bang.get(k) ?? {
      productId: item.productId,
      variantId: item.variantId ?? null,
      productName: item.productName,
      unit: item.unit ?? "",
      qtyOrdered: 0,
      qtySold: 0,
      delta: 0,
    };
    dong.qtySold += Number(item.quantity) || 0;
    bang.set(k, dong);
  }
  for (const dong of bang.values()) {
    dong.delta = dong.qtySold - dong.qtyOrdered;
  }
  return Array.from(bang.values());
}

/**
 * Đối chiếu đầy đủ cho màn đơn gốc: danh sách đơn con + bảng đặt/bán/chênh
 * theo mặt hàng. Trả `null` khi máy chủ chưa chạy 00331.
 */
export async function getOrderReconciliation(orderId: string): Promise<{
  children: ChildSaleInfo[];
  rows: OrderReconRow[];
} | null> {
  const children = await listChildSales(orderId);
  if (children === null) return null;

  const supabase = getClient();
  // Mặt hàng đơn gốc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hangDat, error: loiDat } = await (supabase as any)
    .from("invoice_items")
    .select("product_id, variant_id, product_name, unit, quantity")
    .eq("invoice_id", orderId);
  if (loiDat) handleError(loiDat, "getOrderReconciliation.parent");

  // Mặt hàng các đơn con ĐÃ THANH TOÁN — nháp/đã huỷ không tính là "đã bán".
  const idsCompleted = children
    .filter((c) => c.status === "completed")
    .map((c) => c.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hangBan: any[] = [];
  if (idsCompleted.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("invoice_items")
      .select("product_id, variant_id, product_name, unit, quantity")
      .in("invoice_id", idsCompleted);
    if (error) handleError(error, "getOrderReconciliation.children");
    hangBan = data ?? [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doi = (r: any): ReconItemInput => ({
    productId: String(r.product_id),
    variantId: r.variant_id ?? null,
    productName: String(r.product_name ?? ""),
    unit: r.unit ?? "",
    quantity: Number(r.quantity ?? 0),
  });
  return {
    children,
    rows: tinhDoiChieuDatBan((hangDat ?? []).map(doi), hangBan.map(doi)),
  };
}

/**
 * "Hoàn tất xử lý" đơn đặt hàng — thao tác CHỦ ĐỘNG trên màn đơn gốc (00332).
 * Gắn fulfilled_by_id vào một đơn con → đơn hiện "Đã xuất hóa đơn", rời danh
 * sách chờ ở POS. Truyền null để MỞ LẠI. Chỉ ghi đúng một cột, không đụng
 * status/tiền — báo cáo không đổi.
 */
export async function markOrderProcessed(
  orderId: string,
  childInvoiceId: string | null,
): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("mark_order_processed", {
    p_order_id: orderId,
    p_invoice_id: childInvoiceId,
  });
  if (error) {
    if (MA_LOI_CHUA_CO_RPC.has(error.code ?? "")) {
      throw new Error(
        "Máy chủ chưa bật nút hoàn tất xử lý (migration 00332 chưa chạy).",
      );
    }
    handleError(error, "markOrderProcessed");
  }
}
