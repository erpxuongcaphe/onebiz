\set ON_ERROR_STOP on
-- Match business dates to the application's Vietnam timezone, including UTC midnight boundaries.
set time zone 'Asia/Ho_Chi_Minh';
select set_config('test.actor',test_id(1)::text,false);
-- Actual payment/cancellation/allocation RPCs are loaded by the setup fixture.
do $$ declare account jsonb; cash jsonb; old_cash cash_transactions%rowtype; result jsonb; payload jsonb; request uuid:=gen_random_uuid(); n bigint; balance jsonb; begin
 account:=save_money_account(null,null,jsonb_build_object('branchId',test_id(3),'code','BANK-1','name','Test bank','kind','bank','bankName','Test Bank','accountNumber','000123','accountHolder','Test owner','openingDate',current_date-10,'openingAmount',10000),'Initial test opening');
 perform test_assert((select count(*)=0 from cash_transactions),'opening creates no income or cash voucher');
 insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,total,paid,debt,status,updated_at)
 values(test_id(20),test_id(2),test_id(3),'PO-TEST',test_id(6),'Test supplier',1000,0,1000,'completed',now());
 cash:=record_cash_with_account('purchase_order',jsonb_build_object('referenceId',test_id(20),'amount',600,'paymentMethod','transfer','note','Payment for PO-TEST'),(account->>'id')::uuid,null,now(),current_date,null);
 select * into old_cash from cash_transactions where id=(cash->>'cash_transaction_id')::uuid;
 perform test_assert(old_cash.money_account_id=(account->>'id')::uuid,'payment uses explicit bank');
 payload:=jsonb_build_object('amount',400,'paymentMethod','transfer','transactionDate',current_date,'occurredAt',now(),'moneyAccountId',account->>'id','note','Correct purchase payment PO-TEST');
 result:=amend_party_cash(old_cash.id,old_cash.updated_at,request,payload,'Correct test amount');
 perform test_assert((select paid=400 and debt=600 from purchase_orders where id=test_id(20)),'amount amendment reverses old and posts new debt');
 perform test_assert((select status='cancelled' and amount=600 from cash_transactions where id=old_cash.id),'original remains in history');
 perform test_assert((select amount=400 and status='completed' and money_account_id=(account->>'id')::uuid from cash_transactions where id=(result->>'cash_id')::uuid),'replacement money account preserved');
 select count(*) into n from cash_transactions;
 perform amend_party_cash(old_cash.id,old_cash.updated_at,request,payload,'Correct test amount');
 perform test_assert((select count(*)=n from cash_transactions),'same request never posts twice');
 balance:=get_money_account_workspace(test_id(3),current_date-5,current_date);
 perform test_assert((balance#>>'{accounts,0,opening_balance}')::numeric=10000 and (balance#>>'{accounts,0,payments}')::numeric=400 and (balance#>>'{accounts,0,closing_balance}')::numeric=9600,'opening + net active cash only');
 result:=get_party_cash_history_detail('supplier',test_id(6),null);
 perform test_assert((result->>'total')::integer=2 and (select bool_or(x->>'replacement_code' is not null) from jsonb_array_elements(result->'items')x),'cancelled/original/replacement all visible');
 begin perform amend_party_cash(old_cash.id,old_cash.updated_at,request,payload||'{"amount":300}','Correct test amount'); raise exception 'expected request misuse rejection';exception when sqlstate 'PT409' then null;end;
 -- A wrong account/method must roll back both receipt and debt.
 begin perform record_cash_with_account('purchase_order',jsonb_build_object('referenceId',test_id(20),'amount',100,'paymentMethod','cash','note','Bad bank mapping'),(account->>'id')::uuid,null,now(),current_date,null);raise exception 'expected bad account rejection';exception when sqlstate '22023' then null;end;
 perform test_assert((select count(*)=n from cash_transactions) and (select paid=400 from purchase_orders where id=test_id(20)),'account failure rolls debt and cash back');
 -- Metadata edits cannot change amount, immutable creator or debt, and reject stale clients.
 select * into old_cash from cash_transactions where status='completed';
 payload:=jsonb_build_object('amount',400,'paymentMethod','transfer','transactionDate',current_date-1,'occurredAt',null,'moneyAccountId',account->>'id','note','Specific corrected bank payment for PO-TEST');
 perform amend_party_cash(old_cash.id,old_cash.updated_at,gen_random_uuid(),payload,'Correct bookkeeping day');
 perform test_assert((select paid=400 from purchase_orders where id=test_id(20)),'metadata edit leaves debt unchanged');
 result:=get_cash_amendment_history(old_cash.id);
 perform test_assert(jsonb_array_length(result)=2,'opening replacement shows every metadata and amount revision');
 perform test_assert(exists(select 1 from jsonb_array_elements(result) x
  where x#>>'{before,note}'='Correct purchase payment PO-TEST'
  and x#>>'{after,note}'='Specific corrected bank payment for PO-TEST'),'amendment snapshots retain exact before/after content');
 begin perform amend_party_cash(old_cash.id,old_cash.updated_at,gen_random_uuid(),payload,'Stale edit rejected');raise exception 'expected stale rejection';exception when sqlstate 'PT409' then null;end;
 perform set_config('test.denied','finance.void_transaction',true);
 begin perform amend_party_cash(old_cash.id,old_cash.updated_at,gen_random_uuid(),payload,'Denied edit');raise exception 'expected permission rejection';exception when insufficient_privilege then null;end;
 perform set_config('test.denied','',true);
 perform set_config('test.branch_denied','yes',true);
 begin perform get_cash_amendment_history(old_cash.id);raise exception 'expected audit branch rejection';exception when insufficient_privilege then null;end;
 perform set_config('test.branch_denied','',true);
 begin perform save_money_account((account->>'id')::uuid,0,jsonb_build_object('branchId',test_id(3),'kind','bank'),'Stale account');raise exception 'expected account version rejection';exception when sqlstate 'PT409' then null;end;
 perform test_assert(not has_function_privilege('anon','public.amend_party_cash(uuid,timestamptz,uuid,jsonb,text)','execute'),'anonymous amendment denied');
end $$;

do $$ declare adv jsonb; request uuid:=gen_random_uuid(); payload jsonb; r jsonb; n bigint; c cash_transactions%rowtype; begin
 adv:=record_cash_transaction_timed('supplier_advance',jsonb_build_object('partyId',test_id(6),'branchId',test_id(3),'amount',900,'paymentMethod','cash','note','Deposit for test supplier order'),now(),current_date,null);
 select count(*) into n from cash_transactions;
 payload:=jsonb_build_object('mode','supplier','source','advance','branchId',test_id(3),'partyId',test_id(6),'note','Apply deposit to received PO-TEST','lines',jsonb_build_array(jsonb_build_object('id',test_id(20),'amount',600)));
 r:=settle_party_documents_atomic(request,payload);
 perform test_assert((select paid=1000 and debt=0 from purchase_orders where id=test_id(20)),'advance marks purchase paid');
 perform test_assert((select count(*)=n from cash_transactions),'advance allocation creates no duplicate expense or cash');
 perform test_assert((select remaining_amount=300 from supplier_advances where cash_transaction_id=(adv->>'cash_transaction_id')::uuid),'only applied amount consumes advance');
 perform settle_party_documents_atomic(request,payload);
 perform test_assert((select remaining_amount=300 from supplier_advances where cash_transaction_id=(adv->>'cash_transaction_id')::uuid),'allocation retry is idempotent');
 r:=get_party_advance_ledger('supplier',test_id(6),test_id(3));
 perform test_assert(r#>>'{0,allocations,0,documentCode}'='PO-TEST' and (r#>>'{0,allocations,0,amount}')::numeric=600,'source allocation trace contains exact document');
 select * into c from cash_transactions where id=(adv->>'cash_transaction_id')::uuid;
 begin perform amend_party_cash(c.id,c.updated_at,gen_random_uuid(),jsonb_build_object('amount',800,'paymentMethod','cash','transactionDate',current_date,'note','Reduce allocated supplier deposit'),'Allocated source');raise exception 'expected allocated guard';exception when sqlstate '22023' then if sqlerrm<>'CASH_AMEND_ADVANCE_ALREADY_ALLOCATED' then raise;end if;end;
 perform test_assert((select status='completed' and amount=900 from cash_transactions where id=c.id),'allocated advance not damaged');
 -- Batch failure on the second document must reverse no part of the first.
 insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,total,paid,debt,status,updated_at)
 values(test_id(21),test_id(2),test_id(3),'PO-BATCH-A',test_id(6),'Test supplier',500,0,500,'completed',now()),
 (test_id(22),test_id(2),test_id(3),'PO-BATCH-B',test_id(6),'Test supplier',500,0,500,'completed',now());
 payload:=jsonb_build_object('mode','supplier','source','advance','branchId',test_id(3),'partyId',test_id(6),'note','Insufficient batch deposit','lines',jsonb_build_array(jsonb_build_object('id',test_id(21),'amount',200),jsonb_build_object('id',test_id(22),'amount',200)));
 begin perform settle_party_documents_atomic(gen_random_uuid(),payload);raise exception 'expected insufficient source';exception when sqlstate '22023' then null;end;
 perform test_assert((select sum(paid)=0 from purchase_orders where id in(test_id(21),test_id(22))),'failed batch leaves all document debt unchanged');
 perform test_assert((select remaining_amount=300 from supplier_advances where cash_transaction_id=c.id),'failed batch restores advance');
 perform set_config('test.actor',test_id(98)::text,true);
 begin perform get_party_advance_ledger('supplier',test_id(6),null);raise exception 'expected tenant rejection';exception when insufficient_privilege then null;end;
 perform set_config('test.actor',test_id(1)::text,true);
end $$;
do $$ declare r jsonb; c cash_transactions%rowtype; payload jsonb; account uuid; event_id uuid; request uuid:=gen_random_uuid(); count_before bigint; begin
 -- Customer flow uses the same production collection/advance functions.
 insert into invoices(id,tenant_id,branch_id,code,customer_id,customer_name,total,paid,debt,status,updated_at,created_at)
 values(test_id(30),test_id(2),test_id(3),'HD-TEST',test_id(5),'Test customer',800,0,800,'completed',now(),now());
 r:=record_cash_transaction_timed('invoice',jsonb_build_object('referenceId',test_id(30),'amount',300,'paymentMethod','cash','note','Collect HD-TEST part one'),now(),current_date,null);
 select * into c from cash_transactions where id=(r->>'cash_transaction_id')::uuid;
 perform amend_party_cash(c.id,c.updated_at,gen_random_uuid(),jsonb_build_object('amount',200,'paymentMethod','cash','transactionDate',current_date,'note','Correct customer payment HD-TEST'),'Customer payment correction');
 perform test_assert((select paid=200 and debt=600 from invoices where id=test_id(30)),'customer amendment updates exact invoice');
 perform record_cash_transaction_timed('customer_advance',jsonb_build_object('partyId',test_id(5),'branchId',test_id(3),'amount',600,'paymentMethod','cash','note','Customer deposit for HD-TEST'),now(),current_date,null);
 select count(*) into count_before from cash_transactions;
 perform settle_party_documents_atomic(gen_random_uuid(),jsonb_build_object('mode','customer','source','advance','branchId',test_id(3),'partyId',test_id(5),'note','Apply customer deposit HD-TEST','lines',jsonb_build_array(jsonb_build_object('id',test_id(30),'amount',600))));
 perform test_assert((select paid=800 and debt=0 from invoices where id=test_id(30)) and (select count(*)=count_before from cash_transactions),'customer advance settles invoice without duplicate receipt');
 -- Legacy purchase category remains editable through its exact PO reference.
 insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,total,paid,debt,status,updated_at)
 values(test_id(31),test_id(2),test_id(3),'PO-OVER',test_id(6),'Test supplier',100,0,100,'completed',now());
 r:=record_cash_transaction_timed('purchase_order',jsonb_build_object('referenceId',test_id(31),'amount',150,'paymentMethod','cash','note','Purchase overpayment PO-OVER'),now(),current_date,null);
 update cash_transactions set category='purchase' where id=(r->>'cash_transaction_id')::uuid;
 select * into c from cash_transactions where id=(r->>'cash_transaction_id')::uuid;
 r:=amend_party_cash(c.id,c.updated_at,gen_random_uuid(),jsonb_build_object('amount',120,'paymentMethod','cash','transactionDate',current_date,'note','Correct overpayment PO-OVER'),'Correct unused overpayment');
 perform test_assert((select paid=100 and debt=0 from purchase_orders where id=test_id(31)),'overpayment amendment never creates negative PO debt');
 perform test_assert((select original_amount=20 and remaining_amount=20 from supplier_advances where cash_transaction_id=(r->>'cash_id')::uuid),'replacement excess remains exact available advance');
 -- Real management recognition and cash settlement wrappers, not mocked RPCs.
 select id into account from money_accounts where code='BANK-1';
 payload:=jsonb_build_object('categoryId',(select id from management_finance_categories where tenant_id=test_id(2) and code='CP-VH-DIEN'),
  'businessDate',current_date,'amount',100,'counterparty','Electricity supplier','note','Electricity September test',
  'allocations',jsonb_build_array(jsonb_build_object('branchId',test_id(3),'recognitionDate',current_date,'amount',100)),
  'payment',jsonb_build_object('branchId',test_id(3),'performedBy',test_id(1),'amount',40,'paymentMethod','transfer','moneyAccountId',account,'transactionDate',current_date,'occurredAt',now(),'note','Electricity September first payment'));
 r:=save_management_finance_with_account(request,payload);
 event_id:=(r#>>'{event,id}')::uuid;
 perform test_assert((select money_account_id=account and amount=40 from cash_transactions where id=(r#>>'{cash,id}')::uuid),'management payment assigns selected account atomically');
 select count(*) into count_before from cash_transactions;
 perform save_management_finance_with_account(request,payload);
 perform test_assert((select count(*)=count_before from cash_transactions),'management wrapper replay creates no duplicate cash');
 r:=settle_management_finance_with_account(event_id,gen_random_uuid(),jsonb_build_object('branchId',test_id(3),'performedBy',test_id(1),'amount',60,'paymentMethod','transfer','moneyAccountId',account,'transactionDate',current_date,'occurredAt',now(),'note','Electricity September final payment'));
 perform test_assert((select money_account_id=account and amount=60 from cash_transactions where id=(r->>'id')::uuid),'later management settlement preserves selected bank');
end $$;
select 'PASS: accounts, audit, supplier/customer settlements, overpayments, management recognition and retry safety';

begin;
insert into suppliers(id,tenant_id,name) values(test_id(80),test_id(2),'Gross debt supplier');
insert into customers(id,tenant_id,name) values(test_id(81),test_id(2),'Gross debt customer');
insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,total,paid,debt,status,created_at)
values(test_id(82),test_id(2),test_id(3),'PO-GROSS',test_id(80),630000,0,630000,'completed',now()-interval '45 days');
insert into invoices(id,tenant_id,branch_id,code,customer_id,total,paid,debt,status,created_at,ngay_chung_tu)
values(test_id(83),test_id(2),test_id(3),'HD-GROSS',test_id(81),200000,0,200000,'completed',now()-interval '95 days',now()-interval '95 days'),
(test_id(84),test_id(2),test_id(3),'HD-DRAFT',test_id(81),900,0,900,'draft',now(),now()),
(test_id(85),test_id(2),test_id(4),'HD-OTHER-BRANCH',test_id(81),700,0,700,'completed',now(),now());
select record_supplier_advance(test_id(80),4457009,'cash','Unused supplier advance exceeds gross debt',test_id(3),null);
select record_customer_advance(test_id(81),500000,'cash','Unused customer advance exceeds gross debt',test_id(3),null);
do $$ declare r jsonb; s jsonb; c jsonb; n bigint; begin
 select count(*) into n from cash_transactions;
 r:=get_counterparty_open_debt_aging(test_id(3));
 select value into s from jsonb_array_elements(r->'suppliers') where value->>'party_id'=test_id(80)::text;
 select value into c from jsonb_array_elements(r->'customers') where value->>'party_id'=test_id(81)::text;
 perform test_assert((s->>'document_count')::int=1 and (s->>'outstanding')::numeric=630000,'unused supplier advance never hides unpaid PO');
 perform test_assert((s->>'bucket_31_60')::numeric=630000 and (s->>'oldest_days')::int=45,'supplier age stays with its unpaid document');
 perform test_assert((c->>'document_count')::int=1 and (c->>'bucket_91_plus')::numeric=200000,'customer advance does not hide debt; drafts and foreign branch excluded');
 perform test_assert((select count(*)=n from cash_transactions),'aging reader never creates cash');
 perform test_assert((select debt=630000 and paid=0 from purchase_orders where id=test_id(82)),'aging reader never allocates advances');
 perform set_config('test.actor',test_id(98)::text,true);
 r:=get_counterparty_open_debt_aging(null);
 perform test_assert(r->'customers'='[]'::jsonb and r->'suppliers'='[]'::jsonb,'aging reader isolates tenant');
 perform set_config('test.actor',test_id(1)::text,true);
 perform set_config('test.denied','reports.view_detail',true);
 begin perform get_counterparty_open_debt_aging(test_id(3));raise exception 'expected report permission denial';
 exception when others then if sqlerrm<>'REPORT_DENIED' then raise;end if;end;
end $$;
rollback;
select 'PASS: gross open document count and aging remain visible with excess advances';
