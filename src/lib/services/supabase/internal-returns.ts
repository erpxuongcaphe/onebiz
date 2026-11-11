import { getClient } from './base';

export interface InternalReturnItem {
  id:string; sale_item_id:string; product_code:string; product_name:string; unit:string; receiving_unit:string;
  factor:number; quantity:number; received:number; credit_per_unit:number;
}
export interface InternalReturn {
  id:string; code:string; sale_id:string; sale_code:string; from_branch_id:string; to_branch_id:string;
  from_branch_name:string; to_branch_name:string; created_at:string; created_by_name:string; reason:string;
  status:'sent'|'partial'|'received'; invoice_debt:number; items:InternalReturnItem[];
  events:{id:string;action:'sent'|'received';created_at:string;actor_name:string;note:string;credit_amount:number;debt_reduced:number;refund_pending:number}[];
}
const explanations:Record<string,string>={
  RETURN_SETTLE_DENIED:'Bạn cần quyền xử lý công nợ trả nội bộ tại Kho Tổng.',
  RETURN_REFUND_DENIED:'Hoàn tiền cần thêm quyền tạo phiếu thu/chi.',
  RETURN_CREDIT_NOT_CONFIRMED:'Kho Tổng chưa xác nhận khoản nhận trả này. Chưa được xử lý công nợ.',
  RETURN_SETTLEMENT_INVALID:'Nhập số tiền lớn hơn 0 và lý do từ 3 đến 500 ký tự.',
  RETURN_CREDIT_EXCEEDED:'Số tiền vượt khoản chờ hoàn/cấn trừ còn lại. Cập nhật để kiểm tra.',
  RETURN_OFFSET_TARGET_INVALID:'Chỉ cấn vào hóa đơn đã hoàn thành của cùng chi nhánh nhận hàng và Kho Tổng xuất hàng.',
  RETURN_OFFSET_EXCEEDS_DEBT:'Hóa đơn được chọn không còn đủ nợ để cấn số tiền này.',
  RETURN_REFUND_ACCOUNT_INVALID:'Chọn quỹ tiền mặt hoặc tài khoản ngân hàng đang hoạt động của Kho Tổng.',
  RETURN_CREDIT_LEDGER_MISMATCH:'Số dư chờ hoàn chưa khớp lịch sử xử lý. Chưa thay đổi tiền hoặc công nợ; cần đối soát.',
  RETURN_LIST_DENIED:'Bạn cần quyền xem phiếu trả nội bộ tại chi nhánh đang chọn.',
  RETURN_SCOPE_DENIED:'Tài khoản chưa được phép thao tác trả hàng tại chi nhánh này.',
  RETURN_SEND_DENIED:'Cần quyền gửi trả hàng nội bộ tại chi nhánh.',
  RETURN_RECEIVE_DENIED:'Cần quyền xác nhận nhận trả tại Kho Tổng.',
  RETURN_EXCEEDS_RECEIVED:'Số trả vượt số đã nhận còn được trả. Cập nhật phiếu rồi kiểm tra lại.',
  RETURN_STOCK_INSUFFICIENT:'Tồn chi nhánh không đủ để gửi trả. Kiểm tra số thực tế và tồn trước khi gửi.',
  RETURN_NON_STOCK_ITEM:'Dòng này đã ghi chi phí vật tư, chưa nhập tồn. Chưa hỗ trợ trả bằng luồng hàng tồn; cần đối soát chi phí riêng.',
  RETURN_ORIGINAL_COST_MISSING:'Phiếu gốc chưa có giá vốn đã chốt. Cần đối soát giá vốn trước khi hoàn kho.',
  RETURN_SOURCE_LINE_AMBIGUOUS:'Dòng hàng trên hóa đơn gốc chưa ghép duy nhất với phiếu nội bộ. Cần đối chiếu chứng từ trước khi trả.',
  RETURN_CONVERSION_PRECISION:'Quy đổi số trả làm lẻ quá 4 chữ số. Kiểm tra số lượng theo đơn vị gốc.',
  RETURN_RECEIVE_QUANTITY_INVALID:'Số nhận phải lớn hơn 0 và không vượt số đang chờ nhận.',
  RETURN_ALREADY_RECEIVED:'Phiếu đã nhận đủ. Cập nhật danh sách để xem lịch sử.',
  RETURN_REQUEST_CHANGED:'Nội dung yêu cầu đã thay đổi. Cập nhật phiếu để đối chiếu trước khi thao tác tiếp.',
  RETURN_SOURCE_NOT_RECEIVED:'Chỉ trả hàng từ phiếu nội bộ đã hoàn thành và có số đã nhận.',
  RETURN_REASON_REQUIRED:'Nhập lý do trả từ 3 đến 500 ký tự.',
  RETURN_QUANTITY_INVALID:'Số gửi trả phải lớn hơn 0 và có tối đa 4 chữ số thập phân.',
  RETURN_ITEMS_INVALID:'Chọn từ 1 đến 200 dòng hàng để gửi/nhận trả.',
  RETURN_DUPLICATE_ITEM:'Một mặt hàng đang bị chọn lặp. Tải lại phiếu và kiểm tra trước khi xác nhận.',
  RETURN_ITEM_SCOPE_INVALID:'Dòng hàng không thuộc phiếu đang chọn. Tải lại phiếu để kiểm tra.',
  RETURN_INVOICE_MISSING:'Không tìm thấy hóa đơn gốc hợp lệ. Chưa thay đổi tồn hoặc công nợ.',
  RETURN_SOURCE_PRICE_INVALID:'Giá trị trả trên phiếu gốc chưa hợp lệ. Cần đối chiếu giá và giảm giá trước khi trả.',
  RETURN_CUSTOMER_MISSING:'Hóa đơn gốc chưa có đối tượng công nợ nội bộ hợp lệ. Chưa nhận trả hoặc đổi tồn.',
  FNB_BRANCH_COST_REQUIRED:'Sổ giá vốn chi nhánh chưa đủ số lượng để xuất trả. Cần đối chiếu phiếu nhập và giá vốn; kho chưa thay đổi.',
  FNB_COST_SHORTFALL_LEDGER_MISMATCH:'Sổ giá vốn còn chênh lệch cần đối chiếu. Chưa ghi nhận phiếu hoặc thay đổi tồn.',
  RETURN_RECEIPT_BELOW_SENT:'Hàng đã gửi trả. Không được sửa số đã nhận xuống dưới số đã trả.',
};
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
  const {data,error}=await (getClient().rpc as any)(name,args);
  if(error) {
    const message=Object.entries(explanations).find(([key])=>error.message?.includes(key))?.[1];
    const failure=new Error(message??'Chưa xác nhận được kết quả. Thử lại cùng yêu cầu; hệ thống chống ghi trùng.');
    Object.assign(failure,{confirmedRollback:!!message&&error.code==='P0001'});
    throw failure;
  }
  return data as T;
}
export const getInternalReturns=(branch:string,sale?:string)=>rpc<InternalReturn[]>('get_internal_stock_returns',{p_branch_id:branch,p_sale_id:sale??null});
export interface InternalReturnFinance {
  credits:{id:string;createdAt:string;original:number;remaining:number}[];
  invoices:{id:string;code:string;debt:number}[];
  accounts:{id:string;name:string;kind:'cash'|'bank'}[];
  history:{id:string;kind:'offset'|'refund';amount:number;note:string;createdAt:string;actor:string;invoice?:string;cash?:string}[];
}
export type ReturnSettlement={event:string;kind:'offset'|'refund';amount:number;target:string;note:string;requestId:string};
export const getInternalReturnFinance=(id:string)=>rpc<InternalReturnFinance>('get_internal_return_finance',{p_return_id:id});
export const settleInternalReturn=(p:ReturnSettlement)=>rpc<{id:string;remaining:number}>('settle_internal_return_credit',{
  p_event_id:p.event,p_kind:p.kind,p_amount:p.amount,p_target_id:p.target,p_note:p.note,p_request_id:p.requestId,
});
export const submitInternalReturn=(action:'send'|'receive',id:string,items:{itemId:string;quantity:number}[],note:string,requestId:string)=>
  rpc<{id:string;code?:string;credit?:number;debtReduced?:number;refundPending?:number}>(action==='send'?'send_internal_stock_return':'receive_internal_stock_return',{
    [action==='send'?'p_sale_id':'p_return_id']:id,p_items:items,[action==='send'?'p_reason':'p_note']:note,p_request_id:requestId,
  });
