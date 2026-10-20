"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { useLiveDataRefresh } from "@/lib/hooks/use-live-data-refresh";
import { getFnbDayHistory, getFnbDayCash, getFnbHistoryItems, todayFnb, type FnbSaleRow, type FnbDayHistory, type FnbDayCash, type FnbHistoryItem } from "@/lib/services/supabase/fnb-sales-history";

const METHODS:Record<string,string>={cash:"Tiền mặt",transfer:"Chuyển khoản",card:"Thẻ",mixed:"Hỗn hợp",ewallet:"Ví điện tử"};
const STATES={all:"Tất cả",completed:"Đã thanh toán",pending:"Chờ thanh toán",cancelled:"Đã hủy"};
const TYPES:Record<string,string>={dine_in:"Tại quán",takeaway:"Mang về",delivery:"Giao hàng"};
const PAGE_SIZE=20;
export function FnbSalesHistoryView({branchId,tenantId,revision,onReprint,onVoid,reprinting,voiding,canVoidPaidBill}:{branchId:string;tenantId?:string;revision:number;onReprint:(id:string)=>Promise<void>;onVoid:(row:FnbSaleRow)=>void;reprinting:string|null;voiding:boolean;canVoidPaidBill:boolean}) {
  const {hasPermission}=useAuth();
  const canViewCash=hasPermission(PERMISSIONS.POS_FNB_VIEW_SALES_SUMMARY);
  const [day,setDay]=useState(todayFnb),[search,setSearch]=useState(""),[status,setStatus]=useState<keyof typeof STATES>("all"),[method,setMethod]=useState("all"),[page,setPage]=useState(0);
  const [history,setHistory]=useState<FnbDayHistory|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [cash,setCash]=useState<FnbDayCash|null>(null),[cashError,setCashError]=useState("");
  const [selected,setSelected]=useState<FnbSaleRow|null>(null),[items,setItems]=useState<FnbHistoryItem[]>([]),[itemError,setItemError]=useState(""),[itemsLoading,setItemsLoading]=useState(false);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const gen=++generation.current;
    setLoading(true); setError(""); setCashError("");
    // Cash errors must not hide order history; lack of permission is never displayed as zero.
    const money=canViewCash ? getFnbDayCash(branchId,day).then(result=>{if(gen===generation.current)setCash(result);}).catch((err:unknown)=>{if(gen===generation.current){if(err instanceof Error && /PERMISSION_DENIED|BRANCH_DENIED/.test(err.message))setCash(null);setCashError("Chưa tải được tiền thu. Thử tải lại.");}}) : Promise.resolve();
    try { const result=await getFnbDayHistory(branchId,day); if(gen===generation.current){setHistory(result);setSelected(old=>{const next=old ? result.rows.find(row=>row.id===old.id)??null : null;return JSON.stringify(old)===JSON.stringify(next) ? old : next;});} }
    catch(err){if(gen===generation.current){setHistory(null);setError(err instanceof Error?err.message:"Không tải được lịch sử.");}}
    finally{await money;if(gen===generation.current)setLoading(false);}
  },[branchId,day,canViewCash]);
  useEffect(()=>{setHistory(null);setCash(null);setSelected(null);setPage(0);void refresh();return()=>{generation.current+=1;};},[refresh,revision]);
  useLiveDataRefresh(refresh,tenantId,branchId,["invoices","kitchen_orders","cash_transactions"],true);
  useEffect(()=>{
    let stale=false;setItems([]);setItemError("");
    if(!selected)return;
    setItemsLoading(true);
    getFnbHistoryItems(selected,branchId).then(data=>{if(!stale)setItems(data);}).catch(err=>{if(!stale)setItemError(err instanceof Error?err.message:"Không tải được món.");}).finally(()=>{if(!stale)setItemsLoading(false);});
    return()=>{stale=true;};
  },[selected,branchId]);
  const rows=useMemo(()=>{
    const query=search.trim().toLocaleLowerCase("vi-VN");
    return (history?.rows??[]).filter(row=>(status==="all"||row.status===status)&&(method==="all"||row.paymentMethod===method)&&(!query||[row.code,row.kitchenOrderNumber,row.tableName,row.customerName,row.cashierName].join(" ").toLocaleLowerCase("vi-VN").includes(query)));
  },[history,search,status,method]);
  const pageCount=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),safePage=Math.min(page,pageCount-1);
  const filterClass="min-h-11 rounded-lg border border-input bg-background px-2 text-sm";
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="shrink-0 space-y-2 border-b px-4 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="Ngày bán hàng" value={day} onChange={event=>{if(event.target.value)setDay(event.target.value);}} className="w-40" title="DD/MM/YYYY · Giờ Việt Nam" />
        <Button variant="outline" onClick={()=>setDay(todayFnb())}>Hôm nay</Button>
        <Input aria-label="Tìm đơn bán hàng" placeholder="Mã bill, bàn, khách, nhân viên…" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} className="min-w-48 flex-1" />
        <select aria-label="Phương thức thanh toán" className={filterClass} value={method} onChange={event=>{setMethod(event.target.value);setPage(0);}}><option value="all">Mọi thanh toán</option>{Object.entries(METHODS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <Button variant="outline" size="icon" aria-label="Tải lại lịch sử" onClick={()=>void refresh()} disabled={loading}><Icon name="refresh" size={19}/></Button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Trạng thái đơn">
        {(Object.entries(STATES) as [keyof typeof STATES,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={key===status} onClick={()=>{setStatus(key);setPage(0);}} className={`min-h-11 rounded-lg border px-3 text-sm ${key===status ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:bg-muted"}`}>{label} <span className="ml-1 tabular-nums">{canViewCash && <span>{cash ? formatNumber(key==="all" ? cash.completed+cash.pending+cash.cancelled : cash[key]) : "—"}</span>}</span></button>)}
      </div>
      {canViewCash && <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/50 px-3 py-2"><p className="text-xs text-muted-foreground">Giá trị bill hoàn thành</p><p className="text-lg font-semibold tabular-nums">{cash ? formatCurrency(cash.invoiceValue) : "—"}</p><p className="text-[11px] text-muted-foreground">Đã giảm giá · gồm tip, phí nếu có</p></div>
        <div className="rounded-lg bg-primary/5 px-3 py-2"><p className="text-xs text-muted-foreground">Thực thu F&B trong ngày</p><p className="text-lg font-semibold tabular-nums text-primary">{cash ? formatCurrency(cash.net) : "—"}</p><p className="text-[11px] text-muted-foreground">{cashError || (cash ? `Thu ${formatCurrency(cash.received)} · Hoàn ${formatCurrency(cash.refunded)}` : "Đang tải sổ quỹ…")}</p></div>
      </div>}
      {canViewCash && cash && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{Object.entries(cash.methods).map(([key,amount])=><span key={key}>{METHODS[key]??key}: <strong className="tabular-nums text-foreground">{formatCurrency(amount)}</strong></span>)}</div>}
      <p className="text-[11px] text-muted-foreground">{canViewCash ? "Giờ Việt Nam · Bill theo ngày hóa đơn; thực thu theo ngày ghi sổ, đã trừ hoàn tiền. Đơn chờ theo ngày mở, chưa tính vào giá trị bill." : "Giờ Việt Nam · Tra cứu và in lại từng bill."}</p>
    </div>
    {error ? <div role="alert" className="p-4 text-destructive">{error}<Button variant="outline" className="ml-2" onClick={()=>void refresh()}>Thử lại</Button></div> : <div className="flex min-h-0 flex-1">
      <div className={`${selected ? "hidden lg:flex lg:w-1/2" : "flex w-full"} min-h-0 flex-col`}>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
          {loading && !history ? <p role="status" className="p-8 text-center text-muted-foreground">Đang tải lịch sử…</p> : !rows.length ? <p className="p-8 text-center text-muted-foreground">{search || status!=="all" || method!=="all" ? "Không có đơn khớp bộ lọc." : "Chưa có đơn trong ngày đã chọn."}</p> : rows.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE).map(row=><button key={row.id} type="button" onClick={()=>setSelected(row)} aria-pressed={selected?.id===row.id} className={`flex min-h-20 w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${selected?.id===row.id?"bg-primary/5":""}`}>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2"><strong className="text-sm text-primary">{row.code}</strong><span className="text-xs">{row.tableName || TYPES[row.orderType]}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{formatDate(row.createdAt)} · {row.customerName} · {row.cashierName}</p></div>
            <div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{row.invoiceId ? formatCurrency(row.total) : "—"}</p><p className={`mt-1 text-xs ${row.status==="cancelled"?"text-destructive":row.status==="pending"?"text-status-warning":"text-status-success"}`}>{STATES[row.status]}{row.paymentMethod ? ` · ${METHODS[row.paymentMethod]??row.paymentMethod}` : ""}</p></div><Icon name="chevron_right" size={18}/>
          </button>)}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground"><span>{canViewCash ? `${rows.length} kết quả · ${safePage+1}/${pageCount}` : `Trang ${safePage+1}`}</span><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Trang trước" disabled={!safePage} onClick={()=>setPage(safePage-1)}><Icon name="chevron_left" size={18}/></Button><Button variant="outline" size="icon" aria-label="Trang sau" disabled={safePage>=pageCount-1} onClick={()=>setPage(safePage+1)}><Icon name="chevron_right" size={18}/></Button></div></div>
      </div>
      {selected && <section aria-label="Chi tiết đơn bán hàng" className="flex min-h-0 w-full flex-col border-l lg:w-1/2">
        <div className="flex shrink-0 items-center gap-2 border-b p-3"><Button variant="ghost" size="icon" aria-label="Quay lại danh sách" onClick={()=>setSelected(null)}><Icon name="arrow_back" size={20}/></Button><div className="min-w-0 flex-1"><h3 className="font-semibold">{selected.code}</h3><p className="text-xs text-muted-foreground">{selected.tableName || TYPES[selected.orderType]} · {STATES[selected.status]}</p></div>
          {selected.invoiceId && selected.status==="completed" && <><Button variant="outline" size="icon" aria-label="In lại hóa đơn" title="In lại" disabled={reprinting===selected.id} onClick={()=>void onReprint(selected.id)}><Icon name="print" size={19}/></Button><details className="relative"><summary aria-label="Thêm thao tác hóa đơn" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border"><Icon name="more_horiz" size={20}/></summary><div className="absolute right-0 top-12 z-20 w-48 rounded-lg border bg-popover p-1 shadow-lg"><Button variant="ghost" className="w-full justify-start text-destructive" disabled={voiding||!selected.kitchenOrderId} onClick={()=>onVoid(selected)}><Icon name="cancel" size={18}/>{canVoidPaidBill ? "Hủy hóa đơn" : "Xin duyệt hủy"}</Button></div></details></>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <dl className="mb-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Ngày hóa đơn / mở đơn</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt className="text-muted-foreground">Nhân viên tạo</dt><dd>{selected.cashierName}</dd></div><div><dt className="text-muted-foreground">Khách hàng</dt><dd>{selected.customerName}</dd></div><div><dt className="text-muted-foreground">Ghi nhận hệ thống</dt><dd>{formatDate(selected.recordedAt)}</dd></div></dl>
          {itemsLoading ? <p role="status">Đang tải món…</p> : itemError ? <p role="alert" className="text-destructive">{itemError}</p> : items.map(item=><div key={item.id} className="flex gap-3 border-b py-2 text-sm"><div className="min-w-0 flex-1"><p className="font-medium">{item.name}</p>{item.note && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.note}</p>}<p className="mt-1 text-xs text-muted-foreground">{formatNumber(item.quantity)} × {formatCurrency(item.unitPrice)}</p></div><span className="shrink-0 tabular-nums">{formatCurrency(item.total)}</span></div>)}
          {selected.invoiceId && <dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt>Giảm giá</dt><dd className="tabular-nums">{formatCurrency(selected.discount)}</dd></div><div className="flex justify-between"><dt>Tip</dt><dd className="tabular-nums">{formatCurrency(selected.tipAmount)}</dd></div><div className="flex justify-between font-semibold"><dt>Tổng thanh toán</dt><dd className="tabular-nums">{formatCurrency(selected.total)}</dd></div><div className="flex justify-between"><dt>{selected.status==="cancelled"?"Đã hủy":"Đã thu theo bill"}</dt><dd className="tabular-nums">{selected.status==="cancelled" ? "Xem phiếu hoàn trong sổ quỹ" : formatCurrency(selected.paid)}</dd></div></dl>}
          {selected.note && <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-sm">{selected.note}</p>}
          {selected.status==="pending" && <p className="mt-3 text-xs text-muted-foreground">Đơn chưa thanh toán. Mở từ “Đơn chờ thanh toán” trên POS để tiếp tục xử lý.</p>}
        </div>
      </section>}
    </div>}
  </div>;
}
