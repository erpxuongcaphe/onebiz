-- One-batch Hub completion. Reserved away from concurrent FnB migrations 00540-00542.
-- Mechanisms only; never recalculate existing history here.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.ops_q_periods (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, title text not null check(length(trim(title)) between 1 and 120),
 starts_on date not null, ends_on date not null, created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(), check(ends_on>=starts_on and ends_on-starts_on<=366),
 unique(tenant_id,branch_id,starts_on,ends_on)
);
create table public.ops_q_groups (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
 branch_id uuid not null references public.branches, title text not null check(length(trim(title)) between 1 and 120),
 active boolean not null default true, version integer not null default 1,
 created_by uuid not null references public.profiles, created_at timestamptz not null default now()
);
create unique index ops_q_groups_title on public.ops_q_groups(tenant_id,branch_id,lower(trim(title)));
alter table public.ops_q_catalog add column group_title text;
create function public.ops_q_snapshot_group() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.category like 'group:%' then
  select title into new.group_title from public.ops_q_groups where id=substring(new.category from 7)::uuid and tenant_id=new.tenant_id and branch_id=new.branch_id and active;
  if new.group_title is null then raise exception 'OPS_FORBIDDEN'; end if;
 end if;
 return new;
end $$;
create trigger ops_q_catalog_group before insert on public.ops_q_catalog for each row execute function public.ops_q_snapshot_group();
revoke all on function public.ops_q_snapshot_group() from public,anon,authenticated;
alter table public.ops_q_checks alter column run_id drop not null;
alter table public.ops_q_checks add column kind text not null default 'scheduled' check(kind in ('scheduled','adhoc'));
alter table public.ops_q_checks add constraint ops_q_check_kind check((kind='scheduled')=(run_id is not null));

create function public.ops_q_period_bounds(p_branch uuid,p_period text)
returns table(starts_on date,ends_on date) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ops_q_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 if p_period ~ '^\d{4}-(0[1-9]|1[0-2])$' then
  return query select (p_period||'-01')::date,((p_period||'-01')::date+interval '1 month'-interval '1 day')::date;
 elsif p_period ~ '^custom:[0-9a-f-]{36}$' then
  return query select p.starts_on,p.ends_on from public.ops_q_periods p
   where p.id=substring(p_period from 8)::uuid and p.branch_id=p_branch and p.tenant_id=public.get_user_tenant_id();
  if not found then raise exception 'OPS_INVALID_RANGE'; end if;
 else raise exception 'OPS_INVALID_RANGE'; end if;
