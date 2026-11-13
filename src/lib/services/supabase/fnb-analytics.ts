/**
 * F&B Analytics — Revenue by menu item, table, hour, cashier.
 * Filters on invoices.source = 'fnb' and joins kitchen_orders + kitchen_order_items.
 */

// Ngày chứng từ (migration 00335): bảng `invoices` dùng cột sinh tự động
// `ngay_chung_tu` = coalesce(issued_at, created_at). Toàn bộ `kitchen_orders`
// giữ `created_at` — đó là thời gian vận hành/giao dịch thật của đơn bếp.
// Generated types chưa khai báo cột này → cast `InvoiceDocRow` tại chỗ đọc.

import { getClient, getCurrentTenantId, handleError } from "./base";
import { formatShortDate } from "@/lib/format";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";

type InvoiceDocRow = { ngay_chung_tu: string; total: number | null };

const FNB_REPORT_PAGE_SIZE = 1000;

interface FnbPagedQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
}

async function fetchAllFnbRows<T>(
  buildQuery: () => FnbPagedQuery<T>,
  context: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += FNB_REPORT_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + FNB_REPORT_PAGE_SIZE - 1,
    );
    if (error) {
      handleError(error, context);
      return [];
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < FNB_REPORT_PAGE_SIZE) break;
  }
  return rows;
}

// === Types ===

export interface FnbKpis {
  totalRevenue: number;
  returnAmount: number;
  netRevenue: number;
  totalOrders: number;
  avgTicket: number;
  avgTurnoverMinutes: number;
}

export interface MenuItemRevenue {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface TableRevenue {
  tableName: string;
  revenue: number;
  orders: number;
}

export interface HourlyRevenue {
  hour: number;
  label: string;
  revenue: number;
  orders: number;
}

export interface CashierPerformance {
  cashierName: string;
  revenue: number;
  orders: number;
  avgTicket: number;
}

export interface FnbInvoiceDetailRow {
  id: string;
  code: string;
  issuedAt: string;
  customerName: string;
  status: string;
  total: number;
  paid: number;
  debt: number;
  paymentMethod: string;
}

export interface FnbInvoiceDetailPage {
  rows: FnbInvoiceDetailRow[];
  hasMore: boolean;
}

export interface FnbReturnDetailRow {
  id: string;
  code: string;
  createdAt: string;
  invoiceCode: string;
  total: number;
  refunded: number;
}

export interface FnbReturnDetailPage {
  rows: FnbReturnDetailRow[];
  hasMore: boolean;
}

/** Return date is the accounting date for the period, even when the sale is older. */
export async function getFnbReturnDetailPage(
  branchId?: string,
  range?: { from: string; to: string },
  offset = 0,
  limit = 50,
): Promise<FnbReturnDetailPage> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const pageSize = Math.min(Math.max(1, limit), 500);
  const start = Math.max(0, offset);
  const { data, error } = await (supabase.rpc as any)("staff_fnb_return_detail_page", {
    p_branch_id:branchId ?? null,p_from:rangeWindow?.start ?? null,p_to:rangeWindow?.end ?? null,
    p_offset:start,p_limit:pageSize+1,
  });
  if (error) {
    handleError(error, "[getFnbReturnDetailPage]");
    return { rows: [], hasMore: false };
  }
  if (!Array.isArray(data)) throw new Error("Không tải được chi tiết phiếu hoàn F&B.");
  const page = data;
  return {
    rows: page.slice(0, pageSize).map((raw) => {
      const row = raw as {
        id: string; code: string; created_at: string; total: number; refunded: number;
        invoice_code: string | null;
      };
      return {
      id: row.id,
      code: row.code,
      createdAt: row.created_at,
      invoiceCode: row.invoice_code ?? "",
      total: Number(row.total ?? 0),
      refunded: Number(row.refunded ?? 0),
      };
    }),
    hasMore: page.length > pageSize,
  };
}

