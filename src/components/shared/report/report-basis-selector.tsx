"use client";

export function ReportBasisSelector({ value, onChange, disabled }: {
  value: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <select aria-label="Cơ sở giao dịch" value={value ? "external" : "all"}
    onChange={event => onChange(event.target.value === "external")} disabled={disabled}
    className="h-9 max-w-full rounded-md border border-border bg-background px-2 text-sm text-foreground">
    <option value="all">Gồm nội bộ</option>
    <option value="external">Loại nội bộ</option>
  </select>;
}
