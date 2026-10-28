import { applyFnbCatalogScope } from '@/lib/fnb-catalog-scope';
import { getClient, getCurrentContext, handleError } from './base';

/** Supplier receipts use the same SKU as BOM/internal receipts, not a second supplier SKU. */
export async function searchSupplierPurchaseProducts(search: string, isFnb: boolean) {
  const term = search.trim();
  if (!term) return [];
  const { tenantId } = await getCurrentContext();
  const client = getClient();
  // Separate filters keep punctuation in a product name out of PostgREST's OR grammar.
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const results = await Promise.all((['code', 'name'] as const).map(column => {
    let query = client.from('products_scoped')
      .select('id,code,name,unit,cost_price,vat_rate')
      .eq('tenant_id', tenantId).eq('is_active', true);
    query = isFnb
      ? applyFnbCatalogScope(query, true).or('inventory_role.is.null,inventory_role.neq.fnb_menu_item')
      : query.eq('product_type', 'nvl');
    return query.ilike(column, pattern).order('code').limit(20);
  }));
  const products = new Map<string, {id:string;code:string;name:string;unit:string;price:number;vatRate:number}>();
  for (const { data, error } of results) {
    if (error) handleError(error, 'searchSupplierPurchaseProducts');
    for (const row of data ?? []) products.set(row.id, {
      id:row.id, code:row.code ?? '', name:row.name, unit:row.unit ?? 'Cái',
      price:Number(row.cost_price ?? 0), vatRate:Number(row.vat_rate ?? 0),
    });
  }
  return [...products.values()].sort((a,b) =>
    Number(b.code.toLowerCase() === term.toLowerCase()) - Number(a.code.toLowerCase() === term.toLowerCase())
    || a.code.localeCompare(b.code)).slice(0,20);
}
