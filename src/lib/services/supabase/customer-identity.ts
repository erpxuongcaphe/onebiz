import {getClient,handleError} from './base';
import {isRpcUnavailable} from './rpc-utils';

export interface CustomerIdentityLink {
  aliasId:string; canonicalId:string; code:string; name:string; branchId:string;
}

/** Explicit metadata only. A similar name never creates an identity link. */
export function parseCustomerIdentityDirectory(value:unknown):CustomerIdentityLink[] {
  if(!Array.isArray(value))throw new Error('Danh bạ mã nội bộ chưa hợp lệ.');
  const aliases=new Set<string>(),canonical=new Set<string>();
  return value.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Liên kết mã nội bộ chưa hợp lệ.');
    const r=raw as Record<string,unknown>;
    const fields=['alias_id','canonical_id','canonical_code','canonical_name','receiver_branch_id'] as const;
    if(fields.some(key=>typeof r[key]!=='string'||!String(r[key]).trim())||r.alias_id===r.canonical_id
      ||aliases.has(String(r.alias_id))||canonical.has(String(r.canonical_id)))throw new Error('Liên kết mã nội bộ bị trùng hoặc thiếu.');
    aliases.add(String(r.alias_id));canonical.add(String(r.canonical_id));
    return {aliasId:String(r.alias_id),canonicalId:String(r.canonical_id),code:String(r.canonical_code),name:String(r.canonical_name),branchId:String(r.receiver_branch_id)};
  });
}

export async function getCustomerIdentityDirectory():Promise<CustomerIdentityLink[]> {
  const client=getClient();
  const {data,error}=await client.rpc('get_customer_identity_directory' as never,{} as never);
  // Frontend can be previewed before the reviewed migration; never hide a
  // permission/network error as an empty successful directory.
  if(error){if(isRpcUnavailable(error))return [];handleError(error,'getCustomerIdentityDirectory');}
  return parseCustomerIdentityDirectory(data);
}

export function customerIdentity(id:string,links:readonly CustomerIdentityLink[]){
  return links.find(link=>link.aliasId===id||link.canonicalId===id);
}
export function customerFamilyIds(id:string,links:readonly CustomerIdentityLink[]):string[]{
  const link=customerIdentity(id,links);return link?[link.canonicalId,link.aliasId]:[id];
}
export function expandCustomerFamilyIds(ids:readonly string[],links:readonly CustomerIdentityLink[]):string[]{
  return [...new Set(ids.flatMap(id=>customerFamilyIds(id,links)))];
}
export function canonicalCustomerOptions<T extends {id:string;code:string;name:string}>(rows:readonly T[],links:readonly CustomerIdentityLink[]):T[]{
  const aliases=new Set(links.map(link=>link.aliasId));
  return rows.filter(row=>!aliases.has(row.id)).map(row=>{
    const link=customerIdentity(row.id,links);return link?{...row,code:link.code,name:link.name}:row;
  });
}

/** Display changes never replace the ID used to edit/pay/reopen a historical document. */
export function displayCustomerIdentity<T extends {customerId?:string;customerCode?:string;customerName:string}>(row:T,links:readonly CustomerIdentityLink[]):T & {canonicalCustomerId?:string;originalCustomerCode?:string}{
  const link=row.customerId?customerIdentity(row.customerId,links):undefined;
  return link?{...row,canonicalCustomerId:link.canonicalId,originalCustomerCode:row.customerCode,customerCode:link.code,customerName:link.name}:row;
}
