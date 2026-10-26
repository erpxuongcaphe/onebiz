"use client";
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NumericInput} from '@/components/ui/numeric-input';
import {formatCurrency,formatStockQuantity} from '@/lib/format';
import {useAuth,useToast} from '@/lib/contexts';
import {getInventoryCheckChangeSource,previewInventoryCheckChange,applyInventoryCheckChange,
  type InventoryCheckChangeSource,type InventoryCheckChangeInput,type InventoryCheckChangePreview} from '@/lib/services/supabase/inventory-check-change';

interface Props {target:{id:string;branchId?:string;action:'edit'|'cancel'}|null; onClose:()=>void; onSuccess:()=>void|Promise<void>}
export function ChangeInventoryCheckDialog({target,onClose,onSuccess}:Props){
  const {activeBranchId}=useAuth(); const {toast}=useToast();
  const [source,setSource]=useState<InventoryCheckChangeSource|null>(null);
  const [counts,setCounts]=useState<Record<string,number>>({}); const [note,setNote]=useState(''); const [reason,setReason]=useState('');
  const [preview,setPreview]=useState<InventoryCheckChangePreview|null>(null); const [prepared,setPrepared]=useState<InventoryCheckChangeInput|null>(null);
  const [loading,setLoading]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const lock=useRef(false);
  useEffect(()=>{
    let stale=false;setSource(null);setPreview(null);setPrepared(null);setReason('');setError('');
    if(!target)return;
    setLoading(true);
    getInventoryCheckChangeSource(target.id).then(data=>{if(stale)return;setSource(data);setNote(data.note);
      setCounts(Object.fromEntries(data.items.map(i=>[i.productId,Number(i.actualStock)])));
    }).catch(err=>{if(!stale)setError(err instanceof Error?err.message:'Không tải được phiếu.');}).finally(()=>{if(!stale)setLoading(false);});
    return()=>{stale=true;};
  },[target]);
  const validBranch=!!source&&source.branchId===activeBranchId;
  const invalidCount=source?.items.some(i=>!Number.isFinite(counts[i.productId])||counts[i.productId]<0);
  const invalidate=()=>{setPreview(null);setPrepared(null);setError('');};
  async function inspect(){
    if(!source||!target||!validBranch||lock.current||reason.trim().length<3||invalidCount)return;
    lock.current=true;setBusy(true);setError('');
    const input:InventoryCheckChangeInput={checkId:source.id,action:target.action,
      items:target.action==='edit'?source.items.map(i=>({productId:i.productId,actualStock:counts[i.productId]})):[],
      note,reason:reason.trim(),sourceVersion:source.version,requestId:crypto.randomUUID()};
    try{const result=await previewInventoryCheckChange(input);setPrepared(input);setPreview(result);}
    catch(err){setError(err instanceof Error?err.message:'Không xem trước được.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function confirm(){
    if(!preview?.canApply||!prepared||!validBranch||lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await applyInventoryCheckChange(prepared,preview.token);toast({title:prepared.action==='cancel'?'Đã hủy phiếu và hoàn chênh lệch':'Đã điều chỉnh phiếu kiểm kho',variant:'success'});
      onClose();await onSuccess();
    }catch(err){setError(err instanceof Error?err.message:'Chưa xác nhận được. Bấm lại để kiểm tra cùng yêu cầu.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open={!!target} onOpenChange={open=>{if(!open&&!lock.current)onClose();}}>
    <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
        <DialogTitle className="text-base">{target?.action==='cancel'?'Hủy':'Sửa'} phiếu kiểm kho {source?.code}</DialogTitle>
        <DialogDescription className="text-xs">{source?.status==='balanced'?'Chỉ điều chỉnh phần chênh trên tồn hiện tại. Giữ các giao dịch phát sinh sau phiếu.':'Phiếu chưa cân bằng: sửa số đếm hoặc hủy, chưa tác động kho.'}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" inert={busy}>
        {loading&&<p role="status">Đang tải phiếu…</p>}
        {source&&!validBranch&&<p role="alert" className="text-destructive">Chọn đúng chi nhánh của phiếu trước khi thực hiện.</p>}
        {source&&<>
          <div className="overflow-x-auto rounded-md border">
            <div className="hidden min-w-[650px] grid-cols-[minmax(180px,1fr)_60px_120px_140px] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-semibold md:grid"><span>Mặt hàng</span><span>ĐVT tồn</span><span className="text-right">Thực đếm đã lưu</span><span className="text-right">Thực đếm sửa lại</span></div>
            {source.items.map(i=><div key={i.productId} className="grid grid-cols-[minmax(0,1fr)_120px] gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0 md:min-w-[650px] md:grid-cols-[minmax(180px,1fr)_60px_120px_140px] md:items-center md:gap-3">
              <div className="row-span-2 min-w-0 self-center md:row-span-1"><p className="font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{i.code}<span className="md:hidden"> · {i.unit}</span></p></div>
              <span className="hidden text-xs md:block">{i.unit}</span><span className="text-right tabular-nums"><span className="mr-2 text-xs text-muted-foreground md:hidden">Đã lưu</span>{formatStockQuantity(i.actualStock)}</span>
              {target?.action==='edit'?<NumericInput aria-label={`Thực đếm sửa lại ${i.name}`} value={Number.isFinite(counts[i.productId])?counts[i.productId]:undefined} min={0} decimals={4} onChange={value=>{invalidate();setCounts(prev=>({...prev,[i.productId]:value??NaN}));}} className="h-9 text-right"/>:<span className="text-right text-xs text-muted-foreground">Hoàn tác chênh lệch phiếu</span>}
            </div>)}
          </div>
          {target?.action==='edit'&&<label className="block text-xs font-medium">Ghi chú phiếu<Textarea value={note} maxLength={5000} onChange={e=>{invalidate();setNote(e.target.value);}} className="mt-1 min-h-16 text-sm"/></label>}
          <label className="block text-xs font-medium">Lý do {target?.action==='cancel'?'hủy':'điều chỉnh'} <span className="text-destructive">*</span><Input value={reason} maxLength={1000} placeholder="Nhập lý do, tối thiểu 3 ký tự" onChange={e=>{invalidate();setReason(e.target.value);}} className="mt-1 h-9 text-sm"/></label>
        </>}
        {preview&&<section className="space-y-2 rounded-md border bg-muted/20 p-3" aria-label="Xem trước thay đổi kho">
          <p className="text-sm font-semibold">Xem trước kho hiện tại → sau điều chỉnh</p>
          {preview.items.filter(i=>i.stockDelta!==0||i.blocked).map(i=><div key={i.productId} className="border-t py-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><b>{i.name}</b><span className="tabular-nums">{formatStockQuantity(i.stockBefore)} → <b>{formatStockQuantity(i.stockAfter)}</b> {i.unit} · {i.stockDelta>0?'+':''}{formatStockQuantity(i.stockDelta)}</span></div>
            {i.blocked&&<p className="mt-1 text-destructive">{i.blocked==='INSUFFICIENT_CURRENT_STOCK'?'Không đủ tồn hiện tại để thu hồi. Cần đối soát trước khi xác nhận.':'Chưa đủ căn cứ giá vốn chi nhánh. Cần đối soát trước khi xác nhận.'}</p>}
          </div>)}
          {preview.items.every(i=>i.stockDelta===0)&&<p className="text-xs">Không phát sinh thay đổi số lượng kho.</p>}
          {preview.costVisible&&<p className="border-t pt-2 text-xs">Giá trị điều chỉnh theo giá vốn bình quân: <b>{formatCurrency(preview.costDelta??0)}</b>. Không tính lại hóa đơn đã bán.</p>}
        </section>}
        {error&&<p role="alert" className="rounded-md border border-destructive/30 p-2 text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="m-0 shrink-0 border-t px-3 py-3 sm:justify-between">
        <Button variant="outline" disabled={busy} onClick={onClose}>Đóng</Button>
        {preview?<div className="flex gap-2"><Button variant="outline" disabled={busy||!validBranch} onClick={inspect}>Xem trước lại</Button><Button variant={target?.action==='cancel'?'destructive':'default'} disabled={busy||!validBranch||!preview.canApply} onClick={confirm}>{busy?'Đang xử lý…':target?.action==='cancel'?'Hủy & hoàn kho':'Lưu điều chỉnh'}</Button></div>:
          <Button disabled={loading||busy||!validBranch||reason.trim().length<3||invalidCount} onClick={inspect}>{busy?'Đang tính…':'Xem trước chênh lệch'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
