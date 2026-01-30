import { supabase } from './supabaseClient';

type Result<T> = { data: T; error: null } | { data: null; error: string };

function formatError(err: any): string {
    const code = err?.code as string | undefined;
    if (code === '23505') return 'Dữ liệu bị trùng.';
    if (err?.message) return String(err.message);
    return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

function toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export type PurchaseOrderItem = {
    id: string;
    product_id: string;
    product_name?: string;
    product_sku?: string;
    quantity: number;
    unit_price: number;
    discount_percent: number;
    tax_percent: number;
    received_quantity: number;
    notes?: string | null;
};

export type PurchaseOrder = {
    id: string;
    order_number: string;
    supplier_id: string;
    supplier_name: string;
    warehouse_id?: string | null;
    warehouse_name?: string | null;
    branch_id?: string | null;
    order_date: string;
    expected_date?: string | null;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    status: 'draft' | 'sent' | 'confirmed' | 'partial_received' | 'received' | 'closed' | 'cancelled';
    notes?: string | null;
    created_at?: string;
    items?: PurchaseOrderItem[];
};

type DbPurchaseOrder = {
    id: string;
    order_number: string;
    supplier_id: string;
    warehouse_id?: string | null;
    branch_id?: string | null;
    order_date: string;
    expected_date?: string | null;
    subtotal: number | string;
    tax: number | string;
    discount: number | string;
    total: number | string;
    status: string;
    notes?: string | null;
    created_at: string;
    supplier: { name: string } | null;
    warehouse: { name: string } | null;
};

export async function fetchPurchaseOrders(options?: {
    status?: string;
    supplierId?: string;
    fromDate?: string;
    toDate?: string;
}): Promise<PurchaseOrder[]> {
    if (!supabase) return [];
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return [];

    let query = supabase
        .from('purchase_orders')
        .select(`
      id, order_number, supplier_id, warehouse_id, branch_id,
      order_date, expected_date, subtotal, tax, discount, total,
      status, notes, created_at,
      supplier:suppliers(name),
      warehouse:inventory_warehouses(name)
    `)
        .order('created_at', { ascending: false });

    if (options?.status) query = query.eq('status', options.status);
    if (options?.supplierId) query = query.eq('supplier_id', options.supplierId);
    if (options?.fromDate) query = query.gte('order_date', options.fromDate);
    if (options?.toDate) query = query.lte('order_date', options.toDate);

    const { data, error } = await query.returns<any[]>();
    if (error) {
        console.error('Error fetching purchase orders:', error);
        return [];
    }

    return (data ?? []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        supplier_id: o.supplier_id,
        supplier_name: o.supplier?.name ?? 'N/A',
        warehouse_id: o.warehouse_id,
        warehouse_name: o.warehouse?.name ?? null,
        branch_id: o.branch_id,
        order_date: o.order_date,
        expected_date: o.expected_date,
        subtotal: toNumber(o.subtotal),
        tax: toNumber(o.tax),
        discount: toNumber(o.discount),
        total: toNumber(o.total),
        status: o.status as any,
        notes: o.notes,
        created_at: o.created_at,
    }));
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
    if (!supabase) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;

    // Get PO header
    const { data: poData, error: poError } = await supabase
        .from('purchase_orders')
        .select(`
      id, order_number, supplier_id, warehouse_id, branch_id,
      order_date, expected_date, subtotal, tax, discount, total,
      status, notes, created_at,
      supplier:suppliers(name),
      warehouse:inventory_warehouses(name)
    `)
        .eq('id', id)
        .single();

    if (poError || !poData) return null;

    // Get PO items
    const { data: itemsData } = await supabase
        .from('purchase_order_items')
        .select(`
      id, product_id, quantity, unit_price, discount_percent, tax_percent,
      received_quantity, notes,
      product:inventory_products(name, sku)
    `)
        .eq('order_id', id)
        .returns<any[]>();

    const items: PurchaseOrderItem[] = (itemsData ?? []).map((item: any) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product?.name,
        product_sku: item.product?.sku,
        quantity: toNumber(item.quantity),
        unit_price: toNumber(item.unit_price),
        discount_percent: toNumber(item.discount_percent),
        tax_percent: toNumber(item.tax_percent),
        received_quantity: toNumber(item.received_quantity),
        notes: item.notes,
    }));

    return {
        id: poData.id,
        order_number: poData.order_number,
        supplier_id: poData.supplier_id,
        supplier_name: (poData.supplier as any)?.name ?? 'N/A',
        warehouse_id: poData.warehouse_id,
        warehouse_name: (poData.warehouse as any)?.name ?? null,
        branch_id: poData.branch_id,
        order_date: poData.order_date,
        expected_date: poData.expected_date,
        subtotal: toNumber(poData.subtotal),
        tax: toNumber(poData.tax),
        discount: toNumber(poData.discount),
        total: toNumber(poData.total),
        status: poData.status as any,
        notes: poData.notes,
        created_at: poData.created_at,
        items,
    };
}

