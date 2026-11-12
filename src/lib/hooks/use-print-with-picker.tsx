"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  printDocument,
  type DocumentPrintData,
  type PaperSize,
  type PrintOptions,
} from "@/lib/print-document";
import { resolvePrintTemplate } from "@/lib/services";
import type { PrintChannel, PrintDocType } from "@/lib/services";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { PrintSizePickerDialog } from "@/components/shared/dialogs/print-size-picker-dialog";
import { getPrintSettings } from "@/lib/printer/print-job";

/**
 * Ngữ cảnh mẫu in V3 cho 1 lần in. Truyền kèm để hook thử áp mẫu
 * (Cài đặt In V3) TRƯỚC khi mở picker cỡ giấy.
 */
export interface PrintTemplateContext {
  channel: PrintChannel;
  docType: PrintDocType;
  /** null/undefined = mẫu global toàn chuỗi. */
  branchId?: string | null;
  /** In từng hóa đơn Retail: cho xác nhận hiển thị công nợ trước khi gửi lệnh in. */
  chooseCustomerDebt?: boolean;
}

function hasCustomerDebt(data?: DocumentPrintData | null): boolean {
  return !!data?.summaryRows?.some((row) => row.customerDebt);
}

/**
 * Hook: wrap `printDocument` với dialog chọn cỡ giấy.
 *
 * In V3 (P6a): nếu truyền `templateCtx` và tenant CÓ mẫu in cho
 * (channel × docType × branch) → áp mẫu và dùng khổ giấy của mẫu.
 * In từng hóa đơn Retail có công nợ mở picker để xác nhận trước khi in.
 * Nếu không có mẫu hoặc không tải được mẫu thì mở picker chọn khổ giấy.
 *
 * Dùng:
 * ```tsx
 * const { printWithPicker, printerDialog } = usePrintWithPicker();
 *
 * // Trong rowActions:
 * onClick: () => printWithPicker(buildInvoicePrintData(row), "In hóa đơn",
 *   { channel: "retail", docType: "sale_invoice", branchId: activeBranchId })
 *
 * // Cuối JSX:
 * {printerDialog}
 * ```
 */
export function usePrintWithPicker(): {
  printWithPicker: (
    data: DocumentPrintData,
    title?: string,
    templateCtx?: PrintTemplateContext,
  ) => void;
  printPreparedRetailInvoice: typeof printDocument;
  printerDialog: ReactNode;
} {
  const [pendingData, setPendingData] = useState<DocumentPrintData | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string>("Chọn cỡ giấy in");
  const [open, setOpen] = useState(false);
  const [pendingContext, setPendingContext] = useState<PrintTemplateContext>();
  const [defaultPaperSize, setDefaultPaperSize] = useState<PaperSize>();
  const [offerCustomerDebt, setOfferCustomerDebt] = useState(false);

  const openPicker = useCallback((
    data: DocumentPrintData,
    title: string,
    defaultSize?: PaperSize,
    context?: PrintTemplateContext,
    chooseCustomerDebt = false,
  ) => {
    setPendingData(data);
    setPendingTitle(title);
    setDefaultPaperSize(defaultSize);
    setPendingContext(context);
    setOfferCustomerDebt(chooseCustomerDebt);
    setOpen(true);
  }, []);

  const printPreparedRetailInvoice = useCallback((data: DocumentPrintData, options?: PrintOptions) => {
    if (hasCustomerDebt(data)) {
      openPicker(data, `In hóa đơn ${data.documentCode}`, options?.paperSize ?? "A4", undefined, true);
    } else {
      printDocument(data, options);
    }
  }, [openPicker]);

  const printWithPicker = useCallback(
    (data: DocumentPrintData, title?: string, templateCtx?: PrintTemplateContext) => {
      const fnbInvoice = templateCtx?.channel === "fnb" && templateCtx.docType === "sale_invoice";
      const chooseCustomerDebt = templateCtx?.channel === "retail" &&
        templateCtx.docType === "sale_invoice" && templateCtx.chooseCustomerDebt === true;
      const configuredPaper = getPrintSettings().paperSize;
      const printableData = fnbInvoice ? { ...data, fnbThermalReadable: true } : data;
      const showFallbackPicker = () => openPicker(
        printableData,
        title ?? "Chọn cỡ giấy in",
        fnbInvoice ? (configuredPaper === "58mm" ? "58mm" : "80mm") : undefined,
        templateCtx,
        chooseCustomerDebt,
      );
      // Không có ngữ cảnh mẫu → giữ luồng cũ: mở picker ngay.
      if (!templateCtx) {
        showFallbackPicker();
        return;
      }
      // Có ngữ cảnh → thử áp mẫu In V3. Resolve bất đồng bộ, không chặn UI.
      void resolvePrintTemplate(
        templateCtx.channel,
        templateCtx.docType,
        templateCtx.branchId ?? null,
      )
        .then((resolved) => {
          if (resolved) {
            // Mẫu đã áp dụng quyết định có khối công nợ để đưa ra lựa chọn hay không.
            const out = applyTemplateToDocData(printableData, resolved);
            if (chooseCustomerDebt) {
              printPreparedRetailInvoice(out, { paperSize: resolved.paperSize });
            } else {
              printDocument(out, { paperSize: resolved.paperSize, branchId: fnbInvoice ? templateCtx.branchId ?? undefined : undefined });
            }
            return;
          }
          // Chưa có mẫu → picker như cũ.
          showFallbackPicker();
        })
        .catch(() => {
          // Lỗi resolve → fallback picker (không chặn in).
          showFallbackPicker();
        });
    },
    [openPicker, printPreparedRetailInvoice],
  );

  const handlePrint = useCallback(
    (paperSize: PaperSize, includeCustomerDebt?: boolean) => {
      if (pendingData) {
        const data = offerCustomerDebt && includeCustomerDebt === false && hasCustomerDebt(pendingData)
          ? {
              ...pendingData,
              summaryRows: [
                ...(pendingData.summaryRows?.filter((row) => !row.customerDebt) ?? []),
                ...(pendingData.invoiceBalanceRow ? [pendingData.invoiceBalanceRow] : []),
              ],
              invoiceBalanceRow: undefined,
            }
          : pendingData;
        printDocument(data, { paperSize, branchId: pendingContext?.channel === "fnb" && pendingContext.docType === "sale_invoice" ? pendingContext.branchId ?? undefined : undefined });
      }
      setPendingData(null);
    },
    [pendingData, pendingContext, offerCustomerDebt]
  );

  const printerDialog = (
    <PrintSizePickerDialog
      key={pendingData?.documentCode}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setPendingData(null);
      }}
      title={pendingTitle}
      onPrint={handlePrint}
      defaultPaperSize={defaultPaperSize}
      showCustomerDebtChoice={offerCustomerDebt && hasCustomerDebt(pendingData)}
    />
  );

  return { printWithPicker, printPreparedRetailInvoice, printerDialog };
}
