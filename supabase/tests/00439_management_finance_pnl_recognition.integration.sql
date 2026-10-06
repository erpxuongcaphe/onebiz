-- Disposable database only. Reuse the real snapshot report and its legacy assertions.
\set ON_ERROR_STOP on
\ir 00406_profit_loss_snapshot_cogs.integration.sql
create function public.user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select true$$;
create table public.management_finance_events(id uuid primary key,tenant_id uuid,kind text,status text);
create table public.management_finance_allocations(event_id uuid,branch_id uuid,recognition_date date,amount numeric);
create table public.management_finance_settlements(event_id uuid,cash_transaction_id uuid);
\ir ../migrations/00439_management_finance_pnl_recognition.sql
insert into public.management_finance_events values
 ('a0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','expense','posted'),
 ('a0000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','income','posted'),
 ('a0000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','non_pnl','posted');
insert into public.management_finance_allocations values
 ('a0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-09-30',100),
 ('a0000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-09-30',25),
 ('a0000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','2026-09-30',80);
insert into public.cash_transactions values
 ('b0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','payment','completed','management_expense',40,'2026-10-05'),
 ('b0000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','payment','completed','management_non_pnl',80,'2026-10-05');
insert into public.management_finance_settlements values
 ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002');
do $$ declare v_result jsonb; begin
 v_result:=public.get_profit_and_loss_report_v2('2026-08-31T17:00:00Z','2026-09-30T17:00:00Z','2026-09-30T17:00:00Z','2026-10-31T17:00:00Z',null,false);
 if (v_result#>>'{current,operating_expense}')::numeric<>800 or (v_result#>>'{current,legacy_cash_expense}')::numeric<>700 then raise exception 'recognition or historic expense changed: %',v_result; end if;
 if (v_result#>>'{current,other_income}')::numeric<>25 then raise exception 'other income missing'; end if;
 if (v_result#>>'{previous,operating_expense}')::numeric<>0 then raise exception 'linked payment counted twice'; end if;
 if (v_result#>>'{current,revenue}')::numeric<>120 then raise exception 'sales revenue changed'; end if;
 update public.management_finance_events set status='cancelled' where id='a0000000-0000-0000-0000-000000000001';
 v_result:=public.get_profit_and_loss_report_v2('2026-08-31T17:00:00Z','2026-09-30T17:00:00Z','2026-09-30T17:00:00Z','2026-10-31T17:00:00Z',null,false);
 if (v_result#>>'{current,operating_expense}')::numeric<>700 then raise exception 'voided event retained'; end if;
 if has_function_privilege('authenticated','public.management_finance_period_totals(uuid,timestamptz,timestamptz,uuid)','EXECUTE') then raise exception 'private totals exposed'; end if;
end; $$;
