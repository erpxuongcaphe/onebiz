import {getClient,handleError} from "./base";

/** Read only: the server resolves legacy notes by exact kitchen-line identity. */
export async function getFnbInvoiceItemNotes(invoiceId:string):Promise<Map<string,string>> {
 const {data,error}=await getClient().rpc("get_fnb_invoice_item_notes_20261023",{p_invoice_id:invoiceId});
 if(error) handleError(error,"invoice.itemNotes");
 return new Map((data ?? []).map((row:{invoice_item_id:string;note:string|null})=>[row.invoice_item_id,row.note ?? ""]));
}
