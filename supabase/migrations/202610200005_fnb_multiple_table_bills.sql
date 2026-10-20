begin;
-- Definitions only. Keep multiple unpaid bills independent at a table.
do $patch$
declare d text; old text; replacement text;
begin
 d:=replace(pg_get_functiondef('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure),E'\r\n',E'\n');
 old:='    update public.restaurant_tables
       set status = ''occupied'',
           current_order_id = v_order_id,
           updated_at = now()
     where id = p_table_id
       and tenant_id = v_tenant_id
       and branch_id = p_branch_id
       and status = ''available''
       and is_active;
'; replacement:='    update public.restaurant_tables
       set status = ''occupied'',
           current_order_id = case when exists(select 1 from public.kitchen_orders existing
             where existing.id=restaurant_tables.current_order_id and existing.tenant_id=v_tenant_id
               and existing.branch_id=p_branch_id and existing.table_id=p_table_id and existing.invoice_id is null
               and existing.merged_into_id is null and existing.status in (''pending'',''preparing'',''ready'',''served''))
             then current_order_id else v_order_id end,
           updated_at = now()
     where id = p_table_id
       and tenant_id = v_tenant_id
       and branch_id = p_branch_id
       and status in (''available'',''occupied'')
       and is_active;
';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'FNB_MULTI_BILL_SEND_SOURCE_CHANGED'; end if;
 execute replace(d,old,replacement);
 d:=replace(pg_get_functiondef('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
 old:='  if v_to_table.status <> ''available'' or v_to_table.current_order_id is not null
     or exists (select 1 from public.kitchen_orders ko
       where ko.tenant_id = v_tenant_id and ko.table_id = v_to_table.id
         and ko.invoice_id is null and ko.merged_into_id is null
         and ko.status in (''pending'', ''preparing'', ''ready'', ''served'')) then
    raise exception using errcode = ''22023'', message = ''FNB_TRANSFER_DESTINATION_UNAVAILABLE'';
  end if;'; replacement:='  if v_to_table.status not in (''available'',''occupied'') then
    raise exception using errcode = ''22023'', message = ''FNB_TRANSFER_DESTINATION_UNAVAILABLE'';
  end if;
  select ko.id into v_destination_order_id from public.kitchen_orders ko
   where ko.tenant_id=v_tenant_id and ko.branch_id=v_order.branch_id and ko.table_id=v_to_table.id
     and ko.invoice_id is null and ko.merged_into_id is null and ko.status in (''pending'',''preparing'',''ready'',''served'')
   order by (ko.id=v_to_table.current_order_id) desc,ko.id limit 1;';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) or position('v_remaining_order_id uuid;' in d)=0 then raise exception 'FNB_MULTI_BILL_TRANSFER_SOURCE_CHANGED'; end if;
 d:=replace(d,'v_remaining_order_id uuid;','v_remaining_order_id uuid; v_destination_order_id uuid;');
 d:=replace(d,old,replacement);
 old:='set status = ''occupied'', current_order_id = v_order.id, updated_at = now()';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'FNB_MULTI_BILL_TRANSFER_POINTER_CHANGED'; end if;
 d:=replace(d,old,'set status = ''occupied'', current_order_id = coalesce(v_destination_order_id,v_order.id), updated_at = now()');
 execute d;
 d:=replace(pg_get_functiondef('public.merge_kitchen_orders_atomic(uuid,uuid[])'::regprocedure),E'\r\n',E'\n');
 old:='       and rt.current_order_id = v_target.id';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'FNB_MULTI_BILL_MERGE_TARGET_CHANGED'; end if;
 d:=replace(d,old,'');
 old:='    if v_source.table_id <> v_target.table_id then
      update public.restaurant_tables
         set status = ''available'', current_order_id = null, updated_at = now()
       where id = v_source.table_id
         and tenant_id = v_tenant_id
         and current_order_id = v_source.id;
      get diagnostics v_row_count = row_count;
      if v_row_count <> 1 then
        raise exception using errcode = ''40001'', message = ''FNB_MERGE_SOURCE_TABLE_STALE'';
      end if;
      v_released_tables := array_append(v_released_tables, v_source.table_id);
    end if;'; replacement:='    if v_source.table_id <> v_target.table_id then
      update public.restaurant_tables rt
         set status=case when exists(select 1 from public.kitchen_orders remaining where remaining.tenant_id=v_tenant_id and remaining.table_id=rt.id and remaining.invoice_id is null and remaining.merged_into_id is null and remaining.status in (''pending'',''preparing'',''ready'',''served'')) then ''occupied'' else ''available'' end,
             current_order_id=(select remaining.id from public.kitchen_orders remaining where remaining.tenant_id=v_tenant_id and remaining.table_id=rt.id and remaining.invoice_id is null and remaining.merged_into_id is null and remaining.status in (''pending'',''preparing'',''ready'',''served'') order by (remaining.id=rt.current_order_id) desc,remaining.id limit 1),updated_at=now()
       where rt.id=v_source.table_id and rt.tenant_id=v_tenant_id and rt.branch_id=v_target.branch_id;
      get diagnostics v_row_count=row_count;
      if v_row_count<>1 then raise exception using errcode=''PT409'',message=''FNB_MERGE_SOURCE_TABLE_STALE''; end if;
      v_released_tables:=array_append(v_released_tables,v_source.table_id);
    end if;';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'FNB_MULTI_BILL_MERGE_SOURCE_CHANGED'; end if;
 d:=replace(d,old,replacement);
 old:='  update public.kitchen_orders'||E'\n'||'     set discount_amount = greatest(coalesce(discount_amount, 0), 0) + v_source_discount,';
 old:=replace(old,E'\r\n',E'\n'); replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'FNB_MULTI_BILL_MERGE_POINTER_CHANGED'; end if;
 d:=replace(d,old,'  update public.restaurant_tables set status=''occupied'',current_order_id=v_target.id,updated_at=now() where id=v_target.table_id and tenant_id=v_tenant_id;'||E'\n'||old);
 execute d;
end $patch$;
notify pgrst,'reload schema';
commit;
