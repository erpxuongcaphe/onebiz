"use client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FNB_INVOICE_TYPES, type FnbInvoiceType } from "@/lib/utils/invoice-list-filters";

export function FnbInvoiceTypeFilter({ value, onChange }: {
  value: FnbInvoiceType; onChange: (value: FnbInvoiceType) => void;
}) {
  return <div role="group" aria-label="Hình thức bán F&B" className="flex flex-wrap gap-1.5">
    {FNB_INVOICE_TYPES.map(option => <Button key={option.value} type="button"
      variant={value === option.value ? "default" : "outline"}
      aria-pressed={value === option.value}
      className="h-8 min-h-8 gap-1.5 px-2.5 text-xs font-medium pointer-coarse:min-h-11"
      onClick={() => onChange(option.value)}>
      <span className="hidden sm:inline-flex"><Icon name={option.icon} size={16} /></span><span>{option.label}</span>
    </Button>)}
  </div>;
}
