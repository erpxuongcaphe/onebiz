/**
 * Dự kiến mua hàng (MRP) — CEO 14/07.
 *
 * Từ ĐƠN ĐẶT HÀNG đang mở (chưa giao/chưa hoàn tất) → nổ BOM của các SKU đặt
 * → ra danh sách NGUYÊN VẬT LIỆU cần chuẩn bị/mua, so với TỒN KHO TỔNG.
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
  quantity: number;
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
  filters?: { dateFrom?: string; dateTo?: string },
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
    .in("status", OPEN_ORDER_STATUSES as unknown as string[]);
  orderQ = applyCreatedAtRangeFilter(orderQ, filters);
  if (branchId) orderQ = orderQ.eq("branch_id", branchId);
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

  // ── 3) invoice_items → nhu cầu SKU (per (branch, product)) + tổng theo product ──
  // key = branchId|productId
  const perBranch = new Map<string, { productId: string; branchId: string | null; branchName: string; qty: number; amount: number }>();
  const totalDemand = new Map<string, number>(); // productId → tổng SL (nổ BOM chain-wide)
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data: items } = await supabase
      .from("invoice_items")
      .select("invoice_id, product_id, quantity, total")
      .in("invoice_id", orderIds.slice(i, i + 100));
    for (const it of (items ?? []) as AnyRow[]) {
      if (!it.product_id) continue;
      const br = orderBranch.get(it.invoice_id) ?? { id: null, name: "—" };
      const q = Number(it.quantity) || 0;
      const amt = Number(it.total) || 0;
      const key = `${br.id ?? "null"}|${it.product_id}`;
      const cur = perBranch.get(key);
      if (cur) {
        cur.qty += q;
        cur.amount += amt;
      } else {
        perBranch.set(key, { productId: it.product_id, branchId: br.id, branchName: br.name, qty: q, amount: amt });
      }
      totalDemand.set(it.product_id, (totalDemand.get(it.product_id) ?? 0) + q);
    }
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
      quantity: r.qty,
      amount: r.amount,
    };
  });
  skuRows.sort(
    (a, b) => a.branchName.localeCompare(b.branchName) || b.amount - a.amount,
  );

  return {
    khoTongName: khoTong?.name ?? null,
    orderCount: orderIds.length,
    skuRows,
    materials,
    totalToBuyAmount,
  };
}
