import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type PosShift = {
  id: string;
  branch_id: string;
  code: string;
  status: 'open' | 'closed' | 'cancelled';
  opened_at: string;
  opening_cash: number;
};

export type PosOrder = {
  id: string;
  branch_id: string;
  shift_id: string | null;
  order_number: string;
  status: 'draft' | 'paid' | 'void' | 'refunded';
  total: number;
  created_at: string;
  customer_name?: string | null;
  notes?: string | null;
};

export type PosOrderItem = {
  sku: string | null;
  name: string | null;
  quantity: number;
  unit_price: number;
};

export type PosPayment = {
  method: string;
  amount: number;
  payment_number?: string | null;
};

export type PosOrderReceipt = {
  order: PosOrder;
  items: PosOrderItem[];
  payment: PosPayment;
  branch_name?: string | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  company: {
    name?: string;
    tax_code?: string;
    address?: string;
    phone?: string;
    logo_url?: string | null;
  };
};

export type PosCatalogItem = {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
};

export async function fetchCatalogForWarehouse(params: {
  warehouseId: string;
  search?: string;
  category?: string;
}): Promise<PosCatalogItem[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];
  if (!params.warehouseId) return [];

  let query = supabase
    .from('inventory_stock')
    .select(
      'quantity, product:inventory_products!inner(id, sku, name, selling_price, status, category:inventory_categories(name))'
    )
    .eq('warehouse_id', params.warehouseId);

  const qStr = (params.search ?? '').trim();
  if (qStr) {
    query = query.or(`name.ilike.%${qStr}%,sku.ilike.%${qStr}%`, { foreignTable: 'product' });
  }

  // Note: Category filtering by name on 3rd level nesting is tricky in one go, 
  // so we keep it in memory or would need another !inner join chain. 
  // For now, let's keep category filter in JS, but search is now DB-optimized.

  const { data, error } = await query;
  if (error || !data) return [];

  const cat = (params.category ?? '').trim();

  const items: PosCatalogItem[] = [];
  for (const row of data as any[]) {
    const p = row.product;
    if (!p) continue;
    if ((p.status ?? 'active') === 'inactive') continue;

    const categoryName = p.category?.name ?? 'Khác';
    if (cat && categoryName !== cat) continue;

    items.push({
      product_id: p.id,
      sku: String(p.sku ?? ''),
      name: String(p.name ?? ''),
      category: categoryName,
      price: toNumber(p.selling_price),
      stock: toNumber(row.quantity),
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export async function fetchOpenShift(branchId: string): Promise<PosShift | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase
    .from('pos_shifts')
    .select('id, branch_id, code, status, opened_at, opening_cash')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    branch_id: data.branch_id,
    code: data.code,
    status: data.status,
    opened_at: data.opened_at,
    opening_cash: toNumber(data.opening_cash),
  };
}

export async function openShift(params: { branchId: string; openingCash: number }): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const code = `CA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;

  const { data, error } = await supabase
    .from('pos_shifts')
    .insert({
      branch_id: params.branchId,
      code,
      status: 'open',
      opening_cash: params.openingCash,
      opened_by: sessionData.session.user.id,
    })
    .select('id')
    .single();

  if (error) return null;
  return (data as any)?.id ?? null;
}

export async function closeShift(params: { shiftId: string; closingCash: number }): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase
    .from('pos_shifts')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closing_cash: params.closingCash,
      closed_by: sessionData.session.user.id,
    })
    .eq('id', params.shiftId);

  return !error;
}

export async function createPosSale(params: {
  branchId: string;
  warehouseId: string;
  shiftId: string;
  lines: Array<{ product_id: string; quantity: number; unit_price: number }>;
  paymentMethod: string;
  paymentAmount: number;
  customerId: string;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  // Try using the stored procedure first (recommended for atomicity)
  const { data, error } = await supabase.rpc('pos_create_sale', {
    p_branch_id: params.branchId,
    p_warehouse_id: params.warehouseId,
    p_shift_id: params.shiftId,
    p_lines: params.lines,
    p_payment_method: params.paymentMethod,
    p_payment_amount: params.paymentAmount,
    p_customer_id: params.customerId,
  });

  // If RPC exists and works, return its result
  if (!error && data) {
    return (data as any) ?? null;
  }

  // Fallback has been DISABLED due to race condition risks.
  // If the RPC fails, we must fail the transaction to prevent data corruption.
  console.error('pos_create_sale RPC failed:', error?.message);
  return null;
}

export async function fetchPosOrders(params: {
  branchId?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
}): Promise<PosOrder[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  let q = supabase
    .from('pos_orders')
    .select('id, branch_id, shift_id, order_number, status, total, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (params.branchId) q = q.eq('branch_id', params.branchId);
  if (params.status) q = q.eq('status', params.status);
  if (params.fromDate) q = q.gte('created_at', `${params.fromDate}T00:00:00Z`);
  if (params.toDate) q = q.lte('created_at', `${params.toDate}T23:59:59Z`);

  const { data, error } = await q;
  if (error || !data) return [];
  return (data as any[]).map((o) => ({
    id: o.id,
    branch_id: o.branch_id,
    shift_id: o.shift_id,
    order_number: o.order_number,
    status: o.status,
    total: toNumber(o.total),
    created_at: o.created_at,
  }));
}

export async function fetchPosReceipt(orderId: string): Promise<PosOrderReceipt | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data: order, error: orderErr } = await supabase
    .from('pos_orders')
    .select('id, branch_id, shift_id, order_number, status, total, created_at, customer_id')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) return null;

  const { data: items } = await supabase
    .from('pos_order_items')
    .select('sku, name, quantity, unit_price')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  const { data: payment } = await supabase
    .from('pos_payments')
    .select('method, amount')
    .eq('order_id', orderId)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: branch } = await supabase
    .from('branches')
    .select('name')
    .eq('id', order.branch_id)
    .maybeSingle();

  const { data: customer } = await supabase
    .from('sales_customers')
    .select('name')
    .eq('id', order.customer_id)
    .maybeSingle();

  return {
    order: {
      id: order.id,
      branch_id: order.branch_id,
      shift_id: order.shift_id,
      order_number: order.order_number,
      status: order.status,
      total: toNumber(order.total),
      created_at: order.created_at,
      customer_name: customer?.name ?? null,
      notes: null,
    },
    items: (items ?? []).map((i: any) => ({
      sku: i.sku ?? null,
      name: i.name ?? null,
      quantity: toNumber(i.quantity),
      unit_price: toNumber(i.unit_price),
    })),
    payment: {
      method: payment?.method ?? 'cash',
      amount: toNumber(payment?.amount),
      payment_number: null,
    },
    branch_name: branch?.name ?? null,
    vat_rate: 0,
    vat_amount: 0,
    company: {},
  };
}