export type CreatePurchaseOrderInput = {
    supplier_id: string;
    warehouse_id?: string | null;
    branch_id?: string | null;
    order_date: string;
    expected_date?: string | null;
    items: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
        discount_percent?: number;
        tax_percent?: number;
        notes?: string | null;
    }>;
    notes?: string | null;
};

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<Result<{ id: string }>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Generate PO number
    const { data: tenantData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', sessionData.session.user.id)
        .single();

    if (!tenantData) return { data: null, error: 'Không tìm thấy tenant.' };

    const { data: poNumber } = await supabase.rpc('generate_purchase_order_number', {
        p_tenant_id: (tenantData as any).tenant_id,
    });

    // Calculate totals
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    for (const item of input.items) {
        const itemSubtotal = item.quantity * item.unit_price;
        const discount = itemSubtotal * ((item.discount_percent ?? 0) / 100);
        const taxable = itemSubtotal - discount;
        const tax = taxable * ((item.tax_percent ?? 0) / 100);

        subtotal += itemSubtotal;
        totalDiscount += discount;
        totalTax += tax;
    }

    const total = subtotal - totalDiscount + totalTax;

    // Create PO
    const { data: poData, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
            order_number: poNumber ?? `PO-${Date.now()}`,
            supplier_id: input.supplier_id,
            warehouse_id: input.warehouse_id,
            branch_id: input.branch_id,
            order_date: input.order_date,
            expected_date: input.expected_date,
            subtotal,
            tax: totalTax,
            discount: totalDiscount,
            total,
            status: 'draft',
            notes: input.notes,
            created_by: sessionData.session.user.id,
        })
        .select('id')
        .single();

    if (poError) return { data: null, error: formatError(poError) };
    const poId = (poData as any)?.id;
    if (!poId) return { data: null, error: 'Không tạo được đơn đặt hàng.' };

    // Create items
    const { error: itemsError } = await supabase.from('purchase_order_items').insert(
        input.items.map((item) => ({
            order_id: poId,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent ?? 0,
            tax_percent: item.tax_percent ?? 0,
            notes: item.notes,
        }))
    );

    if (itemsError) return { data: null, error: formatError(itemsError) };
    return { data: { id: poId }, error: null };
}

export async function updatePurchaseOrder(id: string, input: Partial<CreatePurchaseOrderInput>): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Only allow updating draft Purchase Orders
    const { data: po } = await supabase.from('purchase_orders').select('status').eq('id', id).single();
    if ((po as any)?.status !== 'draft') {
        return { data: null, error: 'Chỉ có thể sửa đơn hàng nháp.' };
    }

    // If items are provided, recalculate totals
    let updateData: any = {};

    if (input.supplier_id) updateData.supplier_id = input.supplier_id;
    if (input.warehouse_id !== undefined) updateData.warehouse_id = input.warehouse_id;
    if (input.branch_id !== undefined) updateData.branch_id = input.branch_id;
    if (input.order_date) updateData.order_date = input.order_date;
    if (input.expected_date !== undefined) updateData.expected_date = input.expected_date;
    if (input.notes !== undefined) updateData.notes = input.notes;

    if (input.items) {
        // Calculate totals
        let subtotal = 0;
        let totalTax = 0;
        let totalDiscount = 0;

        for (const item of input.items) {
            const itemSubtotal = item.quantity * item.unit_price;
            const discount = itemSubtotal * ((item.discount_percent ?? 0) / 100);
            const taxable = itemSubtotal - discount;
            const tax = taxable * ((item.tax_percent ?? 0) / 100);

            subtotal += itemSubtotal;
            totalDiscount += discount;
            totalTax += tax;
        }

        const total = subtotal - totalDiscount + totalTax;

        updateData.subtotal = subtotal;
        updateData.tax = totalTax;
        updateData.discount = totalDiscount;
        updateData.total = total;

        // Delete old items and insert new ones
        await supabase.from('purchase_order_items').delete().eq('order_id', id);

        const { error: itemsError } = await supabase.from('purchase_order_items').insert(
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

    const { error: poError } = await supabase.from('purchase_orders').update(updateData).eq('id', id);

    if (poError) return { data: null, error: formatError(poError) };
    return { data: true, error: null };
}

export async function updatePurchaseOrderStatus(id: string, status: PurchaseOrder['status']): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

export async function deletePurchaseOrder(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Only allow deleting draft POs
    const { data: po } = await supabase.from('purchase_orders').select('status').eq('id', id).single();

    if ((po as any)?.status !== 'draft') {
        return { data: null, error: 'Chỉ có thể xóa đơn hàng nháp.' };
    }

    const { error } = await supabase.from('purchase_orders').delete().eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}
