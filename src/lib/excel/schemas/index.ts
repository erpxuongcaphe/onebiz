/**
 * Excel schemas — barrel exports
 *
 * Mỗi module có 1 schema để generate template + export + parse upload.
 */

export {
  productExcelSchema,
  type ProductImportRow,
} from "./products";

export {
  customerExcelSchema,
  type CustomerImportRow,
} from "./customers";

export {
  supplierExcelSchema,
  type SupplierImportRow,
} from "./suppliers";

export {
  cashTransactionExcelSchema,
  type CashTransactionImportRow,
} from "./cash-transactions";

export {
  debtOpeningExcelSchema,
  type DebtOpeningImportRow,
} from "./debt-opening";

export {
  initialStockExcelSchema,
  type InitialStockImportRow,
} from "./initial-stock";

export {
  purchaseOrderExcelSchema,
  type PurchaseOrderImportRow,
} from "./purchase-orders";

export {
  internalSaleExcelSchema,
  type InternalSaleImportRow,
} from "./internal-sales";
