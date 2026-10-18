"use client";

import { Icon } from "@/components/ui/icon";
import { NumericInput } from "@/components/ui/numeric-input";
import { metricFilterError, type MetricFilter } from "@/lib/reports/metric-filter";

export function MetricFilters({ fields, value, onChange }: {
  fields: { key: string; label: string }[];
  value: MetricFilter[];
  onChange: (value: MetricFilter[]) => void;
}) {
  const update = (index: number, patch: Partial<MetricFilter>) => onChange(value.map((filter, i) => i === index ? { ...filter, ...patch } : filter));
  return <details className="border-y py-2">
    <summary className="cursor-pointer py-1 text-sm font-medium">Lọc chỉ tiêu{value.length ? ` (${value.length})` : ""}</summary>
    <div className="mt-2 space-y-2">
      {value.map((filter, index) => <div key={index} className="grid grid-cols-2 items-center gap-2 lg:grid-cols-[minmax(180px,2fr)_minmax(140px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_36px]">
        <select aria-label={`Chỉ tiêu ${index + 1}`} className="h-10 min-w-0 rounded border bg-background px-2 text-sm" value={filter.key} onChange={event => update(index, { key: event.target.value })}>{fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select>
        <select aria-label={`Điều kiện ${index + 1}`} className="h-10 min-w-0 rounded border bg-background px-2 text-sm" value={filter.state} onChange={event => update(index, { state: event.target.value as MetricFilter["state"] })}><option value="range">Trong khoảng</option><option value="known">Có dữ liệu</option><option value="missing">Chưa đủ dữ liệu</option></select>
        <NumericInput aria-label={`Từ giá trị ${index + 1}`} placeholder="Từ" allowNegative min={-Number.MAX_VALUE} decimals={4} disabled={filter.state !== "range"} value={filter.min} onChange={min => update(index, { min })} />
        <NumericInput aria-label={`Đến giá trị ${index + 1}`} placeholder="Đến" allowNegative min={-Number.MAX_VALUE} decimals={4} disabled={filter.state !== "range"} value={filter.max} onChange={max => update(index, { max })} />
        <button type="button" title="Xóa điều kiện" aria-label={`Xóa điều kiện ${index + 1}`} className="flex size-9 items-center justify-center text-destructive" onClick={() => onChange(value.filter((_, i) => i !== index))}><Icon name="delete" size={18} /></button>
      </div>)}
      {metricFilterError(value) && <p role="alert" className="text-sm text-destructive">Khoảng giá trị không hợp lệ. Giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="inline-flex min-h-9 items-center gap-1 text-sm text-primary" onClick={() => onChange([...value, { key: fields[0].key, state: "range", min: null, max: null }])}><Icon name="add" size={18} />Thêm điều kiện</button>
        {value.length > 0 && <button type="button" className="min-h-9 text-sm text-primary" onClick={() => onChange([])}>Xóa điều kiện</button>}
      </div>
    </div>
  </details>;
}
