/**
 * Supabase service: Debt Aging Analysis (Phân tích tuổi nợ)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Analyzes customer and supplier debt by age buckets:
 *   - 0-30 ngày (current)
 *   - 31-60 ngày
 *   - 61-90 ngày
 *   - 90+ ngày (overdue)
 *
 * Source data:
 *   - Customer debt: invoices where debt > 0 (invoice date = age anchor)
 *   - Supplier debt: purchase_orders where debt > 0
 */

import { getClient, handleError, getCurrentTenantId } from "./base";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AgingBucket {
  label: string;
  range: string;
  customerCount: number;
  customerAmount: number;
  supplierCount: number;
  supplierAmount: number;
  totalAmount: number;
}

export interface DebtAgingReport {
  buckets: AgingBucket[];
  totalCustomerDebt: number;
  totalSupplierDebt: number;
  totalDebt: number;
  customersWithDebt: number;
  suppliersWithDebt: number;
}

export interface DebtorDetail {
  id: string;
  code: string;
  name: string;
  phone?: string;
  debt: number;
  ageDays: number;
  bucket: string;
  type: "customer" | "supplier";
  oldestInvoiceDate?: string;
}

/* ------------------------------------------------------------------ */
/*  Aging report                                                       */
/* ------------------------------------------------------------------ */

