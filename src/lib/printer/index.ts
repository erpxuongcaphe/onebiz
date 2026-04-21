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
  type ConnectedPrinter,
  type StoredPrinter,
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
