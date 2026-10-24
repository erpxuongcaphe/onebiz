import {getClient} from "./base";
import {applyDisplayPatch,DEFAULT_INVOICE_DISPLAY,parseDisplayPatch,type InvoiceDisplayPatch,type InvoiceDisplay} from "@/lib/utils/invoice-display";
export interface InvoiceDisplayRecord {value:InvoiceDisplay;revision:number}
function decode(raw:unknown):InvoiceDisplayRecord|null {
 if(raw===null)return null;
 const r=raw as {settings?:unknown;revision?:unknown};
 if(!r||typeof r.revision!=="number"||!Number.isSafeInteger(r.revision)||r.revision<1||!r.settings||typeof r.settings!=="object")throw Error("Invalid display preferences");
 return {value:applyDisplayPatch(DEFAULT_INVOICE_DISPLAY,parseDisplayPatch(r.settings)),revision:r.revision};
}
export async function getInvoiceDisplayPreferences(tenantId:string,profileId:string):Promise<InvoiceDisplayRecord|null> {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient() as any).rpc("get_invoice_display_preferences_20261024",{p_tenant_id:tenantId,p_profile_id:profileId});if(error)throw error;return decode(data);
}
export async function saveInvoiceDisplayPreferences(tenantId:string,profileId:string,patch:InvoiceDisplayPatch,initialize=false):Promise<InvoiceDisplayRecord> {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient() as any).rpc("save_invoice_display_preferences_20261024",{p_tenant_id:tenantId,p_profile_id:profileId,p_patch:patch,p_initialize:initialize});if(error)throw error;const result=decode(data);if(!result)throw Error("Missing saved preferences");return result;
}
