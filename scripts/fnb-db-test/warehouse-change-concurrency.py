"""Real multi-session PostgreSQL tests; only the named disposable local CI DB."""
import os, subprocess, time
if os.environ.get('PGDATABASE') != 'onebiz_warehouse_change_test' or os.environ.get('PGHOST') not in ('localhost','127.0.0.1'):
    raise SystemExit('Dedicated local ephemeral PostgreSQL database required')
def uid(n): return f'00000000-0000-0000-0000-{n:012}'
tenant,actor,store,warehouse,supplier,customer,product=[uid(n) for n in range(1,8)]
prefix=f"set test.actor='{actor}';set test.branch='{store}';"
def process(sql):
    return subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
def run(sql,ok=True):
    p=process(sql);out,err=p.communicate(prefix+sql,timeout=20)
    if ok and p.returncode: raise AssertionError(err)
    return p.returncode,out.strip(),err
def fresh(n):
    import json
    _,out,_=run(f"select submit_fnb_warehouse_order('{store}','{warehouse}','{uid(n)}','[{{\"productId\":\"{product}\",\"quantity\":2}}]','Giao sáng');")
    return json.loads(out.splitlines()[-1])
def edit(po,key,action='edit'):
    return f"select change_fnb_warehouse_order('{po}',0,'{uid(key)}','{action}','[{{\"productId\":\"{product}\",\"quantity\":3}}]','Ghi chú mới','Đổi nhu cầu');"
def launch(sql,name=''):
    p=process(sql);p.stdin.write(prefix+(f"set application_name='{name}';" if name else '')+sql);p.stdin.close();return p
def wait_holding(name):
    until=time.monotonic()+10
    while time.monotonic()<until:
        if run(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event='PgSleep';")[1]=='1': return
        time.sleep(.02)
    raise AssertionError('Did not observe lock holder: '+name)
def finish(p):
    p.wait(timeout=20);return p.returncode,p.stdout.read(),p.stderr.read()
# First editor owns the parent until commit; the other editor cannot overwrite it.
p=fresh(20001);po=p['purchaseOrderId'];so=p['salesOrderId']
a=launch(f"begin;select id from invoices where id='{so}' for update;select pg_sleep(2);"+edit(po,20002)+"commit;",'warehouse_race_a')
wait_holding('warehouse_race_a');b=launch(edit(po,20003));ra,rb=finish(a),finish(b)
assert ra[0]==0 and rb[0]!=0 and 'vừa được thay đổi' in rb[2],(ra,rb)
assert run(f"select revision from fnb_purchase_sales_order_links where purchase_order_id='{po}';")[1]=='1'
print('PASS concurrent editors: one commit, stale editor rejected')
# Actual child creation holds FOR SHARE; edit waits and then sees the child draft.
p=fresh(20004);po=p['purchaseOrderId'];so=p['salesOrderId']
a=launch(f"begin;set test.branch='{warehouse}';select create_child_sale_from_order('{so}');select pg_sleep(2);commit;",'warehouse_race_b')
wait_holding('warehouse_race_b');b=launch(edit(po,20005));ra,rb=finish(a),finish(b)
assert ra[0]==0 and rb[0]!=0 and 'đang mở' in rb[2],(ra,rb)
assert run(f"select revision from fnb_purchase_sales_order_links where purchase_order_id='{po}';")[1]=='0'
print('PASS actual warehouse child vs edit: no stale draft is overwritten')
# Cancellation locks parent first; a warehouse opener waits then sees cancelled.
p=fresh(20006);po=p['purchaseOrderId'];so=p['salesOrderId']
a=launch(f"begin;select id from invoices where id='{so}' for update;select pg_sleep(2);"+edit(po,20007,'cancel')+"commit;",'warehouse_race_c')
wait_holding('warehouse_race_c');b=launch(f"set test.branch='{warehouse}';select create_child_sale_from_order('{so}');");ra,rb=finish(a),finish(b)
assert ra[0]==0 and rb[0]!=0 and 'da huy' in rb[2],(ra,rb)
assert run(f"select p.status||':'||i.status from purchase_orders p join fnb_purchase_sales_order_links l on l.purchase_order_id=p.id join invoices i on i.id=l.sales_order_id where p.id='{po}';")[1]=='cancelled:cancelled'
print('PASS cancel vs warehouse opener: both orders cancelled, no child created')
