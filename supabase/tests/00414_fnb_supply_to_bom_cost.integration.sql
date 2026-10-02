-- Test price handoff, weighted branch cost, BOM consumption and restoration.
-- This fixture has no Retail source-stock RPC, POS UI, cash or invoice tables.
\set ON_ERROR_STOP on

do $$
declare
  v_tenant constant uuid := '10000000-0000-0000-0000-000000000001';
  v_retail constant uuid := '20000000-0000-0000-0000-000000000001';
  v_xtb constant uuid := '20000000-0000-0000-0000-000000000002';
  v_sku constant uuid := '30000000-0000-0000-0000-000000000001';
  v_actor constant uuid := '40000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_unit numeric;
  v_balance public.fnb_branch_product_cost_balances%rowtype;
  v_failed boolean := false;
begin
  insert into public.fnb_supply_branch_scopes values (v_tenant, v_xtb, true);

  -- Retail's 6,000 cost is intentionally not an input: the F&B receipt uses
  -- the internal selling price, first 10,000 then 13,000 for the same SKU.
  v_result := public.create_internal_sale_atomic(
    v_tenant, v_retail, v_xtb, v_actor, null, 'XTB', null, 'Retail',
    jsonb_build_array(jsonb_build_object(
      'productId', v_sku, 'quantity', 2, 'unitPrice', 10000
    )), 'debt', false, 'isolated test'
  );
  if (select count(*) from public.fnb_branch_product_cost_events
       where source_type = 'internal_sale_receipt'
         and source_reference_id = (v_result->>'internal_sale_id')::uuid
         and quantity = 2 and unit_cost = 10000 and total_cost = 20000) <> 1 then
    raise exception 'first internal sale did not carry its commercial price to XTB';
  end if;

  perform public.create_internal_sale_atomic(
    v_tenant, v_retail, v_xtb, v_actor, null, 'XTB', null, 'Retail',
    jsonb_build_array(jsonb_build_object(
      'productId', v_sku, 'quantity', 1, 'unitPrice', 13000
    )), 'debt', false, 'isolated test'
  );
  select * into v_balance from public.fnb_branch_product_cost_balances
   where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_sku;
  if v_balance.costed_quantity <> 3 or v_balance.total_cost <> 33000
     or v_balance.unit_cost <> 11000 then
    raise exception 'weighted XTB receipt cost mismatch: %', row_to_json(v_balance);
  end if;

  v_unit := public._post_fnb_branch_cost_out_00390(
    v_tenant, v_xtb, v_sku, 0.5, 'bom_consume', 'bom_consume',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', null, v_actor
  );
  if v_unit <> 11000
     or (select total_cost from public.fnb_branch_product_cost_events
          where source_stock_movement_id = '60000000-0000-0000-0000-000000000001') <> 5500 then
    raise exception 'BOM consumed another cost than the XTB weighted receipt';
  end if;
  perform public._post_fnb_branch_cost_in_00390(
    v_tenant, v_xtb, v_sku, 0.5, v_unit, 'invoice_void_restore', 'invoice',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002', null, v_actor
  );
  select * into v_balance from public.fnb_branch_product_cost_balances
   where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_sku;
  if v_balance.costed_quantity <> 3 or v_balance.total_cost <> 33000
     or v_balance.unit_cost <> 11000 then
    raise exception 'BOM void did not restore original XTB cost: %', row_to_json(v_balance);
  end if;

  -- A second call for the same stock movement must not double-consume.
  v_unit := public._post_fnb_branch_cost_out_00390(
    v_tenant, v_xtb, v_sku, 0.5, 'bom_consume', 'bom_consume',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', null, v_actor
  );
  if v_unit <> 11000
     or (select costed_quantity from public.fnb_branch_product_cost_balances
          where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_sku) <> 3 then
    raise exception 'BOM retry consumed stock twice';
  end if;

  begin
    perform public._post_fnb_branch_cost_out_00390(
      v_tenant, v_xtb, v_sku, 4, 'bom_consume', 'bom_consume',
      '50000000-0000-0000-0000-000000000002', null, null, v_actor
    );
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FNB_BRANCH_COST_REQUIRED' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'oversized BOM must be rejected'; end if;
  if (select costed_quantity from public.fnb_branch_product_cost_balances
       where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_sku) <> 3 then
    raise exception 'failed BOM changed XTB balance';
  end if;
end;
$$;

