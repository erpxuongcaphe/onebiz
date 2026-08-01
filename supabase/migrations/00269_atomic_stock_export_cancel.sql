-- ============================================================
-- 00269: One guarded cancellation path for draft/completed stock exports
-- ============================================================
-- Function definitions only. Applying this migration changes no existing rows.

create or replace function public._cancel_stock_export_00269(
  p_kind text,
  p_document_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_void_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'EXPORT_CANCEL_REASON_REQUIRED';
  end if;

  if p_kind = 'disposal' then
    if not public.user_has_permission(v_actor, 'inventory.dispose') then
      raise exception using errcode = '42501', message = 'DISPOSAL_CANCEL_DENIED';
    end if;
    select d.id, d.code, d.branch_id, d.status into v_doc
      from public.disposal_exports d
     where d.id = p_document_id and d.tenant_id = v_tenant_id
     for update;
  elsif p_kind = 'internal' then
    if not public.user_has_permission(v_actor, 'inventory.internal_export') then
      raise exception using errcode = '42501', message = 'INTERNAL_CANCEL_DENIED';
    end if;
    select e.id, e.code, e.branch_id, e.status into v_doc
      from public.internal_exports e
     where e.id = p_document_id and e.tenant_id = v_tenant_id
     for update;
  else
    raise exception using errcode = '22023', message = 'EXPORT_KIND_INVALID';
  end if;

  if not found then
    raise exception using errcode = '22023', message = 'EXPORT_DOCUMENT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception using errcode = '42501', message = 'EXPORT_BRANCH_DENIED';
  end if;
  if v_doc.status = 'cancelled' then
    return jsonb_build_object(
      'id', v_doc.id, 'code', v_doc.code, 'status', 'cancelled', 'idempotent', true
    );
  end if;

  if v_doc.status = 'draft' then
    if p_kind = 'disposal' then
      update public.disposal_exports
         set status = 'cancelled', updated_at = now()
       where id = v_doc.id and tenant_id = v_tenant_id and status = 'draft';
    else
      update public.internal_exports
         set status = 'cancelled', updated_at = now()
       where id = v_doc.id and tenant_id = v_tenant_id and status = 'draft';
    end if;
  elsif v_doc.status = 'completed' then
    if p_kind = 'disposal' then
      v_void_result := public.void_disposal_export_atomic(v_doc.id, null, v_reason);
    else
      v_void_result := public.void_internal_export_atomic(v_doc.id, null, v_reason);
    end if;
  else
    raise exception using errcode = '22023', message = 'EXPORT_STATUS_NOT_CANCELLABLE';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'stock_export_cancelled',
    case when p_kind = 'internal' then 'internal_export' else 'disposal_export' end,
    v_doc.id,
    jsonb_build_object('status', v_doc.status),
    jsonb_build_object(
      'status', 'cancelled', 'reason', v_reason,
      'stock_reversed', v_doc.status = 'completed',
      'void_result', v_void_result, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_doc.id, 'code', v_doc.code, 'status', 'cancelled',
    'stock_reversed', v_doc.status = 'completed', 'idempotent', false
  );
end;
$$;

create or replace function public.cancel_disposal_export_atomic_v2(
  p_disposal_id uuid,
  p_reason text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._cancel_stock_export_00269('disposal', p_disposal_id, p_reason);
$$;

create or replace function public.cancel_internal_export_atomic_v2(
  p_export_id uuid,
  p_reason text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._cancel_stock_export_00269('internal', p_export_id, p_reason);
$$;

revoke all on function public._cancel_stock_export_00269(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_disposal_export_atomic_v2(uuid, text)
  from public, anon;
revoke all on function public.cancel_internal_export_atomic_v2(uuid, text)
  from public, anon;
grant execute on function public.cancel_disposal_export_atomic_v2(uuid, text)
  to authenticated;
grant execute on function public.cancel_internal_export_atomic_v2(uuid, text)
  to authenticated;

select
  to_regprocedure('public.cancel_disposal_export_atomic_v2(uuid,text)') is not null as cancel_disposal_v2_ok,
  to_regprocedure('public.cancel_internal_export_atomic_v2(uuid,text)') is not null as cancel_internal_v2_ok;
