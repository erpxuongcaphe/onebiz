"""Real PostgreSQL regression: manual parent lock vs simultaneous issuance."""
import os
import subprocess
import time

actor = "00000000-0000-0000-0000-000000000005"
branch = "00000000-0000-0000-0000-000000000003"
order = "00000000-0000-0000-0000-000000000030"
child = "00000000-0000-0000-0000-000000000031"
context = f"select set_config('test.actor','{actor}',false),set_config('test.permission','yes',false),set_config('test.branch','{branch}',false);"
args = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c"]
manual_sql = context + f"begin; set local statement_timeout='5s'; select id from invoices where id='{order}' for update; select pg_sleep(0.8); select close_sales_order_processing('{order}','Đã xử lý độc lập'); commit;"
manual = subprocess.Popen(args + [manual_sql], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(0.2)
payment = subprocess.run(args + [context + f"set statement_timeout='5s'; update invoices set status='completed' where id='{child}';"], capture_output=True, text=True, timeout=8)
out, err = manual.communicate(timeout=8)
assert manual.returncode == 0, err
assert payment.returncode == 0, payment.stderr
verification = subprocess.run(args + [f"select (select count(*) from sales_order_processing_closures where order_id='{order}')::text || ':' || (select status from invoices where id='{child}');"], capture_output=True, text=True, check=True)
assert verification.stdout.strip() == "1:completed", verification.stdout
print("PASS: simultaneous manual closure and completed invoice, one marker, no deadlock or aborted payment")
