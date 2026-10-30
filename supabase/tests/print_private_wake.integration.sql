\set ON_ERROR_STOP on
\ir print_dispatch_preparation.integration.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
create schema if not exists realtime;
create table realtime.test_wake(payload jsonb,event text,topic text,private boolean);
create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$
begin
 if current_setting('test.wake_fail',true)='yes' then raise exception 'fixture realtime outage'; end if;
 insert into realtime.test_wake values(payload,event,topic,private);
end $$;
\ir ../migrations/20261030051557_print_private_wake.sql
\ir ../migrations/20261030051557_print_private_wake.sql
select set_config('test.permission','manager',false);
do $$ declare b uuid:='20000000-0000-0000-0000-000000000001'; c jsonb; j uuid:=gen_random_uuid(); r jsonb; intent uuid:=gen_random_uuid(); before_tid tid; after_tid tid;
 payload text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
begin
 update fnb_print_jobs set status='cancelled';
 c:=public.fnb_print_manage_v1(b,'rotate','{}');
 if public.fnb_print_wake_authorize_v1((c->>'id')::uuid,c->>'token') then raise exception 'Wake enabled without rollout'; end if;
 update fnb_print_points set wake_enabled=true where id=(c->>'id')::uuid;
 if not public.fnb_print_wake_authorize_v1((c->>'id')::uuid,c->>'token') then raise exception 'Valid point denied'; end if;
 if public.fnb_print_wake_authorize_v1((c->>'id')::uuid,repeat('f',64)) then raise exception 'Bad token accepted'; end if;
 if public.fnb_print_wake_authorize_v1(gen_random_uuid(),c->>'token') then raise exception 'Cross point accepted'; end if;
 if has_function_privilege('anon','public.fnb_print_wake_authorize_v1(uuid,text)','execute') or has_function_privilege('authenticated','public.fnb_print_wake_authorize_v1(uuid,text)','execute') then raise exception 'Public relay auth access'; end if;
 if not has_function_privilege('service_role','public.fnb_print_wake_authorize_v1(uuid,text)','execute') then raise exception 'Server relay cannot authenticate'; end if;
 update fnb_print_points set enabled=false where id=(c->>'id')::uuid;
 if public.fnb_print_wake_authorize_v1((c->>'id')::uuid,c->>'token') then raise exception 'Disabled point accepted'; end if;
 update fnb_print_points set enabled=true,last_seen_at=now() where id=(c->>'id')::uuid;
 select ctid into before_tid from fnb_print_points where id=(c->>'id')::uuid;
 r:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',intent));
 select ctid into after_tid from fnb_print_points where id=(c->>'id')::uuid;
 if r is not null or before_tid<>after_tid then raise exception 'Recoverable idle claim wrote point'; end if;
 begin perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim','{"request_id":"not-uuid"}'); raise exception 'Invalid intent bypassed idle'; exception when invalid_text_representation then null; end;
 perform public.fnb_print_enqueue_v2(b,j,'kitchen','fixture','58mm',payload,1,2,3);
 perform public.fnb_print_enqueue_v2(b,j,'kitchen','fixture','58mm',payload,1,2,3);
 if (select count(*) from realtime.test_wake)<>1 then raise exception 'Repeated enqueue woke twice'; end if;
 if exists(select 1 from realtime.test_wake w where not w.private or w.payload<>'{}'::jsonb or w.topic<>'fnb-print:'||(c->>'id') or w.event<>'wake') then raise exception 'Wake leaked data or wrong scope'; end if;
 r:=public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',intent));
 if r->>'id'<>j::text or r->>'claim_id'<>intent::text then raise exception 'Recoverable claim failed'; end if;
 if public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','claim',jsonb_build_object('request_id',intent))<>r then raise exception 'Lost response cannot recover'; end if;
 perform public.fnb_print_agent_v1((c->>'id')::uuid,c->>'token','finish',jsonb_build_object('id',j,'claim_id',intent,'status','handed_off'));
 if (select count(*) from realtime.test_wake)<>1 then raise exception 'Finish woke receiver'; end if;
 perform set_config('test.wake_fail','yes',true);
 perform public.fnb_print_enqueue_v2(b,gen_random_uuid(),'kitchen','fixture outage','58mm',payload,1,2,3);
 if (select count(*) from fnb_print_jobs where status='queued')<>1 then raise exception 'Broadcast failure blocked enqueue'; end if;
end $$;
select 'PASS private print wake, scoped authentication, no data broadcast, idle recovery, fallback during realtime failure';
