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

  -- Two invoice lines may share a SKU but carry different size-specific BOMs.
  insert into public.invoice_items(
    id, invoice_id, product_id, product_name, unit, quantity,
    unit_price, discount, vat_rate, vat_amount, total
  ) values (
    '50000000-0000-0000-0000-000000000003', v_invoice_id, v_sku_id,
    'Thach Suong Sao Size L', 'ly', 2, 0, 0, 0, 0, 0
  );

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
          where invoice_item_id = v_invoice_item_id) is distinct from 4.5 then
    raise exception 'snapshot did not preserve recipe quantity or included topping consumption';
  end if;

  perform public._capture_fnb_invoice_item_bom_snapshot_00410(
    '50000000-0000-0000-0000-000000000003', v_invoice_id,
    jsonb_build_object(
      'success', true,
      'bom_id', '00000000-0000-0000-0000-000000000002',
      'consumed', jsonb_build_array(
        jsonb_build_object('material_id', v_material_id, 'qty', 10, 'unit', 'G')
      )
    )
  );
  if (select sum(quantity) from public.fnb_invoice_item_bom_snapshot_components_00410
       where invoice_item_id = '50000000-0000-0000-0000-000000000003') is distinct from 10 then
    raise exception 'same-SKU invoice lines did not retain independent BOM snapshots';
  end if;

  v_return_id := '60000000-0000-0000-0000-000000000004';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, v_invoice_id, v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, '50000000-0000-0000-0000-000000000003', v_sku_id, 1);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    '50000000-0000-0000-0000-000000000003', v_tenant_id, v_branch_id, v_sku_id, 1,
    v_return_id, null, 'RT-SIZE-L', null
  );
  if v_result->>'snapshot_mode' is distinct from 'invoice_item'
     or (select sum(quantity) from public.stock_movements
          where reference_type = 'return_bom_restore' and reference_id = v_return_id) is distinct from 5 then
    raise exception 'return used another same-SKU invoice line BOM snapshot: %', v_result;
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
          where reference_type = 'return_bom_restore' and reference_id = v_return_id) is distinct from 1.5 then
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
  if v_result->>'snapshot_mode' is distinct from 'invoice_item'
     or v_total_restored is distinct from 4.5 then
    raise exception 'full partial-return sequence did not exactly restore source BOM quantity: %', v_total_restored;
  end if;

  -- A repeated/over-quantity return must fail before adding another movement.
  v_return_id := '60000000-0000-0000-0000-000000000005';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, v_invoice_id, v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, v_invoice_item_id, v_sku_id, 1);
  begin
    perform public._restore_fnb_invoice_item_bom_00410(
      v_invoice_item_id, v_tenant_id, v_branch_id, v_sku_id, 1,
      v_return_id, null, 'RT-DUPLICATE', null
    );
    raise exception using errcode = 'P0001', message = 'duplicate return should have been rejected';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FNB_RETURN_BOM_QUANTITY_EXCEEDED' then
      raise;
    end if;
  end;
  if exists (
    select 1 from public.stock_movements
     where reference_type = 'return_bom_restore' and reference_id = v_return_id
  ) then
    raise exception 'duplicate return created a stock movement';
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

  -- Retail sales keep delegating to the old restore routine and never receive F&B snapshots.
  insert into public.invoices(id, tenant_id, branch_id, source)
  values ('10000000-0000-0000-0000-000000000003', v_tenant_id, v_branch_id, 'retail');
  insert into public.invoice_items(
    id, invoice_id, product_id, product_name, unit, quantity,
    unit_price, discount, vat_rate, vat_amount, total
  ) values (
    '50000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000003', v_sku_id,
    'Retail item', 'cai', 1, 100, 0, 0, 0, 100
  );
  v_return_id := '60000000-0000-0000-0000-000000000006';
  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return_id, '10000000-0000-0000-0000-000000000003', v_tenant_id, v_branch_id, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return_id, '50000000-0000-0000-0000-000000000004', v_sku_id, 1);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    '50000000-0000-0000-0000-000000000004', v_tenant_id, v_branch_id,
    v_sku_id, 1, v_return_id, null, 'RT-RETAIL', null
  );
  if v_result->>'legacy_restore_called' is distinct from 'true'
     or exists (
       select 1 from public.fnb_invoice_item_bom_snapshots_00410
        where invoice_item_id = '50000000-0000-0000-0000-000000000004'
     ) then
    raise exception 'Retail return did not remain on its original restore path: %', v_result;
  end if;
end;
$$;
