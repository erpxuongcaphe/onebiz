do $test$
declare
  tenant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  cashier uuid := gen_random_uuid();
  other_cashier uuid := gen_random_uuid();
  shift_id uuid;
  other_shift_id uuid;
  result jsonb;
begin
  insert into branches(id, tenant_id) values (branch, tenant), (other_branch, tenant);
  insert into test_actor_context(actor_id, tenant_id, branch_id) values
    (cashier, tenant, branch),
    (other_cashier, tenant, branch);
  perform test_set_actor(cashier);

  result := open_shift_atomic(branch, 500000);
  shift_id := (result->>'id')::uuid;
  perform test_assert((result->>'already_open')::boolean = false, 'first shift opening creates a shift');
  perform test_assert((select count(*) = 1 from shifts where id = shift_id), 'created shift is persisted once');

  result := open_shift_atomic(branch, 999999);
  perform test_assert((result->>'id')::uuid = shift_id, 'repeated opening returns same shift');
  perform test_assert((result->>'already_open')::boolean = true, 'repeated opening is marked idempotent');
  perform test_assert((select starting_cash = 500000 from shifts where id = shift_id), 'retry cannot replace starting cash');

  begin
    perform open_shift_atomic(branch, -1);
    raise exception 'FAIL: negative starting cash was accepted';
  exception when sqlstate '22023' then
    perform test_assert(sqlerrm = 'SHIFT_STARTING_CASH_INVALID', 'negative starting cash is rejected');
  end;

  begin
    perform open_shift_atomic(other_branch, 0);
    raise exception 'FAIL: inaccessible branch was accepted';
  exception when sqlstate '42501' then
    perform test_assert(sqlerrm = 'SHIFT_BRANCH_DENIED', 'branch access is enforced');
  end;

  insert into cash_transactions(tenant_id, branch_id, shift_id, type, amount, payment_method, status, reference_type) values
    (tenant, branch, shift_id, 'receipt', 100000, 'cash', 'completed', 'invoice'),
    (tenant, branch, shift_id, 'receipt', 50000, 'transfer', 'completed', 'invoice'),
    (tenant, branch, shift_id, 'payment', 20000, 'cash', 'completed', 'invoice'),
    (tenant, branch, shift_id, 'receipt', 999999, 'cash', 'cancelled', 'invoice'),
    (tenant, branch, shift_id, 'receipt', 12345, 'cash', 'completed', 'opening_balance');
  insert into invoices(shift_id, status) values
    (shift_id, 'completed'), (shift_id, 'completed'), (shift_id, 'cancelled');

  result := close_shift_atomic(shift_id, 592345, 'Synthetic acceptance');
  perform test_assert((result->>'expected_cash')::numeric = 592345, 'expected cash uses all completed cash movements');
  perform test_assert((result->>'cash_difference')::numeric = 0, 'balanced close has zero variance');
  perform test_assert((result->>'total_sales')::numeric = 130000, 'net invoice sales include cash and transfer');
  perform test_assert((result->>'total_orders')::integer = 2, 'only completed invoices are counted');
  perform test_assert((result->'sales_by_method'->>'cash')::numeric = 80000, 'cash sales subtract invoice refunds');
  perform test_assert((result->'sales_by_method'->>'transfer')::numeric = 50000, 'transfer sales are separated');
  perform test_assert(not (result->'sales_by_method' ? 'opening_balance'), 'non-sale cash is excluded from sales summary');

  begin
    perform close_shift_atomic(shift_id, 592345, null);
    raise exception 'FAIL: closed shift was closed twice';
  exception when sqlstate '40001' then
    perform test_assert(sqlerrm = 'SHIFT_NOT_OPEN', 'closed shift cannot be closed again');
  end;

  perform test_set_actor(cashier);
  other_shift_id := (open_shift_atomic(branch, 0)->>'id')::uuid;
  update shifts set cashier_id = other_cashier where id = other_shift_id;
  perform test_set_actor(cashier);
  begin
    perform close_shift_atomic(other_shift_id, 0, null);
    raise exception 'FAIL: cashier closed another cashier shift';
  exception when sqlstate '42501' then
    perform test_assert(sqlerrm = 'SHIFT_CLOSE_DENIED', 'explicit permission is required to close another shift');
  end;

  raise notice 'COMPLETE: isolated FNB shift lifecycle contract suite.';
end;
$test$;
