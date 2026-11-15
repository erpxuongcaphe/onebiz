-- Limit the existing finance export permission by the branch being exported.
-- A company-wide export remains available with its existing grant unless an
-- explicit branch denial requires selecting a permitted branch.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare item record; source text; patched text; gate text;
begin
  for item in select * from (values
    ('public.cash_journal_list_v1(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)','10feb8ed24ff8beac0f831f68071312f'),
    ('public.cash_journal_list_v2(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)','e842f98decd77a9f91636a6a995f3c31'),
    ('public.get_store_finance_reporting_source(text,date,date,uuid,text,boolean)','368af151df14a8f03b3a9a0343d6c8c3'),
    ('public.export_b2_plan_v1(uuid,date)','bd4959b99328de4091a204beff778fbd')
  ) as expected(signature, source_hash) loop
    if not exists (select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
      and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=item.source_hash) then
      raise exception 'STAFF_FINANCE_EXPORT_BASELINE_CHANGED: %', item.signature;
    end if;
    source := replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),'');
    if item.signature like 'public.export_b2_plan_v1%' then
      gate := 'perform public.management_finance_actor(''finance.export_cash_journal'');';
      patched := replace(source,gate,
        'if not public._staff_report_permission(auth.uid(),''finance.export_cash_journal'',p_branch) then raise exception ''MANAGEMENT_FINANCE_DENIED'' using errcode=''42501''; end if;');
    else
      gate := 'public.user_has_permission(v_actor, ''finance.export_cash_journal'')';
      patched := replace(source,gate,
        'public._staff_report_permission(v_actor, ''finance.export_cash_journal'', p_branch)');
    end if;
    if patched=source then raise exception 'STAFF_FINANCE_EXPORT_GATE_CHANGED: %', item.signature; end if;
    execute patched;
  end loop;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('finance.export_cash_journal',1);
commit;
