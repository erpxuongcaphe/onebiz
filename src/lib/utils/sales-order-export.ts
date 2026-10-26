import type { SalesOrder } from '@/lib/types';
import type { OrderExportLine } from '@/lib/services/supabase/order-management-reads';
import { formatDate } from '@/lib/format';

export const orderSummaryColumns = [
  {header:'Mã đặt hàng',key:'code',width:18}, {header:'Thời gian',key:'date',width:22,format:(v:string)=>formatDate(v)},
  {header:'Chi nhánh',key:'branchName',width:30}, {header:'Khách hàng',key:'customerName',width:32},
  {header:'SĐT',key:'customerPhone',width:16}, {header:'Tổng tiền',key:'totalAmount',width:18},
  {header:'Đã trả',key:'paid',width:18}, {header:'Còn nợ',key:'debt',width:18},
  {header:'Trạng thái',key:'statusName',width:22}, {header:'Ghi chú đơn',key:'note',width:40},
];
export const orderLineColumns = [
  ...orderSummaryColumns.filter(c=>['code','date','branchName','customerName','customerPhone','note'].includes(c.key)),
  {header:'Mã hàng',key:'productCode',width:18}, {header:'Tên hàng',key:'productName',width:38},
  {header:'ĐVT',key:'unit',width:10}, {header:'Số lượng',key:'quantity',width:14,precision:4},
  {header:'Đơn giá',key:'unitPrice',width:18,precision:4}, {header:'Giảm giá dòng',key:'lineDiscount',width:18},
  {header:'Thành tiền dòng',key:'lineTotal',width:18}, {header:'Ghi chú mã hàng',key:'lineNote',width:40},
];
/** Literal notes and numeric cells; do not repeat order totals in the item sheet. */
export function buildOrderExportRows(orders: SalesOrder[], lines: OrderExportLine[]) {
  const byId = new Map(orders.map(o=>[o.id,o]));
  const rows = lines.map(line=>{
    const o=byId.get(line.invoice_id);
    if(!o) throw new Error('Dòng hàng không thuộc các đơn đang xuất.');
    return {code:o.code,date:o.date,branchName:o.branchName,customerName:o.customerName,customerPhone:o.customerPhone,note:o.note??'',
      productCode:line.products?.code??'',productName:line.product_name??'',unit:line.unit??'',
      quantity:Number(line.quantity),unitPrice:Number(line.unit_price),lineDiscount:Number(line.discount),lineTotal:Number(line.total),lineNote:line.note??''};
  });
  // Preserve empty orders in CSV too; an empty demand must not silently vanish.
  const withLines = new Set(lines.map(line=>line.invoice_id));
  for (const o of orders) if (!withLines.has(o.id)) rows.push({code:o.code,date:o.date,branchName:o.branchName,customerName:o.customerName,customerPhone:o.customerPhone,note:o.note??'',productCode:'',productName:'(Không có dòng hàng)',unit:'',quantity:0,unitPrice:0,lineDiscount:0,lineTotal:0,lineNote:''});
  return rows;
}
