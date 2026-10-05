"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { findBridgePrinters, loadBridgePrinter, saveBridgePrinter, type BridgeRole } from "@/lib/printer/qz-bridge";
import { printerService } from "@/lib/printer/printer-service";
import { generateDocumentHtml, type PaperSize } from "@/lib/print-document";

export function BridgePrinterSetup({ role, label, paperSize, branchId, stationId }: {
  role: BridgeRole; label: string; paperSize: PaperSize; branchId?: string; stationId?: string;
}) {
  const [selected, setSelected] = useState("");
  const [printers, setPrinters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setSelected(loadBridgePrinter(role, branchId, stationId) ?? ""); setMessage(""); }, [role, branchId, stationId]);

  const find = async () => {
    setBusy(true); setFailed(false); setMessage("Đang tìm máy qua QZ Tray…");
    try {
      const names = await findBridgePrinters(); setPrinters(names);
      setMessage(names.length ? `Tìm thấy ${names.length} máy. Chọn máy rồi in thử.` : "Chưa có máy trong hệ điều hành. Cài driver và in thử từ máy tính trước.");
    } catch (error) {
      setFailed(true); setMessage(`Chưa kết nối QZ Tray. Kiểm tra ứng dụng đang chạy và cấp quyền cho Onebiz khi được hỏi. ${error instanceof Error ? error.message : "Hãy thử lại."}`);
    } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setFailed(false);
    try {
      const html = generateDocumentHtml({ documentType: `IN THỬ — ${label}`, documentCode: "TEST-ONEBIZ", date: new Date().toISOString(), headerFields: [{ label: "Máy", value: selected }, { label: "Khổ giấy", value: paperSize }], items: [{ name: "Cà phê sữa đá — tiếng Việt", quantity: 2, total: 70000, note: "Đường: 70% • Đá: ít • Pha nhạt" }], showSignature: false, note: "Kiểm tra đủ dấu tiếng Việt, lề trái/phải và độ rõ. Lệnh đã gửi không xác nhận giấy đã ra." }, paperSize);
      const result = await printerService.printRaw({ rawHtml: html, backend: "qz-tray", bridgeRole: role, bridgePrinter: selected, paperSize });
      setFailed(!result.success); setMessage(result.warning ?? "Đã gửi lệnh. Hãy kiểm tra giấy tại đúng máy đã chọn.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Không in được."); }
    finally { setBusy(false); }
  };
  return <div className="border-l-4 border-primary bg-primary/5 px-3 py-2 space-y-2">
    <strong className="text-sm text-primary">{label}</strong>
    <div className="flex flex-wrap gap-2">
      <select aria-label={`Máy in ${label}`} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-2 text-sm" value={selected} onChange={event => {
        try { saveBridgePrinter(role, event.target.value, branchId, stationId); setSelected(event.target.value); setFailed(false); setMessage("Đã lưu lựa chọn trên trình duyệt này. Chưa kiểm chứng bản in giấy."); }
        catch { setFailed(true); setMessage("Không lưu được lựa chọn. Kiểm tra quyền lưu dữ liệu của trình duyệt."); }
      }}>
        <option value="">{stationId ? "Dùng máy bếp chung" : "Chưa chọn máy"}</option>
        {[...new Set([...printers, ...(selected ? [selected] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={busy} onClick={find}>Tìm máy</Button>
      <Button size="sm" disabled={busy || !selected} onClick={test}>In thử {paperSize}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{selected ? `Đã chọn: ${selected}` : stationId ? "Phiếu của trạm này sẽ gửi tới máy bếp chung đã chọn ở Máy in & vận hành." : "Chọn tên máy từ danh sách của hệ điều hành; có thể dùng chung một máy cho nhiều vai trò."}</p>
    {message && <p role="status" className={`text-sm ${failed ? "text-status-error" : "text-foreground"}`}>{message}</p>}
  </div>;
}
