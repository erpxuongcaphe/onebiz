/**
 * Sales Reports Service — Phase B báo cáo BÁN HÀNG chi tiết (CEO 16/05/2026).
 *
 * 3 báo cáo wrap RPC migration 00080:
 *   - getSalesReturnReport: trả hàng chi tiết theo lý do/SP/NV
 *   - getStaffRevenueReport: doanh thu NV cross-branch
 *   - getPlatformCommissionReport: net delivery commission
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

// ============================================================
// 1. Sales Returns
// ============================================================

export interface SalesReturnRow {
  returnId: string;
  returnCode: string;
  returnDate: string;
  branchId: string | null;
  branchName: string | null;
  invoiceId: string | null;
  invoiceCode: string | null;
  customerName: string;
  reason: string;
  status: string;
  createdBy: string | null;
  createdByName: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  returnValue: number;
}

export interface SalesReturnReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  branchId: string | null;
  rows: SalesReturnRow[];
}

export async function getSalesReturnReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<SalesReturnReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_sales_return_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_sales_return_report. Vui lòng chạy migration 00080 trước.",
      );
    }
    handleError(error, "getSalesReturnReport");
  }

  if (!data) throw new Error("Server không trả kết quả sales return.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      returnId: r.return_id,
      returnCode: r.return_code,
      returnDate: r.return_date,
      branchId: r.branch_id,
      branchName: r.branch_name,
      invoiceId: r.invoice_id,
      invoiceCode: r.invoice_code,
      customerName: r.customer_name ?? "Khách lẻ",
      reason: r.reason,
      status: r.status,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      productId: r.product_id,
      productName: r.product_name,
      quantity: Number(r.quantity ?? 0),
      unitPrice: Number(r.unit_price ?? 0),
      returnValue: Number(r.return_value ?? 0),
    })),
  };
}

// ============================================================
// 2. Staff Revenue
// ============================================================

export interface StaffRevenueRow {
  staffId: string;
  staffName: string;
  staffRole: string | null;
  branchId: string | null;
  branchName: string | null;
  source: string;
  invoiceCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  customerCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export interface StaffRevenueReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  source: string | null;
  tenantId: string;
  rows: StaffRevenueRow[];
}

export async function getStaffRevenueReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  source?: "pos" | "fnb" | null;
  branchId?: string | null;
}): Promise<StaffRevenueReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_staff_revenue_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
      p_source: params?.source ?? null,
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_staff_revenue_report. Vui lòng chạy migration 00080 trước.",
      );
    }
    handleError(error, "getStaffRevenueReport");
  }

  if (!data) throw new Error("Server không trả kết quả staff revenue.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    source: raw.source,
    tenantId: raw.tenant_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      staffId: r.staff_id,
      staffName: r.staff_name ?? "Không xác định",
      staffRole: r.staff_role,
      branchId: r.branch_id,
      branchName: r.branch_name,
      source: r.source ?? "pos",
      invoiceCount: Number(r.invoice_count ?? 0),
      totalRevenue: Number(r.total_revenue ?? 0),
      avgOrderValue: Number(r.avg_order_value ?? 0),
      customerCount: Number(r.customer_count ?? 0),
      firstOrderAt: r.first_order_at,
      lastOrderAt: r.last_order_at,
    })),
  };
}

// ============================================================
// 3. Platform Commission (delivery net)
// ============================================================

export interface PlatformCommissionRow {
  platform: string;
  branchId: string | null;
  branchName: string | null;
  orderCount: number;
  grossRevenue: number;
  commissionTotal: number;
  netRevenue: number;
  effectiveCommissionPercent: number;
  avgOrderValue: number;
}

export interface PlatformCommissionSummary {
  totalOrders: number;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  totalLostToPlatform: number;
}

export interface PlatformCommissionReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  branchId: string | null;
  rows: PlatformCommissionRow[];
  summary: PlatformCommissionSummary;
  /** MoM — kỳ trước cùng độ dài để so sánh */
  previousPeriod?: {
    totalOrders: number;
    totalGross: number;
    totalCommission: number;
    totalNet: number;
  };
}

export async function getPlatformCommissionReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<PlatformCommissionReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_platform_commission_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
      p_branch_id: params?.branchId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_platform_commission_report. Vui lòng chạy migration 00080 trước.",
      );
    }
    handleError(error, "getPlatformCommissionReport");
  }

  if (!data) throw new Error("Server không trả kết quả platform commission.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (raw.summary ?? {}) as any;
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      platform: r.platform ?? "direct",
      branchId: r.branch_id,
      branchName: r.branch_name,
      orderCount: Number(r.order_count ?? 0),
      grossRevenue: Number(r.gross_revenue ?? 0),
      commissionTotal: Number(r.commission_total ?? 0),
      netRevenue: Number(r.net_revenue ?? 0),
      effectiveCommissionPercent: Number(r.effective_commission_percent ?? 0),
      avgOrderValue: Number(r.avg_order_value ?? 0),
    })),
    summary: {
      totalOrders: Number(s.total_orders ?? 0),
      totalGross: Number(s.total_gross ?? 0),
      totalCommission: Number(s.total_commission ?? 0),
      totalNet: Number(s.total_net ?? 0),
      totalLostToPlatform: Number(s.total_lost_to_platform ?? 0),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previousPeriod: raw.previous_period
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          totalOrders: Number((raw.previous_period as any).total_orders ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          totalGross: Number((raw.previous_period as any).total_gross ?? 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          totalCommission: Number(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw.previous_period as any).total_commission ?? 0,
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          totalNet: Number((raw.previous_period as any).total_net ?? 0),
        }
      : undefined,
  };
}
