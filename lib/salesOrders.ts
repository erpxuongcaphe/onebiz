/**
 * Sales Orders API
 * Quản lý đơn bán hàng với workflow và auto-calculation
 */

import { supabase } from './supabaseClient';

type Result<T> = { data: T; error: null } | { data: null; error: string };

function formatError(err: any): string {
  const code = err?.code as string | undefined;
  if (code === '23505') return 'Dữ liệu bị trùng.';
  if (err?.message) return String(err.message);
  return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

// =====================================================
// TYPES
// =====================================================

export interface SalesOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity: number;
  delivered_quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_percent: number;
  notes?: string | null;
  created_at: string;
}

export interface SalesOrder {
  id: string;
  tenant_id: string;
  order_number: string;
  customer_id: string;
  customer_name?: string;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  branch_id?: string | null;
  order_date: string;
  expected_delivery_date?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: 'draft' | 'confirmed' | 'picking' | 'delivering' | 'delivered' | 'completed' | 'cancelled';
  notes?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  items?: SalesOrderItem[];
  customer?: {
    id: string;
    name: string;
    code: string;
    phone?: string;
  };
  warehouse?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface CreateSalesOrderItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  tax_percent?: number;
  notes?: string | null;
}

export interface CreateSalesOrderInput {
  customer_id: string;
  warehouse_id?: string | null;
  branch_id?: string | null;
  order_date: string;
  expected_delivery_date?: string | null;
  notes?: string | null;
  items: CreateSalesOrderItemInput[];
}

// =====================================================
// FETCH FUNCTIONS
// =====================================================

export async function fetchSalesOrders(filters?: {
  status?: string;
  customer_id?: string;
  from_date?: string;
  to_date?: string;
}): Promise<SalesOrder[]> {
  let query = supabase
    .from('sales_orders')
    .select(`
      *,
      customer:sales_customers!customer_id (
        id,
        name,
        code,
        phone
      ),
      warehouse:inventory_warehouses!warehouse_id (
        id,
        name,
        code
      )
    `)
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.customer_id) {
    query = query.eq('customer_id', filters.customer_id);
  }

  if (filters?.from_date) {
    query = query.gte('order_date', filters.from_date);
  }

  if (filters?.to_date) {
    query = query.lte('order_date', filters.to_date);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching sales orders:', error);
    return [];
  }

  return (data || []).map((so) => ({
    ...so,
    customer_name: so.customer?.name,
    warehouse_name: so.warehouse?.name,
  }));
}

export async function getSalesOrderById(id: string): Promise<Result<SalesOrder>> {
  const { data: order, error: orderError } = await supabase
    .from('sales_orders')
    .select(`
      *,
      customer:sales_customers!customer_id (
        id,
        name,
        code,
        phone
      ),
      warehouse:inventory_warehouses!warehouse_id (
        id,
        name,
        code
      )
    `)
    .eq('id', id)
    .single();

  if (orderError) return { data: null, error: formatError(orderError) };

  const { data: items, error: itemsError } = await supabase
    .from('sales_order_items')
    .select(`
      *,
      product:inventory_products!product_id (
        name,
        sku
      )
    `)
    .eq('order_id', id);

  if (itemsError) return { data: null, error: formatError(itemsError) };

  const itemsWithNames = (items || []).map((item) => ({
    ...item,
    product_name: item.product?.name,
    product_sku: item.product?.sku,
  }));

  return {
    data: {
      ...order,
      customer_name: order.customer?.name,
      warehouse_name: order.warehouse?.name,
      items: itemsWithNames,
    },
    error: null,
  };
}

// =====================================================
// CREATE FUNCTION
// =====================================================

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<Result<true>> {
  if (!input.items || input.items.length === 0) {
    return { data: null, error: 'Đơn hàng phải có ít nhất 1 sản phẩm' };
  }

  // Calculate totals
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  for (const item of input.items) {
    const itemSubtotal = item.quantity * item.unit_price;
    const itemDiscount = itemSubtotal * ((item.discount_percent ?? 0) / 100);
    const itemTax = (itemSubtotal - itemDiscount) * ((item.tax_percent ?? 0) / 100);

    subtotal += itemSubtotal;
    totalDiscount += itemDiscount;
    totalTax += itemTax;
  }

  const total = subtotal - totalDiscount + totalTax;

  // Generate order number
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', (await supabase.auth.getUser()).data.user?.id)
    .single();

  if (!profile) return { data: null, error: 'Không tìm thấy tenant' };

  const { data: orderNumber, error: numberError } = await supabase.rpc('generate_sales_order_number', {
    p_tenant_id: profile.tenant_id,
  });

  if (numberError) return { data: null, error: formatError(numberError) };

  // Create sales order
  const { data: newOrder, error: orderError } = await supabase
    .from('sales_orders')
    .insert({
      tenant_id: profile.tenant_id,
      order_number: orderNumber,
      customer_id: input.customer_id,
      warehouse_id: input.warehouse_id,
      branch_id: input.branch_id,
      order_date: input.order_date,
      expected_delivery_date: input.expected_delivery_date,
      subtotal,
      discount: totalDiscount,
      tax: totalTax,
      total,
      notes: input.notes,
      status: 'draft',
    })
    .select()
    .single();

  if (orderError) return { data: null, error: formatError(orderError) };

  // Insert items
  const { error: itemsError } = await supabase.from('sales_order_items').insert(
    input.items.map((item) => ({
      order_id: newOrder.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percent: item.discount_percent ?? 0,
      tax_percent: item.tax_percent ?? 0,
      notes: item.notes,
    }))
  );

  if (itemsError) return { data: null, error: formatError(itemsError) };

  return { data: true, error: null };
}

