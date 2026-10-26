"""Real PostgreSQL: manual correction must yield to an active stock transaction."""
import subprocess
import time

tenant, branch, actor, product, check, lot = [f"80000000-0000-0000-0000-{n:012}" for n in range(1, 7)]

def psql(sql, check_result=True):
    return subprocess.run(["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True, check=check_result)

psql(f"""
insert into tenants values('{tenant}');insert into branches values('{branch}','{tenant}');
insert into profiles(id,tenant_id,role) values('{actor}','{tenant}','owner');
insert into products(id,tenant_id,code,name,stock,unit,cost_price) values('{product}','{tenant}','CONCURRENT','Busy count',10,'G',100);
insert into branch_stock(tenant_id,branch_id,product_id,quantity) values('{tenant}','{branch}','{product}',10);
insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost) values('{tenant}','{branch}','{product}',10,1000,100);
insert into product_lots(id,tenant_id,branch_id,product_id,current_qty,initial_qty,status) values('{lot}','{tenant}','{branch}','{product}',10,10,'active');
insert into inventory_checks(id,tenant_id,branch_id,code,status,note) values('{check}','{tenant}','{branch}','KK-CONCURRENT','balanced','');
insert into inventory_check_items(check_id,product_id,product_name,system_stock,actual_stock) values('{check}','{product}','Busy count',10,10);
""")

preview = f"""set test.actor='{actor}';
select preview_inventory_check_change('{check}','edit','[{{"productId":"{product}","actualStock":12}}]'::jsonb,
'','Recount while selling',get_inventory_check_change_source('{check}')->>'version',gen_random_uuid())->>'canApply';"""

for table, predicate in [
    ("inventory_checks", f"id='{check}'"),
    ("products", f"id='{product}'"),
    ("branch_stock", f"product_id='{product}'"),
    ("fnb_branch_product_cost_balances", f"product_id='{product}'"),
    ("product_lots", f"id='{lot}'"),
]:
    held = subprocess.Popen(["psql", "-XqAt", "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    held.stdin.write(f"begin;select 1 from {table} where {predicate} for update;select 'LOCKED';select pg_sleep(2);rollback;\n")
    held.stdin.flush()
    while True:
        line = held.stdout.readline()
        if line.strip() == "LOCKED":
            break
        if not line:
            raise AssertionError(held.stderr.read())
    started = time.monotonic()
    result = psql(preview, False)
    elapsed = time.monotonic() - started
    assert result.returncode != 0, f"{table}: busy preview must not proceed"
    assert "could not obtain lock" in result.stderr or "lock timeout" in result.stderr, result.stderr
    assert elapsed < 1.5, f"{table}: manual correction waited {elapsed}s"
    assert held.poll() is None, f"{table}: active transaction was interrupted"
    held.stdin.close()
    held.wait(timeout=5)
    assert held.returncode == 0, held.stderr.read()
    print(f"PASS {table}: count correction yielded in {elapsed:.3f}s; active transaction continued")

assert psql(preview).stdout.strip().endswith("true")
assert psql(f"select quantity from branch_stock where branch_id='{branch}' and product_id='{product}'").stdout.strip() == "10"
assert psql(f"select count(*) from inventory_check_changes where check_id='{check}'").stdout.strip() == "0"
print("PASS preview works after release and all stock/history stays unchanged")
