/**
 * Mock service barrel — RESIDUAL
 *
 * Hầu hết mock services đã được dọn dẹp khi backend Supabase đi vào hoạt động.
 * 3 file còn lại là các "stub" cho các thực thể CHƯA có bảng DB tương ứng,
 * và đang được re-export từ `lib/services/supabase/{orders,inventory,purchase-entries}.ts`:
 *
 *   - orders.ts          → /don-hang/dat-hang (sales orders)
 *   - inventory.ts       → manufacturing / disposal / internal exports
 *   - purchase-entries.ts → đặt hàng nhập / trả hàng nhập / hóa đơn đầu vào
 *
 * Khi schema DB được mở rộng cho 3 nhóm này, xóa nốt và chuyển hoàn toàn sang Supabase.
 */

export { getOrders, getOrderStatuses } from "./orders";
export {
  getManufacturingOrders,
  getManufacturingStatuses,
  getDisposalExports,
  getDisposalStatuses,
  getInternalExports,
  getInternalExportStatuses,
} from "./inventory";
export {
  getPurchaseOrderEntries,
  getPurchaseOrderStatuses as getPurchaseEntryStatuses,
  getPurchaseReturns,
  getPurchaseReturnStatuses,
  getInputInvoices,
  getInputInvoiceStatuses,
} from "./purchase-entries";
