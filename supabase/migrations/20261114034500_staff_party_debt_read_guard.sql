-- Guard existing debt readers without changing independent cash/report rights.
-- The legacy company report cannot describe partial branch debt scope: when
-- exceptions exist it masks that metric instead of reporting an incorrect total.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare item record; source text; patched text; matches integer;
begin
 for item in select * from (values
  ('public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer)',
   '38f717faefd16315bf03caf6f20be2d6',
   'public.user_has_permission(auth.uid(),case p_mode when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end)',
   'public._staff_permission_at_scope(auth.uid(),case p_mode when ''customer'' then ''customers.view_debt'' else ''suppliers.view_debt'' end,p_branch_id)'),
  ('public.get_document_payment_history_scoped(text,uuid,integer,integer)',
   'a76da7242bcceb7ae71a5a27b72d135c',
   'public.user_has_permission(v_actor,''suppliers.view_debt'')',
   'public._staff_permission_at_scope(v_actor,''suppliers.view_debt'',v_branch)'),
  ('public.get_customer_report_balances_v1(uuid,boolean)',
   '151bca93cd92806405e462289b1cca3f',
   'coalesce(public.user_has_permission(v_actor,''customers.view_debt''),false)',
   '(case when p_branch_id is not null then coalesce(public._staff_permission_at_scope(v_actor,''customers.view_debt'',p_branch_id),false) else coalesce(public.user_has_permission(v_actor,''customers.view_debt''),false) and not exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=v_tenant and o.user_id=v_actor and o.permission_code=''customers.view_debt'') end)')
 ) x(sig,hash,needle,replacement) loop
  if to_regprocedure(item.sig) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(item.sig)
    and prosecdef and md5(replace(prosrc,chr(13),''))=item.hash) then
    raise exception 'PARTY_DEBT_READER_BASELINE_CHANGED: %',item.sig;
  end if;
  source:=pg_get_functiondef(to_regprocedure(item.sig));
  matches:=(length(source)-length(replace(source,item.needle,'')))/length(item.needle);
  if matches<>1 then raise exception 'PARTY_DEBT_READER_ANCHOR_CHANGED: % (%)',item.sig,matches;end if;
  patched:=replace(source,item.needle,item.replacement);
  execute patched;
 end loop;
end$$;
commit;