export async function getFnbReturnExportRows(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<FnbReturnDetailRow[]> {
  const rows: FnbReturnDetailRow[] = [];
  for (;;) {
    const page = await getFnbReturnDetailPage(branchId, range, rows.length, 500);
    rows.push(...page.rows);
    if (!page.hasMore || page.rows.length === 0) return rows;
  }
}

/** Read-only, bounded drill-down using the same invoice scope as F&B KPIs. */
export async function getFnbInvoiceDetailPage(
  branchId?: string,
  range?: { from: string; to: string },
  offset = 0,
  limit = 50,
): Promise<FnbInvoiceDetailPage> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const pageSize = Math.min(Math.max(1, limit), 500);
  const start = Math.max(0, offset);

  const {data,error} = await (supabase.rpc as any)("staff_fnb_invoice_detail_page", {
    p_branch_id:branchId ?? null,p_from:rangeWindow?.start ?? null,p_to:rangeWindow?.end ?? null,
    p_offset:start,p_limit:pageSize+1,
  });
  if (error) {
    handleError(error, "[getFnbInvoiceDetailPage]");
    return { rows: [], hasMore: false };
  }
  if (!Array.isArray(data)) throw new Error("Không tải được chi tiết hóa đơn F&B.");
  const page = data;
  return {
    rows: page.slice(0, pageSize).map((invoice: {id:string;code:string;ngay_chung_tu:string;customer_name:string;status:string;total:number;paid:number;debt:number;payment_method:string}) => ({
      id: invoice.id,
      code: invoice.code,
      issuedAt: invoice.ngay_chung_tu,
      customerName: invoice.customer_name || "Khách lẻ",
      status: invoice.status,
      total: Number(invoice.total ?? 0),
      paid: Number(invoice.paid ?? 0),
      debt: Number(invoice.debt ?? 0),
      paymentMethod: invoice.payment_method ?? "",
    })),
    hasMore: page.length > pageSize,
  };
}

/** Explicit export only; paged reads avoid Supabase's per-request row cap. */
export async function getFnbInvoiceExportRows(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<FnbInvoiceDetailRow[]> {
  const rows: FnbInvoiceDetailRow[] = [];
  for (;;) {
    const page = await getFnbInvoiceDetailPage(branchId, range, rows.length, 500);
    rows.push(...page.rows);
    if (!page.hasMore || page.rows.length === 0) return rows;
  }
}

// === Queries ===

/**
 * KPI cards: total revenue, total orders, avg ticket, avg table turnover
 */
export async function getFnbKpis(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<FnbKpis> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const {data,error} = await (supabase.rpc as any)("staff_fnb_kpi_summary", {
    p_branch_id: branchId ?? null, p_from: rangeWindow?.start ?? null, p_to: rangeWindow?.end ?? null,
  });
  if (error) handleError(error, "[getFnbKpis]");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Không tải được tổng hợp F&B.");
  const keys = ["totalRevenue","returnAmount","netRevenue","totalOrders","avgTicket","avgTurnoverMinutes"] as const;
  const values = Object.fromEntries(keys.map(key => [key, Number(data[key])])) as unknown as FnbKpis;
  if (keys.some(key => data[key] == null || !Number.isFinite(values[key]))) {
    throw new Error("Dữ liệu tổng hợp F&B chưa hợp lệ. Vui lòng tải lại.");
  }
  return values;
}

/**
 * Top menu items by revenue (from kitchen_order_items joined with completed invoices)
 */
export async function getRevenueByMenuItem(
  branchId?: string,
  limit = 15,
  range?: { from: string; to: string },
): Promise<MenuItemRevenue[]> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  // Only aggregates cross the API boundary; per-bill rows stay protected.
  const {data,error} = await (supabase.rpc as any)("staff_fnb_menu_summary", {
    p_branch_id: branchId ?? null, p_from: rangeWindow?.start ?? null,
    p_to: rangeWindow?.end ?? null, p_limit: limit,
  });
  if (error) handleError(error, "[getRevenueByMenuItem]");
  if (!Array.isArray(data)) throw new Error("Không tải được tổng hợp món F&B.");
  return data.map((row: {product_name: string; quantity: number | string; revenue: number | string}) => {
    const quantity = Number(row.quantity), revenue = Number(row.revenue);
    if (typeof row.product_name !== "string" || row.quantity == null || row.revenue == null ||
        !Number.isFinite(quantity) || !Number.isFinite(revenue)) {
      throw new Error("Dữ liệu tổng hợp món F&B chưa hợp lệ. Vui lòng tải lại.");
    }
    return {productName: row.product_name, quantity, revenue};
  });
}

