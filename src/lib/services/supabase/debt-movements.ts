import {getClient} from './base';
import {financeReportRangeError} from '@/lib/reports/finance-report-input';

export interface DebtMovement {key:string;id:string;kind:string;code:string;date:string;created_at:string;status:string;amount:number;delta:number;balance:number;note:string;unmapped:boolean}
export interface DebtMovementReport {basis:'current_effective_documents';opening:number;increase:number;decrease:number;closing:number;current_net:number;difference:number;unmapped:number;total:number;items:DebtMovement[]}
export async function getDebtMovements(mode:'customer'|'supplier',partyId:string,branchId:string,from:string,to:string):Promise<DebtMovementReport> {
  const rangeError=financeReportRangeError(from,to);
  if(rangeError || !branchId) throw new Error(rangeError || 'Chọn một chi nhánh để đối soát công nợ.');
  let result:DebtMovementReport|undefined;
  const items:DebtMovement[]=[];const ids=new Set<string>();
  for(let page=0;;page++) {
    const {data,error}=await getClient().rpc('get_party_debt_movements' as never,{p_mode:mode,p_party_id:partyId,p_branch_id:branchId,p_from:from,p_to:to,p_page:page,p_size:200} as never);
    if(error) throw new Error(error.message);
    const response=data as unknown as DebtMovementReport;
    if(!response || !Array.isArray(response.items) || !Number.isSafeInteger(response.total) || response.total<0 || response.basis!=='current_effective_documents') throw new Error('Nguồn công nợ không hợp lệ.');
    if(result && ['total','opening','increase','decrease','closing','current_net','difference','unmapped'].some(key=>response[key as keyof DebtMovementReport]!==result![key as keyof DebtMovementReport])) throw new Error('Công nợ đang thay đổi. Tải lại để đối soát đủ nguồn.');
    result??=response;
    if(!response.items.length && items.length<result.total) throw new Error('Chưa tải đủ lịch sử công nợ.');
    for(const row of response.items) {
      if(!row.key || ids.has(row.key) || ![row.amount,row.delta,row.balance].every(Number.isFinite)) throw new Error('Dòng công nợ trùng hoặc không hợp lệ.');
      ids.add(row.key);items.push(row);
    }
    if(items.length===result.total) return {...result,items};
    if(items.length>result.total) throw new Error('Số dòng công nợ không khớp.');
  }
}
