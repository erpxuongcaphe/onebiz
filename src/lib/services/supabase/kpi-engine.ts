/**
 * KPI Engine — Auto-breakdown + Actual sync
 *
 * Sprint AI-1: Tự động break down KPI cha xuống KPI con theo 2 chiến lược:
 *   1. time — chia KPI cha theo chu kỳ nhỏ hơn (yearly → quarterly → monthly → daily)
 *   2. branch — chia KPI cha xuống từng chi nhánh (even hoặc theo lịch sử doanh thu)
 *
 * Đồng thời cung cấp `syncKpiActualsFromDb` để tự động cập nhật `actual_value`
 * từ nguồn dữ liệu thực (invoices, orders, customers, cash).
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { getBranches } from "./branches";
import type {
  KpiBreakdown,
  KpiPeriod,
  KpiType,
} from "@/lib/types/ai-agents";
import type { Json } from "@/lib/supabase/types";

// ────────────────────────────────────────────
// Types & strategy options
// ────────────────────────────────────────────

export type BreakdownStrategy = "time" | "branch";
export type BranchDistribution = "even" | "historical";

export interface AutoBreakdownInput {
  parentId: string;
  strategy: BreakdownStrategy;
  /** Bắt buộc với strategy="time": kỳ con cần tạo (phải nhỏ hơn kỳ cha). */
  targetSubPeriod?: KpiPeriod;
  /** Cho strategy="branch": cách phân bổ target. Mặc định "even". */
  branchDistribution?: BranchDistribution;
  /** Giới hạn branch (nếu không truyền → dùng tất cả chi nhánh active). */
  branchIds?: string[];
}

export interface AutoBreakdownResult {
  parent: KpiBreakdown;
  children: KpiBreakdown[];
  warnings: string[];
}

// ────────────────────────────────────────────
// Period utilities
// ────────────────────────────────────────────

const PERIOD_RANK: Record<KpiPeriod, number> = {
  yearly: 5,
  quarterly: 4,
  monthly: 3,
  weekly: 2,
  daily: 1,
};

function isFinerThan(a: KpiPeriod, b: KpiPeriod): boolean {
  return PERIOD_RANK[a] < PERIOD_RANK[b];
}

/** Format một Date theo YYYY-MM-DD trong LOCAL time (không UTC). */
function formatLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD (hoặc ISO) thành Date lúc 00:00 giờ LOCAL. */
function parseDate(iso: string): Date {
  // Nếu chỉ có YYYY-MM-DD → tạo Date với các thành phần local
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      0,
      0,
      0,
      0,
    );
  }
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateOnly(d: Date | string): string {
  if (typeof d === "string") {
    // Nếu là ISO hoặc YYYY-MM-DD → parse về Date local rồi format
    return formatLocal(parseDate(d));
  }
  return formatLocal(d);
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

function firstOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1);
}

function lastOfMonth(y: number, m: number): Date {
  return new Date(y, m + 1, 0);
}

