import {beforeEach,describe,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>api,handleError:(e:{message:string})=>{throw new Error(e.message);}}));
import {getPartyAdvanceLedger} from '@/lib/services/supabase/cash-book';
const link={alias_id:'old',canonical_id:'nbo',canonical_code:'KHA-NBO-002',canonical_name:'Xưởng Tư Búa',receiver_branch_id:'xtb'};
beforeEach(()=>vi.resetAllMocks());
describe('canonical advance source reads',()=>{
 it('combines explicitly linked sources and keeps each exact owner for the existing refund authorization',async()=>{
  api.rpc.mockImplementation(async(name:string,args:{p_party_id:string})=>name==='get_customer_identity_directory'?{data:[link],error:null}:{data:[{id:'advance-'+args.p_party_id,date:'2026-10-27',remainingAmount:50}],error:null});
  const rows=await getPartyAdvanceLedger('customer','nbo','warehouse');
  expect(rows.map(r=>[r.id,r.sourcePartyId])).toEqual([['advance-nbo','nbo'],['advance-old','old']]);
  expect(api.rpc).toHaveBeenCalledWith('get_party_advance_ledger',{p_mode:'customer',p_party_id:'old',p_branch_id:'warehouse'});
 });
 it('keeps supplier sources on the original one-account endpoint',async()=>{
  api.rpc.mockResolvedValue({data:[{id:'advance',date:'2026-10-27'}],error:null});
  expect((await getPartyAdvanceLedger('supplier','supplier','warehouse'))[0].sourcePartyId).toBe('supplier');
  expect(api.rpc).toHaveBeenCalledTimes(1);
 });
 it('does not display a partial source list after one account read is denied',async()=>{
  api.rpc.mockResolvedValueOnce({data:[link],error:null}).mockResolvedValueOnce({data:[{id:'one'}],error:null}).mockResolvedValueOnce({data:null,error:{message:'denied'}});
  await expect(getPartyAdvanceLedger('customer','nbo','warehouse')).rejects.toThrow('denied');
 });
});
