import {readFnbInvoiceSize} from "./fnb-invoice-options";
export const FNB_MISSING="__missing__";
export const FNB_EMPTY="__empty__";
export interface FnbChoiceFilter {productId?:string;size?:string;groups?:Record<string,string>}
export interface FnbChoiceCatalog {products?:{id:string;name:string}[];sizes:string[];groups:{key:string;name:string;values:string[]}[]}
export const choiceKey=(name:string)=>"g_"+Array.from(new TextEncoder().encode(name),b=>b.toString(16).padStart(2,"0")).join("");
export function parseFnbChoiceFilter(raw:unknown):FnbChoiceFilter {
 if(!raw)return {};
 const value=typeof raw==="string"?JSON.parse(raw):raw;
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Bộ lọc tùy chọn không hợp lệ.");
 const result:FnbChoiceFilter={};
 if(value.productId!==undefined){if(typeof value.productId!=="string"||!/^[-a-f0-9]{36}$/i.test(value.productId))throw new Error("Món lọc không hợp lệ.");result.productId=value.productId;}
 if(value.size!==undefined){if(typeof value.size!=="string"||!value.size||value.size.length>200)throw new Error("Size lọc không hợp lệ.");result.size=value.size;}
 if(value.groups!==undefined){if(!value.groups||typeof value.groups!=="object"||Array.isArray(value.groups))throw new Error("Nhóm lọc không hợp lệ.");
 const entries=Object.entries(value.groups);if(entries.length>40)throw new Error("Quá nhiều nhóm lọc.");
 for(const [key,v] of entries)if(!/^g_(?:[a-f0-9]{2})+$/.test(key)||key.length>1600||typeof v!=="string"||!v||v.length>500)throw new Error("Lựa chọn lọc không hợp lệ.");
 if(entries.length)result.groups=Object.fromEntries(entries) as Record<string,string>;
 }return result;
}
export const hasFnbChoiceFilter=(filter:FnbChoiceFilter)=>!!filter.productId||!!filter.size||!!Object.keys(filter.groups??{}).length;
export function fnbChoices(value:unknown):Record<string,string[]> {
 const result:Record<string,string[]>={};if(!Array.isArray(value))return result;
 for(const group of value){if(!group||typeof group.groupName!=="string"||!Array.isArray(group.options))continue;
 result[choiceKey(group.groupName)]=group.options.length?group.options.flatMap((o:{label?:unknown})=>typeof o?.label==="string"?[o.label]:[]):[FNB_EMPTY];
 }return result;
}
export function matchesFnbChoiceFilter(name:string,size:string|null|undefined,options:unknown,filter:FnbChoiceFilter,productId?:string) {
 if(filter.productId&&filter.productId!==productId)return false;
 if(filter.size&&(readFnbInvoiceSize(name,size)||FNB_MISSING)!==filter.size)return false;
 const groups=fnbChoices(options);
 return Object.entries(filter.groups??{}).every(([key,value])=>value===FNB_MISSING?!Object.hasOwn(groups,key):(groups[key]??[]).includes(value));
}
export const choiceValueLabel=(value:string)=>value===FNB_MISSING?"Chưa ghi nhận":value===FNB_EMPTY?"Không chọn":value;

export function choiceGroupLabel(key:string) {
 try{return new TextDecoder().decode(Uint8Array.from(key.slice(2).match(/../g)??[],x=>parseInt(x,16)));}catch{return "Tùy chọn";}
}
