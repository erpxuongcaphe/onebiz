import type { Invoice } from '@/lib/types';
import { getClient } from './base';
import { readHistoryPages } from './read-history-pages';
import { getInvoicesForFilteredExport, type InvoiceExportQuery } from './invoice-list-export';
import type { PhamViChiNhanh } from './invoice-list-scope';
import type { OrderExportLine } from './order-management-reads';

function check(signal?: AbortSignal) {
  if(signal?.aborted)throw new DOMException('Đã hủy xuất chứng từ.','AbortError');
}

/** Re-read selected headers in the same authorized scope and filters before fetching lines. */
export async function readSelectedInvoiceExport(scope: PhamViChiNhanh, query: InvoiceExportQuery, selectedIds: readonly string[], signal?: AbortSignal) {
  const ids=[...new Set(selectedIds)];
  if(!ids.length)throw new Error('Chọn ít nhất một chứng từ để xuất.');
  const result:Invoice[]=[];
  for(let i=0;i<ids.length;i+=100){
    check(signal);
    const batch=ids.slice(i,i+100);
    const rows=await getInvoicesForFilteredExport(scope,{...query,filters:{...query.filters,ids:batch}},{signal});
    if(rows.length!==batch.length || rows.some(row=>!batch.includes(row.id)))throw new Error('Chứng từ đã thay đổi hoặc không còn trong bộ lọc. Tải lại trước khi xuất.');
    result.push(...rows);
  }
  check(signal);
  const byId=new Map(result.map(row=>[row.id,row]));
  return ids.map(id=>byId.get(id)!);
}

/** Header IDs come from a scope-checked export; item views enforce the existing server permissions. */
export async function readRetailDocumentExportLines(invoices: readonly Invoice[], signal?: AbortSignal) {
  const ids=[...new Set(invoices.filter(row=>row.source!=='fnb').map(row=>row.id))];
  const lines:OrderExportLine[]=[];
  const client=getClient();
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const rows=await readHistoryPages<OrderExportLine>(async(offset,size)=>{
      check(signal);
      const result=await client.from('invoice_items_scoped')
        .select('id,invoice_id,product_name,unit,quantity,unit_price,discount,total,vat_rate,note,products:products_scoped!invoice_items_product_id_fkey(code)',{count:'exact'})
        .in('invoice_id',batch).order('invoice_id').order('id').range(offset,offset+size-1);
      check(signal);
      return result as unknown as {data:OrderExportLine[]|null;count:number|null;error:{message:string}|null};
    });
    if(rows.some(row=>!batch.includes(row.invoice_id)))throw new Error('Dòng hàng không thuộc chứng từ đã chọn.');
    lines.push(...rows);
  }
  check(signal);
  return lines;
}
