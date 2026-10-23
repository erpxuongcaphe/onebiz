import {getClient} from "./base";
import {readHistoryPages} from "./read-history-pages";
export interface FnbInvoiceItemDetail {invoice_id:string;invoice_item_id:string;note:string|null;modifier_selections:unknown;variant_label:string|null;detail_source:string}
/** Bounded, exact-line read. No guessed options or modifications to historical bills. */
export async function getFnbInvoiceItemDetails(invoiceIds:string[],signal?:AbortSignal):Promise<Map<string,FnbInvoiceItemDetail>> {
 if(!invoiceIds.length)return new Map();
 if(invoiceIds.length>100)throw new Error("Chỉ đọc tối đa 100 hóa đơn mỗi lần.");
 const check=()=>{if(signal?.aborted)throw new DOMException("Đã hủy tải tùy chọn.","AbortError");};
 check();
 const rows=await readHistoryPages<FnbInvoiceItemDetail & {id:string}>(async(offset,size)=>{
  check();const result=await getClient().rpc("get_fnb_invoice_item_details_20261023",{p_invoice_ids:invoiceIds},{count:"exact"}).order("invoice_item_id").range(offset,offset+size-1);
  check();return {...result,data:(result.data??[]).map(row=>({...row,id:row.invoice_item_id}))};
 });
 return new Map(rows.map(({id,...row})=>[id,row]));
}
