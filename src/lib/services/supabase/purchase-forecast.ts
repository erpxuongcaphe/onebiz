/**
 * Dự kiến mua hàng (MRP) — CEO 14/07.
 *
 * Từ ĐƠN ĐẶT HÀNG đang mở (chưa giao/chưa hoàn tất) → trừ phần đã xuất bằng
 * hóa đơn con đã hoàn thành → nổ BOM của SKU CÒN LẠI → ra danh sách NGUYÊN
 * VẬT LIỆU cần chuẩn bị/mua, so với TỒN KHO TỔNG.
 *
 * QUYẾT ĐỊNH CEO CHỐT (v1):
 *  1. Đơn tính nhu cầu = source='order', status ∈ {draft, confirmed, delivering}
 *     (chưa hoàn tất/hủy), chưa xóa mềm.
 *  2. Tồn NVL CHỈ lấy KHO TỔNG (branch_type='warehouse') qua branch_stock
 *     (dòng gốc variant_id IS NULL) — KHÔNG dùng products.stock toàn chuỗi.
 *  3. Đơn giá = giá vốn NVL (products.cost_price).
 *  4. "Cần mua" = max(0, cần − tồn Kho Tổng) — chưa trừ hàng đang về (v2).
 *  5. Theo nhu cầu đơn thuần — không cộng tồn tối thiểu.
 *
 * Công thức: NVL cần = Σ( SL_SKU × item.quantity × (1 + waste%) / yield_qty ),
 * nổ ĐỆ QUY nếu 1 thành phần lại là SKU có công thức (mã 2-lớp / Yaourt).
 * Số liệu đã verify prototype trên data thật.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

/** Trạng thái đơn đặt hàng coi là "đang mở / chưa hoàn tất". */
const OPEN_ORDER_STATUSES = ["draft", "confirmed", "delivering"] as const;

export interface ForecastSkuRow {
  productId: string;
  code: string;
  name: string;
  unit: string;
  branchId: string | null;
  branchName: string;
  /** Số lượng ghi trên đơn đặt hàng gốc. */
  orderedQuantity: number;
  /** Số lượng đã xuất qua hóa đơn con completed còn hiệu lực. */
  issuedQuantity: number;
  /** Số lượng còn phải xuất; đây là số được nổ BOM. */
  remainingQuantity: number;
  /** Giá trị phần còn phải xuất, phân bổ theo tỷ lệ số lượng. */
  amount: number;
}

export interface ForecastMaterialRow {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  /** Tổng SL cần theo BOM (đã gồm hao hụt). */
  required: number;
  /** Tồn tại Kho Tổng. */
  stockKhoTong: number;
  /** = max(0, required − stock). */
  toBuy: number;
  unitCost: number;
  /** = toBuy × unitCost. */
  amount: number;
}

