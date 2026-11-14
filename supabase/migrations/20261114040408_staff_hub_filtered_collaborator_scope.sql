-- Filtered work lists must honor explicit branch revocations for collaborators.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;sig text:='public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamp with time zone,uuid)';begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='ba08e8ffd7a8206073f0c1b705bbde81') then raise exception 'HUB_FILTERED_LIST_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 patched:=replace(body, '(public.ops_can(t.branch_id,''view'') or p.id=any(t.collaborators))', 'public.ops_todo_visible(t.id)');
 if patched=body then raise exception 'HUB_FILTERED_LIST_PATCH_MISSING';end if;
 execute patched;
end$$;
commit;
