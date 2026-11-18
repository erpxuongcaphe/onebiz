"use client";

import { useCallback, useState } from "react";
import { PrintSizePickerDialog } from "@/components/shared/dialogs/print-size-picker-dialog";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { printDocument, type DocumentPrintData, type PaperSize, type PrintOptions } from "@/lib/print-document";
import { resolvePrintTemplate } from "@/lib/services";

function hasCustomerDebt(data: DocumentPrintData) {
  return data.summaryRows?.some((row) => row.customerDebt) ?? false;
}

export function useRetailInvoicePrint() {
  const [pending, setPending] = useState<{ data: DocumentPrintData; options?: PrintOptions } | null>(null);
  const [includeCustomerDebt, setIncludeCustomerDebt] = useState(true);

  const openPicker = useCallback((data: DocumentPrintData, options?: PrintOptions) => {
    setIncludeCustomerDebt(true);
    setPending({ data, options });
  }, []);

  const printPreparedRetailInvoice = useCallback((data: DocumentPrintData, options?: PrintOptions) => {
    if (hasCustomerDebt(data)) {
      openPicker(data, options);
    } else {
      printDocument(data, options);
    }
  }, [openPicker]);

  const printRetailInvoice = useCallback(async (data: DocumentPrintData, branchId?: string | null) => {
    try {
      const template = await resolvePrintTemplate("retail", "sale_invoice", branchId ?? null);
      if (template) {
        printPreparedRetailInvoice(applyTemplateToDocData(data, template), { paperSize: template.paperSize });
        return;
      }
    } catch {
      // Mẫu in không tải được thì vẫn cho chọn khổ giấy và in.
    }
    openPicker(data);
  }, [openPicker, printPreparedRetailInvoice]);

  const printerDialog = pending && (
    <PrintSizePickerDialog
      open
      onOpenChange={(open) => { if (!open) setPending(null); }}
      title={`In hóa đơn ${pending.data.documentCode}`}
      defaultPaperSize={pending.options?.paperSize}
      onPrint={(paperSize: PaperSize) => {
        const { data, options } = pending;
        const printable = includeCustomerDebt || !hasCustomerDebt(data)
          ? data
          : {
              ...data,
              summaryRows: [
                ...(data.summaryRows?.filter((row) => !row.customerDebt) ?? []),
                ...(data.invoiceBalanceRow ? [data.invoiceBalanceRow] : []),
              ],
              invoiceBalanceRow: undefined,
            };
        printDocument(printable, { ...options, paperSize });
      }}
    >
      {hasCustomerDebt(pending.data) && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={includeCustomerDebt}
            onChange={(event) => setIncludeCustomerDebt(event.target.checked)}
          />
          <span className="text-sm">
            <span className="block font-medium">In công nợ cũ</span>
            <span className="block text-muted-foreground">Bỏ chọn để ẩn nợ cũ và dư nợ tích lũy trong lần in này.</span>
          </span>
        </label>
      )}
    </PrintSizePickerDialog>
  );

  return { printRetailInvoice, printPreparedRetailInvoice, printerDialog };
}
