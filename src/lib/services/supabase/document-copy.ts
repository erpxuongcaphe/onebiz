import { getClient, getCurrentContext, handleError } from './base';
import { isWholesaleOnlyProduct } from '@/lib/fnb-catalog-scope';

export interface DocumentCopySource { id: string; code: string; branchId?: string }
export interface CopyProduct { id: string; code: string; name: string; unit: string; cost_price: number }
export interface PurchaseCopySeed {
  code: string;
  supplier: { id: string; name: string; branchId: string | null };
  note: string;
  items: Array<CopyProduct & { quantity: number; price: number; vatRate: number; note: string }>;
}

/** Read-only templates. No codes, payments, receipt links or stock effects are copied. */
export async function loadDocumentCopy(kind: 'purchase' | 'inventory', sourceId: string, branchId: string, isFnb: boolean) {
  const { tenantId } = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getClient() as any;
  const { data: source, error } = await client.from(kind === 'purchase' ? 'purchase_orders' : 'inventory_checks')
    .select(kind === 'purchase' ? 'id,code,branch_id,supplier_id,note' : 'id,code,branch_id')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', sourceId).single();
  if (error) handleError(error, 'loadDocumentCopy.source');
  if (!source) throw new Error('Không đọc được phiếu nguồn trong chi nhánh đang chọn.');
  const { data: rows, error: itemError } = await client.from(kind === 'purchase' ? 'purchase_order_items' : 'inventory_check_items')
    .select(kind === 'purchase' ? 'product_id,quantity,unit,unit_price,discount,vat_rate,note,transaction_quantity,transaction_unit,transaction_unit_price,conversion_factor' : 'product_id')
    .eq(kind === 'purchase' ? 'purchase_order_id' : 'check_id', sourceId).order('id').limit(1001);
  if (itemError) handleError(itemError, 'loadDocumentCopy.items');
  const lines = (rows ?? []) as Array<{ product_id: string; quantity?: number; unit?: string; unit_price?: number; transaction_quantity?: number; transaction_unit?: string; transaction_unit_price?: number; conversion_factor?: number; discount?: number; vat_rate?: number; note?: string }>;
  if (!lines.length || lines.length > 500) throw new Error('Chỉ sao chép phiếu có từ 1 đến 500 mặt hàng.');
  const ids = [...new Set(lines.map(row => row.product_id))];
  if (ids.length !== lines.length || ids.some(id => !id)) throw new Error('Phiếu có dòng hàng trùng hoặc không còn mã sản phẩm. Vui lòng tạo phiếu mới và kiểm tra từng dòng.');
  type Product = CopyProduct & { is_active: boolean; product_type: string; inventory_role: string | null };
  const catalog = new Map<string, Product>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data: products, error: productError } = await client.from('products_scoped')
      .select('id,code,name,unit,cost_price,is_active,product_type,inventory_role')
      .eq('tenant_id', tenantId).in('id', ids.slice(offset, offset + 100)).limit(101);
    if (productError) handleError(productError, 'loadDocumentCopy.products');
    for (const p of (products ?? []) as Product[]) catalog.set(p.id, p);
  }
  const unavailable = ids.filter(id => {
    const p = catalog.get(id);
    return !p || !p.is_active || (isFnb && (p.product_type !== 'sku' || isWholesaleOnlyProduct(p) || p.inventory_role === 'fnb_menu_item'));
  });
  if (unavailable.length) throw new Error('Phiếu nguồn có hàng đã ngừng dùng hoặc không thuộc danh mục chi nhánh. Chưa sao chép; hãy kiểm tra danh sách hàng trước.');
  if (kind === 'purchase' && lines.some(row => row.unit && row.unit !== catalog.get(row.product_id)?.unit)) {
    throw new Error('Đơn vị tồn của hàng đã thay đổi so với phiếu nguồn. Vui lòng tạo mới để kiểm tra quy đổi.');
  }
  const items = lines.map(row => { const quantity=Number(row.transaction_quantity ?? row.quantity ?? 0); return { ...catalog.get(row.product_id)!, unit: row.transaction_unit ?? catalog.get(row.product_id)!.unit, quantity, price: Math.max(0,Number(row.transaction_unit_price ?? row.unit_price ?? 0) - Number(row.discount ?? 0)/(quantity || 1)), vatRate: Number(row.vat_rate ?? 0), note: row.note ?? '' }; });
  if (kind === 'inventory') return { code: String(source.code), items, supplier: null, note: '' };
  const { data: supplier, error: supplierError } = await client.from('suppliers').select('id,name,branch_id,is_active')
    .eq('tenant_id', tenantId).eq('id', source.supplier_id).single();
  if (supplierError) handleError(supplierError, 'loadDocumentCopy.supplier');
  if (!supplier?.is_active) throw new Error('Nhà cung cấp của phiếu nguồn đã ngừng hoạt động.');
  if (items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) throw new Error('Phiếu nguồn có số lượng không hợp lệ.');
  return { code: String(source.code), items, supplier: { id: String(supplier.id), name: String(supplier.name), branchId: supplier.branch_id as string | null }, note: String(source.note ?? '') };
}