export interface PurchaseForecastResult {
  khoTongName: string | null;
  orderCount: number;
  /** Tab 1: chi tiết đặt hàng theo chi nhánh + SKU. */
  skuRows: ForecastSkuRow[];
  /** Tab 2: NVL dự kiến mua (sắp theo thành tiền giảm dần). */
  materials: ForecastMaterialRow[];
  totalToBuyAmount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export interface PurchaseForecastOrderLine {
  orderId: string;
  productId: string;
  quantity: number;
  total: number;
}

export interface PurchaseForecastChildSale {
  id: string;
  orderId: string;
  status: string;
  deletedAt?: string | null;
  voidedAt?: string | null;
  cancelledAt?: string | null;
}

export interface PurchaseForecastChildSaleLine {
  childSaleId: string;
  productId: string;
  quantity: number;
}

export interface PurchaseForecastRemainingLine {
  orderId: string;
  productId: string;
  orderedQuantity: number;
  issuedQuantity: number;
  remainingQuantity: number;
  remainingAmount: number;
}

/** Chỉ hóa đơn con đã hoàn thành và chưa bị đảo/hủy mới làm giảm nhu cầu mua. */
export function laHoaDonConDaXuatHopLe(
  invoice: PurchaseForecastChildSale,
): boolean {
  return (
    invoice.status === "completed" &&
    !invoice.deletedAt &&
    !invoice.voidedAt &&
    !invoice.cancelledAt
  );
}

/**
 * Tính phần hàng còn phải xuất trên TỪNG đơn gốc và TỪNG SKU.
 *
 * Không trừ chéo giữa hai đơn: cùng một SKU của DH A đã xuất không được làm
 * giảm nhu cầu của DH B. Bán vượt số đặt chỉ đưa nhu cầu của dòng đó về 0;
 * hàng bán thêm không tạo nhu cầu âm trong MRP.
 */
export function tinhNhuCauMuaConLai(
  orderLines: PurchaseForecastOrderLine[],
  childSales: PurchaseForecastChildSale[],
  childSaleLines: PurchaseForecastChildSaleLine[],
): PurchaseForecastRemainingLine[] {
  const khoaDonHang = (orderId: string, productId: string) =>
    `${orderId}::${productId}`;
  const donConHopLe = new Map(
    childSales
      .filter(laHoaDonConDaXuatHopLe)
      .map((sale) => [sale.id, sale.orderId]),
  );
  const daXuat = new Map<string, number>();
  for (const line of childSaleLines) {
    const orderId = donConHopLe.get(line.childSaleId);
    if (!orderId || !line.productId) continue;
    const key = khoaDonHang(orderId, line.productId);
    daXuat.set(key, (daXuat.get(key) ?? 0) + (Number(line.quantity) || 0));
  }

  const datTheoDon = new Map<
    string,
    { orderId: string; productId: string; quantity: number; total: number }
  >();
  for (const line of orderLines) {
    if (!line.productId) continue;
    const key = khoaDonHang(line.orderId, line.productId);
    const current = datTheoDon.get(key) ?? {
      orderId: line.orderId,
      productId: line.productId,
      quantity: 0,
      total: 0,
    };
    current.quantity += Number(line.quantity) || 0;
    current.total += Number(line.total) || 0;
    datTheoDon.set(key, current);
  }

  return [...datTheoDon.entries()].map(([key, line]) => {
    const issuedQuantity = daXuat.get(key) ?? 0;
    const remainingQuantity = Math.max(0, line.quantity - issuedQuantity);
    return {
      orderId: line.orderId,
      productId: line.productId,
      orderedQuantity: line.quantity,
      issuedQuantity,
      remainingQuantity,
      // MRP không lấy doanh thu hóa đơn con làm giá trị dự kiến mua. Giá trị
      // của phần còn lại luôn phân bổ từ giá trị đơn gốc.
      remainingAmount:
        line.quantity > 0
          ? (line.total * remainingQuantity) / line.quantity
          : 0,
    };
  });
}

/** Lấy active BOM (map productId → {id, yieldQty}) cho 1 tập product id. */
async function fetchActiveBoms(
  supabase: AnyRow,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, { id: string; yieldQty: number }>> {
  const map = new Map<string, { id: string; yieldQty: number }>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data } = await supabase
      .from("bom")
      .select("id, product_id, yield_qty")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("product_id", productIds.slice(i, i + 200));
    for (const b of (data ?? []) as AnyRow[]) {
      // 1 SKU chỉ có 1 BOM active (đã verify) — giữ cái đầu nếu lỡ trùng.
      if (!map.has(b.product_id))
        map.set(b.product_id, { id: b.id, yieldQty: Number(b.yield_qty) || 1 });
    }
  }
  return map;
}

/** Lấy bom_items (map bomId → items[]) cho 1 tập bom id. */
async function fetchBomItems(
  supabase: AnyRow,
  bomIds: string[],
): Promise<Map<string, Array<{ materialId: string; quantity: number; waste: number }>>> {
  const map = new Map<string, Array<{ materialId: string; quantity: number; waste: number }>>();
  for (let i = 0; i < bomIds.length; i += 200) {
    const { data } = await supabase
      .from("bom_items")
      .select("bom_id, material_id, quantity, waste_percent")
      .in("bom_id", bomIds.slice(i, i + 200));
    for (const it of (data ?? []) as AnyRow[]) {
      const arr = map.get(it.bom_id) ?? [];
      arr.push({
        materialId: it.material_id,
        quantity: Number(it.quantity) || 0,
        waste: Number(it.waste_percent) || 0,
      });
      map.set(it.bom_id, arr);
    }
  }
  return map;
}

