import { getClient, handleError } from './base';

function explainReceiptError(error: {message: string}): never {
  const messages: Record<string, string> = {
    INTERNAL_RECEIVE_BRANCH_DENIED: 'Anh/chị không có quyền nhận hàng tại chi nhánh này.',
    INTERNAL_RECEIVE_DENIED: 'Tài khoản chưa được cấp quyền nhận hàng.',
    INTERNAL_RECEIVE_ADJUST_DENIED: 'Tài khoản chưa được cấp quyền sửa số đã nhận.',
    INTERNAL_RECEIVE_REVISION_CHANGED: 'Phiếu đã được người khác sửa. Bấm Cập nhật rồi kiểm tra số thực nhận mới nhất.',
    INTERNAL_RECEIVE_EXCEEDS_DISPATCHED: 'Tổng thực nhận vượt số theo đơn. Kiểm tra lại số lượng hoặc yêu cầu kho sửa đơn giao.',
    INTERNAL_RECEIVE_ADJUST_STOCK_INSUFFICIENT: 'Số hàng cần sửa giảm đã được sử dụng. Cần đối chiếu lại tồn và chứng từ trước khi sửa; chưa thay đổi kho.',
    INTERNAL_RECEIVE_ADJUST_COST_REVIEW_REQUIRED: 'Chứng từ đã phát sinh sử dụng hàng sau lần nhận này. Cần người có quyền kiểm tra trước khi sửa; chưa thay đổi kho.',
    INTERNAL_RECEIVE_ORDER_NOT_OPEN: 'Đơn đã hủy hoặc đã nhập theo quy trình cũ. Bấm Cập nhật để kiểm tra.',
    INTERNAL_RECEIVE_QUANTITY_INVALID: 'Số thực nhận phải từ 0 trở lên và có tối đa 4 chữ số thập phân.',
    INTERNAL_RECEIVE_REQUEST_CHANGED: 'Yêu cầu này đã được ghi nhận với nội dung khác. Bấm Cập nhật để đối chiếu trước khi nhập tiếp.',
  };
  const message = Object.entries(messages).find(([code]) => error.message.includes(code))?.[1];
  if (message) throw new Error(message);
  handleError(error, 'receiveInternalSale');
  throw new Error('Chưa xác nhận được nhận hàng. Bấm Cập nhật để kiểm tra trước khi nhập tiếp.');
}

export interface InternalReceivingItem { id: string; productId: string; code: string; name: string; unit: string; dispatched: number; received: number }
export interface InternalReceipt { id: string; createdAt: string; updatedAt: string; revision: number; note?: string; createdBy: string; items: { itemId: string; quantity: number }[] }
export interface InternalReceivingOrder { id: string; code: string; createdAt: string; fromBranch: string; invoiceId: string; items: InternalReceivingItem[]; receipts: InternalReceipt[] }
export async function getInternalReceivingWorkspace(branchId: string): Promise<InternalReceivingOrder[]> {
  // RPC enforces actor + tenant + destination branch and omits all prices/costs.
  const { data, error } = await (getClient().rpc as any)('get_internal_receiving_workspace', { p_branch_id: branchId });
  if (error) handleError(error, 'getInternalReceivingWorkspace');
  return (Array.isArray(data) ? data : []).map((order: InternalReceivingOrder) => ({ ...order, items: order.items ?? [], receipts: order.receipts ?? [] }));
}
export async function receiveInternalSale(input: { saleId: string; requestId: string; items: { itemId: string; quantity: number }[]; note?: string; receiptId?: string; expectedRevision?: number }) {
  const { data, error } = await (getClient().rpc as any)('receive_internal_sale_actual', {
    p_sale_id: input.saleId, p_items: input.items, p_request_id: input.requestId, p_note: input.note || null,
    p_receipt_id: input.receiptId || null, p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) explainReceiptError(error);
  return data as { receiptId: string; revision?: number; replayed: boolean };
}