export async function getDebtAging(): Promise<DebtAgingReport> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();

  // Parallel fetch: customers with debt + suppliers with debt + unpaid invoices + unpaid POs
  const [customersRes, suppliersRes, invoicesRes, posRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, code, name, debt")
      .eq("tenant_id", tenantId)
      .gt("debt", 0),
    supabase
      .from("suppliers")
      .select("id, code, name, debt")
      .eq("tenant_id", tenantId)
      .gt("debt", 0),
    supabase
      .from("invoices")
      .select("id, customer_id, debt, created_at")
      .eq("tenant_id", tenantId)
      .gt("debt", 0)
      .eq("status", "completed"),
    supabase
      .from("purchase_orders")
      .select("id, supplier_id, debt, created_at")
      .eq("tenant_id", tenantId)
      .gt("debt", 0)
      .in("status", ["ordered", "partial", "completed"]),
  ]);

  if (customersRes.error) handleError(customersRes.error, "getDebtAging.customers");
  if (suppliersRes.error) handleError(suppliersRes.error, "getDebtAging.suppliers");

  // Build per-customer oldest invoice date map
  const customerOldest = new Map<string, Date>();
  for (const inv of invoicesRes.data ?? []) {
    const custId = inv.customer_id as string;
    if (!custId) continue;
    const invDate = new Date(inv.created_at);
    const existing = customerOldest.get(custId);
    if (!existing || invDate < existing) {
      customerOldest.set(custId, invDate);
    }
  }

  // Build per-supplier oldest PO date map
  const supplierOldest = new Map<string, Date>();
  for (const po of posRes.data ?? []) {
    const suppId = po.supplier_id as string;
    if (!suppId) continue;
    const poDate = new Date(po.created_at);
    const existing = supplierOldest.get(suppId);
    if (!existing || poDate < existing) {
      supplierOldest.set(suppId, poDate);
    }
  }

  // Initialize buckets
  const buckets: AgingBucket[] = [
    { label: "Hiện tại", range: "0-30 ngày", customerCount: 0, customerAmount: 0, supplierCount: 0, supplierAmount: 0, totalAmount: 0 },
    { label: "Quá hạn nhẹ", range: "31-60 ngày", customerCount: 0, customerAmount: 0, supplierCount: 0, supplierAmount: 0, totalAmount: 0 },
    { label: "Quá hạn TB", range: "61-90 ngày", customerCount: 0, customerAmount: 0, supplierCount: 0, supplierAmount: 0, totalAmount: 0 },
    { label: "Quá hạn nặng", range: "90+ ngày", customerCount: 0, customerAmount: 0, supplierCount: 0, supplierAmount: 0, totalAmount: 0 },
  ];

  function getBucketIndex(ageDays: number): number {
    if (ageDays <= 30) return 0;
    if (ageDays <= 60) return 1;
    if (ageDays <= 90) return 2;
    return 3;
  }

  let totalCustomerDebt = 0;
  let totalSupplierDebt = 0;

  // Classify customers
  for (const cust of customersRes.data ?? []) {
    const debt = Number(cust.debt ?? 0);
    if (debt <= 0) continue;
    totalCustomerDebt += debt;

    const oldest = customerOldest.get(cust.id);
    const ageDays = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const idx = getBucketIndex(ageDays);
    buckets[idx].customerCount++;
    buckets[idx].customerAmount += debt;
  }

  // Classify suppliers
  for (const supp of suppliersRes.data ?? []) {
    const debt = Number(supp.debt ?? 0);
    if (debt <= 0) continue;
    totalSupplierDebt += debt;

    const oldest = supplierOldest.get(supp.id);
    const ageDays = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const idx = getBucketIndex(ageDays);
    buckets[idx].supplierCount++;
    buckets[idx].supplierAmount += debt;
  }

  // Compute totals per bucket
  for (const b of buckets) {
    b.totalAmount = b.customerAmount + b.supplierAmount;
  }

  return {
    buckets,
    totalCustomerDebt,
    totalSupplierDebt,
    totalDebt: totalCustomerDebt + totalSupplierDebt,
    customersWithDebt: (customersRes.data ?? []).filter((c) => Number(c.debt ?? 0) > 0).length,
    suppliersWithDebt: (suppliersRes.data ?? []).filter((s) => Number(s.debt ?? 0) > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Top debtors (detailed list)                                        */
/* ------------------------------------------------------------------ */

export async function getTopDebtors(limit: number = 20): Promise<DebtorDetail[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();

  const [customersRes, suppliersRes, invoicesRes, posRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, code, name, phone, debt")
      .eq("tenant_id", tenantId)
      .gt("debt", 0)
      .order("debt", { ascending: false })
      .limit(limit),
    supabase
      .from("suppliers")
      .select("id, code, name, phone, debt")
      .eq("tenant_id", tenantId)
      .gt("debt", 0)
      .order("debt", { ascending: false })
      .limit(limit),
    supabase
      .from("invoices")
      .select("customer_id, created_at")
      .eq("tenant_id", tenantId)
      .gt("debt", 0)
      .eq("status", "completed"),
    supabase
      .from("purchase_orders")
      .select("supplier_id, created_at")
      .eq("tenant_id", tenantId)
      .gt("debt", 0),
  ]);

  // Oldest dates
  const customerOldest = new Map<string, Date>();
  for (const inv of invoicesRes.data ?? []) {
    const id = inv.customer_id as string;
    if (!id) continue;
    const d = new Date(inv.created_at);
    const e = customerOldest.get(id);
    if (!e || d < e) customerOldest.set(id, d);
  }
  const supplierOldest = new Map<string, Date>();
  for (const po of posRes.data ?? []) {
    const id = po.supplier_id as string;
    if (!id) continue;
    const d = new Date(po.created_at);
    const e = supplierOldest.get(id);
    if (!e || d < e) supplierOldest.set(id, d);
  }

  function getBucketLabel(days: number): string {
    if (days <= 30) return "0-30 ngày";
    if (days <= 60) return "31-60 ngày";
    if (days <= 90) return "61-90 ngày";
    return "90+ ngày";
  }

  const debtors: DebtorDetail[] = [];

  for (const c of customersRes.data ?? []) {
    const oldest = customerOldest.get(c.id);
    const ageDays = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    debtors.push({
      id: c.id,
      code: c.code,
      name: c.name,
      phone: c.phone ?? undefined,
      debt: Number(c.debt ?? 0),
      ageDays,
      bucket: getBucketLabel(ageDays),
      type: "customer",
      oldestInvoiceDate: oldest?.toISOString(),
    });
  }

  for (const s of suppliersRes.data ?? []) {
    const oldest = supplierOldest.get(s.id);
    const ageDays = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    debtors.push({
      id: s.id,
      code: s.code,
      name: s.name,
      phone: s.phone ?? undefined,
      debt: Number(s.debt ?? 0),
      ageDays,
      bucket: getBucketLabel(ageDays),
      type: "supplier",
      oldestInvoiceDate: oldest?.toISOString(),
    });
  }

  // Sort by debt descending
  debtors.sort((a, b) => b.debt - a.debt);
  return debtors.slice(0, limit);
}
