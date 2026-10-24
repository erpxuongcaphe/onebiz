\set ON_ERROR_STOP on
\ir branch_print_queue.integration.sql
\ir ../migrations/202610240300_fnb_print_recovery.sql
\ir ../migrations/202610240300_fnb_print_recovery.sql
update profiles set is_active=true;
select set_config('test.permission','manager',false);
do $$
declare b uuid:='20000000-0000-0000-0000-000000000001'; c jsonb; j jsonb; held uuid:='50000000-0000-0000-0000-000000000001'; fresh uuid:='50000000-0000-0000-0000-000000000002'; amb uuid:='50000000-0000-0000-0000-000000000003'; new_id uuid; before_count integer;
 payload text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
begin
  update fnb_print_jobs set status='cancelled'; -- disposable fixture, not application migration
  c:=public.fnb_print_manage_v1(b,'rotate','{}');
  perform public.fnb_print_enqueue_v1(b,held,'kitchen','Old kitchen','58mm',payload);
  update fnb_print_jobs set created_at=now()-interval '6 minutes' where id=held;
  perform public.fnb_print_enqueue_v1(b,fresh,'kitchen','Fresh kitchen','58mm',payload);
  j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
  if j->>'id'<>fresh::text then raise exception 'Old job was automatically printed or fresh queue blocked'; end if;
  if not exists(select 1 from fnb_print_jobs where id=held and status='failed' and claimed_at is null and bytes_base64=payload and message like '[PRINT_QUEUE_STALE]%') then raise exception 'Stale job not retained for review'; end if;
  perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',jsonb_build_object('id',fresh,'claim_id',j->>'claim_id','status','handed_off'));
  if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Held/delivered job replayed after restart'; end if;
  -- Live route changes never rewrite the old job. Explicit stale retry uses current route.
  perform public.fnb_print_manage_v1(b,'save','{"name":"Quầy","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"USB XP80","paper":"58mm"}]}'::jsonb);
  if (select printer from fnb_print_jobs where id=held)<>'Kitchen printer' then raise exception 'Historical destination rewritten'; end if;
  perform set_config('test.permission','cashier',false);
  begin perform public.fnb_print_manage_v1(b,'retry',jsonb_build_object('id',held));raise exception 'Nonmanager released held job';exception when insufficient_privilege then null;end;
  perform set_config('test.permission','manager',false);
  perform public.fnb_print_manage_v1(b,'retry',jsonb_build_object('id',held));
  select id into new_id from fnb_print_jobs where status='queued';
  if not exists(select 1 from fnb_print_jobs where id=new_id and printer='USB XP80' and label like 'IN LẠI%' and bytes_base64=payload) then raise exception 'Confirmed stale ticket lost current route/payload/label'; end if;
  if not exists(select 1 from fnb_print_jobs where id=held and status='cancelled' and last_action_by=auth.uid()) then raise exception 'Release not audited'; end if;
  select count(*) into before_count from fnb_print_jobs;
  begin perform public.fnb_print_manage_v1(b,'retry',jsonb_build_object('id',held));raise exception 'Duplicate release accepted';exception when raise_exception then if sqlerrm='Duplicate release accepted' then raise;end if;end;
  if (select count(*) from fnb_print_jobs)<>before_count then raise exception 'Duplicate release created job'; end if;
  j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
  if j->>'id'<>new_id::text then raise exception 'Confirmed job not claimable'; end if;
  if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Concurrent claim duplicated'; end if;
  update fnb_print_jobs set claimed_at=now()-interval '3 minutes' where id=new_id;
  if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Ambiguous send replayed'; end if;
  if (select status from fnb_print_jobs where id=new_id)<>'unknown' then raise exception 'Expired send not unknown'; end if;
  -- A stale confirmation must stop if the paper has changed.
  perform public.fnb_print_enqueue_v1(b,amb,'kitchen','Old mismatched paper','58mm',payload);
  update fnb_print_jobs set created_at=now()-interval '6 minutes' where id=amb;
  perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
  perform public.fnb_print_manage_v1(b,'save','{"name":"Quầy","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"USB XP80","paper":"80mm"}]}'::jsonb);
  begin perform public.fnb_print_manage_v1(b,'retry',jsonb_build_object('id',amb));raise exception 'Paper mismatch allowed';exception when raise_exception then if sqlerrm='Paper mismatch allowed' then raise;end if;end;
  if (select status from fnb_print_jobs where id=amb)<>'failed' then raise exception 'Rejected confirmation lost stale job'; end if;
  -- More than 50 newer tickets cannot bury the unresolved stale ticket.
  for i in 1..55 loop
    perform public.fnb_print_enqueue_v1(b,gen_random_uuid(),'kitchen','Recent','80mm',payload);
  end loop;
  if public.fnb_print_state_v1(b)->'jobs'->0->>'id'<>amb::text then raise exception 'Held ticket buried below latest 50'; end if;
  perform public.fnb_print_manage_v1(b,'cancel',jsonb_build_object('id',amb));
  if (select status from fnb_print_jobs where id=amb)<>'cancelled' then raise exception 'Manager cannot stop held job'; end if;
end $$;
select 'PASS print recovery: old queue held, fresh queue continues, restart/concurrent claim no replay, audited permission-bound confirmation, USB route/paper guards, visible backlog';
