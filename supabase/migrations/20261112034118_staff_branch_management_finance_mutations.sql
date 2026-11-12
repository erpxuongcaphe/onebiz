-- Management-ledger operations also consume create/void permissions through
-- a shared actor helper. Check every affected persisted allocation and branch.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public._staff_management_finance_action_actor(p_code text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
  select tenant_id into tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if tenant is null or p_code not in ('finance.create_transaction','finance.void_transaction')
    or not coalesce(public._staff_permission_any_branch(auth.uid(),p_code),false) then
    raise exception 'MANAGEMENT_FINANCE_DENIED' using errcode='42501';
  end if;
  return tenant;
end $$;
revoke all on function public._staff_management_finance_action_actor(text) from public,anon,authenticated;

do $migration$
declare item record; scope text; source text; anchor text; replacement text;
begin
  for item in select * from (values
    ('public.post_management_finance_event(uuid,jsonb)','finance.create_transaction',array['a.branch_id','v_branch']),
    ('public.settle_management_finance_event(uuid,uuid,jsonb)','finance.create_transaction',array['a.branch_id']),
    ('public.cancel_management_finance_event(uuid,text)','finance.void_transaction',array['a.branch_id']),
    ('public.preview_management_finance_import(jsonb)','finance.create_transaction',array['v_branch','v_existing.branch_id','branch_id']),
    ('public.commit_management_finance_import(jsonb)','finance.create_transaction',array['v_existing.branch_id'])
  ) as entries(signature,code,branches) loop
    source:=pg_get_functiondef(item.signature::regprocedure);
    anchor:=format('public.management_finance_actor(%L)',item.code);
    if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
      raise exception 'STAFF_MANAGEMENT_ACTION_ACTOR_CHANGED: %',item.signature;
    end if;
    source:=replace(source,anchor,format('public._staff_management_finance_action_actor(%L)',item.code));
    foreach scope in array item.branches loop
      anchor:=format('public.user_has_branch_access(auth.uid(),%s)',scope);
      if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
        raise exception 'STAFF_MANAGEMENT_ACTION_SCOPE_CHANGED: % %',item.signature,scope;
      end if;
      replacement:=format('(public.user_has_branch_access(auth.uid(),%s) and public._staff_permission_at_scope(auth.uid(),%L,%s))',scope,item.code,scope);
      source:=replace(source,anchor,replacement);
    end loop;
    -- Legacy data may contain an event without allocations. Once local
    -- exceptions exist there is no branch against which to authorize it.
    if item.signature='public.post_management_finance_event(uuid,jsonb)' then
      anchor:='if exists(select 1 from public.management_finance_allocations a where a.event_id=v_event.id';
      if position(anchor in source)=0 then raise exception 'STAFF_MANAGEMENT_POST_REPLAY_CHANGED'; end if;
      source:=replace(source,anchor,
        'if (exists(select 1 from public.user_branch_permission_overrides o where o.user_id=auth.uid() and o.permission_code=''finance.create_transaction'') and not exists(select 1 from public.management_finance_allocations a where a.event_id=v_event.id)) or exists(select 1 from public.management_finance_allocations a where a.event_id=v_event.id');
    elsif item.signature in ('public.settle_management_finance_event(uuid,uuid,jsonb)','public.cancel_management_finance_event(uuid,text)') then
      anchor:='if not found or exists(select 1 from public.management_finance_allocations a where a.event_id=p_event_id';
      if position(anchor in source)=0 then raise exception 'STAFF_MANAGEMENT_EVENT_SCOPE_CHANGED: %',item.signature; end if;
      source:=replace(source,anchor,format(
        'if not found or (exists(select 1 from public.user_branch_permission_overrides o where o.user_id=auth.uid() and o.permission_code=%L) and not exists(select 1 from public.management_finance_allocations a where a.event_id=p_event_id)) or exists(select 1 from public.management_finance_allocations a where a.event_id=p_event_id',item.code));
    end if;
    execute source;
  end loop;

  source:=pg_get_functiondef('public.submit_cash_journal_template_review_v1(uuid,jsonb)'::regprocedure);
  anchor:='public.management_finance_actor(''finance.create_transaction'')';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_SUBMIT_ACTOR_CHANGED'; end if;
  source:=replace(source,anchor,'public._staff_management_finance_action_actor(''finance.create_transaction'')');
  anchor:='public.management_finance_actor(''finance.view_cash_book'')';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_SUBMIT_VIEW_CHANGED'; end if;
  source:=replace(source,anchor,'public._staff_management_finance_view_actor(v_branch)');
  anchor:='not coalesce(public.can_write_branch_document_00567(v_tenant, v_branch), false)';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_SUBMIT_BRANCH_CHANGED'; end if;
  source:=replace(source,anchor,anchor||' or not public._staff_permission_at_scope(auth.uid(),''finance.create_transaction'',v_branch)');
  execute source;

  source:=pg_get_functiondef('public.post_cash_journal_template_review_v1(uuid)'::regprocedure);
  anchor:='public.management_finance_actor(''finance.create_transaction'')';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_POST_ACTOR_CHANGED'; end if;
  source:=replace(source,anchor,'public._staff_management_finance_action_actor(''finance.create_transaction'')');
  anchor:='perform public.management_finance_actor(''finance.view_cash_book'');';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_POST_VIEW_CHANGED'; end if;
  source:=replace(source,anchor,'');
  anchor:='or not coalesce(public.can_write_branch_document_00567(v_tenant,v_review.branch_id),false)';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_POST_BRANCH_CHANGED'; end if;
  source:=replace(source,anchor,anchor||' or not public._staff_permission_at_scope(auth.uid(),''finance.create_transaction'',v_review.branch_id)');
  anchor:='if v_review.status = ''posted'' then';
  if position(anchor in source)=0 then raise exception 'STAFF_JOURNAL_POST_STATUS_CHANGED'; end if;
  source:=replace(source,anchor,'perform public._staff_management_finance_view_actor(v_review.branch_id); '||anchor);
  execute source;
end $migration$;
commit;
