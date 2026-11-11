import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { filterStaffDirectory, visibleStaffSelection, EMPTY_STAFF_FILTERS } from "@/lib/admin/staff-directory";
import { StaffDirectoryFilterBar } from "@/components/shared/staff-directory-filters";
import { prepareStaffAssignment } from "@/lib/admin/staff-assignment";
import type { AccountHierarchy } from "@/lib/admin/account-hierarchy";
const people = [
  { id: 'a', fullName: 'Nguyễn Thư', email: 'thu@example.test', phone: '0901234567', branchIds: ['premium'], departmentIds: ['ops'], role: 'staff', roleId: 'old' },
  { id: 'b', fullName: 'Đặng An', email: 'an@example.test', branchIds: ['tb','dx'], departmentIds: ['finance'], role: 'staff' },
  { id: 'c', fullName: 'Bình', email: '', branchIds: ['premium'], departmentIds: [], role: 'staff' },
];
describe('scope-first staff directory', () => {
  it('combines branches and departments with AND; multiple values within a filter use OR', () => {
    expect(filterStaffDirectory(people,{ branchIds:['premium','tb'],departmentIds:['ops'],search:'nguyen thu' }).map(x=>x.id)).toEqual(['a']);
    expect(filterStaffDirectory(people,{ branchIds:['premium'],departmentIds:['finance'],search:'' })).toEqual([]);
  });
  it('searches phone/email and Vietnamese without accents', () => {
    for (const search of ['dang an','an@example','090123']) expect(filterStaffDirectory(people,{...EMPTY_STAFF_FILTERS,search})).toHaveLength(1);
  });
  it('never introduces a user outside the authorized input; missing metadata is not unassigned', () => {
    expect(filterStaffDirectory([people[0]],{...EMPTY_STAFF_FILTERS,search:'Đặng An'})).toEqual([]);
    expect(filterStaffDirectory([...people,{...people[0],id:'unknown',departmentIds:undefined}],{...EMPTY_STAFF_FILTERS,departmentIds:['__unassigned__']} ).map(x=>x.id)).toEqual(['c']);
  });
  it('drops hidden selections after narrowing scope', () => expect([...visibleStaffSelection(new Set(['a','b']),['b','c'])]).toEqual(['b']));
  it('clears branch, department and search in one action', () => {
    const onChange=vi.fn(); render(<StaffDirectoryFilterBar value={{branchIds:['premium'],departmentIds:['ops'],search:'thu'}} onChange={onChange} branches={[{id:'premium',name:'Premium'}]} departments={[{id:'ops',name:'Vận hành'}]} count={1} total={3}/>);
    fireEvent.click(screen.getByRole('button',{name:'Xóa bộ lọc'})); expect(onChange).toHaveBeenCalledWith(EMPTY_STAFF_FILTERS);
  });
});
const doc=():AccountHierarchy=>({positions:[{id:'staff',name:'Nhân viên',parentId:null,roleId:'new',scope:'assigned',depth:'all',permissions:{create:false,edit:false,password:false}}],departments:[{id:'ops',name:'Vận hành',parentId:null}],assignments:[],globalAdminIds:[]});
const input=()=>({userIds:['a'],visibleIds:['a'],positionId:'staff',departmentId:'ops',managedBranchIds:[] as string[],mode:'replace' as const});
describe('single-save assignment plan',()=>{
  it('assigns a non-manager without forcing fake management branches and links its role',()=>{
    const before=doc();const result=prepareStaffAssignment(before,input(),people);
    expect(result.roles).toEqual([{userId:'a',roleId:'new',expectedRoleId:'old'}]);expect(before.assignments).toEqual([]);expect(result.document.assignments).toHaveLength(1);
  });
  it('rejects hidden users and owner',()=>{
    expect(()=>prepareStaffAssignment(doc(),{...input(),visibleIds:[]},people)).toThrow('Danh sách');
    expect(()=>prepareStaffAssignment(doc(),input(),[{...people[0],role:'owner'}])).toThrow('chủ doanh nghiệp');
  });
  it('requires management scope and refuses branches outside any selected employee access',()=>{
    const d=doc();d.positions[0].permissions.edit=true;
    expect(()=>prepareStaffAssignment(d,input(),people)).toThrow('chi nhánh quản lý');
    expect(()=>prepareStaffAssignment(d,{...input(),managedBranchIds:['tb']},people)).toThrow('phạm vi truy cập');
  });
  it('requires department for department-scoped management',()=>{
    const d=doc();d.positions[0].scope='department';expect(()=>prepareStaffAssignment(d,{...input(),departmentId:''},people)).toThrow('phòng ban');
  });
});
