\set ON_ERROR_STOP on
\ir fnb_print_recovery.integration.sql
\ir ../migrations/202610240400_fnb_print_job_feedback.sql
\ir ../migrations/202610240400_fnb_print_job_feedback.sql
do $$
declare b uuid:='20000000-0000-0000-0000-000000000001'; c jsonb; j jsonb; ids uuid[]:='{}'; new_id uuid; count_before integer; status_before jsonb; result jsonb;
begin
  update fnb_print_jobs set status='cancelled'; -- disposable fixture only
  perform public.fnb_print_manage_v1(b,'save','{"name":"Quầy","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"USB XP80","paper":"80mm"}]}'::jsonb);
  c:=public.fnb_print_manage_v1(b,'rotate','{}');
  -- 50 independent requests arrive before the point receives any of them.
  for i in 1..50 loop
    new_id:=gen_random_uuid();ids:=array_append(ids,new_id);
    perform public.fnb_print_enqueue_v1(b,new_id,'kitchen','Burst '||i,'80mm',encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64'));
  end loop;
  result:=public.fnb_print_jobs_status_v1(b,ids);
  if jsonb_array_length(result->'jobs')<>50 then raise exception 'Lost accepted burst IDs'; end if;
  if result::text like '%bytes_base64%' or result::text like '%token_hash%' or result::text like '%"printer"%' then raise exception 'Private print data exposed'; end if;
  select count(*),jsonb_agg(jsonb_build_object('id',id,'status',status) order by id) into count_before,status_before from fnb_print_jobs;
  perform public.fnb_print_jobs_status_v1(b,ids);
  if (select jsonb_agg(jsonb_build_object('id',id,'status',status) order by id) from fnb_print_jobs) is distinct from status_before then raise exception 'Status read mutated jobs'; end if;
  for i in 1..50 loop
    j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
    if j is null or not ((j->>'id')::uuid=any(ids)) then raise exception 'Dropped/duplicated burst ticket'; end if;
    ids:=array_remove(ids,(j->>'id')::uuid);
    if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Second concurrent claim allowed'; end if;
    perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',jsonb_build_object('id',j->>'id','claim_id',j->>'claim_id','status','handed_off'));
  end loop;
  if cardinality(ids)<>0 or (select count(*) from fnb_print_jobs)<>count_before then raise exception 'Burst processing lost/recreated tickets'; end if;
  if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Burst replayed after reconnect'; end if;
  -- Exact IDs remain readable even after many newer jobs fill recent history.
  select array_agg(id) into ids from fnb_print_jobs where label like 'Burst %';
  for i in 1..55 loop
    new_id:=gen_random_uuid();
    perform public.fnb_print_enqueue_v1(b,new_id,'kitchen','Newer history '||i,'80mm',encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64'));
    perform public.fnb_print_manage_v1(b,'cancel',jsonb_build_object('id',new_id));
  end loop;
  if jsonb_array_length(public.fnb_print_jobs_status_v1(b,ids)->'jobs')<>50 then raise exception 'Status depends on recent page'; end if;
  begin perform public.fnb_print_jobs_status_v1('20000000-0000-0000-0000-000000000002',ids);raise exception 'Branch leak';exception when insufficient_privilege then null;end;
  begin perform public.fnb_print_jobs_status_v1(b,array_fill(gen_random_uuid(),array[101]));raise exception 'Unbounded list accepted';exception when raise_exception then if sqlerrm='Unbounded list accepted' then raise;end if;end;
  update profiles set is_active=false;
  begin perform public.fnb_print_jobs_status_v1(b,ids);raise exception 'Inactive account allowed';exception when insufficient_privilege then null;end;
  update profiles set is_active=true;
end $$;
set role anon;
do $$ begin begin perform public.fnb_print_jobs_status_v1('20000000-0000-0000-0000-000000000001',array[gen_random_uuid()]);raise exception 'Anonymous status read allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS 50-ticket burst, no duplicate claim/replay, exact ID status, bounded read, branch/inactive/anon guards, no private payload';
