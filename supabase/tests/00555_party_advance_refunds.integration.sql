\set ON_ERROR_STOP on
set timezone = 'Asia/Ho_Chi_Minh';
select set_config('test.actor',test_id(1)::text,false);
\ir ../../.tmp/party-refund-dependencies.sql
alter table invoices add column issued_at timestamptz,add column note text;
alter table purchase_orders add column note text;
alter table debt_opening_balances add column created_at timestamptz default now(),add column note text;
alter table sales_returns add column code text,add column status text,add column total numeric,add column created_at timestamptz,add column note text;
alter table supplier_returns add column code text,add column status text,add column total numeric,add column created_at timestamptz,add column note text;
\ir ../migrations/00522_party_debt_movement_report.sql
\ir ../migrations/00555_party_advance_refunds.sql
\ir ../migrations/00556_advance_refund_report_classification.sql
select save_money_account(null,null,jsonb_build_object('branchId',test_id(3),'code','CASH-1','name','Test cash drawer','kind','cash','openingDate',current_date,'openingAmount',0),'Initial test cash drawer');

do $$ declare s jsonb;c jsonb;r jsonb;p jsonb;request uuid:=gen_random_uuid();aid uuid;cid uuid;account uuid;count_before bigint;begin
 select id into account from money_accounts where code='CASH-1';
 if account is null then raise exception 'Cash account fixture required';end if;
 s:=record_supplier_advance(test_id(6),1000,'cash','Supplier deposit refundable test',test_id(3),null);
 select id into aid from supplier_advances where cash_transaction_id=(s->>'cash_transaction_id')::uuid;
 select count(*) into count_before from cash_transactions;
 p:=jsonb_build_object('mode','supplier','partyId',test_id(6),'branchId',test_id(3),'advanceId',aid,
  'amount',300,'paymentMethod','cash','moneyAccountId',account,'occurredAt',now(),'transactionDate',current_date,'note','Supplier returns unused deposit');
 r:=refund_party_advance(request,p);cid:=(r->>'cash_id')::uuid;
 perform test_assert((select type='receipt' and category='supplier_advance_refund' and amount=300 and money_account_id=account and supplier_id=test_id(6) from cash_transactions where id=cid),'supplier refund is a linked receipt to the selected account');
 perform test_assert((select remaining_amount=700 from supplier_advances where id=aid),'supplier remaining reduces exactly');
 perform test_assert((select count(*)=count_before+1 from cash_transactions),'one refund creates one cash record');
 r:=refund_party_advance(request,p);
 perform test_assert((r->>'idempotent')::boolean and (select count(*)=count_before+1 from cash_transactions),'refund retry does not move money twice');
 begin perform refund_party_advance(request,p||'{"amount":200}');raise exception 'expected reused rejection';exception when sqlstate 'PT409' then null;end;
 begin perform refund_party_advance(gen_random_uuid(),p||'{"amount":701}');raise exception 'expected excess rejection';exception when sqlstate 'PT409' then null;end;
 perform test_assert((select remaining_amount=700 from supplier_advances where id=aid),'failed refunds preserve remaining');
 begin perform amend_party_cash((s->>'cash_transaction_id')::uuid,(select updated_at from cash_transactions where id=(s->>'cash_transaction_id')::uuid),gen_random_uuid(),jsonb_build_object('amount',900,'paymentMethod','cash','transactionDate',current_date,'note','Cannot reduce refunded source'),'Source refund guard');raise exception 'expected source amendment rejection';exception when sqlstate '22023' then null;end;
 begin update cash_transactions set status='cancelled' where id=(s->>'cash_transaction_id')::uuid;raise exception 'expected source cancel rejection';exception when sqlstate '22023' then null;end;
 begin update cash_transactions set amount=250 where id=cid;raise exception 'expected direct refund edit rejection';exception when sqlstate '22023' then null;end;
 r:=get_party_advance_ledger('supplier',test_id(6),test_id(3));
 select x into c from jsonb_array_elements(r) x where x->>'id'=aid::text;
 perform test_assert((c->>'refundedAmount')::numeric=300 and (c->>'appliedAmount')::numeric=0 and (c#>>'{refunds,0,cashId}')=cid::text,'source history separates refunded from allocated');
 perform cancel_party_advance_refund(cid,'Refund was entered twice in source documents');
 perform cancel_party_advance_refund(cid,'Repeated cancellation stays idempotent');
 perform test_assert((select remaining_amount=1000 and status='active' from supplier_advances where id=aid),'cancel refund restores source once');
 perform test_assert((select status='cancelled' from cash_transactions where id=cid),'cancelled refund remains visible');
 r:=refund_party_advance(request,p);
 perform test_assert(r->>'status'='cancelled','replay of cancelled refund never creates a new refund');
 -- Account failure rolls back both the voucher and source ledger.
 select count(*) into count_before from cash_transactions;
 begin perform refund_party_advance(gen_random_uuid(),p||jsonb_build_object('moneyAccountId',(select id from money_accounts where code='BANK-1')));raise exception 'expected account mismatch';exception when sqlstate '22023' then null;end;
 perform test_assert((select count(*)=count_before from cash_transactions) and (select remaining_amount=1000 from supplier_advances where id=aid),'account failure rolls back everything');
 -- Full refund consumes the remaining balance but is never called an allocation.
 r:=refund_party_advance(gen_random_uuid(),p||'{"amount":1000}');
 perform test_assert((select remaining_amount=0 and status='exhausted' from supplier_advances where id=aid),'full refund exhausts source');
 perform cancel_party_advance_refund((r->>'cash_id')::uuid,'Restore full refund test');
 insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,total,paid,debt,status)
 values(test_id(91),test_id(2),test_id(3),'PO-PARTIAL-REFUND',test_id(6),300,0,300,'completed');
 -- Use an isolated supplier so FIFO cannot consume older unrelated sources.
 insert into suppliers(id,tenant_id,name) values(test_id(92),test_id(2),'Partly allocated source supplier');
 update purchase_orders set supplier_id=test_id(92) where id=test_id(91);
 s:=record_supplier_advance(test_id(92),1000,'cash','Deposit used partly, remainder refundable',test_id(3),null);
 select id into aid from supplier_advances where cash_transaction_id=(s->>'cash_transaction_id')::uuid;
 perform apply_supplier_advance_to_purchase_order(test_id(91),300,'Apply only the purchased amount');
 r:=refund_party_advance(gen_random_uuid(),p||jsonb_build_object('partyId',test_id(92),'advanceId',aid,'amount',700));
 perform test_assert((select remaining_amount=0 from supplier_advances where id=aid) and (select paid=300 and debt=0 from purchase_orders where id=test_id(91)),'refund only unused balance leaves allocated PO fully paid');
 c:=get_party_advance_ledger('supplier',test_id(92),test_id(3))->0;
 perform test_assert((c->>'refundedAmount')::numeric=700 and (c->>'appliedAmount')::numeric=300,'allocated and refunded amounts never merge');
 c:=get_party_debt_movements('supplier',test_id(92),test_id(3),current_date-1,current_date,0,200);
 perform test_assert((c->>'difference')::numeric=0 and (c->>'unmapped')::int=0,'supplier refund reconciles in running debt history');
 perform cancel_party_advance_refund((r->>'cash_id')::uuid,'Restore partly allocated source refund');
 perform test_assert((select remaining_amount=700 from supplier_advances where id=aid),'cancelling refund never restores already allocated money');
 -- Tenant and branch checks precede any financial writes.
 perform set_config('test.actor',test_id(98)::text,true);
 begin perform refund_party_advance(gen_random_uuid(),p);raise exception 'expected tenant rejection';exception when sqlstate '42501' then null;end;
 perform set_config('test.actor',test_id(1)::text,true);
 perform set_config('test.branch_denied','yes',true);
 begin perform refund_party_advance(gen_random_uuid(),p);raise exception 'expected branch rejection';exception when sqlstate '42501' then null;end;
 perform set_config('test.branch_denied','',true);
 perform set_config('test.denied','finance.create_transaction',true);
 begin perform refund_party_advance(gen_random_uuid(),p);raise exception 'expected permission rejection';exception when sqlstate '42501' then null;end;
 perform set_config('test.denied','',true);
end;$$;

do $$ declare s jsonb;r jsonb;p jsonb;aid uuid;account uuid;before_debt numeric;summary jsonb;before_invoice numeric;before_gross numeric;begin
 select id into account from money_accounts where code='CASH-1';
 insert into invoices(id,tenant_id,branch_id,code,customer_id,total,paid,debt,status,created_at,ngay_chung_tu)
 values(test_id(90),test_id(2),test_id(3),'HD-REFUND-UNCHANGED',test_id(5),500,100,400,'completed',now(),now());
 s:=record_customer_advance(test_id(5),1000,'cash','Customer deposit refundable test',test_id(3),null);
 select id into aid from customer_advances where cash_transaction_id=(s->>'cash_transaction_id')::uuid;
 perform recompute_customer_debt(test_id(5));
 select debt into before_debt from customers where id=test_id(5);
 select sum(paid) into before_invoice from invoices where customer_id=test_id(5);
 select (x->>'outstanding')::numeric into before_gross from jsonb_array_elements(get_counterparty_open_debt_aging(test_id(3))->'customers') x where x->>'party_id'=test_id(5)::text;
 p:=jsonb_build_object('mode','customer','partyId',test_id(5),'branchId',test_id(3),'advanceId',aid,
  'amount',300,'paymentMethod','cash','moneyAccountId',account,'occurredAt',now(),'transactionDate',current_date,'note','Return unused customer deposit');
 r:=refund_party_advance(gen_random_uuid(),p);
 perform test_assert((select type='payment' and category='customer_advance_refund' and customer_id=test_id(5) from cash_transactions where id=(r->>'cash_id')::uuid),'customer refund is a linked payment');
 perform test_assert((select debt=before_debt+300 from customers where id=test_id(5)),'customer aggregate removes returned credit exactly once');
 perform test_assert((select sum(paid)=before_invoice from invoices where customer_id=test_id(5)),'refund does not change paid invoices');
 summary:=get_counterparty_balance_summary(test_id(3));
 perform test_assert(exists(select 1 from jsonb_array_elements(summary->'customers') x where x->>'party_id'=test_id(5)::text and (x->>'debt')::numeric-(x->>'advance')::numeric=before_debt+300),'customer gross/net summary matches aggregate after refund');
 perform test_assert(exists(select 1 from jsonb_array_elements(get_counterparty_open_debt_aging(test_id(3))->'customers') x where (x->>'party_id')=test_id(5)::text and (x->>'outstanding')::numeric=before_gross),'refund adjustment never becomes fictitious gross customer debt');
 perform cancel_party_advance_refund((r->>'cash_id')::uuid,'Customer refund entered by mistake');
 perform test_assert((select debt=before_debt from customers where id=test_id(5)),'cancel refund restores customer aggregate');
 perform test_assert((select remaining_amount=1000 from customer_advances where id=aid),'cancel restores exact customer source');
 summary:=get_counterparty_balance_summary(test_id(3));
 perform test_assert(exists(select 1 from jsonb_array_elements(summary->'customers') x where x->>'party_id'=test_id(5)::text and (x->>'debt')::numeric-(x->>'advance')::numeric=before_debt),'cancel refund does not invent a second customer credit');
 perform test_assert(not has_function_privilege('anon','public.refund_party_advance(uuid,jsonb)','execute'),'anonymous cannot refund');
 perform test_assert(not has_table_privilege('authenticated','public.party_advance_refunds','update'),'client cannot rewrite refund ledger');
end;$$;
select 'PASS: advance refunds, cancellations, accounting direction, source trace, retry, ACL and rollback';
