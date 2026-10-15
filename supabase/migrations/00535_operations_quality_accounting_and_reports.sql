begin;
set local lock_timeout='3s';
alter table public.ops_q_catalog add column accounting_required boolean not null default false;

create function public.ops_q_business(p_branch uuid,p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb; q jsonb; revenue public.ops_revenues; target public.ops_targets; ratio numeric; amount numeric; closed jsonb;
begin
 if not public.ops_q_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 select snapshot into closed from public.ops_q_settlements where branch_id=p_branch and period=p_period order by revision desc limit 1;
 if closed is not null then
  revenue:=jsonb_populate_record(null::public.ops_revenues,closed->'business'->'revenue');
  target:=jsonb_populate_record(null::public.ops_targets,closed->'business'->'target');
  return jsonb_build_object('ready',true,'ratioBps',revenue.amount_cents::numeric/target.amount_cents*10000,'rewardCents',closed->'business'->'rewardCents','source',revenue.source,'sourceName',revenue.source_name,'revenueCents',revenue.amount_cents,'targetCents',target.amount_cents);
 end if;
 q:=public.ops_q_score(p_branch,p_period); c:=q->'config';
 if c is null or c='null'::jsonb then select config into c from public.ops_q_rules where branch_id=p_branch and state='approved' and effective_from<=least(((p_period||'-01')::date+interval '1 month'-interval '1 day')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::date) order by effective_from desc limit 1; end if;
 select * into revenue from public.ops_revenues where branch_id=p_branch and period=p_period and state='approved';
 select * into target from public.ops_targets where branch_id=p_branch and period=p_period;
 if jsonb_typeof(c->'businessFundCents') is distinct from 'number' or jsonb_typeof(c->'businessThresholdBps') is distinct from 'number' or jsonb_typeof(c->'businessCapBps') is distinct from 'number' or jsonb_typeof(c->'blockBusinessOnCritical') is distinct from 'boolean'
  or revenue.id is null or target.amount_cents is null or revenue.definition<>target.definition then
  return jsonb_build_object('ready',false,'reason','Chưa đủ nguồn doanh thu đã duyệt, chỉ tiêu hoặc chính sách kinh doanh.');
 end if;
 if (c->>'blockBusinessOnCritical')::boolean and not coalesce((q->>'official')::boolean,false) then return jsonb_build_object('ready',false,'reason','Chờ kết quả QC để xét điều kiện loại thưởng kinh doanh.'); end if;
 ratio:=revenue.amount_cents::numeric/target.amount_cents*10000;
 amount:=case when ratio<(c->>'businessThresholdBps')::numeric or (c->>'blockBusinessOnCritical')::boolean and (q->>'critical')::boolean then 0 else round(least(greatest(0,ratio),(c->>'businessCapBps')::numeric)*(c->>'businessFundCents')::numeric/10000) end;
 return jsonb_build_object('ready',true,'ratioBps',ratio,'rewardCents',amount,'source',revenue.source,'sourceName',revenue.source_name,'revenueCents',revenue.amount_cents,'targetCents',target.amount_cents,'definition',revenue.definition);
end $$;

alter function public.ops_quality_execute(text,jsonb,uuid) rename to ops_quality_execute_core;
revoke all on function public.ops_quality_execute_core(text,jsonb,uuid) from public,anon,authenticated;
create function public.ops_quality_execute(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; row jsonb; l public.ops_q_lines; a public.ops_q_audits; metric public.ops_q_accounting; payload jsonb:=p_payload; catalog_id uuid;
begin
 -- Require the accounting source selected by the authorized QC actor, not a browser percentage.
 if p_action in ('qc_line','qc_correct') then
  select * into l from public.ops_q_lines where id=(payload->>'id')::uuid and tenant_id=public.get_user_tenant_id() and branch_id=(payload->>'branchId')::uuid;
  if coalesce((l.item_snapshot->>'accounting_required')::boolean,false) and payload->>'result' is distinct from 'excluded' then
   select * into a from public.ops_q_audits where id=l.audit_id;
   select * into metric from public.ops_q_accounting where id=(payload->>'accountingId')::uuid and branch_id=l.branch_id and tenant_id=l.tenant_id and period=a.period and state='approved';
   if metric.id is null then raise exception 'OPS_Q_ACCOUNTING_REQUIRED'; end if;
   payload:=jsonb_set(payload,'{observations}',(select jsonb_agg(case when c->>'kind'='percent' then o||jsonb_build_object('numerator',metric.numerator,'denominator',metric.denominator,'value',metric.numerator/metric.denominator*100,'evidence',metric.evidence) else o end)
    from jsonb_array_elements(payload->'observations') o join jsonb_array_elements(l.item_snapshot->'criteria') c on c->>'id'=o->>'criterionId'));
   payload:=jsonb_set(payload,'{evidence}',to_jsonb(metric.title||' · '||metric.unit||' · '||metric.evidence));
  end if;
 end if;
 result:=public.ops_quality_execute_core(p_action,payload,p_request_id);
 if p_action in ('catalog','catalog_import') then
  for row in select value from jsonb_array_elements(case when p_action='catalog' then jsonb_build_array(payload) else payload->'rows' end) loop
   catalog_id:=(select c.id from public.ops_q_catalog c where c.branch_id=(payload->>'branchId')::uuid and c.code=row->>'code' and c.effective_from=(row->>'effectiveFrom')::date and c.tenant_id=public.get_user_tenant_id());
   if coalesce((row->>'accountingRequired')::boolean,false) and not exists(select 1 from public.ops_q_catalog c,jsonb_array_elements(c.criteria) cr where c.id=catalog_id and cr->>'kind'='percent' and (cr->>'samples')::integer=1) then raise exception 'OPS_INVALID_CRITERIA'; end if;
   update public.ops_q_catalog set accounting_required=coalesce((row->>'accountingRequired')::boolean,false) where id=catalog_id;
  end loop;
 end if;
 return result;
end $$;

alter function public.ops_quality_read(uuid,text,text,jsonb) rename to ops_quality_read_core;
revoke all on function public.ops_quality_read_core(uuid,text,text,jsonb) from public,anon,authenticated;
create function public.ops_quality_read(p_branch uuid,p_period text,p_kind text default 'work',p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.ops_quality_read_core(p_branch,p_period,p_kind,p_filters);
 result:=result||jsonb_build_object('relatedBranches',coalesce((select jsonb_agg(to_jsonb(related)) from (
  select distinct br.id,br.name from public.ops_q_issues qi join public.ops_todos td on td.id=qi.todo_id join public.branches br on br.id=qi.branch_id and br.tenant_id=qi.tenant_id
  where qi.tenant_id=public.get_user_tenant_id() and br.is_active and public.ops_todo_visible(td.id)
 ) related),'[]'));
 if public.ops_q_can(p_branch,'view') then result:=result||jsonb_build_object('business',public.ops_q_business(p_branch,p_period)); end if;
 return result;
end $$;
revoke all on function public.ops_q_business(uuid,text) from public,anon,authenticated;
revoke all on function public.ops_quality_execute(text,jsonb,uuid),public.ops_quality_read(uuid,text,text,jsonb) from public,anon;
grant execute on function public.ops_quality_execute(text,jsonb,uuid),public.ops_quality_read(uuid,text,text,jsonb) to authenticated;
commit;
