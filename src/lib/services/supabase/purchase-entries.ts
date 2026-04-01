/**
 * Supabase service: Purchase Entries (Đặt hàng nhập, Trả hàng nhập, Hóa đơn đầu vào)
 *
 * No dedicated DB tables for these entities yet.
 * Re-export from mock services until schema is extended.
 */

export {
  getPurchaseOrderEntries,
  getPurchaseOrderStatuses as getPurchaseEntryStatuses,
  getPurchaseReturns,
  getPurchaseReturnStatuses,
  getInputInvoices,
  getInputInvoiceStatuses,
} from "../mock/purchase-entries";
