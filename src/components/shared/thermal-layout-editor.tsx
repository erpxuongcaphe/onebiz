"use client";
import { Input } from "@/components/ui/input";
import { resolveThermalLayout, type ThermalLayoutConfig } from "@/lib/thermal-layout";

export function ThermalLayoutEditor({ value, onChange, kitchen, legacySize }: { value?: ThermalLayoutConfig; onChange: (value: ThermalLayoutConfig | undefined) => void; kitchen: boolean; legacySize?: "sm"|"md"|"lg" }) {
  const current = resolveThermalLayout(value, kitchen, legacySize);
  const update = (patch: Partial<ThermalLayoutConfig>) => onChange({ ...value, ...patch });
  return <section className="space-y-3 rounded-lg border p-3" aria-label="Chữ và bố cục phiếu nhiệt">
    <h4 className="font-semibold text-primary">Chữ &amp; bố cục</h4>
    <p className="text-sm text-muted-foreground">Mặc định tên món đậm; tùy chọn nét thường, in nghiêng. Lề cuối phiếu chừa chỗ trước dao cắt; giảm từng chút sau khi in thử, tránh mất dòng cuối.</p>
    <p className="text-sm text-muted-foreground">{kitchen ? "Luôn giữ bàn, số lượng và toàn bộ yêu cầu pha chế. Giá chỉ in ở kiểu Chi tiết." : "Tên món, số lượng và thành tiền trên cùng dòng; chỉ xuống dòng khi tên dài. Tạm tính và thanh toán dùng chung mẫu."}</p>
    <details><summary className="min-h-11 cursor-pointer font-medium text-primary">Tùy chỉnh chữ và đường kẻ</summary><div className="grid gap-3 pt-2 sm:grid-cols-2">
      {!kitchen && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.showItemNotes} onChange={e => update({showItemNotes:e.target.checked})} />In tùy chọn / ghi chú món trên bill</label>}
      <label className="text-sm">Kiểu chữ<select className="mt-1 min-h-11 w-full rounded-md border bg-background px-2" value={value?.font ?? "sans"} onChange={e=>update({font:e.target.value as "sans"|"mono"})}><option value="sans">Thông thường · dễ đọc</option><option value="mono">Đơn cách</option></select></label>
      <label className="text-sm">Đường phân cách<select className="mt-1 min-h-11 w-full rounded-md border bg-background px-2" value={current.separator} onChange={e=>update({separator:e.target.value as ThermalLayoutConfig["separator"]})}><option value="none">Không kẻ</option><option value="solid">Nét liền</option><option value="dashed">Nét đứt</option></select></label>
      {([{key:"titleSize",label:kitchen?"Cỡ chữ bàn / đơn":"Cỡ chữ tiêu đề",min:14,max:28},{key:"itemSize",label:"Cỡ chữ tên món",min:12,max:24},{key:"detailSize",label:"Cỡ chữ tùy chọn / ghi chú",min:11,max:20},...(!kitchen?[{key:"totalSize",label:"Cỡ chữ tổng tiền",min:14,max:28}]:[])] as const).map(field => {
        const key = field.key as "titleSize"|"itemSize"|"detailSize"|"totalSize";
        return <label key={key} className="text-sm">{field.label} (px)
          <Input className="mt-1 min-h-11" type="number" min={field.min} max={field.max}
            value={value?.[key] ?? current[key]}
            onChange={e => update({[key]: e.target.value === "" ? undefined : Number(e.target.value)})}
            onBlur={() => update({[key]: current[key]})} />
        </label>;
      })}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.boldItems} onChange={e=>update({boldItems:e.target.checked})} />Tên món in đậm</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.italicDetails} onChange={e=>update({italicDetails:e.target.checked})} />Tùy chọn / ghi chú in nghiêng</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.boldDetails} onChange={e=>update({boldDetails:e.target.checked})} />Tùy chọn / ghi chú in đậm</label>
      {([{key:"topMarginMm",label:"Lề đầu phiếu",min:0,max:20},{key:"bottomMarginMm",label:"Lề cuối phiếu trước khi cắt",min:2,max:25}] as const).map(field => <label key={field.key} className="text-sm">{field.label} (mm)<Input className="mt-1 min-h-11" type="number" min={field.min} max={field.max} value={current[field.key]} onChange={e=>update({[field.key]: e.target.value === "" ? undefined : Number(e.target.value)})} /></label>)}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.headerFrame} onChange={e=>update({headerFrame:e.target.checked})} />Kẻ khung tiêu đề</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={current.showStaff} onChange={e=>update({showStaff:e.target.checked})} />In tên nhân viên</label>
    </div></details>
  </section>;
}
