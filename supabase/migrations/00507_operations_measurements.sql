begin;
create table public.ops_measurements (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),branch_id uuid not null references public.branches(id),
 run_id uuid not null references public.ops_runs(id),run_version integer not null,criterion_id text not null,slot text not null,
 signature jsonb not null,observed_at timestamptz not null,observation jsonb not null,actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(run_id,run_version,criterion_id,slot)
);
create index ops_measurements_lookup on public.ops_measurements(branch_id,observed_at desc,id desc);
alter table public.ops_measurements enable row level security;
revoke all on public.ops_measurements from public,anon,authenticated;

create function public.ops_measurement_signature(p_criterion jsonb,p_slot text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('title',p_criterion->>'title','kind',p_criterion->>'kind','scope',trim(coalesce(p_criterion->>'measurementScope','')),
 'ratioBasis',coalesce(p_criterion->>'ratioBasis',''),'slot',p_slot,'time',p_criterion->'measurementTimes'->>((p_slot::integer)-1))
$$;

alter function public.ops_execute(text,jsonb,uuid) rename to ops_execute_core;
revoke all on function public.ops_execute_core(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.ops_runs; o jsonb; c jsonb; measured public.ops_measurements; stamp timestamptz; result jsonb;
begin
 if p_action='result' or (p_action='verify' and coalesce((p_payload->>'correction')::boolean,false)) then
  select * into p from public.profiles where id=auth.uid() and is_active;
  select * into r from public.ops_runs where id=(p_payload->>'id')::uuid and tenant_id=p.tenant_id and branch_id=(p_payload->>'branchId')::uuid;
  if r.id is null or (not public.ops_can(r.branch_id,'work') and not public.ops_can(r.branch_id,'verify')) then raise exception 'OPS_FORBIDDEN'; end if;
  for o in select value from jsonb_array_elements(p_payload->'observations') loop
   select value into c from jsonb_array_elements(r.criteria) where value->>'id'=o->>'criterionId';
   if c is null then raise exception 'OPS_INVALID_RESULT'; end if;
   if o ? 'measuredAt' then
    stamp:=(o->>'measuredAt')::timestamptz;
    if stamp is null or stamp>now() or (stamp at time zone 'Asia/Ho_Chi_Minh')::date<(r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OPS_INVALID_MEASUREMENT'; end if;
   end if;
   if o ? 'measurementId' then
    select * into measured from public.ops_measurements where id=(o->>'measurementId')::uuid and tenant_id=p.tenant_id and branch_id=r.branch_id;
    if measured.id is null or trim(coalesce(c->>'measurementScope',''))='' or measured.signature is distinct from public.ops_measurement_signature(c,o->>'slot')
     or exists(select 1 from public.ops_measurements newer where newer.run_id=measured.run_id and newer.criterion_id=measured.criterion_id and newer.slot=measured.slot and newer.run_version>measured.run_version)
     or (measured.observed_at at time zone 'Asia/Ho_Chi_Minh')::date<>(r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date
     or measured.observed_at is distinct from (o->>'measuredAt')::timestamptz
     or (measured.observation->>'evidence') is distinct from (o->>'evidence')
     or (c->>'kind'<>'percent' and (measured.observation->>'value')::numeric is distinct from (o->>'value')::numeric)
     or (c->>'kind'='percent' and ((measured.observation->>'numerator')::numeric is distinct from (o->>'numerator')::numeric or (measured.observation->>'denominator')::numeric is distinct from (o->>'denominator')::numeric))
     then raise exception 'OPS_INVALID_MEASUREMENT'; end if;
   end if;
  end loop;
 end if;
 result:=public.ops_execute_core(p_action,p_payload,p_request_id);
 if p_action='result' or (p_action='verify' and coalesce((p_payload->>'correction')::boolean,false)) then
  -- Closed-period remediation is separate; do not attribute it to the unchanged original run.
  if not exists(select 1 from public.ops_periods where branch_id=r.branch_id and period=to_char(r.original_due_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM')) then
   for o in select value from jsonb_array_elements(result->'observations') loop
    if o ? 'measurementId' then continue; end if;
    select value into c from jsonb_array_elements(r.criteria) where value->>'id'=o->>'criterionId';
    insert into public.ops_measurements(tenant_id,branch_id,run_id,run_version,criterion_id,slot,signature,observed_at,observation,actor_id)
     values(p.tenant_id,r.branch_id,r.id,(result->>'version')::integer,o->>'criterionId',o->>'slot',public.ops_measurement_signature(c,o->>'slot'),coalesce((o->>'measuredAt')::timestamptz,now()),o,p.id)
     on conflict(run_id,run_version,criterion_id,slot) do nothing;
   end loop;
  end if;
 end if;
 return result;
end $$;

create function public.ops_measurements_for(p_run uuid,p_criterion text,p_slot text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.ops_runs; p public.profiles; c jsonb; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into r from public.ops_runs where id=p_run and tenant_id=p.tenant_id;
 if r.id is null or (r.assignee_id<>p.id and not public.ops_can(r.branch_id,'verify')) then raise exception 'OPS_FORBIDDEN'; end if;
 select value into c from jsonb_array_elements(r.criteria) where value->>'id'=p_criterion;
 if c is null or p_slot !~ '^[1-9][0-9]*$' or p_slot::integer>(c->>'samples')::integer then raise exception 'OPS_INVALID_RESULT'; end if;
 if trim(coalesce(c->>'measurementScope',''))='' then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select m.id,m.observed_at,m.observation,pf.full_name as actor_name from public.ops_measurements m
  join public.profiles pf on pf.id=m.actor_id and pf.tenant_id=p.tenant_id
  where m.tenant_id=p.tenant_id and m.branch_id=r.branch_id and m.run_id<>r.id
  and m.signature=public.ops_measurement_signature(c,p_slot)
  and not exists(select 1 from public.ops_measurements newer where newer.run_id=m.run_id and newer.criterion_id=m.criterion_id and newer.slot=m.slot and newer.run_version>m.run_version)
  and m.observed_at>=((r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date::timestamp at time zone 'Asia/Ho_Chi_Minh')
  and m.observed_at<(((r.original_due_at at time zone 'Asia/Ho_Chi_Minh')::date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  order by m.observed_at desc,m.id desc limit 20) x),'[]');
end $$;
revoke all on function public.ops_measurement_signature(jsonb,text),public.ops_execute(text,jsonb,uuid),public.ops_measurements_for(uuid,text,text) from public,anon;
grant execute on function public.ops_execute(text,jsonb,uuid),public.ops_measurements_for(uuid,text,text) to authenticated;
commit;