/** Split [start, end] thành các sub-range theo subPeriod, cắt gọn trong biên parent. */
export function splitPeriod(
  parentStart: string,
  parentEnd: string,
  subPeriod: KpiPeriod,
): Array<{ start: string; end: string; label: string }> {
  const start = parseDate(parentStart);
  const end = parseDate(parentEnd);
  if (end < start) return [];

  const result: Array<{ start: string; end: string; label: string }> = [];

  if (subPeriod === "daily") {
    let cur = new Date(start);
    while (cur <= end) {
      const iso = toDateOnly(cur);
      result.push({
        start: iso,
        end: iso,
        label: cur.toLocaleDateString("vi-VN"),
      });
      cur = addDays(cur, 1);
    }
    return result;
  }

  if (subPeriod === "weekly") {
    // Tuần bắt đầu Monday (Vietnam convention)
    let cur = new Date(start);
    // Đẩy lùi về thứ 2 của tuần đầu
    const day = cur.getDay() || 7; // Sun=0 → 7, Mon=1 … Sat=6
    if (day !== 1) cur = addDays(cur, -(day - 1));
    let idx = 1;
    while (cur <= end) {
      const wStart = new Date(Math.max(cur.getTime(), start.getTime()));
      const wEnd = addDays(cur, 6);
      const clipped = wEnd > end ? end : wEnd;
      if (wStart <= clipped) {
        result.push({
          start: toDateOnly(wStart),
          end: toDateOnly(clipped),
          label: `Tuần ${idx}`,
        });
        idx += 1;
      }
      cur = addDays(cur, 7);
    }
    return result;
  }

  if (subPeriod === "monthly") {
    let y = start.getFullYear();
    let m = start.getMonth();
    while (true) {
      const mStart = firstOfMonth(y, m);
      const mEnd = lastOfMonth(y, m);
      if (mStart > end) break;
      const rangeStart = mStart < start ? start : mStart;
      const rangeEnd = mEnd > end ? end : mEnd;
      if (rangeStart <= rangeEnd) {
        result.push({
          start: toDateOnly(rangeStart),
          end: toDateOnly(rangeEnd),
          label: `Tháng ${m + 1}/${y}`,
        });
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return result;
  }

  if (subPeriod === "quarterly") {
    let y = start.getFullYear();
    let q = Math.floor(start.getMonth() / 3);
    while (true) {
      const qStart = firstOfMonth(y, q * 3);
      const qEnd = lastOfMonth(y, q * 3 + 2);
      if (qStart > end) break;
      const rangeStart = qStart < start ? start : qStart;
      const rangeEnd = qEnd > end ? end : qEnd;
      if (rangeStart <= rangeEnd) {
        result.push({
          start: toDateOnly(rangeStart),
          end: toDateOnly(rangeEnd),
          label: `Q${q + 1}/${y}`,
        });
      }
      q += 1;
      if (q > 3) {
        q = 0;
        y += 1;
      }
    }
    return result;
  }

  // yearly not meaningful as sub-period
  return [];
}

// ────────────────────────────────────────────
// Fetch parent KPI (đọc trực tiếp từ DB, tránh vòng lặp import)
// ────────────────────────────────────────────
async function fetchKpiById(id: string): Promise<KpiBreakdown | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("kpi_breakdowns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) handleError(error, "fetchKpiById");
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id ?? null,
    kpiName: row.kpi_name,
    kpiType: row.kpi_type,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetValue: Number(row.target_value ?? 0),
    actualValue: Number(row.actual_value ?? 0),
    unit: row.unit ?? null,
    ownerRole: row.owner_role ?? null,
    ownerUserId: row.owner_user_id ?? null,
    branchId: row.branch_id ?? null,
    sourceAgentId: row.source_agent_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────
// Historical branch weights (for "historical" distribution)
// ────────────────────────────────────────────

/**
 * Lấy trọng số chi nhánh dựa trên doanh thu N ngày qua.
 * Trả về { [branchId]: weight } với tổng = 1. Nếu không có dữ liệu thì fallback even.
 */
async function getBranchRevenueWeights(
  branchIds: string[],
  windowDays: number = 90,
): Promise<Map<string, number>> {
  const supabase = getClient();
  const end = new Date();
  const start = addDays(end, -windowDays);

  const { data, error } = await supabase
    .from("invoices")
    .select("branch_id, total")
    .eq("status", "completed")
    .in("branch_id", branchIds)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) handleError(error, "getBranchRevenueWeights");

  const revByBranch = new Map<string, number>();
  for (const row of (data ?? []) as { branch_id: string; total: number }[]) {
    revByBranch.set(
      row.branch_id,
      (revByBranch.get(row.branch_id) ?? 0) + Number(row.total ?? 0),
    );
  }

  const totalRev = Array.from(revByBranch.values()).reduce(
    (a, b) => a + b,
    0,
  );

  const weights = new Map<string, number>();
  if (totalRev <= 0) {
    const even = 1 / branchIds.length;
    for (const b of branchIds) weights.set(b, even);
    return weights;
  }
  for (const b of branchIds) {
    weights.set(b, (revByBranch.get(b) ?? 0) / totalRev);
  }
  return weights;
}

// ────────────────────────────────────────────
// autoBreakdownKpi — main entry
// ────────────────────────────────────────────

export async function autoBreakdownKpi(
  input: AutoBreakdownInput,
): Promise<AutoBreakdownResult> {
  const parent = await fetchKpiById(input.parentId);
  if (!parent) throw new Error("Không tìm thấy KPI cha");

  const supabase = getClient();
  const ctx = await getCurrentContext();
  const warnings: string[] = [];

  // ---- Strategy 1: by time (chia nhỏ theo kỳ) ----
  if (input.strategy === "time") {
    const sub = input.targetSubPeriod;
    if (!sub) throw new Error("Cần chọn kỳ con (targetSubPeriod)");
    if (!isFinerThan(sub, parent.period)) {
      throw new Error(
        `Kỳ con "${sub}" phải nhỏ hơn kỳ cha "${parent.period}"`,
      );
    }

    const ranges = splitPeriod(parent.periodStart, parent.periodEnd, sub);
    if (ranges.length === 0) {
      throw new Error("Không thể chia kỳ thành các sub-range hợp lệ");
    }

    const perTarget = parent.targetValue / ranges.length;
    const rows = ranges.map((r) => ({
      tenant_id: ctx.tenantId,
      parent_id: parent.id,
      kpi_name: `${parent.kpiName} — ${r.label}`,
      kpi_type: parent.kpiType,
      period: sub,
      period_start: r.start,
      period_end: r.end,
      target_value: Math.round(perTarget),
      actual_value: 0,
      unit: parent.unit ?? null,
      owner_role: parent.ownerRole ?? null,
      branch_id: parent.branchId ?? null,
      source_agent_id: parent.sourceAgentId ?? null,
      metadata: {
        auto_generated: true,
        strategy: "time",
        parent_period: parent.period,
        sub_period: sub,
      } as Json,
    }));

    const { data, error } = await supabase
      .from("kpi_breakdowns")
      .insert(rows as never)
      .select("*");
    if (error) handleError(error, "autoBreakdownKpi.time");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: KpiBreakdown[] = ((data ?? []) as any[]).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? null,
      kpiName: row.kpi_name,
      kpiType: row.kpi_type,
      period: row.period,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      targetValue: Number(row.target_value ?? 0),
      actualValue: Number(row.actual_value ?? 0),
      unit: row.unit ?? null,
      ownerRole: row.owner_role ?? null,
      ownerUserId: row.owner_user_id ?? null,
      branchId: row.branch_id ?? null,
      sourceAgentId: row.source_agent_id ?? null,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { parent, children, warnings };
  }

  // ---- Strategy 2: by branch (chia theo chi nhánh) ----
  if (input.strategy === "branch") {
    const allBranches = await getBranches();
    const activeBranches = allBranches.filter((b) => b.isActive !== false);
    const candidateIds =
      input.branchIds && input.branchIds.length > 0
        ? input.branchIds
        : activeBranches.map((b) => b.id);

    if (candidateIds.length === 0) {
      throw new Error("Không có chi nhánh nào để chia KPI");
    }

    const distribution = input.branchDistribution ?? "even";
    let weights: Map<string, number>;
    if (distribution === "historical") {
      weights = await getBranchRevenueWeights(candidateIds, 90);
      warnings.push(
        "Phân bổ theo lịch sử doanh thu 90 ngày gần nhất. Kiểm tra lại nếu chi nhánh mới chưa có data.",
      );
    } else {
      const even = 1 / candidateIds.length;
      weights = new Map(candidateIds.map((b) => [b, even]));
    }

    const branchMap = new Map(activeBranches.map((b) => [b.id, b]));
    const rows = candidateIds.map((bid) => {
      const branch = branchMap.get(bid);
      const w = weights.get(bid) ?? 0;
      return {
        tenant_id: ctx.tenantId,
        parent_id: parent.id,
        kpi_name: `${parent.kpiName} — ${branch?.name ?? bid}`,
        kpi_type: parent.kpiType,
        period: parent.period,
        period_start: toDateOnly(parent.periodStart),
        period_end: toDateOnly(parent.periodEnd),
        target_value: Math.round(parent.targetValue * w),
        actual_value: 0,
        unit: parent.unit ?? null,
        owner_role: parent.ownerRole ?? null,
        branch_id: bid,
        source_agent_id: parent.sourceAgentId ?? null,
        metadata: {
          auto_generated: true,
          strategy: "branch",
          distribution,
          weight_pct: Math.round(w * 1000) / 10,
        } as Json,
      };
    });

    const { data, error } = await supabase
      .from("kpi_breakdowns")
      .insert(rows as never)
      .select("*");
    if (error) handleError(error, "autoBreakdownKpi.branch");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: KpiBreakdown[] = ((data ?? []) as any[]).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? null,
      kpiName: row.kpi_name,
      kpiType: row.kpi_type,
      period: row.period,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      targetValue: Number(row.target_value ?? 0),
      actualValue: Number(row.actual_value ?? 0),
      unit: row.unit ?? null,
      ownerRole: row.owner_role ?? null,
      ownerUserId: row.owner_user_id ?? null,
      branchId: row.branch_id ?? null,
      sourceAgentId: row.source_agent_id ?? null,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { parent, children, warnings };
  }

  throw new Error(`Chiến lược "${input.strategy}" chưa được hỗ trợ`);
}

// ────────────────────────────────────────────
// syncKpiActualsFromDb — auto-populate actual values
// ────────────────────────────────────────────

export interface SyncKpiActualsResult {
  totalScanned: number;
  updated: number;
  skipped: number;
  errors: Array<{ kpiId: string; kpiName: string; error: string }>;
}

/**
 * Quét các KPI và tính `actual_value` từ dữ liệu thực:
 *   - revenue   → SUM(invoices.total WHERE status=completed) trong period
 *   - orders    → COUNT(invoices) trong period
 *   - customers → COUNT DISTINCT(customer_id) trong period
 *   - profit    → revenue - COGS ước lượng (revenue - invoice_items qty × cost_price)
 *   - tasks     → COUNT(agent_tasks status=done) gắn vào KPI này
 *   - inventory → SUM(products.stock × cost_price) tại thời điểm hiện tại
 *
 * Nếu KPI có `branch_id` thì filter theo branch đó. Nếu không có thì dùng tenant-wide.
 *
 * Tham số `kpiId` tùy chọn — nếu truyền thì chỉ sync KPI đó; nếu không thì sync all.
 */
export async function syncKpiActualsFromDb(
  kpiId?: string,
): Promise<SyncKpiActualsResult> {
  const supabase = getClient();
  let query = supabase.from("kpi_breakdowns").select("*");
  if (kpiId) query = query.eq("id", kpiId);
  const { data, error } = await query;
  if (error) handleError(error, "syncKpiActualsFromDb.fetch");

  const kpis = (data ?? []) as Array<{
    id: string;
    kpi_name: string;
    kpi_type: KpiType;
    period_start: string;
    period_end: string;
    branch_id: string | null;
    actual_value: number;
  }>;

  const result: SyncKpiActualsResult = {
    totalScanned: kpis.length,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const kpi of kpis) {
    try {
      const newActual = await computeActualForKpi(
        kpi.kpi_type,
        kpi.period_start,
        kpi.period_end,
        kpi.branch_id,
        kpi.id,
      );

      if (newActual === null) {
        result.skipped += 1;
        continue;
      }

      if (Math.round(newActual) === Math.round(kpi.actual_value)) {
        result.skipped += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("kpi_breakdowns")
        .update({ actual_value: newActual })
        .eq("id", kpi.id);
      if (updateError) throw new Error(updateError.message);

      result.updated += 1;
    } catch (err) {
      result.errors.push({
        kpiId: kpi.id,
        kpiName: kpi.kpi_name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Tính actual cho 1 KPI dựa vào type. Trả null nếu chưa hỗ trợ type đó.
 * periodStart/End là date-only (YYYY-MM-DD) — sẽ clamp về khoảng [start, end+1) để
 * match với `created_at` timestamptz trong invoices.
 */
async function computeActualForKpi(
  kpiType: KpiType,
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  kpiId: string,
): Promise<number | null> {
  const supabase = getClient();
  const startIso = new Date(`${periodStart}T00:00:00.000Z`).toISOString();
  // end-exclusive: next day at 00:00
  const endDate = new Date(`${periodEnd}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endIso = endDate.toISOString();

  if (kpiType === "revenue" || kpiType === "orders" || kpiType === "customers") {
    let q = supabase
      .from("invoices")
      .select("total, customer_id")
      .eq("status", "completed")
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (branchId) q = q.eq("branch_id", branchId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ total: number; customer_id: string | null }>;
    if (kpiType === "revenue") {
      return rows.reduce((sum, r) => sum + Number(r.total ?? 0), 0);
    }
    if (kpiType === "orders") {
      return rows.length;
    }
    // customers — unique customer_id (null counted as anonymous walk-in, grouped together)
    const unique = new Set(rows.map((r) => r.customer_id ?? "__anonymous__"));
    return unique.size;
  }

  if (kpiType === "profit") {
    // revenue - COGS (từ invoice_items)
    let invQ = supabase
      .from("invoices")
      .select("id, total")
      .eq("status", "completed")
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (branchId) invQ = invQ.eq("branch_id", branchId);
    const { data: invs, error: invErr } = await invQ;
    if (invErr) throw new Error(invErr.message);

    const invoiceRows = (invs ?? []) as Array<{ id: string; total: number }>;
    const revenue = invoiceRows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    if (invoiceRows.length === 0) return 0;

    const invIds = invoiceRows.map((r) => r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items, error: itemsErr } = await (supabase as any)
      .from("invoice_items")
      .select("quantity, products(cost_price)")
      .in("invoice_id", invIds);
    if (itemsErr) throw new Error(itemsErr.message);

    const cogs = ((items ?? []) as Array<{
      quantity: number;
      products: { cost_price: number } | null;
    }>).reduce(
      (s, r) =>
        s + Number(r.quantity ?? 0) * Number(r.products?.cost_price ?? 0),
      0,
    );

    return revenue - cogs;
  }

  if (kpiType === "tasks") {
    // Count tasks done gắn vào KPI này
    const { data, error, count } = await supabase
      .from("agent_tasks")
      .select("id", { count: "exact", head: true })
      .eq("kpi_breakdown_id", kpiId)
      .eq("status", "done");
    if (error) throw new Error(error.message);
    void data;
    return count ?? 0;
  }

  if (kpiType === "inventory") {
    // Giá trị tồn kho cuối kỳ (= giờ), gộp toàn bộ sản phẩm (có thể filter branch qua branch_stock)
    if (branchId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("branch_stock")
        .select("quantity, products(cost_price)")
        .eq("branch_id", branchId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{
        quantity: number;
        products: { cost_price: number } | null;
      }>).reduce(
        (s, r) =>
          s + Number(r.quantity ?? 0) * Number(r.products?.cost_price ?? 0),
        0,
      );
    }
    const { data, error } = await supabase
      .from("products")
      .select("stock, cost_price");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ stock: number; cost_price: number }>).reduce(
      (s, r) => s + Number(r.stock ?? 0) * Number(r.cost_price ?? 0),
      0,
    );
  }

  // custom — không tự tính được
  return null;
}
