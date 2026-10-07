"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSettings } from "@/lib/contexts/settings-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getBranchPrintState, savePrintPoint, rotatePrintPointToken, resolvePrintJob, enqueueBranchPrint, checkBranchPrinter, type PrintPoint, type PrintRoute, type BranchPrintJob } from "@/lib/printer/branch-queue";
import { generateDocumentHtml } from "@/lib/print-document";
import { getKitchenStationsByBranch } from "@/lib/services/supabase/kitchen-stations";
import { PrintRouteEditor } from "./print-route-editor";
import { parseDestination } from "../../../public/print-point/destination.mjs";

export const PRINT_STATUS = { queued: "Chờ điểm in", sending: "Đang chuyển", handed_off: "Đã chuyển dữ liệu in", failed: "Chưa gửi được", unknown: "Cần kiểm tra giấy", cancelled: "Đã dừng" };
export function PrintJobList({ jobs, onAction }: { jobs: BranchPrintJob[]; onAction?: (id: string, action: "retry" | "cancel") => void }) {
  return <div className="divide-y border-y" aria-label="Lịch sử gửi phiếu">
    {!jobs.length && <p className="py-3 text-sm text-muted-foreground">Chưa có lệnh in.</p>}
    {jobs.map(job => <div key={job.id} className="py-2 space-y-1">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{job.label} · {job.route_label}</strong><span className={job.status === "unknown" || job.status === "failed" ? "font-semibold text-status-error" : job.status === "handed_off" ? "text-status-success" : "text-primary"}>{PRINT_STATUS[job.status]}</span></div>
      <p className="text-sm text-muted-foreground">{job.actor_name} · {new Date(job.created_at).toLocaleString("vi-VN")}</p>
      {job.message && <p className="text-sm">{job.message}</p>}
      {onAction && ["queued", "failed", "unknown"].includes(job.status) && <div className="flex gap-2">
        {job.status !== "queued" && <Button className="min-h-11" size="sm" variant="outline" onClick={() => onAction(job.id, "retry")}>In lại có xác nhận</Button>}
        <Button className="min-h-11" size="sm" variant="outline" onClick={() => onAction(job.id, "cancel")}>Dừng lệnh</Button>
      </div>}
    </div>)}
  </div>;
}

