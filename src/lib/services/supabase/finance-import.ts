import {getClient} from './base';
import type {FinanceCategory,FinanceDocumentInput,FinancePayment} from './management-finance';
import {financeImportSchema,type FinanceImportRow} from '@/lib/excel/schemas/management-finance';

export interface FinanceImportRequest {
  sourceSystem:string;sourceCode:string;branchId:string;operation:FinanceImportRow['operation'];
  referenceCode?:string;payload:FinanceDocumentInput|FinancePayment;
}
export function prepareFinanceImport(rows:FinanceImportRow[],branchId:string,performedBy:string,categories:FinanceCategory[]):FinanceImportRequest[] {
  if (!branchId || !rows.length || rows.length>200) throw new Error('Chọn một chi nhánh và tối đa 200 dòng mỗi lần nhập.');
  return rows.map((row,index)=>{
    const error=financeImportSchema.validateRow?.(row,index,rows);
    if(error) throw new Error(`Dòng ${index+2}: ${error}`);
    const paid=row.operation==='record' ? row.paymentAmount??0 : row.amount;
    if(paid>0 && !performedBy) throw new Error('Chọn người thực hiện thu/chi.');
    const payment:FinancePayment={branchId,performedBy,amount:paid,paymentMethod:row.paymentMethod??'cash',transactionDate:row.transactionDate??'',occurredAt:row.occurredAt??'',timeReason:`Nhập nguồn ${row.sourceSystem.trim()} / ${row.sourceCode.trim()}`,note:row.note?.trim(),direction:row.direction};
    let payload:FinanceDocumentInput|FinancePayment=payment;
    if(row.operation==='record') {
      const category=categories.find(c=>c.code===row.categoryCode?.trim() && !c.is_group);
      if(!category) throw new Error(`Dòng ${index+2}: Mã khoản mục chi tiết chưa có trong danh mục.`);
      if(category.kind==='non_pnl' && paid>0 && !row.direction) throw new Error(`Dòng ${index+2}: Khoản ngoài kết quả kinh doanh cần chọn Thu hoặc Chi.`);
      payload={categoryId:category.id,businessDate:row.businessDate!,amount:row.amount,counterparty:row.counterparty!.trim(),note:row.note?.trim(),allocations:[{branchId,recognitionDate:row.recognitionDate!,amount:row.amount}],...(paid>0?{payment}:{})};
    }
    return {sourceSystem:row.sourceSystem.trim(),sourceCode:row.sourceCode.trim(),branchId,operation:row.operation,...(row.operation!=='record'?{referenceCode:row.referenceCode!.trim()}:{}),payload};
  });
}

export async function previewFinanceImport(rows:FinanceImportRequest[]):Promise<Array<{sourceCode:string;state:'new'|'imported'|'conflict'}>> {
  const {data,error}=await getClient().rpc('preview_management_finance_import' as never,{p_rows:rows} as never);
  if(error) throw new Error(error.message);
  const result:unknown=data;
  if(!Array.isArray(result) || result.length!==rows.length) throw new Error('Chưa kiểm tra đủ nguồn nhập.');
  return result as Array<{sourceCode:string;state:'new'|'imported'|'conflict'}>;
}
export async function commitFinanceImport(rows:FinanceImportRequest[]) {
  const {data,error}=await getClient().rpc('commit_management_finance_import' as never,{p_rows:rows} as never);
  if(error) throw new Error(error.message);
  const result:unknown=data;
  if(!Array.isArray(result) || result.length!==rows.length) throw new Error('Chưa xác nhận được kết quả. Nhập lại cùng file và ngữ cảnh, không đổi mã nguồn.');
  return {successCount:rows.length,failureCount:0,errors:[]};
}
