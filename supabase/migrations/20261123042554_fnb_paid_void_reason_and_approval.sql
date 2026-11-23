begin;
set local lock_timeout = '3s';
set local statement_timeout = '25s';

-- Keep the existing refund, inventory, branch-scope and approval implementations.
do $migration$
declare
  v_edit record;
  v_definition text;
begin
  for v_edit in
    select * from (values
      (
        'public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure,
        '  if p_otp_id is not null then',
        $pos$
  p_void_reason := regexp_replace(coalesce(p_void_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if char_length(p_void_reason) < 3 then
    raise exception 'FNB_VOID_REASON_REQUIRED';
  end if;

  if p_otp_id is null and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.tenant_id = p_tenant_id
      and coalesce(p.is_active, true) and p.role in ('owner', 'admin', 'manager')
  ) then
    raise exception using errcode = '42501', message = 'FNB_VOID_APPROVAL_REQUIRED';
  end if;

  if p_otp_id is not null then$pos$
      ),
      (
        'public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure,
        '      p_otp_id, ''fnb.void_paid_bill'', auth.uid(), p_invoice_id' || chr(10) || '    );',
        $approver$      p_otp_id, 'fnb.void_paid_bill', auth.uid(), p_invoice_id
    );
    if v_approver = auth.uid() then
      raise exception using errcode = '42501', message = 'FNB_VOID_SELF_APPROVAL_DENIED';
    end if;$approver$
      ),
      (
        'public._void_completed_invoice_atomic_v2_impl_00250(uuid,text,text,uuid)'::regprocedure,
        '  if coalesce(v_invoice.source, '''') = ''fnb'' then',
        $backoffice$  if coalesce(v_invoice.source, '') = 'fnb' then
    p_reason := regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if char_length(p_reason) < 3 then
      raise exception 'FNB_VOID_REASON_REQUIRED';
    end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = v_actor and p.tenant_id = v_tenant_id
        and coalesce(p.is_active, true) and p.role in ('owner', 'admin', 'manager')
    ) then
      raise exception using errcode = '42501', message = 'FNB_VOID_APPROVAL_REQUIRED';
    end if;$backoffice$
      )
    ) as edits(target, anchor, replacement)
  loop
    v_definition := replace(pg_get_functiondef(v_edit.target), chr(13), '');
    if cardinality(string_to_array(v_definition, v_edit.anchor)) <> 2 then
      raise exception 'Unexpected paid-void definition: %', v_edit.target;
    end if;
    execute replace(v_definition, v_edit.anchor, v_edit.replacement);
  end loop;
end;
$migration$;

commit;