export async function getPurchaseForecast(
  /**
   * 29/07 (CEO): thêm lọc theo KHÁCH và NHÓM KHÁCH — để biết "đơn của nhóm
   * khách sỉ này cần mua bao nhiêu nguyên liệu". Dùng customers.group_id có
   * sẵn (5 nhóm đã gán), không cần bảng mới.
   */
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    customerId?: string;
    customerGroupId?: string;
  },
  branchId?: string,
): Promise<PurchaseForecastResult> {
  const supabase = getClient() as AnyRow;
  const tenantId = await getCurrentTenantId();

  // ── 1) Xác định Kho Tổng ──
  const { data: khoRows } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("branch_type", "warehouse");
  const khoTong = (khoRows ?? [])[0] as { id: string; name: string } | undefined;

  // ── 2) Đơn đặt hàng đang mở ──
  let orderQ = supabase
    .from("invoices")
    .select("id, code, order_code, branch_id, branches!invoices_branch_id_fkey(name)")
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    .is("deleted_at", null)
    // "Hoàn tất xử lý" là xác nhận không cần dùng đơn này để dự kiến mua nữa.
    .is("fulfilled_by_id", null)
    .in("status", OPEN_ORDER_STATUSES as unknown as string[]);
  orderQ = applyCreatedAtRangeFilter(orderQ, filters);
  if (branchId) orderQ = orderQ.eq("branch_id", branchId);

  // Lọc theo khách cụ thể
  if (filters?.customerId) orderQ = orderQ.eq("customer_id", filters.customerId);

  // Lọc theo NHÓM khách: lấy danh sách khách thuộc nhóm rồi lọc đơn theo đó.
  // Không join thẳng vì đơn có thể là khách vãng lai (customer_id null) —
  // lọc theo nhóm thì những đơn đó phải bị loại, đúng ý "đơn của nhóm này".
  if (filters?.customerGroupId) {
    const { data: khachTrongNhom } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("group_id", filters.customerGroupId);
    const ids = ((khachTrongNhom ?? []) as AnyRow[]).map((c) => c.id as string);
    if (ids.length === 0) {
      return {
        khoTongName: khoTong?.name ?? null,
        orderCount: 0,
        skuRows: [],
        materials: [],
        totalToBuyAmount: 0,
      };
    }
    orderQ = orderQ.in("customer_id", ids);
  }
  const { data: orders, error: orderErr } = await orderQ;
  if (orderErr) handleError(orderErr, "getPurchaseForecast.orders");

  const orderList = (orders ?? []) as AnyRow[];
  const orderBranch = new Map<string, { id: string | null; name: string }>();
  for (const o of orderList) {
    orderBranch.set(o.id, {
      id: o.branch_id ?? null,
      name: (o.branches as { name: string } | null)?.name ?? "—",
    });
  }
  const orderIds = orderList.map((o) => o.id);

  if (orderIds.length === 0) {
    return {
      khoTongName: khoTong?.name ?? null,
      orderCount: 0,
      skuRows: [],
      materials: [],
      totalToBuyAmount: 0,
    };
  }

  // ── 3) Lấy dòng đơn gốc và phần đã xuất từ hóa đơn con hợp lệ ──
  const orderLines: PurchaseForecastOrderLine[] = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data: items } = await supabase
      .from("invoice_items")
      .select("invoice_id, product_id, quantity, total")
      .in("invoice_id", orderIds.slice(i, i + 100));
    for (const it of (items ?? []) as AnyRow[]) {
      if (!it.product_id) continue;
      orderLines.push({
        orderId: it.invoice_id,
        productId: it.product_id,
        quantity: Number(it.quantity) || 0,
        total: Number(it.total) || 0,
      });
    }
  }

  const childSales: PurchaseForecastChildSale[] = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data: children } = await supabase
      .from("invoices")
      .select("id, source_order_id, status, deleted_at, voided_at, cancelled_at")
      .eq("tenant_id", tenantId)
      .in("source_order_id", orderIds.slice(i, i + 100))
      .eq("status", "completed")
      .is("deleted_at", null)
      .is("voided_at", null)
      .is("cancelled_at", null);
    for (const child of (children ?? []) as AnyRow[]) {
      childSales.push({
        id: child.id,
        orderId: child.source_order_id,
        status: child.status,
        deletedAt: child.deleted_at,
        voidedAt: child.voided_at,
        cancelledAt: child.cancelled_at,
      });
    }
  }

  const childSaleLines: PurchaseForecastChildSaleLine[] = [];
  const childSaleIds = childSales.map((sale) => sale.id);
  for (let i = 0; i < childSaleIds.length; i += 100) {
    const { data: items } = await supabase
      .from("invoice_items")
      .select("invoice_id, product_id, quantity")
      .in("invoice_id", childSaleIds.slice(i, i + 100));
    for (const it of (items ?? []) as AnyRow[]) {
      if (!it.product_id) continue;
      childSaleLines.push({
        childSaleId: it.invoice_id,
        productId: it.product_id,
        quantity: Number(it.quantity) || 0,
      });
    }
  }

  const remainingLines = tinhNhuCauMuaConLai(
    orderLines,
    childSales,
    childSaleLines,
  );

  // key = branchId|productId. Chỉ phần CÒN CẦN mới đi xuống BOM/MRP.
  const perBranch = new Map<
    string,
    {
      productId: string;
      branchId: string | null;
      branchName: string;
      orderedQuantity: number;
      issuedQuantity: number;
      remainingQuantity: number;
      amount: number;
    }
  >();
  const totalDemand = new Map<string, number>();
  const orderIdsConNhuCau = new Set<string>();
  for (const line of remainingLines) {
    if (line.remainingQuantity <= 0) continue;
    const br = orderBranch.get(line.orderId) ?? { id: null, name: "—" };
    const key = `${br.id ?? "null"}|${line.productId}`;
    const current = perBranch.get(key) ?? {
      productId: line.productId,
      branchId: br.id,
      branchName: br.name,
      orderedQuantity: 0,
      issuedQuantity: 0,
      remainingQuantity: 0,
      amount: 0,
    };
    current.orderedQuantity += line.orderedQuantity;
    current.issuedQuantity += line.issuedQuantity;
    current.remainingQuantity += line.remainingQuantity;
    current.amount += line.remainingAmount;
    perBranch.set(key, current);
    totalDemand.set(
      line.productId,
      (totalDemand.get(line.productId) ?? 0) + line.remainingQuantity,
    );
    orderIdsConNhuCau.add(line.orderId);
  }

  // ── 4) Nổ BOM theo TỪNG CẤP (batch), gộp NVL lá ──
  // need theo product hiện tại; mỗi vòng: product có BOM → tách xuống thành phần.
  const nvlNeed = new Map<string, number>(); // materialId (không có BOM) → SL cần
  let frontier = new Map<string, number>(totalDemand); // productId → qty còn phải nổ
  const guardVisited = new Set<string>();
  for (let level = 0; level < 6 && frontier.size > 0; level++) {
    const ids = [...frontier.keys()];
    const boms = await fetchActiveBoms(supabase, tenantId, ids);
    const bomItems = await fetchBomItems(supabase, [...boms.values()].map((b) => b.id));
    const next = new Map<string, number>();
    for (const [pid, qty] of frontier) {
      const bom = boms.get(pid);
      if (!bom) {
        // Lá: không có công thức → là NVL cần mua thẳng.
        nvlNeed.set(pid, (nvlNeed.get(pid) ?? 0) + qty);
        continue;
      }
      if (guardVisited.has(pid)) {
        // chống vòng lặp BOM → coi như lá.
        nvlNeed.set(pid, (nvlNeed.get(pid) ?? 0) + qty);
        continue;
      }
      const items = bomItems.get(bom.id) ?? [];
      const y = bom.yieldQty || 1;
      for (const it of items) {
        const per = (it.quantity * (1 + it.waste / 100)) / y;
        const need = per * qty;
        next.set(it.materialId, (next.get(it.materialId) ?? 0) + need);
      }
    }
    for (const pid of ids) guardVisited.add(pid);
    frontier = next;
  }
  // Nếu còn frontier sau 6 cấp (BOM quá sâu bất thường) → coi như lá.
  for (const [pid, qty] of frontier) nvlNeed.set(pid, (nvlNeed.get(pid) ?? 0) + qty);

  // ── 5) Thông tin NVL + tồn Kho Tổng ──
  const nvlIds = [...nvlNeed.keys()];
  const nvlInfo = new Map<string, { code: string; name: string; unit: string; cost: number }>();
  for (let i = 0; i < nvlIds.length; i += 200) {
    const { data } = await supabase
      .from("products")
      .select("id, code, name, unit, cost_price")
      .eq("tenant_id", tenantId)
      .in("id", nvlIds.slice(i, i + 200));
    for (const p of (data ?? []) as AnyRow[])
      nvlInfo.set(p.id, {
        code: p.code,
        name: p.name,
        unit: p.unit ?? "",
        cost: Number(p.cost_price) || 0,
      });
  }
  const stockKT = new Map<string, number>();
  if (khoTong) {
    for (let i = 0; i < nvlIds.length; i += 200) {
      const { data } = await supabase
        .from("branch_stock")
        .select("product_id, quantity")
        .eq("branch_id", khoTong.id)
        .is("variant_id", null)
        .in("product_id", nvlIds.slice(i, i + 200));
      for (const r of (data ?? []) as AnyRow[])
        stockKT.set(r.product_id, Number(r.quantity) || 0);
    }
  }

  // ── 6) Ráp bảng NVL ──
  const materials: ForecastMaterialRow[] = [];
  let totalToBuyAmount = 0;
  for (const [mid, required] of nvlNeed) {
    const info = nvlInfo.get(mid);
    const stock = stockKT.get(mid) ?? 0;
    const toBuy = Math.max(0, required - stock);
    const unitCost = info?.cost ?? 0;
    const amount = toBuy * unitCost;
    totalToBuyAmount += amount;
    materials.push({
      materialId: mid,
      code: info?.code ?? "—",
      name: info?.name ?? "(không rõ)",
      unit: info?.unit ?? "",
      required,
      stockKhoTong: stock,
      toBuy,
      unitCost,
      amount,
    });
  }
  materials.sort((a, b) => b.amount - a.amount || b.toBuy - a.toBuy);

  // ── 7) Bảng SKU theo chi nhánh (tab 1) ──
  const skuProductIds = [...new Set([...perBranch.values()].map((r) => r.productId))];
  const skuInfo = new Map<string, { code: string; name: string; unit: string }>();
  for (let i = 0; i < skuProductIds.length; i += 200) {
    const { data } = await supabase
      .from("products")
      .select("id, code, name, unit")
      .eq("tenant_id", tenantId)
      .in("id", skuProductIds.slice(i, i + 200));
    for (const p of (data ?? []) as AnyRow[])
      skuInfo.set(p.id, { code: p.code, name: p.name, unit: p.unit ?? "" });
  }
  const skuRows: ForecastSkuRow[] = [...perBranch.values()].map((r) => {
    const info = skuInfo.get(r.productId);
    return {
      productId: r.productId,
      code: info?.code ?? "—",
      name: info?.name ?? "(không rõ)",
      unit: info?.unit ?? "",
      branchId: r.branchId,
      branchName: r.branchName,
      orderedQuantity: r.orderedQuantity,
      issuedQuantity: r.issuedQuantity,
      remainingQuantity: r.remainingQuantity,
      amount: r.amount,
    };
  });
  skuRows.sort(
    (a, b) => a.branchName.localeCompare(b.branchName) || b.amount - a.amount,
  );

  return {
    khoTongName: khoTong?.name ?? null,
    orderCount: orderIdsConNhuCau.size,
    skuRows,
    materials,
    totalToBuyAmount,
  };
}
