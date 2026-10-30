"use client";

import {useEffect,useMemo,useState,type ReactNode} from 'react';
import type {ColumnDef,SortingState} from '@tanstack/react-table';
import {DataTable} from '@/components/shared/data-table';
import {FilterChips,type ListFilterChip} from '@/components/shared/filter-chips';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Icon} from '@/components/ui/icon';
import {formatDate,formatNumber} from '@/lib/format';
import {exportToExcel} from '@/lib/utils/export';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';
import {EMPTY_RECEIVING_FILTERS,RECEIVING_STATUS_LABELS,filterReceivingOrders,receivingMetrics,receivingSortValue,receivingStatus,type ReceivingListFilters} from '@/lib/internal-receiving-list';
import {internalReceivingViewSchema,receivingPresetRange} from '@/lib/receiving-view-state';
import {useReceivingVietnamDay,useReceivingViewMemory} from '@/lib/hooks/use-receiving-view-memory';
import {STANDARD_LIST_PRESETS_WITH_ALL} from '@/lib/utils/list-date-preset-range';
import type {DatePresetValue} from '@/components/shared/filter-sidebar';

interface Props {
  orders:InternalReceivingOrder[];loading:boolean;busy:boolean;selected?:string;canExport:boolean;
  onOpen:(id:string)=>void;onClose:()=>void;detail:ReactNode;
  memoryKey?:string;initialPreset?:'today'|'all';
}
export function InternalReceivingOrderList({orders,loading,busy,selected,canExport,onOpen,onClose,detail,memoryKey,initialPreset='today'}:Props) {
  const [filters,setFilters]=useState<ReceivingListFilters & {preset:DatePresetValue}>({...EMPTY_RECEIVING_FILTERS,preset:initialPreset});
  const [sorting,setSorting]=useState<SortingState>([{id:'createdAt',desc:true}]);
  const [page,setPage]=useState(0),[size,setSize]=useState(25);
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const [full,setFull]=useState(false);
  const day=useReceivingVietnamDay();
  const initial=useMemo(()=>({filters:{...EMPTY_RECEIVING_FILTERS,preset:initialPreset},sorting:[{id:'createdAt',desc:true}],page:0,size:25,full:false}),[initialPreset]);
  const memory=useReceivingViewMemory({key:memoryKey,snapshot:{filters,sorting,page,size,full},initial,schema:internalReceivingViewSchema,loading,restore:value=>{setFilters(initialPreset==='all'?{...EMPTY_RECEIVING_FILTERS,preset:'all'}:value.filters);setSorting(value.sorting);setPage(value.page);setSize(value.size);setFull(value.full);}});
  const effectiveFilters=useMemo(()=>{
    const range=receivingPresetRange(filters.preset,day);
    return filters.preset==='custom'?filters:{...filters,from:range.from??'',to:range.to??''};
  },[filters,day]);
  const sources=useMemo(()=>[...new Set(orders.map(o=>o.fromBranch))].sort(),[orders]);
  const receivers=useMemo(()=>[...new Set(orders.flatMap(o=>o.receipts.map(r=>r.createdBy)).filter(Boolean))].sort(),[orders]);
  const filtered=useMemo(()=>filterReceivingOrders(orders,effectiveFilters).sort((a,b)=>{
    for(const sort of sorting){const av=receivingSortValue(a,sort.id),bv=receivingSortValue(b,sort.id);
      const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'vi',{numeric:true});
      if(result) return sort.desc?-result:result;}
    return a.id.localeCompare(b.id);
  }),[orders,effectiveFilters,sorting]);
  const rangeError=effectiveFilters.from && effectiveFilters.to && effectiveFilters.from>effectiveFilters.to ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' : '';
  const rows=rangeError?[]:filtered;
  const pageRows=rows.slice(page*size,(page+1)*size);
  const expanded=pageRows.findIndex(row=>row.id===selected);
  useEffect(()=>{if(selected){const index=filtered.findIndex(row=>row.id===selected);if(index>=0)setPage(Math.floor(index/size));}},[selected,filtered,size]);
  useEffect(()=>{if(!loading&&memory.ready)setPage(current=>Math.min(current,Math.max(0,Math.ceil(rows.length/size)-1)));},[rows.length,size,loading,memory.ready]);
  const patch=(value:Partial<ReceivingListFilters & {preset:DatePresetValue}>)=>{setFilters(current=>({...current,...value,...('from' in value||'to' in value?{preset:'custom' as const}:value.preset&&value.preset!=='custom'?{from:'',to:''}:{})}));setPage(0);};
  const reset=()=>{setFilters({...EMPTY_RECEIVING_FILTERS,preset:'today'});setPage(0);};
  const chips:ListFilterChip[]=(['search','status','source','receiver','purpose','from','to'] as const).filter(key=>!!filters[key]).map(key=>({key,label:({search:'Tìm',status:'Trạng thái',source:'Nơi xuất',receiver:'Người nhận',purpose:'Công dụng',from:'Từ ngày',to:'Đến ngày'})[key],value:key==='status'?RECEIVING_STATUS_LABELS[filters.status as keyof typeof RECEIVING_STATUS_LABELS]:key==='purpose'?({stock:'Nhập tồn',expense:'Chi phí vận hành',review:'Cần kiểm tra'})[filters.purpose as 'stock'|'expense'|'review']:filters[key],onClear:()=>patch({[key]:''})}));
  const columns=useMemo<ColumnDef<InternalReceivingOrder>[]>(()=>[
    {accessorKey:'code',header:'Mã đơn',cell:({row})=><span className="font-medium text-primary">{row.original.code}</span>},
    {accessorKey:'createdAt',header:'Ngày xuất',cell:({row})=>formatDate(row.original.createdAt)},
    {accessorKey:'fromBranch',header:'Chi nhánh xuất',meta:{hideBelow:'lg'}},
    {accessorKey:'toBranch',header:'Chi nhánh nhận'},
    {id:'status',header:'Trạng thái nhận',accessorFn:row=>RECEIVING_STATUS_LABELS[receivingStatus(row)],cell:({row})=>{
      const status=receivingStatus(row.original);
      return <span className={`border-l-2 pl-2 text-sm ${status==='cancelled'?'border-red-500 text-red-700':status==='received'||status==='legacy'?'border-emerald-500 text-emerald-700':'border-amber-500 text-amber-700'}`}>{RECEIVING_STATUS_LABELS[status]}</span>;
    }},
    ...(['items','pending','stock','expense','review','receipts'] as const).map(id=>({id,header:({items:'Mặt hàng',pending:'Dòng chưa đủ',stock:'Dòng nhập tồn',expense:'Dòng chi phí',review:'Cần kiểm tra',receipts:'Lần nhận'})[id],meta:['items','pending'].includes(id)?undefined:{hideBelow:'lg' as const},accessorFn:(row:InternalReceivingOrder)=>receivingMetrics(row)[id],cell:({row}:{row:{original:InternalReceivingOrder}})=>formatNumber(receivingMetrics(row.original)[id])})),
    {id:'lastReceived',header:'Nhận gần nhất',meta:{hideBelow:'lg'},accessorFn:row=>receivingMetrics(row).lastReceived,cell:({row})=>receivingMetrics(row.original).lastReceived?formatDate(receivingMetrics(row.original).lastReceived):'—'},
    {id:'receivers',header:'Người nhận',meta:{hideBelow:'lg'},accessorFn:row=>receivingMetrics(row).receivers||'—'},
    {accessorKey:'createdBy',header:'Người xuất',meta:{hideBelow:'lg'}},
    {accessorKey:'note',header:'Ghi chú',meta:{hideBelow:'lg'}},
    {id:'action',header:'Thao tác',enableSorting:false,cell:({row})=><Button variant="outline" size="sm" disabled={busy} onClick={event=>{event.stopPropagation();onOpen(row.original.id);}}>Xem đơn</Button>},
  ],[busy,onOpen]);
  const displayedColumns=full?columns:columns.filter(column=>['code','createdAt','fromBranch','toBranch','status','items','action'].includes('accessorKey' in column?String(column.accessorKey):column.id??'')).map(column=>column.id==='items'?{...column,header:'Tiến độ nhận',cell:({row}:{row:{original:InternalReceivingOrder}})=>{const metrics=receivingMetrics(row.original);return ['cancelled','draft'].includes(receivingStatus(row.original))?'—':`${metrics.items-metrics.pending}/${metrics.items} mặt hàng`;}}:column);
  async function download(lines:boolean){
    setExporting(true);setExportError('');
    try{
      const records=rows.flatMap(order=>{
        const m=receivingMetrics(order),base={code:order.code,date:formatDate(order.createdAt),source:order.fromBranch,destination:order.toBranch,status:RECEIVING_STATUS_LABELS[receivingStatus(order)],creator:order.createdBy,receivers:m.receivers,last:m.lastReceived?formatDate(m.lastReceived):'',items:m.items,pending:m.pending,stock:m.stock,expense:m.expense,review:m.review,receipts:m.receipts,note:order.note};
        return lines?order.items.map(i=>({...base,sku:i.code,name:i.name,unit:i.unit,sent:i.dispatched,received:i.received,remaining:receivingStatus(order)==='cancelled'?null:Math.max(0,i.dispatched-i.received),treatment:i.treatment==='expense'?'Chi phí vận hành':i.treatment==='review'?'Cần kiểm tra':'Nhập tồn',target:i.receivingProductCode,factor:i.receivingFactor,targetUnit:i.receivingUnit})):[base];
      });
      await exportToExcel(records,[{header:'Mã đơn',key:'code'},{header:'Ngày xuất',key:'date'},{header:'Chi nhánh xuất',key:'source'},{header:'Chi nhánh nhận',key:'destination'},{header:'Trạng thái',key:'status'},
        ...(lines?[{header:'Mã hàng',key:'sku'},{header:'Mặt hàng',key:'name'},{header:'ĐVT theo đơn',key:'unit'},{header:'Theo đơn',key:'sent',precision:4},{header:'Đã nhận',key:'received',precision:4},{header:'Còn nhận',key:'remaining',precision:4},{header:'Công dụng',key:'treatment'},{header:'Mã nhập tồn',key:'target'},{header:'Hệ số',key:'factor',precision:12},{header:'ĐVT nhập tồn',key:'targetUnit'}]:[{header:'Mặt hàng',key:'items'},{header:'Dòng chưa đủ',key:'pending'},{header:'Dòng nhập tồn',key:'stock'},{header:'Dòng chi phí',key:'expense'},{header:'Cần kiểm tra',key:'review'},{header:'Lần nhận',key:'receipts'}]),
        {header:'Người xuất',key:'creator'},{header:'Người nhận',key:'receivers'},{header:'Nhận gần nhất',key:'last'},{header:'Ghi chú',key:'note'}],lines?'nhan-noi-bo-chi-tiet':'nhan-noi-bo-danh-sach',{financialTable:true});
    }catch(error){setExportError(error instanceof Error?error.message:'Không xuất được file.');}finally{setExporting(false);}
  }
  const selectClass='h-10 min-w-0 rounded-md border bg-background px-2 text-sm';
  return <div ref={memory.containerRef} className="@container min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Input className="max-w-lg" aria-label="Tìm đơn nhận nội bộ" placeholder="Mã đơn, mã hàng, người xuất/nhận, ghi chú…" value={filters.search} onChange={e=>patch({search:e.target.value})}/>
      <Button variant="outline" onClick={reset}><Icon name="filter_alt_off"/>Đặt lại</Button>
      {canExport&&<><Button variant="outline" disabled={loading||exporting||!!rangeError||!rows.length} onClick={()=>void download(false)}><Icon name="download"/>Danh sách</Button><Button variant="outline" disabled={loading||exporting||!!rangeError||!rows.length} onClick={()=>void download(true)}><Icon name="download"/>Chi tiết hàng</Button></>}
    </div>
    <div role="group" aria-label="Trạng thái nhận nhanh" className="flex flex-wrap gap-1 border-b">{[['','Tất cả'],['pending','Chờ nhận'],['partial','Nhận một phần'],['received','Đã nhận đủ'],['cancelled','Đã hủy']].map(([value,label])=><button key={value} type="button" aria-pressed={filters.status===value} className={`border-b-2 px-3 py-2 text-sm ${filters.status===value?'border-primary font-medium text-primary':'border-transparent text-muted-foreground'}`} onClick={()=>patch({status:value})}>{label}</button>)}</div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex h-10 items-center gap-2 text-sm">Thời gian<select aria-label="Thời gian nhận nội bộ" className={selectClass} value={filters.preset} onChange={e=>patch({preset:e.target.value as DatePresetValue})}>{STANDARD_LIST_PRESETS_WITH_ALL.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      {filters.preset==='custom' ? <div role="group" aria-label="Khoảng ngày nhận nội bộ" className="grid w-full grid-cols-2 gap-3 sm:w-auto">
        <label className="grid min-w-0 gap-1 text-sm">Từ ngày<Input type="date" className="h-10 min-w-0" value={filters.from} max={filters.to||undefined} aria-invalid={!!rangeError} onChange={e=>patch({from:e.target.value})}/></label>
        <label className="grid min-w-0 gap-1 text-sm">Đến ngày<Input type="date" className="h-10 min-w-0" value={filters.to} min={filters.from||undefined} aria-invalid={!!rangeError} onChange={e=>patch({to:e.target.value})}/></label>
      </div> : <span className="py-2 text-sm text-muted-foreground">{effectiveFilters.from||effectiveFilters.to?`${effectiveFilters.from||'…'} → ${effectiveFilters.to||'…'}`:'Tất cả thời gian'}</span>}
      {filters.preset==='custom'&&<span className="py-2 text-sm text-muted-foreground">Lọc theo: {filters.dateField==='received'?'Lần nhận gần nhất':'Ngày xuất'}</span>}
    </div>
    <details className="border-y py-2" onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.open=false;}}><summary className="cursor-pointer text-sm font-medium">Bộ lọc chứng từ{chips.length?` · ${chips.length} điều kiện`:''}</summary><div className="grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-sm">Trạng thái nhận<select className={selectClass} value={filters.status} onChange={e=>patch({status:e.target.value})}><option value="">Tất cả trạng thái</option>{Object.entries(RECEIVING_STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Chi nhánh xuất<select className={selectClass} value={filters.source} onChange={e=>patch({source:e.target.value})}><option value="">Tất cả nơi xuất</option>{sources.map(name=><option key={name}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Người nhận<select className={selectClass} value={filters.receiver} onChange={e=>patch({receiver:e.target.value})}><option value="">Tất cả người nhận</option>{receivers.map(name=><option key={name}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Công dụng<select className={selectClass} value={filters.purpose} onChange={e=>patch({purpose:e.target.value})}><option value="">Tất cả công dụng</option><option value="stock">Nhập tồn</option><option value="expense">Chi phí vận hành</option><option value="review">Cần kiểm tra</option></select></label>
      <label className="grid gap-1 text-sm">Lọc thời gian theo<select className={selectClass} value={filters.dateField} onChange={e=>patch({dateField:e.target.value as 'created'|'received'})}><option value="created">Ngày xuất</option><option value="received">Lần nhận gần nhất</option></select></label>
    </div></details>
    <FilterChips filters={chips} onClearAll={reset}/>
    {(rangeError||exportError)&&<p role="alert" className="text-sm text-destructive">{rangeError||exportError}</p>}
    <div className="flex flex-wrap items-center gap-2 text-sm"><div role="group" aria-label="Mức độ chi tiết" className="inline-flex border"><Button size="sm" variant={full?'ghost':'secondary'} aria-pressed={!full} onClick={()=>setFull(false)}>Gọn</Button><Button size="sm" variant={full?'secondary':'ghost'} aria-pressed={full} onClick={()=>setFull(true)}>Đầy đủ</Button></div><label className="flex items-center gap-2">Sắp xếp<select aria-label="Sắp xếp theo" className={selectClass} value={sorting[0]?.id??'createdAt'} onChange={e=>{setSorting([{id:e.target.value,desc:sorting[0]?.desc??true}]);setPage(0);}}>{columns.filter(column=>column.id!=='action').map(column=>{const id='accessorKey' in column?String(column.accessorKey):column.id??'';return <option key={id} value={id}>{String(column.header)}</option>;})}</select></label><select aria-label="Thứ tự sắp xếp" className={selectClass} value={sorting[0]?.desc?'desc':'asc'} onChange={e=>{setSorting([{id:sorting[0]?.id??'createdAt',desc:e.target.value==='desc'}]);setPage(0);}}><option value="desc">Giảm dần</option><option value="asc">Tăng dần</option></select></div>
    <div className="min-h-[360px] min-w-0"><DataTable key={full?'full':'compact'} columns={displayedColumns} data={memory.ready?pageRows:[]} loading={loading||!memory.ready} density="compact" columnToggle selectable={false} getRowId={row=>row.id}
      defaultColumnVisibility={full?Object.fromEntries(columns.map(column=>['accessorKey' in column?String(column.accessorKey):column.id??'',true])):undefined}
      sorting={sorting} onSortingChange={next=>{setSorting(next);setPage(0);}} sortableColumnIds={columns.filter(c=>c.id!=='action').map(c=>'accessorKey' in c?String(c.accessorKey):c.id??'')}
      pageIndex={page} pageSize={size} pageCount={Math.ceil(rows.length/size)} total={rows.length} onPageChange={setPage} onPageSizeChange={value=>{setSize(value);setPage(0);}}
      toolbarMetrics={<span className="text-sm"><b>{formatNumber(rows.length)}</b> đơn · <b>{formatNumber(rows.filter(o=>['pending','partial'].includes(receivingStatus(o))).length)}</b> chờ nhận · <b>{formatNumber(rows.filter(o=>receivingStatus(o)==='received').length)}</b> nhận đủ</span>}
      expandedRow={expanded<0?null:expanded} onExpandedRowChange={index=>{if(busy)return;if(index==null)onClose();else onOpen(pageRows[index].id);}}
      renderDetail={()=>detail} emptyTitle="Không có đơn phù hợp" emptyDescription="Kiểm tra chi nhánh hoặc xóa bộ lọc để xem toàn bộ lịch sử."/></div>
  </div>;
}
