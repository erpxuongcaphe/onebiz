"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

export function PreparedRecipeYield({ value, unit, onChange, error }: {
  value: string; unit: string; onChange: (value: string) => void; error?: string;
}) {
  const id = useId();
  const valid = value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
  return (
    <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <label htmlFor={id} className="block text-sm font-medium">Một mẻ chuẩn thu được <span className="text-destructive">*</span></label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" min="0" step="any" value={value} onChange={e => onChange(e.target.value)} placeholder="Nhập lượng thành phẩm đã cân, ví dụ 1650" aria-invalid={!!error} aria-describedby={`${id}-help`} />
        <span className="shrink-0 font-medium">{unit || "Chọn đơn vị kho"}</span>
      </div>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">Nhập trọng lượng thành phẩm tịnh của một mẻ, đã trừ vỏ bình. Nguyên liệu bên dưới là lượng dùng cho cả mẻ này, không phải cho 1 gram.</p>
      {valid && <p className="text-sm text-primary">Một mẻ dùng các nguyên liệu bên dưới → dự kiến nhập {value} {unit} bán thành phẩm. Khi sản xuất, ghi lượng thực cân và nguyên liệu thực dùng.</p>}
      <p className="text-xs text-muted-foreground">Ví dụ nước đường: 1.000 G đường + 700 ml nước. Cân thành phẩm để điền sản lượng; nước không quản lý kho chỉ ghi trong hướng dẫn, không cần thêm vào BOM.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
