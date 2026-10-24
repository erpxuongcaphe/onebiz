import {getClient} from "./base";
import type {FnbChoiceCatalog} from "@/lib/utils/fnb-invoice-choice-filter";
export async function getFnbInvoiceChoiceCatalog(branchId?:string):Promise<FnbChoiceCatalog> {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient() as any).rpc("get_fnb_invoice_choice_catalog_20261023",{p_branch_id:branchId??null});
 if(error)throw error;
 if(!data||!Array.isArray(data.sizes)||!data.sizes.every((v:unknown)=>typeof v==="string")||!Array.isArray(data.groups)||!data.groups.every((g:{key?:unknown;name?:unknown;values?:unknown})=>typeof g?.key==="string"&&/^g_(?:[a-f0-9]{2})+$/.test(g.key)&&typeof g.name==="string"&&Array.isArray(g.values)&&g.values.every((v:unknown)=>typeof v==="string")))throw new Error("Dữ liệu tùy chọn không đầy đủ.");
 return data;
}
