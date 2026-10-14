"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

export function PreparedRecipeYield({ value, unit, onChange, error }: {
  value: string; unit: string; onChange: (value: string) => void; error?: string;
}) {
  const id = useId();
  return (
    <section className="border-b border-border bg-primary/5 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={id} className="text-sm font-medium">1 mẻ thu được <span className="text-destructive">*</span></label>
        <div className="flex items-center gap-2">
          <Input id={id} className="h-9 w-32 text-right tabular-nums" type="number" inputMode="decimal" min="0" step="any" value={value} onChange={e => onChange(e.target.value)} placeholder="Thực cân" aria-invalid={!!error} aria-describedby={`${id}-help`} />
          <span className="shrink-0 text-sm font-medium">{unit || "Chọn đơn vị kho"}</span>
        </div>
        <span id={`${id}-help`} className="text-xs text-muted-foreground">Thành phẩm tịnh · nguyên liệu nhập theo mẻ</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