-- A two-ingredient bill must either cost both lines or leave both untouched.
do $$
declare
  v_tenant constant uuid := '10000000-0000-0000-0000-000000000001';
  v_retail constant uuid := '20000000-0000-0000-0000-000000000001';
  v_xtb constant uuid := '20000000-0000-0000-0000-000000000002';
  v_first constant uuid := '30000000-0000-0000-0000-000000000001';
  v_second constant uuid := '30000000-0000-0000-0000-000000000003';
  v_actor constant uuid := '40000000-0000-0000-0000-000000000001';
  v_invoice constant uuid := '50000000-0000-0000-0000-000000000003';
  v_failed boolean := false;
begin
  perform public.create_internal_sale_atomic(
    v_tenant, v_retail, v_xtb, v_actor, null, 'XTB', null, 'Retail',
    jsonb_build_array(jsonb_build_object(
      'productId', v_second, 'quantity', 2, 'unitPrice', 8000
    )), 'debt', false, 'isolated second ingredient'
  );
  if (select costed_quantity from public.fnb_branch_product_cost_balances
       where branch_id = v_xtb and product_id = v_second) <> 2 then
    raise exception 'Second ingredient did not receive XTB cost';
  end if;

  begin
    perform public._post_fnb_branch_cost_out_00390(
      v_tenant, v_xtb, v_first, 0.5, 'bom_consume', 'bom_consume',
      v_invoice, '60000000-0000-0000-0000-000000000003', null, v_actor
    );
    perform public._post_fnb_branch_cost_out_00390(
      v_tenant, v_xtb, v_second, 3, 'bom_consume', 'bom_consume',
      v_invoice, '60000000-0000-0000-0000-000000000004', null, v_actor
    );
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FNB_BRANCH_COST_REQUIRED' then raise; end if;
    v_failed := true;
  end;
  if not v_failed
     or (select costed_quantity from public.fnb_branch_product_cost_balances
          where branch_id = v_xtb and product_id = v_first) <> 3
     or (select costed_quantity from public.fnb_branch_product_cost_balances
          where branch_id = v_xtb and product_id = v_second) <> 2
     or exists (select 1 from public.fnb_branch_product_cost_events
          where source_stock_movement_id in (
            '60000000-0000-0000-0000-000000000003',
            '60000000-0000-0000-0000-000000000004'
          )) then
    raise exception 'Failed two-ingredient BOM did not roll back both cost lines';
  end if;

  perform public._post_fnb_branch_cost_out_00390(
    v_tenant, v_xtb, v_first, 0.5, 'bom_consume', 'bom_consume',
    v_invoice, '60000000-0000-0000-0000-000000000005', null, v_actor
  );
  perform public._post_fnb_branch_cost_out_00390(
    v_tenant, v_xtb, v_second, 0.25, 'bom_consume', 'bom_consume',
    v_invoice, '60000000-0000-0000-0000-000000000006', null, v_actor
  );
  if (select sum(total_cost) from public.fnb_branch_product_cost_events
       where source_reference_id = v_invoice and source_type = 'bom_consume') <> 7500 then
    raise exception 'Two-ingredient BOM cost must be 5,500 + 2,000';
  end if;

  perform public._post_fnb_branch_cost_in_00390(
    v_tenant, v_xtb, v_first, 0.5, 11000, 'invoice_void_restore', 'invoice',
    v_invoice, '60000000-0000-0000-0000-000000000007', null, v_actor
  );
  perform public._post_fnb_branch_cost_in_00390(
    v_tenant, v_xtb, v_second, 0.25, 8000, 'invoice_void_restore', 'invoice',
    v_invoice, '60000000-0000-0000-0000-000000000008', null, v_actor
  );
  if (select costed_quantity from public.fnb_branch_product_cost_balances
       where branch_id = v_xtb and product_id = v_first) <> 3
     or (select total_cost from public.fnb_branch_product_cost_balances
       where branch_id = v_xtb and product_id = v_first) <> 33000
     or (select costed_quantity from public.fnb_branch_product_cost_balances
       where branch_id = v_xtb and product_id = v_second) <> 2
     or (select total_cost from public.fnb_branch_product_cost_balances
       where branch_id = v_xtb and product_id = v_second) <> 16000
     or exists (select 1 from public.fnb_branch_product_cost_events
       where branch_id = v_retail) then
    raise exception 'Two-ingredient void did not restore XTB or touched Retail';
  end if;
end;
$$;

select '00414 isolated supply-to-BOM cost flow passed' as result;
