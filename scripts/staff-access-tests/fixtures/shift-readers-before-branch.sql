CREATE OR REPLACE FUNCTION public.close_shift_atomic(p_shift_id uuid, p_actual_cash numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_shift record;
  v_can_manage boolean := false;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;

  select s.id, s.tenant_id, s.branch_id, s.cashier_id, s.status
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.tenant_id = v_tenant_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status <> 'open' then
    raise exception using errcode = 'PT409', message = 'SHIFT_NOT_OPEN';
  end if;
  if not public.user_has_branch_access(v_actor, v_shift.branch_id) then
    raise exception using errcode = '42501', message = 'SHIFT_BRANCH_DENIED';
  end if;

  if v_shift.cashier_id <> v_actor then
    v_can_manage := public.user_has_permission(v_actor, 'shifts.reconcile_any')
      or (
        public.user_has_permission(v_actor, 'shifts.reconcile_own_branch')
        and public.user_has_branch_access(v_actor, v_shift.branch_id)
      );
    if not v_can_manage then
      raise exception using errcode = '42501', message = 'SHIFT_CLOSE_DENIED';
    end if;
  end if;

  return public._finalize_shift_atomic_00298(
    p_shift_id, p_actual_cash, p_note, 'open'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_open_shift_status_scoped(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_own jsonb;
  v_active jsonb;
begin
  select p.tenant_id into v_tenant from public.profiles p where p.id=v_actor and p.is_active;
  if v_tenant is null or p_branch_id is null
    or not public.can_read_branch_document_00567(v_tenant,p_branch_id)
    or not (public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',p_branch_id)
      or public._staff_permission_at_scope(v_actor,'pos_retail.checkout',p_branch_id)
      or public.user_has_permission(v_actor,'shifts.reconcile_any')
      or public.user_has_permission(v_actor,'shifts.reconcile_own_branch')) then
    raise exception using errcode='42501',message='SHIFT_STATUS_DENIED';
  end if;
  if (select count(*) from public.shifts s where s.tenant_id=v_tenant
    and s.branch_id=p_branch_id and s.cashier_id=v_actor and s.status='open') > 1 then
    raise exception using errcode='PT409',message='SHIFT_STATUS_CONFLICT';
  end if;
  with operational as materialized (
    select s.id,s.tenant_id,s.branch_id,s.cashier_id,s.status,s.opened_at,s.closed_at,
      p.full_name as cashier_name
    from public.shifts s left join public.profiles p
      on p.id=s.cashier_id and p.tenant_id=s.tenant_id
    where s.tenant_id=v_tenant and s.branch_id=p_branch_id and s.status='open'
  )
  select
    (select to_jsonb(o) from operational o where o.cashier_id=v_actor),
    (select to_jsonb(o) from operational o order by o.opened_at desc,o.id desc limit 1)
    into v_own,v_active;
  return jsonb_build_object('branch_id',p_branch_id,'own',v_own,'active',v_active);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_reconciled_shifts_scoped(p_branch_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_exclusive timestamp with time zone DEFAULT NULL::timestamp with time zone, p_type text DEFAULT 'all'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_result jsonb;
begin
  if p_type is null or p_type not in ('all','self','cross','big_variance')
    or p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>500
    or (p_from is not null and not isfinite(p_from))
    or (p_to_exclusive is not null and not isfinite(p_to_exclusive))
    or (p_from is not null and p_to_exclusive is not null and p_from>=p_to_exclusive) then
    raise exception using errcode='22023',message='SHIFT_LIST_INPUT_INVALID';
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id=v_actor and p.is_active;
  if v_tenant is null or not (public.user_has_permission(v_actor,'shifts.reconcile_any')
    or public.user_has_permission(v_actor,'shifts.reconcile_own_branch'))
    or (p_branch_id is not null and not public.can_read_branch_document_00567(v_tenant,p_branch_id)) then
    raise exception using errcode='42501',message='SHIFT_LIST_DENIED';
  end if;
  with scoped as materialized (
    select s.id,s.tenant_id,s.branch_id,b.name as branch_name,s.cashier_id,
      c.full_name as cashier_name,s.reconciled_by,r.full_name as reconciled_by_name,
      s.opened_at,s.closed_at,s.reconciled_at,s.auto_marked_pending_at,
      s.starting_cash,s.expected_cash,s.actual_cash,
      coalesce(s.cash_difference,s.actual_cash-coalesce(s.expected_cash,0)) as cash_difference,
      s.total_sales,s.total_orders,s.reconcile_reason,s.note,s.close_kind,
      s.expected_transfer,s.actual_transfer,s.transfer_difference
    from public.shifts s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    left join public.profiles c on c.id=s.cashier_id and c.tenant_id=s.tenant_id
    left join public.profiles r on r.id=s.reconciled_by and r.tenant_id=s.tenant_id
    where s.tenant_id=v_tenant and s.status='closed' and s.actual_cash is not null
      and public.can_read_branch_document_00567(s.tenant_id,s.branch_id)
      and (p_branch_id is null or s.branch_id=p_branch_id)
      and (p_from is null or s.closed_at>=p_from)
      and (p_to_exclusive is null or s.closed_at<p_to_exclusive)
  ), filtered as materialized (
    select * from scoped s where p_type='all'
      or (p_type='self' and s.reconciled_by=s.cashier_id)
      or (p_type='cross' and s.reconciled_by is not null and s.reconciled_by<>s.cashier_id)
      or (p_type='big_variance' and s.expected_cash>0 and abs(s.cash_difference)/s.expected_cash>0.05)
  ), page as (
    select * from filtered order by closed_at desc nulls last,id desc offset p_offset limit p_limit
  )
  select jsonb_build_object('tenant_id',v_tenant,'branch_id',p_branch_id,
    'from',p_from,'to_exclusive',p_to_exclusive,'type',p_type,'offset',p_offset,'limit',p_limit,
    'total_count',(select count(*) from filtered),
    'revision',coalesce((select md5(jsonb_agg(to_jsonb(f) order by f.id)::text) from filtered f),md5('[]')),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.closed_at desc nulls last,p.id desc) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_shift_context_scoped(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_can_reconcile boolean;
begin
  if p_shift_id is null then
    raise exception using errcode='22023',message='SHIFT_CONTEXT_INPUT_INVALID';
  end if;
  select s.* into v_shift from public.shifts s
    join public.profiles p on p.id=v_actor and p.tenant_id=s.tenant_id and p.is_active
    where s.id=p_shift_id;
  if not found or v_shift.branch_id is null
    or not public.can_read_branch_document_00567(v_shift.tenant_id,v_shift.branch_id) then
    raise exception using errcode='42501',message='SHIFT_CONTEXT_DENIED';
  end if;
  v_can_reconcile := public.user_has_permission(v_actor,'shifts.reconcile_any')
    or public.user_has_permission(v_actor,'shifts.reconcile_own_branch');
  if v_can_reconcile then
    return jsonb_build_object('mode','reconciliation','shift',jsonb_build_object(
      'id',v_shift.id,'tenant_id',v_shift.tenant_id,'branch_id',v_shift.branch_id,'cashier_id',v_shift.cashier_id,
      'status',v_shift.status,'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at,
      'starting_cash',v_shift.starting_cash,'actual_cash',v_shift.actual_cash,
      'expected_cash',v_shift.expected_cash,'cash_difference',v_shift.cash_difference,
      'total_sales',v_shift.total_sales,'total_orders',v_shift.total_orders,
      'sales_by_method',v_shift.sales_by_method,'note',v_shift.note));
  end if;
  if v_shift.cashier_id is distinct from v_actor
    or not (public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',v_shift.branch_id)
      or public._staff_permission_at_scope(v_actor,'pos_retail.checkout',v_shift.branch_id)) then
    raise exception using errcode='42501',message='SHIFT_CONTEXT_DENIED';
  end if;
  return jsonb_build_object('mode','blind','shift',jsonb_build_object(
    'id',v_shift.id,'branch_id',v_shift.branch_id,'cashier_id',v_shift.cashier_id,
    'status',v_shift.status,'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at,
    'declared_cash',v_shift.actual_cash,'note',v_shift.note));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_shift_records_scoped(p_kind text, p_branch_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_reconcile boolean;v_result jsonb;
begin
  if p_kind is null or p_kind not in ('pending','history') or p_offset is null or p_offset<0
    or p_limit is null or p_limit<1 or p_limit>500 or (p_kind='history' and p_branch_id is null) then
    raise exception using errcode='22023',message='SHIFT_RECORDS_INPUT_INVALID';
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id=v_actor and p.is_active;
  v_reconcile:=public.user_has_permission(v_actor,'shifts.reconcile_any')
    or public.user_has_permission(v_actor,'shifts.reconcile_own_branch');
  if v_tenant is null or (p_branch_id is not null and not public.can_read_branch_document_00567(v_tenant,p_branch_id))
    or (p_kind='pending' and not v_reconcile)
    or (p_kind='history' and not (v_reconcile or public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',p_branch_id)
      or public._staff_permission_at_scope(v_actor,'pos_retail.checkout',p_branch_id))) then
    raise exception using errcode='42501',message='SHIFT_RECORDS_DENIED';
  end if;
  with scoped as materialized (
    select s.*,b.name as branch_name,c.full_name as cashier_name
    from public.shifts s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    left join public.profiles c on c.id=s.cashier_id and c.tenant_id=s.tenant_id
    where s.tenant_id=v_tenant and public.can_read_branch_document_00567(s.tenant_id,s.branch_id)
      and (p_branch_id is null or s.branch_id=p_branch_id)
      and (p_kind<>'pending' or s.status='pending_reconcile')
      and (v_reconcile or s.cashier_id=v_actor)
  ), projected as materialized (
    select s.id,s.opened_at,
      jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'branch_id',s.branch_id,'branch_name',s.branch_name,
        'cashier_id',s.cashier_id,'cashier_name',s.cashier_name,'status',s.status,
        'opened_at',s.opened_at,'closed_at',s.closed_at,'note',s.note)
      || case when p_kind='pending' then jsonb_build_object('starting_cash',s.starting_cash,
          'auto_marked_pending_at',s.auto_marked_pending_at)
        when v_reconcile then jsonb_build_object('starting_cash',s.starting_cash,'expected_cash',s.expected_cash,
          'actual_cash',s.actual_cash,'cash_difference',s.cash_difference,'total_sales',s.total_sales,
          'total_orders',s.total_orders,'sales_by_method',s.sales_by_method,'close_kind',s.close_kind,
          'expected_transfer',s.expected_transfer,'actual_transfer',s.actual_transfer,'transfer_difference',s.transfer_difference)
        else '{}'::jsonb end as row_data
    from scoped s
  ), page as (
    select * from projected
    order by case when p_kind='pending' then opened_at end asc,
      case when p_kind='history' then opened_at end desc,id desc
    offset p_offset limit p_limit
  )
  select jsonb_build_object('tenant_id',v_tenant,'actor_id',v_actor,'branch_id',p_branch_id,'kind',p_kind,
    'mode',case when v_reconcile then 'reconciliation' else 'blind' end,
    'as_of',now(),'offset',p_offset,'limit',p_limit,'total_count',(select count(*) from projected),
    'revision',coalesce((select md5(jsonb_agg(row_data order by id)::text) from projected),md5('[]')),
    'rows',coalesce((select jsonb_agg(row_data order by
      case when p_kind='pending' then opened_at end asc,
      case when p_kind='history' then opened_at end desc,id desc) from page),'[]'::jsonb))
    into v_result;
  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_pending_shift(p_shift_id uuid, p_actual_cash numeric, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_tenant uuid := public.get_user_tenant_id();
  v_shift record;
  v_can_any boolean;
  v_can_own boolean;
  v_result jsonb;
  v_final_note text;
begin
  if v_actor is null or v_actor_tenant is null then
    raise exception using errcode = '42501', message = 'SHIFT_AUTH_REQUIRED';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'SHIFT_REASON_REQUIRED';
  end if;

  select s.id, s.tenant_id, s.branch_id, s.cashier_id, s.status
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.tenant_id = v_actor_tenant
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'SHIFT_NOT_FOUND';
  end if;
  if v_shift.status <> 'pending_reconcile' then
    raise exception using errcode = 'PT409', message = 'SHIFT_NOT_PENDING_RECONCILE';
  end if;

  v_can_any := public.user_has_permission(v_actor, 'shifts.reconcile_any');
  v_can_own := public.user_has_permission(v_actor, 'shifts.reconcile_own_branch')
    and public.user_has_branch_access(v_actor, v_shift.branch_id);
  if not (v_can_any or v_can_own) then
    raise exception using errcode = '42501', message = 'SHIFT_RECONCILE_DENIED';
  end if;

  v_final_note := concat_ws(
    ' ',
    nullif(trim(coalesce(p_note, '')), ''),
    '[Doi chieu: ' || trim(p_reason) || ']'
  );

  v_result := public._finalize_shift_atomic_00298(
    p_shift_id, p_actual_cash, v_final_note, 'pending_reconcile'
  );

  update public.shifts
     set reconciled_by = v_actor,
         reconciled_at = now(),
         reconcile_reason = trim(p_reason)
   where id = p_shift_id
     and status = 'closed';

  return v_result || jsonb_build_object(
    'reconciled_by', v_actor,
    'reconciled_at', now(),
    'reconcile_reason', trim(p_reason)
  );
end;
$function$
;
