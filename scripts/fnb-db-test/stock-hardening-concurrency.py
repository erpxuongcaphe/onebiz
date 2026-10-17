"""Disposable PostgreSQL only. Real concurrent sessions; never runs against Supabase."""
import concurrent.futures, json, os, subprocess, time
from decimal import Decimal
if os.environ.get("PGDATABASE") != "fnb_hardening_test":
    raise SystemExit("PGDATABASE must be the disposable fnb_hardening_test")
def sql(query):
    return subprocess.run(["psql","-X","-v","ON_ERROR_STOP=1","-At","-c",query],text=True,capture_output=True,check=True).stdout.strip()
actor="00000000-0000-0000-0000-000000000001"
def pay(order):
    start=time.monotonic()
    result=sql(f"begin; select set_config('test.actor','{actor}',true); select test_pay('{order}'); select pg_sleep(0.1); commit;")
    return {"order":order,"ms":round((time.monotonic()-start)*1000),"ok":bool(result)}
# Force overlap inside product updates; checkout must serialize only affected rows.
sql("create function test_slow_product() returns trigger language plpgsql as $$ begin perform pg_sleep(0.02);return new;end $$;create trigger test_slow before update on products for each row execute function test_slow_product()")
def raw_quantity():
    return Decimal(sql("select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011'"))
out=[]
for batch,count in [(1,2),(2,5)]:
    orders=[f"00000000-0000-0000-{batch:04d}-{i:012d}" for i in range(1,count+1)]
    for order in orders: sql(f"select test_new_order('{order}')")
    quantity_before=raw_quantity()
    before=int(sql("select count(*) from invoices"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        results=list(pool.map(pay,orders))
    assert int(sql("select count(*) from invoices"))==before+count
    assert raw_quantity()==quantity_before-Decimal("0.06")*count,"BOM raw quantity mismatch"
    state=sql("select jsonb_build_object('stock',(select jsonb_agg(b order by product_id) from branch_stock b),'cash',(select count(*) from cash_transactions),'cost',(select count(*) from fnb_branch_product_cost_events),'movements',(select count(*) from stock_movements))")
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        list(pool.map(pay,orders))
    assert sql("select jsonb_build_object('stock',(select jsonb_agg(b order by product_id) from branch_stock b),'cash',(select count(*) from cash_transactions),'cost',(select count(*) from fnb_branch_product_cost_events),'movements',(select count(*) from stock_movements))")==state,"Concurrent replay changed money/stock"
    out.append({"clients":count,"results":results})
# Same order, different sessions: exactly one invoice.
order="00000000-0000-0000-0003-000000000001"
sql(f"select test_new_order('{order}')")
before=int(sql("select count(*) from invoices"))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(pay,[order,order]))
assert int(sql("select count(*) from invoices"))==before+1
assert sql("select count(*) from (select p.id from products p left join branch_stock b on b.product_id=p.id group by p.id,p.stock having p.stock<>coalesce(sum(b.quantity),0)) q")=="0"
print(json.dumps({"status":"PASS","parallelBatches":out,"sameOrderReplay":"PASS","globalVsBranch":"PASS"}))


