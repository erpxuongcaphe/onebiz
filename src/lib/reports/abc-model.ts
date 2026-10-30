import type { DateRange } from "@/lib/types/report";

export interface AbcProduct {
  id: string; code: string; name: string; unit: string | null; is_active: boolean;
}
export interface AbcSaleLine {
  product_id: string; product_name: string; quantity: number; total: number; unit: string | null;
  invoices: { ngay_chung_tu: string };
}
export type AbcClass = "A" | "B" | "C" | "slow";
export interface AbcRow {
  productId: string; code: string; name: string; unit: string; catalogUnit: string;
  qtySold: number | null; revenue: number; cumPct: number; pct: number; abcClass: AbcClass;
  lastSoldDaysAgo: number | null;
}
export interface AbcReportResult {
  rows: AbcRow[];
  classStats: Record<"A" | "B" | "C", { count: number; revenue: number; revenuePct: number }> & { slow: { count: number } };
  totalRevenue: number; range: DateRange;
}

export function buildAbcReport(products: AbcProduct[], lines: AbcSaleLine[], range: DateRange, thresholdA = 80, thresholdB = 95, now = Date.now()): AbcReportResult {
  if (!(thresholdA > 0 && thresholdA < thresholdB && thresholdB < 100)) throw new Error("Ngưỡng ABC không hợp lệ.");
  const catalog = new Map(products.map(product => [product.id, product]));
  const sales = new Map<string, { name: string; qty: number; revenue: number; units: Set<string>; last: number }>();
  for (const line of lines) {
    const quantity = Number(line.quantity), revenue = Number(line.total), date = Date.parse(line.invoices.ngay_chung_tu);
    if (!line.product_id || line.quantity == null || line.total == null || !Number.isFinite(quantity) || !Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(date)) {
      throw new Error("Dòng bán hàng thiếu căn cứ phân loại ABC. Cần kiểm tra nguồn dữ liệu.");
    }
    const sale = sales.get(line.product_id) ?? { name: line.product_name, qty: 0, revenue: 0, units: new Set<string>(), last: date };
    sale.qty += quantity; sale.revenue += revenue; sale.units.add(line.unit?.trim() || ""); sale.last = Math.max(sale.last, date);
    sales.set(line.product_id, sale);
  }
  const totalRevenue = [...sales.values()].reduce((sum, sale) => sum + sale.revenue, 0);
  let cumulative = 0;
  const rows: AbcRow[] = [...sales.entries()].sort((a, b) => b[1].revenue - a[1].revenue || a[0].localeCompare(b[0])).map(([id, sale]) => {
    const product = catalog.get(id);
    const beforePct = totalRevenue ? cumulative / totalRevenue * 100 : 0;
    // Include the product crossing a threshold in the group it started in.
    const abcClass: AbcClass = sale.revenue <= 0 ? "slow" : beforePct < thresholdA ? "A" : beforePct < thresholdB ? "B" : "C";
    cumulative += sale.revenue;
    const knownUnit = sale.units.size === 1 && !sale.units.has("");
    return { productId: id, code: product?.code || id, name: product?.name || sale.name,
      unit: knownUnit ? [...sale.units][0] : sale.units.size > 1 ? "Nhiều ĐVT / thiếu ĐVT" : "Chưa có ĐVT lịch sử",
      catalogUnit: product?.unit || "Chưa có ĐVT", qtySold: knownUnit ? sale.qty : null,
      revenue: sale.revenue, pct: totalRevenue ? sale.revenue / totalRevenue * 100 : 0,
      cumPct: totalRevenue ? cumulative / totalRevenue * 100 : 0, abcClass,
      lastSoldDaysAgo: Math.max(0, Math.floor((now - sale.last) / 86400000)) };
  });
  for (const product of products) {
    if (!product.is_active || sales.has(product.id)) continue;
    rows.push({ productId: product.id, code: product.code, name: product.name, unit: "Không phát sinh", catalogUnit: product.unit || "Chưa có ĐVT",
      qtySold: 0, revenue: 0, pct: 0, cumPct: 0, abcClass: "slow", lastSoldDaysAgo: null });
  }
  const stats = (group: AbcClass) => {
    const selected = rows.filter(row => row.abcClass === group), revenue = selected.reduce((sum, row) => sum + row.revenue, 0);
    return { count: selected.length, revenue, revenuePct: totalRevenue ? revenue / totalRevenue * 100 : 0 };
  };
  return { rows, totalRevenue, range, classStats: { A: stats("A"), B: stats("B"), C: stats("C"), slow: stats("slow") } };
}
