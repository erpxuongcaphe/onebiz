begin;
-- Operating and financial corrections share one revision chain. Original periods stay immutable.
alter table public.ops_period_adjustments add column run_changes jsonb not null default '[]'::jsonb;

alter function public.ops_propose_adjustment(uuid,integer,bigint,bigint,text,text,uuid) rename to ops_propose_financial_adjustment_core;
revoke all on function public.ops_propose_financial_adjustment_core(uuid,integer,bigint,bigint,text,text,uuid) from public,anon,authenticated;
create function public.ops_propose_adjustment(p_period uuid,p_base integer,p_revenue bigint,p_target bigint,p_reason text,p_evidence text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.ops_period_adjustments where created_by=auth.uid() and request_id=p_request and run_changes<>'[]'::jsonb) then raise exception 'OPS_REQUEST_CONFLICT'; end if;
 return public.ops_propose_financial_adjustment_core(p_period,p_base,p_revenue,p_target,p_reason,p_evidence,p_request);
end $$;
revoke all on function public.ops_propose_adjustment(uuid,integer,bigint,bigint,text,text,uuid) from public,anon;
grant execute on function public.ops_propose_adjustment(uuid,integer,bigint,bigint,text,text,uuid) to authenticated;

create function public.ops_propose_result_adjustment(p_period uuid,p_base integer,p_changes jsonb,p_reason text,p_evidence text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; closed public.ops_periods; source jsonb; previous public.ops_period_adjustments; proposal public.ops_period_adjustments;
 current_revision integer; change jsonb; original_run jsonb; criteria jsonb; seen uuid[]:='{}'; run_id uuid; evaluated jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into closed from public.ops_periods where id=p_period and tenant_id=p.tenant_id;
 if closed.id is null or (not public.ops_can(closed.branch_id,'work') and not public.ops_can(closed.branch_id,'close_period')) then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_period::text,4));
 select * into previous from public.ops_period_adjustments where created_by=p.id and request_id=p_request;
 if previous.id is not null then
  if previous.period_id<>p_period or previous.base_revision<>p_base or previous.run_changes is distinct from p_changes or previous.reason is distinct from p_reason or previous.evidence is distinct from p_evidence then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return to_jsonb(previous);
 end if;
 select count(*) into current_revision from public.ops_period_adjustments where period_id=p_period and state='approved';
 if p_base is distinct from current_revision or p_request is null then raise exception 'OPS_STALE'; end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 2000 or length(trim(coalesce(p_evidence,''))) not between 3 and 2000 then raise exception 'OPS_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 20 then raise exception 'OPS_INVALID_RESULT'; end if;
 select snapshot into source from public.ops_period_adjustments where period_id=p_period and state='approved' order by base_revision desc limit 1;
 source:=coalesce(source,closed.snapshot);
 for change in select value from jsonb_array_elements(p_changes) loop
  run_id:=(change->>'runId')::uuid;
  select value into original_run from jsonb_array_elements(source->'runs') where value->>'id'=run_id::text;
  if original_run is null or run_id=any(seen) then raise exception 'OPS_INVALID_RESULT'; end if;
  seen:=array_append(seen,run_id);
  -- Criteria changes require closing authority; managers can propose only their own recorded results.
  if not public.ops_can(closed.branch_id,'close_period') and (original_run->>'assignee_id'<>p.id::text or change ? 'criteria') then raise exception 'OPS_FORBIDDEN'; end if;
  criteria:=coalesce(change->'criteria',original_run->'criteria');
  perform public.ops_check_criteria(criteria);
  evaluated:=public.ops_evaluate(criteria,change->'observations');
  if evaluated->>'quality'='unknown' then raise exception 'OPS_INVALID_RESULT'; end if;
 end loop;
 insert into public.ops_period_adjustments(tenant_id,branch_id,period_id,base_revision,revenue_cents,target_cents,reason,evidence,created_by,request_id,run_changes)
 values(p.tenant_id,closed.branch_id,p_period,p_base,(source->'revenue'->>'amount_cents')::bigint,(source->'target'->>'amount_cents')::bigint,p_reason,p_evidence,p.id,p_request,p_changes) returning * into proposal;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason) values(p.tenant_id,closed.branch_id,proposal.id,'propose_result_adjustment',p.id,to_jsonb(proposal),p_reason);
 return to_jsonb(proposal);
