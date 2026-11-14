-- Branch-aware collaborator visibility. No Hub permission is exposed in the
-- staff catalogue until the remaining read/write entry points are checked.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare x record; begin
 for x in select * from (values
  ('public.ops_todo_visible(uuid)','09a8b61a281499fed2c8f8a748dbc4e7'),
  ('public.ops_access_context()','e4433780b30832e8d0bca41c509f8dad'),
  ('public.ops_todo_page(uuid,text,boolean,boolean,timestamp with time zone,uuid)','75c39052174b5714197386766e9e5674'),
  ('public.ops_workspace(uuid,text)','129103640a64ecdcb2b78562b3317a52')
 ) as v(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=x.expected) then
   raise exception 'HUB_COLLABORATOR_BASELINE_CHANGED: %',x.signature;
  end if;
 end loop;
end$$;

create function public._staff_hub_any_view(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.user_has_permission(p_user,'ops.view'),false) or exists(
  select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
  where p.id=p_user and p.is_active and b.is_active
   and public._staff_permission_at_scope(p.id,'ops.view',b.id));
$$;
revoke all on function public._staff_hub_any_view(uuid) from public,anon,authenticated;

create or replace function public.ops_todo_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_todos t join public.profiles p on p.tenant_id=t.tenant_id
 where t.id=p_id and p.id=auth.uid() and p.is_active
 and public._staff_permission_at_scope(p.id,'ops.view',t.branch_id)
 and (public.ops_can(t.branch_id,'view') or p.id=any(t.collaborators)));
$$;

create or replace function public.ops_access_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; allowed boolean := false;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 if p.id is not null and public._staff_hub_any_view(p.id) then
  allowed := public.ops_ceo()
   or exists(select 1 from public.branches b where b.tenant_id=p.tenant_id and b.is_active and public.ops_can(b.id,'view'))
   or exists(select 1 from public.ops_todos t join public.branches b on b.id=t.branch_id and b.tenant_id=t.tenant_id
     where t.tenant_id=p.tenant_id and b.is_active and p.id=any(t.collaborators) and public.ops_todo_visible(t.id));
 end if;
 return jsonb_build_object('recurrenceVersion',1,'allowed',allowed,'isCeo',p.id is not null and public.ops_ceo());
end $$;

-- Preserve the rest of each established function verbatim; abort if source
-- or the expected replacement sites change.
do $$declare signature text; body text; rewritten text; old_gate text := 'not public.ops_has_permission(''ops.view'')'; new_gate text := 'not public._staff_hub_any_view(p.id)';
 old_collab text := 'p.id=any(t.collaborators)'; new_collab text := '(p.id=any(t.collaborators) and public._staff_permission_at_scope(p.id,''ops.view'',t.branch_id))';
begin
 foreach signature in array array['public.ops_todo_page(uuid,text,boolean,boolean,timestamp with time zone,uuid)','public.ops_workspace(uuid,text)'] loop
  select replace(pg_get_functiondef(to_regprocedure(signature)),chr(13),'') into body;
  if body is null or position(old_gate in body)=0 or position(old_collab in body)=0 then raise exception 'HUB_COLLABORATOR_PATCH_MISSING: %',signature; end if;
  rewritten:=replace(replace(body,old_gate,new_gate),old_collab,new_collab);
  if rewritten=body or position(old_gate in rewritten)>0 or position(old_collab in rewritten)=0 then raise exception 'HUB_COLLABORATOR_PATCH_FAILED: %',signature; end if;
  execute rewritten;
 end loop;
end$$;
commit;
