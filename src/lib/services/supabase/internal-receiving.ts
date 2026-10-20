import { getClient, getCurrentTenantId, handleError } from './base';

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
    INTERNAL_RECEIVE_POLICY_REVIEW_REQUIRED: 'Chưa xác định được công dụng hoặc quy đổi nguyên liệu. Cần kiểm tra cấu hình hàng trước khi nhận; tồn và chi phí chưa thay đổi.',
    INTERNAL_RECEIVE_EXPENSE_CATEGORY_REQUIRED: 'Chưa có khoản mục vật tư vận hành nội bộ hợp lệ. Cần kiểm tra khoản mục; phiếu nhận chưa được ghi nhận.',
    INTERNAL_RECEIVE_CONVERSION_PRECISION_REVIEW: 'Quy đổi này làm lệch số lượng hoặc giá trị nhận. Cần kiểm tra lại đơn vị và số thực nhận; tồn và chi phí chưa thay đổi.',
    INTERNAL_RECEIVE_EXPENSE_PRECISION_REVIEW: 'Phân bổ giá trị các lần nhận chưa khớp đơn gốc. Cần đối chiếu trước khi ghi nhận; tồn và chi phí chưa thay đổi.',
    INTERNAL_RECEIVE_USAGE_DENIED: 'Tài khoản chưa có quyền xác nhận lại công dụng hàng. Cần quyền sửa hàng hóa và điều chỉnh tồn.',
    INTERNAL_RECEIVE_USAGE_REASON_REQUIRED: 'Cần ghi lý do chọn nhập tồn trước khi nhận hàng.',
    INTERNAL_RECEIVE_USAGE_LOCKED: 'Dòng hàng đã có lịch sử nhận. Không thể đổi cách ghi nhận tồn hoặc chi phí.',
    INTERNAL_RECEIVE_USAGE_INVALID: 'Cách ghi nhận không phù hợp với công dụng hoặc quy đổi đã xác minh. Kiểm tra lại cấu hình hàng trước khi nhận.',
    INTERNAL_RECEIVE_REQUEST_CHANGED: 'Yêu cầu này đã được ghi nhận với nội dung khác. Bấm Cập nhật để đối chiếu trước khi nhập tiếp.',
  };
  const message = Object.entries(messages).find(([code]) => error.message.includes(code))?.[1];
  if (message) throw new Error(message);
  handleError(error, 'receiveInternalSale');
  throw new Error('Chưa xác nhận được nhận hàng. Bấm Cập nhật để kiểm tra trước khi nhập tiếp.');
}

export interface InternalReceivingItem {
  id: string; productId: string; code: string; name: string; unit: string; dispatched: number; received: number;
  treatment?: 'stock' | 'expense' | 'review'; receivingProductId?: string; receivingProductCode?: string;
  receivingFactor?: number; receivingUnit?: string; receivingReason?: string;
}
export interface InternalReceipt { id: string; createdAt: string; updatedAt: string; revision: number; note?: string; createdBy: string; items: { itemId: string; quantity: number; inputQuantity?: number; inputUnit?: string; conversionFactor?: number; stockUnit?: string }[] }
export interface InternalReceivingOrder {
  id: string; code: string; createdAt: string; fromBranch: string; invoiceId: string; policyVersion?: number;
  status?: 'draft' | 'confirmed' | 'completed' | 'cancelled'; receiptMode?: 'actual' | 'legacy';
  fromBranchId?: string; toBranchId?: string; toBranch?: string; createdBy?: string; note?: string;
  items: InternalReceivingItem[]; receipts: InternalReceipt[];
}
export async function getInternalReceivingWorkspace(branchId: string): Promise<InternalReceivingOrder[]> {
  // RPC enforces actor + tenant + destination branch and omits all prices/costs.
  const { data, error } = await (getClient().rpc as any)('get_internal_receiving_workspace', { p_branch_id: branchId });
  if (error) handleError(error, 'getInternalReceivingWorkspace');
  const orders: InternalReceivingOrder[] = (Array.isArray(data) ? data : []).map((order: InternalReceivingOrder) => ({ ...order, items: order.items ?? [], receipts: order.receipts ?? [] }));
  const ids = [...new Set(orders.flatMap(order => order.receipts.map(receipt => receipt.id)))];
  if (ids.length) {
    const tenant = await getCurrentTenantId();
    const entries: Array<{reference_id:string;result?:{revision?:number};snapshots?:InternalReceipt['items']}> = [];
    for(let start=0;start<ids.length;start+=100) {
      for(let offset=0;;offset+=500) {
        const {data:batch,error:snapshotError}=await (getClient().from as any)('operational_uom_requests').select('reference_id,snapshots,result,created_at,request_id').eq('tenant_id',tenant).eq('reference_type','internal_receipt').in('reference_id',ids.slice(start,start+100)).order('created_at',{ascending:false}).order('request_id',{ascending:false}).range(offset,offset+499);
        if(snapshotError) handleError(snapshotError,'getInternalReceivingWorkspace:units');
        entries.push(...batch??[]);
        if(!batch || batch.length<500) break;
      }
    }
    const newest = new Map<string, any>();
    for (const entry of entries ?? []) if (!newest.has(entry.reference_id) || Number(entry.result?.revision ?? 0) > Number(newest.get(entry.reference_id).result?.revision ?? 0)) newest.set(entry.reference_id,entry);
    for (const order of orders) for (const receipt of order.receipts) receipt.items = receipt.items.map(item => {
      const snapshot = newest.get(receipt.id)?.snapshots?.find((row: any) => row.itemId === item.itemId);
      return snapshot ? {...item,inputQuantity:snapshot.inputQuantity,inputUnit:snapshot.inputUnit,conversionFactor:snapshot.conversionFactor,stockUnit:snapshot.stockUnit} : item;
    });
  }
  return orders;
}
export async function receiveInternalSale(input: { saleId: string; requestId: string; items: { itemId: string; quantity: number; inputUnit?: string; expectedFactor?: number; receivingTreatment?: 'stock' | 'expense' }[]; note?: string; receiptId?: string; expectedRevision?: number }) {
  const { data, error } = await (getClient().rpc as any)(input.items.some(item => item.inputUnit) ? 'receive_internal_sale_with_uom' : 'receive_internal_sale_actual', {
    p_sale_id: input.saleId, p_items: input.items, p_request_id: input.requestId, p_note: input.note || null,
    p_receipt_id: input.receiptId || null, p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) explainReceiptError(error);
  return data as { receiptId: string; revision?: number; replayed: boolean };
}