export function BranchPrintSetup() {
  const { currentBranch } = useAuth();
  return <BranchPrintSetupForBranch key={currentBranch?.id ?? "none"} />;
}
function BranchPrintSetupForBranch() {
  const { currentBranch, hasPermission } = useAuth();
  const { settings, updateSettings } = useSettings();
  const [step, setStep] = useState<"routes" | "install" | "test">("routes");
  const branchId = currentBranch?.id;
  const [point, setPoint] = useState<PrintPoint | null>(null);
  const [routes, setRoutes] = useState<PrintRoute[]>([]);
  const [name, setName] = useState("Máy quầy");
  const [enabled, setEnabled] = useState(false);
  const [jobs, setJobs] = useState<BranchPrintJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = hasPermission("system.manage_branches");
  const load = useCallback(async () => {
    if (!branchId) return;
    setBusy(true);
    try {
      const [state, stations] = await Promise.all([getBranchPrintState(branchId), getKitchenStationsByBranch(branchId)]);
      setPoint(state.point); setJobs(state.jobs); setName(state.point?.name ?? "Máy quầy"); setEnabled(state.point?.enabled ?? false);
      const choices = [{ key: "cashier", label: "Quầy — bill / tạm tính" }, { key: "kitchen", label: "Bar/Bếp chung — món chưa phân trạm" }, ...stations.map(s => ({ key: s.id, label: s.name }))];
      setRoutes(choices.map(c => state.point?.routes.find(r => r.key === c.key) ?? { ...c, printer: "", paper: "80mm" as const }));
      setMessage("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Không tải được điểm in."); }
    finally { setBusy(false); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!branchId) return;
    setBusy(true);
    try {
      const configured = routes.filter(r => r.printer.trim());
      for (const route of configured) {
        try { parseDestination(route.printer); } catch (e) { throw new Error(`${route.label}: ${e instanceof Error ? e.message : "Kết nối không hợp lệ."}`); }
      }
      const p = await savePrintPoint(branchId, name, configured, enabled); setPoint(p); setMessage("Đã lưu cho chi nhánh. Nhân viên có thể dùng tuyến in này bằng tài khoản của mình.");
    }
    catch (e) { setMessage(e instanceof Error ? e.message : "Không lưu được."); }
    finally { setBusy(false); }
  };
  const downloadConfig = async () => {
    if (!branchId || !window.confirm("Cấp mã mới sẽ ngắt mã kết nối cũ. Tải tệp và thay cấu hình ở đúng máy quầy. Tiếp tục?")) return;
    setBusy(true);
    try {
      const credential = await rotatePrintPointToken(branchId);
      const blob = new Blob([JSON.stringify({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(), pointId: credential.id, token: credential.token }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "onebiz-print-point.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Đã tải cấu hình kết nối mới. Tệp chứa mã riêng của điểm in; giữ tại máy quầy, không gửi cho nhân viên.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Không cấp được mã."); }
    finally { setBusy(false); }
  };
  const action = async (id: string, next: "retry" | "cancel") => {
    if (!branchId || busy || !window.confirm(next === "retry" ? "Kiểm tra giấy tại máy trước. In lại có thể tạo phiếu trùng nếu lệnh trước đã ra giấy. Đã kiểm tra và muốn in lại?" : "Dừng lệnh này? Việc dừng không thu hồi giấy đã in.")) return;
    setBusy(true);
    try { await resolvePrintJob(branchId, id, next); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Không xử lý được lệnh."); }
    finally { setBusy(false); }
  };
  const sendTest = async (route: PrintRoute) => {
    if (!branchId || busy) return;
    setBusy(true);
    try {
      const saved = point?.routes.find(r => r.key === route.key);
      if (!saved || saved.printer !== route.printer || saved.paper !== route.paper) throw new Error("Lưu thay đổi trước khi in thử. Phiếu thử dùng cấu hình đã lưu của chi nhánh.");
      const buildHtml = (paper: "58mm" | "80mm") => generateDocumentHtml({ documentType: "DỮ LIỆU IN THỬ", documentCode: "TEST-ONEBIZ", date: new Date().toISOString(), headerFields: [{ label: "Nơi nhận", value: route.label }], items: [{ name: "Cà phê sữa đá", quantity: 2, total: 70000, note: "Đường 70% • ít đá • thêm trân châu" }], showSignature: false, note: "Kiểm tra tiếng Việt, lề và dao cắt. Phiếu thử không ghi nhận doanh thu." }, paper);
      const job = await enqueueBranchPrint({ branchId, routeKey: route.key, label: `IN THỬ ${route.label}`.slice(0,80), html: buildHtml(route.paper), paper: route.paper, buildHtml, jobId: crypto.randomUUID() });
      setMessage(`Đã nhận phiếu thử tới ${job.route_label}. Kiểm tra giấy tại máy; xem kết quả ở lịch sử.`);
      const state = await getBranchPrintState(branchId); setJobs(state.jobs);
    } catch (e) { setMessage(`${e instanceof Error ? e.message : "Không gửi được phiếu thử."} Nếu mạng ngắt, xem lịch sử trước khi gửi lại.`); }
    finally { setBusy(false); }
  };
  const checkConnection = async (route: PrintRoute) => {
    if (!branchId || busy) return;
    setBusy(true);
    try {
      const saved = point?.routes.find(r => r.key === route.key);
      if (!saved || saved.printer !== route.printer || saved.paper !== route.paper) throw new Error("Lưu thay đổi trước khi kiểm tra kết nối.");
      await checkBranchPrinter(branchId, saved);
      setMessage("Đã gửi yêu cầu kiểm tra kết nối, không in giấy. Bấm Cập nhật để xem kết quả trong lịch sử; điểm in cần đang chạy bản mới.");
      setJobs((await getBranchPrintState(branchId)).jobs);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Không kiểm tra được kết nối."); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader className="pb-3"><CardTitle className="text-primary">Máy in tại chi nhánh</CardTitle><p className="text-sm font-semibold">{currentBranch?.name ?? "Chọn một chi nhánh ở thanh đầu trang"}</p><p className="text-sm text-muted-foreground">Cài một lần tại quầy. Nhân viên dùng điện thoại hoặc máy tính gửi tới cùng nơi nhận.</p></CardHeader><CardContent className="space-y-4">
    {branchId && <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3"><p role="status" className="text-sm"><strong className={point?.connected ? "text-status-success" : "text-primary"}>{point?.connected ? "Máy quầy đã kết nối" : "Chưa có kết nối gần đây"}</strong><span className="block text-muted-foreground">{point?.enabled ? "Đã bật nhận phiếu" : "Chưa bật nhận phiếu"}{point?.last_seen_at ? ` · Lần cuối ${new Date(point.last_seen_at).toLocaleString("vi-VN")}` : ""}</span></p><Button className="min-h-11" variant="outline" disabled={busy} onClick={load}>Cập nhật</Button></div>
      <div role="group" aria-label="Các bước kết nối máy in" className="flex flex-wrap gap-2">{([{id:"routes",label:"1. Chọn máy & nơi nhận"},{id:"install",label:"2. Kết nối máy quầy"},{id:"test",label:"3. In thử & sử dụng"}] as const).map(item => <Button key={item.id} className="min-h-11" variant={step===item.id ? "default" : "outline"} aria-pressed={step===item.id} onClick={() => { setStep(item.id); setMessage(""); }}>{item.label}</Button>)}</div>
      {canManage && <fieldset disabled={busy} className="space-y-4">
        {step === "routes" && <>
          <p className="text-sm text-muted-foreground">LAN / Wi-Fi: điền IP và cổng 9100. USB: chọn tên máy đã cài driver trong Windows. Cùng một máy có thể nhận bill và bếp.</p>
          <div className="space-y-3">{routes.map((route,index) => <details key={route.key} open={route.key === "cashier" || route.key === "kitchen"} className="rounded-lg border bg-background"><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-primary"><span>{route.label}</span><span className="max-w-[50%] truncate text-xs font-normal text-muted-foreground">{route.printer.trim() ? "Đã chọn máy" : "Chưa gán"}</span></summary><div className="border-t p-3"><PrintRouteEditor route={route} printers={point?.detected_printers ?? []} onChange={next => setRoutes(old => old.map((r,i) => i===index ? next : r))} /></div></details>)}</div>
          <Button className="min-h-11" variant="outline" disabled={!routes.find(r => r.key === "cashier")?.printer.trim()} onClick={() => setRoutes(old => { const cashier=old.find(r => r.key === "cashier"); return cashier ? old.map(r => r.key!=="cashier" && !r.printer.trim() ? {...r,printer:cashier.printer,paper:cashier.paper} : r) : old; })}>Dùng chung máy hóa đơn cho bếp chưa gán</Button>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-5 accent-primary" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Bật nhận phiếu cho chi nhánh</label>
          <Button className="min-h-11" onClick={save}>Lưu máy & nơi nhận</Button>
        </>}
        {step === "install" && <>
          <label className="block text-sm font-medium">Tên máy quầy<Input className="mt-1 min-h-11" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
          <ol className="list-decimal space-y-3 pl-5 text-sm"><li><strong>Chuẩn bị máy tính quầy.</strong> LAN: máy tính cùng mạng với máy in, không cần driver cho ESC/POS. USB: cài driver đúng model, in được từ Windows.</li><li><strong>Tải bộ kết nối.</strong> Cài Node.js LTS từ <a href="https://nodejs.org/" target="_blank" rel="noreferrer" className="text-primary underline">nodejs.org</a>, tải <a className="text-primary underline" href="/print-point/onebiz-print-point.zip" download>bộ điểm in Onebiz</a> và giải nén vào thư mục riêng.</li><li><strong>Ghép với chi nhánh này.</strong> Tải tệp cấu hình bên dưới, đặt cạnh <code>agent.mjs</code>. Chạy <code>setup.ps1</code> để máy quầy nhận lệnh nền mỗi lần đăng nhập Windows.</li><li><strong>Kiểm tra.</strong> Bấm Cập nhật. Khi máy quầy đã kết nối, sang bước 3 để in thử.</li></ol>
          <div className="flex flex-wrap gap-2"><Button className="min-h-11" onClick={save}>Lưu tên máy quầy</Button><Button className="min-h-11" variant="outline" disabled={!point} onClick={downloadConfig}>Tải cấu hình chi nhánh</Button></div>
          <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-semibold text-primary">Hướng dẫn chi tiết / đổi máy quầy</summary><p className="mt-2">Máy quầy cần bật và có Internet khi nhận lệnh. Bluetooth chỉ dùng nếu driver Windows hỗ trợ. Tệp cấu hình chứa mã riêng; tải mã mới sẽ ngắt kết nối cũ.</p><a href="/print-point/README.txt" download className="text-primary underline">Tải hướng dẫn kỹ thuật</a></details>
        </>}
        {step === "test" && <>
          <p className="text-sm text-muted-foreground">Lưu cấu hình ở bước 1, giữ máy quầy đang chạy rồi kiểm tra từng nơi nhận. Phiếu thử không tạo doanh thu.</p>
          <div className="space-y-2">{point?.routes.map(route => <div key={route.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><strong className="text-sm text-primary">{route.label}</strong><p className="text-xs text-muted-foreground">{route.paper === "80mm" ? "80" : "58"} mm</p></div><div className="flex flex-wrap gap-2"><Button className="min-h-11" size="sm" variant="outline" disabled={!point.enabled} onClick={() => checkConnection(routes.find(current => current.key === route.key) ?? route)}>Kiểm tra kết nối</Button><Button className="min-h-11" size="sm" variant="outline" disabled={!point.enabled} onClick={() => sendTest(routes.find(current => current.key === route.key) ?? route)}>In thử</Button></div></div>)}</div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2"><p className="text-sm">Sau khi giấy in đúng, chọn dùng điểm in chi nhánh trên trình duyệt này. Gửi bếp, tạm tính và thanh toán sẽ tới máy đã gán, không mở hộp thoại chọn máy.</p><Button className="min-h-11" disabled={!point?.enabled || !point.routes.some(route => route.key === "cashier") || !point.routes.some(route => route.key === "kitchen")} onClick={() => { updateSettings("print",{fnbBranchQueue:true}); setMessage("Đã chọn điểm in chi nhánh trên trình duyệt này. Nhân viên ở thiết bị khác chọn In: chi nhánh một lần trong POS."); }}>{settings.print.fnbBranchQueue ? "Đang dùng điểm in chi nhánh" : "Dùng điểm in chi nhánh"}</Button></div>
        </>}
      </fieldset>}
      {message && <p role="status" className="rounded-lg border-l-4 border-primary bg-primary/5 px-3 py-2 text-sm break-words">{message}</p>}
      {step === "test" && <details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-primary">Lịch sử lệnh in · {jobs.length} lệnh gần nhất</summary><PrintJobList jobs={jobs} onAction={canManage && !busy ? action : undefined} /></details>}
    </>}
  </CardContent></Card>;
}
