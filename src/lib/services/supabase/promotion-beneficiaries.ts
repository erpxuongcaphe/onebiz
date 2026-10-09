import { getClient, handleError } from './base';
export interface BeneficiaryOptions {
 customers: { id:string; name:string; profile_id?:string; employee_name?:string }[];
 groups: { id:string; name:string }[];
 staff: { id:string; name:string }[];
}
export interface EmployeeBenefitOptions {
 groups: { id: string; name: string; member_ids: string[] }[];
 staff: { id: string; name: string; customer_id: string | null }[];
}
export async function getEmployeeBenefitOptions(): Promise<EmployeeBenefitOptions> {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient().rpc as any)('employee_benefit_options_00463');
 if(error) handleError(error,'getEmployeeBenefitOptions');
 if(!data) throw new Error('Không tải được nhóm ưu đãi nội bộ.');
 return data as EmployeeBenefitOptions;
}
export async function saveEmployeeBenefitGroup(id: string | null,name: string,members: string[]): Promise<string> {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient().rpc as any)('employee_benefit_save_group_00463',{p_id:id,p_name:name,p_members:members});
 if(error) {
  if(error.message.includes('EMPLOYEE_BRANCH_ACCESS_DENIED')) throw new Error('Nhóm có nhân viên chưa đủ điều kiện hoặc thuộc chi nhánh bạn chưa được quản lý. Kiểm tra thành viên và phạm vi chi nhánh.');
  if(error.message.includes('PERMISSION_DENIED')) throw new Error('Cần quyền quản lý giá và chỉnh sửa khách hàng để chuẩn bị hồ sơ ưu đãi nội bộ.');
  if(error.code==='23505') throw new Error('Tên nhóm đã tồn tại. Chọn nhóm hiện có để cập nhật thành viên.');
  handleError(error,'saveEmployeeBenefitGroup');
 }
 if(typeof data !== 'string') throw new Error('Chưa lưu được nhóm ưu đãi.');
 return data;
}
export async function getPromotionBeneficiaryOptions(search:string, selectedIds:string[]) {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {data,error}=await (getClient().rpc as any)('promotion_beneficiary_options_00458',{p_search:search,p_selected_ids:selectedIds});
 if(error) handleError(error,'getPromotionBeneficiaryOptions');
 if(!data) throw new Error('Không tải được đối tượng hưởng ưu đãi.');
 return data as BeneficiaryOptions;
}
export async function linkEmployeeBenefitCustomer(customerId:string,profileId:string) {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const {error}=await (getClient().rpc as any)('promotion_link_employee_customer_00458',{p_customer_id:customerId,p_profile_id:profileId});
 if(error) handleError(error,'linkEmployeeBenefitCustomer');
}
