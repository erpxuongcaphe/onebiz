-- Update only the whole-order note on an open, already-sent F&B bill.
begin;
set local lock_timeout = '2s';

create or replace function public.fnb_save_order_note_v1(p_order_id uuid, p_note text, p_expected_note text)
returns jsonb
language plpgsql security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order public.kitchen_orders;
  v_note text := coalesce(p_note, '');
  v_current text;
begin
  select tenant_id into v_tenant from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant is null or not coalesce(public.user_has_permission(v_actor, 'pos_fnb.send_kitchen')
    or public.user_has_permission(v_actor, 'pos_fnb.checkout'), false) then
    raise exception 'ORDER_NOTE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Ghi chú đơn tối đa 1.000 ký tự.' using errcode = '22023';
  end if;
  select ko.* into v_order from public.kitchen_orders ko
    where ko.id = p_order_id and ko.tenant_id = v_tenant
      and public.user_has_branch_access(v_actor, ko.branch_id) is true
    for update;
  if not found then raise exception 'ORDER_NOTE_ACCESS_DENIED' using errcode = '42501'; end if;
  if v_order.invoice_id is not null or v_order.merged_into_id is not null
    or v_order.status is null or v_order.status not in ('pending', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_NOTE_NOT_UNPAID';
  end if;
  v_current := coalesce(v_order.note, '');
  -- A retry after losing the response must not duplicate history.
  if v_current = v_note then return jsonb_build_object('note', v_current, 'updated_at', v_order.updated_at); end if;
  if v_current <> coalesce(p_expected_note, '') then
    return jsonb_build_object('conflict', true, 'note', v_current, 'updated_at', v_order.updated_at);
  end if;
  update public.kitchen_orders set note = nullif(v_note, ''), updated_at = clock_timestamp()
    where id = v_order.id returning updated_at into v_order.updated_at;
  insert into public.audit_log(tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
    values (v_tenant, v_actor, 'fnb_order_note_update', 'kitchen_order', v_order.id,
      jsonb_build_object('note', v_order.note), jsonb_build_object('note', nullif(v_note, ''), 'branch_id', v_order.branch_id));
  return jsonb_build_object('note', v_note, 'updated_at', v_order.updated_at);
end $$;
revoke all on function public.fnb_save_order_note_v1(uuid, text, text) from public, anon;
grant execute on function public.fnb_save_order_note_v1(uuid, text, text) to authenticated;
commit;
