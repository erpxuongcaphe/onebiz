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

export type InventoryUnit = {
  id: string;
  name: string;
  code: string;
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
  barcode: string | null;
  name: string;
  image_url: string | null;
  cost_price: number | string | null;
  selling_price: number | string | null;
  min_stock_level: number | string | null;
  status?: string | null;
  type?: string | null;
  category: { name: string } | null;
  unit: { name: string } | null; // Joined
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

  // Single optimized query with JOIN to get products + stock in one go
  let q = supabase
    .from('inventory_products')
    .select(`
      id, sku, barcode, name, image_url, cost_price, selling_price, min_stock_level, status, type, 
      category:inventory_categories(name), 
      unit_id, 
      unit:inventory_units(name),
      stock:inventory_stock(quantity)
    `)
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
    ? await q
    : await q.neq('status', 'inactive'));

  if (productsError) {
    console.error('Error fetching products:', productsError);
    return [];
  }

  if (!products || products.length === 0) return [];

  // Map products with aggregated stock
  return products.map((p: any) => {
    // Aggregate stock from all warehouses
    const stockRecords = Array.isArray(p.stock) ? p.stock : (p.stock ? [p.stock] : []);
    const totalStock = stockRecords.reduce((sum: number, s: any) => sum + toNumber(s.quantity), 0);
    const minStockLevel = toNumber(p.min_stock_level);

    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category: p.category?.name ?? 'Khác',
      unit: p.unit?.name ?? '',
      unitId: p.unit_id,
      stock: totalStock,
      price: toNumber(p.selling_price),
      costPrice: toNumber(p.cost_price),
      sellingPrice: toNumber(p.selling_price),
      status: computeStatus(totalStock, minStockLevel),
      type: p.type ?? 'product',
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
  barcode?: string | null;
  name: string;
  category_id: string | null;
  unit_id: string | null;
  cost_price: number;
  selling_price: number;
  min_stock_level: number;
  image_url: string | null;
  type: 'product' | 'material';
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
      barcode: input.barcode ?? null,
      name: input.name,
      category_id: input.category_id,
      unit_id: input.unit_id,
      cost_price: input.cost_price,
      selling_price: input.selling_price,
      min_stock_level: input.min_stock_level,
      image_url: input.image_url,
      type: input.type,
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

export async function fetchInventoryUnits(): Promise<InventoryUnit[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_units')
    .select('id, name, code, created_at')
    .order('name', { ascending: true })
    .returns<InventoryUnit[]>();

  if (error) return [];
  return data ?? [];
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

export async function createInventoryUnit(input: { name: string; code: string }): Promise<Result<{ id: string }>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { data, error } = await supabase
    .from('inventory_units')
    .insert({ name: input.name, code: input.code })
    .select('id')
    .single();

  if (error) return { data: null, error: formatError(error) };
  const id = (data as any)?.id as string | undefined;
  if (!id) return { data: null, error: 'Không tạo được đơn vị.' };
  return { data: { id }, error: null };
}

export async function updateInventoryUnit(unitId: string, patch: { name?: string; code?: string }): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_units')
    .update(patch)
    .eq('id', unitId);

  if (error) return { data: null, error: formatError(error) };
  return { data: true, error: null };
}

export async function deleteInventoryUnit(unitId: string): Promise<Result<true>> {
  if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

  const { error } = await supabase
    .from('inventory_units')
    .delete()
    .eq('id', unitId);

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