/**
 * Revenue by table
 */
export async function getRevenueByTable(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<TableRevenue[]> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const {data,error} = await (supabase.rpc as any)("staff_fnb_table_summary", {
    p_branch_id: branchId ?? null, p_from: rangeWindow?.start ?? null, p_to: rangeWindow?.end ?? null,
  });
  if (error) handleError(error, "[getRevenueByTable]");
  if (!Array.isArray(data)) throw new Error("Không tải được tổng hợp bàn F&B.");
  return data.map((row: {table_name: string; revenue: number | string; orders: number | string}) => {
    const revenue = Number(row.revenue), orders = Number(row.orders);
    if (typeof row.table_name !== "string" || row.revenue == null || row.orders == null ||
        !Number.isFinite(revenue) || !Number.isFinite(orders)) {
      throw new Error("Dữ liệu tổng hợp bàn F&B chưa hợp lệ. Vui lòng tải lại.");
    }
    return {tableName: row.table_name, revenue, orders};
  });
}

/**
 * Revenue by hour of day (0-23)
 */
export async function getRevenueByHourFnb(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<HourlyRevenue[]> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const {data,error} = await (supabase.rpc as any)("staff_fnb_hour_summary", {
    p_branch_id:branchId ?? null,p_from:rangeWindow?.start ?? null,p_to:rangeWindow?.end ?? null,
  });
  if (error) handleError(error, "[getRevenueByHourFnb]");
  if (!Array.isArray(data) || data.length !== 24) throw new Error("Không tải đủ tổng hợp theo giờ F&B.");
  return data.map((row: {hour:number;revenue:number|string;orders:number|string}, index:number) => {
    const hour=Number(row.hour),revenue=Number(row.revenue),orders=Number(row.orders);
    if (hour!==index || row.revenue==null || row.orders==null || !Number.isFinite(revenue) || !Number.isFinite(orders)) {
      throw new Error("Dữ liệu tổng hợp theo giờ F&B chưa hợp lệ. Vui lòng tải lại.");
    }
    return {hour,label:`${hour}h`,revenue,orders};
  });
}

/**
 * Cashier performance — revenue and orders per cashier
 */
export async function getCashierPerformance(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<CashierPerformance[]> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const {data,error} = await (supabase.rpc as any)("staff_fnb_cashier_summary", {
    p_branch_id:branchId ?? null,p_from:rangeWindow?.start ?? null,p_to:rangeWindow?.end ?? null,
  });
  if (error) handleError(error, "[getCashierPerformance]");
  if (!Array.isArray(data)) throw new Error("Không tải được tổng hợp nhân viên F&B.");
  return data.map((row: {cashier_name:string;revenue:number|string;orders:number|string;avg_ticket:number|string}) => {
    const revenue=Number(row.revenue),orders=Number(row.orders),avgTicket=Number(row.avg_ticket);
    if (typeof row.cashier_name!=="string" || row.revenue==null || row.orders==null || row.avg_ticket==null ||
        !Number.isFinite(revenue) || !Number.isFinite(orders) || !Number.isFinite(avgTicket)) {
      throw new Error("Dữ liệu tổng hợp nhân viên F&B chưa hợp lệ. Vui lòng tải lại.");
    }
    return {cashierName:row.cashier_name,revenue,orders,avgTicket};
  });
}

// === New report types ===

export interface OrderTypeRevenue {
  orderType: string;
  orderTypeLabel: string;
  revenue: number;
  orders: number;
}

export interface PlatformRevenue {
  platform: string;
  revenue: number;
  orders: number;
}

interface FnbCategoryItemRow {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  products: {
    category_id: string;
    product_categories: { name: string } | null;
  } | null;
}
export interface CategoryRevenue {
  categoryName: string;
  revenue: number;
  orders: number;
  quantity: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

// === New report queries ===

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Tại quán",
  takeaway: "Mang về",
  delivery: "Giao hàng",
};

/**
 * Revenue by order type (dine_in / takeaway / delivery)
 */
