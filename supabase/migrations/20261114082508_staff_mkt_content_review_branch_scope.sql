-- Scope review while preserving existing account-level review permissions.
-- Shared content continues to require the account-level permission.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare body text; patched text; gate text; target record;
begin
  for target in select * from (values
    ('public._staff_mkt_read_workflow(text,uuid)', '310cde8854511aaba7541a9250d7dd75'),
    ('public.mkt_get_my_context()', '0ed1c3942c8ade8361a13e65db55582f'),
    ('public.mkt_review_content(uuid,uuid,text,text)', '6f541f30163aba1d5679296219a20173')
  ) as expected(signature, source_hash) loop
    if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(target.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=target.source_hash) then
      raise exception 'MKT_REVIEW_BASELINE_CHANGED: %', target.signature;
    end if;
  end loop;
  select replace(pg_get_functiondef('public._staff_mkt_read_workflow(text,uuid)'::regprocedure), chr(13), '') into body;
  gate := 'public.user_has_permission(u,''mkt.review_content'')';
  patched := replace(body, gate, 'public._staff_mkt_linked_permission(u,''mkt.review_content'',null,null,c.id,null)');
  if patched = body then raise exception 'MKT_REVIEW_READ_BASELINE_CHANGED'; end if;
  execute patched;

  select replace(pg_get_functiondef('public.mkt_review_content(uuid,uuid,text,text)'::regprocedure), chr(13), '') into body;
  gate := 'if not public.user_has_permission(v_actor, ''mkt.review_content'') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;';
  patched := replace(body, gate, '');
  if patched = body then raise exception 'MKT_REVIEW_WRITE_GATE_CHANGED'; end if;
  body := patched;
  gate := 'if not found or v_content.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;';
  patched := replace(body, gate, gate || chr(10) || '  if not public._staff_mkt_linked_permission(v_actor, ''mkt.review_content'', null, null, p_content_id, null) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
  if patched = body then raise exception 'MKT_REVIEW_WRITE_CONTENT_GATE_CHANGED'; end if;
  execute patched;

  select replace(pg_get_functiondef('public.mkt_get_my_context()'::regprocedure), chr(13), '') into body;
  gate := '''canReview'', public.user_has_permission(v_actor, ''mkt.review_content'')';
  patched := replace(body, gate, '''canReview'', (public.user_has_permission(v_actor, ''mkt.review_content'') or exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=v_profile.tenant_id and o.user_id=v_actor and o.permission_code=''mkt.review_content'' and o.override_type=''grant'' and public.user_has_permission_at_branch(v_actor,''mkt.review_content'',o.branch_id)))');
  if patched = body then raise exception 'MKT_REVIEW_CONTEXT_BASELINE_CHANGED'; end if;
  execute patched;
end $$;

-- A user may also see content because they were assigned to it. Do not infer
-- the right to review from visibility; return only the IDs they may review.
create function public.mkt_reviewable_content_ids(p_content_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; result uuid[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if coalesce(cardinality(p_content_ids),0)>50 then raise exception 'TOO_MANY_CONTENT_IDS'; end if;
  select tenant_id into tenant from public.profiles where id=actor and is_active;
  if tenant is null then return '{}'::uuid[]; end if;
  select coalesce(array_agg(c.id),'{}'::uuid[]) into result
  from public.mkt_content_items c
  where c.id=any(p_content_ids) and c.tenant_id=tenant and c.deleted_at is null
    and public._staff_mkt_linked_permission(actor,'mkt.review_content',null,null,c.id,null);
  return result;
end $$;
revoke all on function public.mkt_reviewable_content_ids(uuid[]) from public, anon;
grant execute on function public.mkt_reviewable_content_ids(uuid[]) to authenticated;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('mkt.review_content',1);
commit;
