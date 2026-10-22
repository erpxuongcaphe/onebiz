"use client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { RETAIL_INVOICE_TYPES, type RetailInvoiceType } from "@/lib/utils/invoice-list-filters";

export function RetailInvoiceTypeFilter({value,onChange}: {
  value: RetailInvoiceType; onChange: (value: RetailInvoiceType) => void;
}) {
  return <div role="group" aria-label="Loại bán Retail" className="flex flex-wrap gap-1">
    {RETAIL_INVOICE_TYPES.map(option => <Button key={option.value} type="button"
      title={option.hint} aria-pressed={value === option.value}
      variant={value === option.value ? "default" : "outline"}
      className="h-7 min-h-7 gap-1 px-2 text-xs font-medium pointer-coarse:min-h-11"
      onClick={()=>onChange(option.value)}>
      <span className="hidden sm:inline-flex"><Icon name={option.icon} size={15} /></span><span>{option.label}</span>
    </Button>)}
  </div>;
}
