"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { saveDevicePrintOverride } from "./branch-print-defaults";
import { useSettings } from "@/lib/contexts/settings-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getBranchPrintState, type PrintPoint, type BranchPrintJob } from "@/lib/printer/branch-queue";
import { PrintJobList } from "./branch-print-setup";
import { describeDestination } from "../../../public/print-point/destination.mjs";
import { useToast } from "@/lib/contexts/toast-context";
import type { PrintResult } from "@/lib/printer/printer-service";

export function FnbBranchPrintControl({ branchId, compact = false }: { branchId?: string; compact?: boolean }) {
  const { settings, updateSettings } = useSettings();
  const { tenant } = useAuth();
  const changeDevice = (values: Partial<typeof settings.print>) => {
    saveDevicePrintOverride(tenant?.id, branchId, Object.fromEntries(Object.entries(values).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")));
    updateSettings("print", values);
  };
  const [open, setOpen] = useState(false), [point, setPoint] = useState<PrintPoint | null>(null), [jobs, setJobs] = useState<BranchPrintJob[]>([]), [error, setError] = useState("");
  const active = settings.print.fnbBranchQueue;
  const { toast } = useToast();
  useEffect(() => {
    const handler = (event: Event) => {
      const result = (event as CustomEvent<PrintResult>).detail;
      if (result?.queued) toast({ title: "Đã nhận lệnh in", description: `Nơi nhận: ${result.queued.routeLabel}. Xem kết quả ở Nơi nhận & lệnh in.`, variant: "success" });
    };
    window.addEventListener("onebiz-print-result", handler);
    return () => window.removeEventListener("onebiz-print-result", handler);
  }, [toast]);
  useEffect(() => {
    if (!open || !branchId) return;
    let disposed = false, loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { const state = await getBranchPrintState(branchId); if (!disposed) { setPoint(state.point); setJobs(state.jobs); setError(""); } }
      catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Không tải được tuyến in."); }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(load, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [open, branchId]);
  return <><div className={compact ? "shrink-0" : "flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-1 text-sm"}>
    {!compact && <span className="truncate">{active ? "In F&B: tại chi nhánh" : "In F&B: từ thiết bị này"}</span>}
    <Button aria-label="Nơi nhận & lệnh in" title={active ? "In F&B: tại chi nhánh" : "In F&B: từ thiết bị này"} className="min-h-11 shrink-0 text-primary" variant="ghost" size="sm" onClick={() => setOpen(true)}>{compact ? <><span className="sm:hidden">In & lệnh</span><span className="hidden sm:inline">{active ? "In & lệnh · chi nhánh" : "In & lệnh · thiết bị này"}</span></> : "Nơi nhận & lệnh in"}</Button>
  </div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle className="text-primary">In phiếu tại chi nhánh</DialogTitle></DialogHeader><div data-pos-toast-region className="shrink-0" />
    <section aria-label="Lệnh in gần đây" className="rounded-lg border p-3"><h3 className="text-sm font-semibold text-primary">Lệnh in gần đây · {jobs.length}</h3><p className="mb-2 text-xs text-muted-foreground">Tự cập nhật mỗi 5 giây. Chờ điểm in: lệnh chưa được máy quầy lấy. Đang chuyển: máy quầy đang xử lý.</p><div className="max-h-[35dvh] overflow-y-auto"><PrintJobList jobs={jobs} /></div></section>
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><strong className="text-primary">In tự động qua chi nhánh</strong><p className="mt-1">Chọn một lần; máy quầy chuyển phiếu tới máy LAN/USB đã gán, không hỏi máy mỗi lần.</p><a href="/cai-dat/in-an" className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary underline">Thiết lập / kiểm tra máy in</a></div>
    <details className="rounded border p-3 text-sm"><summary className="min-h-11 cursor-pointer font-semibold text-primary">Ngoại lệ trên thiết bị này</summary><p className="mb-2 text-xs text-muted-foreground">Mặc định theo chi nhánh. Thay đổi bên dưới chỉ áp dụng trình duyệt này tại chi nhánh hiện tại.</p><div className="divide-y">
      <label className="flex min-h-11 items-center gap-3 px-3 py-2"><input type="checkbox" className="size-5 shrink-0 accent-primary" checked={settings.print.autoPrintKitchen} onChange={event => changeDevice({ autoPrintKitchen: event.target.checked })} /><span><strong>In bếp khi bấm Gửi bếp</strong><span className="block text-muted-foreground">Đơn mới in các món vừa gửi; bổ sung chỉ in món thêm. Chọn món vào giỏ chưa gửi bếp.</span></span></label>
      <label className="flex min-h-11 items-center gap-3 px-3 py-2"><input type="checkbox" className="size-5 shrink-0 accent-primary" checked={settings.print.autoPrintReceipt} onChange={event => changeDevice({ autoPrintReceipt: event.target.checked })} /><span><strong>In bill sau thanh toán thành công</strong><span className="block text-muted-foreground">Tự gửi bill tới quầy. Phiếu tạm tính vẫn dùng nút In tạm tính.</span></span></label>
    </div></details>
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    <p className="text-sm font-semibold">{point?.enabled ? `${point.name} · ${point.connected ? "Vừa kết nối" : "Chưa có kết nối gần đây; phiếu sẽ chờ"}` : "Chi nhánh chưa bật điểm in; nhờ quản lý thiết lập."}</p>
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={!point?.enabled || !!error || !branchId} onClick={() => { changeDevice({ fnbBranchQueue: true }); setOpen(false); }}>Dùng điểm in chi nhánh</Button><Button className="min-h-11" variant="outline" onClick={() => { changeDevice({ fnbBranchQueue: false, backend: "browser" }); setOpen(false); }}>In thủ công trên thiết bị</Button></div>
    {point?.routes.map(route => <p key={route.key} className="border-b py-1 text-sm break-words"><strong>{route.label}</strong> → {describeDestination(route.printer)} · {route.paper === "58mm" ? "58" : "80"} mm</p>)}
    <p className="text-xs text-muted-foreground">In thủ công mở hộp thoại trình duyệt. “Đã chuyển dữ liệu in” chưa xác nhận giấy đã ra.</p>
  </DialogContent></Dialog></>;
}
