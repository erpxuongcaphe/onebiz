"use client";
import {memo,useCallback,useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NumericInput} from '@/components/ui/numeric-input';
import {formatCurrency,formatStockQuantity} from '@/lib/format';
import {useAuth,useToast} from '@/lib/contexts';
import {useUnsavedWork} from '@/lib/hooks/use-unsaved-work';
import {getInventoryCheckChangeSource,previewInventoryCheckChange,applyInventoryCheckChange,InventoryCheckChangeError,
  type InventoryCheckChangeSource,type InventoryCheckChangeInput,type InventoryCheckChangePreview} from '@/lib/services/supabase/inventory-check-change';

interface Props {target:{id:string;branchId?:string;action:'edit'|'cancel'}|null; onClose:()=>void; onSuccess:()=>void|Promise<void>}
const CountRow=memo(function CountRow({item,value,editing,onChange}:{item:InventoryCheckChangeSource['items'][number];value:number;editing:boolean;onChange:(id:string,value:number|null)=>void}){
  return <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0 md:min-w-[650px] md:grid-cols-[minmax(180px,1fr)_60px_120px_140px] md:items-center md:gap-3">
    <div className="row-span-2 min-w-0 self-center md:row-span-1"><p className="break-words text-[14px] font-medium md:text-sm">{item.name}</p><p className="break-words text-xs text-muted-foreground">{item.code}<span className="md:hidden"> · {item.unit}</span></p></div>
    <span className="hidden text-xs md:block">{item.unit}</span><span className="text-right tabular-nums"><span className="mr-2 text-xs text-muted-foreground md:hidden">Đã lưu</span>{formatStockQuantity(item.actualStock)}</span>
    {editing?<NumericInput aria-label={`Thực đếm sửa lại ${item.name}`} value={Number.isFinite(value)?value:undefined} min={0} decimals={4}
      onChange={next=>onChange(item.productId,next)} className="h-[40px] text-right text-[16px] xl:h-9 xl:text-sm [@media(any-pointer:coarse)]:min-h-[40px] [@media(any-pointer:coarse)]:text-[16px]"/>:<span className="text-right text-xs text-muted-foreground">Hoàn tác chênh lệch phiếu</span>}
  </div>;
});
export function ChangeInventoryCheckDialog({target,onClose,onSuccess}:Props){
  const {activeBranchId}=useAuth(); const {toast}=useToast();
  const [source,setSource]=useState<InventoryCheckChangeSource|null>(null);
  const [counts,setCounts]=useState<Record<string,number>>({}); const [note,setNote]=useState(''); const [reason,setReason]=useState('');
  const [preview,setPreview]=useState<InventoryCheckChangePreview|null>(null); const [prepared,setPrepared]=useState<InventoryCheckChangeInput|null>(null);
  const [loading,setLoading]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const lock=useRef(false);
  const [uncertain,setUncertain]=useState(false); const [reloadKey,setReloadKey]=useState(0); const body=useRef<HTMLDivElement>(null);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  useUnsavedWork(()=>lock.current);
  useEffect(()=>{if(preview)reviewHeading.current?.focus({preventScroll:true});},[preview]);
  useEffect(()=>{
    let stale=false;setSource(null);setPreview(null);setPrepared(null);setReason('');setError('');setUncertain(false);
    if(!target)return;
    setLoading(true);
    getInventoryCheckChangeSource(target.id).then(data=>{if(stale)return;setSource(data);setNote(data.note);
      setCounts(Object.fromEntries(data.items.map(i=>[i.productId,Number(i.actualStock)])));
    }).catch(err=>{if(!stale)setError(err instanceof Error?err.message:'Không tải được phiếu.');}).finally(()=>{if(!stale)setLoading(false);});
    return()=>{stale=true;};
  },[target,reloadKey]);
  const validBranch=!!source&&source.branchId===activeBranchId;
  const invalidCount=source?.items.some(i=>!Number.isFinite(counts[i.productId])||counts[i.productId]<0);
  const hasChanges=!!source&&target?.action==='edit'&&(note!==source.note||source.items.some(i=>counts[i.productId]!==Number(i.actualStock)));
  const dirty=hasChanges||!!reason.trim()||uncertain;
  const canInspect=!!source&&validBranch&&!invalidCount&&reason.trim().length>=3&&(target?.action==='cancel'||hasChanges);
  const invalidate=useCallback(()=>{setPreview(null);setPrepared(null);setError('');},[]);
  const updateCount=useCallback((id:string,value:number|null)=>{invalidate();setCounts(prev=>({...prev,[id]:value??NaN}));},[invalidate]);
  const resetScroll=()=>{if(body.current)body.current.scrollTop=0;};
  async function inspect(){
    if(!source||!target||!canInspect||lock.current||uncertain)return;
    lock.current=true;setBusy(true);setError('');
    const input:InventoryCheckChangeInput={checkId:source.id,action:target.action,
      items:target.action==='edit'?source.items.map(i=>({productId:i.productId,actualStock:counts[i.productId]})):[],
      note,reason:reason.trim(),sourceVersion:source.version,requestId:crypto.randomUUID()};
    try{const result=await previewInventoryCheckChange(input);setPrepared(input);setPreview(result);resetScroll();}
    catch(err){setError(err instanceof Error?err.message:'Không xem trước được.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function confirm(){
    if(!preview?.canApply||!prepared||!validBranch||lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await applyInventoryCheckChange(prepared,preview.token);}
    catch(err){
      const unknown=!(err instanceof InventoryCheckChangeError)||err.outcomeUnknown;
      setUncertain(unknown);
      if(!unknown){setPreview(null);setPrepared(null);resetScroll();}
      setError(err instanceof Error?err.message:'Chưa nhận được kết quả. Kiểm tra lại bằng cùng yêu cầu.');
      lock.current=false;setBusy(false);return;
    }
    lock.current=false;setBusy(false);setUncertain(false);
    toast({title:prepared.action==='cancel'?'Đã hủy phiếu và hoàn chênh lệch':'Đã điều chỉnh phiếu kiểm kho',variant:'success'});
    onClose();
    try{await onSuccess();}catch{toast({title:'Đã lưu phiếu; danh sách chưa tải lại được',description:'Tải lại danh sách khi mạng ổn định. Không cần gửi lại điều chỉnh.',variant:'info'});}
  }
  return <Dialog open={!!target} trackFormChanges={false} hasUnsavedChanges={dirty} protectUnsavedChanges={!busy} onOpenChange={open=>{if(!open&&!lock.current)onClose();}}>
    <DialogContent showCloseButton={!busy} className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
      <DialogHeader className="shrink-0 border-b px-4 py-3">
        <DialogTitle className="text-base">{target?.action==='cancel'?'Hủy':'Sửa'} phiếu kiểm kho {source?.code}</DialogTitle>
        <DialogDescription className="text-xs">{loading?'Đang tải thông tin phiếu…':source?.status==='balanced'?'Chỉ điều chỉnh phần chênh trên tồn hiện tại. Giữ các giao dịch phát sinh sau phiếu.':source?'Phiếu chưa cân bằng: sửa số đếm hoặc hủy, chưa tác động kho.':'Chưa tải được thông tin phiếu.'}</DialogDescription>
      </DialogHeader>
      <div ref={body} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm" inert={busy}>
        {loading&&<p role="status">Đang tải phiếu…</p>}
        {source&&!validBranch&&<p role="alert" className="text-destructive">Chọn đúng chi nhánh của phiếu trước khi thực hiện.</p>}
        {source&&!preview&&<>
          <div className="overflow-x-auto rounded-md border">
            <div className="hidden min-w-[650px] grid-cols-[minmax(180px,1fr)_60px_120px_140px] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-semibold md:grid"><span>Mặt hàng</span><span>ĐVT tồn</span><span className="text-right">Thực đếm đã lưu</span><span className="text-right">Thực đếm sửa lại</span></div>
            {source.items.map(i=><CountRow key={i.productId} item={i} value={counts[i.productId]} editing={target?.action==='edit'} onChange={updateCount}/>)}
          </div>
          {target?.action==='edit'&&<label className="block text-xs font-medium">Ghi chú phiếu<Textarea value={note} maxLength={5000} onChange={e=>{invalidate();setNote(e.target.value);}} className="mt-1 min-h-16 text-[16px] xl:text-sm [@media(any-pointer:coarse)]:text-[16px]"/></label>}
          <label className="block text-xs font-medium">Lý do {target?.action==='cancel'?'hủy':'điều chỉnh'} <span className="text-destructive">*</span><Input value={reason} maxLength={1000} placeholder="Nhập lý do, tối thiểu 3 ký tự" onChange={e=>{invalidate();setReason(e.target.value);}} className="mt-1 h-[40px] text-[16px] xl:h-9 xl:text-sm [@media(any-pointer:coarse)]:min-h-[40px] [@media(any-pointer:coarse)]:text-[16px]"/></label>
          {target?.action==='edit'&&!hasChanges&&<p className="text-xs text-muted-foreground">Sửa số thực đếm hoặc ghi chú để xem trước điều chỉnh.</p>}
        </>}
        {preview&&<section className="space-y-2" aria-label="Xem trước thay đổi kho">
          <h3 ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold outline-none">Kiểm tra trước khi {target?.action==='cancel'?'hủy phiếu':'lưu điều chỉnh'}</h3>
          <div className="rounded-md border bg-muted/20 p-3 text-xs"><b>Lý do:</b> <span className="break-words">{prepared?.reason}</span>
            {source&&prepared?.note!==source.note&&<p className="mt-1 break-words"><b>Ghi chú mới:</b> {prepared?.note||'(Bỏ ghi chú)'}</p>}
          </div>
          {preview.items.filter(i=>i.stockDelta!==0||i.actualBefore!==i.actualAfter||i.blocked).map(i=><div key={i.productId} className="rounded-md border px-3 py-2 text-xs">
            <p className="break-words font-semibold text-foreground">{i.name} <span className="font-normal text-muted-foreground">· {i.code}</span></p>
            {i.actualBefore!==i.actualAfter&&<p className="mt-1 tabular-nums">Thực đếm: {formatStockQuantity(i.actualBefore)} → <b>{formatStockQuantity(i.actualAfter)}</b> {i.unit}</p>}
            <p className="mt-1 tabular-nums">Tồn hiện tại → sau điều chỉnh: {formatStockQuantity(i.stockBefore)} → <b>{formatStockQuantity(i.stockAfter)}</b> {i.unit} <b>({i.stockDelta>0?'+':''}{formatStockQuantity(i.stockDelta)})</b></p>
            {i.blocked&&<p className="mt-1 text-destructive">{i.blocked==='INSUFFICIENT_CURRENT_STOCK'?'Không đủ tồn hiện tại để thu hồi. Cần đối soát trước khi xác nhận.':'Chưa đủ căn cứ giá vốn chi nhánh. Cần đối soát trước khi xác nhận.'}</p>}
          </div>)}
          {preview.items.every(i=>i.stockDelta===0)&&<p className="text-xs">Không phát sinh thay đổi số lượng kho.</p>}
          {preview.costVisible&&<p className="border-t pt-2 text-xs">Giá trị điều chỉnh theo giá vốn bình quân: <b>{formatCurrency(preview.costDelta??0)}</b>. Không tính lại hóa đơn đã bán.</p>}
        </section>}
        {uncertain&&<p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">Chưa xác định được kết quả lưu. Bấm “Kiểm tra lại kết quả” để gửi lại cùng mã yêu cầu; hệ thống chỉ ghi một lần.</p>}
        {error&&<p role="alert" className="rounded-md border border-destructive/30 p-2 text-sm text-destructive">{error}</p>}
        {!source&&!loading&&target&&<Button variant="outline" onClick={()=>setReloadKey(k=>k+1)}>Thử tải lại phiếu</Button>}
      </div>
      <DialogFooter className="m-0 shrink-0 border-t px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-between">
        <Button variant="outline" className="min-h-[40px] xl:min-h-0 [@media(any-pointer:coarse)]:min-h-[40px]" disabled={busy} onClick={onClose}>Đóng</Button>
        {preview?<div className="flex flex-wrap justify-end gap-2">
          {!uncertain&&<Button variant="outline" className="min-h-[40px] xl:min-h-0 [@media(any-pointer:coarse)]:min-h-[40px]" disabled={busy} onClick={()=>{invalidate();resetScroll();}}>Sửa lại</Button>}
          <Button className="min-h-[40px] xl:min-h-0 [@media(any-pointer:coarse)]:min-h-[40px]" variant={target?.action==='cancel'?'destructive':'default'} disabled={busy||!validBranch||!preview.canApply} onClick={confirm}>{busy?'Đang xử lý…':uncertain?'Kiểm tra lại kết quả':target?.action==='cancel'?'Hủy & hoàn kho':'Lưu điều chỉnh'}</Button>
        </div>:<Button className="min-h-[40px] xl:min-h-0 [@media(any-pointer:coarse)]:min-h-[40px]" disabled={loading||busy||!canInspect} onClick={inspect}>{busy?'Đang tính…':'Xem trước chênh lệch'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
