begin;

-- Private overlay: sales and historic cash remain under the existing report guards.
create function public.management_finance_period_totals(p_tenant_id uuid,p_from timestamptz,p_to timestamptz,p_branch_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'expense',coalesce(sum(a.amount) filter(where e.kind='expense'),0),
  'income',coalesce(sum(a.amount) filter(where e.kind='income'),0))
 from public.management_finance_events e join public.management_finance_allocations a on a.event_id=e.id
 where e.tenant_id=p_tenant_id and e.status='posted'
  and (a.recognition_date::timestamp at time zone 'Asia/Ho_Chi_Minh')>=p_from
  and (a.recognition_date::timestamp at time zone 'Asia/Ho_Chi_Minh')<p_to
  and (p_branch_id is null or a.branch_id=p_branch_id)
  and public.user_has_branch_access(auth.uid(),a.branch_id);
$$;
revoke all on function public.management_finance_period_totals(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;

-- Patch only verified fragments of the deployed definition; reject drift atomically.
do $$
declare v_source text; v_old text; v_new text; begin
 v_source:=pg_get_functiondef('public.get_profit_and_loss_report_v2(timestamptz,timestamptz,timestamptz,timestamptz,uuid,boolean)'::regprocedure);
 v_old:='and coalesce(ct.status, ''completed'') = ''completed''';
 if (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>1 then
  raise exception 'PNL_CASH_FRAGMENT_DRIFT'; end if;
 v_new:=v_old||E'\n         and not exists(select 1 from public.management_finance_settlements ms join public.management_finance_events me on me.id=ms.event_id where ms.cash_transaction_id=ct.id and me.tenant_id=v_tenant_id)';
 v_source:=replace(v_source,v_old,v_new);
 v_old:='coalesce(e.operating_expense, 0) as operating_expense,';
 if (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>1 then
  raise exception 'PNL_EXPENSE_FRAGMENT_DRIFT'; end if;
 v_new:=E'coalesce(e.operating_expense, 0) as legacy_cash_expense,\n             coalesce(e.operating_expense, 0) + (public.management_finance_period_totals(v_tenant_id,p.date_from,p.date_to,p_branch_id)->>''expense'')::numeric as operating_expense,\n             (public.management_finance_period_totals(v_tenant_id,p.date_from,p.date_to,p_branch_id)->>''income'')::numeric as other_income,';
 v_source:=replace(v_source,v_old,v_new);
 execute v_source;
end; $$;

notify pgrst,'reload schema';
commit;
