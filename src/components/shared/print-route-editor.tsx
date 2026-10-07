"use client";
import { Input } from "@/components/ui/input";
import type { PrintRoute } from "@/lib/printer/branch-queue";

export function PrintRouteEditor({ route, printers, onChange }: { route: PrintRoute; printers: string[]; onChange: (next: PrintRoute) => void }) {
  const network = route.printer.startsWith("tcp://");
  const address = network ? route.printer.slice(6).split(":") : ["", "9100"];
  const id = `route-${route.key}`;
  return <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
    <label className="block text-sm font-medium sm:col-span-2">Kết nối — {route.label}
      <select className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={network ? "tcp" : "windows"} onChange={e => onChange({ ...route, printer: e.target.value === "tcp" ? "tcp://:9100" : "" })}>
        <option value="windows">USB / máy đã cài trong Windows</option><option value="tcp">LAN / Wi-Fi — IP và cổng</option>
      </select>
    </label>
    <div className="min-w-0">
      {network ? <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
        <label className="text-sm" htmlFor={`${id}-ip`}>IP máy in<Input id={`${id}-ip`} className="mt-1 min-h-11" placeholder="192.168.10.222" inputMode="decimal" value={address[0]} maxLength={15} onChange={e => onChange({ ...route, printer: `tcp://${e.target.value}:${address[1] ?? "9100"}` })} /></label>
        <label className="text-sm" htmlFor={`${id}-port`}>Cổng<Input id={`${id}-port`} className="mt-1 min-h-11" inputMode="numeric" value={address[1] ?? "9100"} maxLength={5} onChange={e => onChange({ ...route, printer: `tcp://${address[0]}:${e.target.value}` })} /></label>
      </div> : <label className="text-sm" htmlFor={id}>Tên máy trong Windows<Input id={id} list={`${id}-printers`} className="mt-1 min-h-11" placeholder={printers.length ? "Chọn máy đã tìm thấy" : "Cài driver rồi bấm Cập nhật"} value={route.printer} maxLength={200} onChange={e => onChange({ ...route, printer: e.target.value })} /><datalist id={`${id}-printers`}>{printers.map(printer => <option key={printer} value={printer} />)}</datalist></label>}
    </div>
    <label className="text-sm">Khổ giấy — {route.label}<select className="mt-1 min-h-11 w-full rounded-md border bg-background px-2" value={route.paper} onChange={e => onChange({ ...route, paper: e.target.value as "58mm" | "80mm" })}><option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></label>
    <p className="text-xs text-muted-foreground sm:col-span-2">{network ? "Máy quầy gửi TCP/ESC-POS trực tiếp. Dùng IP nội bộ, cổng thường là 9100; không cần cài driver cho đường này." : "USB: cài driver đúng model và in được từ Windows trước. Điện thoại không cần cài driver."} Phiếu gửi lệnh cắt ESC/POS; cần kiểm tra dao cắt trên máy thật.</p>
  </div>;
}
