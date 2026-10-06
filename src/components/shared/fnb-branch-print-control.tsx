"use client";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/contexts/settings-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getBranchPrintState, type PrintPoint, type BranchPrintJob } from "@/lib/printer/branch-queue";
import { PrintJobList } from "./branch-print-setup";
import { useToast } from "@/lib/contexts/toast-context";
import type { PrintResult } from "@/lib/printer/printer-service";

export function FnbBranchPrintControl({ branchId }: { branchId?: string }) {
  const { settings, updateSettings } = useSettings();
  const [open, setOpen] = useState(false), [point, setPoint] = useState<PrintPoint | null>(null), [jobs, setJobs] = useState<BranchPrintJob[]>([]), [error, setError] = useState("");
  const active = settings.print.fnbBranchQueue;
  const [checkedAt, setCheckedAt] = useState(0);
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
    let disposed = false;
    const load = async () => {
      try { const state = await getBranchPrintState(branchId); if (!disposed) { setPoint(state.point); setJobs(state.jobs); setCheckedAt(Date.now()); setError(""); } }
      catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Không tải được tuyến in."); }
    };
    void load(); const timer = setInterval(load, 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, [open, branchId]);
  return <><div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-1 text-sm">
    <span className="truncate">{active ? "Phiếu gửi tới điểm in chi nhánh" : "Đang in trực tiếp từ thiết bị này"}</span>
    <Button className="min-h-11 shrink-0 text-primary" variant="ghost" size="sm" onClick={() => setOpen(true)}>Nơi nhận & lệnh in</Button>
  </div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle className="text-primary">In phiếu tại chi nhánh</DialogTitle></DialogHeader>
    <p className="text-sm">Dùng tài khoản của bạn để gửi bill và phiếu bếp tới máy đã được quản lý gán. Không cần kết nối máy in vào điện thoại.</p>
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    <p className="text-sm font-semibold">{point?.enabled ? `${point.name} · ${point.last_seen_at && checkedAt-new Date(point.last_seen_at).getTime()<20000 ? "Vừa kết nối" : "Chưa có kết nối gần đây; phiếu sẽ chờ"}` : "Chi nhánh chưa bật điểm in; nhờ quản lý thiết lập."}</p>
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={!point?.enabled || !!error || !branchId} onClick={() => { updateSettings("print", { fnbBranchQueue: true }); setOpen(false); }}>Dùng điểm in chi nhánh</Button><Button className="min-h-11" variant="outline" onClick={() => { updateSettings("print", { fnbBranchQueue: false, backend: "browser" }); setOpen(false); }}>In thủ công trên thiết bị</Button></div>
    {point?.routes.map(route => <p key={route.key} className="border-b py-1 text-sm"><strong>{route.label}</strong> → {route.printer} · {route.paper === "58mm" ? "58" : "80"} mm</p>)}
    <p className="text-sm text-muted-foreground">“Windows đã nhận” chưa xác nhận giấy đã ra. Phiếu cần kiểm tra giấy phải báo quản lý, tránh gửi lại nhiều lần.</p>
    <PrintJobList jobs={jobs} />
  </DialogContent></Dialog></>;
}
