"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  printDocument,
  type DocumentPrintData,
  type PaperSize,
} from "@/lib/print-document";
import { PrintSizePickerDialog } from "@/components/shared/dialogs/print-size-picker-dialog";

/**
 * Hook: wrap `printDocument` với dialog chọn cỡ giấy.
 *
 * Dùng:
 * ```tsx
 * const { printWithPicker, printerDialog } = usePrintWithPicker();
 *
 * // Trong rowActions:
 * onClick: () => printWithPicker(buildInvoicePrintData(row), "In hóa đơn")
 *
 * // Cuối JSX:
 * {printerDialog}
 * ```
 */
export function usePrintWithPicker(): {
  printWithPicker: (data: DocumentPrintData, title?: string) => void;
  printerDialog: ReactNode;
} {
  const [pendingData, setPendingData] = useState<DocumentPrintData | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string>("Chọn cỡ giấy in");
  const [open, setOpen] = useState(false);

  const printWithPicker = useCallback(
    (data: DocumentPrintData, title?: string) => {
      setPendingData(data);
      setPendingTitle(title ?? "Chọn cỡ giấy in");
      setOpen(true);
    },
    []
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
