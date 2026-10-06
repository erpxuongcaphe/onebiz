import {describe,it,expect} from 'vitest';
import type {CashBookEntry} from '@/lib/types';
import type {FinanceCashLink,FinanceEvent} from '@/lib/services/supabase/management-finance';
import {reconcileCashFlow,cashFlowMonths,summarizeRecognition} from '@/lib/utils/finance-report-reconciliation';

const cash = (id:string,type:'receipt'|'payment',amount:number,category='Bán hàng'):CashBookEntry => ({id,code:id,date:'2026-10-05',type,typeName:type,amount,category,counterparty:'Test',createdBy:'user'});
const link:FinanceCashLink = {cash_id:'expense',event_id:'event',event_code:'CP1',category_code:'CP-VH-DIEN',category_name:'Điện',kind:'expense',cash_flow_activity:'operating',business_date:'2026-09-30',event_status:'posted'};
describe('finance report reconciliation',() => {
  it('counts one cash document once and never adds its recognized amount',() => {
    const report=reconcileCashFlow([cash('sale','receipt',200),cash('expense','payment',40,'management_expense')],[link]);
    expect(report.receipt).toBe(200);expect(report.payment).toBe(40);expect(report.totals[0].net).toBe(160);
    expect(report.detail[1].eventCode).toBe('CP1');expect(report.detail[1].category).toBe('Điện');
  });
  it('keeps unknown cash and cancelled recognition links unclassified',() => {
    const report=reconcileCashFlow([cash('unknown','receipt',15,'Khác'),cash('expense','payment',20)], [{...link,event_status:'cancelled'}]);
    expect(report.totals.find(r=>r.activity==='unclassified')).toMatchObject({receipt:15,payment:20,count:2});
  });
  it('preserves investing and financing classification regardless of cash direction',() => {
    const report=reconcileCashFlow([cash('expense','receipt',10),cash('loan','payment',5)], [{...link,cash_flow_activity:'investing'},{...link,cash_id:'loan',cash_flow_activity:'financing'}]);
    expect(report.totals[1].receipt).toBe(10);expect(report.totals[2].payment).toBe(5);
  });
  it('rejects duplicate and invalid source rows',() => {
    expect(()=>reconcileCashFlow([cash('x','receipt',10),cash('x','receipt',10)],[])).toThrow('trùng');
    expect(()=>reconcileCashFlow([], [link,link])).toThrow('trùng');
    expect(()=>reconcileCashFlow([cash('x','receipt',NaN)],[])).toThrow('không hợp lệ');
  });
  it('groups cash by accounting date and keeps empty months',() => {
    const months=cashFlowMonths([cash('x','receipt',20)],'2026-09-01','2026-10-31');
    expect(months.map(r=>r.net)).toEqual([0,20]);expect(months[1].cumulativeBalance).toBe(20);
    expect(()=>cashFlowMonths([cash('x','receipt',20)],'2026-09-01','2026-09-30')).toThrow('ngoài kỳ');
  });
  it('keeps filtered recognition distinct from whole-source settlement and excludes cancelled rows',() => {
    const row={id:'e',status:'posted',kind:'expense',category_code:'CP1',category_name:'Điện',amount:1000,report_amount:600,settled_amount:300} as FinanceEvent;
    expect(summarizeRecognition([row,{...row,status:'cancelled'}])).toEqual([{code:'CP1',name:'Điện',kind:'expense',count:1,amount:600,totalSource:1000,settled:300,outstanding:700}]);
  });
});