export async function getRevenueByOrderType(
  branchId?: string,
): Promise<OrderTypeRevenue[]> {
  const supabase = getClient();
  const {data,error}=await (supabase.rpc as any)("staff_fnb_channel_summary",{
    p_branch_id:branchId ?? null,p_dimension:"order_type",
  });
  if(error) handleError(error,"[getRevenueByOrderType]");
  if(!Array.isArray(data)) throw new Error("Không tải được tổng hợp loại đơn F&B.");
  return data.map((row: {dimension:string;revenue:number|string;orders:number|string})=>{
    const revenue=Number(row.revenue),orders=Number(row.orders);
    if(typeof row.dimension!=="string" || row.revenue==null || row.orders==null ||
      !Number.isFinite(revenue) || !Number.isFinite(orders)) throw new Error("Dữ liệu loại đơn F&B chưa hợp lệ.");
    return {orderType:row.dimension,orderTypeLabel:ORDER_TYPE_LABELS[row.dimension] ?? row.dimension,revenue,orders};
  });
}

/**
 * Revenue by delivery platform (Shopee Food, Grab, GoJek, Be, etc.)
 */
export async function getRevenueByPlatform(
  branchId?: string,
): Promise<PlatformRevenue[]> {
  const supabase = getClient();
  const {data,error}=await (supabase.rpc as any)("staff_fnb_channel_summary",{
    p_branch_id:branchId ?? null,p_dimension:"platform",
  });
  if(error) handleError(error,"[getRevenueByPlatform]");
  if(!Array.isArray(data)) throw new Error("Không tải được tổng hợp kênh giao F&B.");
  return data.map((row: {dimension:string;revenue:number|string;orders:number|string})=>{
    const revenue=Number(row.revenue),orders=Number(row.orders);
    if(typeof row.dimension!=="string" || row.revenue==null || row.orders==null ||
      !Number.isFinite(revenue) || !Number.isFinite(orders)) throw new Error("Dữ liệu kênh giao F&B chưa hợp lệ.");
    return {platform:row.dimension,revenue,orders};
  });
}

/**
 * Revenue by product category
 */
