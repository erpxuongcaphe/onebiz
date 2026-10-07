"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
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
  return <Card><CardHeader><CardTitle className="text-primary">Điểm in dùng chung cho nhân viên</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm"><strong>Chi nhánh: {currentBranch?.name ?? "Hãy chọn một chi nhánh"}</strong>. Nhân viên dùng web trên điện thoại cá nhân; máy quầy nhận và phân phiếu tới máy in.</p>
    <p className="text-sm text-muted-foreground">Máy nhiệt ESC/POS 58/80 mm: LAN/Wi-Fi bằng IP và cổng, hoặc USB qua driver Windows. Mỗi chi nhánh có điểm in riêng; cần máy quầy chạy điểm in và có Internet. Bluetooth dùng qua máy đã cài trong Windows nếu driver hỗ trợ.</p>
    <p className="border-l-4 border-primary bg-primary/5 px-3 py-2 text-sm">Cài đặt thuộc chi nhánh đang chọn. Một máy có thể nhận cả bill và bếp. LAN cần bộ điểm in phiên bản mới: tải lại bộ cài trước khi bật nhận phiếu; cấu hình kết nối đã có vẫn dùng được.</p>
    {branchId && <>
      <p role="status" className="text-sm font-semibold text-primary">{point?.last_seen_at ? `Kết nối gần nhất: ${new Date(point.last_seen_at).toLocaleString("vi-VN")}` : "Điểm in chưa báo kết nối"} · {point?.enabled ? "Đã bật" : "Chưa bật"}</p>
      {canManage && <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm font-medium">Tên điểm in<Input className="mt-1 min-h-11" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        <Button className="min-h-11" variant="outline" disabled={!routes.find(r => r.key === "cashier")?.printer} onClick={() => setRoutes(old => { const cashier = old.find(r => r.key === "cashier"); return cashier ? old.map(r => r.key !== "cashier" && !r.printer.trim() ? { ...r, printer: cashier.printer, paper: cashier.paper } : r) : old; })}>Dùng máy quầy cho nơi nhận bếp còn trống</Button>
        <div className="divide-y border-y">{routes.map((route, index) => <div key={route.key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
          <div className="space-y-2"><strong className="block text-sm text-primary">{route.label}</strong><div className="flex flex-wrap gap-2"><Button className="min-h-11" size="sm" variant="outline" disabled={!point?.enabled || !point.routes.some(r => r.key === route.key)} onClick={() => checkConnection(route)}>Kiểm tra kết nối</Button><Button className="min-h-11" size="sm" variant="outline" disabled={!point?.enabled || !point.routes.some(r => r.key === route.key)} onClick={() => sendTest(route)}>In thử cấu hình đã lưu</Button></div></div>
          <PrintRouteEditor route={route} printers={point?.detected_printers ?? []} onChange={next => setRoutes(old => old.map((r,i) => i === index ? next : r))} />
        </div>)}</div>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-5 accent-primary" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Bật nhận phiếu cho chi nhánh</label>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11" onClick={save}>Lưu điểm in</Button><Button className="min-h-11" variant="outline" disabled={!point} onClick={downloadConfig}>Tải cấu hình kết nối</Button></div>
        <details className="border bg-muted/30 px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold text-primary">Cài một lần tại máy quầy Windows</summary><ol className="list-decimal pl-5 space-y-2 mt-2"><li>Cài driver và in thử từ Windows. Lưu tên điểm in, bật nhận phiếu và tải cấu hình kết nối.</li><li>Cài Node.js LTS; tải <a className="underline text-primary" href="/print-point/onebiz-print-point.zip" download>bộ điểm in</a>, giải nén vào thư mục riêng và đặt tệp cấu hình vào cùng thư mục.</li><li>Chạy <code>setup.ps1</code> để đăng ký chạy nền khi đăng nhập Windows, hoặc <code>node agent.mjs</code> để thử thủ công. Xem <a className="underline text-primary" href="/print-point/README.txt" download>hướng dẫn</a>.</li><li>Bấm Cập nhật để lấy danh sách máy, chọn nơi nhận và khổ giấy, lưu rồi gửi phiếu thử. Kiểm tra dấu, QR, lề và cắt giấy trước khi vận hành.</li></ol></details>
      </fieldset>}
      {message && <p role="status" className="border-l-4 border-primary bg-primary/5 px-3 py-2 text-sm break-words">{message}</p>}
      <div className="flex items-center justify-between gap-2"><strong className="text-sm text-primary">50 lệnh gần nhất</strong><Button className="min-h-11" variant="outline" disabled={busy} onClick={load}>Cập nhật</Button></div>
      <PrintJobList jobs={jobs} onAction={canManage && !busy ? action : undefined} />
    </>}
  </CardContent></Card>;
}