// =====================================================
// UPDATE FUNCTION
// =====================================================

export async function updateSalesOrder(id: string, input: Partial<CreateSalesOrderInput>): Promise<Result<true>> {
  // Only allow updating draft orders
  const { data: order, error: checkError } = await supabase
    .from('sales_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (checkError) return { data: null, error: formatError(checkError) };

  if (order.status !== 'draft') {
    return { data: null, error: 'Chỉ có thể sửa đơn hàng ở trạng thái nháp' };
  }

  const updateData: any = {};

  if (input.customer_id !== undefined) updateData.customer_id = input.customer_id;
  if (input.warehouse_id !== undefined) updateData.warehouse_id = input.warehouse_id;
  if (input.branch_id !== undefined) updateData.branch_id = input.branch_id;
  if (input.order_date !== undefined) updateData.order_date = input.order_date;
  if (input.expected_delivery_date !== undefined) updateData.expected_delivery_date = input.expected_delivery_date;
  if (input.notes !== undefined) updateData.notes = input.notes;

  // Recalculate totals if items are provided
  if (input.items) {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    for (const item of input.items) {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemDiscount = itemSubtotal * ((item.discount_percent ?? 0) / 100);
      const itemTax = (itemSubtotal - itemDiscount) * ((item.tax_percent ?? 0) / 100);

      subtotal += itemSubtotal;
      totalDiscount += itemDiscount;
      totalTax += itemTax;
    }

    const total = subtotal - totalDiscount + totalTax;

    updateData.subtotal = subtotal;
    updateData.discount = totalDiscount;
    updateData.tax = totalTax;
    updateData.total = total;

    // Delete old items and insert new ones
    await supabase.from('sales_order_items').delete().eq('order_id', id);

    const { error: itemsError } = await supabase.from('sales_order_items').insert(
      input.items.map((item) => ({
        order_id: id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent ?? 0,
        tax_percent: item.tax_percent ?? 0,
        notes: item.notes,
      }))
    );

    if (itemsError) return { data: null, error: formatError(itemsError) };
  }

  const { error: soError } = await supabase.from('sales_orders').update(updateData).eq('id', id);

  if (soError) return { data: null, error: formatError(soError) };

  return { data: true, error: null };
}

// =====================================================
// STATUS UPDATE FUNCTIONS
// =====================================================

export async function confirmSalesOrder(id: string): Promise<Result<true>> {
  // Check if draft
  const { data: order, error: checkError } = await supabase
    .from('sales_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (checkError) return { data: null, error: formatError(checkError) };
  if (order.status !== 'draft') {
    return { data: null, error: 'Chỉ có thể xác nhận đơn hàng ở trạng thái nháp' };
  }

  // Reserve stock
  const { error: reserveError } = await supabase.rpc('reserve_stock_for_sales_order', {
    p_order_id: id,
  });

  if (reserveError) return { data: null, error: formatError(reserveError) };

  // Update status
  const { error: updateError } = await supabase
    .from('sales_orders')
    .update({ status: 'confirmed' })
    .eq('id', id);

  if (updateError) return { data: null, error: formatError(updateError) };

  return { data: true, error: null };
}

export async function updateSalesOrderStatus(
  id: string,
  status: SalesOrder['status']
): Promise<Result<true>> {
  const { error } = await supabase.from('sales_orders').update({ status }).eq('id', id);

  if (error) return { data: null, error: formatError(error) };

  return { data: true, error: null };
}

export async function cancelSalesOrder(id: string): Promise<Result<true>> {
  const { data: order, error: checkError } = await supabase
    .from('sales_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (checkError) return { data: null, error: formatError(checkError) };

  if (['completed', 'cancelled'].includes(order.status)) {
    return { data: null, error: 'Không thể hủy đơn hàng đã hoàn thành hoặc đã hủy' };
  }

  const { error } = await supabase.from('sales_orders').update({ status: 'cancelled' }).eq('id', id);

  if (error) return { data: null, error: formatError(error) };

  return { data: true, error: null };
}

// =====================================================
// DELETE FUNCTION
// =====================================================

export async function deleteSalesOrder(id: string): Promise<Result<true>> {
  // Only allow deleting draft orders
  const { data: order, error: checkError } = await supabase
    .from('sales_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (checkError) return { data: null, error: formatError(checkError) };

  if (order.status !== 'draft') {
    return { data: null, error: 'Chỉ có thể xóa đơn hàng ở trạng thái nháp' };
  }

  const { error } = await supabase.from('sales_orders').delete().eq('id', id);

  if (error) return { data: null, error: formatError(error) };

  return { data: true, error: null };
}
