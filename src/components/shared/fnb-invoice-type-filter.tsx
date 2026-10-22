"use client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FNB_INVOICE_TYPES, type FnbInvoiceType } from "@/lib/utils/invoice-list-filters";

export function FnbInvoiceTypeFilter({ value, onChange }: {
  value: FnbInvoiceType; onChange: (value: FnbInvoiceType) => void;
}) {
  return <div role="group" aria-label="Hình thức bán F&B" className="flex flex-wrap gap-2">
    {FNB_INVOICE_TYPES.map(option => <Button key={option.value} type="button"
      variant={value === option.value ? "default" : "outline"}
      aria-pressed={value === option.value}
      className="min-h-11 gap-2 px-3 text-sm font-medium"
      onClick={() => onChange(option.value)}>
      <Icon name={option.icon} size={18} /><span>{option.label}</span>
    </Button>)}
  </div>;
}
