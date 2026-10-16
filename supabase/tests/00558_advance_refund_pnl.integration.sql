\set ON_ERROR_STOP on
\ir ../migrations/00558_advance_refund_report_classification.sql
do $$ declare before_report jsonb;after_report jsonb;before_branch jsonb;after_branch jsonb;begin
 before_report:=public.get_profit_and_loss_report_v2('2026-09-01','2026-10-01','2026-08-01','2026-09-01','40000000-0000-0000-0000-000000000001',false);
 before_branch:=public.get_branch_profit_and_loss_report_v2('2026-09-01','2026-10-01');
 insert into public.cash_transactions(id,tenant_id,branch_id,type,status,category,amount,created_at)
 values('90000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','payment','completed','customer_advance_refund',250,'2026-09-15'),
 ('90000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','receipt','completed','supplier_advance_refund',300,'2026-09-15');
 after_report:=public.get_profit_and_loss_report_v2('2026-09-01','2026-10-01','2026-08-01','2026-09-01','40000000-0000-0000-0000-000000000001',false);
 after_branch:=public.get_branch_profit_and_loss_report_v2('2026-09-01','2026-10-01');
 if before_report->'current' is distinct from after_report->'current' or before_branch->'rows' is distinct from after_branch->'rows' then
  raise exception 'Advance refunds changed profit/loss instead of cash/deposit only';end if;
 if (select sum(amount) from public.cash_transactions where category in ('customer_advance_refund','supplier_advance_refund'))<>550 then
  raise exception 'Refunds must remain in cash ledger';end if;
end;$$;
select 'PASS: real profit/loss reports exclude advance refunds while cash retains both directions';
