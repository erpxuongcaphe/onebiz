import {describe,it,expect} from 'vitest';
import type {CashBookEntry} from '@/lib/types';
import type {FinanceCashLink,FinanceEvent} from '@/lib/services/supabase/management-finance';
import {reconcileCashFlow,cashFlowMonths,summarizeRecognition} from '@/lib/utils/finance-report-reconciliation';

const cash = (id:string,type:'receipt'|'payment',amount:number,category='Bán hàng'):CashBookEntry => ({id,code:id,date:'2026-10-05',type,typeName:type,amount,category,counterparty:'Test',createdBy:'user'});
const link:FinanceCashLink = {cash_id:'expense',event_id:'event',event_code:'CP1',category_code:'CP-VH-DIEN',category_name:'Điện',kind:'expense',cash_flow_activity:'operating',business_date:'2026-09-30',event_status:'posted'};
describe('finance report reconciliation',() => {
  it('uses shared cash labels without changing source categories or classification',() => {
    const entry=cash('supplier','payment',40,'supplier_payment');
    const report=reconcileCashFlow([entry,cash('customer','receipt',50,'customer_payment')],[]);
    expect(report.detail.map(row=>row.category)).toEqual(['Thanh toán NCC','Thu bán hàng']);
    expect(entry.category).toBe('supplier_payment');
    expect(report.totals[0]).toMatchObject({receipt:50,payment:40,count:2});
    expect(reconcileCashFlow([cash('custom','receipt',1,'Khoản riêng')],[]).detail[0].category).toBe('Khoản riêng');
    expect(reconcileCashFlow([cash('expense','payment',1,'supplier_payment')],[{...link,category_name:'Tên khoản riêng'}]).detail[0].category).toBe('Tên khoản riêng');
  });
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
    expect(summarizeRecognition([row,{...row,id:'cancelled',status:'cancelled'}])).toEqual([{code:'CP1',name:'Điện',kind:'expense',count:1,amount:600,totalSource:1000,settled:300,outstanding:700}]);
  });
  it('rejects inverted days within one month and impossible dates',() => {
    for (const [from,to] of [['2026-10-20','2026-10-01'],['2026-02-30','2026-03-01'],['','2026-10-01']]) {
      expect(()=>cashFlowMonths([],from,to)).toThrow('không hợp lệ');
    }
    expect(()=>cashFlowMonths([{...cash('x','receipt',1),date:'2026-02-30'}],'2026-02-01','2026-03-31')).toThrow('không hợp lệ');
    expect(cashFlowMonths([],'9999-12-01','9999-12-31')).toHaveLength(1);
  });
  it('does not count cancelled or draft cash in monthly and activity totals',() => {
    const entries=[cash('a','receipt',30),{...cash('b','receipt',100),status:'cancelled' as const},{...cash('c','payment',100),status:'draft' as const}];
    expect(reconcileCashFlow(entries,[])).toMatchObject({receipt:30,payment:0});
    expect(cashFlowMonths(entries,'2026-10-01','2026-10-31')[0]).toMatchObject({totalReceipt:30,totalPayment:0,net:30});
  });
  it('adds fractional amounts in cents and rejects invalid monthly sources',() => {
    const entries=[cash('a','receipt',0.1),cash('b','receipt',0.2),cash('c','payment',0.1)];
    expect(reconcileCashFlow(entries,[])).toMatchObject({receipt:0.3,payment:0.1});
    expect(cashFlowMonths(entries,'2026-10-01','2026-10-31')[0]).toMatchObject({totalReceipt:0.3,net:0.2,cumulativeBalance:0.2});
    expect(()=>cashFlowMonths([entries[0],entries[0]],'2026-10-01','2026-10-31')).toThrow('trùng');
    for (const amount of [NaN,Infinity,-1,0.001]) expect(()=>cashFlowMonths([cash('a','receipt',amount)],'2026-10-01','2026-10-31')).toThrow('không hợp lệ');
  });
  it('validates recognized and paid amounts without inventing a branch settlement',() => {
    const row={id:'e',status:'posted',kind:'expense',category_code:'CP1',category_name:'Điện',amount:0.3,report_amount:0.1,settled_amount:0.1} as FinanceEvent;
    expect(summarizeRecognition([row,{...row,id:'e2'}])[0]).toMatchObject({amount:0.2,totalSource:0.6,settled:0.2,outstanding:0.4});
    expect(()=>summarizeRecognition([row,row])).toThrow('trùng');
    expect(()=>summarizeRecognition([{...row,settled_amount:1}])).toThrow('không hợp lệ');
    expect(()=>summarizeRecognition([{...row,report_amount:1}])).toThrow('không hợp lệ');
  });
});
