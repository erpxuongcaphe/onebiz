import type { Product } from '../types';
import { supabase } from './supabaseClient';

type Result<T> = { data: T; error: null } | { data: null; error: string };

function formatError(err: any): string {
  const code = err?.code as string | undefined;
  if (code === '23505') return 'Dữ liệu bị trùng (SKU/code đã tồn tại).';
  if (err?.message) return String(err.message);
  return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export type InventoryCategory = {
  id: string;
  name: string;
  code?: string | null;
  created_at?: string;
};

export type InventoryWarehouse = {
  id: string;
  name: string;
  code: string;
  branch_id?: string | null;
  address?: string | null;
  status?: string;
  created_at?: string;
};

export type InventoryMovement = {
  id: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  created_at: string;
};

type DbProduct = {
  id: string;
  sku: string;
  name: string;
  image_url: string | null;
  selling_price: number | string | null;
  min_stock_level: number | string | null;
  status?: string | null;
  category: { name: string } | null;
};

type DbStockRow = {
  product_id: string;
  quantity: number | string;
};

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeStatus(stock: number, minStockLevel: number): Product['status'] {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= minStockLevel) return 'Low Stock';
  return 'In Stock';
}

export async function fetchInventoryProducts(options?: {
  includeInactive?: boolean;
  fromDate?: string;
  toDate?: string;
  categoryId?: string;
}): Promise<Product[]> {
  if (!supabase) {
    console.error('Supabase not configured');
    return [];
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    console.warn('No active session - returning empty product list');
    return [];
  }

  let q = supabase
    .from('inventory_products')
    .select('id, sku, name, image_url, selling_price, min_stock_level, status, category:inventory_categories(name)')
    .order('created_at', { ascending: false });

  if (options?.categoryId) {
    q = q.eq('category_id', options.categoryId);
  }
  if (options?.fromDate) {
    q = q.gte('created_at', `${options.fromDate}T00:00:00Z`);
  }
  if (options?.toDate) {
    q = q.lte('created_at', `${options.toDate}T23:59:59Z`);
  }

  const { data: products, error: productsError } = (options?.includeInactive
    ? await q.returns<DbProduct[]>()
    : await q.neq('status', 'inactive').returns<DbProduct[]>());

  if (productsError) {
    console.error('Error fetching products:', productsError);
    return [];
  }

  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return [];

  const { data: stockRows, error: stockError } = await supabase
    .from('inventory_stock')
    .select('product_id, quantity')
    .in('product_id', productIds)
    .returns<DbStockRow[]>();

  const byProduct = new Map<string, number>();
  if (!stockError && stockRows) {
    for (const row of stockRows) {
      byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + toNumber(row.quantity));
    }
  }

  return (products ?? []).map((p) => {
    const stock = byProduct.get(p.id) ?? 0;
    const minStockLevel = toNumber(p.min_stock_level);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category?.name ?? 'Khác',
      stock,
      price: toNumber(p.selling_price),
      status: computeStatus(stock, minStockLevel),
      image: p.image_url ?? 'https://picsum.photos/100/100?random=1',
      archived: (p.status ?? 'active') === 'inactive',
    };
  });
}

export async function fetchInventoryCategories(): Promise<InventoryCategory[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_categories')
    .select('id, name, code, created_at')
    .order('name', { ascending: true })
    .returns<InventoryCategory[]>();

  if (error) return [];
  return data ?? [];
}

export async function fetchInventoryWarehouses(): Promise<InventoryWarehouse[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_warehouses')
    .select('id, name, code, branch_id, address, status, created_at')
    .order('created_at', { ascending: true })
    .returns<InventoryWarehouse[]>();

  if (error) return [];
  return data ?? [];
}

export async function ensureDefaultWarehouse(): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase
    .rpc('inventory_ensure_default_warehouse')
    .returns<string>();

  if (error) return null;
  return (data as any) ?? null;
}

export type CreateInventoryProductInput = {
  sku: string;
  name: string;
  category_id: string | null;
  selling_price: number;
  min_stock_level: number;
  image_url: string | null;
};

export type UpdateInventoryProductPatch = Partial<CreateInventoryProductInput> & {
  status?: 'active' | 'inactive' | 'discontinued';
};

export async function createInventoryProduct(input: CreateInventoryProductInput): Promise<Result<{ id: string }>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { data, error } = await supabase
    .from('inventory_products')
    .insert({
      sku: input.sku,
      name: input.name,
      category_id: input.category_id,
      selling_price: input.selling_price,
      min_stock_level: input.min_stock_level,
      image_url: input.image_url,
    })
    .select('id')
    .single();

  if (error) return { data: null, error: formatError(error) };
  const id = (data as any)?.id as string | undefined;
  if (!id) return { data: null, error: 'Không tạo được sản phẩm.' };
  return { data: { id }, error: null };
}

