// Browser-only acceptance data. No production client or credentials are loaded.
export const useAuth = () => ({tenant:{id:'fixture-tenant'},user:{id:'fixture-user'}});
export const useToast = () => ({toast:()=>{}});
export const getOpenPurchasesBySupplier = async () => [
 {id:'po-1',code:'PO-DEMO-001',date:'2026-10-12',total:630000,paid:0,debt:630000},
 {id:'po-2',code:'PO-DEMO-002',date:'2026-10-13',total:1250000,paid:500000,debt:750000},
];
export const getOpenInvoicesByCustomer = getOpenPurchasesBySupplier;
export const getCounterpartyBalanceSummary = async () => ({customers:[],suppliers:[{partyId:'supplier',advance:4457009,debt:1380000}]});
export class PartySettlementRejectedError extends Error {}
export const settlePartyDocuments = async () => ({documents:[{},{}]});
export const getMoneyAccounts = async () => [{id:'cash-demo',branch_id:'branch',code:'TM-DEMO',name:'Quỹ tiền mặt kiểm thử',kind:'cash',active:true,account_number:null}];
export const getPartyAdvanceLedger = async () => [{id:'advance-demo',branchId:'branch',branchName:'Kho kiểm thử',cashCode:'PC-DEMO-001',date:'2026-10-01',note:'Ứng trước mua nguyên liệu tháng 10',originalAmount:1000000,remainingAmount:600000,appliedAmount:300000,refundedAmount:100000,status:'active',allocations:[{documentCode:'PO-DEMO-001',amount:300000,note:'Cấn tiền nhận hàng đợt 1',createdAt:'2026-10-02'}],refunds:[{cashId:'demo-refund',cashCode:'PT-DEMO-001',amount:100000,date:'2026-10-03',note:'NCC hoàn phần ứng chưa sử dụng',status:'completed',cancellationReason:null}]}];
export class AdvanceRefundRejectedError extends Error {}
export const advanceRefundPendingKey = (tenant:string,user:string,mode:string,id:string) => `onebiz_advance_refund_v1:${tenant}:${user}:${mode}:${id}`;
export const refundPartyAdvance = async () => ({cash_id:'demo-only',cash_code:'PT-DEMO-002',status:'completed'});
export const cancelAdvanceRefund = async () => ({});
export const accountSupportsMethod = () => true;
export const getCashAmendmentHistory = async () => [{
 id:'revision-1',createdAt:'2026-10-16T02:00:00Z',createdByName:'Quản trị viên',reason:'Đối soát lại số tiền chuyển trả đơn hàng tháng 09',originalCode:'PC-DEMO-001',replacementCode:'PC-DEMO-002',
 before:{amount:600000,note:'Chuyển khoản thanh toán tiền nguyên liệu theo PO-DEMO-001',date:'2026-09-30',occurredAt:null,paymentMethod:'transfer',accountName:'Vietcombank · Quỹ vận hành'},
 after:{amount:400000,note:'Thanh toán một phần PO-DEMO-001 sau đối soát với nhà cung cấp, phần còn lại thanh toán đợt sau.',date:'2026-09-30',occurredAt:null,paymentMethod:'transfer',accountName:'Vietcombank · Quỹ vận hành'},
}];
