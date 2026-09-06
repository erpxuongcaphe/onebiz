do $test$
declare
  tenant uuid := gen_random_uuid(); branch uuid := gen_random_uuid(); warehouse uuid := gen_random_uuid();
  sku uuid := gen_random_uuid(); sugar uuid := gen_random_uuid(); coffee uuid := gen_random_uuid();
  size_m uuid := gen_random_uuid(); size_l uuid := gen_random_uuid();
  bom_m uuid := gen_random_uuid(); bom_l uuid := gen_random_uuid(); override_bom uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); opt uuid;
  options uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  amounts_m numeric[] := array[0,.0028,.006,.007];
  amounts_l numeric[] := array[0,.0042,.009,.0105];
  variant uuid; recipe uuid; invoice uuid; payload jsonb; result jsonb;
  expected_sugar numeric; expected_coffee numeric; before_sugar numeric; before_coffee numeric;
  before_moves bigint; before_alloc numeric; before_global numeric; i integer; j integer;
begin
  insert into products(id,tenant_id,code,name,stock) values
    (sku,tenant,'TEST-DRINK','Synthetic drink',0),
    (sugar,tenant,'TEST-SUGAR','Synthetic sugar',200),
    (coffee,tenant,'TEST-COFFEE','Synthetic coffee',200);
  insert into product_variants values(size_m,sku,tenant,'TEST-M'),(size_l,sku,tenant,'TEST-L');
  insert into bom(id,tenant_id,product_id,code,name) values
    (bom_m,tenant,sku,'TEST-M','Synthetic M'),(bom_l,tenant,sku,'TEST-L','Synthetic L');
  insert into bom_items(bom_id,material_id,unit,quantity,modifier_scale_target,sort_order) values
    (bom_m,coffee,'Kg',.016,null,0),(bom_m,sugar,'Kg',.006,grp,1),
    (bom_l,coffee,'Kg',.0229,null,0),(bom_l,sugar,'Kg',.009,grp,1);
  for i in 1..4 loop
    insert into modifier_options values(options[i],grp);
    insert into bom_modifier_option_quantities values
      (bom_m,sugar,options[i],amounts_m[i]),(bom_l,sugar,options[i],amounts_l[i]);
  end loop;
  insert into branch_stock(tenant_id,branch_id,product_id,quantity)
    select tenant,b,p,100 from unnest(array[branch,warehouse]) b cross join unnest(array[sugar,coffee]) p;
  insert into product_lots(tenant_id,branch_id,product_id,lot_number,current_qty)
    select tenant,b,p,'TEST-LOT',100 from unnest(array[branch,warehouse]) b cross join unnest(array[sugar,coffee]) p;

  for j in 1..2 loop
    variant := case when j=1 then size_m else size_l end;
    recipe := case when j=1 then bom_m else bom_l end;
    expected_coffee := case when j=1 then .016 else .0229 end;
    for i in 1..4 loop
      expected_sugar := case when j=1 then amounts_m[i] else amounts_l[i] end;
      invoice := gen_random_uuid();
      -- Deliberately misleading label and factor: exact quantity must win.
      payload := jsonb_build_array(jsonb_build_object('groupId',grp,'groupName','Custom sweetness',
        'options',jsonb_build_array(jsonb_build_object('optionId',options[i],'label','Arbitrary label','scaleFactor',99))));
      select quantity into before_sugar from branch_stock where branch_id=branch and product_id=sugar;
      select quantity into before_coffee from branch_stock where branch_id=branch and product_id=coffee;
      result := consume_bom_for_sale(tenant,branch,sku,2,invoice,null,'TEST',payload,false,variant);
      perform test_assert((result->>'bom_id')::uuid=recipe,format('size %s option %s uses correct BOM',j,i));
      perform test_assert((select quantity=before_sugar-expected_sugar*2 from branch_stock where branch_id=branch and product_id=sugar), 'exact sugar x two cups');
      perform test_assert((select quantity=before_coffee-expected_coffee*2 from branch_stock where branch_id=branch and product_id=coffee), 'coffee matches selected size');
      perform test_assert((select coalesce(sum(quantity),0)=expected_sugar*2 from stock_movements where reference_id=invoice and product_id=sugar), 'sugar ledger exact, including zero');
      perform test_assert((select coalesce(sum(a.quantity),0)=expected_sugar*2 from lot_allocations a join product_lots l on l.id=a.lot_id where a.source_id=invoice and l.product_id=sugar),'FIFO sugar matches ledger');
      perform test_assert((select coalesce(sum(a.quantity),0)=expected_coffee*2 from lot_allocations a join product_lots l on l.id=a.lot_id where a.source_id=invoice and l.product_id=coffee),'FIFO coffee matches ledger');
    end loop;
  end loop;
  perform test_assert((select bool_and(quantity=100) from branch_stock where branch_id=warehouse),'other warehouse stock untouched');
  perform test_assert((select bool_and(current_qty=100) from product_lots where branch_id=warehouse),'other warehouse lots untouched');
  perform test_assert(not exists(select 1 from stock_movements where branch_id=warehouse),'no ledger entries in other warehouse');
  perform test_assert(not exists(select 1 from products p where p.id in(sugar,coffee) and p.stock<>(select sum(quantity) from branch_stock b where b.product_id=p.id)),'global stock equals branch totals');

  select quantity into before_coffee from branch_stock where branch_id=branch and product_id=coffee;
  select stock into before_global from products where id=coffee;
  select count(*) into before_moves from stock_movements;
  select sum(quantity) into before_alloc from lot_allocations;
  begin
    perform consume_bom_for_sale(tenant,branch,sku,1,gen_random_uuid(),null,'MISSING',null,false,size_m);
    raise exception 'Expected missing-selection rejection';
  exception when others then
    if sqlerrm <> 'FNB_EXACT_RECIPE_SELECTION_REQUIRED' then raise; end if;
  end;
  perform test_assert((select quantity=before_coffee from branch_stock where branch_id=branch and product_id=coffee),'missing selection rolls back earlier material');
  update branch_stock set quantity=0 where branch_id=branch and product_id=sugar;
  begin
    perform consume_bom_for_sale(tenant,branch,sku,1,gen_random_uuid(),null,'SHORT',payload,false,size_m);
    raise exception 'Expected insufficient-stock rejection';
  exception when others then
    if sqlerrm not like 'NVL_INSUFFICIENT:%' then raise; end if;
  end;
  perform test_assert((select quantity=before_coffee from branch_stock where branch_id=branch and product_id=coffee),'insufficient sugar rolls back earlier coffee');
  perform test_assert((select stock=before_global from products where id=coffee),'failed sale preserves global coffee stock');
  perform test_assert((select count(*)=before_moves from stock_movements),'failed sale leaves no partial ledger');
  perform test_assert((select sum(quantity)=before_alloc from lot_allocations),'failed sale leaves no partial FIFO allocation');

  insert into bom(id,tenant_id,product_id,branch_id,code,name) values(override_bom,tenant,sku,branch,'TEST-L','Branch L');
  perform test_assert(get_active_bom_for_branch(sku,branch,size_l)=override_bom,'branch recipe overrides global recipe');
  perform test_assert(get_active_bom_for_branch(sku,warehouse,size_l)=bom_l,'other branch retains global recipe');
  raise notice 'COMPLETE: isolated BOM/stock contract suite; checkout, RLS and refunds NOT covered.';
end;
$test$;
