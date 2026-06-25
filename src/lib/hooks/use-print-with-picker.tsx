"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  printDocument,
  type DocumentPrintData,
  type PaperSize,
} from "@/lib/print-document";
import { resolvePrintTemplate } from "@/lib/services";
import type { PrintChannel, PrintDocType } from "@/lib/services";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { PrintSizePickerDialog } from "@/components/shared/dialogs/print-size-picker-dialog";

/**
 * Ngữ cảnh mẫu in V3 cho 1 lần in. Truyền kèm để hook thử áp mẫu
 * (Cài đặt In V3) TRƯỚC khi mở picker cỡ giấy.
 */
export interface PrintTemplateContext {
  channel: PrintChannel;
  docType: PrintDocType;
  /** null/undefined = mẫu global toàn chuỗi. */
  branchId?: string | null;
}

/**
 * Hook: wrap `printDocument` với dialog chọn cỡ giấy.
 *
 * In V3 (P6a): nếu truyền `templateCtx` và tenant CÓ mẫu in cho
 * (channel × docType × branch) → áp mẫu + in luôn theo paperSize của mẫu,
 * BỎ QUA picker. Nếu CHƯA có mẫu (hoặc resolve lỗi) → mở picker như cũ
 * (zero-regression: tenant chưa có mẫu thì hành vi y hệt trước).
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
  printerDialog: ReactNode;
} {
  const [pendingData, setPendingData] = useState<DocumentPrintData | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string>("Chọn cỡ giấy in");
  const [open, setOpen] = useState(false);

  const printWithPicker = useCallback(
    (data: DocumentPrintData, title?: string, templateCtx?: PrintTemplateContext) => {
      // Không có ngữ cảnh mẫu → giữ luồng cũ: mở picker ngay.
      if (!templateCtx) {
        setPendingData(data);
        setPendingTitle(title ?? "Chọn cỡ giấy in");
        setOpen(true);
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
            // Có mẫu → in theo mẫu, bỏ qua picker.
            const out = applyTemplateToDocData(data, resolved);
            printDocument(out, { paperSize: resolved.paperSize });
            return;
          }
          // Chưa có mẫu → picker như cũ.
          setPendingData(data);
          setPendingTitle(title ?? "Chọn cỡ giấy in");
          setOpen(true);
        })
        .catch(() => {
          // Lỗi resolve → fallback picker (không chặn in).
          setPendingData(data);
          setPendingTitle(title ?? "Chọn cỡ giấy in");
          setOpen(true);
        });
    },
    [],
  );

  const handlePrint = useCallback(
    (paperSize: PaperSize) => {
      if (pendingData) {
        printDocument(pendingData, { paperSize });
      }
      setPendingData(null);
    },
    [pendingData]
  );

  const printerDialog = (
    <PrintSizePickerDialog
      open={open}
      onOpenChange={setOpen}
      title={pendingTitle}
      onPrint={handlePrint}
    />
  );

  return { printWithPicker, printerDialog };
}
