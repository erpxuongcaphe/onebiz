export const INVOICE_DETAIL_FIELDS=["Mã hàng","Size","Đá/Nóng","Mức ngọt","Mức đá","Tùy chọn khác","ĐVT","Đơn giá","Giảm"] as const;
export interface InvoiceDisplay {splitOptions:boolean;hiddenFields:string[];listColumns:Record<string,boolean>}
export const DEFAULT_INVOICE_DISPLAY:InvoiceDisplay={splitOptions:false,hiddenFields:["Mã hàng","ĐVT","Giảm"],listColumns:{}};
export function parseInvoiceDisplay(raw:unknown):InvoiceDisplay {
 if(!raw||typeof raw!=="object")return DEFAULT_INVOICE_DISPLAY;
 const value=raw as Record<string,unknown>;
 return {splitOptions:value.splitOptions===true,
  hiddenFields:Array.isArray(value.hiddenFields)?value.hiddenFields.filter((s):s is string=>typeof s==="string"&&INVOICE_DETAIL_FIELDS.includes(s as typeof INVOICE_DETAIL_FIELDS[number])):DEFAULT_INVOICE_DISPLAY.hiddenFields,
  listColumns:value.listColumns&&typeof value.listColumns==="object"?Object.fromEntries(Object.entries(value.listColumns).filter(([k,v])=>k.length<100&&!["__proto__","constructor","prototype"].includes(k)&&typeof v==="boolean")):{} };
}

export interface InvoiceDisplayPatch {splitOptions?:boolean;detailVisibility?:Record<string,boolean>;listColumns?:Record<string,boolean>}
export function displayPatch(before:InvoiceDisplay|undefined,after:InvoiceDisplay):InvoiceDisplayPatch {
 const patch:InvoiceDisplayPatch={};
 if(!before||before.splitOptions!==after.splitOptions)patch.splitOptions=after.splitOptions;
 const fields=Object.fromEntries(INVOICE_DETAIL_FIELDS.filter(f=>!before||before.hiddenFields.includes(f)!==after.hiddenFields.includes(f)).map(f=>[f,!after.hiddenFields.includes(f)]));
 if(Object.keys(fields).length)patch.detailVisibility=fields;
 const columns=Object.fromEntries(Object.entries(after.listColumns).filter(([k,v])=>!before||before.listColumns[k]!==v));if(Object.keys(columns).length)patch.listColumns=columns;
 return patch;
}
export function mergeDisplayPatch(a:InvoiceDisplayPatch,b:InvoiceDisplayPatch):InvoiceDisplayPatch {
 return {...a,...b,...(a.detailVisibility||b.detailVisibility?{detailVisibility:{...a.detailVisibility,...b.detailVisibility}}:{}),...(a.listColumns||b.listColumns?{listColumns:{...a.listColumns,...b.listColumns}}:{})};
}
export function applyDisplayPatch(value:InvoiceDisplay,patch:InvoiceDisplayPatch):InvoiceDisplay {
 return parseInvoiceDisplay({splitOptions:patch.splitOptions??value.splitOptions,hiddenFields:INVOICE_DETAIL_FIELDS.filter(f=>patch.detailVisibility?.[f]===undefined?value.hiddenFields.includes(f):!patch.detailVisibility[f]),listColumns:{...value.listColumns,...patch.listColumns}});
}
export function parseDisplayPatch(value:unknown):InvoiceDisplayPatch {
 if(!value||typeof value!=="object")return {};
 const p=value as InvoiceDisplayPatch;
 const bools=(v:unknown)=>v&&typeof v==="object"?Object.fromEntries(Object.entries(v).filter(([k,v])=>typeof v==="boolean"&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)&&!["constructor","prototype"].includes(k))):{};
 return {...(typeof p.splitOptions==="boolean"?{splitOptions:p.splitOptions}:{}),...(p.detailVisibility?{detailVisibility:Object.fromEntries(Object.entries(p.detailVisibility).filter(([k,v])=>INVOICE_DETAIL_FIELDS.includes(k as typeof INVOICE_DETAIL_FIELDS[number])&&typeof v==="boolean"))}:{}),...(p.listColumns?{listColumns:bools(p.listColumns)}:{})};
}
export function hasDisplayPatch(p:InvoiceDisplayPatch){return p.splitOptions!==undefined||Object.keys(p.detailVisibility??{}).length>0||Object.keys(p.listColumns??{}).length>0;}
