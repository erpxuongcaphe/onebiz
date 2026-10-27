import type { SalesOrder } from '@/lib/types';
import type { OrderExportLine } from '@/lib/services/supabase/order-management-reads';
import { formatDate } from '@/lib/format';
import type { ExcelSheet } from './excel-export';

export const orderSummaryColumns = [
  {header:'Mã đặt hàng',key:'code',width:18}, {header:'Thời gian',key:'date',width:22,format:(v:string)=>formatDate(v)},
  {header:'Chi nhánh',key:'branchName',width:30}, {header:'Khách hàng',key:'customerName',width:32},
  {header:'Mã khách hàng',key:'customerCode',width:20}, {header:'Mã hồ sơ gốc',key:'originalCustomerCode',width:20},
  {header:'Địa chỉ',key:'customerAddress',width:45}, {header:'Người tạo',key:'creator',width:26},
  {header:'SĐT',key:'customerPhone',width:16}, {header:'Tổng tiền',key:'totalAmount',width:18},
  {header:'Giảm giá đơn',key:'discountAmount',width:18}, {header:'Thuế VAT đơn',key:'taxAmount',width:18},
  {header:'Phí giao hàng',key:'shippingFee',width:18}, {header:'Hóa đơn liên quan',key:'relatedInvoices',width:35},
  {header:'Đã trả',key:'paid',width:18}, {header:'Còn nợ',key:'debt',width:18},
  {header:'Trạng thái',key:'statusName',width:22}, {header:'Ghi chú đơn',key:'note',width:40},
];
export const orderLineColumns = [
  ...orderSummaryColumns.filter(c=>['code','date','branchName','customerCode','originalCustomerCode','customerName','customerPhone','customerAddress','creator','relatedInvoices','note','statusName'].includes(c.key)),
  {header:'Mã hàng',key:'productCode',width:18}, {header:'Tên hàng',key:'productName',width:38},
  {header:'ĐVT',key:'unit',width:10}, {header:'Số lượng',key:'quantity',width:14,precision:4},
  {header:'Đơn giá',key:'unitPrice',width:18,precision:4}, {header:'Giảm giá dòng',key:'lineDiscount',width:18},
  {header:'VAT dòng (%)',key:'vatRate',width:16},
  {header:'Thành tiền dòng',key:'lineTotal',width:18}, {header:'Ghi chú mã hàng',key:'lineNote',width:40},
];
export function buildOrderSummaryRows(orders: readonly SalesOrder[]) {
  return orders.map(order => ({...order,
    creator:order.createdByName || order.createdBy || '',
    relatedInvoices:[...new Set([...(order.completedChildCodes??[]),order.fulfilledInvoiceCode,order.invoiceCode].filter((code):code is string=>Boolean(code)))].join(', '),
  }));
}
/** Literal notes and numeric cells; do not repeat order totals in the item sheet. */
export function buildOrderExportRows(orders: SalesOrder[], lines: OrderExportLine[]) {
  const byId = new Map(buildOrderSummaryRows(orders).map(o=>[o.id,o]));
  const rows = lines.map(line=>{
    const o=byId.get(line.invoice_id);
    if(!o) throw new Error('Dòng hàng không thuộc các đơn đang xuất.');
    return {code:o.code,date:o.date,branchName:o.branchName,customerCode:o.customerCode,originalCustomerCode:o.originalCustomerCode,customerAddress:o.customerAddress,creator:o.creator,relatedInvoices:o.relatedInvoices,statusName:o.statusName,customerName:o.customerName,customerPhone:o.customerPhone,note:o.note??'',
      productCode:line.products?.code??'',productName:line.product_name??'',unit:line.unit??'',
      quantity:finite(line.quantity),unitPrice:finite(line.unit_price),lineDiscount:finite(line.discount),lineTotal:finite(line.total),vatRate:line.vat_rate==null?'':finite(line.vat_rate),lineNote:line.note??''};
  });
  // Preserve empty orders in CSV too; an empty demand must not silently vanish.
  const withLines = new Set(lines.map(line=>line.invoice_id));
  for (const o of byId.values()) if (!withLines.has(o.id)) rows.push({code:o.code,date:o.date,branchName:o.branchName,customerCode:o.customerCode,originalCustomerCode:o.originalCustomerCode,customerAddress:o.customerAddress,creator:o.creator,relatedInvoices:o.relatedInvoices,statusName:o.statusName,customerName:o.customerName,customerPhone:o.customerPhone,note:o.note??'',productCode:'',productName:'(Không có dòng hàng)',unit:'',quantity:0,unitPrice:0,lineDiscount:0,lineTotal:0,vatRate:'' as number|string,lineNote:''});
  return rows;
}

