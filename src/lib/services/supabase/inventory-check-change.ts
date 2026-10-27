import {getClient} from './base';

export interface InventoryCheckChangeSource {
  id: string; branchId: string; code: string; status: string; note: string; version: string;
  items: Array<{productId:string; name:string; code:string; unit:string; systemStock:number; actualStock:number}>;
}
export interface InventoryCheckChangeInput {
  checkId:string; action:'edit'|'cancel'; items:Array<{productId:string; actualStock:number}>;
  note:string; reason:string; sourceVersion:string; requestId:string;
}
export interface InventoryCheckChangePreview {
  checkId:string; code:string; action:'edit'|'cancel'; token:string; canApply:boolean; applied:boolean;
  costVisible:boolean; costDelta:number|null;
  items:Array<{productId:string; name:string; code:string; unit:string; actualBefore:number; actualAfter:number;
    stockBefore:number; stockDelta:number; stockAfter:number; costDelta:number|null; blocked:string|null}>;
}
const messages:Record<string,string>={
  INVENTORY_CHECK_SOURCE_CHANGED:'Phiếu đã được người khác cập nhật. Đóng và mở lại để lấy số mới.',
  INVENTORY_CHECK_PREVIEW_STALE:'Tồn hoặc giá vốn vừa thay đổi. Bấm xem trước lại rồi xác nhận.',
  INVENTORY_CHECK_HISTORY_AMBIGUOUS:'Phiếu có dòng trùng hoặc thiếu thông tin nguồn. Cần đối soát trước khi điều chỉnh.',
  INVENTORY_CHECK_LEDGER_MISMATCH:'Lịch sử nhập/xuất của phiếu chưa khớp. Chưa thay đổi kho; cần đối soát phiếu này.',
  INVENTORY_CHECK_CHANGE_BLOCKED:'Chưa đủ tồn hoặc căn cứ giá vốn để điều chỉnh. Xem dòng cần kiểm tra.',
  INVENTORY_CHECK_NO_CHANGE:'Chưa có thay đổi số thực đếm hoặc ghi chú.',
  INVENTORY_CHECK_REQUEST_CONFLICT:'Mã yêu cầu đã dùng cho nội dung khác. Đóng và mở lại phiếu.',
  INSUFFICIENT_PERMISSION:'Tài khoản chưa được cấp quyền thực hiện thao tác này.',
  BRANCH_ACCESS_DENIED:'Tài khoản chưa được cấp quyền tại chi nhánh của phiếu.',
  INVENTORY_CHECK_NOT_EDITABLE:'Phiếu đã hủy hoặc không còn ở trạng thái có thể sửa.',
};
export class InventoryCheckChangeError extends Error {
  constructor(message:string,readonly code?:string,readonly outcomeUnknown=false){super(message);this.name='InventoryCheckChangeError';}
}
async function call<T>(name:string,args:Record<string,unknown>):Promise<T>{
  let response:{data:T;error:{message:string;code?:string}|null};
  try{response=await (getClient().rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<typeof response>)(name,args);}
  catch{throw new InventoryCheckChangeError('Chưa nhận được kết quả từ máy chủ. Kiểm tra lại bằng cùng yêu cầu để tránh ghi hai lần.',undefined,true);}
  const {data,error}=response;
  if(error?.code==='55P03'||error?.code==='40P01') throw new InventoryCheckChangeError('Kho đang có giao dịch. Chưa thay đổi số liệu; vui lòng xem trước và thử lại sau vài giây.',error.code);
  if(error) throw new InventoryCheckChangeError(Object.entries(messages).find(([code])=>error.message.includes(code))?.[1] ?? error.message,error.code,!/^[0-9A-Z]{5}$/.test(error.code??''));
  if(!data) throw new InventoryCheckChangeError('Máy chủ chưa xác nhận kết quả. Vui lòng thử lại cùng yêu cầu.',undefined,true);
  return data;
}
export const getInventoryCheckChangeSource=(id:string)=>call<InventoryCheckChangeSource>('get_inventory_check_change_source',{p_check_id:id});
function args(input:InventoryCheckChangeInput){return {
  p_check_id:input.checkId,p_action:input.action,p_items:input.items,p_note:input.note,p_reason:input.reason,
  p_source_version:input.sourceVersion,p_request_id:input.requestId,
};}
export const previewInventoryCheckChange=(input:InventoryCheckChangeInput)=>call<InventoryCheckChangePreview>('preview_inventory_check_change',args(input));
export async function applyInventoryCheckChange(input:InventoryCheckChangeInput,token:string){
  const result=await call<InventoryCheckChangePreview>('apply_inventory_check_change',{...args(input),p_preview_token:token});
  if(!result.applied||result.checkId!==input.checkId) throw new InventoryCheckChangeError('Máy chủ chưa xác nhận điều chỉnh phiếu.',undefined,true);
  return result;
}
