import type { Order } from '../types';
import { OrderStatus } from '../types';
import { supabase } from './supabaseClient';

type DbOrder = {
  id: string;
  order_number: string;
  order_date: string;
  total: number | string;
  status: string;
  customer: { name: string } | null;
};

type DbOrderItem = {
  order_id: string;
};

export type OrderDetailItem = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type OrderDetail = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  total: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  items: OrderDetailItem[];
  paymentStatus?: string;
  amountPaid?: number;
};

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapOrderStatus(status: string): OrderStatus {
  switch (status) {
    case 'cancelled':
      return OrderStatus.CANCELLED;
    case 'delivered':
      return OrderStatus.COMPLETED;
    case 'completed':
      return OrderStatus.COMPLETED;
    case 'waiting_pick':
      return OrderStatus.WAITING_PICK;
    case 'processing':
    case 'shipped':
      return OrderStatus.PROCESSING;
    case 'confirmed':
    case 'draft':
    default:
      return OrderStatus.PENDING;
  }
}

export async function fetchOrders(): Promise<Order[]> {
  if (!supabase) {
    console.error('Supabase not configured');
    return [];
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    console.warn('No active session - returning empty order list');
    return [];
  }

  const { data, error } = await supabase
    .from('sales_orders')
    .select('id, order_number, order_date, total, status, customer:sales_customers(name)')
    .order('created_at', { ascending: false })
    .returns<DbOrder[]>();

  if (error) {
    console.error('Error fetching orders:', error);
    return [];
  }

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
    id: o.order_number.startsWith('#') ? o.order_number : `#${o.order_number}`,
    customer: o.customer?.name ?? 'Khách hàng',
    date: o.order_date,
    total: toNumber(o.total),
    status: mapOrderStatus(o.status),
    items: itemCountByOrder.get(o.id) ?? 0,
  }));
}

export async function fetchOrderDetail(orderNumber: string): Promise<OrderDetail | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const cleanNumber = orderNumber.replace(/^#/, '');

  const { data: order, error } = await supabase
    .from('sales_orders')
    .select(`
      id, order_number, order_date, total, status, customer_id, payment_status, amount_paid,
      customer:sales_customers(name, phone)
    `)
    .eq('order_number', cleanNumber)
    .maybeSingle();

  if (error || !order) return null;

  const { data: items } = await supabase
    .from('sales_order_items')
    .select('id, sku, product_name, quantity, unit_price')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  const customer = order.customer as { name?: string; phone?: string } | null;

  return {
    id: order.id,
    orderNumber: order.order_number,
    orderDate: order.order_date,
    status: order.status,
    total: toNumber(order.total),
    customerId: order.customer_id,
    customerName: customer?.name ?? 'Khách hàng',
    customerPhone: customer?.phone ?? null,
    items: (items ?? []).map((i: any) => ({
      id: i.id,
      sku: i.sku ?? '',
      name: i.product_name ?? 'Sản phẩm',
      quantity: toNumber(i.quantity),
      unitPrice: toNumber(i.unit_price),
      total: toNumber(i.quantity) * toNumber(i.unit_price),
    })),
    paymentStatus: order.payment_status,
    amountPaid: toNumber(order.amount_paid),
  };
}

export async function processOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
  if (!supabase) return { success: false, message: 'Supabase init failed' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { success: false, message: 'No session' };

  // 1. Get current status
  const { data: order, error: fetchErr } = await supabase
    .from('sales_orders')
    .select('id, status, branch_id')
    .eq('id', orderId)
    .single();

  if (fetchErr || !order) return { success: false, message: 'Order not found' };

  // 2. Determine next step
  if (order.status === 'pending' || order.status === 'draft' || order.status === 'confirmed') {
    // Move to 'waiting_pick' (Prepared by Warehouse)
    const { error: updateErr } = await supabase
      .from('sales_orders')
      .update({ status: 'waiting_pick' })
      .eq('id', orderId);

    if (updateErr) return { success: false, message: updateErr.message };
    return { success: true };
  }

  if (order.status === 'waiting_pick') {
    // Create Invoice & Deduct Inventory -> Completed
    // Use the RPC: pos_create_invoice_from_order(order_id, shift_id)
    // We pass null for shift_id as this is a backend process, not a POS shift
    const { error: rpcErr } = await supabase.rpc('pos_create_invoice_from_order', {
      p_order_id: orderId,
      p_shift_id: null
    });

    if (rpcErr) return { success: false, message: rpcErr.message };
    return { success: true };
  }

  return { success: false, message: `Cannot process order in '${order.status}' status` };
}
