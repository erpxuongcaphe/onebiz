"use client";
import {DropdownMenuCheckboxItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuItem} from "@/components/ui/dropdown-menu";
import {INVOICE_DETAIL_FIELDS,DEFAULT_INVOICE_DISPLAY,type InvoiceDisplay, type DisplaySyncState} from "@/lib/hooks/use-invoice-display";
export function InvoiceDisplayMenu({value,onChange,sync}:{value:InvoiceDisplay;onChange:(value:InvoiceDisplay)=>void;sync?:{state:DisplaySyncState;retry:()=>void}}) {
 return <><DropdownMenuSeparator/><DropdownMenuLabel>Chi tiết món · áp dụng mọi hóa đơn</DropdownMenuLabel>
  <DropdownMenuCheckboxItem className="pointer-coarse:min-h-11" checked={value.splitOptions} onSelect={e=>e.preventDefault()} onCheckedChange={checked=>onChange({...value,splitOptions:!!checked})}>Tách cột tùy chọn F&amp;B</DropdownMenuCheckboxItem>
  {INVOICE_DETAIL_FIELDS.map(field=><DropdownMenuCheckboxItem className="pointer-coarse:min-h-11" key={field} checked={!value.hiddenFields.includes(field)} onSelect={e=>e.preventDefault()} onCheckedChange={checked=>onChange({...value,hiddenFields:checked?value.hiddenFields.filter(x=>x!==field):[...value.hiddenFields,field]})}>{field}</DropdownMenuCheckboxItem>)}
  <DropdownMenuSeparator/><DropdownMenuItem className="pointer-coarse:min-h-11" onClick={()=>onChange({...DEFAULT_INVOICE_DISPLAY,listColumns:value.listColumns})}>Khôi phục chi tiết gọn</DropdownMenuItem>
  <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{sync?.state==="synced"?"Đã đồng bộ tài khoản · dùng chung các thiết bị.":sync?.state==="offline"?"Chưa đồng bộ. Lựa chọn vẫn dùng được trên máy này.":"Đang đồng bộ lựa chọn hiển thị…"} Bộ lọc và file xuất vẫn giữ đủ thông tin.</p>{sync?.state==="offline"&&<DropdownMenuItem onClick={sync.retry}>Thử đồng bộ lại</DropdownMenuItem>}</>;
}
