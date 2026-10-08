-- Read-only history projection. Existing events and business rows are untouched.
begin;
set local lock_timeout = '3s';
do $$ begin
  if to_regprocedure('public.user_has_permission(uuid,text)') is null
      or to_regprocedure('public.user_has_branch_access(uuid,uuid)') is null then
    raise exception 'AUDIT_PREREQUISITES_MISSING';
  end if;
  -- Resolve the existing schema now, so a drifted database rejects this
  -- migration before publishing a function that would fail at first use.
  perform id, tenant_id, full_name, role, is_active from public.profiles limit 0;
  perform id, tenant_id, name from public.branches limit 0;
  perform id, tenant_id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at from public.audit_log limit 0;
  perform id, tenant_id, branch_id, invoice_id, order_number from public.kitchen_orders limit 0;
  perform id, tenant_id, branch_id, code from public.invoices limit 0;
  perform id, tenant_id, branch_id, source, event_type, target_type, target_id, requested_by, approved_by,
    invoice_id, kitchen_order_id, amount, reason_code, reason_note, items_snapshot, metadata, shift_id, created_at from public.pos_exception_events limit 0;
  perform id, tenant_id, branch_id, issued_by, used_at, action_code, target_meta, expires_at, created_at from public.manager_otp_codes limit 0;
end $$;

create or replace function public._audit_uuid_00453(p_value text)
returns uuid language sql immutable set search_path = public as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then p_value::uuid else null end;
$$;

