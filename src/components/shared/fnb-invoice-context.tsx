import {formatDate} from "@/lib/format";
import type {FnbInvoiceContext as Context} from "@/lib/utils/fnb-invoice-context";
export function FnbInvoiceContext({value,compact=false}:{value:Context;compact?:boolean}) {
 return <div className="min-w-0 space-y-1 text-sm text-foreground">
   <p className="flex flex-wrap gap-x-2 font-medium"><span>{value.tableName || (value.tableNumber ? `Bàn ${value.tableNumber}` : "Không có bàn")}</span>{value.areaName && <span>· {value.areaName}</span>}</p>
   <div className={`flex flex-wrap gap-x-4 gap-y-1 ${compact ? "text-xs" : "text-sm"}`}><span title="Thời điểm hệ thống ghi nhận mở bill">Giờ khách vào: <time dateTime={value.openedAt}>{value.openedAt ? formatDate(value.openedAt) : "Chưa ghi nhận"}</time></span><span title="Thời điểm xác nhận thanh toán">Giờ khách về: <time dateTime={value.paidAt}>{value.paidAt ? formatDate(value.paidAt) : "Chưa ghi nhận"}</time></span></div>
   {value.posNote && <p title={value.posNote} className={compact ? "line-clamp-2 break-words font-medium" : "whitespace-pre-wrap break-words font-medium"}>Ghi chú: {value.posNote}</p>}
 </div>;
}
