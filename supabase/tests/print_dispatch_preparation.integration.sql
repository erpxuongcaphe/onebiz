\set ON_ERROR_STOP on
\ir fnb_print_idle.integration.sql
\ir ../migrations/20261030030229_print_dispatch_preparation.sql
\ir ../migrations/20261030030229_print_dispatch_preparation.sql
update profiles set is_active=true;
select set_config('test.permission','manager',false);
do $$
declare b uuid:='20000000-0000-0000-0000-000000000001';
  j uuid:='60000000-0000-0000-0000-000000000001';
  payload text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
  r jsonb; n integer;
begin
  r:=public.fnb_print_routes_v1(b);
  if r ? 'jobs' or r->'point' ? 'token_hash'
    or (select count(*) from jsonb_object_keys(r->'point'))<>3 then raise exception 'Routing response exposes history or other metadata'; end if;
  if not coalesce((r->'point'->>'enabled')::boolean,false) or jsonb_array_length(r->'point'->'routes')<1 then raise exception 'Routing missing'; end if;
  perform public.fnb_print_manage_v1(b,'save','{"name":"Quầy","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"Kitchen printer","paper":"58mm"}]}'::jsonb);
  begin perform public.fnb_print_routes_v1('20000000-0000-0000-0000-000000000002'); raise exception 'Branch guard missing'; exception when insufficient_privilege then null; end;
  select count(*) into n from fnb_print_jobs;
  perform public.fnb_print_enqueue_v2(b,j,'kitchen','Test','58mm',payload,150,240,2);
  perform public.fnb_print_enqueue_v2(b,j,'kitchen','Test','58mm',payload,900,900,5);
  if (select count(*) from fnb_print_jobs)<>n+1 then raise exception 'Duplicate enqueue'; end if;
  if (select preparation_ms from fnb_print_jobs where id=j) <> '{"prepare":150,"render":240,"encode":2}'::jsonb then raise exception 'First preparation lost'; end if;
  if exists(select 1 from fnb_print_jobs where id<>j and preparation_ms is not null) then raise exception 'Old jobs modified'; end if;
  begin perform public.fnb_print_enqueue_v2(b,gen_random_uuid(),'kitchen','Test','80mm',payload,0,0,0); raise exception 'Paper mismatch accepted'; exception when raise_exception then if sqlerrm='Paper mismatch accepted' then raise; end if; end;
  begin perform public.fnb_print_enqueue_v2(b,gen_random_uuid(),'kitchen','Test','58mm',payload,-1,0,0); raise exception 'Negative timing accepted'; exception when raise_exception then if sqlerrm<>'INVALID_PRINT_TIMING' then raise; end if; end;
  perform set_config('test.permission','cashier',false);
  begin perform public.fnb_print_enqueue_v2(b,gen_random_uuid(),'kitchen','Test','58mm',payload,0,0,0); raise exception 'Kitchen permission bypassed'; exception when insufficient_privilege then null; end;
  update profiles set is_active=false;
  begin perform public.fnb_print_routes_v1(b); raise exception 'Inactive user allowed'; exception when insufficient_privilege then null; end;
  update profiles set is_active=true;
  if has_function_privilege('anon','public.fnb_print_routes_v1(uuid)','execute')
    or has_function_privilege('anon','public.fnb_print_enqueue_v2(uuid,uuid,text,text,text,text,integer,integer,integer)','execute') then raise exception 'Anonymous access'; end if;
end $$;
select 'Print preparation integration passed';