-- Audit payloads may originate from clients. Redact secrets at every nesting
-- level, rather than exposing OTP hashes or tokens in a detail drawer/search.
create or replace function public._audit_safe_json_00453(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_result jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(key, public._audit_safe_json_00453(value)), '{}'::jsonb)
      into v_result from jsonb_each(p_value)
      where key !~* '(otp|password|secret|token|code_hash|authorization|cookie)';
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public._audit_safe_json_00453(value) order by ordinal), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality e(value, ordinal);
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function public.get_operation_history_00453(
  p_branch_id uuid default null, p_source text default null,
  p_action text default null, p_entity_type text default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_actor_id uuid default null, p_approver_id uuid default null,
  p_search text default null, p_page integer default 0, p_page_size integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_owner boolean; v_result jsonb;
begin
  select tenant_id, role = 'owner' into v_tenant, v_owner from public.profiles
    where id = v_actor and is_active = true;
  if v_tenant is null or not coalesce(public.user_has_permission(v_actor, 'system.view_audit'), false) then
    raise exception using errcode = '42501', message = 'AUDIT_PERMISSION_DENIED';
  end if;
  if p_branch_id is not null and (not exists (
      select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant)
      or not coalesce(public.user_has_branch_access(v_actor, p_branch_id), false)) then
    raise exception using errcode = '42501', message = 'AUDIT_BRANCH_ACCESS_DENIED';
  end if;
  if p_page is null or p_page_size is null or p_page < 0 or p_page_size < 1 or p_page_size > 100
      or (p_from is not null and p_to is not null and p_from >= p_to)
      or (p_source is not null and p_source not in ('fnb','retail','other')) then
    raise exception using errcode = '22023', message = 'AUDIT_FILTER_INVALID';
  end if;
  with raw as (
    select 'audit:' || a.id::text as id, 'audit'::text as record_kind,
      a.action, a.entity_type, a.entity_id, a.user_id as actor_id,
      public._audit_uuid_00453(coalesce(a.new_data->>'approved_by', a.old_data->>'approved_by')) as approver_id,
      coalesce(k.branch_id, i.branch_id,
        public._audit_uuid_00453(coalesce(a.new_data->>'branch_id', a.old_data->>'branch_id'))) as branch_id,
      case when k.id is not null or a.entity_type in ('kitchen_order','kitchen_order_item','restaurant_table')
          or left(a.action,4) = 'fnb_' or a.new_data->>'source' = 'fnb' then 'fnb'
        when a.new_data->>'source' = 'retail' or left(a.action,11) = 'pos_retail.'
          or a.action in ('pos_checkout_completed','pos_draft_completed') then 'retail'
        else 'other' end as source,
      public._audit_safe_json_00453(a.old_data) as old_data,
      public._audit_safe_json_00453(a.new_data) as new_data,
      coalesce(k.order_number, i.code, a.new_data->>'order_number', a.new_data->>'invoice_code',
        a.new_data->>'code', a.new_data->>'name', a.old_data->>'code', a.old_data->>'name') as entity_name,
      a.ip_address, a.created_at
    from public.audit_log a
    left join public.invoices i on a.entity_type = 'invoice' and i.id = a.entity_id and i.tenant_id = v_tenant
    left join lateral (select ko.id, ko.branch_id, ko.order_number from public.kitchen_orders ko where ko.tenant_id = v_tenant and
      ((a.entity_type = 'kitchen_order' and ko.id = a.entity_id)
       or (a.entity_type = 'invoice' and ko.invoice_id = a.entity_id)) order by ko.id limit 1) k on true
    where a.tenant_id = v_tenant and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
    union all
    select 'exception:' || e.id::text, 'exception', e.event_type, e.target_type, e.target_id,
      e.requested_by, e.approved_by, e.branch_id,
      case when e.source in ('fnb','retail') then e.source else 'other' end,
      null::jsonb, public._audit_safe_json_00453(jsonb_build_object(
        'amount',e.amount,'reason_code',e.reason_code,'reason',e.reason_note,
        'items',e.items_snapshot,'metadata',e.metadata,'shift_id',e.shift_id)),
      coalesce(k.order_number,i.code), null::text, e.created_at
    from public.pos_exception_events e
    left join public.kitchen_orders k on k.id=e.kitchen_order_id and k.tenant_id=v_tenant
    left join public.invoices i on i.id=e.invoice_id and i.tenant_id=v_tenant
    where e.tenant_id=v_tenant and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
    union all
    select 'approval:' || o.id::text, 'approval', 'otp_issued', 'approval',
      public._audit_uuid_00453(coalesce(o.target_meta->>'kitchen_order_id',o.target_meta->>'invoice_id',o.target_meta->>'entity_id')),
      o.issued_by, o.issued_by, o.branch_id,
      case when left(o.action_code,4)='fnb.' then 'fnb' when left(o.action_code,11)='pos_retail.' then 'retail' else 'other' end,
      null::jsonb, jsonb_build_object('action',o.action_code,'used_at',o.used_at,'expires_at',o.expires_at),
      coalesce(o.target_meta->>'kitchen_order_number',o.target_meta->>'invoice_code'), null::text, o.created_at
    from public.manager_otp_codes o where o.tenant_id=v_tenant
      and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to)
  ), scoped as (
    select r.*, coalesce(b.name,'Chưa ghi chi nhánh') as branch_name,
      coalesce(p.full_name,'Hệ thống') as actor_name, ap.full_name as approver_name
    from raw r
    left join public.branches b on b.id=r.branch_id and b.tenant_id=v_tenant
    left join public.profiles p on p.id=r.actor_id and p.tenant_id=v_tenant
    left join public.profiles ap on ap.id=r.approver_id and ap.tenant_id=v_tenant
    where ((r.branch_id is null and v_owner) or (b.id is not null and public.user_has_branch_access(v_actor,r.branch_id)))
      and (p_branch_id is null or r.branch_id=p_branch_id)
      and (p_source is null or r.source=p_source)
      and (p_action is null or r.action=p_action)
      and (p_entity_type is null or r.entity_type=p_entity_type)
      and (p_actor_id is null or r.actor_id=p_actor_id)
      and (p_approver_id is null or r.approver_id=p_approver_id)
  ), filtered as (
    select * from scoped where nullif(trim(p_search),'') is null or
      strpos(lower(concat_ws(' ',entity_name,entity_id::text,action,actor_name,approver_name,branch_name)),lower(trim(p_search))) > 0
  ), page as (
    select * from filtered order by created_at desc,id desc limit p_page_size offset p_page*p_page_size
  ) select jsonb_build_object('total',(select count(*) from filtered),
      'data',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;
revoke all on function public._audit_uuid_00453(text), public._audit_safe_json_00453(jsonb) from public, anon, authenticated;
revoke all on function public.get_operation_history_00453(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,integer,integer) from public, anon;
grant execute on function public.get_operation_history_00453(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
