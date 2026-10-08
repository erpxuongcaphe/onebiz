import { getClient, handleError } from './base';
export interface BeneficiaryOptions {
 customers: { id:string; name:string; profile_id?:string; employee_name?:string }[];
 groups: { id:string; name:string }[];
 staff: { id:string; name:string }[];
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
