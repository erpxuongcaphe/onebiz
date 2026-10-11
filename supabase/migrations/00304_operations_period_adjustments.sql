begin;
create table public.ops_period_adjustments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),branch_id uuid not null references public.branches(id),
 period_id uuid not null references public.ops_periods(id),base_revision integer not null,
 revenue_cents bigint not null check(revenue_cents between 0 and 9007199254740991),target_cents bigint not null check(target_cents between 1 and 9007199254740991),
 reason text not null,evidence text not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','approved')),approved_by uuid references public.profiles(id),approved_at timestamptz,
 approval_note text,snapshot jsonb,request_id uuid not null,unique(created_by,request_id)
);
create unique index ops_period_adjustments_revision on public.ops_period_adjustments(period_id,base_revision) where state='approved';
alter table public.ops_period_adjustments enable row level security;
revoke all on public.ops_period_adjustments from public,anon,authenticated;
grant select on public.ops_period_adjustments to authenticated;
create policy ops_period_adjustments_read on public.ops_period_adjustments for select to authenticated using(tenant_id=public.get_user_tenant_id() and public.ops_can(branch_id,'view'));

create function public.ops_propose_adjustment(p_period uuid,p_base integer,p_revenue bigint,p_target bigint,p_reason text,p_evidence text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; closed public.ops_periods; previous public.ops_period_adjustments; current_revision integer; proposal public.ops_period_adjustments; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into closed from public.ops_periods where id=p_period and tenant_id=p.tenant_id;
 if closed.id is null or (not public.ops_can(closed.branch_id,'work') and not public.ops_can(closed.branch_id,'close_period')) then raise exception 'OPS_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_period::text,4));
 select * into previous from public.ops_period_adjustments where created_by=p.id and request_id=p_request;
 if previous.id is not null then
  if previous.period_id<>p_period or previous.base_revision<>p_base or previous.revenue_cents<>p_revenue or previous.target_cents<>p_target or previous.reason<>p_reason or previous.evidence<>p_evidence then raise exception 'OPS_REQUEST_CONFLICT'; end if;
  return to_jsonb(previous);
 end if;
 select count(*) into current_revision from public.ops_period_adjustments where period_id=p_period and state='approved';
 if p_base is distinct from current_revision or p_request is null then raise exception 'OPS_STALE'; end if;
 if p_revenue is null or p_target is null or p_revenue not between 0 and 9007199254740991 or p_target not between 1 and 9007199254740991 then raise exception 'OPS_INVALID_AMOUNT'; end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 2000 or length(trim(coalesce(p_evidence,''))) not between 3 and 2000 then raise exception 'OPS_REASON_REQUIRED'; end if;
 insert into public.ops_period_adjustments(tenant_id,branch_id,period_id,base_revision,revenue_cents,target_cents,reason,evidence,created_by,request_id)
 values(p.tenant_id,closed.branch_id,p_period,p_base,p_revenue,p_target,p_reason,p_evidence,p.id,p_request) returning * into proposal;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason) values(p.tenant_id,closed.branch_id,proposal.id,'propose_adjustment',p.id,to_jsonb(proposal),p_reason);
 return to_jsonb(proposal);
end $$;

create function public.ops_approve_adjustment(p_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; a public.ops_period_adjustments; original public.ops_periods; source jsonb; current_revision integer; begin
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
 source:=jsonb_set(source,'{revenue,amount_cents}',to_jsonb(a.revenue_cents));
 source:=jsonb_set(source,'{target,amount_cents}',to_jsonb(a.target_cents));
 source:=jsonb_set(source,'{rewards}',public.ops_reward_values(source->'runs',source->'policy'->'config',a.revenue_cents,a.target_cents));
 source:=jsonb_set(source,'{calculatedAt}',to_jsonb(now()));
 update public.ops_period_adjustments set state='approved',approved_by=p.id,approved_at=now(),approval_note=p_note,snapshot=source where id=a.id returning * into a;
 insert into public.ops_audit(tenant_id,branch_id,entity_id,action,actor_id,after_data,reason) values(p.tenant_id,a.branch_id,a.id,'approve_adjustment',p.id,to_jsonb(a),p_note);
 return to_jsonb(a);
end $$;
revoke all on function public.ops_propose_adjustment(uuid,integer,bigint,bigint,text,text,uuid),public.ops_approve_adjustment(uuid,text) from public,anon;
grant execute on function public.ops_propose_adjustment(uuid,integer,bigint,bigint,text,text,uuid),public.ops_approve_adjustment(uuid,text) to authenticated;

create function public.ops_adjustments(p_period uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare closed public.ops_periods; p public.profiles; begin
 select * into p from public.profiles where id=auth.uid() and is_active;
 select * into closed from public.ops_periods where id=p_period and tenant_id=p.tenant_id;
 if closed.id is null or not public.ops_can(closed.branch_id,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.ops_period_adjustments a where a.period_id=p_period),'[]');
end $$;
revoke all on function public.ops_adjustments(uuid) from public,anon;
grant execute on function public.ops_adjustments(uuid) to authenticated;
commit;
