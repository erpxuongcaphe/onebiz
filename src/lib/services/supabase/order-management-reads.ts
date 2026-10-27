import type { QueryParams, SalesOrder } from '@/lib/types';
import { getClient, getCurrentTenantId } from './base';
import { readHistoryPages } from './read-history-pages';
import { getOrdersTheoPhamVi, type PhamViDonDatHang } from './sales-order-list-scope';
import {getCustomerIdentityDirectory,canonicalCustomerOptions} from './customer-identity';

/** Read-only, lean catalogue for report filters. Includes internal customers. */
export async function getForecastCustomerOptions() {
  const client = getClient();
  const tenant = await getCurrentTenantId();
  const [rows,links]=await Promise.all([readHistoryPages<{ id: string; code: string; name: string; phone: string | null }>(async (offset, size) =>
    client.from('customers').select('id,code,name,phone', { count: 'exact' })
      .eq('tenant_id', tenant).order('name').order('id').range(offset, offset + size - 1)),getCustomerIdentityDirectory()]);
  return canonicalCustomerOptions(rows,links);
}

export interface OrderExportLine {
  id: string; invoice_id: string; product_name: string | null; unit: string | null;
  quantity: number; unit_price: number; discount: number; total: number; note: string | null;
  products: { code: string } | null;
}

/** Every page in the same authorized scope; never export only the visible page. */
export async function readOrdersForExport(scope: PhamViDonDatHang, params: Omit<QueryParams, 'branchId' | 'page' | 'pageSize'>, selectedIds?: string[]) {
  if (scope.mode === 'none') throw new Error('Chọn phạm vi chi nhánh trước khi xuất.');
  const ids = selectedIds ? [...new Set(selectedIds)] : undefined;
  if (ids && !ids.length) throw new Error('Chọn ít nhất một đơn đặt hàng.');
  const orders = await readHistoryPages<SalesOrder>(async (offset, size) => {
    const r = await getOrdersTheoPhamVi(scope, { ...params, page: offset / size, pageSize: size,
      filters: { ...params.filters, ...(ids ? { ids } : {}) } });
    return { data: r.data, count: r.total, error: null };
  });
  if (ids && (orders.length !== ids.length || orders.some(o => !ids.includes(o.id)))) {
    throw new Error('Đơn được chọn đã thay đổi hoặc không còn trong phạm vi. Tải lại trước khi xuất.');
  }
  const client = getClient();
  const lines: OrderExportLine[] = [];
  for (let start = 0; start < orders.length; start += 100) {
    const batchIds = orders.slice(start, start + 100).map(o => o.id);
    const batch = await readHistoryPages<OrderExportLine>(async (offset, size) => {
      const r = await client.from('invoice_items_scoped')
        .select('id,invoice_id,product_name,unit,quantity,unit_price,discount,total,note,products:products_scoped!invoice_items_product_id_fkey(code)', { count: 'exact' })
        .in('invoice_id', batchIds).order('invoice_id').order('id').range(offset, offset + size - 1);
      return r as unknown as { data: OrderExportLine[] | null; count: number | null; error: {message:string} | null };
    });
    lines.push(...batch);
  }
  return { orders, lines };
}
