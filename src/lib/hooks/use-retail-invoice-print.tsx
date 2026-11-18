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
  const [pending, setPending] = useState<{
    code: string;
    data?: DocumentPrintData;
    options?: PrintOptions;
    request?: symbol;
  } | null>(null);
  const [includeCustomerDebt, setIncludeCustomerDebt] = useState(true);

  const openPicker = useCallback((data: DocumentPrintData, options?: PrintOptions) => {
    setIncludeCustomerDebt(true);
    setPending({ code: data.documentCode, data, options });
  }, []);

  const openPreparingRetailInvoice = useCallback((code: string, options?: PrintOptions) => {
    const request = Symbol();
    setIncludeCustomerDebt(true);
    setPending({ code, request, options });
    return (data: DocumentPrintData | null, resolvedOptions = options) => {
      setPending(current => {
        if (current?.request !== request) return current;
        return data ? { ...current, data, options: resolvedOptions } : null;
      });
    };
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
      title={`In hóa đơn ${pending.code}`}
      defaultPaperSize={pending.options?.paperSize}
      printDisabled={!pending.data}
      onPrint={(paperSize: PaperSize) => {
        const { data, options } = pending;
        if (!data) return;
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
      {!pending.data && <p role="status" className="text-sm text-muted-foreground">Đang chuẩn bị nội dung hóa đơn…</p>}
      {(!pending.data || hasCustomerDebt(pending.data)) && (
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

  return { printRetailInvoice, printPreparedRetailInvoice, openPreparingRetailInvoice, printerDialog };
}
