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
