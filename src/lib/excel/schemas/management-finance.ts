import type {ExcelSchema} from '../types';
import {financeMoneyCents,isFinanceReportDate} from '@/lib/reports/finance-report-input';

export interface FinanceImportRow {
  sourceSystem:string; sourceCode:string; operation:'record'|'settle'|'invoice'|'purchase_order';
  categoryCode?:string; referenceCode?:string; counterparty?:string; amount:number;
  businessDate?:string; recognitionDate?:string; paymentAmount?:number;
  transactionDate?:string; occurredAt?:string; paymentMethod?:'cash'|'bank_transfer'|'card';
  direction?:'receipt'|'payment'; note?:string;
}

export const financeImportSchema:ExcelSchema<FinanceImportRow> = {
  name:'Thu nhập, chi phí và thanh toán',fileName:'OneBiz-Nhap-Tai-Chinh',
  columns:[
    {key:'sourceSystem',header:'Nguồn dữ liệu',type:'string',required:true,maxLength:64,example:'SO-NGOAI'},
    {key:'sourceCode',header:'Mã nguồn',type:'string',required:true,maxLength:100,example:'CHI-2026-001'},
    {key:'operation',header:'Nghiệp vụ',type:'enum',required:true,enumValues:['record','settle','invoice','purchase_order'],enumLabels:{record:'Ghi nhận mới',settle:'Thanh toán khoản ghi nhận',invoice:'Thu nợ hóa đơn',purchase_order:'Chi trả phiếu nhập'},example:'record'},
    {key:'categoryCode',header:'Mã khoản mục',type:'string',example:'CP-VH-DIEN'},
    {key:'referenceCode',header:'Mã chứng từ gốc',type:'string'},
    {key:'counterparty',header:'Đối tượng',type:'string',maxLength:200,example:'Điện lực'},
    {key:'amount',header:'Số tiền',type:'number',required:true,min:0.01,example:1000000},
    {key:'businessDate',header:'Ngày phát sinh',type:'string',example:'2026-10-01'},
    {key:'recognitionDate',header:'Ngày ghi nhận',type:'string',example:'2026-10-01'},
    {key:'paymentAmount',header:'Thanh toán ngay',type:'number',min:0,example:0},
    {key:'transactionDate',header:'Ngày chứng từ tiền',type:'string'},
    {key:'occurredAt',header:'Thực thu chi lúc',type:'string',description:'Thời gian ISO có múi giờ, ví dụ 2026-10-01T09:30:00+07:00'},
    {key:'paymentMethod',header:'Phương thức',type:'enum',enumValues:['cash','bank_transfer','card'],enumLabels:{cash:'Tiền mặt',bank_transfer:'Chuyển khoản',card:'Thẻ'}},
    {key:'direction',header:'Thu hoặc chi',type:'enum',enumValues:['receipt','payment'],enumLabels:{receipt:'Thu',payment:'Chi'}},
    {key:'note',header:'Ghi chú',type:'string',maxLength:500},
  ],
  validateRow(row,index,rows) {
    try {
      if (!row.sourceSystem?.trim() || !row.sourceCode?.trim()) return 'Nguồn dữ liệu và mã nguồn là bắt buộc.';
      if (rows.some((other,i)=>i!==index && other.sourceSystem.trim().toUpperCase()===row.sourceSystem.trim().toUpperCase() && other.sourceCode.trim()===row.sourceCode.trim())) return 'Nguồn dữ liệu và mã nguồn bị trùng trong file.';
      if (financeMoneyCents(row.amount)<=0) return 'Số tiền phải lớn hơn 0.';
      if (row.operation==='record') {
        if (!row.categoryCode?.trim() || !row.counterparty?.trim() || !isFinanceReportDate(row.businessDate??'') || !isFinanceReportDate(row.recognitionDate??'')) return 'Ghi nhận mới cần khoản mục, đối tượng, ngày phát sinh và ngày ghi nhận hợp lệ (YYYY-MM-DD).';
        if (financeMoneyCents(row.paymentAmount??0)>financeMoneyCents(row.amount)) return 'Thanh toán ngay vượt tổng khoản.';
      } else if (!row.referenceCode?.trim()) return 'Chọn mã chứng từ gốc để thanh toán; không tạo khoản ghi nhận mới.';
      if (row.operation!=='record' || (row.paymentAmount??0)>0) {
        if (!isFinanceReportDate(row.transactionDate??'') || !row.paymentMethod || !row.occurredAt
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.occurredAt) || !isFinanceReportDate(row.occurredAt.slice(0,10)) || !Number.isFinite(Date.parse(row.occurredAt))) return 'Thanh toán cần ngày chứng từ, giờ thực thu/chi có múi giờ và phương thức.';
      }
      return null;
    } catch(e) {return e instanceof Error ? e.message : 'Dòng tài chính không hợp lệ.';}
  },
};
