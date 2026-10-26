import { getClient, handleError } from './base';

export interface SupplyProduct { id: string; code: string; name: string; unit: string; matchKind?: import('@/lib/smart-search').SearchMatchKind }
export interface SupplyWarehouse { id: string; name: string; supplierId: string }
export interface SupplyOrderInput {
  branchId: string; warehouseId: string; requestId: string;
  items: Array<{ productId: string; quantity: number; note?: string }>; note: string;
}
export interface SupplyOrderResult {
  purchaseOrderId: string; code: string; salesOrderId: string; salesOrderCode: string; total: number;
}
function handleWarehouseError(error: { message: string; code?: string }, context: string): never {
  if (error.code === 'PGRST202' || error.code === '42883') {
    throw new Error('Chức năng đặt kho tổng chưa được bật trên môi trường này. Vui lòng liên hệ quản trị.');
  }
  return handleError(error, context);
}
export interface SupplyOrderLink { purchaseOrderId: string; salesOrderCode: string; processed: boolean; cancelled: boolean; revision?: number; blockedReason?: string | null }
export interface SupplyOrderChangeDetail {
  purchaseOrderId: string; code: string; salesOrderCode: string; branchId: string; warehouseId: string;
  revision: number; items: Array<SupplyProduct & { quantity: number; note?: string }>; note: string; blockedReason: string | null;
}
export async function getWarehouseOrderForChange(id: string): Promise<SupplyOrderChangeDetail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)('get_fnb_warehouse_order_for_change', { p_purchase_order_id: id });
  if (error) handleWarehouseError(error, 'getWarehouseOrderForChange');
  if (!data || data.purchaseOrderId !== id || !Number.isInteger(data.revision) || !Array.isArray(data.items)) throw new Error('Chưa tải đủ phiếu đặt. Vui lòng mở lại.');
  return data;
}
export interface SupplyOrderChangeInput {
  purchaseOrderId: string; expectedRevision: number; requestId: string; action: 'edit' | 'cancel';
  items?: SupplyOrderInput['items']; note?: string; reason: string;
}
export async function changeWarehouseOrder(input: SupplyOrderChangeInput): Promise<void> {
  if (!input.requestId || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.reason.trim().length < 3 || input.reason.length > 1000) throw new Error('Nhập lý do thay đổi/hủy từ 3 đến 1000 ký tự.');
  if (input.action === 'edit' && (!input.items?.length || input.items.length > 500 || input.items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0 || (i.note?.length ?? 0) > 2000))) throw new Error('Kiểm tra mặt hàng, số lượng và ghi chú.');
  // Keep the request key on retry after an uncertain/lost response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)('change_fnb_warehouse_order', {
    p_purchase_order_id: input.purchaseOrderId, p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId, p_action: input.action, p_items: input.action === 'edit' ? input.items : null,
    p_note: input.action === 'edit' ? input.note ?? '' : null, p_reason: input.reason,
  });
  if (error) handleWarehouseError(error, 'changeWarehouseOrder');
  if (data?.purchaseOrderId !== input.purchaseOrderId || data?.action !== input.action || data?.revision !== input.expectedRevision + 1) throw new Error('Chưa nhận được xác nhận đồng bộ. Giữ nội dung và thử lại cùng thao tác.');
}
export async function getWarehouseOrderLinks(ids: string[]): Promise<SupplyOrderLink[]> {
  if (!ids.length) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)('get_fnb_purchase_order_links', { p_ids: ids });
  // Allows deploying the UI before its migration; other failures are visible.
  if (error?.code === 'PGRST202' || error?.code === '42883') return [];
  if (error) handleError(error, 'getWarehouseOrderLinks');
  return (data ?? []) as SupplyOrderLink[];
}
export async function getWarehouseOrderContext(branchId: string, search = '') {
  // New RPCs are intentionally separate from the generic purchase save path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)('get_fnb_warehouse_order_context', {
    p_branch_id: branchId, p_search: search,
  });
  if (error) handleWarehouseError(error, 'getWarehouseOrderContext');
  if (!data || !Array.isArray(data.warehouses) || !Array.isArray(data.products)) {
    throw new Error('Không đọc được danh mục đặt kho tổng.');
  }
  return data as { warehouses: SupplyWarehouse[]; products: SupplyProduct[] };
}
export async function submitWarehouseOrder(input: SupplyOrderInput): Promise<SupplyOrderResult> {
  if (!input.items.length || input.items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
    throw new Error('Nhập số lượng hợp lệ cho từng mặt hàng.');
  }
  if (input.items.some(i => i.note !== undefined && (typeof i.note !== 'string' || i.note.length > 2000))) {
    throw new Error('Ghi chú mỗi mặt hàng tối đa 2000 ký tự.');
  }
  // The durable request ID is reused on retry, including a lost success response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient().rpc as any)('submit_fnb_warehouse_order', {
    p_branch_id: input.branchId, p_warehouse_id: input.warehouseId,
    p_request_id: input.requestId, p_items: input.items, p_note: input.note || null,
  });
  if (error) handleWarehouseError(error, 'submitWarehouseOrder');
  if (!data?.purchaseOrderId || !data?.salesOrderId || !data?.code || !data?.salesOrderCode) {
    throw new Error('Chưa nhận được xác nhận gửi đơn. Bấm gửi lại để kiểm tra cùng đơn này.');
  }
  return data as SupplyOrderResult;
}
