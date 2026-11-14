-- Linked documents and assets follow all linked campaigns; unlinked assets remain global.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public._staff_mkt_view_asset(text,uuid)') is not null then raise exception 'MKT_ASSET_SCOPE_HELPER_EXISTS';end if;end$$;
create function public._staff_mkt_view_asset(p_kind text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();tenant uuid; result boolean:=false;begin
 if u is null then return false;end if;
 select tenant_id into tenant from public.profiles where id=u and is_active;
 if tenant is null then return false;end if;
 if p_kind='document' then
  select public._staff_mkt_linked_permission(u,'mkt.view',d.campaign_id,null,null,null) into result from public.mkt_documents d where d.id=p_id and d.tenant_id=tenant;
 elsif p_kind='media' then
  select public._staff_mkt_linked_permission(u,'mkt.view',a.campaign_id,null,a.content_item_id,null) into result from public.mkt_media_assets a where a.id=p_id and a.tenant_id=tenant;
 end if;
 return coalesce(result,false);
end$$;
revoke all on function public._staff_mkt_view_asset(text,uuid) from public,anon;
grant execute on function public._staff_mkt_view_asset(text,uuid) to authenticated;
do $$declare r record;expression text;patched text;begin
 for r in select * from (values
  ('public.mkt_documents','mkt_documents_select','document','mkt_documents.id'),
  ('public.mkt_media_assets','mkt_media_select','media','mkt_media_assets.id')
 ) as x(tbl,policy,kind,id_expr) loop
  select pg_get_expr(polqual,polrelid) into expression from pg_policy where polrelid=to_regclass(r.tbl) and polname=r.policy;
  if expression is null or md5(expression)<>'a55a21a78dd38001ea3affe8c5fff73c' then raise exception 'MKT_ASSET_READ_BASELINE_CHANGED: %',r.policy;end if;
  patched:=replace(expression,'( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''mkt.view''::text) AS user_has_permission)','public._staff_mkt_view_asset(''' || r.kind || ''',' || r.id_expr || ')');
  if patched=expression then raise exception 'MKT_ASSET_READ_SCOPE_CHANGED: %',r.policy;end if;
  execute format('alter policy %I on %s using (%s)',r.policy,r.tbl,patched);
 end loop;
end$$;
commit;
