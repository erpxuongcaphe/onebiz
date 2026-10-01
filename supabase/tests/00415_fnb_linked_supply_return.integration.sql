-- One disposable chain: internal selling price -> XTB cost -> invoice BOM -> return.
\set ON_ERROR_STOP on

do $$
declare
  v_tenant constant uuid := '20000000-0000-0000-0000-000000000001';
  v_xtb constant uuid := '30000000-0000-0000-0000-000000000001';
  v_retail constant uuid := '30000000-0000-0000-0000-000000000099';
  v_material constant uuid := '40000000-0000-0000-0000-000000000015';
  v_menu constant uuid := '40000000-0000-0000-0000-000000000016';
  v_invoice constant uuid := '10000000-0000-0000-0000-000000000015';
  v_line constant uuid := '50000000-0000-0000-0000-000000000015';
  v_return constant uuid := '60000000-0000-0000-0000-000000000015';
  v_result jsonb;
  v_cost numeric;
  v_balance public.fnb_branch_product_cost_balances%rowtype;
begin
  insert into public.products(id) values (v_material), (v_menu);

  -- Retail cost is deliberately absent. Only the document selling prices
  -- (10,000 and 13,000) may enter XTB's weighted cost ledger.
  v_result := public.create_internal_sale_atomic(
    v_tenant, v_retail, v_xtb, null, null, 'XTB', null, 'Retail',
    jsonb_build_array(jsonb_build_object(
      'productId', v_material, 'quantity', 2, 'unitPrice', 10000
    )), 'debt', false, 'linked isolated test'
  );
  if (select count(*) from public.fnb_branch_product_cost_events
      where source_type = 'internal_sale_receipt'
        and source_reference_id = (v_result->>'internal_sale_id')::uuid
        and quantity = 2 and unit_cost = 10000 and total_cost = 20000) <> 1 then
    raise exception 'internal sale did not post its selling price to XTB';
  end if;
  perform public.create_internal_sale_atomic(
    v_tenant, v_retail, v_xtb, null, null, 'XTB', null, 'Retail',
    jsonb_build_array(jsonb_build_object(
      'productId', v_material, 'quantity', 1, 'unitPrice', 13000
    )), 'debt', false, 'linked isolated test'
  );
  select * into v_balance from public.fnb_branch_product_cost_balances
   where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_material;
  if v_balance.costed_quantity <> 3 or v_balance.total_cost <> 33000
     or v_balance.unit_cost <> 11000 then
    raise exception 'XTB weighted cost did not use the two selling prices: %', row_to_json(v_balance);
  end if;

  insert into public.invoices(id, tenant_id, branch_id, source)
  values (v_invoice, v_tenant, v_xtb, 'fnb');
  insert into public.invoice_items(
    id, invoice_id, product_id, product_name, unit, quantity,
    unit_price, discount, vat_rate, vat_amount, total
  ) values (
    v_line, v_invoice, v_menu, 'Linked test drink', 'ly', 1,
    20000, 0, 0, 0, 20000
  );
  v_cost := public._post_fnb_branch_cost_out_00390(
    v_tenant, v_xtb, v_material, 0.5, 'bom_consume', 'bom_consume',
    v_invoice, null, null, null
  );
  if v_cost <> 11000 or (select total_cost from public.fnb_branch_product_cost_events
       where source_type = 'bom_consume' and source_reference_id = v_invoice) <> 5500 then
    raise exception 'invoice BOM did not consume the branch weighted cost';
  end if;
  perform public._capture_fnb_invoice_item_bom_snapshot_00410(
    v_line, v_invoice, jsonb_build_object(
      'success', true,
      'bom_id', '00000000-0000-0000-0000-000000000015',
      'consumed', jsonb_build_array(jsonb_build_object(
        'material_id', v_material, 'qty', 0.5, 'unit', 'G'
      ))
    )
  );

  insert into public.sales_returns(id, invoice_id, tenant_id, branch_id, status)
  values (v_return, v_invoice, v_tenant, v_xtb, 'completed');
  insert into public.return_items(return_id, invoice_item_id, product_id, quantity)
  values (v_return, v_line, v_menu, 1);
  v_result := public._restore_fnb_invoice_item_bom_00410(
    v_line, v_tenant, v_xtb, v_menu, 1, v_return, null, 'TEST-RETURN', null
  );
  if v_result->>'snapshot_mode' is distinct from 'invoice_item'
     or (select quantity from public.stock_movements
          where reference_type = 'return_bom_restore' and reference_id = v_return) <> 0.5
     or (select total_cost from public.fnb_branch_product_cost_events
          where source_type = 'return_bom_restore' and source_reference_id = v_return) <> 5500 then
    raise exception 'return did not restore the invoice BOM quantity and original cost: %', v_result;
  end if;
  select * into v_balance from public.fnb_branch_product_cost_balances
   where tenant_id = v_tenant and branch_id = v_xtb and product_id = v_material;
  if v_balance.costed_quantity <> 3 or v_balance.total_cost <> 33000
     or v_balance.unit_cost <> 11000 then
    raise exception 'return did not restore the XTB balance: %', row_to_json(v_balance);
  end if;
  if exists (select 1 from public.fnb_branch_product_cost_events
              where branch_id = v_retail and product_id = v_material) then
    raise exception 'linked test posted an F&B cost event into Retail';
  end if;
end;
$$;

select '00415 isolated linked supply-to-return flow passed' as result;