function finite(value: unknown) {
  const n=Number(value);
  if(!Number.isFinite(n))throw new Error('Dữ liệu số trên đơn chưa hợp lệ, chưa tạo file.');
  return n;
}

/** Separate document, item and customer grains so line counts cannot multiply order totals. */
export function buildOrderExportSheets(orders:SalesOrder[],lines:OrderExportLine[],titleRows:string[]):ExcelSheet[] {
  const summaries=buildOrderSummaryRows(orders);
  const customers=new Map<string,{customerCode:string;customerName:string;customerPhone:string;customerAddress:string;orderCount:number;orders:string;totalAmount:number;cancelledAmount:number;paid:number;debt:number}>();
  for(const order of orders){
    const key=order.customerId && order.customerCode!=='KL-VL' ? order.canonicalCustomerId??order.customerId : `order:${order.id}`;
    const row=customers.get(key)??{customerCode:order.customerCode??'',customerName:order.customerName,customerPhone:order.customerPhone,customerAddress:order.customerAddress??'',orderCount:0,orders:'',totalAmount:0,cancelledAmount:0,paid:0,debt:0};
    row.orderCount++;row.orders+=(row.orders?', ':'')+order.code;
    if(order.status==='cancelled')row.cancelledAmount+=finite(order.totalAmount);
    else {row.totalAmount+=finite(order.totalAmount);row.paid+=finite(order.paid??0);row.debt+=finite(order.debt??0);}
    customers.set(key,row);
  }
  const customerColumns=[
    {header:'Mã khách hàng',key:'customerCode',width:20},{header:'Khách hàng',key:'customerName',width:36},
    {header:'SĐT',key:'customerPhone',width:17},{header:'Địa chỉ',key:'customerAddress',width:45},
    {header:'Số đơn',key:'orderCount',width:12},{header:'Các đơn đặt hàng',key:'orders',width:45},
    {header:'Giá trị đơn còn hiệu lực',key:'totalAmount',width:25},{header:'Giá trị đơn hủy',key:'cancelledAmount',width:22},
    {header:'Đã trả trên đơn',key:'paid',width:20},{header:'Còn nợ trên đơn',key:'debt',width:20},
  ];
  const numbers=new Set(['totalAmount','discountAmount','taxAmount','shippingFee','paid','debt','quantity','unitPrice','lineDiscount','lineTotal','vatRate','orderCount','cancelledAmount']);
  const columns=(defs:readonly {header:string;key:string;width:number;precision?:number}[])=>defs.map(c=>({label:c.header,key:c.key,width:c.width,format:numbers.has(c.key)?'number' as const:'text' as const,decimalPlaces:c.precision??2}));
  return [
    {name:'Đơn đặt hàng',titleRows,columns:columns(orderSummaryColumns),rows:summaries.map(row=>({...row,date:formatDate(row.date)}))},
    {name:'Chi tiết hàng đặt',titleRows,columns:columns(orderLineColumns),rows:buildOrderExportRows(orders,lines).map(row=>({...row,date:formatDate(row.date)}))},
    {name:'Theo khách hàng',titleRows:[...titleRows,'Giá trị đơn đặt hàng không đồng nghĩa doanh thu; đơn hủy được tách riêng. VAT trống nghĩa là dữ liệu cũ chưa có giá trị.'],columns:columns(customerColumns),rows:[...customers.values()]},
  ];
}
