
/**
 * Finance + Marketing Reports Service â€” Phase C (CEO 16/05/2026).
 *
 * Wrap 4 RPC migration 00081:
 *   - getReceivableAgingReport: cÃ´ng ná»£ aging buckets
 *   - getVatReport: VAT in/out theo ká»³
 *   - getRfmReport: RFM khÃ¡ch hÃ ng
 *   - getFnbServeTimeReport: time-to-serve FnB
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

function handleReportError(
  error: { message: string; code?: string },
  context: string,
): never {
  if (error.message.includes("REPORT_ALL_BRANCHES_DENIED")) {
    throw new Error(
      "TÃ i khoáº£n khÃ´ng cÃ³ quyá»n xem toÃ n cÃ´ng ty. HÃ£y chá»n chi nhÃ¡nh Ä‘Æ°á»£c phÃ¢n quyá»n.",
    );
  }
  if (error.message.includes("REPORT_BRANCH_DENIED")) {
    throw new Error("TÃ i khoáº£n khÃ´ng cÃ³ quyá»n xem chi nhÃ¡nh Ä‘Ã£ chá»n.");
  }
  handleError(error, context);
}

// ============================================================
// 1. Receivable Aging
// ============================================================

export interface ReceivableAgingRow {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  outstanding: number;
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket91Plus: number;
  oldestDays: number;
  oldestInvoiceDate: string;
}

export interface ReceivableAgingReport {
  generatedAt: string;
  asOfDate: string;
  tenantId: string;
  branchId: string | null;
  rows: ReceivableAgingRow[];
}

export async function getReceivableAgingReport(params?: {
  branchId?: string | null;
  asOfDate?: string | null;
}): Promise<ReceivableAgingReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_receivable_aging_report",
    {
      p_branch_id: params?.branchId ?? null,
      p_as_of_date: params?.asOfDate ?? null,
    },
  );
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "ChÆ°a cÃ³ RPC get_receivable_aging_report. Vui lÃ²ng cháº¡y migration 00081 trÆ°á»›c.",
      );
    }
    handleReportError(error, "getReceivableAgingReport");
  }
  if (!data) throw new Error("Server khÃ´ng tráº£ káº¿t quáº£ aging report.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    asOfDate: raw.as_of_date ?? raw.generated_at,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      customerId: r.customer_id ?? `walk-in:${r.customer_name ?? "KhÃ¡ch láº»"}`,
      customerName: r.customer_name ?? "KhÃ¡ch láº»",
      invoiceCount: Number(r.invoice_count ?? 0),
      outstanding: Number(r.outstanding ?? 0),
      bucket0_30: Number(r.bucket_0_30 ?? 0),
      bucket31_60: Number(r.bucket_31_60 ?? 0),
      bucket61_90: Number(r.bucket_61_90 ?? 0),
      bucket91Plus: Number(r.bucket_91_plus ?? 0),
      oldestDays: Number(r.oldest_days ?? 0),
      oldestInvoiceDate: r.oldest_invoice_date,
    })),
  };
}

// ============================================================
// 2. Payable Aging
// ============================================================

export interface PayableAgingRow {
  supplierId: string;
  supplierName: string;
  documentCount: number;
  outstanding: number;
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket91Plus: number;
  oldestDays: number;
  oldestDocumentDate: string;
}

export interface PayableAgingReport {
  generatedAt: string;
  asOfDate: string;
  tenantId: string;
  branchId: string | null;
  rows: PayableAgingRow[];
}

export async function getPayableAgingReport(params?: {
  branchId?: string | null;
  asOfDate?: string | null;
}): Promise<PayableAgingReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_payable_aging_report",
    {
      p_branch_id: params?.branchId ?? null,
      p_as_of_date: params?.asOfDate ?? null,
    },
  );
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "ChÆ°a cÃ³ migration 00257. KhÃ´ng thá»ƒ táº£i tuá»•i ná»£ pháº£i tráº£.",
      );
    }
    handleReportError(error, "getPayableAgingReport");
  }
  if (!data) throw new Error("MÃ¡y chá»§ khÃ´ng tráº£ káº¿t quáº£ tuá»•i ná»£ pháº£i tráº£.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    asOfDate: raw.as_of_date ?? raw.generated_at,
    tenantId: raw.tenant_id,
    branchId: raw.branch_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name ?? "NhÃ  cung cáº¥p",
      documentCount: Number(r.document_count ?? 0),
      outstanding: Number(r.outstanding ?? 0),
      bucket0_30: Number(r.bucket_0_30 ?? 0),
      bucket31_60: Number(r.bucket_31_60 ?? 0),
      bucket61_90: Number(r.bucket_61_90 ?? 0),
      bucket91Plus: Number(r.bucket_91_plus ?? 0),
      oldestDays: Number(r.oldest_days ?? 0),
      oldestDocumentDate: r.oldest_document_date,
    })),
  };
}

// ============================================================
// 3. VAT Report
// ============================================================

export interface VatSummary {
  totalTax: number;
  totalTaxable: number;
  invoiceCount?: number;
  poCount?: number;
}

export interface VatInvoiceDetail {
  id: string;
  code: string;
  createdAt: string;
  customerName: string;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface VatPoDetail {
  id: string;
  code: string;
  createdAt: string;
  supplierName: string;
  taxAmount: number;
  total: number;
}

export interface VatByRate {
  taxRate: number;
  invoiceCount?: number;
  poCount?: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface VatReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  output: VatSummary;
  input: VatSummary;
  outputByRate: VatByRate[];
  inputByRate: VatByRate[];
  outputDetail: VatInvoiceDetail[];
  inputDetail: VatPoDetail[];
}

export async function getVatReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<VatReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_vat_report", {
    p_date_from: params?.dateFrom ?? null,
    p_date_to: params?.dateTo ?? null,
    p_branch_id: params?.branchId ?? null,
  });
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error("ChÆ°a cÃ³ RPC get_vat_report. Vui lÃ²ng cháº¡y migration 00081.");
    }
    handleError(error, "getVatReport");
  }
  if (!data) throw new Error("Server khÃ´ng tráº£ káº¿t quáº£ VAT report.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    output: {
      totalTax: Number(raw.output?.total_tax ?? 0),
      totalTaxable: Number(raw.output?.total_taxable ?? 0),
      invoiceCount: Number(raw.output?.invoice_count ?? 0),
    },
    input: {
      totalTax: Number(raw.input?.total_tax ?? 0),
      totalTaxable: Number(raw.input?.total_taxable ?? 0),
      poCount: Number(raw.input?.po_count ?? 0),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputByRate: (raw.output_by_rate ?? []).map((r: any) => ({
      taxRate: Number(r.tax_rate ?? 0),
      invoiceCount: Number(r.invoice_count ?? 0),
      taxableAmount: Number(r.taxable_amount ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputByRate: (raw.input_by_rate ?? []).map((r: any) => ({
      taxRate: Number(r.tax_rate ?? 0),
      poCount: Number(r.po_count ?? 0),
      taxableAmount: Number(r.taxable_amount ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputDetail: (raw.output_detail ?? []).map((r: any) => ({
      id: r.id,
      code: r.code,
      createdAt: r.created_at,
      customerName: r.customer_name ?? "KhÃ¡ch láº»",
      subtotal: Number(r.subtotal ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
      total: Number(r.total ?? 0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputDetail: (raw.input_detail ?? []).map((r: any) => ({
      id: r.id,
      code: r.code,
      createdAt: r.created_at,
      supplierName: r.supplier_name ?? "",
      taxAmount: Number(r.tax_amount ?? 0),
      total: Number(r.total ?? 0),
    })),
  };
}

// ============================================================
// 4. RFM Report
// ============================================================

export type RfmSegment =
  | "Champion"
  | "Loyal"
  | "Potential"
  | "At-risk"
  | "Lost";

export interface RfmRow {
  customerId: string;
  code: string;
  name: string;
  phone: string | null;
  frequency: number;
  monetary: number;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
  recencyDays: number;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmTotal: number;
  segment: RfmSegment;
}

export interface RfmReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  rows: RfmRow[];
}

export async function getRfmReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<RfmReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_rfm_report", {
    p_date_from: params?.dateFrom ?? null,
    p_date_to: params?.dateTo ?? null,
    p_branch_id: params?.branchId ?? null,
  });
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error("ChÆ°a cÃ³ RPC get_rfm_report. Vui lÃ²ng cháº¡y migration 00081.");
    }
    handleError(error, "getRfmReport");
  }
  if (!data) throw new Error("Server khÃ´ng tráº£ káº¿t quáº£ RFM.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    generatedAt: raw.generated_at,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    tenantId: raw.tenant_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (raw.rows ?? []).map((r: any) => ({
      customerId: r.customer_id,
      code: r.code,
      name: r.name,
      phone: r.phone,
      frequency: Number(r.frequency ?? 0),
      monetary: Number(r.monetary ?? 0),
      lastOrderAt: r.last_order_at,
      firstOrderAt: r.first_order_at,
      recencyDays: Number(r.recency_days ?? 0),
      rScore: Number(r.r_score ?? 0),
      fScore: Number(r.f_score ?? 0),
      mScore: Number(r.m_score ?? 0),
      rfmTotal: Number(r.rfm_total ?? 0),
      segment: r.segment as RfmSegment,
    })),
  };
}

// ============================================================
// 5. FnB Serve Time
// ============================================================

export interface ServeTimeSummary {
  orderCount: number;
  avgMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  medianMinutes: number;
  p90Minutes: number;
}

export interface ServeTimeByBranch {
  branchId: string | null;
  branchName: string | null;
  orderCount: number;
  avgMinutes: number;
  medianMinutes: number;
  p90Minutes: number;
}

export interface ServeTimeByHour {
  hourOfDay: number;
  orderCount: number;
  avgMinutes: number;
}

export interface ServeTimeByProduct {
  productId: string;
  productName: string;
  serveCount: number;
  avgMinutes: number;
  p90Minutes: number;
}

export interface FnbServeTimeReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  branchId: string | null;
  summary: ServeTimeSummary;
  byBranch: ServeTimeByBranch[];
  byHour: ServeTimeByHour[];
  byProduct: ServeTimeByProduct[];
}

export async function getFnbServeTimeReport(params?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
}): Promise<FnbServeTimeReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_fnb_serve_time_report",
    {
      p_date_from: params?.dateFrom ?? null,
      p_date_to: params?.dateTo ?? null,
      p_branch_id: params?.branchId ?? null,
    },
  );
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "ChÆ°a cÃ³ RPC get_fnb_serve_time_report. Vui lÃ²ng cháº¡y migration 00081.",
      );
    }
    handleError(error, "getFnbServeTimeReport");
  }
  if (!data) throw new Error("Server khÃ´ng tráº£ káº¿t quáº£ serve time.");

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
    summary: {
      orderCount: Number(s.order_count ?? 0),
      avgMinutes: Number(s.avg_minutes ?? 0),
      minMinutes: Number(s.min_minutes ?? 0),
      maxMinutes: Number(s.max_minutes ?? 0),
      medianMinutes: Number(s.median_minutes ?? 0),
      p90Minutes: Number(s.p90_minutes ?? 0),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byBranch: (raw.by_branch ?? []).map((r: any) => ({
      branchId: r.branch_id,
      branchName: r.branch_name,
      orderCount: Number(r.order_count ?? 0),
      avgMinutes: Number(r.avg_minutes ?? 0),
      medianMinutes: Number(r.median_minutes ?? 0),
      p90Minutes: Number(r.p90_minutes ?? 0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byHour: (raw.by_hour ?? []).map((r: any) => ({
      hourOfDay: Number(r.hour_of_day ?? 0),
      orderCount: Number(r.order_count ?? 0),
      avgMinutes: Number(r.avg_minutes ?? 0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byProduct: (raw.by_product ?? []).map((r: any) => ({
      productId: r.product_id,
      productName: r.product_name,
      serveCount: Number(r.serve_count ?? 0),
      avgMinutes: Number(r.avg_minutes ?? 0),
      p90Minutes: Number(r.p90_minutes ?? 0),
    })),
  };
}

