-- Verify migration install, exact consumption capture, and cumulative partial returns.
-- Run only in the disposable database created by ci.yml.
\set ON_ERROR_STOP on

do $$
declare
  v_payment_definition text;
  v_return_definition text;
  v_consumption jsonb;
  v_result jsonb;
  v_invoice_id constant uuid := '10000000-0000-0000-0000-000000000001';
  v_invoice_item_id uuid;
  v_return_id uuid;
  v_tenant_id constant uuid := '20000000-0000-0000-0000-000000000001';
  v_branch_id constant uuid := '30000000-0000-0000-0000-000000000001';
  v_sku_id constant uuid := '40000000-0000-0000-0000-000000000001';
  v_material_id constant uuid := '40000000-0000-0000-0000-000000000002';
  v_total_restored numeric;
begin
  select pg_get_functiondef(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure
  ) into v_payment_definition;
  select pg_get_functiondef(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) into v_return_definition;
  if v_payment_definition not like '%_capture_fnb_invoice_item_bom_snapshot_00410%'
     or v_return_definition not like '%_restore_fnb_invoice_item_bom_00410%'
     or v_return_definition not like '%FNB_RETURN_LEGACY_BOM_FALLBACK%' then
    raise exception '00410 RPC patch verification failed';
  end if;

  insert into public.products(id) values (v_sku_id), (v_material_id);
  insert into public.invoices(id, tenant_id, branch_id, source)
  values (v_invoice_id, v_tenant_id, v_branch_id, 'fnb');
  insert into public.invoice_items(
    id, invoice_id, product_id, product_name, unit, quantity,
    unit_price, discount, vat_rate, vat_amount, total
  ) values (
    '50000000-0000-0000-0000-000000000001', v_invoice_id, v_sku_id,
    'Thach Suong Sao', 'ly', 3, 0, 0, 0, 0, 0
  ) returning id into v_invoice_item_id;

  v_consumption := jsonb_build_object(
    'success', true,
    'bom_id', '00000000-0000-0000-0000-000000000001',
    'consumed', jsonb_build_array(
      jsonb_build_object('material_id', v_material_id, 'qty', 4.5, 'unit', 'G'),
      jsonb_build_object('material_id', v_material_id, 'qty', 3, 'kind', 'modifier_topping')
    )
  );
  perform public._capture_fnb_invoice_item_bom_snapshot_00410(
    v_invoice_item_id, v_invoice_id, v_consumption
  );
  if (select count(*) from public.fnb_invoice_item_bom_snapshots_00410
       where invoice_item_id = v_invoice_item_id) <> 1
     or (select sum(quantity) from public.fnb_invoice_item_bom_snapshot_components_00410
          where invoice_item_id = v_invoice_item_id) <> 4.5 then
    raise exception 'snapshot did not preserve recipe quantity or included topping consumption';
  end if;

  v_return_id := '60000000-0000-0000-0000-000000000001';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, v_invoice_id, v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, v_invoice_item_id, v_sku_id, 1);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    v_invoice_item_id, v_tenant_id, v_branch_id, v_sku_id, 1,
    v_return_id, null, 'RT-1', null
  );
  if v_result->>'snapshot_mode' is distinct from 'invoice_item'
     or (select sum(quantity) from public.stock_movements
          where reference_type = 'return_bom_restore' and reference_id = v_return_id) <> 1.5 then
    raise exception 'first partial return did not restore its proportional snapshot: %', v_result;
  end if;
  update public.invoice_items set returned_qty = 1 where id = v_invoice_item_id;

  v_return_id := '60000000-0000-0000-0000-000000000002';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, v_invoice_id, v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, v_invoice_item_id, v_sku_id, 2);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    v_invoice_item_id, v_tenant_id, v_branch_id, v_sku_id, 2,
    v_return_id, null, 'RT-2', null
  );
  select sum(quantity) into v_total_restored from public.stock_movements
   where reference_type = 'return_bom_restore'
     and reference_id in (
       '60000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000002'
     );
  if v_result->>'snapshot_mode' is distinct from 'invoice_item' or v_total_restored <> 4.5 then
    raise exception 'full partial-return sequence did not exactly restore source BOM quantity: %', v_total_restored;
  end if;

  -- Old F&B invoices stay untouched and retain a clearly-labelled legacy path.
  insert into public.invoices(id, tenant_id, branch_id, source)
  values ('10000000-0000-0000-0000-000000000002', v_tenant_id, v_branch_id, 'fnb');
  insert into public.invoice_items(
    id, invoice_id, product_id, product_name, unit, quantity,
    unit_price, discount, vat_rate, vat_amount, total
  ) values (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002', v_sku_id,
    'Old FNB invoice', 'ly', 1, 0, 0, 0, 0, 0
  );
  v_return_id := '60000000-0000-0000-0000-000000000003';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, '10000000-0000-0000-0000-000000000002', v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, '50000000-0000-0000-0000-000000000002', v_sku_id, 1);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    '50000000-0000-0000-0000-000000000002', v_tenant_id, v_branch_id,
    v_sku_id, 1, v_return_id, null, 'RT-OLD', null
  );
  if v_result->>'snapshot_mode' is distinct from 'legacy_active_bom' then
    raise exception 'historical invoice fallback was not labelled: %', v_result;
  end if;
end;
$$;