end $$;

create or replace function public.ops_approve_adjustment(p_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; a public.ops_period_adjustments; original public.ops_periods; source jsonb; current_revision integer;
 change jsonb; current_run jsonb; criteria jsonb; evaluated jsonb; next_runs jsonb;
begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into a from public.ops_period_adjustments where id=p_id and tenant_id=p.tenant_id;
 if a.id is null or not public.ops_can(a.branch_id,'close_period') or (a.created_by=p.id and not public.ops_ceo()) then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.period_id::text,4));
 select * into a from public.ops_period_adjustments where id=p_id for update;
 if a.state='approved' then return to_jsonb(a); end if;
 if length(trim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'OPS_REASON_REQUIRED'; end if;
 select count(*) into current_revision from public.ops_period_adjustments where period_id=a.period_id and state='approved';
 if a.base_revision<>current_revision then raise exception 'OPS_STALE'; end if;
 select * into original from public.ops_periods where id=a.period_id;
 select snapshot into source from public.ops_period_adjustments where period_id=a.period_id and state='approved' order by base_revision desc limit 1;
 source:=coalesce(source,original.snapshot);
 for change in select value from jsonb_array_elements(a.run_changes) loop
  select value into current_run from jsonb_array_elements(source->'runs') where value->>'id'=change->>'runId';
  if current_run is null then raise exception 'OPS_INVALID_RESULT'; end if;
  criteria:=coalesce(change->'criteria',current_run->'criteria');
  perform public.ops_check_criteria(criteria);
  evaluated:=public.ops_evaluate(criteria,change->'observations');
  if evaluated->>'quality'='unknown' then raise exception 'OPS_INVALID_RESULT'; end if;
  current_run:=current_run||jsonb_build_object('criteria',criteria,'observations',evaluated->'observations','quality',evaluated->>'quality',
   'verified_at',now(),'verified_by',p.id,'correction_reason',a.reason);
  -- A correction never invents an on-time completion or erases a recorded breach.
  current_run:=current_run||jsonb_build_object('critical_failure',coalesce((current_run->>'critical_failure')::boolean,false) or (evaluated->>'critical')::boolean,
   'had_failure',coalesce((current_run->>'had_failure')::boolean,false) or evaluated->>'quality'='unmet');
  select jsonb_agg(case when value->>'id'=change->>'runId' then current_run else value end order by ord) into next_runs from jsonb_array_elements(source->'runs') with ordinality as r(value,ord);
  source:=jsonb_set(source,'{runs}',next_runs);
 end loop;
 source:=jsonb_set(source,'{revenue,amount_cents}',to_jsonb(a.revenue_cents));
 source:=jsonb_set(source,'{target,amount_cents}',to_jsonb(a.target_cents));
 source:=jsonb_set(source,'{rewards}',public.ops_reward_values(source->'runs',source->'policy'->'config',a.revenue_cents,a.target_cents));
 source:=jsonb_set(source,'{calculatedAt}',to_jsonb(now()));
 update public.ops_period_adjustments set state='approved',approved_by=p.id,approved_at=now(),approval_note=p_note,snapshot=source where id=a.id returning * into a;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason) values(p.tenant_id,a.branch_id,a.id,'approve_adjustment',p.id,to_jsonb(a),p_note);
 return to_jsonb(a);
end $$;
revoke all on function public.ops_propose_result_adjustment(uuid,integer,jsonb,text,text,uuid) from public,anon;
grant execute on function public.ops_propose_result_adjustment(uuid,integer,jsonb,text,text,uuid) to authenticated;
commit;
