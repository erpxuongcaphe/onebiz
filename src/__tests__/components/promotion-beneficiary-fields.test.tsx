import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionBeneficiaryFields } from '@/components/shared/promotion-beneficiary-fields';
const mocks=vi.hoisted(()=>({options:vi.fn(),internal:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/services/supabase/promotion-beneficiaries',()=>({getPromotionBeneficiaryOptions:mocks.options,getEmployeeBenefitOptions:mocks.internal,saveEmployeeBenefitGroup:mocks.save}));
const onChange=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.internal.mockResolvedValue({groups:[{id:'group',name:'Quản lý',member_ids:['a','b']}],staff:[{id:'a',name:'An',customer_id:'customer-a'},{id:'b',name:'Bình',customer_id:null}]});
 mocks.options.mockResolvedValue({groups:[],customers:[],staff:[]});
 mocks.save.mockResolvedValue('saved');
});
describe('employee benefit policy editor',()=>{
 it('uses groups and multiple staff without exposing customer-link fields',async()=>{
  render(<PromotionBeneficiaryFields kind="employee_group" ids={[]} onChange={onChange}/>);
  await screen.findByLabelText('Quản lý');
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Hồ sơ khách của nhân viên')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Tài khoản nhân viên')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Quản lý'));
  expect(onChange).toHaveBeenCalledWith('employee_group',['group']);
  fireEvent.change(screen.getByPlaceholderText('Ví dụ: Quản lý, Nhân viên…'),{target:{value:'Nhân viên'}});
  fireEvent.click(screen.getByLabelText('An'));fireEvent.click(screen.getByLabelText('Bình'));
  fireEvent.click(screen.getByRole('button',{name:'Lưu nhóm nội bộ'}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(null,'Nhân viên',['a','b']));
  await waitFor(()=>expect(onChange).toHaveBeenCalledWith('employee_group',['saved']));
 });
 it('keeps legacy selected identities by customer id while showing staff names',async()=>{
  render(<PromotionBeneficiaryFields kind="employee" ids={['customer-a']} onChange={onChange}/>);
  expect((await screen.findAllByLabelText('An'))[0]).toBeChecked();
  fireEvent.click(screen.getAllByLabelText('An')[0]);
  expect(onChange).toHaveBeenCalledWith('employee',[]);
 });
 it('shows a save error and preserves selection for retry',async()=>{
  mocks.save.mockRejectedValue(new Error('EMPLOYEE_BRANCH_ACCESS_DENIED'));
  render(<PromotionBeneficiaryFields kind="employee_group" ids={[]} onChange={onChange}/>);
  await screen.findByLabelText('An');
  fireEvent.change(screen.getByPlaceholderText('Ví dụ: Quản lý, Nhân viên…'),{target:{value:'Nhân viên'}});
  fireEvent.click(screen.getByLabelText('An'));fireEvent.click(screen.getByRole('button',{name:'Lưu nhóm nội bộ'}));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('An')).toBeChecked();
  expect(onChange).not.toHaveBeenCalled();
 });
});
