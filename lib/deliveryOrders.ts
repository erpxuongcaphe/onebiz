/**
 * Delivery Orders API
 * Quản lý phiếu xuất kho và giao hàng
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

export interface DeliveryOrderItem {
    id: string;
    delivery_id: string;
    product_id: string;
    product_name?: string;
    product_sku?: string;
    quantity: number;
    sales_order_item_id?: string | null;
    notes?: string | null;
    created_at: string;
}

export interface DeliveryOrder {
    id: string;
    tenant_id: string;
    delivery_number: string;
    sales_order_id?: string | null;
    sales_order_number?: string;
    customer_id: string;
    customer_name?: string;
    warehouse_id: string;
    warehouse_name?: string;
    branch_id?: string | null;
    delivery_date: string;
    actual_delivery_date?: string | null;
    status: 'draft' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
    shipping_address?: string | null;
    receiver_name?: string | null;
    receiver_phone?: string | null;
    pod_image_url?: string | null;
    delivery_notes?: string | null;
    notes?: string | null;
    created_at: string;
    updated_at: string;
    created_by?: string | null;
    completed_at?: string | null;
    completed_by?: string | null;
    items?: DeliveryOrderItem[];
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
    sales_order?: {
        id: string;
        order_number: string;
    };
}

export interface CreateDeliveryOrderItemInput {
    product_id: string;
    quantity: number;
    sales_order_item_id?: string | null;
    notes?: string | null;
}

export interface CreateDeliveryOrderInput {
    sales_order_id?: string | null;
    customer_id: string;
    warehouse_id: string;
    branch_id?: string | null;
    delivery_date: string;
    shipping_address?: string | null;
    receiver_name?: string | null;
    receiver_phone?: string | null;
    notes?: string | null;
    items: CreateDeliveryOrderItemInput[];
}

// =====================================================
// FETCH FUNCTIONS
// =====================================================

export async function fetchDeliveryOrders(filters?: {
    status?: string;
    customer_id?: string;
    from_date?: string;
    to_date?: string;
}): Promise<DeliveryOrder[]> {
    let query = supabase
        .from('delivery_orders')
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
      ),
      sales_order:sales_orders!sales_order_id (
        id,
        order_number
      )
    `)
        .order('delivery_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (filters?.status) {
        query = query.eq('status', filters.status);
    }

    if (filters?.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
    }

    if (filters?.from_date) {
        query = query.gte('delivery_date', filters.from_date);
    }

    if (filters?.to_date) {
        query = query.lte('delivery_date', filters.to_date);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching delivery orders:', error);
        return [];
    }

    return (data || []).map((d) => ({
        ...d,
        customer_name: d.customer?.name,
        warehouse_name: d.warehouse?.name,
        sales_order_number: d.sales_order?.order_number,
    }));
}

export async function getDeliveryOrderById(id: string): Promise<Result<DeliveryOrder>> {
    const { data: delivery, error: deliveryError } = await supabase
        .from('delivery_orders')
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
      ),
      sales_order:sales_orders!sales_order_id (
        id,
        order_number
      )
    `)
        .eq('id', id)
        .single();

    if (deliveryError) return { data: null, error: formatError(deliveryError) };

    const { data: items, error: itemsError } = await supabase
        .from('delivery_order_items')
        .select(`
      *,
      product:inventory_products!product_id (
        name,
        sku
      )
    `)
        .eq('delivery_id', id);

    if (itemsError) return { data: null, error: formatError(itemsError) };

    const itemsWithNames = (items || []).map((item) => ({
        ...item,
        product_name: item.product?.name,
        product_sku: item.product?.sku,
    }));

    return {
        data: {
            ...delivery,
            customer_name: delivery.customer?.name,
            warehouse_name: delivery.warehouse?.name,
            sales_order_number: delivery.sales_order?.order_number,
            items: itemsWithNames,
        },
        error: null,
    };
}

// =====================================================
// CREATE FUNCTION
// =====================================================

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<Result<true>> {
    if (!input.items || input.items.length === 0) {
        return { data: null, error: 'Phiếu xuất phải có ít nhất 1 sản phẩm' };
    }

    // Generate delivery number
    const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

    if (!profile) return { data: null, error: 'Không tìm thấy tenant' };

    const { data: deliveryNumber, error: numberError } = await supabase.rpc('generate_delivery_number', {
        p_tenant_id: profile.tenant_id,
    });

    if (numberError) return { data: null, error: formatError(numberError) };

    // Create delivery order
    const { data: newDelivery, error: deliveryError } = await supabase
        .from('delivery_orders')
        .insert({
            tenant_id: profile.tenant_id,
            delivery_number: deliveryNumber,
            sales_order_id: input.sales_order_id,
            customer_id: input.customer_id,
            warehouse_id: input.warehouse_id,
            branch_id: input.branch_id,
            delivery_date: input.delivery_date,
            shipping_address: input.shipping_address,
            receiver_name: input.receiver_name,
            receiver_phone: input.receiver_phone,
            notes: input.notes,
            status: 'draft',
        })
        .select()
        .single();

    if (deliveryError) return { data: null, error: formatError(deliveryError) };

    // Insert items
    const { error: itemsError } = await supabase.from('delivery_order_items').insert(
        input.items.map((item) => ({
            delivery_id: newDelivery.id,
            product_id: item.product_id,
            quantity: item.quantity,
            sales_order_item_id: item.sales_order_item_id,
            notes: item.notes,
        }))
    );

    if (itemsError) return { data: null, error: formatError(itemsError) };

    return { data: true, error: null };
}

// =====================================================
// COMPLETE DELIVERY
// =====================================================

export async function completeDeliveryOrder(id: string): Promise<Result<true>> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return { data: null, error: 'Unauthorized' };

    const { error } = await supabase.rpc('complete_delivery_order', {
        p_delivery_id: id,
        p_user_id: user.user.id,
    });

    if (error) return { data: null, error: formatError(error) };

    return { data: true, error: null };
}

// =====================================================
// VOID DELIVERY
// =====================================================

export async function voidDeliveryOrder(id: string): Promise<Result<true>> {
    const { error } = await supabase.rpc('void_delivery_order', {
        p_delivery_id: id,
    });

    if (error) return { data: null, error: formatError(error) };

    return { data: true, error: null };
}

// =====================================================
// UPDATE STATUS
// =====================================================

export async function updateDeliveryOrderStatus(
    id: string,
    status: DeliveryOrder['status']
): Promise<Result<true>> {
    const { error } = await supabase.from('delivery_orders').update({ status }).eq('id', id);

    if (error) return { data: null, error: formatError(error) };

    return { data: true, error: null };
}
