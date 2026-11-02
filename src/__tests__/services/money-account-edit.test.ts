import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:mocks.rpc}),getCurrentTenantId:vi.fn(),handleError:(e:{message:string})=>{throw new Error(e.message);}}));
import { saveMoneyAccount, deleteMoneyAccount, type MoneyAccount } from '@/lib/services/supabase/money-accounts';
const account={id:'a',revision:5} as MoneyAccount;
beforeEach(()=>mocks.rpc.mockReset());
it('reports duplicate codes clearly without retrying a write',async()=>{mocks.rpc.mockResolvedValue({error:{code:'23505',message:'duplicate key'}});await expect(saveMoneyAccount(account,{code:'EXISTS'},'Fix typo')).rejects.toThrow('Mã tài khoản đã tồn tại');expect(mocks.rpc).toHaveBeenCalledTimes(1);});
it('passes identity and revision to deletion and explains referenced accounts',async()=>{mocks.rpc.mockResolvedValue({error:{code:'22023',message:'MONEY_ACCOUNT_IN_USE'}});await expect(deleteMoneyAccount(account,' Tạo nhầm ')).rejects.toThrow('không thể xóa');expect(mocks.rpc).toHaveBeenCalledWith('delete_money_account',{p_id:'a',p_expected_revision:5,p_reason:'Tạo nhầm'});});
it('asks for reload instead of silently overwriting concurrent edits',async()=>{mocks.rpc.mockResolvedValue({error:{code:'PT409',message:'MONEY_ACCOUNT_CHANGED_RELOAD'}});await expect(saveMoneyAccount(account,{code:'NEW'},'Fix typo')).rejects.toThrow('Đóng và tải lại');});
