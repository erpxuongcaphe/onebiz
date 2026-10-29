\set ON_ERROR_STOP on
\ir fnb_print_recoverable_claim.integration.sql
\ir ../migrations/20261029092916_print_empty_queue_fast_path.sql
\ir ../migrations/20261029092916_print_empty_queue_fast_path.sql
update profiles set is_active=true;
select set_config('test.permission','manager',false);
do $$
declare c jsonb; j jsonb; before_tid tid; after_tid tid; stamp timestamptz;
 b uuid:='20000000-0000-0000-0000-000000000001';
 payload text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
begin
 update fnb_print_jobs set status='cancelled';
 c:=public.fnb_print_manage_v1(b,'rotate','{}');
 update fnb_print_points set last_seen_at=now() where id=(c->>'id')::uuid;
 select ctid into before_tid from fnb_print_points where id=(c->>'id')::uuid;
 for i in 1..100 loop
   if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Idle returned a ticket'; end if;
 end loop;
 select ctid into after_tid from fnb_print_points where id=(c->>'id')::uuid;
 if before_tid is distinct from after_tid then raise exception 'Idle polling wrote the point row'; end if;
 begin
   perform public.fnb_print_agent_v1((c->>'id')::uuid,repeat('0',64),'claim');
   raise exception 'Invalid idle token accepted';
 exception when insufficient_privilege then null; end;
 update fnb_print_points set last_seen_at=now()-interval '1 minute' where id=(c->>'id')::uuid;
 perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
 select last_seen_at into stamp from fnb_print_points where id=(c->>'id')::uuid;
 if stamp<>now() then raise exception 'Idle heartbeat did not refresh'; end if;
 perform public.fnb_print_enqueue_v1(b,gen_random_uuid(),'kitchen','After idle','58mm',payload);
 j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim');
 if j is null then raise exception 'New ticket lost after idle'; end if;
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Parallel sender guard bypassed'; end if;
 perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',jsonb_build_object('id',j->>'id','claim_id',j->>'claim_id','status','handed_off'));
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim') is not null then raise exception 'Finished ticket replayed'; end if;
end $$;
select 'PASS: 100 idle claims do not rewrite point; bad token denied; heartbeat refreshed; ticket after idle claimed once';
