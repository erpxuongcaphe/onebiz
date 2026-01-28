import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pctChange(current: number, prev: number): string {
  if (prev === 0) return current === 0 ? '0%' : '+100%';
  const pct = ((current - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export type FinanceCard = {
  id: 'cash' | 'bank' | 'receivable' | 'payable';
  label: string;
  value: number;
  trend: 'up' | 'down';
  change: string;
};

export type FinanceTxn = {
  id: string;
  description: string;
  amount: number;
  type: 'in' | 'out';
  date: string;
};

export async function fetchFinanceOverview(): Promise<{ cards: FinanceCard[]; txns: FinanceTxn[] } | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const now = new Date();
  const startThis = new Date(now);
  startThis.setDate(now.getDate() - 30);
  const startPrev = new Date(startThis);
  startPrev.setDate(startThis.getDate() - 30);

  const startThisIso = toISODate(startThis);
  const startPrevIso = toISODate(startPrev);
  const nowIso = toISODate(now);

  const [{ data: txThis, error: txThisErr }, { data: txPrev, error: txPrevErr }] = await Promise.all([
    supabase
      .from('finance_transactions')
      .select('transaction_number, transaction_date, description, total_amount, status')
      .gte('transaction_date', startThisIso)
      .lte('transaction_date', nowIso)
      .order('transaction_date', { ascending: false })
      .limit(30),
    supabase
      .from('finance_transactions')
      .select('total_amount, transaction_date, status')
      .gte('transaction_date', startPrevIso)
      .lt('transaction_date', startThisIso),
  ]);

  if (txThisErr || txPrevErr) return null;

  const sumNet = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + toNumber(r.total_amount), 0);

  const netThis = sumNet(txThis as any[]);
  const netPrev = sumNet(txPrev as any[]);

  const changeNet = pctChange(netThis, netPrev);
  const trendNet: 'up' | 'down' = netThis >= netPrev ? 'up' : 'down';

  // Fetch accounts receivable (unpaid invoices)
  const { data: receivableData } = await supabase
    .from('pos_orders')
    .select('total, amount_paid')
    .in('status', ['unpaid', 'draft'])
    .in('payment_status', ['pending', 'partial']);

  const totalReceivable = (receivableData ?? []).reduce(
    (acc, r) => acc + (toNumber(r.total) - toNumber(r.amount_paid)),
    0
  );

  const cards: FinanceCard[] = [
    { id: 'cash', label: 'Tiền mặt', value: netThis, trend: trendNet, change: changeNet },
    { id: 'bank', label: 'Ngân hàng', value: 0, trend: 'up', change: '0%' },
    { id: 'receivable', label: 'Phải thu', value: totalReceivable, trend: 'up', change: '0%' },
    { id: 'payable', label: 'Phải trả', value: 0, trend: 'up', change: '0%' },
  ];

  const txns: FinanceTxn[] = ((txThis as any[]) ?? []).map((t) => {
    const amt = toNumber(t.total_amount);
    const type: 'in' | 'out' = amt >= 0 ? 'in' : 'out';
    return {
      id: t.transaction_number,
      description: t.description ?? 'Giao dich',
      amount: Math.abs(amt),
      type,
      date: String(t.transaction_date ?? ''),
    };
  });

  return { cards, txns };
}

// Types for accounts receivable
export type AccountsReceivableRow = {
  customerId: string;
  customerName: string;
  totalReceivable: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  oldestInvoiceDate?: string;
};

export type UnpaidInvoice = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  total: number;
  amountPaid: number;
  outstanding: number;
  dueDate?: string;
  createdAt: string;
  paymentStatus: 'pending' | 'partial' | 'overdue';
};

export type AgingReportRow = {
  customerId: string;
  customerName: string;
  current07: number;
  days830: number;
  days3160: number;
  daysOver60: number;
  totalOutstanding: number;
};

