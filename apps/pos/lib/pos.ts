import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export type PosShift = {
  id: string;
  branch_id: string;
  code: string;
  status: 'open' | 'closed' | 'cancelled';
  opened_at: string;
  opening_cash: number;
};

export type PosCatalogItem = {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
};

export type PosOrder = {
  id: string;
  order_number: string;
  created_at: string;
  total: number;
};

export type PosOrderItem = {
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
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

  const { data, error } = await supabase
    .from('inventory_stock')
    .select('quantity, product:inventory_products(id, sku, name, selling_price, status, category:inventory_categories(name))')
    .eq('warehouse_id', params.warehouseId);

  if (error || !data) return [];

  const q = (params.search ?? '').trim().toLowerCase();
  const cat = (params.category ?? '').trim();

  const items: PosCatalogItem[] = [];
  for (const row of data as any[]) {
    const p = row.product;
    if (!p) continue;
    if ((p.status ?? 'active') === 'inactive') continue;
    const categoryName = p.category?.name ?? 'Khác';
    if (cat && categoryName !== cat) continue;
    const sku = String(p.sku ?? '');
    const name = String(p.name ?? '');
    if (q && !name.toLowerCase().includes(q) && !sku.toLowerCase().includes(q)) continue;
    items.push({
      product_id: p.id,
      sku,
      name,
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

  const code = `CA-${localDateStamp()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;

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

export async function createPosSale(params: {
  branchId: string;
  warehouseId: string;
  shiftId: string;
  lines: Array<{ product_id: string; quantity: number; unit_price: number }>;
  paymentMethod: string;
  paymentAmount: number;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase.rpc('pos_create_sale', {
    p_branch_id: params.branchId,
    p_warehouse_id: params.warehouseId,
    p_shift_id: params.shiftId,
    p_lines: params.lines,
    p_payment_method: params.paymentMethod,
    p_payment_amount: params.paymentAmount,
  });

  if (error) return null;
  return (data as any) ?? null;
}

export async function fetchPosOrder(orderId: string): Promise<PosOrder | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase
    .from('pos_orders')
    .select('id, order_number, created_at, total')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    order_number: data.order_number,
    created_at: data.created_at,
    total: toNumber(data.total),
  };
}

export async function fetchPosOrderItems(orderId: string): Promise<PosOrderItem[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('pos_order_items')
    .select('sku, name, quantity, unit_price')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as any[]).map((i) => ({
    sku: String(i.sku ?? ''),
    name: String(i.name ?? ''),
    quantity: toNumber(i.quantity),
    unit_price: toNumber(i.unit_price),
  }));
}