export async function getRevenueByCategory(
  branchId?: string,
): Promise<CategoryRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Include paid orders even when kitchen work is still marked served.
  let koQuery = supabase
    .from("kitchen_orders")
    .select("id, invoices!inner(status, source)")
    .eq("tenant_id", tenantId)
    .eq("invoices.source", "fnb")
    .eq("invoices.status", "completed");
  if (branchId) koQuery = koQuery.eq("branch_id", branchId);

  const koRows = await fetchAllFnbRows(() => koQuery.order("id", { ascending: true }), "[fnb.kitchenOrders]");
  const koIds = (koRows ?? []).map((r) => r.id);
  if (koIds.length === 0) return [];

  // Get items with product category — scope qua kitchen_order_id
  const items: FnbCategoryItemRow[] = [];
  for (let offset = 0; offset < koIds.length; offset += 200) {
    const chunkIds = koIds.slice(offset, offset + 200);
    const chunk = await fetchAllFnbRows<FnbCategoryItemRow>(
      () => supabase
        .from("kitchen_order_items")
        .select("product_id, product_name, quantity, unit_price, products:products_scoped(category_id, product_categories(name))")
        .in("kitchen_order_id", chunkIds)
        .order("id", { ascending: true }) as unknown as FnbPagedQuery<FnbCategoryItemRow>,
      "[getRevenueByCategory.items]",
    );
    items.push(...chunk);
  }

  const map = new Map<string, { categoryName: string; revenue: number; orders: number; quantity: number }>();
  for (const item of items ?? []) {
    const prod = item.products;
    const catName = prod?.product_categories?.name ?? "Chưa phân loại";
    const key = prod?.category_id ?? "unknown";
    const prev = map.get(key) ?? { categoryName: catName, revenue: 0, orders: 0, quantity: 0 };
    prev.revenue += item.quantity * Number(item.unit_price);
    prev.quantity += item.quantity;
    prev.orders += 1;
    map.set(key, prev);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Daily revenue trend (last N days)
 */
export async function getDailyRevenueFnb(
  branchId?: string,
  days = 30,
): Promise<DailyRevenue[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from("invoices")
    .select("total, ngay_chung_tu")
    .eq("tenant_id", tenantId)
    .eq("source", "fnb")
    .not("status", "eq", "cancelled")
    .gte("ngay_chung_tu", since.toISOString());
  if (branchId) query = query.eq("branch_id", branchId);

  const rows = await fetchAllFnbRows(() => query.order("id", { ascending: true }), "[fnb.report]");

  const map = new Map<string, { revenue: number; orders: number }>();
  for (const row of (rows ?? []) as unknown as InvoiceDocRow[]) {
    const date = formatShortDate(row.ngay_chung_tu);
    const prev = map.get(date) ?? { revenue: 0, orders: 0 };
    prev.revenue += Number(row.total ?? 0);
    prev.orders += 1;
    map.set(date, prev);
  }

  return Array.from(map.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => {
      const [dA, mA, yA] = a.date.split("/").map(Number);
      const [dB, mB, yB] = b.date.split("/").map(Number);
      return new Date(yA, mA - 1, dA).getTime() - new Date(yB, mB - 1, dB).getTime();
    });
}

/**
 * Table turnover — avg time per table from order created to completed
 */
export async function getTableTurnover(
  branchId?: string,
): Promise<{ tableName: string; avgMinutes: number; orders: number }[]> {
  const supabase = getClient();
  const {data,error}=await (supabase.rpc as any)("staff_fnb_turnover_summary",{p_branch_id:branchId ?? null});
  if(error) handleError(error,"[getTableTurnover]");
  if(!Array.isArray(data)) throw new Error("Không tải được tổng hợp thời gian phục vụ.");
  return data.map((row:{table_name:string;avg_minutes:number|string;orders:number|string})=>{
    const avgMinutes=Number(row.avg_minutes),orders=Number(row.orders);
    if(typeof row.table_name!=="string" || row.avg_minutes==null || row.orders==null ||
       !Number.isFinite(avgMinutes) || !Number.isFinite(orders)) throw new Error("Dữ liệu thời gian phục vụ chưa hợp lệ.");
    return {tableName:row.table_name,avgMinutes,orders};
  });
}

/**
 * Day 21/05/2026 (CEO): Số đơn delivery hôm nay tại 1 branch.
 * Dùng cho badge "Hôm nay: N đơn giao" trên header POS FnB.
 *
 * Logic: kitchen_orders.order_type='delivery' + created_at hôm nay (local timezone)
 * + status != 'cancelled'.
 */
export async function getDeliveryCountToday(branchId: string): Promise<number> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Tính range "hôm nay" theo Asia/Ho_Chi_Minh (UTC+7)
  const now = new Date();
  const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const { count, error } = await supabase
    .from("kitchen_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("order_type", "delivery")
    .not("status", "eq", "cancelled")
    .gte("created_at", startLocal.toISOString())
    .lt("created_at", endLocal.toISOString());

  if (error) {
    console.warn("[getDeliveryCountToday]", error.message);
    return 0;
  }
  return count ?? 0;
}

// ============================================================
// Delivery staff performance (CEO 21/05/2026 — migration 00108)
// ============================================================

export interface DeliveryStaffPerformance {
  staffId: string;
  staffName: string;
  /** Số đơn đã giao trong kỳ (delivery_staff_id = staffId) */
  totalOrders: number;
  /** Tổng doanh thu các đơn shipper này giao (để tính commission nếu cần) */
  totalRevenue: number;
  /** Tổng phí giao thu hộ quán (delivery_fee cộng dồn) */
  totalDeliveryFee: number;
  /**
   * Avg time (assigned_at → completed_at) tính bằng giây.
   * 0 nếu không có đơn nào completed (chưa bấm "giao xong" trong UI).
   */
  avgDeliverySeconds: number;
  /** Số đơn đã completed (có timestamp delivery_completed_at) */
  completedCount: number;
}

export interface ShipperOrderRow {
  kitchenOrderId: string;
  orderNumber: string;
  invoiceId: string | null;
  invoiceCode: string | null;
  customerName: string;
  total: number;
  deliveryFee: number;
  deliveryTier: string | null;
  assignedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

/**
 * Hiệu suất shipper — top theo số đơn giao + doanh thu.
 *
 * Range filter dựa kitchen_orders.created_at (lúc đơn được tạo).
 */
export async function getDeliveryStaffPerformance(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<DeliveryStaffPerformance[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Cast as any vì Supabase generated types chưa reflect column delivery_*
  // (migration 00108 chưa được codegen). Sau khi `pnpm gen-types` thì xoá cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("kitchen_orders")
    .select(
      "delivery_staff_id, delivery_fee, delivery_assigned_at, delivery_completed_at, invoice_id, invoices(total)",
    )
    .eq("tenant_id", tenantId)
    .not("delivery_staff_id", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);
  const rangeWindow = toCreatedAtRangeWindow(range);
  if (rangeWindow) {
    query = query
      .gte("created_at", rangeWindow.start)
      .lt("created_at", rangeWindow.end);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await fetchAllFnbRows<any>(() => query, "[fnb.delivery]");
  const staffIds = Array.from(
    new Set(
      (rows ?? [])
        .map((row) => String(row.delivery_staff_id ?? ""))
        .filter(Boolean),
    ),
  );
  const profiles = staffIds.length
    ? await fetchAllFnbRows<{ id: string; full_name: string | null }>(
        () =>
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("tenant_id", tenantId)
            .in("id", staffIds)
            .order("id", { ascending: true }),
        "[fnb.deliveryProfiles]",
      )
    : [];
  const staffNames = new Map(
    profiles.map((profile) => [profile.id, profile.full_name ?? "Không rõ"]),
  );

  const map = new Map<
    string,
    {
      staffName: string;
      totalOrders: number;
      totalRevenue: number;
      totalDeliveryFee: number;
      totalSec: number;
      completedCount: number;
    }
  >();
  for (const row of rows ?? []) {
    const staffId = row.delivery_staff_id as string;
    if (!staffId) continue;
    const name = staffNames.get(staffId) ?? "Không rõ";
    const inv = row.invoices as { total?: number } | null;
    const revenue = Number(inv?.total ?? 0);
    const fee = Number(row.delivery_fee ?? 0);

    const prev = map.get(staffId) ?? {
      staffName: name,
      totalOrders: 0,
      totalRevenue: 0,
      totalDeliveryFee: 0,
      totalSec: 0,
      completedCount: 0,
    };
    prev.totalOrders += 1;
    prev.totalRevenue += revenue;
    prev.totalDeliveryFee += fee;

    if (row.delivery_assigned_at && row.delivery_completed_at) {
      const sec =
        (new Date(row.delivery_completed_at).getTime() -
          new Date(row.delivery_assigned_at).getTime()) /
        1000;
      if (sec > 0) {
        prev.totalSec += sec;
        prev.completedCount += 1;
      }
    }
    map.set(staffId, prev);
  }

  return Array.from(map.entries())
    .map(([staffId, v]) => ({
      staffId,
      staffName: v.staffName,
      totalOrders: v.totalOrders,
      totalRevenue: v.totalRevenue,
      totalDeliveryFee: v.totalDeliveryFee,
      avgDeliverySeconds:
        v.completedCount > 0 ? Math.round(v.totalSec / v.completedCount) : 0,
      completedCount: v.completedCount,
    }))
    .sort((a, b) => b.totalOrders - a.totalOrders);
}

// ============================================================
// Modifier analytics (CEO 01/06/2026 — Bước 2 Sprint 2.5)
// ============================================================
// Phân tích doanh thu theo modifier choices (Mức đường 70%, Topping Trân châu...).
// Parse modifier_selections JSONB client-side vì hợp lệ cho data size hiện tại
// (~1000 lines / ngày). Khi scale lên 50k+ lines → cần SQL function aggregate.

export interface ModifierStatRow {
  groupId: string;
  groupName: string;
  optionId: string;
  optionLabel: string;
  /** Số lần option này được chọn (= số line có chứa option này) */
  count: number;
  /** Tổng quantity (vd 1 line × qty 3 → +3) */
  totalQuantity: number;
  /** Doanh thu phí cộng (priceDelta × quantity) */
  totalPriceDelta: number;
  /** % count trong cùng group (tính sau ở UI) */
  percentInGroup?: number;
}

/**
 * Lấy thống kê chọn modifier theo branch + date range.
 * Chỉ nhận tổng hợp tùy chọn từ các đơn đã thanh toán.
 */
export async function getModifierStats(
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ModifierStatRow[]> {
  const supabase = getClient();
  const rangeWindow = toCreatedAtRangeWindow(range);
  const {data,error} = await (supabase.rpc as any)("staff_fnb_modifier_summary", {
    p_branch_id:branchId ?? null,p_from:rangeWindow?.start ?? null,p_to:rangeWindow?.end ?? null,
  });
  if (error) handleError(error, "[getModifierStats]");
  if (!Array.isArray(data)) throw new Error("Không tải được tổng hợp tùy chọn F&B.");
  const rows = data.map((row: {group_id:string;group_name:string;option_id:string;option_label:string;
    selection_count:number|string;total_quantity:number|string;total_price_delta:number|string;percent_in_group:number|string}) => {
    const count=Number(row.selection_count),totalQuantity=Number(row.total_quantity);
    const totalPriceDelta=Number(row.total_price_delta),percentInGroup=Number(row.percent_in_group);
    if ([row.group_id,row.group_name,row.option_id,row.option_label].some(value=>typeof value!=="string") ||
        [row.selection_count,row.total_quantity,row.total_price_delta,row.percent_in_group].some(value=>value==null) ||
        ![count,totalQuantity,totalPriceDelta,percentInGroup].every(Number.isFinite)) {
      throw new Error("Dữ liệu tổng hợp tùy chọn F&B chưa hợp lệ. Vui lòng tải lại.");
    }
    return {groupId:row.group_id,groupName:row.group_name,optionId:row.option_id,
      optionLabel:row.option_label,count,totalQuantity,totalPriceDelta,percentInGroup};
  });
  return rows.sort((a, b) => {
    if (a.groupName !== b.groupName) return a.groupName.localeCompare(b.groupName, "vi");
    return b.count - a.count;
  });
}

/**
 * Drill-down: danh sách đơn của 1 shipper cụ thể.
 */
export async function getOrdersByDeliveryStaff(
  staffId: string,
  branchId?: string,
  range?: { from: string; to: string },
): Promise<ShipperOrderRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Cast as any vì Supabase generated types chưa reflect column delivery_*
  // (migration 00108 chưa được codegen). Sau khi `pnpm gen-types` thì xoá cast.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let query: any = (supabase.from("kitchen_orders") as any)
    .select(
      // kitchen_orders KHÔNG có cột customer_name → để trong select là query
      // lỗi 42703, cả báo cáo shipper trắng. Tên khách lấy từ hoá đơn kèm.
      "id, order_number, delivery_fee, delivery_distance_tier, delivery_assigned_at, delivery_completed_at, created_at, invoice_id, invoices(id, code, total, customer_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("delivery_staff_id", staffId);
  if (branchId) query = query.eq("branch_id", branchId);
  const rangeWindow = toCreatedAtRangeWindow(range);
  if (rangeWindow) {
    query = query
      .gte("created_at", rangeWindow.start)
      .lt("created_at", rangeWindow.end);
  }
  query = query.order("created_at", { ascending: false });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await fetchAllFnbRows<any>(() => query, "[fnb.delivery]");

  return (rows ?? []).map((row) => {
    const inv = row.invoices as
      | { id?: string; code?: string; total?: number; customer_name?: string }
      | null;
    const durationSec =
      row.delivery_assigned_at && row.delivery_completed_at
        ? Math.round(
            (new Date(row.delivery_completed_at).getTime() -
              new Date(row.delivery_assigned_at).getTime()) /
              1000,
          )
        : null;
    return {
      kitchenOrderId: row.id as string,
      orderNumber: row.order_number as string,
      invoiceId: (inv?.id as string) ?? null,
      invoiceCode: (inv?.code as string) ?? null,
      customerName:
        (inv?.customer_name as string) ??
        (row.customer_name as string) ??
        "Khách lẻ",
      total: Number(inv?.total ?? 0),
      deliveryFee: Number(row.delivery_fee ?? 0),
      deliveryTier: (row.delivery_distance_tier as string) ?? null,
      assignedAt: (row.delivery_assigned_at as string) ?? null,
      completedAt: (row.delivery_completed_at as string) ?? null,
      durationSeconds: durationSec,
      createdAt: row.created_at as string,
    };
  });
}