// Fetch accounts receivable summary
export async function fetchAccountsReceivable(): Promise<AccountsReceivableRow[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase.rpc('get_accounts_receivable');

  if (error) {
    console.warn('get_accounts_receivable RPC failed, using fallback:', error.message);
    // Fallback: manual query
    const { data: orders } = await supabase
      .from('pos_orders')
      .select('customer_id, total, amount_paid, created_at, customer:sales_customers(name)')
      .in('status', ['unpaid', 'draft'])
      .in('payment_status', ['pending', 'partial']);

    if (!orders) return [];

    const byCustomer = new Map<string, AccountsReceivableRow>();
    for (const o of orders as any[]) {
      const custId = o.customer_id ?? 'unknown';
      const custName = o.customer?.name ?? 'Khách lẻ';
      const outstanding = toNumber(o.total) - toNumber(o.amount_paid);

      if (!byCustomer.has(custId)) {
        byCustomer.set(custId, {
          customerId: custId,
          customerName: custName,
          totalReceivable: 0,
          totalPaid: 0,
          totalOutstanding: 0,
          invoiceCount: 0,
          oldestInvoiceDate: o.created_at,
        });
      }

      const row = byCustomer.get(custId)!;
      row.totalReceivable += toNumber(o.total);
      row.totalPaid += toNumber(o.amount_paid);
      row.totalOutstanding += outstanding;
      row.invoiceCount += 1;
      if (o.created_at < (row.oldestInvoiceDate ?? '')) {
        row.oldestInvoiceDate = o.created_at;
      }
    }

    return Array.from(byCustomer.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  return (data ?? []).map((r: any) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    totalReceivable: toNumber(r.total_receivable),
    totalPaid: toNumber(r.total_paid),
    totalOutstanding: toNumber(r.total_outstanding),
    invoiceCount: Number(r.invoice_count),
    oldestInvoiceDate: r.oldest_invoice_date,
  }));
}

// Fetch unpaid invoices (optionally by customer)
export async function fetchUnpaidInvoices(customerId?: string): Promise<UnpaidInvoice[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  let query = supabase
    .from('pos_orders')
    .select('id, order_number, customer_id, total, amount_paid, due_date, created_at, payment_status, customer:sales_customers(name)')
    .in('status', ['unpaid', 'draft'])
    .in('payment_status', ['pending', 'partial'])
    .order('created_at', { ascending: false });

  if (customerId) {
    query = query.eq('customer_id', customerId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching unpaid invoices:', error);
    return [];
  }

  return (data ?? []).map((o: any) => ({
    id: o.id,
    orderNumber: o.order_number,
    customerId: o.customer_id,
    customerName: o.customer?.name ?? 'Khách lẻ',
    total: toNumber(o.total),
    amountPaid: toNumber(o.amount_paid),
    outstanding: toNumber(o.total) - toNumber(o.amount_paid),
    dueDate: o.due_date,
    createdAt: o.created_at,
    paymentStatus: o.payment_status ?? 'pending',
  }));
}

// Record a payment for an invoice
export async function recordInvoicePayment(params: {
  orderId: string;
  amount: number;
  method?: string;
  reference?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; data?: any }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('record_invoice_payment', {
    p_order_id: params.orderId,
    p_amount: params.amount,
    p_method: params.method ?? 'cash',
    p_reference: params.reference ?? null,
    p_notes: params.notes ?? null,
  });

  if (error) {
    console.warn('record_invoice_payment RPC failed, using fallback:', error.message);

    // Fallback: manual payment recording
    const { data: order } = await supabase
      .from('pos_orders')
      .select('tenant_id, total, amount_paid, status')
      .eq('id', params.orderId)
      .single();

    if (!order) return { success: false, error: 'Order not found' };
    if (!['unpaid', 'draft'].includes(order.status)) {
      return { success: false, error: 'Order status does not allow payment' };
    }

    const newAmountPaid = toNumber(order.amount_paid) + params.amount;
    const newStatus = newAmountPaid >= toNumber(order.total) ? 'paid' : order.status;
    const newPaymentStatus = newAmountPaid >= toNumber(order.total) ? 'paid' : 'partial';

    // Insert payment
    const { error: payErr } = await supabase.from('invoice_payments').insert({
      tenant_id: order.tenant_id,
      order_id: params.orderId,
      amount: params.amount,
      method: params.method ?? 'cash',
      reference: params.reference,
      notes: params.notes,
      created_by: sessionData.session.user.id,
    });

    if (payErr) return { success: false, error: payErr.message };

    // Update order
    const { error: updateErr } = await supabase
      .from('pos_orders')
      .update({
        amount_paid: newAmountPaid,
        payment_status: newPaymentStatus,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.orderId);

    if (updateErr) return { success: false, error: updateErr.message };

    return {
      success: true,
      data: {
        amount_paid: newAmountPaid,
        remaining: toNumber(order.total) - newAmountPaid,
        payment_status: newPaymentStatus,
      },
    };
  }

  const result = data as any;
  if (result?.success === false) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result };
}

// Fetch aging report
export async function fetchAgingReport(): Promise<AgingReportRow[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase.rpc('get_aging_report');

  if (error) {
    console.warn('get_aging_report RPC failed:', error.message);
    return [];
  }

  return (data ?? []).map((r: any) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    current07: toNumber(r.current_0_7),
    days830: toNumber(r.days_8_30),
    days3160: toNumber(r.days_31_60),
    daysOver60: toNumber(r.days_over_60),
    totalOutstanding: toNumber(r.total_outstanding),
  }));
}
