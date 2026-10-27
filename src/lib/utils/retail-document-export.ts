import type { Invoice } from '@/lib/types';
import type { OrderExportLine } from '@/lib/services/supabase/order-management-reads';
import { formatDate } from '@/lib/format';
import type { ExcelSheet } from './excel-export';
import type { InvoiceExportQuery } from '@/lib/services/supabase/invoice-list-export';

type RetailExportLine=OrderExportLine & {vat_rate?:number|null};
const contextColumns=[
  {header:'Mã chứng từ',key:'code',width:18},
  {header:'Ngày chứng từ',key:'date',width:22,format:(v:string)=>formatDate(v)},
  {header:'Đơn đặt hàng gốc',key:'sourceOrderCode',width:22},
  {header:'Mã trước khi xuất (nháp)',key:'orderCode',width:25},
  {header:'Chi nhánh',key:'branchName',width:30},
  {header:'Người tạo',key:'createdBy',width:24},{header:'Loại bán',key:'saleTypeLabel',width:20},
  {header:'Mã khách hàng',key:'customerCode',width:20},
  {header:'Mã hồ sơ gốc',key:'originalCustomerCode',width:20},
  {header:'Khách hàng',key:'customerName',width:38},
  {header:'SĐT',key:'customerPhone',width:17},
  {header:'Địa chỉ',key:'customerAddress',width:45},
];
export const retailDocumentSummaryColumns=[...contextColumns,
  {header:'Giá trị chứng từ',key:'totalAmount',width:19},
  {header:'Giảm giá',key:'discount',width:17},
  {header:'Thuế',key:'taxAmount',width:17},
  {header:'Phí giao hàng',key:'shippingFee',width:17},
  {header:'Đã thanh toán',key:'paid',width:19},
  {header:'Còn nợ',key:'debt',width:19},
  {header:'Trạng thái',key:'statusLabel',width:22},
  {header:'Ghi chú chứng từ',key:'note',width:45},
];
export const retailDocumentLineColumns=[...contextColumns,
  {header:'Mã hàng',key:'productCode',width:20},{header:'Tên hàng',key:'productName',width:45},
  {header:'ĐVT',key:'unit',width:12},{header:'Số lượng',key:'quantity',width:15,precision:4},
  {header:'Đơn giá',key:'unitPrice',width:18,precision:4},{header:'Giảm giá dòng',key:'lineDiscount',width:18},
  {header:'VAT dòng (%)',key:'vatRate',width:16},{header:'Thành tiền dòng',key:'lineTotal',width:20},{header:'Ghi chú mã hàng',key:'lineNote',width:42},
  {header:'Ghi chú chứng từ',key:'note',width:45},{header:'Trạng thái',key:'statusLabel',width:22},
];
export const customerDocumentExportColumns=[
  {header:'Mã khách hàng',key:'customerCode',width:20},{header:'Khách hàng',key:'customerName',width:38},
  {header:'SĐT',key:'customerPhone',width:17},{header:'Địa chỉ',key:'customerAddress',width:45},
  {header:'Số chứng từ',key:'documentCount',width:16},{header:'Danh sách chứng từ',key:'documents',width:45},
  {header:'Giá trị chứng từ trong file',key:'documentValue',width:24},
  {header:'Giá trị đã hủy trong file',key:'cancelledValue',width:24},
  {header:'Đã thanh toán trong file',key:'paid',width:24},
];
const labels:Record<string,string>={draft:'Nháp',processing:'Đang xử lý',confirmed:'Đã xác nhận',completed:'Hoàn thành',cancelled:'Đã hủy',delivery_failed:'Giao thất bại'};
export function retailDocumentStatusLabel(row:Pick<Invoice,'code'|'status'|'source'>){
  return row.source!=='fnb'&&row.status==='processing'&&row.code.startsWith('NH')?'Nháp · chưa xuất':labels[row.status]??row.status;
}
function number(value:unknown){const n=Number(value);if(!Number.isFinite(n))throw new Error('Dữ liệu số trên chứng từ chưa hợp lệ, chưa tạo file.');return n;}

export function retailDocumentExportRange(invoices:readonly Invoice[],query:InvoiceExportQuery){
  const dateKey=(value:string)=>{
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
    const time=Date.parse(value);
    if(!Number.isFinite(time))throw new Error('Ngày chứng từ chưa hợp lệ, chưa tạo file.');
    return new Date(time+7*60*60*1000).toISOString().slice(0,10);
  };
  const dates=invoices.map(row=>dateKey(row.date)).sort();
  if(!dates.length)throw new Error('Không có chứng từ để xuất.');
  const from=dateKey(String(query.filters?.dateFrom||dates[0])),to=dateKey(String(query.filters?.dateTo||dates.at(-1)));
  if(from>to)throw new Error('Khoảng ngày xuất chưa hợp lệ.');
  return {from,to};
}

export function retailDocumentExportScopeText(query:InvoiceExportQuery){
  const raw=query.filters?.status;
  const statuses=Array.isArray(raw)?raw:typeof raw==='string'?[raw]:[];
  const type=query.filters?.retailSaleType;
  const parts=[statuses.length?'Trạng thái: '+statuses.map(value=>labels[value]??value).join(', '):'Trạng thái: theo mặc định đang xem'];
  if(query.search)parts.push('Tìm kiếm: '+query.search);
  if(type && type!=='all')parts.push('Loại bán: '+(type==='internal'?'Bán nội bộ':type==='delivery'?'Giao hàng':'Bán trực tiếp'));
  return parts.join(' · ');
}

