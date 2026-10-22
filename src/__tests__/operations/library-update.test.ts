import {describe,it,expect} from 'vitest';
import {libraryUpdateSchema,libraryUpdateSummary,type LibraryUpdatePlan} from '@/lib/operations/library-update';
const id='11111111-1111-4111-8111-111111111111';
const input={action:'preview',id,version:2,branchIds:[id],effectiveFrom:'2026-10-24'};
describe('shared library update boundaries',()=>{
 it('accepts a read-only preview without a request id',()=>expect(libraryUpdateSchema.safeParse(input).success).toBe(true));
 it('rejects duplicate branches and malformed dates',()=>{
  expect(libraryUpdateSchema.safeParse({...input,branchIds:[id,id]}).success).toBe(false);
  expect(libraryUpdateSchema.safeParse({...input,effectiveFrom:'24/10/2026'}).success).toBe(false);
 });
 it('requires a reviewed token, explicit reason and request id to update',()=>{
  expect(libraryUpdateSchema.safeParse({...input,action:'update'}).success).toBe(false);
  expect(libraryUpdateSchema.safeParse({...input,action:'update',requestId:id,token:'a'.repeat(32),reason:'CEO xác nhận bản cập nhật'}).success).toBe(true);
 });
 it('summarizes instances without confusing them with criteria',()=>{
  const plan={branches:[{changes:[{kind:'edit',conflict:false,impact:{replaceable:[{id:'a'},{id:'b'}],protected:[{id:'c'}]}},{kind:'remove',conflict:true,impact:null},{kind:'add',conflict:false,impact:null}]}]} as LibraryUpdatePlan;
  expect(libraryUpdateSummary(plan)).toEqual({added:1,edited:1,removed:1,conflicts:1,replaced:2,protected:1});
 });
});
