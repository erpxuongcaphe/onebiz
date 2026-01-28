import { supabase } from './supabaseClient';

type DbOrder = {
  id: string;
  order_number: string;
  order_date: string;
  total: number | string;
  status: string;
  customer_id: string;
  branch_id: string | null;
  warehouse_id: string | null;
  due_date: string | null;
  customer: { name: string } | null;
};

type DbOrderItem = {
  order_id: string;
};

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `SO-${stamp}-${rand}`;
}

export type SalesOrderRow = {
  id: string;
  order_number: string;
  order_date: string;
  total: number;
  status: string;
  customer_name: string;
  items: number;
  branch_id: string | null;
  warehouse_id: string | null;
  due_date: string | null;
  customer_id: string;
};

export async function fetchSalesOrders(params?: {
  status?: string;
}): Promise<SalesOrderRow[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  let query = supabase
    .from('sales_orders')
    .select('id, order_number, order_date, total, status, customer_id, branch_id, warehouse_id, due_date, customer:sales_customers(name)')
    .order('created_at', { ascending: false });

  if (params?.status) query = query.eq('status', params.status);

  const { data, error } = await query.returns<DbOrder[]>();
  if (error || !data) return [];

  const orders = data ?? [];
  const orderIds = orders.map((o) => o.id);
  const itemCountByOrder = new Map<string, number>();

  if (orderIds.length > 0) {
    const { data: items } = await supabase
      .from('sales_order_items')
      .select('order_id')
      .in('order_id', orderIds)
      .returns<DbOrderItem[]>();

    for (const it of items ?? []) {
      itemCountByOrder.set(it.order_id, (itemCountByOrder.get(it.order_id) ?? 0) + 1);
    }
  }

  return orders.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    order_date: o.order_date,
    total: toNumber(o.total),
    status: o.status,
    customer_name: o.customer?.name ?? 'Khách hàng',
    items: itemCountByOrder.get(o.id) ?? 0,
    branch_id: o.branch_id ?? null,
    warehouse_id: o.warehouse_id ?? null,
    due_date: o.due_date ?? null,
    customer_id: o.customer_id,
  }));
}

export async function createSalesOrder(params: {
  branchId: string;
  warehouseId: string;
  customerId: string;
  lines: Array<{ product_id: string; quantity: number; unit_price: number }>;
  notes?: string;
  dueDate?: string | null;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const orderNumber = buildOrderNumber();
  const total = params.lines.reduce((acc, l) => acc + l.quantity * l.unit_price, 0);

  const { data: order, error: orderErr } = await supabase
    .from('sales_orders')
    .insert({
      order_number: orderNumber,
      customer_id: params.customerId,
      order_date: new Date().toISOString().slice(0, 10),
      status: 'waiting_pick',
      subtotal: total,
      total,
      notes: params.notes ?? null,
      branch_id: params.branchId,
      warehouse_id: params.warehouseId,
      due_date: params.dueDate ?? null,
      created_by: sessionData.session.user.id,
    })
    .select('id')
    .single();

  if (orderErr || !order) return null;
  const orderId = (order as any).id as string;

  const { error: itemsErr } = await supabase
    .from('sales_order_items')
    .insert(
      params.lines.map((l) => ({
        order_id: orderId,
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      }))
    );

  if (itemsErr) return null;
  return orderId;
}

export async function createInvoiceFromOrder(params: {
  orderId: string;
  shiftId?: string | null;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase.rpc('pos_create_invoice_from_order', {
    p_order_id: params.orderId,
    p_shift_id: params.shiftId ?? null,
  });

  if (error) return null;
  return (data as any) ?? null;
}
