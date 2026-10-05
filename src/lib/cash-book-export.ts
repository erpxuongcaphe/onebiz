import {formatCashBookDate,formatCashTime} from "./cash-time";

/** Same chronology for filtered CSV and selected-row Excel downloads. */
export const cashBookExportColumns = [
  {header:"Mã phiếu",key:"code",width:15},
  {header:"Loại phiếu",key:"type",width:12,format:(v:string)=>v === "receipt" ? "Thu" : v === "payment" ? "Chi" : v},
  {header:"Ngày hạch toán",key:"date",width:18,format:(v:string)=>formatCashBookDate(v)},
  {header:"Thực thu/chi lúc",key:"occurredAt",width:24,format:(v:string|null|undefined)=>formatCashTime(v)},
  {header:"Tạo trên hệ thống lúc",key:"createdAt",width:24,format:(v:string|null|undefined)=>formatCashTime(v)},
  {header:"Lý do ngày giờ",key:"timeReason",width:30},
  {header:"Loại thu chi",key:"category",width:20},
  {header:"Người nộp/nhận",key:"counterparty",width:22},
  {header:"Chứng từ gốc",key:"referenceCode",width:16},
  {header:"Giá trị",key:"amount",width:15},
  {header:"Ghi chú",key:"note",width:30},
];