end $$;
create function public.ops_q_period_valid(p_branch uuid,p_period text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 perform 1 from public.ops_q_period_bounds(p_branch,p_period);
 return found;
end $$;
create function public.ops_q_period_end(p_branch uuid,p_period text) returns date
language sql stable security definer set search_path='' as $$
 select ends_on from public.ops_q_period_bounds(p_branch,p_period);
$$;

alter table public.ops_q_audits drop constraint ops_q_audits_period_check;
alter table public.ops_q_accounting drop constraint ops_q_accounting_period_check;
alter table public.ops_targets drop constraint ops_targets_period_check;
alter table public.ops_revenues drop constraint ops_revenues_period_check;
alter table public.ops_q_audits add constraint ops_q_audits_period_check check(period ~ '^\d{4}-(0[1-9]|1[0-2])$|^custom:[0-9a-f-]{36}$');
alter table public.ops_q_accounting add constraint ops_q_accounting_period_check check(period ~ '^\d{4}-(0[1-9]|1[0-2])$|^custom:[0-9a-f-]{36}$');
alter table public.ops_targets add constraint ops_targets_period_check check(period ~ '^\d{4}-(0[1-9]|1[0-2])$|^custom:[0-9a-f-]{36}$');
alter table public.ops_revenues add constraint ops_revenues_period_check check(period ~ '^\d{4}-(0[1-9]|1[0-2])$|^custom:[0-9a-f-]{36}$');

-- Validate new optional limits without changing the interpretation of legacy policies.
alter function public.ops_q_rule_errors(jsonb,boolean) rename to ops_q_rule_errors_legacy;
create function public.ops_q_rule_errors(c jsonb,p_reward boolean default false) returns jsonb
language plpgsql immutable set search_path='' as $$
declare normalized jsonb:=c; errors jsonb; item jsonb; k text; field text;
begin
 if c ? 'limits' then
  if jsonb_typeof(c->'limits') is distinct from 'object' then return '["Chọn rõ các giới hạn áp dụng."]'::jsonb; end if;
  foreach k in array array['floor','ceiling','bonus'] loop
   if jsonb_typeof(c->'limits'->k) is distinct from 'boolean' then return '["Chọn rõ các giới hạn áp dụng."]'::jsonb; end if;
   field:=case k when 'floor' then 'floorScore' when 'ceiling' then 'capScore' else 'bonusCap' end;
   if not (c->'limits'->>k)::boolean then normalized:=jsonb_set(normalized,array[field],to_jsonb(case k when 'floor' then 0 else 1000 end)); end if;
  end loop;
 end if;
 errors:=public.ops_q_rule_errors_legacy(normalized,p_reward);
 if c ? 'limits' and (c->'limits'->>'floor')::boolean and (c->>'allowAbove100')::boolean is false and (c->>'floorScore')::numeric>100 then
  errors:=errors||'"Sàn điểm không được vượt 100 khi chương trình không cho vượt 100."'::jsonb;
 end if;
 if (c ? 'limits' or c ? 'openIssueAcrossPeriods') and coalesce(c->>'openIssueAcrossPeriods','') not in ('each_period','once_until_closed') then
  errors:=errors||'"Chọn cách tính lỗi chưa khắc phục qua kỳ mới."'::jsonb;
 end if;
 if c ? 'bonusLimits' then
  if jsonb_typeof(c->'bonusLimits') is distinct from 'array' then return errors||'"Giới hạn từng hạng mục không hợp lệ."'::jsonb; end if;
  if (select count(distinct x->>'familyId') from jsonb_array_elements(c->'bonusLimits') x)<>jsonb_array_length(c->'bonusLimits') then errors:=errors||'"Trùng giới hạn hạng mục."'::jsonb; end if;
  for item in select value from jsonb_array_elements(c->'bonusLimits') loop
   if coalesce(item->>'familyId','') !~ '^[0-9a-f-]{36}$' then errors:=errors||'"Mã giới hạn không hợp lệ."'::jsonb; end if;
   foreach k in array array['maxAwards','maxPoints'] loop
    if item->k is not null and item->k<>'null'::jsonb then
     if jsonb_typeof(item->k) is distinct from 'number' then errors:=errors||'"Giới hạn phải là số."'::jsonb;
     elsif (item->>k)::numeric<0 or (item->>k)::numeric>(case k when 'maxAwards' then 10000 else 1000 end)
       or k='maxAwards' and (item->>k)::numeric<>trunc((item->>k)::numeric)
       or k='maxPoints' and round((item->>k)::numeric,2)<>(item->>k)::numeric then errors:=errors||'"Giới hạn hạng mục ngoài phạm vi hoặc quá hai số thập phân."'::jsonb; end if;
    end if;
   end loop;
  end loop;
 end if;
 return errors;
end $$;

-- New repeat policies may claim an unresolved issue in an earlier, non-overlapping period.
-- Existing policies do not enter this branch and keep their original reconciliation.
do $patch$
declare definition text; marker text:=' for l in select line.*'; replacement text;
begin
 definition:=pg_get_functiondef('public.ops_q_reconcile(uuid,text)'::regprocedure);
 if strpos(definition,marker)=0 then raise exception 'Hub reconcile baseline changed'; end if;
 definition:=replace(definition,'claimed text[]:=''{}'';','prior_claimed text[]:=''{}''; claimed text[]:=''{}'';');
 replacement:=$body$
 if cfg->>'openIssueAcrossPeriods'='once_until_closed' then
  select coalesce(array_agg(distinct (prior_line.item_snapshot->>'family_id')||':'||s.issue_id::text),'{}') into claimed
   from public.ops_q_events e join public.ops_q_lines prior_line on prior_line.id=e.line_id
   join public.ops_q_sources s on s.qc_line_id=prior_line.id
   where e.branch_id=p_branch and e.period<>p_period
    and public.ops_q_period_end(p_branch,e.period)<(select starts_on from public.ops_q_period_bounds(p_branch,p_period))
    and e.delta<0 and not exists(select 1 from public.ops_q_events reverse where reverse.reverses=e.id);
  prior_claimed:=claimed;
 end if;
 for l in select line.*$body$;
 definition:=replace(definition,marker,replacement);
 marker:='  if expected<0 and cfg->>''repeatMode''=''once_per_issue'' then';
 if strpos(definition,marker)=0 then raise exception 'Hub repeat baseline changed'; end if;
 replacement:=$body$
  if expected<0 and cfg->>'repeatMode'='each_audit' and cfg->>'openIssueAcrossPeriods'='once_until_closed' then
   select array_agg((l.item_snapshot->>'family_id')||':'||issue_id::text) into linked from public.ops_q_sources where qc_line_id=l.id;
   if linked is null then raise exception 'OPS_Q_ISSUE_REQUIRED'; end if;
   if not exists(select 1 from unnest(linked) u where not u=any(prior_claimed)) then expected:=0; end if;
  end if;
  if expected<0 and cfg->>'repeatMode'='once_per_issue' then$body$;
 execute replace(definition,marker,replacement);
end $patch$;

alter function public.ops_q_score(uuid,text) rename to ops_q_score_legacy;
revoke all on function public.ops_q_score_legacy(uuid,text) from public,anon,authenticated;
create function public.ops_q_score(p_branch uuid,p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb; d numeric; bonus numeric; applied numeric:=0; critical integer; n integer;
 score numeric; raw numeric; threshold numeric; errors jsonb; reward numeric;
 entry record; lim jsonb; family text; used jsonb:='{}'; cnt integer; pts numeric; amount numeric;
begin
 if not public.ops_q_can(p_branch,'view') then raise exception 'OPS_FORBIDDEN'; end if;
 perform 1 from public.ops_q_period_bounds(p_branch,p_period);
 select count(*) into n from public.ops_q_audits where branch_id=p_branch and period=p_period and state='completed';
 select r.config into c from public.ops_q_audits a join public.ops_q_rules r on r.id=a.rule_id where a.branch_id=p_branch and a.period=p_period and a.state='completed' order by a.completed_at,a.id limit 1;
 if c is not null and not (c ? 'limits') and not (c ? 'bonusLimits') then
  return public.ops_q_score_legacy(p_branch,p_period);
 end if;
 select coalesce(sum(delta) filter(where delta<0),0),coalesce(sum(delta) filter(where delta>0),0),coalesce(sum(critical_delta),0)
 into d,bonus,critical from(select sum(delta) delta,sum(critical_delta) critical_delta from public.ops_q_events where branch_id=p_branch and period=p_period group by line_id) net;
 errors:=public.ops_q_rule_errors(c,false);
 if n>0 and jsonb_array_length(errors)=0 then
  for entry in select l.item_snapshot,sum(e.delta) delta,a.completed_at,a.id audit_id,l.id line_id from public.ops_q_events e
   join public.ops_q_lines l on l.id=e.line_id join public.ops_q_audits a on a.id=e.audit_id
   where e.branch_id=p_branch and e.period=p_period group by l.id,l.item_snapshot,a.id,a.completed_at having sum(e.delta)>0
   order by a.completed_at,a.id,l.id loop
   family:=entry.item_snapshot->>'family_id';
   select value into lim from jsonb_array_elements(coalesce(c->'bonusLimits','[]')) where value->>'familyId'=family;
   cnt:=coalesce((used->family->>'count')::integer,0); pts:=coalesce((used->family->>'points')::numeric,0);
   amount:=case when lim->>'maxAwards' is not null and cnt>=(lim->>'maxAwards')::integer then 0
    when lim->>'maxPoints' is not null then least(entry.delta,greatest(0,(lim->>'maxPoints')::numeric-pts)) else entry.delta end;
   applied:=applied+amount; used:=jsonb_set(used,array[family],jsonb_build_object('count',cnt+1,'points',pts+amount));
  end loop;
  if coalesce((c->'limits'->>'bonus')::boolean,true) then applied:=least(applied,(c->>'bonusCap')::numeric); end if;
  raw:=(c->>'baseScore')::numeric+d+bonus;
  score:=(c->>'baseScore')::numeric+d+applied;
  if coalesce((c->'limits'->>'floor')::boolean,true) then score:=greatest((c->>'floorScore')::numeric,score); end if;
  if coalesce((c->'limits'->>'ceiling')::boolean,true) then score:=least((c->>'capScore')::numeric,score); end if;
  if not (c->>'allowAbove100')::boolean then score:=least(100,score); end if;
  errors:=public.ops_q_rule_errors(c,true);
  if jsonb_array_length(errors)=0 then
   threshold:=case c->>'thresholdBasis' when 'before_bonus' then (c->>'baseScore')::numeric+d else score end;
   reward:=case when critical>0 or threshold<(c->>'minimumScore')::numeric then 0 else greatest(0,round(score*(c->>'qcFundCents')::numeric/100)) end;
   if reward>9007199254740991 then reward:=null; errors:=errors||'"Thưởng vượt giới hạn số tiền an toàn."'::jsonb; end if;
  end if;
 elsif n=0 then errors:='["Chưa có kết quả QC."]'; end if;
 return jsonb_build_object('official',n>0 and score is not null,'completedAudits',n,'deductions',d,'bonus',bonus,'appliedBonus',applied,'rawScore',raw,'score',score,'critical',critical>0,'rewardReady',reward is not null,'rewardCents',reward,'reasons',errors,'config',c);
end $$;

-- Existing audited RPC bodies remain canonical. Guard every baseline replacement.
do $patch$
declare def text; sig text; old text; replacement text;
begin
 foreach sig in array array['public.ops_quality_execute_core(text,jsonb,uuid)','public.ops_quality_read_core(uuid,text,text,jsonb)','public.ops_q_business(uuid,text)'] loop
  def:=pg_get_functiondef(sig::regprocedure);
  if sig like '%execute_core%' then
   old:='period is null or period !~ ''^\d{4}-(0[1-9]|1[0-2])$''';
   if strpos(def,old)=0 then raise exception 'Hub period execute baseline changed'; end if;
   def:=replace(def,old,'not public.ops_q_period_valid(b,period)');
   def:=replace(def,'((period||''-01'')::date+interval ''1 month''-interval ''1 day'')::date','public.ops_q_period_end(b,period)');
   def:=replace(def,'((a.period||''-01'')::date+interval ''1 month''-interval ''1 day'')::date','public.ops_q_period_end(b,a.period)');
   def:=replace(def,'((period||''-01'')::date+interval ''1 month'')::date','(public.ops_q_period_end(b,period)+1)');
   old:='item.category not in (''operations'',''hr'',''maintenance'',''complaint'',''food_safety'',''product'',''goods'',''cleaning'',''space'',''equipment'',''other'')';
   if strpos(def,old)=0 then raise exception 'Hub catalog baseline changed'; end if;
   def:=replace(def,old,'item.category not in (''operations'',''hr'',''maintenance'',''complaint'',''food_safety'',''product'',''goods'',''cleaning'',''space'',''equipment'',''other'') and not exists(select 1 from public.ops_q_groups g where ''group:''||g.id::text=item.category and g.tenant_id=p.tenant_id and g.branch_id=b and g.active)');
  elsif sig like '%read_core%' then
   old:='p_period is null or p_period !~ ''^\d{4}-(0[1-9]|1[0-2])$''';
   if strpos(def,old)=0 then raise exception 'Hub period read baseline changed'; end if;
   -- Collaborators without branch browse still use the monthly issue/history view.
   def:=replace(def,old,'p_period is null or (p_period !~ ''^\d{4}-(0[1-9]|1[0-2])$'' and not public.ops_q_period_valid(p_branch,p_period))');
  else
   old:='((p_period||''-01'')::date+interval ''1 month''-interval ''1 day'')::date';
   if strpos(def,old)=0 then raise exception 'Hub business period baseline changed'; end if;
   def:=replace(def,old,'public.ops_q_period_end(p_branch,p_period)');
  end if;
  execute def;
 end loop;
end $patch$;

alter table public.ops_q_periods enable row level security;
alter table public.ops_q_groups enable row level security;
revoke all on public.ops_q_periods,public.ops_q_groups from public,anon,authenticated;
revoke all on function public.ops_q_period_bounds(uuid,text),public.ops_q_period_valid(uuid,text),public.ops_q_period_end(uuid,text),public.ops_q_rule_errors(jsonb,boolean),public.ops_q_rule_errors_legacy(jsonb,boolean),public.ops_q_score(uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