export async function updateInventoryProduct(productId: string, patch: UpdateInventoryProductPatch): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_products')
    .update(patch)
    .eq('id', productId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function archiveInventoryProduct(productId: string): Promise<Result<true>> {
  return updateInventoryProduct(productId, { status: 'inactive' });
}

export async function restoreInventoryProduct(productId: string): Promise<Result<true>> {
  return updateInventoryProduct(productId, { status: 'active' });
}

export async function deleteInventoryProductPermanently(productId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase.rpc('inventory_delete_product', { p_product_id: productId });
  if (error) {
    if (String(error.message || '').includes('referenced by sales orders')) {
      return { data: null, error: 'Không thể xóa vĩnh viễn vì sản phẩm đã phát sinh đơn hàng.' };
    }
    return { data: null, error: formatError(error) };
  }
  return { data: true, error: null };
}

export async function createInventoryCategory(input: { name: string; code?: string | null }): Promise<Result<{ id: string }>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { data, error } = await supabase
    .from('inventory_categories')
    .insert({ name: input.name, code: input.code ?? null })
    .select('id')
    .single();

  if (error) return { data: null, error: formatError(error) };
  const id = (data as any)?.id as string | undefined;
  if (!id) return { data: null, error: 'Không tạo được danh mục.' };
  return { data: { id }, error: null };
}

export async function updateInventoryCategory(categoryId: string, patch: { name?: string; code?: string | null }): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_categories')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.code !== undefined ? { code: patch.code } : {}),
    })
    .eq('id', categoryId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function deleteInventoryCategory(categoryId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_categories')
    .delete()
    .eq('id', categoryId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function createInventoryWarehouse(input: { name: string; code: string; address?: string | null }): Promise<Result<{ id: string }>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { data, error } = await supabase
    .from('inventory_warehouses')
    .insert({ name: input.name, code: input.code, address: input.address ?? null, status: 'active' })
    .select('id')
    .single();

  if (error) return { data: null, error: formatError(error) };
  const id = (data as any)?.id as string | undefined;
  if (!id) return { data: null, error: 'Không tạo được kho.' };
  return { data: { id }, error: null };
}

export async function updateInventoryWarehouse(warehouseId: string, patch: { name?: string; code?: string; address?: string | null }): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_warehouses')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.code !== undefined ? { code: patch.code } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
    })
    .eq('id', warehouseId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function archiveInventoryWarehouse(warehouseId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_warehouses')
    .update({ status: 'inactive' })
    .eq('id', warehouseId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function restoreInventoryWarehouse(warehouseId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_warehouses')
    .update({ status: 'active' })
    .eq('id', warehouseId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function deleteInventoryWarehouse(warehouseId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_warehouses')
    .delete()
    .eq('id', warehouseId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function fetchInventoryMovements(productId: string): Promise<InventoryMovement[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_stock_movements')
    .select('id, movement_type, quantity, notes, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<Array<{ id: string; movement_type: string; quantity: number | string; notes: string | null; created_at: string }>>();

  if (error) return [];
  return (data ?? []).map((m) => ({
    id: m.id,
    movement_type: m.movement_type,
    quantity: toNumber(m.quantity),
    notes: m.notes,
    created_at: m.created_at,
  }));
}

export async function applyStockMovement(params: {
  productId: string;
  warehouseId: string;
  movementType: string;
  quantity: number;
  notes?: string;
}): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  // Try using the stored procedure first (recommended for atomicity)
  const { error } = await supabase.rpc('inventory_apply_stock_movement', {
    p_product_id: params.productId,
    p_warehouse_id: params.warehouseId,
    p_movement_type: params.movementType,
    p_quantity: params.quantity,
    p_reference_type: null,
    p_reference_id: null,
    p_notes: params.notes ?? null,
  });

  // If RPC exists and works, return success
  if (!error) {
    return { data: true, error: null };
  }

  // Fallback: Manual stock movement if RPC doesn't exist
  console.warn('inventory_apply_stock_movement RPC failed, using fallback:', error.message);

  try {
    // Determine if this is an increase or decrease
    const isIncrease = ['purchase', 'return', 'adjustment_in', 'transfer_in'].includes(params.movementType);
    const quantityDelta = isIncrease ? Math.abs(params.quantity) : -Math.abs(params.quantity);

    // 1. Get current stock
    const { data: currentStock } = await supabase
      .from('inventory_stock')
      .select('id, quantity')
      .eq('warehouse_id', params.warehouseId)
      .eq('product_id', params.productId)
      .single();

    const currentQty = toNumber(currentStock?.quantity);
    const newQty = currentQty + quantityDelta;

    // Validate: cannot go negative
    if (newQty < 0) {
      return { data: null, error: `Không đủ tồn kho. Hiện có: ${currentQty}, cần: ${Math.abs(quantityDelta)}` };
    }

    // 2. Update or insert stock record
    if (currentStock?.id) {
      const { error: updateErr } = await supabase
        .from('inventory_stock')
        .update({ quantity: newQty })
        .eq('id', currentStock.id);

      if (updateErr) {
        return { data: null, error: formatError(updateErr) };
      }
    } else {
      // Insert new stock record
      const { error: insertErr } = await supabase
        .from('inventory_stock')
        .insert({
          warehouse_id: params.warehouseId,
          product_id: params.productId,
          quantity: newQty,
        });

      if (insertErr) {
        return { data: null, error: formatError(insertErr) };
      }
    }

    // 3. Record the movement
    const { error: movementErr } = await supabase
      .from('inventory_stock_movements')
      .insert({
        product_id: params.productId,
        warehouse_id: params.warehouseId,
        movement_type: params.movementType,
        quantity: quantityDelta,
        notes: params.notes ?? null,
      });

    if (movementErr) {
      console.error('Failed to record movement (stock already updated):', movementErr);
      // Don't fail the whole operation if just movement recording fails
    }

    return { data: true, error: null };
  } catch (err) {
    console.error('Fallback stock movement failed:', err);
    return { data: null, error: formatError(err) };
  }
}
