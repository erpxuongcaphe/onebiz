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

export type GoodsReceiptItem = {
    id: string;
    product_id: string;
    product_name?: string;
    product_sku?: string;
    purchase_order_item_id?: string | null;
    quantity: number;
    unit_price?: number | null;
    lot_number?: string | null;
    expiry_date?: string | null;
};

export type GoodsReceipt = {
    id: string;
    document_number: string;
    document_date: string;
    purchase_order_id?: string | null;
    purchase_order_number?: string | null;
    supplier_id: string;
    supplier_name: string;
    warehouse_id: string;
    warehouse_name: string;
    status: 'draft' | 'completed' | 'void';
    notes?: string | null;
    created_at?: string;
    items?: GoodsReceiptItem[];
};

export async function fetchGoodsReceipts(options?: {
    status?: string;
    supplierId?: string;
    warehouseId?: string;
    fromDate?: string;
    toDate?: string;
}): Promise<GoodsReceipt[]> {
    if (!supabase) return [];
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return [];

    let query = supabase
        .from('goods_receipts')
        .select(`
      id, document_number, document_date, purchase_order_id, supplier_id,
      warehouse_id, status, notes, created_at,
      purchase_order:purchase_orders(order_number),
      supplier:suppliers(name),
      warehouse:inventory_warehouses(name)
    `)
        .order('created_at', { ascending: false });

    if (options?.status) query = query.eq('status', options.status);
    if (options?.supplierId) query = query.eq('supplier_id', options.supplierId);
    if (options?.warehouseId) query = query.eq('warehouse_id', options.warehouseId);
    if (options?.fromDate) query = query.gte('document_date', options.fromDate);
    if (options?.toDate) query = query.lte('document_date', options.toDate);

    const { data, error } = await query.returns<any[]>();
    if (error) {
        console.error('Error fetching goods receipts:', error);
        return [];
    }

    return (data ?? []).map((gr: any) => ({
        id: gr.id,
        document_number: gr.document_number,
        document_date: gr.document_date,
        purchase_order_id: gr.purchase_order_id,
        purchase_order_number: gr.purchase_order?.order_number ?? null,
        supplier_id: gr.supplier_id,
        supplier_name: gr.supplier?.name ?? 'N/A',
        warehouse_id: gr.warehouse_id,
        warehouse_name: gr.warehouse?.name ?? 'N/A',
        status: gr.status as any,
        notes: gr.notes,
        created_at: gr.created_at,
    }));
}

export async function getGoodsReceiptById(id: string): Promise<GoodsReceipt | null> {
    if (!supabase) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;

    // Get GR header
    const { data: grData, error: grError } = await supabase
        .from('goods_receipts')
        .select(`
      id, document_number, document_date, purchase_order_id, supplier_id,
      warehouse_id, status, notes, created_at,
      purchase_order:purchase_orders(order_number),
      supplier:suppliers(name),
      warehouse:inventory_warehouses(name)
    `)
        .eq('id', id)
        .single();

    if (grError || !grData) return null;

    // Get GR items
    const { data: itemsData } = await supabase
        .from('goods_receipt_items')
        .select(`
      id, product_id, purchase_order_item_id, quantity, unit_price,
      lot_number, expiry_date,
      product:inventory_products(name, sku)
    `)
        .eq('receipt_id', id)
        .returns<any[]>();

    const items: GoodsReceiptItem[] = (itemsData ?? []).map((item: any) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product?.name,
        product_sku: item.product?.sku,
        purchase_order_item_id: item.purchase_order_item_id,
        quantity: toNumber(item.quantity),
        unit_price: toNumber(item.unit_price),
        lot_number: item.lot_number,
        expiry_date: item.expiry_date,
    }));

    return {
        id: grData.id,
        document_number: grData.document_number,
        document_date: grData.document_date,
        purchase_order_id: grData.purchase_order_id,
        purchase_order_number: (grData.purchase_order as any)?.order_number ?? null,
        supplier_id: grData.supplier_id,
        supplier_name: (grData.supplier as any)?.name ?? 'N/A',
        warehouse_id: grData.warehouse_id,
        warehouse_name: (grData.warehouse as any)?.name ?? 'N/A',
        status: grData.status as any,
        notes: grData.notes,
        created_at: grData.created_at,
        items,
    };
}

export type CreateGoodsReceiptInput = {
    document_date: string;
    purchase_order_id?: string | null;
    supplier_id: string;
    warehouse_id: string;
    items: Array<{
        product_id: string;
        purchase_order_item_id?: string | null;
        quantity: number;
        unit_price?: number | null;
        lot_number?: string | null;
        expiry_date?: string | null;
    }>;
    notes?: string | null;
};

export async function createGoodsReceipt(input: CreateGoodsReceiptInput): Promise<Result<{ id: string }>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Generate GR number
    const { data: tenantData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', sessionData.session.user.id)
        .single();

    if (!tenantData) return { data: null, error: 'Không tìm thấy tenant.' };

    const { data: grNumber } = await supabase.rpc('generate_goods_receipt_number', {
        p_tenant_id: (tenantData as any).tenant_id,
    });

    // Create GR
    const { data: grData, error: grError } = await supabase
        .from('goods_receipts')
        .insert({
            document_number: grNumber ?? `GR-${Date.now()}`,
            document_date: input.document_date,
            purchase_order_id: input.purchase_order_id,
            supplier_id: input.supplier_id,
            warehouse_id: input.warehouse_id,
            status: 'draft',
            notes: input.notes,
            created_by: sessionData.session.user.id,
        })
        .select('id')
        .single();

    if (grError) return { data: null, error: formatError(grError) };
    const grId = (grData as any)?.id;
    if (!grId) return { data: null, error: 'Không tạo được phiếu nhập kho.' };

    // Create items
    const { error: itemsError } = await supabase.from('goods_receipt_items').insert(
        input.items.map((item) => ({
            receipt_id: grId,
            product_id: item.product_id,
            purchase_order_item_id: item.purchase_order_item_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            lot_number: item.lot_number,
            expiry_date: item.expiry_date,
        }))
    );

    if (itemsError) return { data: null, error: formatError(itemsError) };
    return { data: { id: grId }, error: null };
}

export async function completeGoodsReceipt(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Call the stored procedure
    const { error } = await supabase.rpc('complete_goods_receipt', {
        p_receipt_id: id,
    });

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

export async function voidGoodsReceipt(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Only allow voiding draft receipts
    const { data: gr } = await supabase.from('goods_receipts').select('status').eq('id', id).single();

    if ((gr as any)?.status === 'completed') {
        return { data: null, error: 'Không thể hủy phiếu đã hoàn tất. Vui lòng tạo phiếu điều chỉnh.' };
    }

    const { error } = await supabase.from('goods_receipts').update({ status: 'void' }).eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

export async function deleteGoodsReceipt(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    // Only allow deleting draft receipts
    const { data: gr } = await supabase.from('goods_receipts').select('status').eq('id', id).single();

    if ((gr as any)?.status !== 'draft') {
        return { data: null, error: 'Chỉ có thể xóa phiếu nháp.' };
    }

    const { error } = await supabase.from('goods_receipts').delete().eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}
