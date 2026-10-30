const { PGlite } = require(process.env.FNB_PGLITE_DIR || '@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
(async () => {
 const db = new PGlite();
 try {
 const schema=`do $$ begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
 end $$;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table tenants(id uuid primary key); create table branches(id uuid primary key);
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
 create function get_user_tenant_id() returns uuid language sql security definer as $$select tenant_id from profiles where id=auth.uid() and is_active$$;
 create function user_has_permission(uuid,text) returns boolean language sql as $$select current_setting('test.permission',true)='yes'$$;
 create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2::text=current_setting('test.branch',true)$$;
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,source text,status text,
 deleted_at timestamptz,voided_at timestamptz,cancelled_at timestamptz,created_by uuid,source_order_id uuid,
 total numeric default 123,paid numeric default 123,debt numeric default 0);
 create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
 create function mark_order_processed(uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 insert into tenants values('${uuid(1)}'),('${uuid(2)}');
 insert into branches values('${uuid(3)}'),('${uuid(4)}');
 insert into profiles values('${uuid(5)}','${uuid(1)}',true);
 select set_config('test.actor','${uuid(5)}',false),set_config('test.permission','yes',false),set_config('test.branch','${uuid(3)}',false);
 insert into invoices(id,tenant_id,branch_id,code,source,status) values
 ('${uuid(10)}','${uuid(1)}','${uuid(3)}','DH10','order','draft'),
 ('${uuid(11)}','${uuid(1)}','${uuid(3)}','DH11','order','draft'),
 ('${uuid(12)}','${uuid(2)}','${uuid(3)}','OTHER','order','draft'),
 ('${uuid(13)}','${uuid(1)}','${uuid(4)}','BRANCH','order','draft'),
 ('${uuid(14)}','${uuid(1)}','${uuid(3)}','SALE','pos','draft');`;
 await db.exec(schema);
 const before = (await db.query('select * from invoices order by id')).rows;
 const migration=fs.readFileSync('supabase/migrations/20261030092555_sales_order_processing_closure.sql','utf8');
 const lockOrder=fs.readFileSync('supabase/migrations/20261030104530_sales_order_processing_lock_order.sql','utf8');
 await db.exec(migration); await db.exec(lockOrder);
 if(process.env.FNB_RECORD_ORDER_CLOSURE_SQL) fs.writeFileSync(process.env.FNB_RECORD_ORDER_CLOSURE_SQL,schema+'\n'+migration+'\n'+lockOrder+`\n
 insert into invoices(id,tenant_id,branch_id,code,source,status,created_by) values('${uuid(30)}','${uuid(1)}','${uuid(3)}','DH30','order','draft','${uuid(5)}');
 insert into invoices(id,tenant_id,branch_id,code,source,status,created_by,source_order_id) values('${uuid(31)}','${uuid(1)}','${uuid(3)}','HD31','pos','draft','${uuid(5)}','${uuid(30)}');`);
 assert.equal((await db.query('select count(*)::int n from sales_order_processing_closures')).rows[0].n,0);
 await db.query(`select close_sales_order_processing($1,$2)`,[uuid(10),'Đã bán bằng hóa đơn riêng']);
 await db.query(`select close_sales_order_processing($1,$2)`,[uuid(10),'Gửi lại']);
 assert.equal((await db.query('select count(*)::int n from audit_log')).rows[0].n,1,'replay must not duplicate audit');
 assert.deepEqual((await db.query('select * from invoices order by id')).rows,before,'manual closure changes no document, money or stock');
 for (const order of [12,13,14]) await assert.rejects(db.query(`select close_sales_order_processing($1,'Đã xử lý')`,[uuid(order)]));
 await assert.rejects(db.query(`select close_sales_order_processing($1,' ')`,[uuid(11)]));
 await db.exec(`select set_config('test.permission','no',false)`);
 await assert.rejects(db.query(`select close_sales_order_processing($1,'Đã xử lý')`,[uuid(11)]));
 await db.exec(`select set_config('test.permission','yes',false)`);
 // Issuance is independent from ordered quantity / total and remembers cancellation.
 await db.exec(`insert into invoices(id,tenant_id,branch_id,code,source,status,created_by,source_order_id,total)
 values('${uuid(20)}','${uuid(1)}','${uuid(3)}','HD20','pos','draft','${uuid(5)}','${uuid(11)}',9)`);
 assert.equal((await db.query('select count(*)::int n from sales_order_processing_closures')).rows[0].n,1,'draft keeps parent open');
 await db.exec(`update invoices set status='completed' where id='${uuid(20)}'`);
 assert.equal((await db.query('select origin from sales_order_processing_closures where order_id=$1',[uuid(11)])).rows[0].origin,'invoice');
 await db.exec(`update invoices set status='cancelled' where id='${uuid(20)}'`);
 assert.equal((await db.query('select count(*)::int n from sales_order_processing_closures')).rows[0].n,2,'cancellation does not reopen parent');
 await db.query('select reopen_sales_order_processing($1)',[uuid(11)]);
 assert.equal((await db.query('select closed_at from sales_order_processing_closures where order_id=$1',[uuid(11)])).rows[0].closed_at,null);
 await db.exec(`update invoices set status='cancelled' where id='${uuid(20)}'`);
 assert.equal((await db.query('select closed_at from sales_order_processing_closures where order_id=$1',[uuid(11)])).rows[0].closed_at,null,'cancel does not close reopened parent');
 await db.query(`select close_sales_order_processing($1,'Đã xử lý lại')`,[uuid(11)]);
 assert.ok((await db.query('select closed_at from sales_order_processing_closures where order_id=$1',[uuid(11)])).rows[0].closed_at);
 assert.deepEqual((await db.query(`select * from invoices where id<>'${uuid(20)}' order by id`)).rows,before);
 // Direct browser writes are denied; same-branch metadata can be read, other scope cannot.
 await db.exec('grant usage on schema auth to authenticated; grant select on profiles,invoices to authenticated; set role authenticated');
 assert.equal((await db.query('select count(*)::int n from sales_order_processing_closures')).rows[0].n,2);
 await assert.rejects(db.exec('delete from sales_order_processing_closures'));
 await db.exec(`select set_config('test.branch','${uuid(4)}',false)`);
 assert.equal((await db.query('select count(*)::int n from sales_order_processing_closures')).rows[0].n,0);
 await db.exec('reset role; set role anon');
 await assert.rejects(db.exec('select * from sales_order_processing_closures'));
 await assert.rejects(db.query(`select close_sales_order_processing($1,'Đã xử lý')`,[uuid(11)]));
 console.log('PASS: manual closure, replay, no financial mutation, tenant/branch/type/permission validation, automatic issuance, draft exclusion, cancellation persistence, RLS and ACL.');
 } finally { await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
