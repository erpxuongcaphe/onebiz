-- Preserve the existing print permissions even when staff access is adjusted
-- by branch. Local-only grants can add access, but a new branch exception on
-- viewing, checkout or kitchen actions must not silently remove legacy print.
-- Branch membership, printer agent, queue and device credentials stay intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target oid; source text; patched text; n integer; code text; anchor text;
begin
 for item in select * from (values
  ('_fnb_print_access_v1'),('fnb_print_enqueue_v1')
 ) as entries(name) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_FNB_PRINT_VIEW_CONSUMER_AMBIGUOUS: %',item.name; end if;
  source:=pg_get_functiondef(target);
  patched:=source;
  foreach code in array array['pos_fnb.send_kitchen','pos_fnb.checkout'] loop
   anchor:=format('public._staff_permission_at_scope(auth.uid(),%L,p_branch)',code);
   if position(anchor in patched)>0 then
    patched:=replace(patched,anchor,
     format('(public.user_has_permission(auth.uid(),%1$L) or %2$s)',code,anchor));
   end if;
  end loop;
  anchor:='public.user_has_permission(auth.uid(),''pos_fnb.view_orders'')';
  if position(anchor in patched)=0 then raise exception 'STAFF_FNB_PRINT_VIEW_CONSUMER_CHANGED: %',item.name; end if;
  patched:=replace(patched,anchor,
   '(public.user_has_permission(auth.uid(),''pos_fnb.view_orders'') or public._staff_permission_at_scope(auth.uid(),''pos_fnb.view_orders'',p_branch))');
  execute patched;
 end loop;
end $migration$;
commit;
