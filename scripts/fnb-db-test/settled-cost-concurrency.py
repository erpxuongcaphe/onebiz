"""Disposable PostgreSQL only. Verify receipt does not wait for a busy invoice."""
import subprocess
import time

def query(sql):
    return subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-Atc',sql],capture_output=True,text=True,check=True,timeout=10).stdout.strip()

invoice='00000000-0000-0000-0000-000000000900'
line='00000000-0000-0000-0000-000000000901'
shortage='00000000-0000-0000-0000-000000000903'
tenant='00000000-0000-0000-0000-000000000001'
locker=subprocess.Popen(['psql','-X','-v','ON_ERROR_STOP=1','-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
try:
    locker.stdin.write(f"begin;select id from invoices where id='{invoice}' for update;select 'locked';select pg_sleep(4);commit;\n")
    locker.stdin.flush()
    while locker.stdout.readline().strip()!='locked':
        if locker.poll() is not None: raise RuntimeError(locker.stderr.read())
    started=time.monotonic()
    query(f"update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=25 where id='{shortage}'")
    assert time.monotonic()-started<3, 'cost finalization blocked receipt behind an invoice lock'
    assert query(f"select unit_cost is null from invoice_items where id='{line}'")=='t'
    locker.stdin.close()
    locker.wait(timeout=10)
    assert locker.returncode==0,locker.stderr.read()
    query(f"select process_fnb_cost_finalize_queue_20261029('{tenant}',25)")
    assert query(f"select unit_cost=25 from invoice_items where id='{line}'")=='t'
    assert query('select count(*) from audit_log')=='1'
    query(f"select process_fnb_cost_finalize_queue_20261029('{tenant}',25)")
    assert query('select count(*) from audit_log')=='1'
    print('PASS: busy invoice never blocks receipt; durable retry finalizes once after unlock')
finally:
    if locker.poll() is None: locker.kill()
