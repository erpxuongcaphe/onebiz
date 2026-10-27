import {beforeEach,describe,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>api,handleError:(error:{message:string})=>{throw new Error(error.message);}}));
import {canonicalCustomerOptions,customerFamilyIds,displayCustomerIdentity,expandCustomerFamilyIds,getCustomerIdentityDirectory,parseCustomerIdentityDirectory} from '@/lib/services/supabase/customer-identity';
const raw={alias_id:'old',canonical_id:'nbo',canonical_code:'KHA-NBO-002',canonical_name:'Xưởng Tư Búa',receiver_branch_id:'xtb'};
beforeEach(()=>vi.resetAllMocks());
describe('explicit internal customer identity',()=>{
 it('keeps Premium, Tư Búa and Đồng Xoài separate, without guessing other internal names',()=>{
  const links=parseCustomerIdentityDirectory([
   {...raw,alias_id:'old-premium',canonical_id:'premium',canonical_code:'KHA-NBO-001',canonical_name:'Xưởng Premium',receiver_branch_id:'premium-branch'},raw,
   {...raw,alias_id:'old-dx',canonical_id:'dx',canonical_code:'KHA-NBO-003',canonical_name:'Xưởng Đồng Xoài',receiver_branch_id:'dx-branch'},
  ]);
  const rows=links.flatMap(link=>[{id:link.aliasId,code:'KH-NB-TECH',name:'Hồ sơ kỹ thuật'},{id:link.canonicalId,code:link.code,name:link.name}]);
  const result=canonicalCustomerOptions([...rows,{id:'office',code:'KH-NB-OFFICE',name:'Văn phòng'},{id:'rd',code:'KHA-NBO-007',name:'R&D'}],links);
  expect(result.map(c=>c.code)).toEqual(['KHA-NBO-001','KHA-NBO-002','KHA-NBO-003','KH-NB-OFFICE','KHA-NBO-007']);
 });
 it('shows the canonical option once after reading a large complete directory',()=>{
  const links=parseCustomerIdentityDirectory([raw]);
  const rows=[...Array.from({length:1201},(_,i)=>({id:`c${i}`,code:`KH${i}`,name:`Khách ${i}`})),{id:'old',code:'KH-NB-CNH-XTB',name:'Tên kỹ thuật'},{id:'nbo',code:'KHA-NBO-002',name:'Xưởng Tư Búa'}];
  const options=canonicalCustomerOptions(rows,links);
  expect(options).toHaveLength(1202);expect(options.some(c=>c.id==='old')).toBe(false);expect(options.filter(c=>c.id==='nbo')).toHaveLength(1);
  expect(rows).toHaveLength(1203);
 });
 it('expands either family member, deduplicates and leaves unrelated customers alone',()=>{
  const links=parseCustomerIdentityDirectory([raw]);
  expect(customerFamilyIds('nbo',links)).toEqual(['nbo','old']);expect(customerFamilyIds('old',links)).toEqual(['nbo','old']);
  expect(expandCustomerFamilyIds(['old','nbo','other'],links)).toEqual(['nbo','old','other']);
 });
 it('keeps the exact historical customer ID and original code while displaying the canonical identity',()=>{
  const row={customerId:'old',customerCode:'KH-NB-CNH-XTB',customerName:'Tên cũ',total:123};
  expect(displayCustomerIdentity(row,parseCustomerIdentityDirectory([raw]))).toEqual({...row,customerCode:'KHA-NBO-002',customerName:'Xưởng Tư Búa',canonicalCustomerId:'nbo',originalCustomerCode:'KH-NB-CNH-XTB'});
  expect(row.customerCode).toBe('KH-NB-CNH-XTB');
 });
 it.each([null,{},[raw,raw],[{...raw,canonical_id:'old'}],[{...raw,receiver_branch_id:''}]])('rejects ambiguous or malformed metadata %j',value=>{
  expect(()=>parseCustomerIdentityDirectory(value)).toThrow();
 });
 it('supports frontend preview before the migration is installed',async()=>{
  api.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Function not found'}});
  expect(await getCustomerIdentityDirectory()).toEqual([]);
 });
 it.each(['permission denied','Failed to fetch'])('does not disguise %s as a successful empty directory',async message=>{
  api.rpc.mockResolvedValue({data:null,error:{code:'42501',message}});
  await expect(getCustomerIdentityDirectory()).rejects.toThrow(message);
 });
});
