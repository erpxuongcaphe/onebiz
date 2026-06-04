/**
 * Printer module — barrel exports
 */

export {
  EscPosBuilder,
  PAPER_COLS,
  stripDiacritics,
  type Align,
  type PaperWidth,
  type TextSize,
  type TextStyle,
} from "./escpos";

export {
  isWebUsbSupported,
  isSecureContext,
  requestPrinter,
  sendToUsbPrinter,
  savePrinter,
  loadPrinter,
  clearPrinter,
  // CEO 04/06/2026 — Sprint 5: multi-role printer API
  savePrinterByRole,
  loadPrinterByRole,
  clearPrinterByRole,
  isSamePrinterAcrossRoles,
  type ConnectedPrinter,
  type StoredPrinter,
  type PrinterRole,
} from "./webusb-printer";

export {
  PrinterService,
  printerService,
  printReceipt,
  testPrint,
  type PrinterBackend,
  type PrintReceiptPayload,
  type PrintResult,
  type PrinterServiceOptions,
} from "./printer-service";