/** Three distinct grains: one row per document, per item, and per customer. */
export function buildRetailDocumentExport(invoices:readonly Invoice[],lines:readonly RetailExportLine[]) {
  const summaries=invoices.map(row=>({...row,statusLabel:retailDocumentStatusLabel(row),saleTypeLabel:row.source==='internal'||row.retailSaleType==='internal'?'Bán nội bộ':row.retailSaleType==='delivery'?'Giao hàng':'Bán thường'}));
  const byId=new Map(summaries.map(row=>[row.id,row]));
  const details=lines.map(line=>{
    const invoice=byId.get(line.invoice_id);
    if(!invoice || invoice.source==='fnb')throw new Error('Dòng hàng không thuộc chứng từ Retail đã chọn.');
    const {code,date,orderCode,sourceOrderCode,branchName,customerCode,originalCustomerCode,customerName,customerPhone,customerAddress,note,statusLabel,createdBy,saleTypeLabel}=invoice;
    return {code,date,orderCode,sourceOrderCode,branchName,customerCode,originalCustomerCode,customerName,customerPhone,customerAddress,note,statusLabel,createdBy,saleTypeLabel,
      productCode:line.products?.code??'',productName:line.product_name??'',unit:line.unit??'',quantity:number(line.quantity),
      unitPrice:number(line.unit_price),lineDiscount:number(line.discount),lineTotal:number(line.total),vatRate:line.vat_rate==null?'':number(line.vat_rate),lineNote:line.note??''};
  });
  const withLines=new Set(lines.map(line=>line.invoice_id));
  for(const row of summaries.filter(row=>row.source!=='fnb'&&!withLines.has(row.id))){
    details.push({code:row.code,date:row.date,orderCode:row.orderCode,sourceOrderCode:row.sourceOrderCode,branchName:row.branchName,customerCode:row.customerCode,originalCustomerCode:row.originalCustomerCode,
      customerName:row.customerName,customerPhone:row.customerPhone,customerAddress:row.customerAddress,note:row.note,statusLabel:row.statusLabel,createdBy:row.createdBy,saleTypeLabel:row.saleTypeLabel,
      productCode:'',productName:'(Không có dòng hàng)',unit:'',quantity:0,unitPrice:0,lineDiscount:0,lineTotal:0,vatRate:'' as number|string,lineNote:''});
  }
  const customers=new Map<string,{customerCode:string;customerName:string;customerPhone:string;customerAddress:string;documentCount:number;documents:string;documentValue:number;cancelledValue:number;paid:number}>();
  for(const row of summaries){
    // Never merge customers by a similar name. Walk-in records stay separate by document.
    const key=row.customerId && row.customerCode!=='KL-VL'?(row.canonicalCustomerId??row.customerId):`document:${row.id}`;
    const customer=customers.get(key)??{customerCode:row.customerCode,customerName:row.customerName,customerPhone:row.customerPhone??'',customerAddress:row.customerAddress??'',documentCount:0,documents:'',documentValue:0,cancelledValue:0,paid:0};
    customer.documentCount++;customer.documents+=(customer.documents?', ':'')+row.code;
    if(row.status==='cancelled')customer.cancelledValue+=number(row.totalAmount);
    else {customer.documentValue+=number(row.totalAmount);customer.paid+=number(row.paid);}
    customers.set(key,customer);
  }
  return {summaries,details,customers:[...customers.values()]};
}

export function buildRetailDocumentSheets(invoices:readonly Invoice[], lines:readonly RetailExportLine[], titleRows:string[]):ExcelSheet[] {
  const result=buildRetailDocumentExport(invoices,lines);
  const numeric=new Set(['totalAmount','discount','taxAmount','shippingFee','paid','debt','quantity','unitPrice','lineDiscount','lineTotal','documentCount','documentValue','cancelledValue','vatRate']);
  const columns=(definitions:readonly {header:string;key:string;width:number;precision?:number}[])=>definitions.map(col=>({
    label:col.header,key:col.key,width:col.width,format:numeric.has(col.key)?'number' as const:'text' as const,decimalPlaces:col.precision??2,
  }));
  const dates=(rows:Record<string,unknown>[])=>rows.map(row=>({...row,...(row.date?{date:formatDate(String(row.date))}:{})}));
  return [
    {name:'Chứng từ',titleRows,columns:columns(retailDocumentSummaryColumns),rows:dates(result.summaries)},
    {name:'Chi tiết hàng',titleRows:[titleRows[0]+' — CHI TIẾT HÀNG',...titleRows.slice(1)],columns:columns(retailDocumentLineColumns),rows:dates(result.details)},
    {name:'Theo khách hàng',titleRows:[titleRows[0]+' — THEO KHÁCH HÀNG',...titleRows.slice(1),'Giá trị chứng từ trong file không đồng nghĩa doanh thu; nháp và hủy được phân biệt theo trạng thái.'],columns:columns(customerDocumentExportColumns),rows:result.customers},
  ];
}
