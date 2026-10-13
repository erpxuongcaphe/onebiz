"use client";

import {useEffect,useState} from 'react';
import {useAuth} from '@/lib/contexts';
import {SearchableSelect} from '@/components/ui/searchable-select';
import {ImportExcelDialog} from './import-excel-dialog';
import {financeImportSchema} from '@/lib/excel/schemas/management-finance';
import {getCashPerformers} from '@/lib/services/supabase/cash-timing';
import {commitFinanceImport,prepareFinanceImport,previewFinanceImport,type FinanceImportRequest} from '@/lib/services/supabase/finance-import';
import type {FinanceCategory} from '@/lib/services/supabase/management-finance';

interface FinanceImportDialogProps {open:boolean;onOpenChange:(open:boolean)=>void;categories:FinanceCategory[];onFinished:()=>void}
export function FinanceImportDialog(props:FinanceImportDialogProps) {
  const {activeBranchId}=useAuth();
  return <FinanceImportSession key={`${activeBranchId}:${props.open}`} {...props}/>;
}
function FinanceImportSession({open,onOpenChange,categories,onFinished}:FinanceImportDialogProps) {
  const {activeBranchId,branches,hasPermission}=useAuth();
  const [performers,setPerformers]=useState<Array<{id:string;name:string}>>([]);
  const [performer,setPerformer]=useState('');
  const [error,setError]=useState('');
  const [prepared,setPrepared]=useState<FinanceImportRequest[]>([]);
  const [preview,setPreview]=useState<Array<{sourceCode:string;state:string}>>([]);
  useEffect(()=>{
    if(!open || !activeBranchId) return;
    let active=true;
    getCashPerformers(activeBranchId).then(rows=>{if(active)setPerformers(rows);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được người thu/chi.');});
    return ()=>{active=false;};
  },[activeBranchId,open]);
  if(!hasPermission('finance.create_transaction') || !hasPermission('finance.view_cash_book')) return null;
  return <ImportExcelDialog open={open} onOpenChange={onOpenChange} title="Nhập tài chính từ file" schema={financeImportSchema} retryOnFailure
    instructions={<ul className="list-disc pl-4 space-y-1">
      <li>Dùng file mẫu, chọn đúng chi nhánh và người thực hiện nếu có thu/chi.</li>
      <li>Ngày nghiệp vụ và ngày ghi nhận thu nhập/chi phí tách riêng ngày thu/chi tiền thực tế.</li>
      <li>Mỗi giao dịch có hệ thống nguồn và mã nguồn duy nhất. Nhập lại cùng nội dung không tạo thêm phiếu; cùng mã nhưng khác nội dung sẽ bị chặn, không ghi đè.</li>
      <li>Thu tiền hóa đơn hoặc thanh toán phiếu nhập phải chọn đúng chứng từ nguồn, không ghi thêm doanh thu/chi phí lần nữa.</li>
      <li>Xem trước và xác nhận mới ghi dữ liệu. Nếu mất kết nối, kiểm tra trạng thái hoặc nhập lại đúng file với cùng ngữ cảnh và mã nguồn, không đổi mã để gửi lại.</li>
    </ul>}
    confirmDisabled={!prepared.length || preview.some(row=>row.state==='conflict')}
    uploadContent={<div className="grid gap-3 text-sm"><p>Chi nhánh: <strong>{branches.find(b=>b.id===activeBranchId)?.name??'Chưa chọn'}</strong></p>
      <label className="grid gap-1">Người thực hiện thu/chi<SearchableSelect value={performer} onValueChange={value=>{setPerformer(value);setPrepared([]);setPreview([]);}} options={performers.map(p=>({value:p.id,label:p.name}))} placeholder="Chọn người thu/chi"/></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}</div>}
    preparePreview={async rows=>{
      setPrepared([]);setPreview([]);
      const requests=prepareFinanceImport(rows,activeBranchId??'',performer,categories);
      const result=await previewFinanceImport(requests);
      setPreview(result);
      if(result.some(row=>row.state==='conflict')) throw new Error(`Mã nguồn đã nhập nhưng nội dung khác: ${result.filter(row=>row.state==='conflict').map(row=>row.sourceCode).join(', ')}. Không tạo phiếu thay thế.`);
      setPrepared(requests);
    }}
    previewContent={<p className="text-sm" role="status">Nguồn mới: {preview.filter(r=>r.state==='new').length} · Đã nhập, không tạo lại: {preview.filter(r=>r.state==='imported').length}</p>}
    onCommit={async()=>{if(!prepared.length) throw new Error('Xem trước lại file và ngữ cảnh trước khi nhập.');return commitFinanceImport(prepared);}}
    onFinished={onFinished}/>;
}
