\set ON_ERROR_STOP on
\ir fnb_print_job_feedback.integration.sql
\ir ../migrations/202610250400_fnb_print_recoverable_claim.sql
\ir ../migrations/202610250400_fnb_print_recoverable_claim.sql
update profiles set is_active=true;
select set_config('test.permission','manager',false);
do $$
declare b uuid:='20000000-0000-0000-0000-000000000001'; c jsonb; j jsonb; again jsonb;
 req uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); z uuid:=gen_random_uuid();
 p text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
 stamp timestamptz; answer jsonb;
begin
 update fnb_print_jobs set status='cancelled';
 perform public.fnb_print_manage_v1(b,'save','{"name":"Test","enabled":true,"routes":[{"key":"kitchen","label":"Báº¿p","printer":"Fixture only","paper":"58mm"}]}'::jsonb);
 c:=public.fnb_print_manage_v1(b,'rotate','{}');
 answer:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','heartbeat','{"printers":[]}');
 if answer->>'recoverable_claim_v1'<>'true' then raise exception 'Capability missing'; end if;
 perform public.fnb_print_enqueue_v1(b,a,'kitchen','Lost claim response','58mm',p);
 perform public.fnb_print_enqueue_v1(b,z,'kitchen','Next bill','58mm',p);
 j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req));
 update fnb_print_jobs set claimed_at=now()-interval '30 seconds' where id=(j->>'id')::uuid;
 select claimed_at into stamp from fnb_print_jobs where id=(j->>'id')::uuid;
 -- Discard first response: retry returns exactly the same assignment and bytes.
 again:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req));
 if j is distinct from again or j->>'claim_id'<>req::text then raise exception 'Lost claim cannot recover same identity'; end if;
 if (select claimed_at from fnb_print_jobs where id=(j->>'id')::uuid) is distinct from stamp then raise exception 'Recovery extended lease'; end if;
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req2)) is not null then raise exception 'Another receiver bypassed physical writer guard'; end if;
 -- Discard finish response: repeat is idempotent and does not change history.
 answer:=jsonb_build_object('id',j->>'id','claim_id',j->>'claim_id','status','handed_off','message','fixture');
 perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',answer);
 update fnb_print_jobs set finished_at=now()-interval '10 seconds' where id=(j->>'id')::uuid;
 select finished_at into stamp from fnb_print_jobs where id=(j->>'id')::uuid;
 again:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',answer);
 if again->>'already_finished'<>'true' or (select finished_at from fnb_print_jobs where id=(j->>'id')::uuid) is distinct from stamp then raise exception 'Lost finish ack not idempotent'; end if;
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req)) is not null then raise exception 'Completed intent assigned another bill'; end if;
 begin
  perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',answer||'{"status":"failed"}'::jsonb);
  raise exception 'Conflicting finish accepted';
 exception when raise_exception then if sqlerrm<>'PRINT_CLAIM_EXPIRED' then raise;end if;end;
 begin
  perform public.fnb_print_agent_v1((c->>'id')::uuid,repeat('0',64),'claim',jsonb_build_object('request_id',req));
  raise exception 'Recovery leaked across token boundary';
 exception when insufficient_privilege then null;end;
 j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req2));
 if j is null or j->>'claim_id'<>req2::text then raise exception 'Following bill blocked after recovery'; end if;
 update fnb_print_jobs set claimed_at=now()-interval '3 minutes' where id=(j->>'id')::uuid;
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req2)) is not null then raise exception 'Expired ambiguous send replayed'; end if;
 if (select status from fnb_print_jobs where id=(j->>'id')::uuid)<>'unknown' then raise exception 'Expired send hidden'; end if;
 -- 50 continuous tickets, each with lost claim and finish responses.
 for i in 1..50 loop
  req:=gen_random_uuid();a:=gen_random_uuid();
  perform public.fnb_print_enqueue_v1(b,a,'kitchen','Burst fixture','58mm',p);
  j:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req));
  again:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',req));
  if j is distinct from again or j->>'id'<>a::text then raise exception 'Burst claim replay mismatch';end if;
  answer:=jsonb_build_object('id',a,'claim_id',req,'status','handed_off');
  perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',answer);
  perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',answer);
 end loop;
end $$;
select 'PASS: legacy baseline, recovery migration twice, lost-claim same identity, no parallel writer, idempotent finish, immutable history, token guard, expired job not replayed, 50-bill burst with lost responses';
